# Linux 5.15 内存池（mempool）详解

## 目录
1. **`引言：为什么需要内存池`**
2. **`内存碎片问题详解`**
3. **`内存池的核心概念`**
4. **`Linux内核mempool数据结构`**
5. **`内存池的创建与销毁`**
6. **`内存池的分配与释放`**
7. **`预定义的内存池类型`**
8. **`内存池的等待机制`**
9. **`完整使用示例`**
10. **`常见问题与注意事项`**

---

## 一、引言：为什么需要内存池

### 1.1 一个真实的问题场景

想象这样一个场景：你正在开发一个高性能的网络服务器，需要频繁地分配和释放内存来处理网络请求。随着服务器运行时间增长，你发现：

- 内存占用越来越高，但实际使用的并不多
- 系统响应变慢，吞吐量下降
- 长时间运行后可能出现内存分配失败

**这些问题的根源是什么？** 答案是：**内存碎片**。

### 1.2 内存碎片的危害

```
┌─────────────────────────────────────────────────────────────┐
│                    内存碎片的影响                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 内存利用率降低                                          │
│     - 空闲内存被分割成小块                                   │
│     - 无法分配大块连续内存                                   │
│                                                             │
│  2. 分配效率下降                                            │
│     - 需要更多时间查找合适的内存块                           │
│     - 频繁的合并/分割操作                                    │
│                                                             │
│  3. 系统稳定性下降                                          │
│     - 关键时刻可能分配失败                                   │
│     - 导致系统崩溃或服务中断                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 内存池的解决方案

**内存池的核心思想**：预先分配一定数量的内存块，统一管理，循环使用。

```
┌─────────────────────────────────────────────────────────────┐
│                    传统方式 vs 内存池                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统方式：                                                  │
│    每次需要内存 → 调用malloc → 系统分配 → 可能产生碎片       │
│    释放内存 → 调用free → 系统回收 → 可能留下空洞            │
│                                                             │
│  内存池方式：                                                │
│    启动时 → 预分配N个内存块 → 放入空闲链表                   │
│    需要内存 → 从空闲链表取出 → 立即返回                      │
│    释放内存 → 放回空闲链表 → 可再次使用                      │
│                                                             │
│  优势：                                                      │
│    ✓ 无碎片：固定大小块，循环使用                            │
│    ✓ 高效：O(1)时间复杂度的分配/释放                         │
│    ✓ 可靠：保证有预留内存可用                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 Linux内核为什么需要内存池

Linux内核使用内存池的主要原因：

| 原因 | 说明 | 示例场景 |
|------|------|----------|
| 保证分配成功 | 在内存紧张时仍能分配 | 块设备I/O、网络传输 |
| 避免死锁 | 某些路径不能睡眠 | 中断上下文、持锁状态 |
| 提高性能 | 减少内存分配开销 | 高频分配/释放场景 |
| 控制碎片 | 固定大小避免碎片 | 长期运行的子系统 |

---

## 二、内存碎片问题详解

### 2.1 外部碎片 vs 内部碎片

#### 外部碎片

**定义**：内存中存在大量小的空闲块，但无法合并成足够大的连续空间。

```
┌─────────────────────────────────────────────────────────────┐
│                    外部碎片示意图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  内存布局：                                                  │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐       │
│  │已用│空闲│已用│空闲│已用│空闲│已用│空闲│已用│空闲│       │
│  │10K │10K │15K │10K │20K │10K │12K │10K │18K │10K │       │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘       │
│                                                             │
│  总空闲：50K，但最大连续空闲只有10K                          │
│  如果需要分配40K → 失败！（虽然总空闲足够）                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 内部碎片

**定义**：分配的内存块大于实际需求，造成浪费。

```
┌─────────────────────────────────────────────────────────────┐
│                    内部碎片示意图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  假设分配单位是8KB：                                         │
│                                                             │
│  请求6KB → 分配8KB → 浪费2KB（内部碎片）                     │
│  ┌────────────────────────────────┐                         │
│  │      实际使用6KB      │ 浪费2KB │                         │
│  └────────────────────────────────┘                         │
│           分配的8KB                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 碎片产生的原因

```c
// 示例：频繁分配释放导致碎片
void example_fragmentation(void)
{
    char *ptr1 = kmalloc(1024, GFP_KERNEL);   // 分配1KB
    char *ptr2 = kmalloc(2048, GFP_KERNEL);   // 分配2KB
    char *ptr3 = kmalloc(1024, GFP_KERNEL);   // 分配1KB
    char *ptr4 = kmalloc(4096, GFP_KERNEL);   // 分配4KB
    
    kfree(ptr1);   // 释放1KB，留下空洞
    kfree(ptr3);   // 释放1KB，留下另一个空洞
    // 此时虽然有空闲内存，但可能不连续
    
    // 再分配3KB可能失败（取决于内存布局）
    char *ptr5 = kmalloc(3072, GFP_KERNEL);
}
```

