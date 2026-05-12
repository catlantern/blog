# Linux 5.15 信号机制详解

## 目录

1. **`问题：为什么需要信号？`**
2. **`解决方案：信号机制`**
3. **`信号的定义与分类`**
4. **`核心数据结构`**
5. **`信号发送流程`**
6. **`信号处理流程`**
7. **`信号帧与用户栈`**
8. **`实时信号机制`**
9. **`线程与信号`**
10. **`信号的安全与权限`**
11. **`信号的设计哲学`**

---

## 1. 问题：为什么需要信号？

### 1.1 进程间通信的需求

```
场景一：用户想终止一个正在运行的程序

+-------------------+
| 用户按下 Ctrl+C   |
+-------------------+
         |
         v
+-------------------+
| 如何通知进程？    |
+-------------------+

传统方式的问题：
1. 进程不知道用户想终止它
2. 进程可能在执行关键操作
3. 需要一种机制通知进程
```

### 1.2 异步事件处理的需求

```
场景二：子进程终止，父进程需要知道

+-------------------+
| 子进程终止        |
+-------------------+
         |
         v
+-------------------+
| 如何通知父进程？  |
+-------------------+

传统方式的问题：
1. 父进程可能在忙其他事
2. 父进程可能阻塞等待
3. 需要一种异步通知机制
```

### 1.3 异常处理的需求

```
场景三：程序访问非法内存地址

+-------------------+
| 访问 NULL 指针    |
+-------------------+
         |
         v
+-------------------+
| 如何处理异常？    |
+-------------------+

传统方式的问题：
1. 程序不知道发生了异常
2. 需要一种机制捕获异常
3. 可能需要清理资源
```

---

## 2. 解决方案：信号机制

### 2.1 信号的核心思想

> **信号是一种异步通知机制，用于通知进程发生了某个事件**

### 2.2 信号的特点

```
信号的特点：
+-------------------+
| 1. 异步性         |  --> 进程不知道何时会收到信号
+-------------------+
         |
         v
+-------------------+
| 2. 简单性         |  --> 只携带信号编号（和可选信息）
+-------------------+
         |
         v
+-------------------+
| 3. 灵活性         |  --> 进程可以自定义处理方式
+-------------------+
         |
         v
+-------------------+
| 4. 强制性         |  --> 某些信号不能被忽略
+-------------------+
```

### 2.3 信号的生命周期

```
信号的生命周期：
+--------+     +--------+     +--------+     +--------+
| 信号   |---->| 信号   |---->| 信号   |---->| 信号   |
| 产生   |     | 发送   |     | 等待   |     | 处理   |
+--------+     +--------+     +--------+     +--------+
    |              |              |              |
    v              v              v              v
 硬件异常      kill()        pending 队列   do_signal()
 键盘输入      内核发送       位图记录       用户处理函数
 软件条件
 定时器
```

### 2.4 信号机制架构

```
+===========================================================================+
|                           用户空间                                         |
+===========================================================================+
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | 应用程序          |   | 信号处理函数      |   | Shell             |   |
|   | kill(), signal()  |   | sa_handler        |   | Ctrl+C, Ctrl+Z    |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
+===========================================================================+
                                    |
                                    | 系统调用
                                    v
+===========================================================================+
|                           内核空间                                         |
+===========================================================================+
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | 系统调用层        |   | 信号发送          |   | 信号处理          |   |
|   | sys_kill()        |   | __send_signal()   |   | get_signal()      |   |
|   | sys_sigaction()   |   | do_send_sig_info()|   | handle_signal()   |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | 数据结构          |   | 信号队列          |   | 信号帧            |   |
|   | signal_struct     |   | sigpending        |   | sigframe          |   |
|   | sighand_struct    |   | sigqueue          |   | sigcontext        |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
+===========================================================================+
                                    |
                                    | 硬件异常/中断
                                    v
+===========================================================================+
|                           硬件层                                           |
+===========================================================================+
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | CPU 异常          |   | 键盘中断          |   | 定时器中断        |   |
|   | 除零、段错误      |   | Ctrl+C            |   | alarm()           |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
+===========================================================================+
```

---

## 3. 信号的定义与分类

### 3.1 标准信号（1-31）

```c
/* 定义在 include/uapi/asm-generic/signal.h */

#define SIGHUP           1      /* 挂起，终端关闭时发送 */
#define SIGINT           2      /* 中断，Ctrl+C */
#define SIGQUIT          3      /* 退出，Ctrl+\，产生核心转储 */
#define SIGILL           4      /* 非法指令 */
#define SIGTRAP          5      /* 跟踪陷阱，调试器使用 */
#define SIGABRT          6      /* 异常终止，abort() */
#define SIGBUS           7      /* 总线错误，内存对齐问题 */
#define SIGFPE           8      /* 浮点异常，除零 */
#define SIGKILL          9      /* 强制终止，不能捕获 */
#define SIGUSR1         10      /* 用户自定义 1 */
#define SIGSEGV         11      /* 段错误，非法内存访问 */
#define SIGUSR2         12      /* 用户自定义 2 */
#define SIGPIPE         13      /* 管道破裂 */
#define SIGALRM         14      /* 定时器到期 */
#define SIGTERM         15      /* 终止，正常终止信号 */
#define SIGSTKFLT       16      /* 协处理器栈错误 */
#define SIGCHLD         17      /* 子进程状态改变 */
#define SIGCONT         18      /* 继续，恢复停止的进程 */
#define SIGSTOP         19      /* 停止，不能捕获 */
#define SIGTSTP         20      /* 终端停止，Ctrl+Z */
#define SIGTTIN         21      /* 后台读 */
#define SIGTTOU         22      /* 后台写 */
#define SIGURG          23      /* 紧急数据 */
#define SIGXCPU         24      /* CPU 时间超限 */
#define SIGXFSZ         25      /* 文件大小超限 */
#define SIGVTALRM       26      /* 虚拟定时器 */
#define SIGPROF         27      /* 性能分析定时器 */
#define SIGWINCH        28      /* 窗口大小改变 */
#define SIGIO           29      /* I/O 就绪 */
#define SIGPWR          30      /* 电源故障 */
#define SIGSYS          31      /* 系统调用错误 */
```

