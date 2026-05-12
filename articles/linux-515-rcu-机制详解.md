# Linux 5.15 RCU 机制详解

## 目录

1. **`什么是 RCU`**
2. **`为什么需要 RCU`**
3. **`RCU 核心原理`**
4. **`宽限期机制`**
5. **`RCU 核心 API`**
6. **`RCU 链表操作`**
7. **`RCU 实现机制`**
8. **`RCU 变体`**
9. **`RCU 使用场景`**
10. **`RCU 使用注意事项`**

---

## 1. 什么是 RCU

### 1.1 从生活场景理解

想象一个图书馆的场景：

```
传统锁机制（读写锁）：
+===========================================================================+
|                                                                           |
|   图书馆（共享数据）                                                      |
|   +------------------------------------------------------------------+    |
|   |                                                                   |    |
|   |   读者 A 正在看书                                                 |    |
|   |   读者 B 正在看书                                                 |    |
|   |   读者 C 正在看书                                                 |    |
|   |                                                                   |    |
|   |   管理员 D 要更新书籍信息                                         |    |
|   |   +-------------------+                                           |    |
|   |   | 申请写锁         |                                           |    |
|   |   | 等待所有读者离开 |  <-- 阻塞！                                |    |
|   |   | 读者 A、B、C 都  |                                           |    |
|   |   | 必须等待         |                                           |    |
|   |   +-------------------+                                           |    |
|   |                                                                   |    |
|   +------------------------------------------------------------------+    |
|                                                                           |
|   问题：写操作阻塞了所有读操作，效率低下                                  |
|                                                                           |
+===========================================================================+

RCU 机制：
+===========================================================================+
|                                                                           |
|   图书馆（共享数据）                                                      |
|   +------------------------------------------------------------------+    |
|   |                                                                   |    |
|   |   读者 A 正在看书（旧版本）                                       |    |
|   |   读者 B 正在看书（旧版本）                                       |    |
|   |   读者 C 正在看书（旧版本）                                       |    |
|   |                                                                   |    |
|   |   管理员 D 要更新书籍信息                                         |    |
|   |   +-------------------+                                           |    |
|   |   | 复制旧书籍       |                                           |    |
|   |   | 修改副本         |  <-- 不阻塞读者！                          |    |
|   |   | 替换指针         |                                           |    |
|   |   +-------------------+                                           |    |
|   |                                                                   |    |
|   |   新读者 E 开始看书（新版本）                                     |    |
|   |   旧读者 A、B、C 继续看书（旧版本）                               |    |
|   |                                                                   |    |
|   |   等待 A、B、C 离开后，回收旧书籍                                 |    |
|   |                                                                   |    |
|   +------------------------------------------------------------------+    |
|                                                                           |
|   优点：读写操作互不阻塞，高效并发                                        |
|                                                                           |
+===========================================================================+
```

### 1.2 RCU 的定义