---

## 三、内存池的核心概念

### 3.1 内存池的工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    内存池工作流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 初始化阶段                                              │
│     ┌─────────────────────────────────────────────────┐     │
│     │  预分配min_nr个内存块                            │     │
│     │  将所有块放入elements数组                        │     │
│     │  curr_nr = min_nr                               │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
│  2. 分配阶段（mempool_alloc）                               │
│     ┌─────────────────────────────────────────────────┐     │
│     │  尝试从底层分配器分配                            │     │
│     │  如果失败，从elements数组取一个预留块            │     │
│     │  如果数组空了，等待其他任务释放                  │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
│  3. 释放阶段（mempool_free）                                │
│     ┌─────────────────────────────────────────────────┐     │
│     │  如果curr_nr < min_nr，放回elements数组         │     │
│     │  否则，释放到底层分配器                          │     │
│     │  唤醒等待的任务                                  │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 内存池的关键特性

**1. 保证分配成功**

内存池预先保留了`min_nr`个内存块。当系统内存紧张、底层分配器失败时，可以从预留池中获取内存。

**2. 死锁避免**

某些代码路径（如持锁、中断上下文）不能睡眠等待内存。内存池的预留机制确保这些场景下也能获得内存。

**3. 性能优化**

对于频繁分配/释放的场景，内存池避免了反复调用底层分配器的开销。

---

## 四、Linux内核mempool数据结构

### 4.1 核心结构体

定义在 **`include/linux/mempool.h`**：

```c
typedef struct mempool_s {
    spinlock_t lock;           // 保护并发访问的自旋锁
    int min_nr;                // 预留的最小元素数量
    int curr_nr;               // 当前预留的元素数量
    void **elements;           // 指向预留元素的指针数组

    void *pool_data;           // 传递给alloc/free的私有数据
    mempool_alloc_t *alloc;    // 分配函数指针
    mempool_free_t *free;      // 释放函数指针
    wait_queue_head_t wait;    // 等待队列（内存不足时等待）
} mempool_t;
```

### 4.2 结构体字段详解

| 字段 | 类型 | 说明 |
|------|------|------|
| lock | spinlock_t | 保护elements数组和curr_nr的自旋锁 |
| min_nr | int | 内存池保证预留的最小元素数量 |
| curr_nr | int | 当前elements数组中的元素数量 |
| elements | void** | 存储预留元素指针的数组 |
| pool_data | void* | 传递给alloc/free函数的私有数据 |
| alloc | 函数指针 | 底层分配函数 |
| free | 函数指针 | 底层释放函数 |
| wait | wait_queue_head_t | 等待队列，用于内存不足时阻塞等待 |

### 4.3 分配和释放函数类型

```c
// 分配函数类型
typedef void * (mempool_alloc_t)(gfp_t gfp_mask, void *pool_data);

// 释放函数类型
typedef void (mempool_free_t)(void *element, void *pool_data);
```

### 4.4 数据结构关系图

```
┌─────────────────────────────────────────────────────────────┐
│                       mempool_t                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  spinlock_t lock                                     │   │
│  │  int min_nr = 10                                     │   │
│  │  int curr_nr = 7                                     │   │
│  │  void **elements ─────────────────┐                  │   │
│  │  void *pool_data                  │                  │   │
│  │  mempool_alloc_t *alloc           │                  │   │
│  │  mempool_free_t *free             │                  │   │
│  │  wait_queue_head_t wait           │                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
         ┌───────────────────────────────────────────┐
         │           elements数组                    │
         │  ┌─────┬─────┬─────┬─────┬─────┬─────┐   │
         │  │elem0│elem1│elem2│elem3│elem4│elem5│   │
         │  │  *  │  *  │  *  │  *  │  *  │  *  │   │
         │  └──┬──┴──┬──┴──┬──┴──┬──┴──┬──┴──┬──┘   │
         └─────┼─────┼─────┼─────┼─────┼─────┼───────┘
               │     │     │     │     │     │
               ▼     ▼     ▼     ▼     ▼     ▼
             ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐
             │内存││内存││内存││内存││内存││内存│
             │块0 ││块1 ││块2 ││块3 ││块4 ││块5 │
             └────┘└────┘└────┘└────┘└────┘└────┘
             
         curr_nr = 7 表示有7个预留块可用
         min_nr = 10 表示最少保留10个预留块
```