### 3.2 实时信号（32-64）

```c
#define SIGRTMIN        32      /* 实时信号起始 */
#define SIGRTMAX        64      /* 实时信号结束 */

/* 实时信号特点：
 * 1. 支持排队（不丢失）
 * 2. 携带附加数据
 * 3. 保证顺序（FIFO）
 * 4. 编号越小优先级越高
 */
```

### 3.3 信号的默认动作

```
+------------------+----------------------------------------+
|    默认动作      |                说明                    |
+------------------+----------------------------------------+
|     终止         | 进程立即终止                           |
|     终止+核心转储 | 进程终止并生成核心转储文件             |
|     忽略         | 进程忽略该信号                         |
|     停止进程     | 进程暂停执行                           |
|     继续         | 使停止的进程继续执行                   |
+------------------+----------------------------------------+

信号默认动作分类：
+-------------------+----------------------------------------+
| 终止              | SIGHUP, SIGINT, SIGKILL, SIGTERM...   |
+-------------------+----------------------------------------+
| 终止+核心转储     | SIGQUIT, SIGILL, SIGABRT, SIGFPE...   |
+-------------------+----------------------------------------+
| 忽略              | SIGCHLD, SIGURG, SIGWINCH...          |
+-------------------+----------------------------------------+
| 停止              | SIGSTOP, SIGTSTP, SIGTTIN, SIGTTOU    |
+-------------------+----------------------------------------+
| 继续              | SIGCONT                               |
+-------------------+----------------------------------------+
```

### 3.4 特殊信号

```c
/* SIGKILL (9) 和 SIGSTOP (19) 是两个特殊信号 */

特点：
1. 不能被捕获：signal() 或 sigaction() 无法改变处理方式
2. 不能被忽略：进程必须响应
3. 不能被阻塞：信号屏蔽字无法阻塞

/* 内核中的定义 */
#define sig_kernel_only(sig) \
    (((sig) == SIGKILL) || ((sig) == SIGSTOP))

#define sig_kernel_coredump(sig) \
    (sig == SIGQUIT || sig == SIGILL || sig == SIGTRAP || \
     sig == SIGABRT || sig == SIGFPE || sig == SIGSEGV || \
     sig == SIGBUS || sig == SIGSYS || sig == SIGXCPU || sig == SIGXFSZ)

#define sig_kernel_ignore(sig) \
    (sig == SIGCONT || sig == SIGCHLD || sig == SIGWINCH || sig == SIGURG)
```

---

## 4. 核心数据结构

### 4.1 信号集 sigset_t

```c
/* 定义在 include/uapi/asm-generic/signal.h */

typedef struct {
    unsigned long sig[_NSIG_WORDS];
} sigset_t;

/* _NSIG = 64, _NSIG_WORDS = 64 / BITS_PER_LONG */
/* 32 位系统：_NSIG_WORDS = 2 */
/* 64 位系统：_NSIG_WORDS = 1 */

/* 信号集操作函数 */
int sigemptyset(sigset_t *set);           /* 清空信号集 */
int sigfillset(sigset_t *set);            /* 填充所有信号 */
int sigaddset(sigset_t *set, int signum); /* 添加信号 */
int sigdelset(sigset_t *set, int signum); /* 删除信号 */
int sigismember(const sigset_t *set, int signum); /* 检查信号 */
```

### 4.2 siginfo_t 结构