```
RCU = Read-Copy-Update（读-复制-更新）

+===========================================================================+
|                                                                           |
|   Read（读）：                                                            |
|   +-------------------+                                                    |
|   | 读操作无锁        |  不需要获取任何锁                               |
|   | 读操作无阻塞      |  不会被写操作阻塞                               |
|   | 读操作几乎无开销  |  只有标记临界区的开销                           |
|   +-------------------+                                                    |
|                                                                           |
|   Copy（复制）：                                                          |
|   +-------------------+                                                    |
|   | 写操作先复制数据  |  创建数据副本                                   |
|   | 在副本上修改      |  不影响原数据                                   |
|   +-------------------+                                                    |
|                                                                           |
|   Update（更新）：                                                        |
|   +-------------------+                                                    |
|   | 原子替换指针      |  指向新数据                                     |
|   | 延迟释放旧数据    |  等待所有读者完成                               |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 1.3 RCU 的核心特性

```
RCU 核心特性：
+===========================================================================+
|                                                                           |
|   1. 读操作几乎无开销                                                     |
|      +-------------------+                                                |
|      | 无锁竞争          |                                                |
|      | 无原子操作        |                                                |
|      | 无内存屏障（大部分架构）|                                          |
|      +-------------------+                                                |
|                                                                           |
|   2. 写操作不阻塞读操作                                                   |
|      +-------------------+                                                |
|      | 读者继续访问旧数据|                                                |
|      | 写者修改副本      |                                                |
|      | 互不干扰          |                                                |
|      +-------------------+                                                |
|                                                                           |
|   3. 最终一致性                                                           |
|      +-------------------+                                                |
|      | 宽限期后所有读者  |                                                |
|      | 都能看到新数据    |                                                |
|      +-------------------+                                                |
|                                                                           |
|   4. 适用于读多写少场景                                                   |
|      +-------------------+                                                |
|      | 读操作频繁        |                                                |
|      | 写操作稀少        |                                                |
|      +-------------------+                                                |
|                                                                           |
+===========================================================================+
```

---

## 2. 为什么需要 RCU

### 2.1 传统同步机制的问题

```
传统同步机制的问题：
+===========================================================================+
|                                                                           |
|   1. 自旋锁（Spinlock）                                                   |
|      +-------------------+                                                |
|      | 问题：            |                                                |
|      | - 读操作也需要锁  |                                                |
|      | - 多核竞争严重    |                                                |
|      | - 浪费 CPU 资源   |                                                |
|      +-------------------+                                                |
|                                                                           |
|   2. 读写锁（RWLock）                                                     |
|      +-------------------+                                                |
|      | 问题：            |                                                |
|      | - 写操作阻塞所有读|                                                |
|      | - 写者饥饿        |                                                |
|      | - 锁竞争开销      |                                                |
|      +-------------------+                                                |
|                                                                           |
|   3. 互斥锁（Mutex）                                                      |
|      +-------------------+                                                |
|      | 问题：            |                                                |
|      | - 上下文切换开销  |                                                |
|      | - 不适合短临界区  |                                                |
|      +-------------------+                                                |
|                                                                           |
+===========================================================================+
```

### 2.2 读多写少场景的需求

```
读多写少场景示例：
+===========================================================================+
|                                                                           |
|   场景 1：路由表查找                                                      |
|   +-------------------+                                                    |
|   | 读：每秒百万次    |  查找路由                                       |
|   | 写：每秒几次      |  更新路由                                       |
|   +-------------------+                                                    |
|                                                                           |
|   场景 2：进程描述符查找                                                  |
|   +-------------------+                                                    |
|   | 读：非常频繁      |  查找进程                                       |
|   | 写：偶尔          |  创建/销毁进程                                 |
|   +-------------------+                                                    |
|                                                                           |
|   场景 3：设备链表遍历                                                    |
|   +-------------------+                                                    |
|   | 读：频繁          |  查找设备                                       |
|   | 写：偶尔          |  插入/删除设备                                 |
|   +-------------------+                                                    |
|                                                                           |
|   需求：读操作必须高效，不能被写操作阻塞                                  |
|                                                                           |
+===========================================================================+
```

### 2.3 RCU 的优势

```
RCU vs 传统锁性能对比：
+===========================================================================+
|                                                                           |
|   读操作开销：                                                            |
|   +-------------------+-------------------+-------------------+           |
|   | 机制              | 开销              | 说明              |           |
|   +-------------------+-------------------+-------------------+           |
|   | 自旋锁            | 高                | 锁竞争、缓存行    |           |
|   | 读写锁            | 中                | 读锁计数          |           |
|   | RCU               | 极低              | 仅标记临界区      |           |
|   +-------------------+-------------------+-------------------+           |
|                                                                           |
|   写操作开销：                                                            |
|   +-------------------+-------------------+-------------------+           |
|   | 机制              | 开销              | 说明              |           |
|   +-------------------+-------------------+-------------------+           |
|   | 自旋锁            | 低                | 直接修改          |           |
|   | 读写锁            | 低                | 直接修改          |           |
|   | RCU               | 高                | 复制+宽限期       |           |
|   +-------------------+-------------------+-------------------+           |
|                                                                           |
|   结论：RCU 将开销从读端转移到写端，适合读多写少场景                      |
|                                                                           |
+===========================================================================+
```

---

## 3. RCU 核心原理

### 3.1 读-复制-更新流程

```
RCU 完整流程：
+===========================================================================+
|                                                                           |
|   初始状态：                                                              |
|   +-------------------+                                                    |
|   | 共享指针 ptr ---->| 数据 A                                          |
|   +-------------------+                                                    |
|                                                                           |
|   步骤 1：读者读取数据                                                    |
|   +-------------------+                                                    |
|   | rcu_read_lock()   |  标记进入临界区                                 |
|   | data = rcu_dereference(ptr)  |  读取指针                             |
|   | 使用 data         |  访问数据 A                                     |
|   | rcu_read_unlock() |  标记离开临界区                                 |
|   +-------------------+                                                    |
|                                                                           |
|   步骤 2：写者更新数据                                                    |
|   +-------------------+                                                    |
|   | new_data = kmalloc() |  分配新内存                                   |
|   | *new_data = *data |  复制旧数据                                     |
|   | 修改 new_data     |  在副本上修改                                   |
|   | rcu_assign_pointer(ptr, new_data) |  原子替换指针                    |
|   +-------------------+                                                    |
|                                                                           |
|   步骤 3：等待宽限期                                                      |
|   +-------------------+                                                    |
|   | synchronize_rcu() |  等待所有读者完成                               |
|   | 或 call_rcu()     |  注册回调函数                                   |
|   +-------------------+                                                    |
|                                                                           |
|   步骤 4：释放旧数据                                                      |
|   +-------------------+                                                    |
|   | kfree(data)       |  安全释放旧数据                                 |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 3.2 关键概念

```
RCU 关键概念：
+===========================================================================+
|                                                                           |
|   1. 读端临界区（Read-Side Critical Section）                             |
|      +-------------------+                                                |
|      | rcu_read_lock() 和 rcu_read_unlock() 之间的代码                  |
|      | 读者在此区域内访问共享数据                                        |
|      | 不能睡眠！                                                        |
|      +-------------------+                                                |
|                                                                           |
|   2. 宽限期（Grace Period）                                               |
|      +-------------------+                                                |
|      | 从指针替换到所有旧读者完成的时间窗口                              |
|      | 宽限期结束后才能释放旧数据                                        |
|      +-------------------+                                                |
|                                                                           |
|   3. 静止态（Quiescent State）                                            |
|      +-------------------+                                                |
|      | CPU 不在 RCU 读端临界区的状态                                     |
|      | 如：上下文切换、用户态执行、空闲循环                              |
|      +-------------------+                                                |
|                                                                           |
|   4. RCU 回调（RCU Callback）                                             |
|      +-------------------+                                                |
|      | 宽限期结束后执行的函数                                            |
|      | 通常用于释放旧数据                                                |
|      +-------------------+                                                |
|                                                                           |
+===========================================================================+
```

