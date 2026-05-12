# Linux 0.11 同步与并发机制详解

## 目录

1. **`实现情况总览`**
2. **`等待队列机制`**
3. **`同步与互斥机制`**
4. **`进程状态与调度`**
5. **`管道同步实现`**
6. **`未实现的机制`**
7. **`与现代 Linux 对比`**

---

## 1. 实现情况总览

### 1.1 Linux 0.11 同步机制实现状态

| 机制 | 实现状态 | 说明 |
|------|---------|------|
| **等待队列** | ✅ 已实现 | sleep_on/wake_up |
| **同步/互斥** | ✅ 部分实现 | cli()/sti() 关中断 |
| **进程状态** | ✅ 已实现 | 5 种进程状态 |
| **并发调度** | ✅ 已实现 | 时间片轮转调度 |
| **自旋锁** | ❌ 未实现 | 使用 cli()/sti() 代替 |
| **POLL/SELECT** | ❌ 未实现 | 无此系统调用 |
| **信号量** | ❌ 未实现 | 无 semget/semop |
| **互斥锁** | ❌ 未实现 | 无 pthread_mutex |
| **读写锁** | ❌ 未实现 | 无此机制 |

### 1.2 架构概览

```
Linux 0.11 同步机制架构：
+===========================================================================+
|                                                                           |
|   用户进程                                                                |
|       |                                                                   |
|       v                                                                   |
|   +-----------+     +-----------+     +-----------+                       |
|   | 系统调用  |---->| 内核函数  |---->| 同步机制  |                       |
|   +-----------+     +-----------+     +-----------+                       |
|                                           |                               |
|                     +---------------------+---------------------+         |
|                     |                     |                     |         |
|                     v                     v                     v         |
|               +-----------+         +-----------+         +-----------+   |
|               | sleep_on  |         | wake_up   |         | cli/sti   |   |
|               | 等待队列  |         | 唤醒进程  |         | 关中断    |   |
|               +-----------+         +-----------+         +-----------+   |
|                     |                     |                     |         |
|                     v                     v                     v         |
|               +-----------+         +-----------+         +-----------+   |
|               | schedule  |         | 状态改变  |         | 原子操作  |   |
|               | 调度器    |         | TASK_RUNNING|        | 临界区    |   |
|               +-----------+         +-----------+         +-----------+   |
|                                                                           |
+===========================================================================+
```

---

## 2. 等待队列机制

### 2.1 等待队列的实现原理

Linux 0.11 使用**隐式链表**实现等待队列，而不是现代 Linux 中的显式 `wait_queue_head_t` 结构。

**等待队列头**：`struct task_struct **`（指向进程指针的指针）

```
等待队列结构：
+===========================================================================+
|                                                                           |
|   等待队列头：struct task_struct **p                                      |
|                                                                           |
|   +---+     +---+     +---+     +---+                                     |
|   | p |---->| A |---->| B |---->| C |----> NULL                          |
|   +---+     +---+     +---+     +---+                                     |
|             进程A      进程B      进程C                                    |
|             等待中      等待中     等待中                                   |
|                                                                           |
|   注意：这里的链表是通过 task_struct 中的临时指针串联的                    |
|   不是 task_struct 结构体的成员                                           |
|                                                                           |
+===========================================================================+
```

### 2.2 sleep_on 函数

定义在 **`kernel/sched.c`**：

```c
void sleep_on(struct task_struct **p)
{
    struct task_struct *tmp;

    if (!p)
        return;
    
    /* task[0] 不能睡眠 */
    if (current == &(init_task.task))
        panic("task[0] trying to sleep");

    /* 1. 保存当前等待队列头 */
    tmp = *p;
    
    /* 2. 将当前进程插入等待队列头部 */
    *p = current;
    
    /* 3. 设置为不可中断睡眠状态 */
    current->state = TASK_UNINTERRUPTIBLE;
    
    /* 4. 调度其他进程运行 */
    schedule();
    
    /* 5. 被唤醒后，唤醒队列中的下一个进程 */
    if (tmp)
        tmp->state = 0;  /* TASK_RUNNING */
}
```

**执行流程分析**：