```c
/* 定义在 include/uapi/asm-generic/siginfo.h */

typedef struct {
    int      si_signo;     /* 信号编号 */
    int      si_errno;     /* 错误码 */
    int      si_code;      /* 信号来源代码 */
    
    union {
        int _pad[128/sizeof(int) - 3];
        
        /* kill() 发送的信号 */
        struct {
            __kernel_pid_t _pid;   /* 发送者 PID */
            __kernel_uid32_t _uid; /* 发送者 UID */
        } _kill;
        
        /* POSIX.1b 定时器 */
        struct {
            __kernel_timer_t _tid; /* 定时器 ID */
            int _overrun;          /* 溢出计数 */
            sigval_t _sigval;      /* 信号值 */
        } _timer;
        
        /* 实时信号 */
        struct {
            __kernel_pid_t _pid;
            __kernel_uid32_t _uid;
            sigval_t _sigval;      /* 用户数据 */
        } _rt;
        
        /* SIGCHLD */
        struct {
            __kernel_pid_t _pid;
            __kernel_uid32_t _uid;
            int _status;           /* 退出状态 */
            __kernel_clock_t _utime;
            __kernel_clock_t _stime;
        } _sigchld;
        
        /* SIGILL, SIGFPE, SIGSEGV, SIGBUS */
        struct {
            void __user *_addr;    /* 触发信号的地址 */
            short _addr_lsb;
        } _sigfault;
        
        /* SIGPOLL */
        struct {
            __ARCH_SI_BAND_T _band;
            int _fd;
        } _sigpoll;
    } _sifields;
} siginfo_t;

/* si_code 取值 */
#define SI_USER       0       /* kill() 发送 */
#define SI_KERNEL     0x80    /* 内核发送 */
#define SI_QUEUE     -1       /* sigqueue() 发送 */
#define SI_TIMER     -2       /* 定时器到期 */
#define SI_MESGQ     -3       /* 消息队列状态改变 */
#define SI_ASYNCIO   -4       /* 异步 I/O 完成 */
#define SI_SIGIO     -5       /* SIGIO 排队 */
#define SI_TKILL     -6       /* tkill() 或 tgkill() */
```

### 4.3 sigaction 结构

```c
/* 定义在 include/linux/signal_types.h */

struct sigaction {
    __sighandler_t sa_handler;   /* 信号处理函数 */
    unsigned long sa_flags;      /* 信号处理标志 */
#ifdef __ARCH_HAS_SA_RESTORER
    __sigrestore_t sa_restorer;  /* 恢复函数 */
#endif
    sigset_t sa_mask;            /* 处理信号时阻塞的信号集 */
};

/* sa_handler 取值 */
#define SIG_DFL  ((__sighandler_t)0)  /* 默认处理 */
#define SIG_IGN  ((__sighandler_t)1)  /* 忽略信号 */
#define SIG_ERR  ((__sighandler_t)-1) /* 错误返回 */

/* sa_flags 标志 */
#define SA_NOCLDSTOP  0x00000001   /* 子进程停止时不产生 SIGCHLD */
#define SA_NOCLDWAIT  0x00000002   /* 子进程退出时不产生僵尸进程 */
#define SA_SIGINFO    0x00000004   /* 使用 sa_sigaction 处理函数 */
#define SA_ONSTACK    0x08000000   /* 在信号栈上执行处理函数 */
#define SA_RESTART    0x10000000   /* 自动重启被中断的系统调用 */
#define SA_NODEFER    0x40000000   /* 处理信号时不阻塞该信号 */
#define SA_RESETHAND  0x80000000   /* 处理一次后恢复默认 */
```

### 4.4 sigpending 结构

```c
/* 定义在 include/linux/signal_types.h */

struct sigpending {
    struct list_head list;    /* sigqueue 链表 */
    sigset_t signal;          /* 信号位图 */
};

/* sigqueue 结构 */
struct sigqueue {
    struct list_head list;    /* 链表节点 */
    int flags;                /* 标志 */
    kernel_siginfo_t info;    /* 信号信息 */
    struct ucounts *ucounts;  /* 用户计数 */
};

/* 标志 */
#define SIGQUEUE_PREALLOC    1    /* 预分配 */
```

### 4.5 sighand_struct 结构

```c
/* 定义在 include/linux/sched/signal.h */

struct sighand_struct {
    spinlock_t siglock;                /* 自旋锁 */
    refcount_t count;                  /* 引用计数 */
    wait_queue_head_t signalfd_wqh;    /* signalfd 等待队列 */
    struct k_sigaction action[_NSIG];  /* 信号处理动作数组 */
};

/* k_sigaction 结构 */
struct k_sigaction {
    struct sigaction sa;
#ifdef __ARCH_HAS_KA_RESTORER
    __sigrestore_t ka_restorer;
#endif
};
```

### 4.6 signal_struct 结构

```c
/* 定义在 include/linux/sched/signal.h */

struct signal_struct {
    refcount_t sigcnt;                 /* 引用计数 */
    atomic_t live;                     /* 存活的线程数 */
    int nr_threads;                    /* 线程数 */
    
    struct list_head thread_head;      /* 线程链表 */
    
    wait_queue_head_t wait_chldexit;   /* wait4 等待队列 */
    
    /* 当前信号目标线程 */
    struct task_struct *curr_target;
    
    /* 共享待处理信号 */
    struct sigpending shared_pending;
    
    /* 线程组退出支持 */
    int group_exit_code;               /* 线程组退出码 */
    int notify_count;
    struct task_struct *group_exit_task;
    
    /* 线程组停止支持 */
    int group_stop_count;
    unsigned int flags;                /* SIGNAL_* 标志 */
    
    /* POSIX 定时器 */
    struct list_head posix_timers;
    struct hrtimer real_timer;
    ktime_t it_real_incr;
    
    /* 资源限制 */
    struct rlimit rlim[RLIM_NLIMITS];
};
```

### 4.7 task_struct 中的信号字段