### 3.3 内存可见性保障

```
RCU 内存可见性保障：
+===========================================================================+
|                                                                           |
|   写者保障：                                                              |
|   +-------------------+                                                    |
|   | rcu_assign_pointer() |                                               |
|   | - 包含内存屏障    |  smp_store_release()                            |
|   | - 确保数据初始化  |  在指针更新之前完成                            |
|   | - 对其他 CPU 可见 |                                                |
|   +-------------------+                                                    |
|                                                                           |
|   读者保障：                                                              |
|   +-------------------+                                                    |
|   | rcu_dereference() |                                                 |
|   | - 包含内存屏障    |  smp_load_acquire()（部分架构）                |
|   | - 确保读取到      |  完整初始化的数据                              |
|   | - 防止编译器优化  |                                                |
|   +-------------------+                                                    |
|                                                                           |
|   配对使用：                                                              |
|   +-------------------+                                                    |
|   | 写者：rcu_assign_pointer(ptr, new_data)                             |
|   | 读者：data = rcu_dereference(ptr)                                   |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 4. 宽限期机制

### 4.1 宽限期的定义

```
宽限期（Grace Period）定义：
+===========================================================================+
|                                                                           |
|   时间轴：                                                                |
|   |-------|-------|-------|-------|-------|-------|-------|              |
|   | 读者1 |       |       |       |       |       |       |              |
|   | 开始  |       | 结束  |       |       |       |       |              |
|   |-------|-------|-------|-------|-------|-------|-------|              |
|           | 读者2 |       |       | 读者2 |       |       |              |
|           | 开始  |       |       | 结束  |       |       |              |
|   |-------|-------|-------|-------|-------|-------|-------|              |
|                   | 写者  |       |       |       |       |              |
|                   | 替换  |       |       |       |       |              |
|                   | 指针  |       |       |       |       |              |
|   |-------|-------|-------|-------|-------|-------|-------|              |
|                           |       | 宽限期|       | 宽限期|              |
|                           |       | 开始  |       | 结束  |              |
|   |-------|-------|-------|-------|-------|-------|-------|              |
|                                                           | 安全  |      |
|                                                           | 释放  |      |
|                                                           | 旧数据|      |
|                                                                           |
|   宽限期 = 从指针替换到所有在替换前开始的读者完成                         |
|                                                                           |
+===========================================================================+
```

### 4.2 宽限期检测机制

```
宽限期检测机制：
+===========================================================================+
|                                                                           |
|   核心思想：检测所有 CPU 的静止态                                         |
|                                                                           |
|   静止态类型：                                                            |
|   +-------------------+                                                    |
|   | 1. 上下文切换    |  进程切换                                        |
|   | 2. 用户态执行    |  执行用户程序                                    |
|   | 3. 空闲循环      |  CPU 空闲                                        |
|   | 4. 用户空间      |  运行用户态代码                                  |
|   +-------------------+                                                    |
|                                                                           |
|   检测流程：                                                              |
|   +-------------------+                                                    |
|   | 1. 开始宽限期    |  记录当前状态                                    |
|   | 2. 等待每个 CPU  |  经历静止态                                      |
|   | 3. 所有 CPU 都   |  经历静止态                                      |
|   | 4. 宽限期结束    |  可以释放旧数据                                  |
|   +-------------------+                                                    |
|                                                                           |
|   为什么静止态意味着读者完成？                                            |
|   +-------------------+                                                    |
|   | - RCU 读端临界区不能睡眠                                            |
|   | - 上下文切换意味着离开临界区                                        |
|   | - 用户态执行意味着离开临界区                                        |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 4.3 synchronize_rcu 实现

```c
/**
 * synchronize_rcu - 等待宽限期结束
 *
 * 这个函数会阻塞，直到所有在调用前开始的 RCU 读端临界区都完成
 */
void synchronize_rcu(void)
{
    RCU_LOCKDEP_WARN(lock_is_held(&rcu_bh_lock_map) ||
                     lock_is_held(&rcu_lock_map) ||
                     lock_is_held(&rcu_sched_lock_map),
                     "Illegal synchronize_rcu() in RCU read-side critical section");

    if (rcu_blocking_is_gp())
        return;

    if (rcu_gp_is_expedited())
        synchronize_rcu_expedited();
    else
        wait_rcu_gp(call_rcu);
}
EXPORT_SYMBOL_GPL(synchronize_rcu);
```

### 4.4 call_rcu 实现

