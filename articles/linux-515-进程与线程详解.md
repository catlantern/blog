# Linux 5.15 进程与线程详解

## 目录

1. **`进程与线程的概念`**
2. **`Linux 内核的统一视角`**
3. **`task_struct 结构详解`**
4. **`clone 系统调用：进程和线程的统一入口`**
5. **`fork 系统调用：创建进程`**
6. **`pthread_create：创建线程`**
7. **`进程和线程的本质区别`**
8. **`线程组机制`**
9. **`资源共享详解`**
10. **`实际案例分析`**

---

## 1. 进程与线程的概念

### 1.1 传统定义

```
进程（Process）：
+===========================================================================+
|                                                                           |
|   定义：                                                                  |
|   +-------------------+                                                    |
|   | 资源分配的基本单位 |                                                    |
|   | 拥有独立的地址空间 |                                                    |
|   | 拥有独立的系统资源 |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 独立的虚拟地址空间 |  代码段、数据段、堆、栈                            |
|   | 独立的文件描述符表 |                                                    |
|   | 独立的信号处理     |                                                    |
|   | 独立的工作目录     |                                                    |
|   | 独立的用户 ID      |                                                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+

线程（Thread）：
+===========================================================================+
|                                                                           |
|   定义：                                                                  |
|   +-------------------+                                                    |
|   | CPU 调度的基本单位 |                                                    |
|   | 共享进程的资源     |                                                    |
|   | 拥有独立的执行流   |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 共享虚拟地址空间   |  共享代码段、数据段、堆                           |
|   | 共享文件描述符表   |                                                    |
|   | 共享信号处理       |                                                    |
|   | 独立的栈空间       |  每个线程有自己的栈                               |
|   | 独立的寄存器状态   |  PC、SP、通用寄存器                               |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 1.2 初学者的常见困惑

```
常见困惑：
+===========================================================================+
|                                                                           |
|   困惑 1：进程和线程到底有什么区别？                                      |
|   +-------------------+                                                    |
|   | 看起来都是"执行单元" |                                                 |
|   | 都可以被调度执行     |                                                 |
|   | 都有独立的栈         |                                                 |
|   +-------------------+                                                    |
|                                                                           |
|   困惑 2：为什么说线程是"轻量级进程"？                                    |
|   +-------------------+                                                    |
|   | 创建线程比创建进程快 |                                                 |
|   | 线程切换比进程切换快 |                                                 |
|   | 线程间通信更方便     |                                                 |
|   +-------------------+                                                    |
|                                                                           |
|   困惑 3：Linux 内核如何看待进程和线程？                                  |
|   +-------------------+                                                    |
|   | 内核有"进程"和"线程"的概念吗？ |                                       |
|   | 它们在内核中是如何表示的？     |                                       |
|   | 创建它们的代码有什么不同？     |                                       |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 2. Linux 内核的统一视角

### 2.1 核心观点：一切皆任务

```
Linux 内核的统一视角：
+===========================================================================+
|                                                                           |
|   关键理念：                                                              |
|   +-------------------+                                                    |
|   | 在 Linux 内核中，没有"进程"和"线程"的区别 |                           |
|   | 只有"任务"（Task）的概念                 |                            |
|   | 每个任务都用 task_struct 结构表示        |                            |
|   +-------------------+                                                    |
|                                                                           |
|   统一表示：                                                              |
|   +-------------------+                                                    |
|   | 进程 = 拥有独立资源的任务 |                                              |
|   | 线程 = 共享资源的任务     |                                              |
|   +-------------------+                                                    |
|                                                                           |
|   本质：                                                                  |
|   +-------------------+                                                    |
|   | 进程和线程都是 task_struct 实例 |                                       |
|   | 区别仅在于共享的资源不同       |                                        |
|   | 都通过 clone 系统调用创建      |                                        |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 2.2 为什么这样设计？

```
设计优势：
+===========================================================================+
|                                                                           |
|   1. 代码简洁：                                                           |
|   +-------------------+                                                    |
|   | 统一的数据结构   |  只需要 task_struct                                |
|   | 统一的调度器     |  都用同一个调度器                                  |
|   | 统一的管理机制   |  都用同一套管理代码                                |
|   +-------------------+                                                    |
|                                                                           |
|   2. 灵活性高：                                                           |
|   +-------------------+                                                    |
|   | 可以精确控制共享哪些资源 |                                              |
|   | 通过 clone 标志位实现   |                                               |
|   | 不局限于"进程"或"线程"  |                                               |
|   +-------------------+                                                    |
|                                                                           |
|   3. 性能优化：                                                           |
|   +-------------------+                                                    |
|   | 减少代码重复     |                                                    |
|   | 优化代码路径     |                                                    |
|   | 减少维护成本     |                                                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 3. task_struct 结构详解

### 3.1 task_struct 核心字段

