# Linux 信号机制演进对比

## 目录

1. **`概述`**
2. **`信号数量与类型对比`**
3. **`数据结构对比`**
4. **`信号发送机制对比`**
5. **`信号处理机制对比`**
6. **`信号排队机制对比`**
7. **`系统调用对比`**
8. **`安全与权限对比`**
9. **`实时信号支持对比`**
10. **`总结`**

---

## 1. 概述

### 1.1 Linux 0.11 信号机制特点

| 特性 | 说明 |
|------|------|
| **信号数量** | 32 个标准信号 |
| **信号类型** | 仅标准信号（不可靠信号） |
| **排队机制** | 无排队，相同信号可能丢失 |
| **信号信息** | 仅信号编号，无附加信息 |
| **处理方式** | 简单的信号处理函数 |

### 1.2 Linux 5.15 信号机制特点

| 特性 | 说明 |
|------|------|
| **信号数量** | 64 个信号（32 标准信号 + 32 实时信号） |
| **信号类型** | 标准信号 + 实时信号（可靠信号） |
| **排队机制** | 实时信号支持排队 |
| **信号信息** | siginfo_t 结构，携带详细信息 |
| **处理方式** | sigaction + SA_SIGINFO |
| **线程支持** | 线程级信号处理 |

---

## 2. 信号数量与类型对比

### 2.1 Linux 0.11 信号定义

```c
#define _NSIG             32      /* 信号总数 */

#define SIGHUP             1      /* 挂起 */
#define SIGINT             2      /* 中断 */
#define SIGQUIT            3      /* 退出 */
#define SIGILL             4      /* 非法指令 */
#define SIGTRAP            5      /* 跟踪陷阱 */
#define SIGABRT            6      /* 异常终止 */
#define SIGFPE             8      /* 浮点异常 */
#define SIGKILL            9      /* 强制终止 */
#define SIGSEGV           11      /* 段错误 */
#define SIGPIPE           13      /* 管道破裂 */
#define SIGALRM           14      /* 定时器到期 */
#define SIGTERM           15      /* 终止 */
#define SIGCHLD           17      /* 子进程状态改变 */
#define SIGCONT           18      /* 继续 */
#define SIGSTOP           19      /* 停止 */
#define SIGTSTP           20      /* 终端停止 */
#define SIGUSR1           10      /* 用户自定义 1 */
#define SIGUSR2           12      /* 用户自定义 2 */
```

### 2.2 Linux 5.15 信号定义

```c
#define _NSIG           64        /* 信号总数 */

/* 标准信号（1-31） */
#define SIGHUP           1
#define SIGINT           2
#define SIGQUIT          3
#define SIGILL           4
#define SIGTRAP          5
#define SIGABRT          6
#define SIGBUS           7        /* 新增：总线错误 */
#define SIGFPE           8
#define SIGKILL          9
#define SIGUSR1         10
#define SIGSEGV         11
#define SIGUSR2         12
#define SIGPIPE         13
#define SIGALRM         14
#define SIGTERM         15
#define SIGSTKFLT       16
#define SIGCHLD         17
#define SIGCONT         18
#define SIGSTOP         19
#define SIGTSTP         20
#define SIGTTIN         21        /* 新增：后台读 */
#define SIGTTOU         22        /* 新增：后台写 */
#define SIGURG          23        /* 新增：紧急数据 */
#define SIGXCPU         24        /* 新增：CPU 时间超限 */
#define SIGXFSZ         25        /* 新增：文件大小超限 */
#define SIGVTALRM       26        /* 新增：虚拟定时器 */
#define SIGPROF         27        /* 新增：性能分析定时器 */
#define SIGWINCH        28        /* 新增：窗口大小改变 */
#define SIGIO           29        /* 新增：I/O 就绪 */
#define SIGPWR          30        /* 新增：电源故障 */
#define SIGSYS          31        /* 新增：系统调用错误 */

/* 实时信号（32-64） */
#define SIGRTMIN        32
#define SIGRTMAX        64
```

### 2.3 信号类型对比