```
sleep_on 执行流程：
+-------------------+
| 进程 A 调用       |
| sleep_on(&wait)   |
+---------+---------+
          |
          v
+---------+---------+
| tmp = *wait       |  tmp = NULL (队列为空)
| *wait = current   |  wait -> 进程A
| A->state =        |
|   TASK_UNINTERRUPTIBLE
+---------+---------+
          |
          v
+---------+---------+
| schedule()        |  切换到其他进程
+---------+---------+
          |
          | (进程B也调用 sleep_on)
          v
+---------+---------+
| tmp = *wait       |  tmp = 进程A
| *wait = current   |  wait -> 进程B -> 进程A
| B->state =        |
|   TASK_UNINTERRUPTIBLE
+---------+---------+
          |
          v
+---------+---------+
| schedule()        |  切换到其他进程
+---------+---------+

等待队列：wait -> B -> A -> NULL
```

### 2.3 interruptible_sleep_on 函数

```c
void interruptible_sleep_on(struct task_struct **p)
{
    struct task_struct *tmp;

    if (!p)
        return;
    if (current == &(init_task.task))
        panic("task[0] trying to sleep");
    
    tmp = *p;
    *p = current;

repeat:
    /* 设置为可中断睡眠状态 */
    current->state = TASK_INTERRUPTIBLE;
    schedule();
    
    /* 检查是否被信号唤醒 */
    if (*p && *p != current) {
        (**p).state = 0;
        goto repeat;
    }
    *p = NULL;
    
    /* 唤醒队列中的下一个进程 */
    if (tmp)
        tmp->state = 0;
}
```

**可中断睡眠与不可中断睡眠的区别**：

| 类型 | 状态 | 可被信号唤醒 | 使用场景 |
|------|------|-------------|---------|
| `sleep_on` | TASK_UNINTERRUPTIBLE | ❌ 否 | 等待硬件 I/O |
| `interruptible_sleep_on` | TASK_INTERRUPTIBLE | ✅ 是 | 等待用户事件 |

### 2.4 wake_up 函数

```c
void wake_up(struct task_struct **p)
{
    if (p && *p) {
        (**p).state = 0;  /* TASK_RUNNING */
        *p = NULL;
    }
}
```

**唤醒流程**：

```
wake_up 执行流程：
+-------------------+
| 调用 wake_up(&wait)|
+---------+---------+
          |
          v
+---------+---------+
| (*p)->state = 0   |  设置为 RUNNING
| *p = NULL         |  清空等待队列头
+---------+---------+
          |
          v
+---------+---------+
| 被唤醒的进程      |
| 从 schedule() 返回|
| 继续执行          |
+---------+---------+
          |
          v
+---------+---------+
| if (tmp)          |
|   tmp->state = 0  |  唤醒下一个进程
+-------------------+
```

### 2.5 等待队列的链式唤醒

```
链式唤醒过程：
+===========================================================================+
|                                                                           |
|   初始状态：wait -> B -> A -> NULL                                        |
|                                                                           |
|   wake_up(&wait) 被调用：                                                 |
|                                                                           |
|   1. B 被唤醒，wait = NULL                                                |
|      wait -> NULL                                                         |
|      B 从 schedule() 返回                                                 |
|                                                                           |
|   2. B 执行 sleep_on 的后续代码：                                         |
|      if (tmp) tmp->state = 0   // tmp = A                                 |
|      A 被唤醒                                                             |
|                                                                           |
|   3. A 从 schedule() 返回                                                 |
|      A 执行 sleep_on 的后续代码：                                         |
|      if (tmp) tmp->state = 0   // tmp = NULL                              |
|      无操作                                                               |
|                                                                           |
|   结果：所有等待进程都被唤醒                                              |
|                                                                           |
+===========================================================================+
```

---

## 3. 同步与互斥机制

### 3.1 cli()/sti() 关中断机制

Linux 0.11 使用**关中断**实现简单的互斥机制。

定义在 **`include/asm/system.h`**：

```c
#define sti() __asm__ ("sti"::)   /* 开中断 */
#define cli() __asm__ ("cli"::)   /* 关中断 */
```

**原理**：
- `cli()`：清除 EFLAGS 的 IF 标志，禁止外部中断
- `sti()`：设置 EFLAGS 的 IF 标志，允许外部中断