```c
struct task_struct {
    ...
    struct signal_struct *signal;      /* 信号结构 */
    struct sighand_struct *sighand;    /* 信号处理结构 */
    
    sigset_t blocked;                  /* 被阻塞的信号集 */
    sigset_t real_blocked;             /* 真实阻塞信号集 */
    sigset_t saved_sigmask;            /* 保存的信号屏蔽字 */
    
    struct sigpending pending;         /* 私有待处理信号 */
    
    unsigned long sas_ss_sp;           /* 信号栈位置 */
    size_t sas_ss_size;                /* 信号栈大小 */
    unsigned int sas_ss_flags;
    ...
};
```

---

## 5. 信号发送流程

### 5.1 发送信号的途径

```
发送信号的途径：
+-------------------+
| 用户空间           |
+-------------------+
         |
    +----+----+----+----+----+
    |    |    |    |    |    |
    v    v    v    v    v    v
+------+ +------+ +------+ +------+
| kill | | raise| | abort| | alarm|
+------+ +------+ +------+ +------+
    |         |        |        |
    +----+----+----+---+--------+
         |
         v
+-------------------+
| 内核空间           |
+-------------------+
         |
    +----+----+----+----+
    |    |    |    |    |
    v    v    v    v    v
+------+ +------+ +------+ +------+
|硬件异常| |定时器 | |终端  | |内核  |
|SIGSEGV| |SIGALRM| |SIGINT| |发送  |
+------+ +------+ +------+ +------+
```

### 5.2 kill 系统调用

```c
/* kernel/signal.c */

SYSCALL_DEFINE2(kill, pid_t, pid, int, sig)
{
    struct kernel_siginfo info;

    prepare_kill_siginfo(sig, &info);

    return kill_something_info(sig, &info, pid);
}

static int kill_something_info(int sig, struct kernel_siginfo *info, pid_t pid)
{
    int ret;

    if (pid > 0) {
        /* 发送给指定进程 */
        ret = kill_pid_info(sig, info, find_vpid(pid));
    } else if (pid == -1) {
        /* 发送给所有进程 */
        ret = kill_pid_info(sig, info, PIDTYPE_MAX);
    } else {
        /* 发送给进程组 */
        ret = __kill_pgrp_info(sig, info, 
                               pid ? find_vpid(-pid) : task_pgrp(current));
    }

    return ret;
}
```

### 5.3 __send_signal 核心函数

```c
/* kernel/signal.c */

static int __send_signal(int sig, struct kernel_siginfo *info, 
                         struct task_struct *t, enum pid_type type, 
                         bool force)
{
    struct sigpending *pending;
    struct sigqueue *q;
    int override_rlimit;
    int ret = 0, result;

    assert_spin_locked(&t->sighand->siglock);

    /* 1. 准备信号：检查是否可以发送 */
    result = TRACE_SIGNAL_IGNORED;
    if (!prepare_signal(sig, t, force))
        goto ret;

    /* 2. 选择挂起队列 */
    pending = (type != PIDTYPE_PID) ? 
              &t->signal->shared_pending : &t->pending;

    /* 3. 标准信号：已存在则不排队 */
    result = TRACE_SIGNAL_ALREADY_PENDING;
    if (legacy_queue(pending, sig))
        goto ret;

    result = TRACE_SIGNAL_DELIVERED;

    /* 4. SIGKILL 或内核线程：跳过 siginfo 分配 */
    if ((sig == SIGKILL) || (t->flags & PF_KTHREAD))
        goto out_set;

    /* 5. 分配 sigqueue 结构 */
    if (sig < SIGRTMIN)
        override_rlimit = (is_si_special(info) || info->si_code >= 0);
    else
        override_rlimit = 0;

    q = __sigqueue_alloc(sig, t, GFP_ATOMIC, override_rlimit, 0);

    if (q) {
        /* 6. 添加到挂起队列 */
        list_add_tail(&q->list, &pending->list);
        
        /* 7. 填充信号信息 */
        switch ((unsigned long) info) {
        case (unsigned long) SEND_SIG_NOINFO:
            clear_siginfo(&q->info);
            q->info.si_signo = sig;
            q->info.si_errno = 0;
            q->info.si_code = SI_USER;
            q->info.si_pid = task_tgid_nr_ns(current,
                            task_active_pid_ns(t));
            rcu_read_lock();
            q->info.si_uid = from_kuid_munged(
                task_cred_xxx(t, user_ns), current_uid());
            rcu_read_unlock();
            break;
        case (unsigned long) SEND_SIG_PRIV:
            clear_siginfo(&q->info);
            q->info.si_signo = sig;
            q->info.si_errno = 0;
            q->info.si_code = SI_KERNEL;
            q->info.si_pid = 0;
            q->info.si_uid = 0;
            break;
        default:
            copy_siginfo(&q->info, info);
            break;
        }
    } else if (!is_si_special(info) &&
           sig >= SIGRTMIN && info->si_code != SI_USER) {
        /* 8. 队列溢出 */
        result = TRACE_SIGNAL_OVERFLOW_FAIL;
        ret = -EAGAIN;
        goto ret;
    } else {
        /* 9. 丢失信息 */
        result = TRACE_SIGNAL_LOSE_INFO;
    }

out_set:
    /* 10. 通知 signalfd */
    signalfd_notify(t, sig);
    
    /* 11. 设置信号位 */
    sigaddset(&pending->signal, sig);

    /* 12. 完成信号发送 */
    complete_signal(sig, t, type);
ret:
    trace_signal_generate(sig, info, t, type != PIDTYPE_PID, result);
    return ret;
}
```