```c
/*
 * task_struct 结构 - Linux 内核中最重要的数据结构
 * 定义在 include/linux/sched.h
 */
struct task_struct {
    /* 
     * 进程/线程标识
     */
    pid_t               pid;            /* 进程/线程 ID */
    pid_t               tgid;           /* 线程组 ID（Thread Group ID）*/
    
    /*
     * 内存管理
     */
    struct mm_struct    *mm;            /* 用户空间内存描述符 */
    struct mm_struct    *active_mm;     /* 活动内存描述符（内核线程使用）*/
    
    /*
     * 文件系统
     */
    struct fs_struct    *fs;            /* 文件系统信息（当前目录等）*/
    struct files_struct *files;         /* 打开的文件描述符表 */
    
    /*
     * 信号处理
     */
    struct signal_struct    *signal;    /* 信号结构（进程级）*/
    struct sighand_struct   *sighand;   /* 信号处理函数表 */
    sigset_t                blocked;    /* 被阻塞的信号 */
    struct sigpending       pending;    /* 私有挂起信号 */
    
    /*
     * 线程组管理
     */
    struct task_struct      *group_leader;  /* 线程组领导者 */
    struct list_head        thread_group;   /* 线程组链表 */
    struct list_head        thread_node;    /* 线程节点 */
    
    /*
     * 进程关系
     */
    struct task_struct __rcu    *real_parent;  /* 真实父进程 */
    struct task_struct __rcu    *parent;       /* 父进程（接收 SIGCHLD）*/
    struct list_head            children;      /* 子进程链表 */
    struct list_head            sibling;       /* 兄弟进程链表 */
    
    /*
     * 调度相关
     */
    int                 prio;           /* 优先级 */
    int                 static_prio;    /* 静态优先级 */
    int                 normal_prio;    /* 正常优先级 */
    unsigned int        rt_priority;    /* 实时优先级 */
    
    const struct sched_class   *sched_class;  /* 调度类 */
    struct sched_entity        se;             /* CFS 调度实体 */
    struct sched_rt_entity     rt;             /* RT 调度实体 */
    
    /*
     * 执行状态
     */
    unsigned int        __state;        /* 任务状态 */
    void                *stack;         /* 内核栈 */
    
    /*
     * 其他重要字段
     */
    char                comm[TASK_COMM_LEN];  /* 命令名 */
    unsigned int        flags;                 /* 任务标志 */
    struct cred __rcu   *cred;                 /* 凭证 */
};
```

### 3.2 pid 和 tgid 的区别

```
pid 和 tgid 的关系：
+===========================================================================+
|                                                                           |
|   pid（Process ID）：                                                     |
|   +-------------------+                                                    |
|   | 每个任务都有唯一的 pid |                                               |
|   | 是内核中的唯一标识     |                                                |
|   | 包括进程和线程         |                                                |
|   +-------------------+                                                    |
|                                                                           |
|   tgid（Thread Group ID）：                                               |
|   +-------------------+                                                    |
|   | 线程组 ID         |                                                    |
|   | 同一线程组的所有线程共享 |                                              |
|   | 等于线程组领导者的 pid   |                                              |
|   +-------------------+                                                    |
|                                                                           |
|   示例：                                                                  |
|   +-------------------+                                                    |
|   | 进程 A（主线程）：pid=1000, tgid=1000 |                                |
|   | 线程 A1：pid=1001, tgid=1000          |                                |
|   | 线程 A2：pid=1002, tgid=1000          |                                |
|   | 线程 A3：pid=1003, tgid=1000          |                                |
|   +-------------------+                                                    |
|   | 进程 B（主线程）：pid=2000, tgid=2000 |                                |
|   | 线程 B1：pid=2001, tgid=2000          |                                |
|   +-------------------+                                                    |
|                                                                           |
|   用户视角：                                                              |
|   +-------------------+                                                    |
|   | 用户看到的"进程 ID" = tgid |                                           |
|   | 用户看到的"线程 ID" = pid  |                                           |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 3.3 关键代码：获取进程 ID

```c
/*
 * 获取进程 ID（用户视角）
 * 定义在 include/linux/sched.h
 */
static inline pid_t task_pid_nr_ns(struct task_struct *tsk, struct pid_namespace *ns)
{
    return pid_nr_ns(task_pid(tsk), ns);
}

/*
 * 获取线程组 ID（用户视角的进程 ID）
 */
static inline pid_t task_tgid_nr_ns(struct task_struct *tsk, struct pid_namespace *ns)
{
    return pid_nr_ns(task_tgid(tsk), ns);
}

/*
 * 用户空间 getpid() 的内核实现
 * 返回 tgid
 */
SYSCALL_DEFINE0(getpid)
{
    return task_tgid_vnr(current);
}

/*
 * 用户空间 gettid() 的内核实现
 * 返回 pid
 */
SYSCALL_DEFINE0(gettid)
{
    return task_pid_vnr(current);
}
```

---

## 4. clone 系统调用：进程和线程的统一入口

### 4.1 clone 系统调用定义

```c
/*
 * clone 系统调用 - 创建进程和线程的统一入口
 * 定义在 kernel/fork.c
 */
#ifdef __ARCH_WANT_SYS_CLONE
SYSCALL_DEFINE5(clone, unsigned long, clone_flags, unsigned long, newsp,
         int __user *, parent_tidptr,
         unsigned long, tls,
         int __user *, child_tidptr)
{
    struct kernel_clone_args args = {
        .flags      = (lower_32_bits(clone_flags) & ~CSIGNAL),
        .pidfd      = parent_tidptr,
        .child_tid  = child_tidptr,
        .parent_tid = parent_tidptr,
        .exit_signal = (lower_32_bits(clone_flags) & CSIGNAL),
        .stack      = newsp,
        .tls        = tls,
    };

    return kernel_clone(&args);
}
#endif
```

### 4.2 clone 标志位详解

```c
/*
 * clone 标志位定义
 * 定义在 include/uapi/linux/sched.h
 */