```c
/**
 * call_rcu - 注册宽限期结束后的回调函数
 * @head: rcu_head 结构指针
 * @func: 回调函数
 *
 * 这是异步版本，不会阻塞
 */
void call_rcu(struct rcu_head *head, rcu_callback_t func)
{
    __call_rcu(head, func);
}
EXPORT_SYMBOL_GPL(call_rcu);

/* 使用示例 */
struct my_data {
    int value;
    struct rcu_head rcu;  /* 必须包含 rcu_head */
};

/* 回调函数：释放旧数据 */
static void free_my_data(struct rcu_head *rcu)
{
    struct my_data *data = container_of(rcu, struct my_data, rcu);
    kfree(data);
}

/* 写者：更新数据 */
void update_my_data(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    /* 分配并初始化新数据 */
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    /* 原子替换指针 */
    old_data = rcu_dereference_protected(*ptr, 1);
    rcu_assign_pointer(*ptr, new_data);
    
    /* 注册回调，宽限期结束后释放旧数据 */
    if (old_data)
        call_rcu(&old_data->rcu, free_my_data);
}
```

---

## 5. RCU 核心 API

### 5.1 读端 API

```c
/**
 * rcu_read_lock - 标记读端临界区开始
 *
 * 关键点：
 * 1. 几乎无开销（非抢占 RCU 只是禁用抢占）
 * 2. 不阻塞其他读者或写者
 * 3. 临界区内不能睡眠！
 */
static __always_inline void rcu_read_lock(void)
{
    __rcu_read_lock();
    /* 
     * 非抢占 RCU: preempt_disable()
     * 抢占 RCU: 增加嵌套计数
     */
    __release(RCU);
}

/**
 * rcu_read_unlock - 标记读端临界区结束
 */
static inline void rcu_read_unlock(void)
{
    /* 检查是否在合法上下文 */
    RCU_LOCKDEP_WARN(!rcu_read_lock_held(),
                     "rcu_read_unlock() used illegally while idle");
    __release(RCU);
    __rcu_read_unlock();
    /* 
     * 非抢占 RCU: preempt_enable()
     * 抢占 RCU: 减少嵌套计数
     */
}
```

**使用示例**：

```c
/* 读操作：安全访问 RCU 保护的数据 */
int read_my_data(struct my_data **ptr)
{
    struct my_data *data;
    int value;
    
    /* 标记进入读端临界区 */
    rcu_read_lock();
    
    /* 安全读取指针 */
    data = rcu_dereference(*ptr);
    if (data) {
        value = data->value;
    } else {
        value = -1;
    }
    
    /* 标记离开读端临界区 */
    rcu_read_unlock();
    
    return value;
}
```

### 5.2 指针访问 API

```c
/**
 * rcu_dereference - 安全获取 RCU 保护的指针
 * @p: RCU 保护的指针
 *
 * 关键点：
 * 1. 包含内存屏障（部分架构）
 * 2. 防止编译器优化
 * 3. 确保读取到完整初始化的数据
 */
#define rcu_dereference(p) rcu_dereference_check(p, 0)

/* 实现细节 */
#define __rcu_dereference_check(p, c, space) \
({ \
    typeof(p) _________p1 = READ_ONCE(p); \
    RCU_LOCKDEP_WARN(!(c), "suspicious rcu_dereference_check() usage"); \
    smp_load_acquire(&_________p1); \
    ((typeof(*p) __force space *)_________p1); \
})

/**
 * rcu_assign_pointer - 原子更新 RCU 保护的指针
 * @p: 要更新的指针
 * @v: 新值
 *
 * 关键点：
 * 1. 包含内存屏障（smp_store_release）
 * 2. 确保数据初始化在指针更新之前完成
 * 3. 对其他 CPU 可见
 */
#define rcu_assign_pointer(p, v) \
do { \
    uintptr_t _r_a_p__v = (uintptr_t)(v); \
    \
    if (__builtin_constant_p(v) && (_r_a_p__v) == (uintptr_t)NULL) \
        WRITE_ONCE((p), (typeof(p))(_r_a_p__v)); \
    else \
        smp_store_release(&p, RCU_INITIALIZER((typeof(p))_r_a_p__v)); \
} while (0)
```

**使用示例**：

```c
/* 写操作：更新 RCU 保护的数据 */
void update_data(struct my_data **global_ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    /* 分配新数据 */
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    if (!new_data)
        return;
    
    /* 初始化新数据 */
    new_data->value = new_value;
    
    /* 获取旧指针（需要保护） */
    old_data = rcu_dereference_protected(*global_ptr, 1);
    
    /* 原子替换指针 */
    rcu_assign_pointer(*global_ptr, new_data);
    
    /* 等待宽限期后释放旧数据 */
    if (old_data) {
        synchronize_rcu();
        kfree(old_data);
    }
}
```

### 5.3 宽限期 API

```c
/**
 * synchronize_rcu - 同步等待宽限期结束
 *
 * 特点：
 * 1. 阻塞当前线程
 * 2. 等待所有在调用前开始的读端临界区完成
 * 3. 适用于不频繁的更新操作
 */
void synchronize_rcu(void);

/**
 * call_rcu - 异步等待宽限期结束
 * @head: rcu_head 结构指针
 * @func: 回调函数
 *
 * 特点：
 * 1. 不阻塞当前线程
 * 2. 注册回调函数
 * 3. 宽限期结束后自动调用回调
 * 4. 适用于频繁的更新操作
 */
void call_rcu(struct rcu_head *head, rcu_callback_t func);
```