---

## 五、内存池的创建与销毁

### 5.1 mempool_create函数

定义在 **`mm/mempool.c`**：

```c
/**
 * mempool_create - 创建内存池
 * @min_nr: 保证预留的最小元素数量
 * @alloc_fn: 用户定义的分配函数
 * @free_fn: 用户定义的释放函数
 * @pool_data: 传递给alloc/free的私有数据
 *
 * 创建并分配一个保证大小的预分配内存池。
 * 此函数可能会睡眠。
 *
 * 返回：创建的内存池指针，或NULL表示错误
 */
mempool_t *mempool_create(int min_nr, mempool_alloc_t *alloc_fn,
                           mempool_free_t *free_fn, void *pool_data)
{
    return mempool_create_node(min_nr, alloc_fn, free_fn, pool_data,
                               GFP_KERNEL, NUMA_NO_NODE);
}
```

### 5.2 mempool_create_node函数

定义在 **`mm/mempool.c`**：

```c
mempool_t *mempool_create_node(int min_nr, mempool_alloc_t *alloc_fn,
                                mempool_free_t *free_fn, void *pool_data,
                                gfp_t gfp_mask, int node_id)
{
    mempool_t *pool;

    // 分配mempool_t结构体
    pool = kzalloc_node(sizeof(*pool), gfp_mask, node_id);
    if (!pool)
        return NULL;

    // 初始化内存池
    if (mempool_init_node(pool, min_nr, alloc_fn, free_fn, pool_data,
                          gfp_mask, node_id)) {
        kfree(pool);
        return NULL;
    }

    return pool;
}
```

### 5.3 mempool_init_node函数

定义在 **`mm/mempool.c`**：

```c
int mempool_init_node(mempool_t *pool, int min_nr, mempool_alloc_t *alloc_fn,
                       mempool_free_t *free_fn, void *pool_data,
                       gfp_t gfp_mask, int node_id)
{
    // 初始化自旋锁
    spin_lock_init(&pool->lock);
    pool->min_nr    = min_nr;
    pool->pool_data = pool_data;
    pool->alloc     = alloc_fn;
    pool->free      = free_fn;
    
    // 初始化等待队列
    init_waitqueue_head(&pool->wait);

    // 分配elements数组
    pool->elements = kmalloc_array_node(min_nr, sizeof(void *),
                                        gfp_mask, node_id);
    if (!pool->elements)
        return -ENOMEM;

    // 预分配min_nr个元素
    while (pool->curr_nr < pool->min_nr) {
        void *element;

        element = pool->alloc(gfp_mask, pool->pool_data);
        if (unlikely(!element)) {
            mempool_exit(pool);
            return -ENOMEM;
        }
        add_element(pool, element);
    }

    return 0;
}
```

### 5.4 创建流程图

```
mempool_create(min_nr, alloc_fn, free_fn, pool_data)
        │
        ▼
mempool_create_node()
        │
        ├─► kzalloc_node()          // 分配mempool_t结构
        │
        └─► mempool_init_node()
                │
                ├─► spin_lock_init()        // 初始化锁
                │
                ├─► init_waitqueue_head()   // 初始化等待队列
                │
                ├─► kmalloc_array_node()    // 分配elements数组
                │
                └─► 循环预分配min_nr个元素
                        │
                        ├─► pool->alloc()   // 调用底层分配函数
                        │
                        └─► add_element()   // 添加到elements数组
```

### 5.5 mempool_destroy函数

定义在 **`mm/mempool.c`**：

```c
/**
 * mempool_destroy - 销毁内存池
 * @pool: 内存池指针
 *
 * 释放所有预留元素和内存池本身。
 */
void mempool_destroy(mempool_t *pool)
{
    if (unlikely(!pool))
        return;

    mempool_exit(pool);
    kfree(pool);
}
```

### 5.6 mempool_exit函数

定义在 **`mm/mempool.c`**：

```c
void mempool_exit(mempool_t *pool)
{
    // 释放所有预留的元素
    while (pool->curr_nr) {
        void *element = remove_element(pool);
        pool->free(element, pool->pool_data);
    }
    
    // 释放elements数组
    kfree(pool->elements);
    pool->elements = NULL;
}
```

---

## 六、内存池的分配与释放

### 6.1 mempool_alloc函数

定义在 **`mm/mempool.c`**：