/* 资源共享标志 */
#define CLONE_VM        0x00000100  /* 共享虚拟内存空间 */
#define CLONE_FS        0x00000200  /* 共享文件系统信息 */
#define CLONE_FILES     0x00000400  /* 共享文件描述符表 */
#define CLONE_SIGHAND   0x00000800  /* 共享信号处理函数 */

/* 线程相关标志 */
#define CLONE_THREAD    0x00010000  /* 加入相同的线程组 */
#define CLONE_SYSVSEM   0x00040000  /* 共享 System V 信号量 */

/* 父子关系标志 */
#define CLONE_PARENT    0x00008000  /* 与调用者有相同的父进程 */
#define CLONE_VFORK     0x00004000  /* 父进程等待子进程结束 */

/* 其他标志 */
#define CLONE_PTRACE    0x00002000  /* 继续被 ptrace 跟踪 */
#define CLONE_UNTRACED  0x00800000  /* 不被 ptrace 跟踪 */
#define CLONE_SETTLS    0x00080000  /* 设置 TLS */
#define CLONE_IO        0x80000000  /* 共享 I/O 上下文 */
```

### 4.3 clone 标志位的作用

```
clone 标志位的作用：
+===========================================================================+
|                                                                           |
|   CLONE_VM：共享虚拟内存空间                                              |
|   +-------------------+                                                    |
|   | 设置：子任务共享父任务的 mm_struct |                                   |
|   | 不设置：复制父任务的 mm_struct     |                                   |
|   | 线程必须设置，进程不设置           |                                   |
|   +-------------------+                                                    |
|                                                                           |
|   CLONE_FS：共享文件系统信息                                              |
|   +-------------------+                                                    |
|   | 设置：共享 fs_struct（当前目录等）|                                    |
|   | 不设置：复制 fs_struct            |                                    |
|   | 线程通常设置，进程不设置           |                                   |
|   +-------------------+                                                    |
|                                                                           |
|   CLONE_FILES：共享文件描述符表                                           |
|   +-------------------+                                                    |
|   | 设置：共享 files_struct           |                                    |
|   | 不设置：复制 files_struct         |                                    |
|   | 线程通常设置，进程不设置           |                                   |
|   +-------------------+                                                    |
|                                                                           |
|   CLONE_SIGHAND：共享信号处理函数                                         |
|   +-------------------+                                                    |
|   | 设置：共享 sighand_struct         |                                    |
|   | 不设置：复制 sighand_struct       |                                    |
|   | 线程必须设置，进程不设置           |                                   |
|   +-------------------+                                                    |
|                                                                           |
|   CLONE_THREAD：加入相同的线程组                                          |
|   +-------------------+                                                    |
|   | 设置：加入父任务的线程组           |                                    |
|   | 不设置：创建新的线程组             |                                    |
|   | 线程必须设置，进程不设置           |                                   |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 4.4 kernel_clone 函数

```c
/*
 * kernel_clone - 创建新任务的核心函数
 * 定义在 kernel/fork.c
 */
pid_t kernel_clone(struct kernel_clone_args *args)
{
    u64 clone_flags = args->flags;
    struct completion vfork;
    struct pid *pid;
    struct task_struct *p;
    int trace = 0;
    pid_t nr;

    /* 检查标志位的合法性 */
    if ((args->flags & CLONE_PIDFD) &&
        (args->flags & CLONE_PARENT_SETTID) &&
        (args->pidfd == args->parent_tid))
        return -EINVAL;

    /* 确定 ptrace 事件 */
    if (!(clone_flags & CLONE_UNTRACED)) {
        if (clone_flags & CLONE_VFORK)
            trace = PTRACE_EVENT_VFORK;
        else if (args->exit_signal != SIGCHLD)
            trace = PTRACE_EVENT_CLONE;
        else
            trace = PTRACE_EVENT_FORK;

        if (likely(!ptrace_event_enabled(current, trace)))
            trace = 0;
    }

    /* 
     * 核心操作：复制进程
     * 这是创建进程/线程的关键步骤
     */
    p = copy_process(NULL, trace, NUMA_NO_NODE, args);
    add_latent_entropy();

    if (IS_ERR(p))
        return PTR_ERR(p);

    trace_sched_process_fork(current, p);

    pid = get_task_pid(p, PIDTYPE_PID);
    nr = pid_vnr(pid);

    if (clone_flags & CLONE_PARENT_SETTID)
        put_user(nr, args->parent_tid);

    /* vfork 处理 */
    if (clone_flags & CLONE_VFORK) {
        p->vfork_done = &vfork;
        init_completion(&vfork);
        get_task_struct(p);
    }

    /* 唤醒新任务 */
    wake_up_new_task(p);

    if (unlikely(trace))
        ptrace_event_pid(trace, pid);

    /* 等待 vfork 完成 */
    if (clone_flags & CLONE_VFORK) {
        if (!wait_for_vfork_done(p, &vfork))
            ptrace_event_pid(PTRACE_EVENT_VFORK_DONE, pid);
    }

    put_pid(pid);
    return nr;
}
```

---

## 5. fork 系统调用：创建进程

### 5.1 fork 系统调用定义