### 3.2 使用模式

```c
/* 标准的临界区保护模式 */
cli();                    /* 关中断，进入临界区 */
/* 临界区代码 */
... critical section ...
sti();                    /* 开中断，退出临界区 */
```

### 3.3 实际使用示例

**示例1：缓冲区操作**（来自 **`fs/buffer.c`**）：

```c
static inline void wait_on_buffer(struct buffer_head * bh)
{
    cli();                          /* 关中断 */
    while (bh->b_lock)              /* 检查锁状态 */
        sleep_on(&bh->b_wait);      /* 如果锁定，睡眠等待 */
    sti();                          /* 开中断 */
}
```

**示例2：超级块操作**（来自 **`fs/super.c`**）：

```c
static void lock_super(struct super_block * sb)
{
    cli();                          /* 关中断 */
    while (sb->s_lock)              /* 检查锁状态 */
        sleep_on(&(sb->s_wait));    /* 如果锁定，睡眠等待 */
    sb->s_lock = 1;                 /* 获取锁 */
    sti();                          /* 开中断 */
}

static void free_super(struct super_block * sb)
{
    cli();                          /* 关中断 */
    sb->s_lock = 0;                 /* 释放锁 */
    wake_up(&(sb->s_wait));         /* 唤醒等待进程 */
    sti();                          /* 开中断 */
}
```

**示例3：软驱马达控制**（来自 **`kernel/sched.c`**）：

```c
void floppy_on(unsigned int nr)
{
    cli();                          /* 关中断 */
    while (ticks_to_floppy_on(nr))
        sleep_on(nr + wait_motor);  /* 等待马达启动 */
    sti();                          /* 开中断 */
}
```

### 3.4 cli()/sti() 的局限性

| 局限性 | 说明 |
|-------|------|
| **粒度太粗** | 关中断期间所有中断都被禁止 |
| **不能嵌套** | 多次 cli() 后一次 sti() 就开中断 |
| **不适合多核** | 只能保护单核 CPU |
| **影响实时性** | 关中断时间过长影响系统响应 |

### 3.5 简单锁的实现

Linux 0.11 中使用简单的标志位实现锁：

```c
/* 锁的定义 */
unsigned char b_lock;    /* 0 = 未锁定，1 = 锁定 */

/* 获取锁 */
void lock_something(void)
{
    cli();
    while (lock_flag)
        sleep_on(&lock_wait);
    lock_flag = 1;
    sti();
}

/* 释放锁 */
void unlock_something(void)
{
    cli();
    lock_flag = 0;
    wake_up(&lock_wait);
    sti();
}
```

---

## 4. 进程状态与调度

### 4.1 进程状态定义

定义在 **`include/linux/sched.h`**：

```c
#define TASK_RUNNING         0   /* 运行中或就绪 */
#define TASK_INTERRUPTIBLE   1   /* 可中断睡眠 */
#define TASK_UNINTERRUPTIBLE 2   /* 不可中断睡眠 */
#define TASK_ZOMBIE          3   /* 僵尸状态 */
#define TASK_STOPPED         4   /* 停止状态 */
```

### 4.2 状态转换图