```c
/**
 * mempool_alloc - 从内存池分配一个元素
 * @pool: 内存池指针
 * @gfp_mask: 分配标志
 *
 * 此函数只有在alloc_fn睡眠或返回NULL时才会睡眠。
 * 由于预分配，在进程上下文中调用此函数永远不会失败。
 * （在中断上下文可能失败）
 *
 * 返回：分配的元素指针，或NULL表示错误
 */
void *mempool_alloc(mempool_t *pool, gfp_t gfp_mask)
{
    void *element;
    unsigned long flags;
    wait_queue_entry_t wait;
    gfp_t gfp_temp;

    VM_WARN_ON_ONCE(gfp_mask & __GFP_ZERO);
    might_sleep_if(gfp_mask & __GFP_DIRECT_RECLAIM);

    // 设置分配标志：不使用紧急预留、不重试、不警告
    gfp_mask |= __GFP_NOMEMALLOC;
    gfp_mask |= __GFP_NORETRY;
    gfp_mask |= __GFP_NOWARN;

    gfp_temp = gfp_mask & ~(__GFP_DIRECT_RECLAIM|__GFP_IO);

repeat_alloc:
    // 首先尝试从底层分配器分配
    element = pool->alloc(gfp_temp, pool->pool_data);
    if (likely(element != NULL))
        return element;

    // 底层分配失败，尝试从预留池获取
    spin_lock_irqsave(&pool->lock, flags);
    if (likely(pool->curr_nr)) {
        element = remove_element(pool);
        spin_unlock_irqrestore(&pool->lock, flags);
        smp_wmb();
        kmemleak_update_trace(element);
        return element;
    }

    // 如果第一次尝试用的是轻量级标志，重试完整标志
    if (gfp_temp != gfp_mask) {
        spin_unlock_irqrestore(&pool->lock, flags);
        gfp_temp = gfp_mask;
        goto repeat_alloc;
    }

    // 如果不能睡眠，直接返回失败
    if (!(gfp_mask & __GFP_DIRECT_RECLAIM)) {
        spin_unlock_irqrestore(&pool->lock, flags);
        return NULL;
    }

    // 等待其他任务释放元素
    init_wait(&wait);
    prepare_to_wait(&pool->wait, &wait, TASK_UNINTERRUPTIBLE);

    spin_unlock_irqrestore(&pool->lock, flags);

    // 等待5秒（超时机制）
    io_schedule_timeout(5*HZ);

    finish_wait(&pool->wait, &wait);
    goto repeat_alloc;
}
```

### 6.2 分配流程图

```
mempool_alloc(pool, gfp_mask)
        │
        ▼
┌───────────────────────────────────┐
│  尝试从底层分配器分配             │
│  element = pool->alloc()          │
└───────────────┬───────────────────┘
                │
        ┌───────┴───────┐
        │               │
     成功             失败
        │               │
        ▼               ▼
     返回element    ┌───────────────────────────┐
                    │  从预留池获取             │
                    │  if (curr_nr > 0)         │
                    └───────────┬───────────────┘
                                │
                        ┌───────┴───────┐
                        │               │
                     有预留          无预留
                        │               │
                        ▼               ▼
                   返回预留块    ┌─────────────────────────┐
                                │  能睡眠？               │
                                └───────────┬─────────────┘
                                            │
                                    ┌───────┴───────┐
                                    │               │
                                  不能            能
                                    │               │
                                    ▼               ▼
                               返回NULL     等待其他任务释放
                                            （最多等待5秒）
```

### 6.3 mempool_free函数

定义在 **`mm/mempool.c`**：

```c
/**
 * mempool_free - 将元素归还到内存池
 * @element: 要释放的元素
 * @pool: 内存池指针
 */
void mempool_free(void *element, mempool_t *pool)
{
    unsigned long flags;

    if (unlikely(element == NULL))
        return;

    // 内存屏障，确保正确的内存可见性
    smp_rmb();

    // 如果预留池未满，放回预留池
    if (unlikely(READ_ONCE(pool->curr_nr) < pool->min_nr)) {
        spin_lock_irqsave(&pool->lock, flags);
        if (likely(pool->curr_nr < pool->min_nr)) {
            add_element(pool, element);
            spin_unlock_irqrestore(&pool->lock, flags);
            wake_up(&pool->wait);    // 唤醒等待的任务
            return;
        }
        spin_unlock_irqrestore(&pool->lock, flags);
    }

    // 预留池已满，释放到底层分配器
    pool->free(element, pool->pool_data);
}
```

### 6.4 释放流程图

```
mempool_free(element, pool)
        │
        ▼
┌───────────────────────────────────┐
│  检查预留池是否未满               │
│  if (curr_nr < min_nr)            │
└───────────────┬───────────────────┘
                │
        ┌───────┴───────┐
        │               │
      未满            已满
        │               │
        ▼               ▼
┌─────────────────┐  ┌─────────────────┐
│ 放回预留池      │  │ 释放到底层分配器│
│ add_element()   │  │ pool->free()    │
│ wake_up()       │  └─────────────────┘
└─────────────────┘
```