```c
/*
 * fork 系统调用 - 创建进程
 * 定义在 kernel/fork.c
 */
#ifdef __ARCH_WANT_SYS_FORK
SYSCALL_DEFINE0(fork)
{
#ifdef CONFIG_MMU
    struct kernel_clone_args args = {
        .exit_signal = SIGCHLD,  /* 子进程退出时发送 SIGCHLD */
    };

    return kernel_clone(&args);
#else
    return -EINVAL;
#endif
}
#endif
```

### 5.2 fork 的特点

```
fork 的特点：
+===========================================================================+
|                                                                           |
|   fork() 等价于：                                                         |
|   +-------------------+                                                    |
|   | clone(SIGCHLD)    |  只传递退出信号，不传递任何共享标志               |
|   +-------------------+                                                    |
|                                                                           |
|   创建的进程特点：                                                        |
|   +-------------------+                                                    |
|   | 独立的虚拟地址空间 |  不设置 CLONE_VM                                 |
|   | 独立的文件系统信息 |  不设置 CLONE_FS                                 |
|   | 独立的文件描述符表 |  不设置 CLONE_FILES                              |
|   | 独立的信号处理     |  不设置 CLONE_SIGHAND                           |
|   | 新的线程组         |  不设置 CLONE_THREAD                            |
|   | 父进程是调用者     |  不设置 CLONE_PARENT                            |
|   +-------------------+                                                    |
|                                                                           |
|   资源复制：                                                              |
|   +-------------------+                                                    |
|   | 复制父进程的所有资源 |  通过 copy_xxx 函数实现                        |
|   | 使用写时复制（COW） |  延迟复制，提高效率                              |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 5.3 copy_process 函数详解

```c
/*
 * copy_process - 复制进程的核心函数
 * 定义在 kernel/fork.c
 */
static __latent_entropy struct task_struct *copy_process(
                    struct pid *pid,
                    int trace,
                    int node,
                    struct kernel_clone_args *args)
{
    int pidfd = -1, retval;
    struct task_struct *p;
    u64 clone_flags = args->flags;

    /* 
     * 标志位合法性检查
     */
    
    /* CLONE_THREAD 需要 CLONE_SIGHAND */
    if ((clone_flags & CLONE_THREAD) && !(clone_flags & CLONE_SIGHAND))
        return ERR_PTR(-EINVAL);

    /* CLONE_SIGHAND 需要 CLONE_VM */
    if ((clone_flags & CLONE_SIGHAND) && !(clone_flags & CLONE_VM))
        return ERR_PTR(-EINVAL);

    /* 分配 task_struct */
    p = dup_task_struct(current, node);
    if (!p)
        goto fork_out;

    /* 复制各种资源 */
    retval = copy_creds(p, clone_flags);
    if (retval < 0)
        goto bad_fork_free;

    /* 复制文件描述符表 */
    retval = copy_files(clone_flags, p);
    if (retval)
        goto bad_fork_cleanup_semundo;

    /* 复制文件系统信息 */
    retval = copy_fs(clone_flags, p);
    if (retval)
        goto bad_fork_cleanup_files;

    /* 复制信号处理函数 */
    retval = copy_sighand(clone_flags, p);
    if (retval)
        goto bad_fork_cleanup_fs;

    /* 复制信号结构 */
    retval = copy_signal(clone_flags, p);
    if (retval)
        goto bad_fork_cleanup_sighand;

    /* 复制内存管理结构 */
    retval = copy_mm(clone_flags, p);
    if (retval)
        goto bad_fork_cleanup_signal;

    /* 设置线程组关系 */
    if (likely(p->pid)) {
        if (thread_group_leader(p)) {
            /* 新进程：创建新的线程组 */
            init_task_pid(p, PIDTYPE_TGID, pid);
            init_task_pid(p, PIDTYPE_PGID, task_pgrp(current));
            init_task_pid(p, PIDTYPE_SID, task_session(current));
            
            p->signal->tty = tty_kref_get(current->signal->tty);
            list_add_tail(&p->sibling, &p->real_parent->children);
            
            attach_pid(p, PIDTYPE_TGID);
            attach_pid(p, PIDTYPE_PGID);
            attach_pid(p, PIDTYPE_SID);
        } else {
            /* 新线程：加入现有线程组 */
            current->signal->nr_threads++;
            atomic_inc(&current->signal->live);
            refcount_inc(&current->signal->sigcnt);
            
            list_add_tail_rcu(&p->thread_group,
                      &p->group_leader->thread_group);
            list_add_tail_rcu(&p->thread_node,
                      &p->signal->thread_head);
        }
        attach_pid(p, PIDTYPE_PID);
        nr_threads++;
    }

    return p;
}
```

---

## 6. pthread_create：创建线程

### 6.1 pthread_create 的实现

```
pthread_create 的实现路径：
+===========================================================================+
|                                                                           |
|   用户空间：                                                              |
|   +-------------------+                                                    |
|   | pthread_create()  |  POSIX 线程库函数                                 |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | clone() 系统调用  |  传递特定的标志位                                 |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | kernel_clone()    |  内核函数                                         |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | copy_process()    |  根据标志位复制资源                               |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 6.2 pthread_create 使用的 clone 标志