```
进程状态转换：
+===========================================================================+
|                                                                           |
|                          +-----------+                                    |
|                          |   创建    |                                    |
|                          +-----+-----+                                    |
|                                |                                          |
|                                v                                          |
|   +------------------+  +-----------+  +------------------+              |
|   | TASK_RUNNING     |<-| TASK_     |->| TASK_            |              |
|   | (运行/就绪)      |  | INTERRUPT |  | UNINTERRUPTIBLE  |              |
|   +--------+---------+  | IBLE      |  +--------+---------+              |
|            |            +-----------+           |                        |
|            |                  ^                 |                        |
|            |                  | wake_up         | wake_up                |
|            |            sleep_on               | sleep_on               |
|            |            (可中断)               | (不可中断)              |
|            |                  |                 |                        |
|            |            +-----+-----+           |                        |
|            |            | 信号到达  |           |                        |
|            |            +-----------+           |                        |
|            |                                    |                        |
|            v                                    v                        |
|   +--------+---------+                  +-----------+                    |
|   | exit()           |                  | I/O 完成  |                    |
|   +--------+---------+                  +-----------+                    |
|            |                                                               |
|            v                                                               |
|   +------------------+                                                    |
|   | TASK_ZOMBIE      |                                                    |
|   | (僵尸状态)       |                                                    |
|   +------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 4.3 schedule() 调度函数

```c
void schedule(void)
{
    int i, next, c;
    struct task_struct ** p;

    /* 1. 检查 alarm 并唤醒收到信号的可中断睡眠进程 */
    for (p = &LAST_TASK; p > &FIRST_TASK; --p)
        if (*p) {
            if ((*p)->alarm && (*p)->alarm < jiffies) {
                (*p)->signal |= (1 << (SIGALRM - 1));
                (*p)->alarm = 0;
            }
            if (((*p)->signal & ~(_BLOCKABLE & (*p)->blocked)) &&
                (*p)->state == TASK_INTERRUPTIBLE)
                (*p)->state = TASK_RUNNING;  /* 信号唤醒 */
        }

    /* 2. 选择时间片最大的就绪进程 */
    while (1) {
        c = -1;
        next = 0;
        i = NR_TASKS;
        p = &task[NR_TASKS];
        while (--i) {
            if (!*--p)
                continue;
            if ((*p)->state == TASK_RUNNING && (*p)->counter > c)
                c = (*p)->counter, next = i;
        }
        if (c) break;
        
        /* 3. 所有进程时间片用完，重新分配 */
        for (p = &LAST_TASK; p > &FIRST_TASK; --p)
            if (*p)
                (*p)->counter = ((*p)->counter >> 1) + (*p)->priority;
    }
    
    /* 4. 切换到选中的进程 */
    switch_to(next);
}
```

### 4.4 并发控制流程

```
并发控制流程：
+===========================================================================+
|                                                                           |
|   进程 A                              进程 B                              |
|   |                                    |                                  |
|   v                                    v                                  |
| +-----------+                    +-----------+                            |
| | 获取资源  |                    | 获取资源  |                            |
| | 资源可用? |                    | 资源可用? |                            |
| +-----+-----+                    +-----+-----+                            |
|       |                                |                                  |
|   Yes | No                         Yes | No                               |
|       v                                v                                  |
| +-----------+                    +-----------+                            |
| | 使用资源  |                    | sleep_on  |                            |
| | ...       |                    | 进入等待  |                            |
| | ...       |                    | schedule()|                            |
| +-----+-----+                    +-----------+                            |
|       |                                ^                                  |
|       v                                |                                  |
| +-----------+                          |                                  |
| | 释放资源  |--------------------------+                                  |
| | wake_up() |                                                             |
| +-----------+                    +-----------+                            |
|                                  | 被唤醒    |                            |
|                                  | 使用资源  |                            |
|                                  +-----------+                            |
|                                                                           |
+===========================================================================+
```

---

## 5. 管道同步实现

### 5.1 管道读取同步

定义在 **`fs/pipe.c`**：

```c
int read_pipe(struct m_inode * inode, char * buf, int count)
{
    int chars, size, read = 0;

    while (count > 0) {
        /* 1. 等待管道有数据 */
        while (!(size = PIPE_SIZE(*inode))) {
            wake_up(&inode->i_wait);       /* 唤醒写进程 */
            if (inode->i_count != 2)       /* 没有写进程 */
                return read;
            sleep_on(&inode->i_wait);      /* 等待数据 */
        }

        /* 2. 读取数据 */
        chars = PAGE_SIZE - PIPE_TAIL(*inode);
        if (chars > count)
            chars = count;
        if (chars > size)
            chars = size;
        count -= chars;
        read += chars;
        size = PIPE_TAIL(*inode);
        PIPE_TAIL(*inode) += chars;
        PIPE_TAIL(*inode) &= (PAGE_SIZE - 1);
        while (chars-- > 0)
            put_fs_byte(((char *)inode->i_size)[size++], buf++);
    }
    
    /* 3. 唤醒写进程 */
    wake_up(&inode->i_wait);
    return read;
}
```

### 5.2 管道写入同步

```c
int write_pipe(struct m_inode * inode, char * buf, int count)
{
    int chars, size, written = 0;

    while (count > 0) {
        /* 1. 等待管道有空间 */
        while (!(size = (PAGE_SIZE - 1) - PIPE_SIZE(*inode))) {
            wake_up(&inode->i_wait);       /* 唤醒读进程 */
            if (inode->i_count != 2) {     /* 没有读进程 */
                current->signal |= (1 << (SIGPIPE - 1));
                return written ? written : -1;
            }
            sleep_on(&inode->i_wait);      /* 等待空间 */
        }

        /* 2. 写入数据 */
        chars = PAGE_SIZE - PIPE_HEAD(*inode);
        if (chars > count)
            chars = count;
        if (chars > size)
            chars = size;
        count -= chars;
        written += chars;
        size = PIPE_HEAD(*inode);
        PIPE_HEAD(*inode) += chars;
        PIPE_HEAD(*inode) &= (PAGE_SIZE - 1);
        while (chars-- > 0)
            ((char *)inode->i_size)[size++] = get_fs_byte(buf++);
    }
    
    /* 3. 唤醒读进程 */
    wake_up(&inode->i_wait);
    return written;
}
```

### 5.3 管道同步流程图

```
管道读写同步：
+===========================================================================+
|                                                                           |
|   读进程                              写进程                              |
|   |                                    |                                  |
|   v                                    v                                  |
| +-----------+                    +-----------+                            |
| | 管道空?   |                    | 管道满?   |                            |
| +-----+-----+                    +-----+-----+                            |
|       |                                |                                  |
|   Yes | No                         Yes | No                               |
|       v                                v                                  |
| +-----------+                    +-----------+                            |
| | wake_up() |                    | wake_up() |                            |
| | 唤醒写进程|                    | 唤醒读进程|                            |
| | sleep_on |                    | sleep_on  |                            |
| | 等待数据  |                    | 等待空间  |                            |
| +-----+-----+                    +-----+-----+                            |
|       |                                |                                  |
|       v                                v                                  |
| +-----------+                    +-----------+                            |
| | 读取数据  |                    | 写入数据  |                            |
| | wake_up() |                    | wake_up() |                            |
| | 唤醒写进程|                    | 唤醒读进程|                            |
| +-----------+                    +-----------+                            |
|                                                                           |
+===========================================================================+
```

---

## 6. 未实现的机制

### 6.1 自旋锁（Spinlock）

**未实现原因**：
- Linux 0.11 是单核系统，不需要自旋锁
- 使用 `cli()/sti()` 代替

**现代 Linux 自旋锁**：
```c
/* 现代 Linux 的自旋锁 */
spinlock_t lock = SPIN_LOCK_UNLOCKED;

