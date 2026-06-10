# Linux 5.15 等待队列与休眠机制详解

## 目录
1. **`引言：为什么需要等待队列`**
2. **`等待队列的数据结构`**
3. **`等待队列的初始化`**
4. **`进程休眠机制`**
5. **`进程唤醒机制`**
6. **`wait_event系列宏详解`**
7. **`wake_up系列函数详解`**
8. **`高级API与使用场景`**
9. **`完整使用示例`**
10. **`常见问题与注意事项`**

---

## 一、引言：为什么需要等待队列

### 1.1 问题：忙等待的弊端

想象这样一个场景：你的程序需要等待一个按键按下，最简单的方法是什么？

```c
// 忙等待（Busy Waiting）- 错误示范！
while (key_pressed == 0) {
    // 不断检查按键状态
}
// 按键按下，继续执行
```

**这种方法有什么问题？**

```
┌─────────────────────────────────────────────────────────────┐
│                    忙等待的问题                              │
├─────────────────────────────────────────────────────────────┤
│  1. CPU空转：进程一直占用CPU，不断检查条件                    │
│  2. 资源浪费：本可以用来执行其他任务的CPU时间被浪费           │
│  3. 系统变慢：其他进程得不到CPU时间                          │
│  4. 功耗增加：CPU一直处于忙碌状态                            │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 解决方案：等待队列

**等待队列的核心思想**：当进程需要等待某个事件时，不要忙等待，而是：
1. 将自己加入等待队列
2. 主动放弃CPU，进入休眠状态
3. 当事件发生时，被其他进程/中断唤醒
4. 继续执行

```
┌─────────────────────────────────────────────────────────────┐
│                    等待队列的工作方式                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   进程A（等待者）              进程B（唤醒者）               │
│        │                           │                        │
│        ▼                           │                        │
│   检查条件（不满足）              │                        │
│        │                           │                        │
│        ▼                           │                        │
│   加入等待队列 ──────────────────► │                        │
│        │                           │                        │
│        ▼                           │                        │
│   休眠（让出CPU）                 │                        │
│        │                           │                        │
│        │                           ▼                        │
│        │                     事件发生                       │
│        │                           │                        │
│        │                           ▼                        │
│        │                     唤醒等待队列                   │
│        │                           │                        │
│        ▼                           │                        │
│   被唤醒，继续执行 ◄───────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 等待队列的应用场景

| 场景 | 说明 | 示例 |
|------|------|------|
| 阻塞I/O | 等待设备数据就绪 | read()等待磁盘数据 |
| 进程同步 | 等待共享资源可用 | 信号量、互斥锁 |
| 中断处理 | 等待硬件事件 | 按键、网络包 |
| 定时等待 | 等待超时 | sleep()、poll() |
| 事件通知 | 等待特定事件 | 内核事件、完成量 |

---

## 二、等待队列的数据结构

### 2.1 核心结构体

等待队列由两个核心结构组成：

#### 等待队列头（wait_queue_head_t）

定义在 **`include/linux/wait.h`**：

```c
struct wait_queue_head {
    spinlock_t      lock;    // 自旋锁，保护队列操作
    struct list_head head;   // 链表头，链接所有等待项
};

typedef struct wait_queue_head wait_queue_head_t;
```

**为什么需要自旋锁？**
- 多个进程可能同时操作等待队列（加入/移除）
- 中断处理函数也可能操作等待队列
- 自旋锁保证操作的原子性

#### 等待队列项（wait_queue_entry_t）

定义在 **`include/linux/wait.h`**：

```c
struct wait_queue_entry {
    unsigned int        flags;      // 标志位（互斥/非互斥）
    void               *private;    // 指向task_struct（等待的进程）
    wait_queue_func_t   func;       // 唤醒函数
    struct list_head    entry;      // 链表节点
};

typedef struct wait_queue_entry wait_queue_entry_t;
```

**各字段详解**：

| 字段 | 类型 | 说明 |
|------|------|------|
| flags | unsigned int | WQ_FLAG_EXCLUSIVE表示互斥等待 |
| private | void* | 指向等待进程的task_struct |
| func | 函数指针 | 唤醒时调用的函数 |
| entry | list_head | 用于链接到等待队列 |

### 2.2 等待队列标志位

定义在 **`include/linux/wait.h`**：

```c
#define WQ_FLAG_EXCLUSIVE   0x01    // 互斥等待
#define WQ_FLAG_WOKEN       0x02    // 已被唤醒
#define WQ_FLAG_BOOKMARK    0x04    // 书签（用于分段遍历）
#define WQ_FLAG_CUSTOM      0x08    // 自定义标志
#define WQ_FLAG_DONE        0x10    // 已完成
#define WQ_FLAG_PRIORITY    0x20    // 优先级等待
```

**WQ_FLAG_EXCLUSIVE的作用**：

```
┌─────────────────────────────────────────────────────────────┐
│                    互斥等待 vs 非互斥等待                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  非互斥等待（flags = 0）：                                   │
│    - 多个进程可以同时被唤醒                                  │
│    - 适用于：广播式唤醒                                      │
│                                                             │
│  互斥等待（flags = WQ_FLAG_EXCLUSIVE）：                     │
│    - 只唤醒一个进程                                          │
│    - 避免"惊群效应"（thundering herd）                       │
│    - 适用于：资源竞争场景                                    │
│                                                             │
│  示例：多个进程等待同一个锁                                  │
│    - 非互斥：所有进程被唤醒，都去抢锁（浪费）                │
│    - 互斥：只唤醒一个进程，获得锁后执行（高效）              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 唤醒函数类型

```c
typedef int (*wait_queue_func_t)(struct wait_queue_entry *wq_entry, 
                                  unsigned mode, int flags, void *key);