### 6.5 add_element和remove_element

定义在 **`mm/mempool.c`**：

```c
// 添加元素到预留池
static __always_inline void add_element(mempool_t *pool, void *element)
{
    BUG_ON(pool->curr_nr >= pool->min_nr);
    poison_element(pool, element);        // 调试：填充特殊值
    kasan_poison_element(pool, element);  // KASAN：标记为已释放
    pool->elements[pool->curr_nr++] = element;
}

// 从预留池移除元素
static void *remove_element(mempool_t *pool)
{
    void *element = pool->elements[--pool->curr_nr];

    BUG_ON(pool->curr_nr < 0);
    kasan_unpoison_element(pool, element);  // KASAN：标记为已分配
    check_element(pool, element);           // 调试：检查是否被修改
    return element;
}
```

---

## 七、预定义的内存池类型

Linux内核提供了三种常用的内存池类型：

### 7.1 Slab内存池

基于slab分配器的内存池：

```c
// 分配函数
void *mempool_alloc_slab(gfp_t gfp_mask, void *pool_data)
{
    struct kmem_cache *mem = pool_data;
    VM_BUG_ON(mem->ctor);
    return kmem_cache_alloc(mem, gfp_mask);
}

// 释放函数
void mempool_free_slab(void *element, void *pool_data)
{
    struct kmem_cache *mem = pool_data;
    kmem_cache_free(mem, element);
}

// 便捷创建函数
static inline mempool_t *
mempool_create_slab_pool(int min_nr, struct kmem_cache *kc)
{
    return mempool_create(min_nr, mempool_alloc_slab, 
                          mempool_free_slab, (void *)kc);
}
```

**使用示例**：

```c
// 创建slab缓存
struct kmem_cache *my_cache = kmem_cache_create("my_cache",
                                                 1024,  // 对象大小
                                                 0, SLAB_HWCACHE_ALIGN, NULL);

// 创建基于slab的内存池
mempool_t *pool = mempool_create_slab_pool(32, my_cache);

// 分配
void *obj = mempool_alloc(pool, GFP_KERNEL);

// 释放
mempool_free(obj, pool);
```

### 7.2 kmalloc内存池

基于kmalloc的内存池：

```c
// 分配函数
void *mempool_kmalloc(gfp_t gfp_mask, void *pool_data)
{
    size_t size = (size_t)pool_data;
    return kmalloc(size, gfp_mask);
}

// 释放函数
void mempool_kfree(void *element, void *pool_data)
{
    kfree(element);
}

// 便捷创建函数
static inline mempool_t *
mempool_create_kmalloc_pool(int min_nr, size_t size)
{
    return mempool_create(min_nr, mempool_kmalloc, 
                          mempool_kfree, (void *)size);
}
```

**使用示例**：

```c
// 创建kmalloc内存池：预留32个4KB的内存块
mempool_t *pool = mempool_create_kmalloc_pool(32, 4096);

// 分配
void *buf = mempool_alloc(pool, GFP_KERNEL);

// 释放
mempool_free(buf, pool);
```

### 7.3 页面内存池

基于页分配器的内存池：

```c
// 分配函数
void *mempool_alloc_pages(gfp_t gfp_mask, void *pool_data)
{
    int order = (int)(long)pool_data;
    return alloc_pages(gfp_mask, order);
}

// 释放函数
void mempool_free_pages(void *element, void *pool_data)
{
    int order = (int)(long)pool_data;
    __free_pages(element, order);
}

// 便捷创建函数
static inline mempool_t *
mempool_create_page_pool(int min_nr, int order)
{
    return mempool_create(min_nr, mempool_alloc_pages, 
                          mempool_free_pages, (void *)(long)order);
}
```

**使用示例**：

```c
// 创建页面内存池：预留16个单页
mempool_t *pool = mempool_create_page_pool(16, 0);  // order=0表示1页

// 分配
struct page *page = mempool_alloc(pool, GFP_KERNEL);

// 释放
mempool_free(page, pool);
```

### 7.4 三种内存池对比

| 类型 | 底层分配器 | 适用场景 | 特点 |
|------|------------|----------|------|
| Slab池 | kmem_cache | 固定大小对象 | 高效、支持构造函数 |
| kmalloc池 | kmalloc | 通用内存块 | 简单易用 |
| 页面池 | alloc_pages | 大块内存 | 物理连续 |

---

## 八、内存池的等待机制

### 8.1 为什么需要等待机制