spin_lock(&lock);
/* 临界区 */
spin_unlock(&lock);
```

**Linux 0.11 等效实现**：
```c
cli();
/* 临界区 */
sti();
```

### 6.2 POLL/SELECT

**未实现**：Linux 0.11 没有 `sys_select()` 或 `sys_poll()` 系统调用。

**影响**：
- 无法同时监控多个文件描述符
- 必须使用阻塞 I/O 或非阻塞轮询

**现代 Linux 使用方式**：
```c
/* 现代 Linux 的 select */
fd_set readfds;
FD_ZERO(&readfds);
FD_SET(fd, &readfds);
select(fd + 1, &readfds, NULL, NULL, NULL);
```

### 6.3 信号量

**未实现**：Linux 0.11 没有 System V 信号量或 POSIX 信号量。

**影响**：
- 无法进行复杂的进程间同步
- 只能使用 sleep_on/wake_up

### 6.4 互斥锁

**未实现**：Linux 0.11 没有 pthread_mutex 或内核 mutex。

**替代方案**：
- 使用简单的标志位 + cli()/sti()
- 使用 sleep_on/wake_up

---

## 7. 与现代 Linux 对比

### 7.1 等待队列对比

| 特性 | Linux 0.11 | 现代 Linux |
|------|-----------|-----------|
| **数据结构** | 隐式链表 | 显式 wait_queue_head_t |
| **队列头** | `struct task_struct **` | `wait_queue_head_t` |
| **队列项** | 无独立结构 | `wait_queue_entry_t` |
| **操作函数** | sleep_on/wake_up | prepare_to_wait/finish_wait |
| **自旋锁保护** | cli()/sti() | spin_lock |

**现代 Linux 等待队列**：
```c
/* 现代 Linux 等待队列 */
DECLARE_WAIT_QUEUE_HEAD(my_wait);