### 5.4 complete_signal 函数

```c
/* kernel/signal.c */

static void complete_signal(int sig, struct task_struct *p, enum pid_type type)
{
    struct signal_struct *signal = p->signal;
    struct task_struct *t;

    /* 1. 找到需要唤醒的线程 */
    if (wants_signal(sig, p))
        t = p;
    else if ((type == PIDTYPE_PID) || thread_group_empty(p))
        return;  /* 只有一个线程且不需要唤醒 */
    else {
        /* 找到合适的线程 */
        t = signal->curr_target;
        while (!wants_signal(sig, t)) {
            t = next_thread(t);
            if (t == signal->curr_target)
                return;
        }
        signal->curr_target = t;
    }

    /* 2. 如果是致命信号，终止整个线程组 */
    if (sig_fatal(p, sig) &&
        !(signal->flags & SIGNAL_GROUP_EXIT) &&
        !sigismember(&t->real_blocked, sig) &&
        (sig == SIGKILL || !p->ptrace)) {
        
        if (!sig_kernel_coredump(sig)) {
            /* 开始组退出 */
            signal->flags = SIGNAL_GROUP_EXIT;
            signal->group_exit_code = sig;
            signal->group_stop_count = 0;
            t = p;
            do {
                task_clear_jobctl_pending(t, JOBCTL_PENDING_MASK);
                sigaddset(&t->pending.signal, SIGKILL);
                signal_wake_up(t, 1);
            } while_each_thread(p, t);
            return;
        }
    }

    /* 3. 唤醒目标线程 */
    signal_wake_up(t, sig == SIGKILL);
}
```

---

## 6. 信号处理流程

### 6.1 信号检测时机

```
信号检测时机：
+-------------------+
| 从内核返回用户态  |
+-------------------+
         |
         v
+-------------------+
| exit_to_user_mode |
+-------------------+
         |
         v
+-------------------+
| 检查 TIF_SIGPENDING|
+-------------------+
         |
         | 有信号
         v
+-------------------+
| arch_do_signal_or_restart |
+-------------------+
         |
         v
+-------------------+
| get_signal()      |
| 获取待处理信号    |
+-------------------+
         |
         v
+-------------------+
| handle_signal()   |
| 处理信号          |
+-------------------+
```

### 6.2 get_signal 函数

```c
/* kernel/signal.c */

int get_signal(struct ksignal *ksig)
{
    struct sighand_struct *sighand = current->sighand;
    int signr;

    /* 1. 循环处理信号 */
    for (;;) {
        struct k_sigaction *ka;

        /* 2. 检查是否有待处理信号 */
        if (unlikely(current->flags & PF_EXITING))
            break;

        /* 3. 获取下一个信号 */
        signr = dequeue_signal(current, &current->blocked, &ksig->info);
        if (!signr)
            break;  /* 没有信号 */

        /* 4. 检查是否被 ptrace 跟踪 */
        if (unlikely(current->ptrace) && signr != SIGKILL) {
            signr = ptrace_signal(signr, &ksig->info);
            if (!signr)
                continue;
        }

        ka = &sighand->action[signr - 1];

        /* 5. 检查处理方式 */
        if (ka->sa.sa_handler == SIG_IGN) /* 忽略 */
            continue;
        if (ka->sa.sa_handler != SIG_DFL) { /* 用户处理函数 */
            ksig->ka = *ka;
            return signr;
        }

        /* 6. 默认处理 */
        if (sig_kernel_ignore(signr)) /* 默认忽略 */
            continue;

        /* 7. 停止信号 */
        if (sig_kernel_stop(signr)) {
            do_signal_stop(signr);
            continue;
        }

        /* 8. 致命信号 */
        if (sig_kernel_coredump(signr)) {
            do_coredump(&ksig->info);
        }
        do_group_exit(signr);
    }

    return 0;
}
```

### 6.3 handle_signal 函数

```c
/* arch/x86/kernel/signal.c */

static void handle_signal(struct ksignal *ksig, struct pt_regs *regs)
{
    bool stepping, failed;
    struct fpu *fpu = &current->thread.fpu;

    /* 1. 处理 vm86 模式 */
    if (v8086_mode(regs))
        save_v86_state((struct kernel_vm86_regs *) regs, VM86_SIGNAL);

    /* 2. 处理系统调用重启 */
    if (syscall_get_nr(current, regs) != -1) {
        switch (syscall_get_error(current, regs)) {
        case -ERESTART_RESTARTBLOCK:
        case -ERESTARTNOHAND:
            regs->ax = -EINTR;
            break;

        case -ERESTARTSYS:
            if (!(ksig->ka.sa.sa_flags & SA_RESTART)) {
                regs->ax = -EINTR;
                break;
            }
            fallthrough;
        case -ERESTARTNOINTR:
            regs->ax = regs->orig_ax;
            regs->ip -= 2;
            break;
        }
    }

    /* 3. 处理单步调试 */
    stepping = test_thread_flag(TIF_SINGLESTEP);
    if (stepping)
        user_disable_single_step(current);

    /* 4. 设置信号帧 */
    failed = (setup_rt_frame(ksig, regs) < 0);
    
    if (!failed) {
        /* 5. 清除标志 */
        regs->flags &= ~(X86_EFLAGS_DF|X86_EFLAGS_RF|X86_EFLAGS_TF);
        
        /* 6. 清除 FPU 状态 */
        fpu__clear_user_states(fpu);
    }
    
    /* 7. 完成信号设置 */
    signal_setup_done(failed, ksig, stepping);
}
```