```c
/*
 * pthread_create 使用的 clone 标志
 * 定义在 glibc 源码中
 */

/* 
 * 创建线程时的典型标志组合
 */
#define CLONE_FLAGS_FOR_THREAD ( \
    CLONE_VM        |   /* 共享虚拟内存空间 */ \
    CLONE_FS        |   /* 共享文件系统信息 */ \
    CLONE_FILES     |   /* 共享文件描述符表 */ \
    CLONE_SIGHAND   |   /* 共享信号处理函数 */ \
    CLONE_THREAD    |   /* 加入相同的线程组 */ \
    CLONE_SYSVSEM   |   /* 共享 System V 信号量 */ \
    CLONE_SETTLS    |   /* 设置 TLS */ \
    CLONE_PARENT_SETTID | /* 设置父线程的 TID */ \
    CLONE_CHILD_CLEARTID | /* 清除子线程的 TID */ \
    0)

/*
 * 对比：创建进程时的标志
 */
#define CLONE_FLAGS_FOR_PROCESS (0)  /* fork() 不传递任何共享标志 */
```

### 6.3 线程创建的关键代码

```c
/*
 * copy_mm - 复制内存管理结构
 * 定义在 kernel/fork.c
 */
static int copy_mm(unsigned long clone_flags, struct task_struct *tsk)
{
    struct mm_struct *mm, *oldmm;

    tsk->mm = NULL;
    tsk->active_mm = NULL;

    oldmm = current->mm;
    if (!oldmm)
        return 0;

    vmacache_flush(tsk);

    /* 
     * CLONE_VM 标志：线程共享内存空间
     * 不设置：进程复制内存空间
     */
    if (clone_flags & CLONE_VM) {
        /* 线程：共享父进程的 mm_struct */
        mmget(oldmm);
        mm = oldmm;
    } else {
        /* 进程：复制 mm_struct */
        mm = dup_mm(tsk, current->mm);
        if (!mm)
            return -ENOMEM;
    }

    tsk->mm = mm;
    tsk->active_mm = mm;
    return 0;
}

/*
 * copy_files - 复制文件描述符表
 * 定义在 kernel/fork.c
 */
static int copy_files(unsigned long clone_flags, struct task_struct *tsk)
{
    struct files_struct *oldf, *newf;

    oldf = current->files;
    if (!oldf)
        return 0;

    /* 
     * CLONE_FILES 标志：线程共享文件描述符表
     * 不设置：进程复制文件描述符表
     */
    if (clone_flags & CLONE_FILES) {
        /* 线程：共享文件描述符表 */
        atomic_inc(&oldf->count);
        return 0;
    }

    /* 进程：复制文件描述符表 */
    newf = dup_fd(oldf, NULL);
    if (IS_ERR(newf))
        return PTR_ERR(newf);

    tsk->files = newf;
    return 0;
}

/*
 * copy_sighand - 复制信号处理函数
 * 定义在 kernel/fork.c
 */
static int copy_sighand(u64 clone_flags, struct task_struct *tsk)
{
    struct sighand_struct *sig;

    /* 
     * CLONE_SIGHAND 标志：线程共享信号处理函数
     * 不设置：进程复制信号处理函数
     */
    if (clone_flags & CLONE_SIGHAND) {
        /* 线程：共享信号处理函数表 */
        refcount_inc(&current->sighand->count);
        return 0;
    }

    /* 进程：复制信号处理函数表 */
    sig = kmem_cache_alloc(sighand_cachep, GFP_KERNEL);
    RCU_INIT_POINTER(tsk->sighand, sig);
    if (!sig)
        return -ENOMEM;

    refcount_set(&sig->count, 1);
    spin_lock_irq(&current->sighand->siglock);
    memcpy(sig->action, current->sighand->action, sizeof(sig->action));
    spin_unlock_irq(&current->sighand->siglock);

    return 0;
}

/*
 * copy_signal - 复制信号结构
 * 定义在 kernel/fork.c
 */
static int copy_signal(unsigned long clone_flags, struct task_struct *tsk)
{
    struct signal_struct *sig;

    /* 
     * CLONE_THREAD 标志：线程共享信号结构
     * 不设置：进程创建新的信号结构
     */
    if (clone_flags & CLONE_THREAD)
        return 0;

    /* 进程：创建新的信号结构 */
    sig = kmem_cache_zalloc(signal_cachep, GFP_KERNEL);
    tsk->signal = sig;
    if (!sig)
        return -ENOMEM;

    sig->nr_threads = 1;
    atomic_set(&sig->live, 1);
    refcount_set(&sig->sigcnt, 1);

    sig->thread_head = (struct list_head)LIST_HEAD_INIT(tsk->thread_node);
    tsk->thread_node = (struct list_head)LIST_HEAD_INIT(sig->thread_head);

    init_waitqueue_head(&sig->wait_chldexit);
    sig->curr_target = tsk;
    init_sigpending(&sig->shared_pending);

    memcpy(sig->rlim, current->signal->rlim, sizeof sig->rlim);

    return 0;
}
```

---

## 7. 进程和线程的本质区别

### 7.1 资源共享对比

```
资源共享对比表：
+===========================================================================+
|                                                                           |
|   资源类型         | 进程（fork）      | 线程（pthread_create）         |
|   +-------------------+-------------------+                               |
|   虚拟地址空间     | 独立（复制）      | 共享                           |
|   文件描述符表     | 独立（复制）      | 共享                           |
|   文件系统信息     | 独立（复制）      | 共享                           |
|   信号处理函数     | 独立（复制）      | 共享                           |
|   信号结构         | 独立（新建）      | 共享                           |
|   线程组           | 新建              | 加入现有                       |
|   栈空间           | 独立              | 独立                           |
|   寄存器状态       | 独立              | 独立                           |
|   线程 ID          | 独立              | 独立                           |
|                                                                           |
+===========================================================================+
```