当内存池耗尽且底层分配器也失败时，进程需要等待其他进程释放内存。

```
┌─────────────────────────────────────────────────────────────┐
│                    等待场景                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  进程A：mempool_alloc()                                     │
│    1. 底层分配失败（内存紧张）                               │
│    2. 预留池为空（curr_nr = 0）                             │
│    3. 进入等待队列，休眠                                     │
│                                                             │
│  进程B：mempool_free()                                      │
│    1. 释放内存                                              │
│    2. 放回预留池                                             │
│    3. 唤醒等待队列                                           │
│                                                             │
│  进程A：被唤醒                                               │
│    1. 从预留池获取内存                                       │
│    2. 继续执行                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 等待机制的实现

在`mempool_alloc`中：

```c
// 初始化等待队列项
init_wait(&wait);
prepare_to_wait(&pool->wait, &wait, TASK_UNINTERRUPTIBLE);

spin_unlock_irqrestore(&pool->lock, flags);

// 等待（带超时）
io_schedule_timeout(5*HZ);

finish_wait(&pool->wait, &wait);
goto repeat_alloc;
```

在`mempool_free`中：

```c
// 放回预留池后，唤醒等待者
add_element(pool, element);
spin_unlock_irqrestore(&pool->lock, flags);
wake_up(&pool->wait);  // 唤醒等待的任务
```

### 8.3 超时机制

内存池使用5秒超时，避免无限等待：

```c
io_schedule_timeout(5*HZ);  // 最多等待5秒
```

超时后会重新尝试分配，形成循环：

```
┌─────────────────────────────────────────────────────────────┐
│                    分配循环                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  repeat_alloc:                                              │
│      │                                                      │
│      ▼                                                      │
│  尝试底层分配 ──────成功────► 返回                          │
│      │                                                      │
│     失败                                                    │
│      │                                                      │
│      ▼                                                      │
│  尝试预留池 ──────成功────► 返回                            │
│      │                                                      │
│     失败                                                    │
│      │                                                      │
│      ▼                                                      │
│  等待5秒 ──────被唤醒────► goto repeat_alloc               │
│      │                                                      │
│     超时                                                    │
│      │                                                      │
│      └─────────────────────────────────► goto repeat_alloc │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、完整使用示例

### 9.1 示例1：块设备驱动的内存池

```c
#include <linux/mempool.h>
#include <linux/slab.h>
#include <linux/bio.h>

#define MIN_POOL_SIZE   64
#define BIO_POOL_SIZE   256

static struct kmem_cache *bio_cache;
static mempool_t *bio_pool;

// 模块初始化
static int __init my_driver_init(void)
{
    // 创建slab缓存
    bio_cache = kmem_cache_create("my_bio_cache",
                                   sizeof(struct bio),
                                   0, SLAB_HWCACHE_ALIGN, NULL);
    if (!bio_cache)
        return -ENOMEM;

    // 创建内存池
    bio_pool = mempool_create_slab_pool(MIN_POOL_SIZE, bio_cache);
    if (!bio_pool) {
        kmem_cache_destroy(bio_cache);
        return -ENOMEM;
    }

    printk("内存池创建成功：预留%d个bio结构\n", MIN_POOL_SIZE);
    return 0;
}

// 分配bio结构
struct bio *my_bio_alloc(gfp_t gfp_mask)
{
    struct bio *bio;

    bio = mempool_alloc(bio_pool, gfp_mask);
    if (bio)
        memset(bio, 0, sizeof(struct bio));

    return bio;
}

// 释放bio结构
void my_bio_free(struct bio *bio)
{
    mempool_free(bio, bio_pool);
}

// 模块退出
static void __exit my_driver_exit(void)
{
    mempool_destroy(bio_pool);
    kmem_cache_destroy(bio_cache);
}

module_init(my_driver_init);
module_exit(my_driver_exit);
```

### 9.2 示例2：网络缓冲区内存池

```c
#include <linux/mempool.h>
#include <linux/slab.h>

#define BUF_SIZE    2048
#define MIN_BUFS    128

static mempool_t *buf_pool;

// 初始化
static int __init netbuf_init(void)
{
    buf_pool = mempool_create_kmalloc_pool(MIN_BUFS, BUF_SIZE);
    if (!buf_pool)
        return -ENOMEM;

    return 0;
}

// 发送数据包
int send_packet(const void *data, size_t len)
{
    void *buf;

    if (len > BUF_SIZE)
        return -EINVAL;

    // 分配缓冲区（可睡眠）
    buf = mempool_alloc(buf_pool, GFP_KERNEL);
    if (!buf)
        return -ENOMEM;

    // 复制数据
    memcpy(buf, data, len);

    // 发送...
    // ...

    // 释放缓冲区
    mempool_free(buf, buf_pool);

    return 0;
}

// 中断上下文中的分配
int send_packet_atomic(const void *data, size_t len)
{
    void *buf;

    // 使用GFP_ATOMIC，不能睡眠
    buf = mempool_alloc(buf_pool, GFP_ATOMIC);
    if (!buf)
        return -ENOMEM;

    memcpy(buf, data, len);
    // 发送...
    mempool_free(buf, buf_pool);

    return 0;
}
```