```

**默认唤醒函数** `default_wake_function`：

定义在 **`kernel/sched/core.c`**：

```c
int default_wake_function(wait_queue_entry_t *curr, unsigned mode, 
                          int wake_flags, void *key)
{
    WARN_ON_ONCE(IS_ENABLED(CONFIG_SCHED_DEBUG) && wake_flags & ~WF_SYNC);
    return try_to_wake_up(curr->private, mode, wake_flags);
}
```

### 2.4 数据结构关系图

```
┌─────────────────────────────────────────────────────────────┐
│                   wait_queue_head                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  spinlock_t lock                                     │   │
│  │  struct list_head head ─────┐                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
         ┌──────────────────────────────────────────┐
         │         wait_queue_entry (进程A)         │
         │  flags: 0 (非互斥)                       │
         │  private: → task_struct_A               │
         │  func: default_wake_function            │
         │  entry: → next                          │
         └──────────────────────────────────────────┘
                                │
                                ▼
         ┌──────────────────────────────────────────┐
         │         wait_queue_entry (进程B)         │
         │  flags: WQ_FLAG_EXCLUSIVE (互斥)         │
         │  private: → task_struct_B               │
         │  func: default_wake_function            │
         │  entry: → next                          │
         └──────────────────────────────────────────┘
                                │
                                ▼
                            (更多等待项...)
```

---

## 三、等待队列的初始化

### 3.1 静态初始化

使用宏 `DECLARE_WAIT_QUEUE_HEAD`：

定义在 **`include/linux/wait.h`**：

```c
#define __WAIT_QUEUE_HEAD_INITIALIZER(name) {                   \
    .lock   = __SPIN_LOCK_UNLOCKED(name.lock),                  \
    .head   = LIST_HEAD_INIT(name.head) }

#define DECLARE_WAIT_QUEUE_HEAD(name) \
    struct wait_queue_head name = __WAIT_QUEUE_HEAD_INITIALIZER(name)
```

**使用示例**：

```c
// 定义并初始化一个全局等待队列
static DECLARE_WAIT_QUEUE_HEAD(my_wait_queue);

// 这等价于：
static struct wait_queue_head my_wait_queue = {
    .lock = __SPIN_LOCK_UNLOCKED(my_wait_queue.lock),
    .head = LIST_HEAD_INIT(my_wait_queue.head)
};
```

### 3.2 动态初始化

使用函数 `init_waitqueue_head`：

定义在 **`include/linux/wait.h`**：

```c
extern void __init_waitqueue_head(struct wait_queue_head *wq_head, 
                                   const char *name, 
                                   struct lock_class_key *);