**同步 vs 异步对比**：

```c
/* 同步方式：简单但可能阻塞 */
void update_sync(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    old_data = rcu_dereference_protected(*ptr, 1);
    rcu_assign_pointer(*ptr, new_data);
    
    /* 阻塞等待宽限期 */
    synchronize_rcu();
    
    if (old_data)
        kfree(old_data);
}

/* 异步方式：不阻塞但需要回调函数 */
static void free_callback(struct rcu_head *rcu)
{
    struct my_data *data = container_of(rcu, struct my_data, rcu);
    kfree(data);
}

void update_async(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    old_data = rcu_dereference_protected(*ptr, 1);
    rcu_assign_pointer(*ptr, new_data);
    
    /* 不阻塞，注册回调 */
    if (old_data)
        call_rcu(&old_data->rcu, free_callback);
}
```

---

## 6. RCU 链表操作

### 6.1 链表添加

```c
/**
 * list_add_rcu - 向 RCU 保护的链表添加元素
 * @new: 新元素
 * @head: 链表头
 *
 * 关键点：
 * 1. 使用 rcu_assign_pointer 更新指针
 * 2. 写者之间需要额外锁保护
 */
static inline void __list_add_rcu(struct list_head *new,
                                   struct list_head *prev,
                                   struct list_head *next)
{
    if (!__list_add_valid(new, prev, next))
        return;

    new->next = next;
    new->prev = prev;
    rcu_assign_pointer(list_next_rcu(prev), new);
    next->prev = new;
}

/* 使用示例 */
void add_device(struct device *new_dev)
{
    spin_lock(&device_lock);
    list_add_rcu(&new_dev->list, &device_list);
    spin_unlock(&device_lock);
}
```

### 6.2 链表删除

```c
/**
 * list_del_rcu - 从 RCU 保护的链表删除元素
 * @entry: 要删除的元素
 *
 * 关键点：
 * 1. 只从链表移除，不释放内存
 * 2. 需要等待宽限期后才能释放
 */
static inline void list_del_rcu(struct list_head *entry)
{
    __list_del_entry(entry);
    entry->prev = LIST_POISON2;  /* 标记已删除 */
}

/* 使用示例 */
void remove_device(struct device *dev)
{
    struct device *old_dev;
    
    spin_lock(&device_lock);
    list_del_rcu(&dev->list);
    spin_unlock(&device_lock);
    
    /* 等待宽限期后释放 */
    call_rcu(&dev->rcu, free_device);
}
```

### 6.3 链表遍历

```c
/**
 * list_for_each_entry_rcu - 遍历 RCU 保护的链表
 * @pos: 循环变量
 * @head: 链表头
 * @member: 成员名
 *
 * 关键点：
 * 1. 必须在 RCU 读端临界区内
 * 2. 使用 rcu_dereference 获取指针
 */
#define list_for_each_entry_rcu(pos, head, member) \
    for (pos = list_entry_rcu((head)->next, typeof(*pos), member); \
         &pos->member != (head); \
         pos = list_entry_rcu(pos->member.next, typeof(*pos), member))

/* 使用示例 */
struct device *find_device(int id)
{
    struct device *dev;
    
    rcu_read_lock();
    list_for_each_entry_rcu(dev, &device_list, list) {
        if (dev->id == id) {
            rcu_read_unlock();
            return dev;  /* 注意：返回后不能再访问！ */
        }
    }
    rcu_read_unlock();
    
    return NULL;
}
```

### 6.4 完整链表示例

```c
#include <linux/rculist.h>
#include <linux/slab.h>
#include <linux/spinlock.h>

struct device {
    int id;
    char name[32];
    struct list_head list;
    struct rcu_head rcu;
};

static LIST_HEAD(device_list);
static DEFINE_SPINLOCK(device_lock);

/* 查找设备（读操作） */
struct device *device_find(int id)
{
    struct device *dev;
    
    rcu_read_lock();
    list_for_each_entry_rcu(dev, &device_list, list) {
        if (dev->id == id) {
            /* 找到设备，增加引用计数 */
            if (kref_get_unless_zero(&dev->refcnt)) {
                rcu_read_unlock();
                return dev;
            }
        }
    }
    rcu_read_unlock();
    
    return NULL;
}

/* 添加设备（写操作） */
int device_add(int id, const char *name)
{
    struct device *new_dev;
    
    new_dev = kmalloc(sizeof(*new_dev), GFP_KERNEL);
    if (!new_dev)
        return -ENOMEM;
    
    new_dev->id = id;
    strncpy(new_dev->name, name, sizeof(new_dev->name) - 1);
    INIT_LIST_HEAD(&new_dev->list);
    
    spin_lock(&device_lock);
    list_add_rcu(&new_dev->list, &device_list);
    spin_unlock(&device_lock);
    
    return 0;
}

/* 删除设备（写操作） */
static void free_device(struct rcu_head *rcu)
{
    struct device *dev = container_of(rcu, struct device, rcu);
    kfree(dev);
}

int device_remove(int id)
{
    struct device *dev;
    
    spin_lock(&device_lock);
    list_for_each_entry_rcu(dev, &device_list, list) {
        if (dev->id == id) {
            list_del_rcu(&dev->list);
            spin_unlock(&device_lock);
            
            /* 异步等待宽限期后释放 */
            call_rcu(&dev->rcu, free_device);
            return 0;
        }
    }
    spin_unlock(&device_lock);
    
    return -ENOENT;
}
```