/* 等待 */
wait_event(my_wait, condition);

/* 唤醒 */
wake_up(&my_wait);
```

### 7.2 同步机制对比

| 机制 | Linux 0.11 | 现代 Linux |
|------|-----------|-----------|
| **关中断** | cli()/sti() | local_irq_save/restore |
| **自旋锁** | ❌ 无 | spinlock_t |
| **互斥锁** | ❌ 无 | struct mutex |
| **信号量** | ❌ 无 | struct semaphore |
| **读写锁** | ❌ 无 | rwlock_t |
| **RCU** | ❌ 无 | rcu_read_lock |

### 7.3 进程状态对比

| Linux 0.11 | 现代 Linux | 说明 |
|-----------|-----------|------|
| TASK_RUNNING | TASK_RUNNING | 运行/就绪 |
| TASK_INTERRUPTIBLE | TASK_INTERRUPTIBLE | 可中断睡眠 |
| TASK_UNINTERRUPTIBLE | TASK_UNINTERRUPTIBLE | 不可中断睡眠 |
| TASK_ZOMBIE | EXIT_ZOMBIE | 僵尸状态 |
| TASK_STOPPED | TASK_STOPPED | 停止状态 |
| - | TASK_KILLABLE | 可杀死睡眠 |
| - | TASK_IDLE | 空闲状态 |

### 7.4 架构演进图

```
同步机制演进：
+===========================================================================+
|                                                                           |
|   Linux 0.11 (1991)              现代 Linux (2024)                        |
|   +------------------+          +------------------+                      |
|   | cli()/sti()      |          | spinlock_t       |                      |
|   | 关中断           |  ----->  | 自旋锁           |                      |
|   +------------------+          +------------------+                      |
|                                                                           |
|   +------------------+          +------------------+                      |
|   | sleep_on()       |          | wait_event()     |                      |
|   | 隐式等待队列     |  ----->  | 显式等待队列     |                      |
|   +------------------+          +------------------+                      |
|                                                                           |
|   +------------------+          +------------------+                      |
|   | 无               |          | mutex            |                      |
|   |                  |  ----->  | 互斥锁           |                      |
|   +------------------+          +------------------+                      |
|                                                                           |
|   +------------------+          +------------------+                      |
|   | 无               |          | semaphore        |                      |
|   |                  |  ----->  | 信号量           |                      |
|   +------------------+          +------------------+                      |
|                                                                           |
|   +------------------+          +------------------+                      |
|   | 无               |          | select/poll/     |                      |
|   |                  |  ----->  | epoll            |                      |
|   +------------------+          +------------------+                      |
|                                                                           |
+===========================================================================+
```

---

## 8. 总结

### 8.1 Linux 0.11 同步机制特点

| 特点 | 说明 |
|------|------|
| **简单** | 只有 sleep_on/wake_up 和 cli()/sti() |
| **单核设计** | 不需要复杂的锁机制 |
| **效率较低** | 关中断粒度粗，影响实时性 |
| **功能有限** | 无 poll/select、信号量等 |

### 8.2 关键函数总结

| 函数 | 文件 | 作用 |
|------|------|------|
| sleep_on() | sched.c | 不可中断睡眠 |
| interruptible_sleep_on() | sched.c | 可中断睡眠 |
| wake_up() | sched.c | 唤醒进程 |
| schedule() | sched.c | 进程调度 |
| cli() | system.h | 关中断 |
| sti() | system.h | 开中断 |

### 8.3 实现状态总结

```
Linux 0.11 同步机制实现状态：

✅ 已实现：
├── 等待队列 (sleep_on/wake_up)
├── 进程状态 (5种状态)
├── 简单互斥 (cli/sti)
├── 进程调度 (时间片轮转)
└── 管道同步 (生产者-消费者)

❌ 未实现：
├── 自旋锁 (spinlock)
├── 互斥锁 (mutex)
├── 信号量 (semaphore)
├── 读写锁 (rwlock)
├── POLL/SELECT
└── 条件变量 (condition variable)
```