### 6.4 arch_do_signal_or_restart 函数

```c
/* arch/x86/kernel/signal.c */

void arch_do_signal_or_restart(struct pt_regs *regs, bool has_signal)
{
    struct ksignal ksig;

    if (has_signal && get_signal(&ksig)) {
        /* 有信号需要处理 */
        handle_signal(&ksig, regs);
        return;
    }

    /* 没有信号处理函数，检查系统调用重启 */
    if (syscall_get_nr(current, regs) != -1) {
        switch (syscall_get_error(current, regs)) {
        case -ERESTARTNOHAND:
        case -ERESTARTSYS:
        case -ERESTARTNOINTR:
            regs->ax = regs->orig_ax;
            regs->ip -= 2;
            break;

        case -ERESTART_RESTARTBLOCK:
            regs->ax = get_nr_restart_syscall(regs);
            regs->ip -= 2;
            break;
        }
    }

    /* 恢复保存的信号屏蔽字 */
    restore_saved_sigmask();
}
```

---

## 7. 信号帧与用户栈

### 7.1 信号帧结构

```
信号帧结构（x86_64）：

用户栈：
+-------------------+  <-- 高地址
|    原用户栈       |
+-------------------+
|    ...            |
+-------------------+
| alignment padding |
+-------------------+
| (f)xsave frame    |  <-- 浮点/向量状态
+-------------------+
| fsave header      |
+-------------------+
| alignment padding |
+-------------------+
| siginfo_t         |  <-- 信号信息
+-------------------+
| ucontext_t        |  <-- 用户上下文
|   - sigcontext    |     - 寄存器状态
|   - sigmask       |     - 信号屏蔽字
|   - fpstate       |     - 浮点状态指针
+-------------------+
| return address    |  <-- 返回到信号处理函数
+-------------------+  <-- 低地址（新栈顶）
```

### 7.2 setup_rt_frame 函数

```c
/* arch/x86/kernel/signal.c */

static int __setup_rt_frame(int sig, struct ksignal *ksig,
                            sigset_t *set, struct pt_regs *regs)
{
    struct rt_sigframe __user *frame;
    void __user *fp = NULL;
    unsigned long uc_flags;

    /* 1. 计算信号帧位置 */
    frame = get_sigframe(&ksig->ka, regs, sizeof(struct rt_sigframe), &fp);

    /* 2. 保存信号信息 */
    if (copy_siginfo_to_user(&frame->info, &ksig->info))
        return -EFAULT;

    /* 3. 设置用户上下文 */
    if (setup_sigcontext(&frame->uc.uc_mcontext, fp, regs, set->sig[0]))
        return -EFAULT;

    /* 4. 保存信号屏蔽字 */
    if (__save_altstack(&frame->uc.uc_stack, regs->sp))
        return -EFAULT;

    /* 5. 设置返回地址 */
    if (ksig->ka.sa.sa_flags & SA_RESTORER) {
        put_user_ex(ksig->ka.sa.sa_restorer, &frame->pretcode);
    } else {
        /* 使用 VDSO 中的信号返回代码 */
        put_user_ex((void __user *)current->mm->context.vdso +
                    vdso_image_32.sym___kernel_sigreturn, &frame->pretcode);
    }

    /* 6. 修改寄存器，跳转到信号处理函数 */
    regs->sp = (unsigned long)frame;
    regs->ip = (unsigned long)ksig->ka.sa.sa_handler;
    regs->ax = sig;
    regs->dx = (unsigned long)&frame->info;
    regs->cx = (unsigned long)&frame->uc;

    return 0;
}
```

### 7.3 信号处理函数返回

```
信号处理函数返回流程：

1. 用户信号处理函数执行完毕
        |
        v
2. 返回到 pretcode（信号返回代码）
        |
        v
3. 执行 sigreturn 系统调用
        |
        v
4. 内核恢复原上下文
   - 恢复寄存器
   - 恢复信号屏蔽字
        |
        v
5. 返回到原执行流程
```

### 7.4 sigreturn 系统调用

```c
/* arch/x86/kernel/signal.c */

SYSCALL_DEFINE0(sigreturn)
{
    struct pt_regs *regs = current_pt_regs();
    struct sigframe __user *frame;
    sigset_t set;

    /* 1. 获取信号帧 */
    frame = (struct sigframe __user *)(regs->sp - 8);

    /* 2. 恢复信号屏蔽字 */
    if (__get_user(set.sig[0], &frame->sc.oldmask))
        goto badframe;

    /* 3. 恢复寄存器 */
    if (restore_sigcontext(regs, &frame->sc, 0))
        goto badframe;

    return regs->ax;

badframe:
    force_sig(SIGSEGV);
    return 0;
}
```

---

## 8. 实时信号机制

### 8.1 实时信号的特点