---

## 7. RCU 实现机制

### 7.1 数据结构

```c
/* RCU 回调头 */
struct rcu_head {
    struct rcu_head *next;
    void (*func)(struct rcu_head *head);
};

/* RCU 节点（用于宽限期检测） */
struct rcu_node {
    raw_spinlock_t lock;            /* 保护本节点的锁 */
    unsigned long gp_seq;           /* 宽限期序列号 */
    unsigned long gp_seq_needed;    /* 需要的宽限期序列号 */
    unsigned long qsmask;           /* 静止态位掩码 */
    unsigned long expmask;          /* 加速宽限期位掩码 */
    /* ... */
};

/* RCU 状态（per-CPU） */
struct rcu_data {
    unsigned long gp_seq;           /* 当前宽限期序列号 */
    unsigned long gp_seq_needed;    /* 需要的宽限期序列号 */
    unsigned long gpwrap;           /* 序列号回绕标志 */
    
    /* 回调链表 */
    struct rcu_segcblist cblist;    /* 分段回调链表 */
    
    /* 静止态相关 */
    bool beenonline;                /* 曾经在线 */
    bool gpwrap;                    /* 宽限期回绕 */
    unsigned long rcu_qs_ctr_snap;  /* 静止态计数快照 */
    /* ... */
};
```

### 7.2 宽限期检测流程

```
宽限期检测流程：
+===========================================================================+
|                                                                           |
|   1. 开始宽限期                                                           |
|      +-------------------+                                                |
|      | 初始化 RCU 节点  |  设置 qsmask                                    |
|      | 记录开始时间      |                                                |
|      +-------------------+                                                |
|                                                                           |
|   2. 检测静止态                                                           |
|      +-------------------+                                                |
|      | 每个 CPU 报告    |  静止态                                         |
|      | 清除 qsmask 位   |                                                |
|      +-------------------+                                                |
|                                                                           |
|   3. 宽限期完成                                                           |
|      +-------------------+                                                |
|      | 所有位清除        |  所有 CPU 都经历静止态                         |
|      | 执行回调函数      |  释放旧数据                                    |
|      +-------------------+                                                |
|                                                                           |
|   4. 开始下一个宽限期                                                     |
|      +-------------------+                                                |
|      | 增加序列号        |                                                |
|      | 重复上述流程      |                                                |
|      +-------------------+                                                |
|                                                                           |
+===========================================================================+
```

### 7.3 抢占式 RCU vs 非抢占式 RCU

```
非抢占式 RCU（Classic RCU）：
+===========================================================================+
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 读端临界区禁用抢占|  preempt_disable()                               |
|   | 不能在临界区睡眠  |                                                |
|   | 宽限期检测简单    |  上下文切换 = 离开临界区                        |
|   +-------------------+                                                    |
|                                                                           |
|   实现：                                                                  |
|   static inline void __rcu_read_lock(void)                                |
|   {                                                                       |
|       preempt_disable();                                                  |
|   }                                                                       |
|                                                                           |
|   static inline void __rcu_read_unlock(void)                              |
|   {                                                                       |
|       preempt_enable();                                                   |
|   }                                                                       |
|                                                                           |
+===========================================================================+

抢占式 RCU（Preemptible RCU）：
+===========================================================================+
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 读端临界区可抢占  |  允许高优先级任务抢占                            |
|   | 可以在临界区睡眠  |  更灵活                                          |
|   | 宽限期检测复杂    |  需要跟踪嵌套计数                                |
|   +-------------------+                                                    |
|                                                                           |
|   实现：                                                                  |
|   void __rcu_read_lock(void)                                              |
|   {                                                                       |
|       current->rcu_read_lock_nesting++;                                   |
|       barrier();                                                          |
|   }                                                                       |
|                                                                           |
|   void __rcu_read_unlock(void)                                            |
|   {                                                                       |
|       if (--current->rcu_read_lock_nesting == 0)                          |
|           __rcu_read_unlock_special();                                    |
|   }                                                                       |
|                                                                           |
+===========================================================================+
```

---

## 8. RCU 变体

### 8.1 RCU 变体概览

```
RCU 变体：
+===========================================================================+
|                                                                           |
|   1. Classic RCU（经典 RCU）                                              |
|      +-------------------+                                                |
|      | 用途：通用场景    |                                                |
|      | 特点：读端禁用抢占|                                                |
|      +-------------------+                                                |
|                                                                           |
|   2. RCU-bh（Bottom Half RCU）                                            |
|      +-------------------+                                                |
|      | 用途：网络子系统  |                                                |
|      | 特点：禁用软中断  |                                                |
|      +-------------------+                                                |
|                                                                           |
|   3. RCU-sched（调度 RCU）                                                |
|      +-------------------+                                                |
|      | 用途：调度器      |                                                |
|      | 特点：禁用抢占    |                                                |
|      +-------------------+                                                |
|                                                                           |
|   4. SRCU（Sleepable RCU）                                                |
|      +-------------------+                                                |
|      | 用途：可睡眠场景  |                                                |
|      | 特点：允许睡眠    |                                                |
|      +-------------------+                                                |
|                                                                           |
|   5. Tasks RCU                                                            |
|      +-------------------+                                                |
|      | 用途：跟踪任务    |                                                |
|      | 特点：等待任务切换|                                                |
|      +-------------------+                                                |
|                                                                           |
+===========================================================================+
```