| 类型 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **标准信号** | 1-31 | 1-31 |
| **实时信号** | 无 | 32-64 |
| **用户自定义** | SIGUSR1, SIGUSR2 | SIGUSR1, SIGUSR2 + 实时信号 |
| **新增信号** | - | SIGBUS, SIGURG, SIGWINCH 等 |

---

## 3. 数据结构对比

### 3.1 进程控制块中的信号字段

**Linux 0.11**：
```c
struct task_struct {
    long signal;                    /* 待处理信号位图（32位） */
    struct sigaction sigaction[32]; /* 信号处理动作数组 */
    long blocked;                   /* 被阻塞的信号位图 */
};
```

**Linux 5.15**：
```c
struct task_struct {
    struct signal_struct *signal;   /* 信号结构（进程共享） */
    struct sighand_struct *sighand; /* 信号处理结构 */
    
    sigset_t blocked;               /* 被阻塞的信号集 */
    sigset_t real_blocked;          /* 真实阻塞信号集 */
    
    struct sigpending pending;      /* 私有待处理信号 */
    
    unsigned long sas_ss_sp;        /* 信号栈位置 */
    size_t sas_ss_size;             /* 信号栈大小 */
    unsigned int sas_ss_flags;
    
    struct callback_head *task_works; /* 任务工作队列 */
};
```

### 3.2 信号集结构对比

**Linux 0.11**：
```c
/* 简单的 32 位位图 */
long signal;    /* 32 位，每位代表一个信号 */
long blocked;   /* 32 位阻塞信号集 */
```

**Linux 5.15**：
```c
/* 支持扩展的信号集 */
typedef struct {
    unsigned long sig[_NSIG_WORDS];  /* 64 位或更多 */
} sigset_t;

/* _NSIG_WORDS = 64 / BITS_PER_LONG */
/* 32 位系统：_NSIG_WORDS = 2 */
/* 64 位系统：_NSIG_WORDS = 1 */
```

### 3.3 sigaction 结构对比

**Linux 0.11**：
```c
struct sigaction {
    void (*sa_handler)(int);    /* 信号处理函数指针 */
    sigset_t sa_mask;           /* 处理信号时要阻塞的信号集 */
    int sa_flags;               /* 信号处理标志 */
    void (*sa_restorer)(void);  /* 恢复函数指针 */
};

/* sa_handler 取值 */
#define SIG_DFL  ((void (*)(int))0)   /* 默认处理 */
#define SIG_IGN  ((void (*)(int))1)   /* 忽略信号 */

/* sa_flags */
#define SA_NOCLDSTOP  1               /* 子进程停止时不产生 SIGCHLD */
#define SA_NOMASK     0x40000000      /* 处理信号时不阻塞该信号 */
#define SA_ONESHOT    0x80000000      /* 处理一次后恢复默认 */
```

**Linux 5.15**：
```c
struct sigaction {
    __sighandler_t sa_handler;   /* 信号处理函数指针 */
    unsigned long sa_flags;      /* 信号处理标志 */
#ifdef SA_RESTORER
    __sigrestore_t sa_restorer;  /* 恢复函数指针 */
#endif
    sigset_t sa_mask;            /* 处理信号时要阻塞的信号集 */
};

/* sa_handler 取值 */
#define SIG_DFL  ((__sighandler_t)0)  /* 默认处理 */
#define SIG_IGN  ((__sighandler_t)1)  /* 忽略信号 */
#define SIG_ERR  ((__sighandler_t)-1) /* 错误返回 */

/* sa_flags */
#define SA_NOCLDSTOP  0x00000001   /* 子进程停止时不产生 SIGCHLD */
#define SA_NOCLDWAIT  0x00000002   /* 子进程退出时不产生僵尸进程 */
#define SA_SIGINFO    0x00000004   /* 使用 sa_sigaction 处理函数 */
#define SA_ONSTACK    0x08000000   /* 在信号栈上执行处理函数 */
#define SA_RESTART    0x10000000   /* 自动重启被中断的系统调用 */
#define SA_NODEFER    0x40000000   /* 处理信号时不阻塞该信号 */
#define SA_RESETHAND  0x80000000   /* 处理一次后恢复默认 */
#define SA_EXPOSE_TAGBITS 0x00000800 /* 暴露标签位 */
```