### 7.2 clone 标志对比

```
clone 标志对比：
+===========================================================================+
|                                                                           |
|   fork() 等价于：                                                         |
|   +-------------------+                                                    |
|   | clone(SIGCHLD)    |                                                    |
|   +-------------------+                                                    |
|   | 不设置任何共享标志 |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   pthread_create() 等价于：                                               |
|   +-------------------+                                                    |
|   | clone(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND |             |
|   |       CLONE_THREAD | CLONE_SYSVSEM | CLONE_SETTLS |                   |
|   |       CLONE_PARENT_SETTID | CLONE_CHILD_CLEARTID, ...)                |
|   +-------------------+                                                    |
|   | 设置多个共享标志   |                                                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 7.3 本质区别总结

```
本质区别：
+===========================================================================+
|                                                                           |
|   1. clone 标志不同：                                                     |
|   +-------------------+                                                    |
|   | 进程：不设置共享标志 |  资源独立                                       |
|   | 线程：设置共享标志   |  资源共享                                       |
|   +-------------------+                                                    |
|                                                                           |
|   2. 线程组关系不同：                                                     |
|   +-------------------+                                                    |
|   | 进程：创建新的线程组 |  tgid = pid                                    |
|   | 线程：加入现有线程组 |  tgid = group_leader->pid                      |
|   +-------------------+                                                    |
|                                                                           |
|   3. 资源管理不同：                                                       |
|   +-------------------+                                                    |
|   | 进程：独立管理资源   |  各自的生命周期                                 |
|   | 线程：共享管理资源   |  生命周期与进程绑定                             |
|   +-------------------+                                                    |
|                                                                           |
|   4. 退出行为不同：                                                       |
|   +-------------------+                                                    |
|   | 进程：exit() 通知父进程 |  发送 SIGCHLD                               |
|   | 线程：pthread_exit() |  不发送信号，只是线程结束                       |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 8. 线程组机制

### 8.1 线程组的概念

```
线程组（Thread Group）：
+===========================================================================+
|                                                                           |
|   定义：                                                                  |
|   +-------------------+                                                    |
|   | 一组共享相同资源的线程 |                                               |
|   | 由 CLONE_THREAD 标志创建 |                                             |
|   | 有一个线程组领导者     |                                                |
|   +-------------------+                                                    |
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 所有线程有相同的 tgid |  等于领导者的 pid                              |
|   | 共享信号结构         |  struct signal_struct                          |
|   | 共享信号处理函数     |  struct sighand_struct                         |
|   | 共享内存空间         |  struct mm_struct                              |
|   +-------------------+                                                    |
|                                                                           |
|   示例：                                                                  |
|   +-------------------+                                                    |
|   | 主线程（领导者）：pid=1000, tgid=1000 |                                |
|   | 线程 1：pid=1001, tgid=1000            |                                |
|   | 线程 2：pid=1002, tgid=1000            |                                |
|   | 线程 3：pid=1003, tgid=1000            |                                |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 8.2 线程组领导者的作用

```c
/*
 * 线程组领导者的判断
 * 定义在 include/linux/sched.h
 */
static inline int thread_group_leader(struct task_struct *p)
{
    return p->pid == p->tgid;
}

/*
 * 线程组领导者的作用
 */
/*
 * 1. 代表整个线程组
 *    - 用户看到的进程 ID = tgid = 领导者的 pid
 *    - 信号发送给整个线程组时，由领导者处理
 */

/*
 * 2. 管理线程组资源
 *    - signal_struct 由领导者创建
 *    - 线程组结束时，领导者负责清理
 */

/*
 * 3. 进程关系
 *    - 领导者的父进程是整个线程组的父进程
 *    - 领导者退出时，通知父进程
 */
```

### 8.3 线程组链表管理

```c
/*
 * 线程组链表管理
 * 定义在 include/linux/sched.h
 */
struct task_struct {
    /* ... */
    
    struct task_struct      *group_leader;  /* 线程组领导者 */
    struct list_head        thread_group;   /* 线程组链表 */
    struct list_head        thread_node;    /* 线程节点 */
    
    /* ... */
};

/*
 * 遍历线程组中的所有线程
 */
#define for_each_thread(thread, t) \
    list_for_each_entry_rcu(t, &thread->signal->thread_head, thread_node)

/*
 * 获取线程组中的第一个线程
 */
#define first_thread(thread) \
    list_first_entry_rcu(&thread->signal->thread_head, struct task_struct, thread_node)