### 8.2 RCU-bh

```c
/**
 * RCU-bh：用于网络子系统
 * 
 * 特点：
 * 1. 读端禁用软中断
 * 2. 防止网络流量导致的饥饿
 */

/* 读端 API */
static inline void rcu_read_lock_bh(void)
{
    local_bh_disable();  /* 禁用软中断 */
}

static inline void rcu_read_unlock_bh(void)
{
    local_bh_enable();   /* 启用软中断 */
}

/* 使用示例 */
void process_skb(struct sk_buff *skb)
{
    rcu_read_lock_bh();
    /* 处理网络数据包 */
    rcu_read_unlock_bh();
}
```

### 8.3 SRCU（Sleepable RCU）

```c
/**
 * SRCU：允许在读端临界区睡眠
 * 
 * 特点：
 * 1. 读端可以睡眠
 * 2. 需要定义 SRCU 结构
 * 3. 宽限期检测更复杂
 */

/* 定义 SRCU 结构 */
DEFINE_SRCU(my_srcu);

/* 读端 API */
int srcu_read_lock(struct srcu_struct *sp);
void srcu_read_unlock(struct srcu_struct *sp, int idx);

/* 使用示例 */
void srcu_read_example(void)
{
    int idx;
    
    idx = srcu_read_lock(&my_srcu);
    
    /* 可以睡眠！ */
    msleep(100);
    
    srcu_read_unlock(&my_srcu, idx);
}

/* 写端 API */
void synchronize_srcu(struct srcu_struct *sp);
void call_srcu(struct srcu_struct *sp, struct rcu_head *head,
               void (*func)(struct rcu_head *head));
```

---

## 9. RCU 使用场景

### 9.1 网络子系统

```c
/* 网络设备查找 */
struct net_device *dev_get_by_name(struct net *net, const char *name)
{
    struct net_device *dev;
    
    rcu_read_lock();
    for_each_netdev_rcu(net, dev) {
        if (strcmp(dev->name, name) == 0) {
            dev_hold(dev);  /* 增加引用计数 */
            rcu_read_unlock();
            return dev;
        }
    }
    rcu_read_unlock();
    
    return NULL;
}

/* 路由表查找 */
struct rtable *ip_route_output_key(struct net *net, struct flowi4 *flp)
{
    struct rtable *rth;
    
    rcu_read_lock();
    rth = __ip_route_output_key(net, flp);
    rcu_read_unlock();
    
    return rth;
}
```

### 9.2 进程管理

```c
/* 查找进程描述符 */
struct task_struct *find_task_by_pid_ns(pid_t nr, struct pid_namespace *ns)
{
    struct task_struct *task;
    
    rcu_read_lock();
    task = pid_task(find_pid_ns(nr, ns), PIDTYPE_PID);
    if (task)
        get_task_struct(task);
    rcu_read_unlock();
    
    return task;
}

/* 遍历所有进程 */
void for_each_process(void (*fn)(struct task_struct *))
{
    struct task_struct *p;
    
    rcu_read_lock();
    for_each_process_rcu(p) {
        fn(p);
    }
    rcu_read_unlock();
}
```

### 9.3 文件系统

```c
/* 目录项缓存查找 */
struct dentry *d_lookup(const struct dentry *parent, const struct qstr *name)
{
    struct dentry *dentry;
    
    rcu_read_lock();
    dentry = __d_lookup_rcu(parent, name);
    if (dentry) {
        if (!lockref_get_not_dead(&dentry->d_lockref))
            dentry = NULL;
    }
    rcu_read_unlock();
    
    return dentry;
}

/* inode 查找 */
struct inode *find_inode(struct super_block *sb, unsigned long ino)
{
    struct inode *inode;
    
    rcu_read_lock();
    inode = ilookup_rcu(sb, ino);
    if (inode && !atomic_inc_not_zero(&inode->i_count))
        inode = NULL;
    rcu_read_unlock();
    
    return inode;
}
```

---

## 10. RCU 使用注意事项

### 10.1 读端临界区不能睡眠

```c
/* 错误示例：在 RCU 读端临界区睡眠 */
void bad_example(void)
{
    rcu_read_lock();
    
    /* 错误！不能睡眠 */
    msleep(100);  /* 会导致内核警告或崩溃 */
    
    /* 错误！不能睡眠 */
    wait_event(wq, condition);  /* 会导致内核警告或崩溃 */
    
    rcu_read_unlock();
}

/* 正确示例：不在临界区睡眠 */
void good_example(void)
{
    struct my_data *data;
    int value;
    
    rcu_read_lock();
    data = rcu_dereference(global_ptr);
    if (data)
        value = data->value;  /* 只读取，不睡眠 */
    rcu_read_unlock();
    
    /* 在临界区外睡眠 */
    if (need_sleep)
        msleep(100);
}
```

### 10.2 必须使用 RCU 回调释放内存