### 9.3 示例3：页面内存池

```c
#include <linux/mempool.h>
#include <linux/mm.h>

#define MIN_PAGES  32

static mempool_t *page_pool;

// 初始化
static int __init pagepool_init(void)
{
    // 创建页面池：预留32个单页
    page_pool = mempool_create_page_pool(MIN_PAGES, 0);
    if (!page_pool)
        return -ENOMEM;

    return 0;
}

// 分配页面
struct page *alloc_my_page(gfp_t gfp_mask)
{
    return mempool_alloc(page_pool, gfp_mask);
}

// 释放页面
void free_my_page(struct page *page)
{
    mempool_free(page, page_pool);
}

// 使用示例
void example_usage(void)
{
    struct page *page;
    void *addr;

    page = alloc_my_page(GFP_KERNEL);
    if (!page) {
        printk("页面分配失败\n");
        return;
    }

    // 映射页面到内核地址空间
    addr = page_address(page);
    
    // 使用页面...
    memset(addr, 0, PAGE_SIZE);

    // 释放页面
    free_my_page(page);
}
```

### 9.4 示例4：自定义内存池

```c
#include <linux/mempool.h>
#include <linux/slab.h>

struct my_object {
    int id;
    char data[256];
};

static struct kmem_cache *my_cache;
static mempool_t *my_pool;

// 自定义分配函数
static void *my_alloc(gfp_t gfp_mask, void *pool_data)
{
    struct my_object *obj;

    obj = kmem_cache_alloc(pool_data, gfp_mask);
    if (obj) {
        // 自定义初始化
        obj->id = -1;
        memset(obj->data, 0, sizeof(obj->data));
    }

    return obj;
}

// 自定义释放函数
static void my_free(void *element, void *pool_data)
{
    struct my_object *obj = element;

    // 自定义清理
    obj->id = -1;

    kmem_cache_free(pool_data, obj);
}

// 初始化
static int __init custom_pool_init(void)
{
    my_cache = kmem_cache_create("my_object_cache",
                                  sizeof(struct my_object),
                                  0, SLAB_HWCACHE_ALIGN, NULL);
    if (!my_cache)
        return -ENOMEM;

    // 使用自定义alloc/free函数
    my_pool = mempool_create(64, my_alloc, my_free, my_cache);
    if (!my_pool) {
        kmem_cache_destroy(my_cache);
        return -ENOMEM;
    }

    return 0;
}

// 使用
struct my_object *alloc_my_object(void)
{
    return mempool_alloc(my_pool, GFP_KERNEL);
}

void free_my_object(struct my_object *obj)
{
    mempool_free(obj, my_pool);
}
```

### 9.5 示例5：内存池调整大小

```c
#include <linux/mempool.h>

static mempool_t *dynamic_pool;

// 初始创建
static int __init dynamic_init(void)
{
    // 初始预留16个元素
    dynamic_pool = mempool_create_kmalloc_pool(16, 1024);
    if (!dynamic_pool)
        return -ENOMEM;

    return 0;
}

// 扩大内存池
void expand_pool(void)
{
    int ret;

    // 扩大到64个元素
    ret = mempool_resize(dynamic_pool, 64);
    if (ret)
        printk("扩大内存池失败：%d\n", ret);
    else
        printk("内存池扩大到64个元素\n");
}

// 缩小内存池
void shrink_pool(void)
{
    int ret;

    // 缩小到8个元素
    ret = mempool_resize(dynamic_pool, 8);
    if (ret)
        printk("缩小内存池失败：%d\n", ret);
    else
        printk("内存池缩小到8个元素\n");
}
```

---

## 十、常见问题与注意事项

### 10.1 内存池大小选择