### 3.4 信号信息结构

**Linux 0.11**：
```c
/* 无 siginfo 结构，只有信号编号 */
```

**Linux 5.15**：
```c
typedef struct kernel_siginfo {
    __SIGINFO;
} kernel_siginfo_t;

/* siginfo_t 结构 */
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
            char _pad[sizeof( __kernel_pid_t) - sizeof(int)];
            sigval_t _sigval;      /* 信号值 */
        } _timer;
        
        /* 实时信号 */
        struct {
            __kernel_pid_t _pid;
            __kernel_uid32_t _uid;
            sigval_t _sigval;
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
            short _addr_lsb;       /* 地址最低有效位 */
            union {
                struct {
                    __kernel_pid_t _pid;
                    __kernel_uid32_t _uid;
                } _kill;
            };
        } _sigfault;
        
        /* SIGPOLL */
        struct {
            __ARCH_SI_BAND_T _band; /* band 事件 */
            int _fd;                /* 文件描述符 */
        } _sigpoll;
    } _sifields;
} siginfo_t;
```

### 3.5 信号挂起结构

**Linux 0.11**：
```c
/* 无独立结构，直接使用位图 */
long signal;    /* 待处理信号位图 */
```

**Linux 5.15**：
```c
struct sigpending {
    struct list_head list;    /* sigqueue 链表 */
    sigset_t signal;          /* 信号位图 */
};

struct sigqueue {
    struct list_head list;    /* 链表节点 */
    int flags;                /* 标志 */
    kernel_siginfo_t info;    /* 信号信息 */
    struct ucounts *ucounts;  /* 用户计数 */
};
```

### 3.6 信号处理结构

**Linux 0.11**：
```c
/* 直接存储在 task_struct 中 */
struct sigaction sigaction[32];
```

**Linux 5.15**：
```c
struct sighand_struct {
    spinlock_t siglock;                /* 自旋锁 */
    refcount_t count;                  /* 引用计数 */
    wait_queue_head_t signalfd_wqh;    /* signalfd 等待队列 */
    struct k_sigaction action[_NSIG];  /* 信号处理动作 */
};

struct signal_struct {
    refcount_t sigcnt;                 /* 引用计数 */
    atomic_t live;                     /* 存活的线程数 */
    int nr_threads;                    /* 线程数 */
    
    struct list_head thread_head;      /* 线程链表 */
    
    wait_queue_head_t wait_chldexit;   /* wait4 等待队列 */
    
    struct task_struct *curr_target;   /* 当前信号目标线程 */
    
    struct sigpending shared_pending;  /* 共享待处理信号 */
    
    int group_exit_code;               /* 线程组退出码 */
    int notify_count;                  /* 通知计数 */
    struct task_struct *group_exit_task;
    
    int group_stop_count;              /* 组停止计数 */
    unsigned int flags;                /* 标志 */
    
    /* POSIX 定时器 */
    struct list_head posix_timers;
    struct hrtimer real_timer;
    ktime_t it_real_incr;
    
    /* 资源限制 */
    struct rlimit rlim[RLIM_NLIMITS];
};
```

---

## 4. 信号发送机制对比

### 4.1 Linux 0.11 信号发送

```c
static inline int send_sig(long sig, struct task_struct * p, int priv)
{
    if (!p || sig < 1 || sig > 32)
        return -EINVAL;
    
    /* 简单的权限检查 */
    if (priv || (current->euid == p->euid) || suser())
        p->signal |= (1 << (sig - 1));  /* 直接设置位 */
    else
        return -EPERM;
    
    return 0;
}
```

**特点**：
- 直接设置信号位图
- 无排队机制
- 相同信号可能丢失
- 无附加信息

### 4.2 Linux 5.15 信号发送