```

---

## 9. 资源共享详解

### 9.1 内存空间共享

```
内存空间共享：
+===========================================================================+
|                                                                           |
|   进程（不设置 CLONE_VM）：                                               |
|   +-------------------+                                                    |
|   | 父进程            |                                                    |
|   | +---------------+ |                                                    |
|   | | mm_struct     | |                                                    |
|   | | 代码段        | |                                                    |
|   | | 数据段        | |                                                    |
|   | | 堆            | |                                                    |
|   | | 栈            | |                                                    |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           | dup_mm()                                                      |
|           v                                                               |
|   +-------------------+                                                    |
|   | 子进程            |                                                    |
|   | +---------------+ |                                                    |
|   | | mm_struct     | |  独立的内存空间                                   |
|   | | 代码段(COW)   | |                                                    |
|   | | 数据段(COW)   | |                                                    |
|   | | 堆(COW)       | |                                                    |
|   | | 栈(复制)      | |                                                    |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   线程（设置 CLONE_VM）：                                                 |
|   +-------------------+                                                    |
|   | 主线程            |                                                    |
|   | +---------------+ |                                                    |
|   | | mm_struct     | |                                                    |
|   | | 代码段        | |                                                    |
|   | | 数据段        | |                                                    |
|   | | 堆            | |                                                    |
|   | | 栈            | |                                                    |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|           ^                                                               |
|           | 共享                                                          |
|           |                                                               |
|   +-------------------+                                                    |
|   | 新线程            |                                                    |
|   | +---------------+ |                                                    |
|   | | 独立的栈      | |  只有自己的栈                                     |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 9.2 文件描述符表共享

```
文件描述符表共享：
+===========================================================================+
|                                                                           |
|   进程（不设置 CLONE_FILES）：                                            |
|   +-------------------+                                                    |
|   | 父进程            |                                                    |
|   | +---------------+ |                                                    |
|   | | files_struct  | |                                                    |
|   | | fd[0]: stdin  | |                                                    |
|   | | fd[1]: stdout | |                                                    |
|   | | fd[2]: stderr | |                                                    |
|   | | fd[3]: file1  | |                                                    |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           | dup_fd()                                                      |
|           v                                                               |
|   +-------------------+                                                    |
|   | 子进程            |                                                    |
|   | +---------------+ |                                                    |
|   | | files_struct  | |  独立的文件描述符表                               |
|   | | fd[0]: stdin  | |  指向相同的文件                                   |
|   | | fd[1]: stdout | |                                                    |
|   | | fd[2]: stderr | |                                                    |
|   | | fd[3]: file1  | |                                                    |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   线程（设置 CLONE_FILES）：                                              |
|   +-------------------+                                                    |
|   | 主线程            |                                                    |
|   | +---------------+ |                                                    |
|   | | files_struct  | |                                                    |
|   | | fd[0]: stdin  | |                                                    |
|   | | fd[1]: stdout | |                                                    |
|   | | fd[2]: stderr | |                                                    |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|           ^                                                               |
|           | 共享                                                          |
|           |                                                               |
|   +-------------------+                                                    |
|   | 新线程            |                                                    |
|   | (无独立 files_struct) |  直接使用主线程的文件描述符表                  |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 9.3 信号处理共享

```
信号处理共享：
+===========================================================================+
|                                                                           |
|   进程（不设置 CLONE_SIGHAND）：                                          |
|   +-------------------+                                                    |
|   | 父进程            |                                                    |
|   | +---------------+ |                                                    |
|   | | sighand_struct| |                                                    |
|   | | SIGINT: handler1 |                                                   |
|   | | SIGTERM: handler2 |                                                  |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           | 复制                                                          |
|           v                                                               |
|   +-------------------+                                                    |
|   | 子进程            |                                                    |
|   | +---------------+ |                                                    |
|   | | sighand_struct| |  独立的信号处理函数表                             |
|   | | SIGINT: handler1 |  初始相同，但可以独立修改                         |
|   | | SIGTERM: handler2 |                                                  |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   线程（设置 CLONE_SIGHAND）：                                            |
|   +-------------------+                                                    |
|   | 主线程            |                                                    |
|   | +---------------+ |                                                    |
|   | | sighand_struct| |                                                    |
|   | | SIGINT: handler1 |                                                   |
|   | | SIGTERM: handler2 |                                                  |
|   | +---------------+ |                                                    |
|   +-------------------+                                                    |
|           ^                                                               |
|           | 共享                                                          |
|           |                                                               |
|   +-------------------+                                                    |
|   | 新线程            |                                                    |
|   | (无独立 sighand_struct) |  直接使用主线程的信号处理函数表              |
|   +-------------------+                                                    |
|                                                                           |
|   注意：任何线程修改信号处理函数，都会影响所有线程                       |
|                                                                           |
+===========================================================================+
```

---

## 10. 实际案例分析

### 10.1 创建进程的完整流程

```c
/*
 * 示例：使用 fork() 创建进程
 */
#include <stdio.h>
#include <unistd.h>
#include <sys/types.h>

int main()
{
    pid_t pid;
    
    printf("Before fork: pid=%d, tgid=%d\n", getpid(), gettid());
    
    pid = fork();  /* 调用 fork 系统调用 */
    
    if (pid < 0) {
        perror("fork failed");
        return 1;
    } else if (pid == 0) {
        /* 子进程 */
        printf("Child process: pid=%d, ppid=%d\n", getpid(), getppid());
        
        /* 子进程有独立的地址空间 */
        /* 修改全局变量不会影响父进程 */
    } else {
        /* 父进程 */
        printf("Parent process: pid=%d, child_pid=%d\n", getpid(), pid);
    }
    
    return 0;
}