```
实时信号特点：
+-------------------+
| 1. 支持排队       |  --> 不丢失信号
+-------------------+
         |
         v
+-------------------+
| 2. 携带附加数据   |  --> sigval_t
+-------------------+
         |
         v
+-------------------+
| 3. 保证顺序       |  --> FIFO
+-------------------+
         |
         v
+-------------------+
| 4. 优先级         |  --> 编号越小优先级越高
+-------------------+
```

### 8.2 实时信号发送

```c
/* 发送实时信号 */
union sigval value;
value.sival_int = 42;

/* 方法一：sigqueue */
int ret = sigqueue(pid, SIGRTMIN, value);

/* 方法二：rt_sigqueueinfo */
siginfo_t info;
memset(&info, 0, sizeof(info));
info.si_signo = SIGRTMIN;
info.si_code = SI_QUEUE;
info.si_value = value;
syscall(__NR_rt_sigqueueinfo, pid, SIGRTMIN, &info);
```

### 8.3 实时信号处理

```c
/* 使用 SA_SIGINFO 处理实时信号 */
void rt_handler(int sig, siginfo_t *si, void *context)
{
    printf("收到信号 %d\n", sig);
    printf("发送者 PID: %d\n", si->si_pid);
    printf("发送者 UID: %d\n", si->si_uid);
    printf("附加数据: %d\n", si->si_value.sival_int);
}

struct sigaction sa;
sa.sa_sigaction = rt_handler;
sa.sa_flags = SA_SIGINFO;
sigemptyset(&sa.sa_mask);
sigaction(SIGRTMIN, &sa, NULL);
```

### 8.4 实时信号排队

```c
/* kernel/signal.c */

/* 标准信号：已存在则不排队 */
static inline bool legacy_queue(struct sigpending *signals, int sig)
{
    return (sig < SIGRTMIN) && sigismember(&signals->signal, sig);
}

/* __send_signal 中 */
if (legacy_queue(pending, sig))
    goto ret;  /* 标准信号已存在，直接返回 */

/* 实时信号：总是排队 */
q = __sigqueue_alloc(sig, t, GFP_ATOMIC, override_rlimit, 0);
if (q) {
    list_add_tail(&q->list, &pending->list);
    /* ... */
}
```

---

## 9. 线程与信号

### 9.1 线程信号模型

```
线程信号模型：

进程级信号：
+-------------------+
| signal_struct     |
| shared_pending    |  <-- 所有线程共享
+-------------------+
         |
         | 信号发送
         v
+-------------------+
| 选择目标线程      |
| curr_target       |
+-------------------+

线程级信号：
+-------------------+     +-------------------+     +-------------------+
| 线程 1            |     | 线程 2            |     | 线程 3            |
| pending           |     | pending           |     | pending           |
| blocked           |     | blocked           |     | blocked           |
+-------------------+     +-------------------+     +-------------------+
```

### 9.2 线程信号发送

```c
/* tgkill: 发送信号给指定线程 */
SYSCALL_DEFINE3(tgkill, pid_t, tgid, pid_t, pid, int, sig)
{
    if (pid <= 0 || tgid <= 0)
        return -EINVAL;

    return do_tkill(tgid, pid, sig);
}

static int do_tkill(pid_t tgid, pid_t pid, int sig)
{
    struct kernel_siginfo info;

    clear_siginfo(&info);
    info.si_signo = sig;
    info.si_errno = 0;
    info.si_code = SI_TKILL;
    info.si_pid = task_tgid_vnr(current);
    info.si_uid = from_kuid_munged(current_user_ns(), current_uid());

    return do_send_specific(tgid, pid, sig, &info);
}
```

### 9.3 线程信号屏蔽

```c
/* 每个线程有独立的信号屏蔽字 */
struct task_struct {
    sigset_t blocked;          /* 被阻塞的信号 */
    sigset_t real_blocked;     /* 真实阻塞信号 */
    sigset_t saved_sigmask;    /* 保存的信号屏蔽字 */
};

/* pthread_sigmask */
int pthread_sigmask(int how, const sigset_t *set, sigset_t *oldset)
{
    return sigprocmask(how, set, oldset);
}
```

### 9.4 线程信号处理

```c
/* 信号处理函数在目标线程中执行 */
/* 线程 1 注册信号处理函数 */
void handler(int sig) {
    printf("线程 %ld 收到信号 %d\n", pthread_self(), sig);
}

struct sigaction sa;
sa.sa_handler = handler;
sigaction(SIGUSR1, &sa, NULL);

/* 线程 2 发送信号给线程 1 */
pthread_kill(thread1, SIGUSR1);

/* 信号处理函数在线程 1 中执行 */
```

---

## 10. 信号的安全与权限

### 10.1 权限检查

```c
/* kernel/signal.c */

static int check_kill_permission(int sig, struct kernel_siginfo *info,
                                 struct task_struct *t)
{
    struct pid *sid;
    int error;

    /* 1. 检查信号是否有效 */
    if (!valid_signal(sig))
        return -EINVAL;

    /* 2. 内核发送的信号不需要检查权限 */
    if (!si_fromuser(info))
        return 0;

    /* 3. 检查能力 */
    error = kill_ok_by_cred(t);
    if (!error)
        error = check_same_or_ancestor_ns(t);

    return error;
}

static int kill_ok_by_cred(struct task_struct *t)
{
    const struct cred *cred = current_cred();
    const struct cred *tcred = __task_cred(t);

    /* 同用户或有 CAP_KILL 能力 */
    if (uid_eq(cred->euid, tcred->suid) ||
        uid_eq(cred->euid, tcred->uid) ||
        uid_eq(cred->uid, tcred->suid) ||
        uid_eq(cred->uid, tcred->uid) ||
        ns_capable(tcred->user_ns, CAP_KILL))
        return 0;

    return -EPERM;
}
```