#define init_waitqueue_head(wq_head)                            \
    do {                                                        \
        static struct lock_class_key __key;                     \
        __init_waitqueue_head((wq_head), #wq_head, &__key);     \
    } while (0)
```

**内核实现** 定义在 **`kernel/sched/wait.c`**：

```c
void __init_waitqueue_head(struct wait_queue_head *wq_head, 
                            const char *name, 
                            struct lock_class_key *key)
{
    spin_lock_init(&wq_head->lock);
    lockdep_set_class_and_name(&wq_head->lock, key, name);
    INIT_LIST_HEAD(&wq_head->head);
}
```

**使用示例**：

```c
// 在结构体中嵌入等待队列
struct my_device {
    int data_ready;
    wait_queue_head_t wait_queue;  // 嵌入等待队列
};

// 初始化
struct my_device *dev = kmalloc(sizeof(*dev), GFP_KERNEL);
init_waitqueue_head(&dev->wait_queue);
```

### 3.3 等待队列项的初始化

#### 方法1：init_waitqueue_entry

定义在 **`include/linux/wait.h`**：

```c
static inline void init_waitqueue_entry(struct wait_queue_entry *wq_entry, 
                                         struct task_struct *p)
{
    wq_entry->flags     = 0;
    wq_entry->private   = p;                      // 绑定进程
    wq_entry->func      = default_wake_function;  // 默认唤醒函数
}
```

**使用示例**：

```c
wait_queue_entry_t wait;
init_waitqueue_entry(&wait, current);  // 绑定当前进程
```

#### 方法2：DEFINE_WAIT宏

```c
#define DEFINE_WAIT(name) \
    struct wait_queue_entry name = __WAITQUEUE_INITIALIZER(name, current)

// 使用
DEFINE_WAIT(wait);  // 定义并初始化，自动绑定当前进程
```

#### 方法3：init_wait_entry（内核内部使用）

定义在 **`kernel/sched/wait.c`**：

```c
void init_wait_entry(struct wait_queue_entry *wq_entry, int flags)
{
    wq_entry->flags = flags;
    wq_entry->private = current;
    wq_entry->func = autoremove_wake_function;  // 自动移除的唤醒函数
    INIT_LIST_HEAD(&wq_entry->entry);
}
```

---

## 四、进程休眠机制

### 4.1 进程休眠状态

Linux内核定义了多种进程状态：

```c
#define TASK_RUNNING            0x0000  // 运行或就绪
#define TASK_INTERRUPTIBLE      0x0001  // 可中断睡眠
#define TASK_UNINTERRUPTIBLE    0x0002  // 不可中断睡眠
#define __TASK_STOPPED          0x0004  // 停止
#define __TASK_TRACED           0x0008  // 被跟踪
#define TASK_KILLABLE           0x0010  // 可被杀死
```

**三种睡眠状态对比**：

| 状态 | 说明 | 可被信号唤醒 | 使用场景 |
|------|------|--------------|----------|
| TASK_INTERRUPTIBLE | 可中断睡眠 | 是 | 大多数阻塞操作 |
| TASK_UNINTERRUPTIBLE | 不可中断睡眠 | 否 | 关键I/O操作 |
| TASK_KILLABLE | 可杀死睡眠 | 仅SIGKILL | 需要强制终止的场景 |

```
┌─────────────────────────────────────────────────────────────┐
│                    进程状态转换图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     ┌─────────────┐                         │
│                     │ TASK_RUNNING │                        │
│                     │  (运行/就绪)  │                        │
│                     └──────┬──────┘                         │
│                            │                                │
│              ┌─────────────┼─────────────┐                  │
│              │             │             │                  │
│              ▼             ▼             ▼                  │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│   │INTERRUPTIBLE │ │UNINTERRUPTIBLE│ │  KILLABLE   │       │
│   │  (可中断)    │ │  (不可中断)   │ │ (可杀死)    │       │
│   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘       │
│          │                │                │               │
│          │ 信号/唤醒      │ 唤醒           │ SIGKILL/唤醒  │
│          │                │                │               │
│          └────────────────┴────────────────┘               │
│                            │                                │
│                            ▼                                │
│                     ┌─────────────┐                         │
│                     │ TASK_RUNNING │                        │
│                     └─────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 手动休眠步骤

完整的休眠流程需要以下步骤：

```c
// 步骤1：定义并初始化等待队列头
DECLARE_WAIT_QUEUE_HEAD(my_wq);

// 步骤2：定义等待队列项
DEFINE_WAIT(wait);

// 步骤3：准备休眠
prepare_to_wait(&my_wq, &wait, TASK_INTERRUPTIBLE);

// 步骤4：检查条件（必须在schedule之前！）
if (condition) {
    finish_wait(&my_wq, &wait);
    return;  // 条件满足，不需要休眠
}

// 步骤5：调度（放弃CPU）
schedule();

// 步骤6：清理
finish_wait(&my_wq, &wait);
```

### 4.3 prepare_to_wait函数

定义在 **`kernel/sched/wait.c`**：

```c
void prepare_to_wait(struct wait_queue_head *wq_head, 
                      struct wait_queue_entry *wq_entry, int state)
{
    unsigned long flags;

    wq_entry->flags &= ~WQ_FLAG_EXCLUSIVE;  // 设置为非互斥
    spin_lock_irqsave(&wq_head->lock, flags);
    
    // 如果还没加入队列，则加入
    if (list_empty(&wq_entry->entry))
        __add_wait_queue(wq_head, wq_entry);
    
    // 设置进程状态
    set_current_state(state);
    
    spin_unlock_irqrestore(&wq_head->lock, flags);
}
```

**关键点**：
1. 清除互斥标志
2. 将等待项加入队列（如果还没加入）
3. 设置进程状态为睡眠状态

### 4.4 prepare_to_wait_event函数

定义在 **`kernel/sched/wait.c`**：

```c
long prepare_to_wait_event(struct wait_queue_head *wq_head, 
                            struct wait_queue_entry *wq_entry, int state)
{
    unsigned long flags;
    long ret = 0;

    spin_lock_irqsave(&wq_head->lock, flags);
    
    // 检查是否有待处理的信号
    if (signal_pending_state(state, current)) {
        list_del_init(&wq_entry->entry);  // 从队列移除
        ret = -ERESTARTSYS;               // 返回错误码
    } else {
        // 加入队列
        if (list_empty(&wq_entry->entry)) {
            if (wq_entry->flags & WQ_FLAG_EXCLUSIVE)
                __add_wait_queue_entry_tail(wq_head, wq_entry);
            else
                __add_wait_queue(wq_head, wq_entry);
        }
        set_current_state(state);
    }
    
    spin_unlock_irqrestore(&wq_head->lock, flags);
    return ret;
}
```

**与prepare_to_wait的区别**：
- 会检查待处理信号
- 如果有信号，返回-ERESTARTSYS
- 支持互斥等待

### 4.5 finish_wait函数

定义在 **`kernel/sched/wait.c`**：

```c
void finish_wait(struct wait_queue_head *wq_head, 
                  struct wait_queue_entry *wq_entry)
{
    unsigned long flags;

    // 恢复为运行状态
    __set_current_state(TASK_RUNNING);
    
    // 从等待队列移除
    if (!list_empty_careful(&wq_entry->entry)) {
        spin_lock_irqsave(&wq_head->lock, flags);
        list_del_init(&wq_entry->entry);
        spin_unlock_irqrestore(&wq_head->lock, flags);
    }
}
```

### 4.6 schedule函数

`schedule()` 是进程调度的核心函数，它会：
1. 将当前进程从运行队列移除
2. 选择下一个可运行的进程
3. 执行上下文切换

```c
// 简化的调用流程
schedule();
    │
    ▼
__schedule(false);
    │
    ├─► pick_next_task()     // 选择下一个进程
    │
    └─► context_switch()     // 上下文切换
            │
            ├─► switch_mm()   // 切换内存空间
            │
            └─► switch_to()   // 切换CPU上下文
```

---

## 五、进程唤醒机制

### 5.1 唤醒的核心：try_to_wake_up

定义在 **`kernel/sched/core.c`**：

```c
/**
 * try_to_wake_up - 唤醒一个线程
 * @p: 要唤醒的线程
 * @state: 可以被唤醒的状态掩码
 * @wake_flags: 唤醒标志
 *
 * 概念上执行：
 *   如果 (@state & @p->state) @p->state = TASK_RUNNING
 *
 * 如果任务不在运行队列中，将其放回运行队列
 */
static int try_to_wake_up(struct task_struct *p, unsigned int state, 
                           int wake_flags)
{
    unsigned long flags;
    int cpu, success = 0;

    preempt_disable();
    
    // 特殊情况：唤醒自己
    if (p == current) {
        if (!ttwu_state_match(p, state, &success))
            goto out;
        WRITE_ONCE(p->__state, TASK_RUNNING);
        goto out;
    }

    // 获取pi_lock
    raw_spin_lock_irqsave(&p->pi_lock, flags);
    smp_mb__after_spinlock();
    
    // 检查状态是否匹配
    if (!ttwu_state_match(p, state, &success))
        goto unlock;

    // ... 将进程加入运行队列 ...

    raw_spin_unlock_irqrestore(&p->pi_lock, flags);
out:
    preempt_enable();
    return success;
}
```

### 5.2 __wake_up_common函数

定义在 **`kernel/sched/wait.c`**：

```c
static int __wake_up_common(struct wait_queue_head *wq_head, unsigned int mode,
                             int nr_exclusive, int wake_flags, void *key,
                             wait_queue_entry_t *bookmark)
{
    wait_queue_entry_t *curr, *next;
    int cnt = 0;

    lockdep_assert_held(&wq_head->lock);

    // 从链表头部开始遍历
    curr = list_first_entry(&wq_head->head, wait_queue_entry_t, entry);

    list_for_each_entry_safe_from(curr, next, &wq_head->head, entry) {
        unsigned flags = curr->flags;
        int ret;

        if (flags & WQ_FLAG_BOOKMARK)
            continue;

        // 调用唤醒函数
        ret = curr->func(curr, mode, wake_flags, key);
        if (ret < 0)
            break;
        
        // 如果是互斥等待且唤醒成功，减少计数
        if (ret && (flags & WQ_FLAG_EXCLUSIVE) && !--nr_exclusive)
            break;

        // ... 处理bookmark ...
    }

    return nr_exclusive;
}
```

**关键逻辑**：
1. 遍历等待队列中的每个项
2. 调用每个项的唤醒函数
3. 如果是互斥等待，唤醒一个后就停止

### 5.3 __wake_up函数

定义在 **`kernel/sched/wait.c`**：

```c
void __wake_up(struct wait_queue_head *wq_head, unsigned int mode,
                int nr_exclusive, void *key)
{
    __wake_up_common_lock(wq_head, mode, nr_exclusive, 0, key);
}
```

---

## 六、wait_event系列宏详解

### 6.1 核心宏：___wait_event

定义在 **`include/linux/wait.h`**：

```c
#define ___wait_event(wq_head, condition, state, exclusive, ret, cmd)    \
({                                                                       \
    __label__ __out;                                                     \
    struct wait_queue_entry __wq_entry;                                  \
    long __ret = ret;                                                    \
                                                                         \
    /* 初始化等待队列项 */                                                \
    init_wait_entry(&__wq_entry, exclusive ? WQ_FLAG_EXCLUSIVE : 0);     \
    for (;;) {                                                           \
        /* 准备等待 */                                                    \
        long __int = prepare_to_wait_event(&wq_head, &__wq_entry, state);\
                                                                         \
        /* 检查条件 */                                                    \
        if (condition)                                                   \
            break;                                                       \
                                                                         \
        /* 检查是否被信号中断 */                                          \
        if (___wait_is_interruptible(state) && __int) {                  \
            __ret = __int;                                               \
            goto __out;                                                  \
        }                                                                \
                                                                         \
        /* 执行调度命令 */                                                \
        cmd;                                                             \
    }                                                                    \
    /* 清理 */                                                           \
    finish_wait(&wq_head, &__wq_entry);                                  \
__out:   __ret;                                                          \
})
```

### 6.2 wait_event宏

定义在 **`include/linux/wait.h`**：

```c
/**
 * wait_event - 睡眠直到条件为真
 * @wq_head: 等待队列
 * @condition: 等待的条件
 *
 * 进程进入不可中断睡眠（TASK_UNINTERRUPTIBLE）
 * 直到condition为真
 */
#define wait_event(wq_head, condition)                                    \
do {                                                                      \
    might_sleep();                                                        \
    if (condition)                                                        \
        break;                                                            \
    __wait_event(wq_head, condition);                                     \
} while (0)

#define __wait_event(wq_head, condition)                                  \
    (void)___wait_event(wq_head, condition, TASK_UNINTERRUPTIBLE, 0, 0,   \
                        schedule())
```

**使用示例**：

```c
DECLARE_WAIT_QUEUE_HEAD(my_wq);
int data_ready = 0;

// 等待数据就绪（不可中断）
wait_event(my_wq, data_ready != 0);

// 等价于：
while (data_ready == 0) {
    // 加入等待队列，设置状态为TASK_UNINTERRUPTIBLE
    // 调用schedule()放弃CPU
    // 被唤醒后继续检查条件
}
```

### 6.3 wait_event_interruptible宏

定义在 **`include/linux/wait.h`**：

```c
/**
 * wait_event_interruptible - 可中断等待
 * @wq_head: 等待队列
 * @condition: 等待的条件
 *
 * 进程进入可中断睡眠（TASK_INTERRUPTIBLE）
 * 
 * 返回值：
 *   0  - 条件满足，正常唤醒
 *   -ERESTARTSYS - 被信号中断
 */
#define wait_event_interruptible(wq_head, condition)                      \
({                                                                        \
    int __ret = 0;                                                        \
    might_sleep();                                                        \
    if (!(condition))                                                     \
        __ret = __wait_event_interruptible(wq_head, condition);           \
    __ret;                                                                \
})

#define __wait_event_interruptible(wq_head, condition)                    \
    ___wait_event(wq_head, condition, TASK_INTERRUPTIBLE, 0, 0,           \
                  schedule())
```

**使用示例**：

```c
DECLARE_WAIT_QUEUE_HEAD(my_wq);
int data_ready = 0;

// 等待数据就绪（可被信号中断）
int ret = wait_event_interruptible(my_wq, data_ready != 0);
if (ret == -ERESTARTSYS) {
    printk("被信号中断\n");
    return ret;
}
// 正常唤醒，继续执行
```

### 6.4 wait_event_timeout宏

定义在 **`include/linux/wait.h`**：

```c
/**
 * wait_event_timeout - 带超时的等待
 * @wq_head: 等待队列
 * @condition: 等待的条件
 * @timeout: 超时时间（jiffies）
 *
 * 返回值：
 *   0 - 超时，条件仍为假
 *   1 - 条件为真（超时后）
 *   >1 - 剩余jiffies（条件在超时前为真）
 */
#define wait_event_timeout(wq_head, condition, timeout)                   \
({                                                                        \
    long __ret = timeout;                                                 \
    might_sleep();                                                        \
    if (!___wait_cond_timeout(condition))                                 \
        __ret = __wait_event_timeout(wq_head, condition, timeout);        \
    __ret;                                                                \
})
```

**使用示例**：

```c
DECLARE_WAIT_QUEUE_HEAD(my_wq);
int data_ready = 0;

// 最多等待5秒
long ret = wait_event_timeout(my_wq, data_ready != 0, 5 * HZ);
if (ret == 0) {
    printk("超时！\n");
} else {
    printk("条件满足，剩余时间：%ld jiffies\n", ret);
}
```

### 6.5 wait_event_interruptible_timeout宏

定义在 **`include/linux/wait.h`**：

```c
/**
 * wait_event_interruptible_timeout - 可中断带超时的等待
 * 
 * 返回值：
 *   0 - 超时
 *   1 - 条件为真（超时后）
 *   >1 - 剩余jiffies
 *   -ERESTARTSYS - 被信号中断
 */
#define wait_event_interruptible_timeout(wq_head, condition, timeout)      \
({                                                                        \
    long __ret = timeout;                                                 \
    might_sleep();                                                        \
    if (!___wait_cond_timeout(condition))                                 \
        __ret = __wait_event_interruptible_timeout(wq_head,               \
                        condition, timeout);                              \
    __ret;                                                                \
})
```

### 6.6 wait_event系列宏对比

| 宏 | 睡眠状态 | 可被信号中断 | 支持超时 | 返回值 |
|-----|----------|--------------|----------|--------|
| wait_event | UNINTERRUPTIBLE | 否 | 否 | void |
| wait_event_interruptible | INTERRUPTIBLE | 是 | 否 | 0或-ERESTARTSYS |
| wait_event_timeout | UNINTERRUPTIBLE | 否 | 是 | 0/1/剩余时间 |
| wait_event_interruptible_timeout | INTERRUPTIBLE | 是 | 是 | 0/1/剩余时间/-ERESTARTSYS |

---

## 七、wake_up系列函数详解

### 7.1 基本唤醒宏

定义在 **`include/linux/wait.h`**：

```c
// 唤醒一个非互斥进程 + 一个互斥进程
#define wake_up(x)                        __wake_up(x, TASK_NORMAL, 1, NULL)

// 唤醒指定数量的进程
#define wake_up_nr(x, nr)                 __wake_up(x, TASK_NORMAL, nr, NULL)

// 唤醒所有进程
#define wake_up_all(x)                    __wake_up(x, TASK_NORMAL, 0, NULL)

// 唤醒可中断睡眠的进程
#define wake_up_interruptible(x)          __wake_up(x, TASK_INTERRUPTIBLE, 1, NULL)

// 唤醒所有可中断睡眠的进程
#define wake_up_interruptible_all(x)      __wake_up(x, TASK_INTERRUPTIBLE, 0, NULL)

// 同步唤醒（不迁移到其他CPU）
#define wake_up_sync(x)                   __wake_up_sync(x, TASK_NORMAL)

#define wake_up_interruptible_sync(x)     __wake_up_sync((x), TASK_INTERRUPTIBLE)
```

### 7.2 参数详解

| 参数 | 说明 |
|------|------|
| x | 等待队列头 |
| TASK_NORMAL | TASK_INTERRUPTIBLE \| TASK_UNINTERRUPTIBLE |
| TASK_INTERRUPTIBLE | 只唤醒可中断睡眠的进程 |
| nr_exclusive | 唤醒的互斥进程数量（0=全部） |

### 7.3 wake_up的执行流程

```
wake_up(&my_wq)
        │
        ▼
__wake_up(wq_head, TASK_NORMAL, 1, NULL)
        │
        ▼
__wake_up_common_lock()
        │
        ├─► spin_lock_irqsave()     // 获取锁
        │
        ├─► __wake_up_common()      // 遍历队列
        │       │
        │       ├─► 遍历每个wait_queue_entry
        │       │
        │       └─► curr->func()    // 调用唤醒函数
        │               │
        │               ▼
        │       default_wake_function()
        │               │
        │               ▼
        │       try_to_wake_up()
        │               │
        │               ├─► 设置状态为TASK_RUNNING
        │               │
        │               └─► 加入运行队列
        │
        └─► spin_unlock_irqrestore()  // 释放锁
```

### 7.4 互斥唤醒 vs 非互斥唤醒

```
┌─────────────────────────────────────────────────────────────┐
│                    唤醒逻辑                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  等待队列：                                                  │
│    [非互斥A] -> [非互斥B] -> [互斥C] -> [互斥D]              │
│                                                             │
│  wake_up()（nr_exclusive=1）：                              │
│    1. 唤醒非互斥A                                            │
│    2. 唤醒非互斥B                                            │
│    3. 唤醒互斥C（nr_exclusive变为0，停止）                   │
│    结果：A、B、C被唤醒，D不被唤醒                            │
│                                                             │
│  wake_up_all()（nr_exclusive=0）：                          │
│    1. 唤醒所有进程                                           │
│    结果：A、B、C、D都被唤醒                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、高级API与使用场景

### 8.1 添加/移除等待队列项

#### add_wait_queue

定义在 **`kernel/sched/wait.c`**：

```c
void add_wait_queue(struct wait_queue_head *wq_head, 
                     struct wait_queue_entry *wq_entry)
{
    unsigned long flags;

    wq_entry->flags &= ~WQ_FLAG_EXCLUSIVE;  // 设为非互斥
    spin_lock_irqsave(&wq_head->lock, flags);
    __add_wait_queue(wq_head, wq_entry);    // 加入队列头部
    spin_unlock_irqrestore(&wq_head->lock, flags);
}
```

#### add_wait_queue_exclusive

```c
void add_wait_queue_exclusive(struct wait_queue_head *wq_head, 
                               struct wait_queue_entry *wq_entry)
{
    unsigned long flags;

    wq_entry->flags |= WQ_FLAG_EXCLUSIVE;   // 设为互斥
    spin_lock_irqsave(&wq_head->lock, flags);
    __add_wait_queue_entry_tail(wq_head, wq_entry);  // 加入队列尾部
    spin_unlock_irqrestore(&wq_head->lock, flags);
}
```

#### remove_wait_queue

```c
void remove_wait_queue(struct wait_queue_head *wq_head, 
                        struct wait_queue_entry *wq_entry)
{
    unsigned long flags;

    spin_lock_irqsave(&wq_head->lock, flags);
    __remove_wait_queue(wq_head, wq_entry);
    spin_unlock_irqrestore(&wq_head->lock, flags);
}
```

### 8.2 检查等待队列状态

#### waitqueue_active

定义在 **`include/linux/wait.h`**：

```c
/**
 * waitqueue_active - 检查等待队列是否有等待者
 * @wq_head: 等待队列
 *
 * 返回：true如果队列非空
 *
 * 注意：这个函数是无锁的，需要小心使用！
 */
static inline int waitqueue_active(struct wait_queue_head *wq_head)
{
    return !list_empty(&wq_head->head);
}
```

**正确使用方式**：

```c
// 正确：先设置条件，再检查队列
data_ready = 1;
smp_mb();  // 内存屏障
if (waitqueue_active(&my_wq))
    wake_up(&my_wq);
```

### 8.3 wait_event_cmd

在休眠前后执行自定义命令：

```c
/**
 * wait_event_cmd - 睡眠直到条件为真
 * @wq_head: 等待队列
 * @condition: 条件
 * @cmd1: 休眠前执行的命令
 * @cmd2: 唤醒后执行的命令
 */
#define wait_event_cmd(wq_head, condition, cmd1, cmd2)                    \
do {                                                                      \
    if (condition)                                                        \
        break;                                                            \
    __wait_event_cmd(wq_head, condition, cmd1, cmd2);                     \
} while (0)
```

**使用示例**：

```c
// 在休眠前释放锁，唤醒后重新获取
wait_event_cmd(my_wq, data_ready != 0,
               mutex_unlock(&my_mutex),    // 休眠前
               mutex_lock(&my_mutex));     // 唤醒后
```

### 8.4 wait_event_freezable

可冻结的等待（用于休眠/休止场景）：

```c
/**
 * wait_event_freezable - 可冻结等待
 * 
 * 进程进入可中断睡眠，并且可以被冻结
 * 用于支持系统休眠
 */
#define wait_event_freezable(wq_head, condition)                          \
({                                                                        \
    int __ret = 0;                                                        \
    might_sleep();                                                        \
    if (!(condition))                                                     \
        __ret = __wait_event_freezable(wq_head, condition);               \
    __ret;                                                                \
})
```

---

## 九、完整使用示例

### 9.1 示例1：简单的按键驱动

```c
#include <linux/module.h>
#include <linux/wait.h>
#include <linux/interrupt.h>

// 定义等待队列和条件变量
static DECLARE_WAIT_QUEUE_HEAD(key_waitqueue);
static int key_pressed = 0;

// 中断处理函数
static irqreturn_t key_interrupt_handler(int irq, void *dev_id)
{
    // 设置条件
    key_pressed = 1;
    
    // 唤醒等待的进程
    wake_up_interruptible(&key_waitqueue);
    
    return IRQ_HANDLED;
}

// 读取函数（阻塞）
static ssize_t key_read(struct file *filp, char __user *buf, 
                        size_t count, loff_t *f_pos)
{
    int ret;
    
    // 等待按键按下（可被信号中断）
    ret = wait_event_interruptible(key_waitqueue, key_pressed != 0);
    if (ret == -ERESTARTSYS) {
        printk("被信号中断\n");
        return -EINTR;
    }
    
    // 清除标志
    key_pressed = 0;
    
    // 返回按键值给用户
    if (copy_to_user(buf, &key_pressed, sizeof(key_pressed)))
        return -EFAULT;
    
    return sizeof(key_pressed);
}
```

### 9.2 示例2：带超时的等待

```c
#include <linux/wait.h>
#include <linux/jiffies.h>

static DECLARE_WAIT_QUEUE_HEAD(data_wq);
static int data_ready = 0;

int wait_for_data_with_timeout(void)
{
    long ret;
    
    // 最多等待5秒
    ret = wait_event_interruptible_timeout(data_wq, 
                                            data_ready != 0,
                                            msecs_to_jiffies(5000));
    
    switch (ret) {
    case 0:
        printk("超时！数据未就绪\n");
        return -ETIMEDOUT;
        
    case -ERESTARTSYS:
        printk("被信号中断\n");
        return -EINTR;
        
    default:
        printk("数据就绪，剩余时间：%ld jiffies\n", ret);
        return 0;
    }
}

// 数据就绪时调用
void data_complete(void)
{
    data_ready = 1;
    wake_up_interruptible(&data_wq);
}
```

### 9.3 示例3：手动休眠（底层方式）

```c
#include <linux/wait.h>
#include <linux/sched.h>

static DECLARE_WAIT_QUEUE_HEAD(my_wq);
static int condition = 0;

void manual_sleep_example(void)
{
    DEFINE_WAIT(wait);  // 定义等待队列项
    
    // 循环等待
    while (1) {
        // 准备休眠
        prepare_to_wait(&my_wq, &wait, TASK_INTERRUPTIBLE);
        
        // 检查条件（必须在schedule之前！）
        if (condition) {
            break;  // 条件满足，退出
        }
        
        // 检查信号
        if (signal_pending(current)) {
            finish_wait(&my_wq, &wait);
            return;  // 被信号中断
        }
        
        // 放弃CPU，进入休眠
        schedule();
    }
    
    // 清理
    finish_wait(&my_wq, &wait);
    
    // 继续执行...
}

// 唤醒函数
void wake_up_example(void)
{
    condition = 1;
    wake_up_interruptible(&my_wq);
}
```

### 9.4 示例4：互斥等待（避免惊群）

```c
#include <linux/wait.h>

static DECLARE_WAIT_QUEUE_HEAD(lock_wq);
static int lock_available = 1;

// 获取锁（互斥等待）
int acquire_lock(void)
{
    int ret;
    
    // wait_event_interruptible_exclusive - 互斥等待
    // 只有一个进程会被唤醒
    ret = wait_event_interruptible_exclusive(lock_wq, lock_available);
    if (ret)
        return ret;
    
    lock_available = 0;  // 获取锁
    return 0;
}

// 释放锁
void release_lock(void)
{
    lock_available = 1;
    // 只唤醒一个等待者
    wake_up(&lock_wq);
}
```

### 9.5 示例5：在生产者-消费者场景中使用

```c
#include <linux/wait.h>
#include <linux/spinlock.h>

#define BUFFER_SIZE 1024

static char buffer[BUFFER_SIZE];
static int buffer_count = 0;
static int head = 0, tail = 0;

static DECLARE_WAIT_QUEUE_HEAD(read_wq);   // 读者等待队列
static DECLARE_WAIT_QUEUE_HEAD(write_wq);  // 写者等待队列
static DEFINE_SPINLOCK(buffer_lock);

// 生产者：写入数据
int produce_data(char data)
{
    spin_lock(&buffer_lock);
    
    // 等待缓冲区有空间
    while (buffer_count >= BUFFER_SIZE) {
        spin_unlock(&buffer_lock);
        if (wait_event_interruptible(write_wq, buffer_count < BUFFER_SIZE))
            return -EINTR;
        spin_lock(&buffer_lock);
    }
    
    // 写入数据
    buffer[head] = data;
    head = (head + 1) % BUFFER_SIZE;
    buffer_count++;
    
    spin_unlock(&buffer_lock);
    
    // 唤醒读者
    wake_up_interruptible(&read_wq);
    
    return 0;
}

// 消费者：读取数据
int consume_data(char *data)
{
    spin_lock(&buffer_lock);
    
    // 等待缓冲区有数据
    while (buffer_count <= 0) {
        spin_unlock(&buffer_lock);
        if (wait_event_interruptible(read_wq, buffer_count > 0))
            return -EINTR;
        spin_lock(&buffer_lock);
    }
    
    // 读取数据
    *data = buffer[tail];
    tail = (tail + 1) % BUFFER_SIZE;
    buffer_count--;
    
    spin_unlock(&buffer_lock);
    
    // 唤醒写者
    wake_up_interruptible(&write_wq);
    
    return 0;
}
```

---

## 十、常见问题与注意事项

### 10.1 必须在进程上下文中休眠

```c
// 错误：在中断处理函数中休眠
static irqreturn_t my_interrupt(int irq, void *dev_id)
{
    // 错误！中断上下文不能休眠
    wait_event(my_wq, condition);
    
    return IRQ_HANDLED;
}

// 正确：在中断中唤醒，在进程上下文中休眠
static irqreturn_t my_interrupt(int irq, void *dev_id)
{
    condition = 1;
    wake_up(&my_wq);  // 唤醒等待的进程
    return IRQ_HANDLED;
}
```

### 10.2 不能持有自旋锁时休眠

```c
// 错误：持有自旋锁时休眠
void wrong_example(void)
{
    spin_lock(&my_lock);
    wait_event(my_wq, condition);  // 错误！可能导致死锁
    spin_unlock(&my_lock);
}

// 正确：释放锁后再休眠
void correct_example(void)
{
    spin_lock(&my_lock);
    // ... 检查条件 ...
    spin_unlock(&my_lock);
    
    wait_event(my_wq, condition);
}
```

### 10.3 条件检查必须在schedule之前

```c
// 错误：先schedule再检查条件
void wrong_example(void)
{
    DEFINE_WAIT(wait);
    prepare_to_wait(&my_wq, &wait, TASK_INTERRUPTIBLE);
    schedule();  // 错误！可能错过唤醒
    if (condition) {
        // ...
    }
    finish_wait(&my_wq, &wait);
}

// 正确：先检查条件再schedule
void correct_example(void)
{
    DEFINE_WAIT(wait);
    while (1) {
        prepare_to_wait(&my_wq, &wait, TASK_INTERRUPTIBLE);
        if (condition)  // 先检查
            break;
        schedule();     // 再休眠
    }
    finish_wait(&my_wq, &wait);
}
```

### 10.4 虚假唤醒问题

即使条件不满足，进程也可能被唤醒（虚假唤醒），所以必须用循环检查：

```c
// 错误：单次检查
wait_event_interruptible(my_wq, condition);
// 唤醒后假设条件一定满足 - 错误！

// 正确：wait_event内部已经是循环
// 等价于：
while (!condition) {
    // 休眠
}
```

### 10.5 内存屏障问题

在多核环境下，需要确保条件设置和唤醒的顺序：

```c
// 正确：设置条件后使用内存屏障
void wake_up_correct(void)
{
    condition = 1;
    smp_mb();  // 确保condition的写入在wake_up之前
    wake_up(&my_wq);
}

// 或者直接使用wake_up，它内部有内存屏障
void wake_up_simple(void)
{
    condition = 1;
    wake_up(&my_wq);  // wake_up内部有smp_mb()
}
```

### 10.6 惊群效应

多个进程等待同一事件时，唤醒所有进程可能导致竞争：

```c
// 问题：多个进程等待同一个锁
// wake_up_all唤醒所有进程，它们都去抢锁

// 解决：使用互斥等待
wait_event_interruptible_exclusive(lock_wq, lock_available);
// 只唤醒一个进程
wake_up(&lock_wq);
```

### 10.7 常见错误码

| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| -ERESTARTSYS | 被信号中断 | 通常返回-EINTR给用户 |
| -ETIMEDOUT | 超时 | 根据业务逻辑处理 |
| -EINTR | 系统调用被中断 | 可重启或返回错误 |

---

## 十一、总结

### 11.1 等待队列核心API速查表

| API | 功能 | 使用场景 |
|-----|------|----------|
| DECLARE_WAIT_QUEUE_HEAD | 静态定义等待队列 | 全局变量 |
| init_waitqueue_head | 动态初始化等待队列 | 结构体成员 |
| wait_event | 不可中断等待 | 关键操作 |
| wait_event_interruptible | 可中断等待 | 最常用 |
| wait_event_timeout | 带超时等待 | 需要超时 |
| wait_event_interruptible_timeout | 可中断带超时 | 完整功能 |
| wake_up | 唤醒进程 | 事件发生时 |
| wake_up_interruptible | 唤醒可中断进程 | 配合wait_event_interruptible |
| wake_up_all | 唤醒所有进程 | 广播通知 |
| prepare_to_wait | 准备休眠 | 手动休眠 |
| finish_wait | 清理休眠 | 手动休眠 |

### 11.2 设计要点总结

1. **避免忙等待**：使用等待队列让进程休眠，而不是轮询
2. **选择正确的状态**：根据需求选择INTERRUPTIBLE或UNINTERRUPTIBLE
3. **正确处理信号**：可中断等待要检查返回值
4. **避免死锁**：不要在持有自旋锁时休眠
5. **防止虚假唤醒**：使用循环检查条件
6. **避免惊群**：使用互斥等待减少竞争

### 11.3 进一步学习

- **`include/linux/wait.h`** - 等待队列头文件
- **`kernel/sched/wait.c`** - 等待队列实现
- **`kernel/sched/core.c`** - 调度核心（try_to_wake_up）
- **`kernel/sched/wait_bit.c`** - 位等待队列

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了等待队列与休眠机制的原理和使用方法。等待队列是Linux内核实现进程同步和阻塞I/O的核心机制，理解它是掌握内核编程的关键。*