/*
 * 内核执行流程：
 * 
 * 1. 用户调用 fork()
 *    |
 *    v
 * 2. 系统调用入口
 *    SYSCALL_DEFINE0(fork)
 *    |
 *    v
 * 3. 调用 kernel_clone()
 *    args.exit_signal = SIGCHLD
 *    args.flags = 0 (不设置任何共享标志)
 *    |
 *    v
 * 4. 调用 copy_process()
 *    - dup_task_struct(): 复制 task_struct
 *    - copy_mm(): 复制 mm_struct (不设置 CLONE_VM)
 *    - copy_files(): 复制 files_struct (不设置 CLONE_FILES)
 *    - copy_fs(): 复制 fs_struct (不设置 CLONE_FS)
 *    - copy_sighand(): 复制 sighand_struct (不设置 CLONE_SIGHAND)
 *    - copy_signal(): 创建新的 signal_struct (不设置 CLONE_THREAD)
 *    |
 *    v
 * 5. 设置线程组关系
 *    - thread_group_leader(p) 为真
 *    - 创建新的线程组
 *    - tgid = pid
 *    |
 *    v
 * 6. wake_up_new_task(): 唤醒新进程
 */
```

### 10.2 创建线程的完整流程

```c
/*
 * 示例：使用 pthread_create() 创建线程
 */
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/syscall.h>

void* thread_func(void* arg)
{
    printf("Thread: pid=%d, tid=%ld, tgid=%d\n", 
           getpid(), syscall(SYS_gettid), getpid());
    
    /* 线程共享进程的地址空间 */
    /* 可以直接访问进程的全局变量 */
    
    return NULL;
}

int main()
{
    pthread_t thread;
    
    printf("Main thread: pid=%d, tid=%ld\n", 
           getpid(), syscall(SYS_gettid));
    
    /* 创建新线程 */
    pthread_create(&thread, NULL, thread_func, NULL);
    
    /* 等待线程结束 */
    pthread_join(thread, NULL);
    
    return 0;
}

/*
 * 内核执行流程：
 * 
 * 1. 用户调用 pthread_create()
 *    |
 *    v
 * 2. glibc 调用 clone 系统调用
 *    clone(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND |
 *          CLONE_THREAD | CLONE_SYSVSEM | CLONE_SETTLS |
 *          CLONE_PARENT_SETTID | CLONE_CHILD_CLEARTID, ...)
 *    |
 *    v
 * 3. 系统调用入口
 *    SYSCALL_DEFINE5(clone, ...)
 *    |
 *    v
 * 4. 调用 kernel_clone()
 *    args.flags = CLONE_VM | CLONE_FS | CLONE_FILES | ...
 *    |
 *    v
 * 5. 调用 copy_process()
 *    - dup_task_struct(): 复制 task_struct
 *    - copy_mm(): 共享 mm_struct (设置 CLONE_VM)
 *    - copy_files(): 共享 files_struct (设置 CLONE_FILES)
 *    - copy_fs(): 共享 fs_struct (设置 CLONE_FS)
 *    - copy_sighand(): 共享 sighand_struct (设置 CLONE_SIGHAND)
 *    - copy_signal(): 不创建新的 signal_struct (设置 CLONE_THREAD)
 *    |
 *    v
 * 6. 设置线程组关系
 *    - thread_group_leader(p) 为假
 *    - 加入现有线程组
 *    - tgid = current->tgid
 *    - group_leader = current->group_leader
 *    |
 *    v
 * 7. wake_up_new_task(): 唤醒新线程
 */
```

### 10.3 查看进程和线程的信息

```bash
# 查看进程的线程信息
ps -eLf

# 输出示例：
# UID   PID  PPID  LWP  C NLWP STIME TTY          TIME CMD
# root  1234  1    1234 0    3 10:00 ?        00:00:01 ./myprogram
# root  1234  1    1235 0    3 10:00 ?        00:00:00 ./myprogram
# root  1234  1    1236 0    3 10:00 ?        00:00:00 ./myprogram

# 解释：
# PID = TGID（线程组 ID）
# LWP = TID（线程 ID）
# NLWP = 线程数量

# 查看进程的线程
ls /proc/<pid>/task/

# 查看线程的详细信息
cat /proc/<pid>/task/<tid>/status

# 查看线程的栈
cat /proc/<pid>/task/<tid>/stack
```

---

## 总结

### 核心要点

1. **Linux 内核的统一视角**：
   - 进程和线程都是 task_struct 实例
   - 区别仅在于共享的资源不同
   - 都通过 clone 系统调用创建

2. **clone 标志决定资源共享**：
   - fork()：不设置共享标志，创建独立进程
   - pthread_create()：设置共享标志，创建共享线程

3. **线程组机制**：
   - 同一线程组的线程共享 tgid
   - 线程组领导者代表整个线程组
   - 共享 signal_struct 和 sighand_struct

4. **资源共享的本质**：
   - 通过指针共享，而非复制
   - 引用计数管理生命周期
   - 修改会影响所有共享者

5. **pid 和 tgid 的区别**：
   - pid：内核中的唯一标识
   - tgid：用户看到的进程 ID
   - 线程：pid 不同，tgid 相同

### 关键代码位置

| 功能 | 文件 |
|------|------|
| task_struct 定义 | **`include/linux/sched.h`** |
| clone 系统调用 | **`kernel/fork.c`** |
| fork 系统调用 | **`kernel/fork.c`** |
| kernel_clone 函数 | **`kernel/fork.c`** |
| copy_process 函数 | **`kernel/fork.c`** |
| copy_mm 函数 | **`kernel/fork.c`** |
| copy_files 函数 | **`kernel/fork.c`** |
| copy_sighand 函数 | **`kernel/fork.c`** |
| copy_signal 函数 | **`kernel/fork.c`** |
| clone 标志定义 | **`include/uapi/linux/sched.h`** |