### 10.2 特殊进程保护

```c
/* kernel/signal.c */

static bool sig_task_ignored(struct task_struct *t, int sig, bool force)
{
    void __user *handler;

    handler = sig_handler(t, sig);

    /* 1. init 进程保护 */
    if (unlikely(is_global_init(t) && sig_kernel_only(sig)))
        return true;  /* SIGKILL/SIGSTOP 不能发送给 init */

    /* 2. 不可杀死进程保护 */
    if (unlikely(t->signal->flags & SIGNAL_UNKILLABLE) &&
        handler == SIG_DFL && !(force && sig_kernel_only(sig)))
        return true;

    /* 3. 内核线程保护 */
    if (unlikely((t->flags & PF_KTHREAD) &&
                 (handler == SIG_KTHREAD_KERNEL) && !force))
        return true;

    return sig_handler_ignored(handler, sig);
}
```

### 10.3 信号限制

```c
/* 资源限制 */
struct rlimit {
    rlim_t rlim_cur;  /* 软限制 */
    rlim_t rlim_max;  /* 硬限制 */
};

/* RLIMIT_SIGPENDING: 用户可排队的最大信号数 */
/* 可通过 ulimit -i 查看 */

/* kernel/signal.c */
static struct sigqueue *__sigqueue_alloc(int sig, struct task_struct *t,
                                         gfp_t gfp_flags,
                                         int override_rlimit,
                                         int from_slab)
{
    struct sigqueue *q = NULL;
    struct ucounts *ucounts;

    /* 检查限制 */
    if (override_rlimit || likely(sigpending_allowed(t, sig) >= 0)) {
        ucounts = get_ucounts(t->signal->ucounts);
        if (ucounts && get_ucounts_value(ucounts, UCOUNT_RLIMIT_SIGPENDING) < 
            task_rlimit(t, RLIMIT_SIGPENDING)) {
            /* 分配 sigqueue */
            q = kmem_cache_alloc(sigqueue_cachep, gfp_flags);
        }
    }

    if (q) {
        q->ucounts = ucounts;
        q->flags = 0;
    } else {
        put_ucounts(ucounts);
    }

    return q;
}
```

---

## 11. 信号的设计哲学

### 11.1 异步通知

```
信号的核心价值：异步通知

传统同步方式：
+-------------------+
| 进程主动检查      |
| while (!event)    |
|   sleep(1);       |
+-------------------+
问题：浪费 CPU，响应慢

信号方式：
+-------------------+
| 进程继续执行      |
| 收到信号时处理    |
+-------------------+
优点：高效，响应快
```

### 11.2 简单与强大的平衡

```
信号的简单性：
+-------------------+
| 只传递信号编号    |
| 不传递大量数据    |
+-------------------+

信号的强大性：
+-------------------+
| 自定义处理函数    |
| 携带附加信息      |
| 实时信号排队      |
+-------------------+

设计哲学：
- 简单的接口
- 灵活的处理
- 可靠的传递
```

### 11.3 与其他 IPC 机制的比较

```
信号 vs 其他 IPC：

+-------------------+-------------------+-------------------+
|      信号         |      管道         |      消息队列     |
+-------------------+-------------------+-------------------+
| 异步通知          | 同步通信          | 同步/异步         |
| 数据量小          | 数据量大          | 数据量大          |
| 简单              | 中等复杂          | 复杂              |
| 进程间            | 亲缘进程          | 任意进程          |
+-------------------+-------------------+-------------------+

适用场景：
- 信号：事件通知、异常处理
- 管道：数据流传输
- 消息队列：结构化数据通信
```

### 11.4 信号的最佳实践

```
信号处理最佳实践：

1. 保持信号处理函数简单
   - 避免调用非异步信号安全函数
   - 只设置标志位，主循环处理

2. 正确处理信号屏蔽
   - 处理信号时阻塞相关信号
   - 使用 sigprocmask 管理屏蔽字

3. 使用实时信号
   - 需要可靠传递时使用实时信号
   - 利用附加数据传递信息

4. 避免信号竞争
   - 使用 sig_atomic_t 类型
   - 注意信号处理的原子性

5. 正确处理系统调用重启
   - 理解 SA_RESTART 标志
   - 正确处理 EINTR 错误
```

---

## 总结

Linux 5.15 的信号机制是一个成熟、完善的异步通知系统：

1. **丰富的信号类型**：32 个标准信号 + 32 个实时信号
2. **灵活的处理方式**：默认处理、忽略、自定义处理函数
3. **可靠的消息传递**：实时信号支持排队和附加数据
4. **线程级支持**：每个线程独立的信号屏蔽字和处理
5. **完善的安全机制**：能力系统、命名空间隔离

理解信号机制对于编写健壮的 Linux 程序至关重要，它是处理异步事件和异常的核心机制。