```c
static int __send_signal(int sig, struct kernel_siginfo *info, 
                         struct task_struct *t, enum pid_type type, 
                         bool force)
{
    struct sigpending *pending;
    struct sigqueue *q;
    
    /* 准备信号 */
    if (!prepare_signal(sig, t, force))
        return 0;
    
    /* 选择挂起队列 */
    pending = (type != PIDTYPE_PID) ? 
              &t->signal->shared_pending : &t->pending;
    
    /* 标准信号：已存在则不排队 */
    if (legacy_queue(pending, sig))
        return 0;
    
    /* 分配 sigqueue 结构 */
    q = __sigqueue_alloc(sig, t, GFP_ATOMIC, override_rlimit, 0);
    if (q) {
        list_add_tail(&q->list, &pending->list);
        /* 复制信号信息 */
        copy_siginfo(&q->info, info);
    }
    
    /* 设置信号位 */
    sigaddset(&pending->signal, sig);
    
    /* 完成信号发送 */
    complete_signal(sig, t, type);
    
    return 0;
}
```

**特点**：
- 支持 siginfo 携带信息
- 实时信号支持排队
- 共享信号和私有信号分离
- 完善的权限检查

### 4.3 发送目标对比

**Linux 0.11**：
```c
int sys_kill(int pid, int sig)
{
    /* pid > 0: 发送给指定进程 */
    /* pid == 0: 发送给同进程组 */
    /* pid == -1: 发送给所有进程 */
    /* pid < -1: 发送给指定进程组 */
}
```

**Linux 5.15**：
```c
/* 支持更多发送方式 */
SYSCALL_DEFINE2(kill, pid_t, pid, int, sig);           /* 传统 kill */
SYSCALL_DEFINE3(tgkill, pid_t, tgid, pid_t, pid, int, sig);  /* 线程级 */
SYSCALL_DEFINE2(tkill, pid_t, pid, int, sig);          /* 线程级 */
SYSCALL_DEFINE4(pidfd_send_signal, int, pidfd, int, sig, 
                siginfo_t __user *, info, unsigned int, flags);  /* pidfd */
```

---

## 5. 信号处理机制对比

### 5.1 信号检测时机

**Linux 0.11**：
```
信号检测时机：
+-------------------+
| 系统调用返回      |
+-------------------+
         |
         v
+-------------------+
| 时钟中断返回      |
+-------------------+
         |
         v
+-------------------+
| ret_from_sys_call |
| 汇编代码检测      |
+-------------------+
```

**Linux 5.15**：
```
信号检测时机：
+-------------------+
| 系统调用返回      |
+-------------------+
         |
         v
+-------------------+
| 中断返回          |
+-------------------+
         |
         v
+-------------------+
| exit_to_user_mode |
| 检测 TIF_SIGPENDING|
+-------------------+
         |
         v
+-------------------+
| arch_do_signal_or_restart |
+-------------------+
```

### 5.2 信号帧结构对比

**Linux 0.11 用户栈布局**：
```
+-------------+
| sa_restorer |  <-- 恢复函数地址
+-------------+
|   signr     |  <-- 信号编号
+-------------+
|   blocked   |  <-- 原阻塞信号集
+-------------+
|    eax      |
+-------------+
|    ecx      |
+-------------+
|    edx      |
+-------------+
|   eflags    |
+-------------+
|  old_eip    |  <-- 原返回地址
+-------------+  <-- esp
```

**Linux 5.15 用户栈布局**：
```
+-------------------+
| siginfo_t         |  <-- 信号信息
+-------------------+
| ucontext_t        |  <-- 用户上下文
|   - sigcontext    |     - 寄存器状态
|   - sigmask       |     - 信号屏蔽字
|   - fpstate       |     - 浮点状态
+-------------------+
| alignment padding |
+-------------------+
| (f)xsave frame    |  <-- 浮点/向量状态
+-------------------+
| alignment padding |
+-------------------+  <-- esp
```

### 5.3 处理函数类型对比

**Linux 0.11**：
```c
/* 只支持简单处理函数 */
void (*sa_handler)(int);  /* 参数：信号编号 */
```

**Linux 5.15**：
```c
/* 支持两种处理函数 */

/* 简单处理函数 */
void (*sa_handler)(int);

/* 高级处理函数（SA_SIGINFO） */
void (*sa_sigaction)(int, siginfo_t *, void *);
/* 参数：
 *   int sig        - 信号编号
 *   siginfo_t *si  - 信号详细信息
 *   void *context  - 用户上下文指针
 */
```

---

## 6. 信号排队机制对比