```
┌─────────────────────────────────────────────────────────────┐
│                    内存池大小选择指南                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  太小的问题：                                                │
│    - 预留池快速耗尽                                          │
│    - 频繁调用底层分配器                                      │
│    - 可能导致等待                                            │
│                                                             │
│  太大的问题：                                                │
│    - 浪费内存                                                │
│    - 增加初始化时间                                          │
│    - 可能影响系统其他部分                                    │
│                                                             │
│  建议策略：                                                  │
│    1. 根据峰值需求估算                                       │
│    2. 预留一定冗余（如20%）                                  │
│    3. 可动态调整（mempool_resize）                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 GFP标志的选择

| 场景 | 推荐标志 | 说明 |
|------|----------|------|
| 进程上下文，可睡眠 | GFP_KERNEL | 最常用，可等待 |
| 中断上下文 | GFP_ATOMIC | 不能睡眠 |
| 持锁时 | GFP_ATOMIC | 避免死锁 |
| 高优先级 | GFP_HIGH | 使用高优先级内存 |
| 不允许失败 | GFP_NOIO | 不进行I/O |

### 10.3 死锁避免

```c
// 错误：持自旋锁时使用GFP_KERNEL
void wrong_example(void)
{
    spin_lock(&my_lock);
    // 错误！可能导致死锁
    void *buf = mempool_alloc(pool, GFP_KERNEL);
    spin_unlock(&my_lock);
}

// 正确：持自旋锁时使用GFP_ATOMIC
void correct_example(void)
{
    spin_lock(&my_lock);
    // 正确：GFP_ATOMIC不会睡眠
    void *buf = mempool_alloc(pool, GFP_ATOMIC);
    spin_unlock(&my_lock);
}
```

### 10.4 内存泄漏检测

```c
// 使用KASAN检测内存问题
// 内核配置：CONFIG_KASAN=y

// 使用slab调试检测
// 内核配置：CONFIG_DEBUG_SLAB=y

// 使用kmemleak检测泄漏
// 内核配置：CONFIG_DEBUG_KMEMLEAK=y
```

### 10.5 性能考虑

```
┌─────────────────────────────────────────────────────────────┐
│                    性能优化建议                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 选择合适的底层分配器                                    │
│     - 小对象：slab池                                         │
│     - 大对象：页面池                                         │
│     - 通用：kmalloc池                                        │
│                                                             │
│  2. 合理设置min_nr                                          │
│     - 太小：频繁底层分配                                     │
│     - 太大：浪费内存                                         │
│                                                             │
│  3. NUMA考虑                                                │
│     - 使用mempool_create_node                               │
│     - 在正确的节点上分配                                     │
│                                                             │
│  4. 批量操作                                                │
│     - 预分配多个元素                                         │
│     - 批量处理后再释放                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.6 调试技巧

```c
// 检查内存池状态
void debug_mempool(mempool_t *pool)
{
    printk("内存池状态：\n");
    printk("  min_nr: %d\n", pool->min_nr);
    printk("  curr_nr: %d\n", pool->curr_nr);
    printk("  可用预留: %d\n", pool->curr_nr);
    printk("  已分配: %d\n", pool->min_nr - pool->curr_nr);
}

// 检查等待队列
void debug_waitqueue(mempool_t *pool)
{
    if (waitqueue_active(&pool->wait))
        printk("有进程在等待内存\n");
    else
        printk("无等待进程\n");
}
```

---

## 十一、总结

### 11.1 内存池核心API速查表

| API | 功能 | 说明 |
|-----|------|------|
| mempool_create | 创建内存池 | 返回mempool_t指针 |
| mempool_create_slab_pool | 创建slab内存池 | 基于kmem_cache |
| mempool_create_kmalloc_pool | 创建kmalloc内存池 | 基于kmalloc |
| mempool_create_page_pool | 创建页面内存池 | 基于alloc_pages |
| mempool_destroy | 销毁内存池 | 释放所有资源 |
| mempool_alloc | 分配元素 | 从池中获取 |
| mempool_free | 释放元素 | 归还到池中 |
| mempool_resize | 调整大小 | 动态扩缩容 |

### 11.2 设计要点总结

1. **保证分配成功**：预留机制确保关键时刻能获得内存
2. **避免死锁**：预留内存可用于不能睡眠的场景
3. **减少碎片**：固定大小循环使用，避免碎片
4. **提高性能**：O(1)分配，减少底层分配器压力

### 11.3 适用场景

- 块设备驱动（bio结构）
- 网络子系统（sk_buff）
- 文件系统（inode、dentry）
- 任何需要保证内存分配成功的场景

### 11.4 进一步学习

- **`include/linux/mempool.h`** - 内存池头文件
- **`mm/mempool.c`** - 内存池实现
- **`mm/slab.c`** - Slab分配器
- **`mm/page_alloc.c`** - 页面分配器

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了内存池的原理、实现和使用方法。内存池是Linux内核保证内存分配可靠性的重要机制，理解它是掌握内核内存管理的关键。*