```c
/* 错误示例：直接释放内存 */
void bad_update(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    old_data = rcu_dereference_protected(*ptr, 1);
    rcu_assign_pointer(*ptr, new_data);
    
    /* 错误！可能还有读者在访问 */
    kfree(old_data);  /* 可能导致崩溃！ */
}

/* 正确示例：使用 RCU 回调 */
static void free_callback(struct rcu_head *rcu)
{
    struct my_data *data = container_of(rcu, struct my_data, rcu);
    kfree(data);
}

void good_update(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    old_data = rcu_dereference_protected(*ptr, 1);
    rcu_assign_pointer(*ptr, new_data);
    
    /* 正确：等待宽限期后释放 */
    if (old_data)
        call_rcu(&old_data->rcu, free_callback);
}
```

### 10.3 写者之间需要额外锁

```c
/* 错误示例：多个写者并发修改 */
void bad_concurrent_update(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    /* 错误！多个写者可能同时修改 */
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    old_data = rcu_dereference_protected(*ptr, 1);
    rcu_assign_pointer(*ptr, new_data);
    
    if (old_data)
        call_rcu(&old_data->rcu, free_callback);
}

/* 正确示例：使用锁保护写者 */
static DEFINE_MUTEX(update_lock);

void good_concurrent_update(struct my_data **ptr, int new_value)
{
    struct my_data *new_data, *old_data;
    
    new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->value = new_value;
    
    mutex_lock(&update_lock);  /* 保护写者 */
    old_data = rcu_dereference_protected(*ptr, lockdep_is_held(&update_lock));
    rcu_assign_pointer(*ptr, new_data);
    mutex_unlock(&update_lock);
    
    if (old_data)
        call_rcu(&old_data->rcu, free_callback);
}
```

### 10.4 注意返回指针的生命周期

```c
/* 错误示例：在临界区外使用指针 */
struct my_data *bad_find(int id)
{
    struct my_data *data;
    
    rcu_read_lock();
    data = rcu_dereference(global_ptr);
    if (data && data->id == id) {
        rcu_read_unlock();
        return data;  /* 错误！可能已被释放 */
    }
    rcu_read_unlock();
    
    return NULL;
}

/* 正确示例：在临界区内完成操作 */
int good_find_and_read(int id)
{
    struct my_data *data;
    int value = -1;
    
    rcu_read_lock();
    data = rcu_dereference(global_ptr);
    if (data && data->id == id) {
        value = data->value;  /* 在临界区内读取 */
    }
    rcu_read_unlock();
    
    return value;  /* 返回值，而不是指针 */
}

/* 或者：增加引用计数 */
struct my_data *good_find_with_ref(int id)
{
    struct my_data *data;
    
    rcu_read_lock();
    data = rcu_dereference(global_ptr);
    if (data && data->id == id) {
        if (kref_get_unless_zero(&data->refcnt)) {
            rcu_read_unlock();
            return data;  /* 增加了引用计数，安全 */
        }
    }
    rcu_read_unlock();
    
    return NULL;
}
```

### 10.5 性能优化建议

```
RCU 性能优化建议：
+===========================================================================+
|                                                                           |
|   1. 选择合适的宽限期等待方式                                             |
|      +-------------------+                                                |
|      | synchronize_rcu  |  简单，但阻塞                                  |
|      | call_rcu         |  复杂，但不阻塞                                |
|      +-------------------+                                                |
|                                                                           |
|   2. 批量更新                                                             |
|      +-------------------+                                                |
|      | 合并多个更新      |  减少宽限期数量                                |
|      | 使用回调链        |                                                |
|      +-------------------+                                                |
|                                                                           |
|   3. 减小读端临界区                                                       |
|      +-------------------+                                                |
|      | 只包含必要操作    |                                                |
|      | 尽快退出临界区    |                                                |
|      +-------------------+                                                |
|                                                                           |
|   4. 使用加速宽限期                                                       |
|      +-------------------+                                                |
|      | synchronize_rcu_expedited |  快速但开销大                          |
|      | 适用于紧急场景    |                                                |
|      +-------------------+                                                |
|                                                                           |
+===========================================================================+
```

---

## 总结

### 核心要点

1. **RCU 本质**：读-复制-更新机制，实现读操作几乎无开销的并发控制。

2. **核心原理**：
   - 读操作：无锁、无阻塞
   - 写操作：复制-修改-替换-延迟释放
   - 宽限期：确保所有读者完成后再释放旧数据

3. **关键 API**：
   - 读端：rcu_read_lock() / rcu_read_unlock()
   - 指针访问：rcu_dereference() / rcu_assign_pointer()
   - 宽限期：synchronize_rcu() / call_rcu()

4. **适用场景**：读多写少的高并发场景

5. **注意事项**：
   - 读端临界区不能睡眠
   - 必须使用 RCU 回调释放内存
   - 写者之间需要额外锁保护

### 关键代码位置

| 功能 | 文件 |
|------|------|
| RCU 核心 API | **`include/linux/rcupdate.h`** |
| RCU 链表操作 | **`include/linux/rculist.h`** |
| Tree RCU 实现 | **`kernel/rcu/tree.c`** |
| RCU 更新 | **`kernel/rcu/update.c`** |