### 6.1 Linux 0.11 排队机制

```
信号排队（无）：

发送 SIGUSR1 三次：
+-------------------+
| signal 位图       |
| SIGUSR1 位 = 1    |  <-- 只记录有信号，不计数
+-------------------+

结果：只处理一次，丢失两次
```

### 6.2 Linux 5.15 排队机制

```
标准信号排队（有限）：

发送 SIGUSR1 三次：
+-------------------+
| pending.signal    |
| SIGUSR1 位 = 1    |
+-------------------+
| pending.list      |
| sigqueue 1        |  <-- 只有一个 sigqueue
+-------------------+

结果：只处理一次，丢失两次（与 0.11 相同）

实时信号排队（完整）：

发送 SIGRTMIN+0 三次：
+-------------------+
| pending.signal    |
| SIGRTMIN+0 位 = 1 |
+-------------------+
| pending.list      |
| sigqueue 1        |
| sigqueue 2        |
| sigqueue 3        |  <-- 三个 sigqueue
+-------------------+

结果：处理三次，不丢失
```

### 6.3 排队限制

**Linux 5.15**：
```c
/* 实时信号排队限制 */
struct rlimit rlim[RLIM_NLIMITS];

/* RLIMIT_SIGPENDING: 用户可排队的最大信号数 */
/* 可通过 ulimit -i 查看 */

/* 查看限制 */
$ ulimit -i
63157

/* 设置限制 */
$ ulimit -i 1024
```

---

## 7. 系统调用对比

### 7.1 Linux 0.11 系统调用

| 系统调用 | 功能 |
|---------|------|
| sys_signal | 设置信号处理函数 |
| sys_sigaction | 设置信号处理动作 |
| sys_sgetmask | 获取阻塞信号集 |
| sys_ssetmask | 设置阻塞信号集 |
| sys_kill | 发送信号 |
| sys_alarm | 设置定时器 |

### 7.2 Linux 5.15 系统调用

| 系统调用 | 功能 |
|---------|------|
| sys_signal | 设置信号处理函数（兼容） |
| sys_sigaction | 设置信号处理动作 |
| sys_rt_sigaction | 实时信号处理动作 |
| sys_sigprocmask | 操作信号屏蔽字 |
| sys_rt_sigprocmask | 实时信号屏蔽字操作 |
| sys_sigpending | 获取待处理信号 |
| sys_rt_sigpending | 实时信号待处理 |
| sys_sigsuspend | 挂起等待信号 |
| sys_rt_sigsuspend | 实时信号挂起 |
| sys_sigaltstack | 设置信号栈 |
| sys_kill | 发送信号 |
| sys_tgkill | 发送信号给线程 |
| sys_tkill | 发送信号给线程 |
| sys_rt_sigqueueinfo | 发送实时信号带信息 |
| sys_rt_tgsigqueueinfo | 发送实时信号给线程带信息 |
| sys_pidfd_send_signal | 通过 pidfd 发送信号 |
| sys_signalfd | 创建信号文件描述符 |
| sys_signalfd4 | 创建信号文件描述符 |
| sys_timer_create | 创建定时器 |
| sys_timer_settime | 设置定时器 |
| sys_timer_delete | 删除定时器 |

### 7.3 新增系统调用详解

**pidfd_send_signal**：
```c
/* 通过 pidfd 发送信号，避免 PID 重用问题 */
SYSCALL_DEFINE4(pidfd_send_signal, int, pidfd, int, sig,
                siginfo_t __user *, info, unsigned int, flags);
```

**signalfd**：
```c
/* 将信号转换为文件描述符事件，支持 select/poll/epoll */
int signalfd(int fd, const sigset_t *mask, int flags);

/* 使用示例 */
sigset_t mask;
sigemptyset(&mask);
sigaddset(&mask, SIGUSR1);

int fd = signalfd(-1, &mask, SFD_NONBLOCK);

/* 可以用 epoll 监听 */
struct epoll_event ev;
ev.events = EPOLLIN;
epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev);
```

---

## 8. 安全与权限对比

### 8.1 Linux 0.11 权限检查

```c
static inline int send_sig(long sig, struct task_struct * p, int priv)
{
    /* 简单的权限检查 */
    if (priv || (current->euid == p->euid) || suser())
        p->signal |= (1 << (sig - 1));
    else
        return -EPERM;
    
    return 0;
}
```

**特点**：
- 仅检查 euid 和超级用户
- 无能力系统
- 无命名空间隔离

### 8.2 Linux 5.15 权限检查

```c
static int check_kill_permission(int sig, struct kernel_siginfo *info,
                                 struct task_struct *t)
{
    struct pid *sid;
    int error;
    
    /* 检查信号是否有效 */
    if (!valid_signal(sig))
        return -EINVAL;
    
    /* 检查权限 */
    if (!si_fromuser(info))
        return 0;
    
    /* 检查能力 */
    error = kill_ok_by_cred(t);
    if (!error)
        error = check_same_or_ancestor_ns(t);
    
    return error;
}

/* 检查能力 */
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

**特点**：
- 完整的能力系统检查
- 命名空间隔离
- 用户命名空间支持
- 更细粒度的权限控制

### 8.3 特殊进程保护

**Linux 0.11**：
```c
/* 无特殊保护 */
```

**Linux 5.15**：
```c
/* init 进程保护 */
if (unlikely(is_global_init(t) && sig_kernel_only(sig)))
    return true;  /* SIGKILL/SIGSTOP 不能发送给 init */

/* 不可杀死进程保护 */
if (unlikely(t->signal->flags & SIGNAL_UNKILLABLE) &&
    handler == SIG_DFL && !(force && sig_kernel_only(sig)))
    return true;
```

---

## 9. 实时信号支持对比

### 9.1 Linux 0.11 实时信号

```
无实时信号支持
```

### 9.2 Linux 5.15 实时信号

```c
/* 实时信号范围 */
#define SIGRTMIN    32
#define SIGRTMAX    64

/* 实时信号特点 */
1. 支持排队（不丢失）
2. 携带附加数据（sigval_t）
3. 保证顺序（FIFO）
4. 可指定目标线程
5. 可设置优先级（编号越小优先级越高）

/* 使用示例 */
union sigval value;
value.sival_int = 42;  /* 附加数据 */

/* 发送实时信号 */
sigqueue(pid, SIGRTMIN, value);

/* 接收实时信号 */
void handler(int sig, siginfo_t *si, void *context) {
    printf("收到信号 %d，数据: %d\n", sig, si->si_value.sival_int);
}
```

### 9.3 实时信号与标准信号对比

| 特性 | 标准信号 | 实时信号 |
|------|---------|---------|
| **编号范围** | 1-31 | 32-63 |
| **排队** | 否（可能丢失） | 是（不丢失） |
| **附加数据** | 无 | 有（sigval_t） |
| **顺序保证** | 无 | 有（FIFO） |
| **优先级** | 无 | 编号越小优先级越高 |

---

## 10. 总结

### 10.1 主要演进

| 方面 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **信号数量** | 32 | 64 |
| **实时信号** | 无 | 支持 |
| **信号信息** | 仅编号 | siginfo_t |
| **排队机制** | 无 | 实时信号支持 |
| **线程支持** | 无 | 完整支持 |
| **权限检查** | 简单 | 完整能力系统 |
| **命名空间** | 无 | 支持 |
| **信号栈** | 无 | sigaltstack |

### 10.2 关键改进

1. **实时信号支持**
   - 支持排队，不丢失信号
   - 携带附加数据
   - 保证顺序

2. **线程级信号**
   - 每个线程独立的信号屏蔽字
   - tgkill/tkill 系统调用
   - 共享信号和私有信号

3. **丰富的信号信息**
   - siginfo_t 结构
   - SA_SIGINFO 标志
   - 信号来源追踪

4. **安全增强**
   - 能力系统
   - 命名空间隔离
   - 特殊进程保护

5. **新系统调用**
   - pidfd_send_signal
   - signalfd
   - 定时器相关系统调用

### 10.3 设计哲学

**Linux 0.11**：
- 简单、直接
- 教学目的
- 最小实现

**Linux 5.15**：
- POSIX 兼容
- 实时信号支持
- 线程安全
- 安全可靠
- 可扩展
