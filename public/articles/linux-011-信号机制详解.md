# Linux 0.11 信号机制详解

## 目录

1. **`信号机制概述`**
2. **`信号定义与含义`**
3. **`信号相关数据结构`**
4. **`信号发送机制`**
5. **`信号处理机制`**
6. **`系统调用中的信号检测`**
7. **`信号相关系统调用`**
8. **`信号处理流程图`**

---

## 1. 信号机制概述

信号（Signal）是 Linux 进程间通信的一种机制，用于通知进程发生了某种事件。信号是一种**异步通信机制**，进程在执行过程中随时可能收到信号。

### 1.1 信号的特点

| 特点 | 说明 |
|------|------|
| **异步性** | 信号可以在任何时候发送给进程，不需要进程主动等待 |
| **简单性** | 信号只携带信号编号，不携带其他数据 |
| **灵活性** | 进程可以自定义信号处理方式 |
| **强制性** | 某些信号（如 SIGKILL）不能被忽略或捕获 |

### 1.2 信号的分类

```
+------------------+------------------+------------------+
|     可靠信号     |    不可靠信号    |    实时信号      |
|  (1-31标准信号)  |  (可能丢失)      |  (支持排队)      |
+------------------+------------------+------------------+
```

Linux 0.11 只实现了 **32 个标准信号**（信号 1-31），这些信号是**不可靠信号**，即如果多个相同的信号在处理之前到达，只会保留一个。

### 1.3 信号的生命周期

```
+--------+     +--------+     +--------+     +--------+
| 信号   |---->| 信号   |---->| 信号   |---->| 信号   |
| 产生   |     | 发送   |     | 等待   |     | 处理   |
+--------+     +--------+     +--------+     +--------+
    |              |              |              |
    v              v              v              v
 硬件异常      kill系统调用   进程signal字段   do_signal()
 键盘输入      内核发送       位图记录        用户处理函数
 软件条件
```

---

## 2. 信号定义与含义

### 2.1 信号定义

定义在 **`include/signal.h`**：

```c
#define _NSIG             32      /* 信号总数 */
#define NSIG              _NSIG

#define SIGHUP             1      /* 挂起 */
#define SIGINT             2      /* 中断 */
#define SIGQUIT            3      /* 退出 */
#define SIGILL             4      /* 非法指令 */
#define SIGTRAP            5      /* 跟踪陷阱 */
#define SIGABRT            6      /* 异常终止 */
#define SIGIOT             6      /* IOT 指令 */
#define SIGUNUSED          7      /* 未使用 */
#define SIGFPE             8      /* 浮点异常 */
#define SIGKILL            9      /* 强制终止 */
#define SIGUSR1           10      /* 用户自定义 1 */
#define SIGSEGV           11      /* 段错误 */
#define SIGUSR2           12      /* 用户自定义 2 */
#define SIGPIPE           13      /* 管道破裂 */
#define SIGALRM           14      /* 定时器到期 */
#define SIGTERM           15      /* 终止 */
#define SIGSTKFLT         16      /* 协处理器栈错误 */
#define SIGCHLD           17      /* 子进程状态改变 */
#define SIGCONT           18      /* 继续（恢复执行） */
#define SIGSTOP           19      /* 停止 */
#define SIGTSTP           20      /* 终端停止 */
#define SIGTTIN           21      /* 后台读 */
#define SIGTTOU           22      /* 后台写 */
```

### 2.2 各信号详细说明

| 信号 | 值 | 默认动作 | 说明 |
|------|-----|---------|------|
| **SIGHUP** | 1 | 终止 | 当终端关闭或控制进程结束时发送，常用于通知守护进程重新读取配置 |
| **SIGINT** | 2 | 终止 | 用户按下 Ctrl+C 时发送，用于中断当前程序 |
| **SIGQUIT** | 3 | 终止+核心转储 | 用户按下 Ctrl+\ 时发送，产生核心转储文件 |
| **SIGILL** | 4 | 终止+核心转储 | 执行非法指令时发送，如错误的机器指令 |
| **SIGTRAP** | 5 | 终止+核心转储 | 跟踪陷阱，用于调试器实现断点功能 |
| **SIGABRT** | 6 | 终止+核心转储 | 调用 abort() 函数时产生，用于异常终止程序 |
| **SIGFPE** | 8 | 终止+核心转储 | 算术异常，如除零、浮点溢出等 |
| **SIGKILL** | 9 | 终止 | **不能被捕获或忽略**，用于强制终止进程 |
| **SIGSEGV** | 11 | 终止+核心转储 | 段错误，访问无效内存地址时产生 |
| **SIGPIPE** | 13 | 终止 | 向无读取者的管道写入数据时产生 |
| **SIGALRM** | 14 | 终止 | alarm() 设置的定时器到期时产生 |
| **SIGTERM** | 15 | 终止 | 程序终止信号，可以被捕获，用于正常终止程序 |
| **SIGCHLD** | 17 | 忽略 | 子进程停止或终止时发送给父进程 |
| **SIGSTOP** | 19 | 停止进程 | **不能被捕获或忽略**，用于暂停进程 |
| **SIGCONT** | 18 | 继续/忽略 | 使停止的进程继续执行 |
| **SIGTSTP** | 20 | 停止进程 | 用户按下 Ctrl+Z 时发送，用于挂起进程 |
| **SIGUSR1** | 10 | 终止 | 用户自定义信号 1 |
| **SIGUSR2** | 12 | 终止 | 用户自定义信号 2 |

### 2.3 信号的默认处理动作

```
+------------------+----------------------------------------+
|    默认动作      |                说明                    |
+------------------+----------------------------------------+
|     终止         | 进程立即终止                           |
|     终止+核心转储 | 进程终止并生成核心转储文件（调试用）   |
|     忽略         | 进程忽略该信号，不做任何处理           |
|     停止进程     | 进程暂停执行，直到收到 SIGCONT 信号    |
|     继续/忽略    | 如果进程已停止则继续，否则忽略         |
+------------------+----------------------------------------+
```

### 2.4 特殊信号

**SIGKILL (9) 和 SIGSTOP (19) 是两个特殊信号：**

- **不能被捕获**：进程无法通过 signal() 或 sigaction() 改变其处理方式
- **不能被忽略**：进程必须响应这两个信号
- **不能被阻塞**：进程无法通过信号屏蔽字阻塞这两个信号

```c
/* 在 sched.c 中定义的不可阻塞信号 */
#define _S(nr) (1<<((nr)-1))
#define _BLOCKABLE (~(_S(SIGKILL) | _S(SIGSTOP)))
```

---

## 3. 信号相关数据结构

### 3.1 进程控制块中的信号字段

定义在 **`include/linux/sched.h`**：

```c
struct task_struct {
    ...
    long signal;                    /* 待处理信号位图 */
    struct sigaction sigaction[32]; /* 信号处理动作数组 */
    long blocked;                   /* 被阻塞的信号位图 */
    ...
};
```

### 3.2 信号位图结构

```
signal 字段（32位，每位对应一个信号）：

+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| 31 | 30 | 29 | 28 | 27 | 26 | 25 | 24 | 23 | 22 | 21 | 20 | 19 | 18 | 17 | 16 |
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
|    SIGUSR2   |   SIGUSR1   |  SIGKILL   |   SIGFPE   | SIGSEGV    | SIGPIPE    |
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
| 15 | 14 | 13 | 12 | 11 | 10 | 9  | 8  | 7  | 6  | 5  | 4  | 3  | 2  | 1  | 0  |
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
|SIGTERM|SIGALRM|SIGPIPE|SIGUSR2|SIGSEGV|SIGKILL|SIGFPE|...|SIGQUIT|SIGINT|SIGHUP|
+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+

位图操作：
- 发送信号：p->signal |= (1 << (sig - 1))
- 检查信号：if (p->signal & (1 << (sig - 1)))
- 清除信号：p->signal &= ~(1 << (sig - 1))
```

### 3.3 sigaction 结构

```c
struct sigaction {
    void (*sa_handler)(int);    /* 信号处理函数指针 */
    sigset_t sa_mask;           /* 处理信号时要阻塞的信号集 */
    int sa_flags;               /* 信号处理标志 */
    void (*sa_restorer)(void);  /* 恢复函数指针 */
};
```

### 3.4 sa_handler 的取值

```c
#define SIG_DFL  ((void (*)(int))0)   /* 默认处理 */
#define SIG_IGN  ((void (*)(int))1)   /* 忽略信号 */
/* 其他值：用户自定义信号处理函数地址 */
```

### 3.5 sa_flags 标志

```c
#define SA_NOCLDSTOP  1           /* 子进程停止时不产生 SIGCHLD */
#define SA_NOMASK     0x40000000  /* 处理信号时不阻塞该信号 */
#define SA_ONESHOT    0x80000000  /* 处理一次后恢复默认 */
```

---

## 4. 信号发送机制

### 4.1 send_sig() 函数

定义在 **`kernel/exit.c`**：

```c
static inline int send_sig(long sig, struct task_struct * p, int priv)
{
    if (!p || sig < 1 || sig > 32)
        return -EINVAL;
    
    /* 检查权限：特权进程或同用户进程可以发送信号 */
    if (priv || (current->euid == p->euid) || suser())
        p->signal |= (1 << (sig - 1));  /* 设置信号位 */
    else
        return -EPERM;
    
    return 0;
}
```

### 4.2 sys_kill() 系统调用

```c
int sys_kill(int pid, int sig)
{
    struct task_struct **p = NR_TASKS + task;
    int err, retval = 0;

    /* pid == 0: 发送给同进程组的所有进程 */
    if (!pid) while (--p > &FIRST_TASK) {
        if (*p && (*p)->pgrp == current->pid) 
            if (err = send_sig(sig, *p, 1))
                retval = err;
    }
    /* pid > 0: 发送给指定进程 */
    else if (pid > 0) while (--p > &FIRST_TASK) {
        if (*p && (*p)->pid == pid) 
            if (err = send_sig(sig, *p, 0))
                retval = err;
    }
    /* pid == -1: 发送给所有进程 */
    else if (pid == -1) while (--p > &FIRST_TASK)
        if (err = send_sig(sig, *p, 0))
            retval = err;
    /* pid < -1: 发送给指定进程组的所有进程 */
    else while (--p > &FIRST_TASK)
        if (*p && (*p)->pgrp == -pid)
            if (err = send_sig(sig, *p, 0))
                retval = err;
    
    return retval;
}
```

### 4.3 sys_kill 参数说明

```
+------------+----------------------------------------+
|   pid 值   |              发送目标                  |
+------------+----------------------------------------+
|    > 0     | 发送给进程 ID 等于 pid 的进程          |
|    == 0    | 发送给与调用进程同组的所有进程         |
|    == -1   | 发送给所有进程（有权限限制）           |
|    < -1    | 发送给进程组 ID 等于 |pid| 的所有进程  |
+------------+----------------------------------------+
```

### 4.4 内核发送信号的时机

**1. 子进程终止时通知父进程**

```c
static void tell_father(int pid)
{
    int i;

    if (pid)
        for (i = 0; i < NR_TASKS; i++) {
            if (!task[i])
                continue;
            if (task[i]->pid != pid)
                continue;
            task[i]->signal |= (1 << (SIGCHLD - 1));  /* 发送 SIGCHLD */
            return;
        }
    ...
}
```

**2. 定时器到期时发送 SIGALRM**

```c
/* 在 schedule() 中检查 */
for (p = &LAST_TASK; p > &FIRST_TASK; --p)
    if (*p) {
        if ((*p)->alarm && (*p)->alarm < jiffies) {
            (*p)->signal |= (1 << (SIGALRM - 1));  /* 发送 SIGALRM */
            (*p)->alarm = 0;
        }
        ...
    }
```

**3. 终端输入产生信号**

定义在 **`kernel/chr_drv/tty_io.c`**：

```c
#define INTMASK  (1 << (SIGINT - 1))
#define QUITMASK (1 << (SIGQUIT - 1))
#define TSTPMASK (1 << (SIGTSTP - 1))

void tty_intr(struct tty_struct * tty, int mask)
{
    int i;

    if (tty->pgrp <= 0)
        return;
    
    /* 向终端进程组中的所有进程发送信号 */
    for (i = 0; i < NR_TASKS; i++)
        if (task[i] && task[i]->pgrp == tty->pgrp)
            task[i]->signal |= mask;
}

/* 在 copy_to_cooked() 中处理特殊字符 */
if (L_ISIG(tty)) {
    if (c == INTR_CHAR(tty)) {      /* Ctrl+C */
        tty_intr(tty, INTMASK);     /* 发送 SIGINT */
        continue;
    }
    if (c == QUIT_CHAR(tty)) {      /* Ctrl+\ */
        tty_intr(tty, QUITMASK);    /* 发送 SIGQUIT */
        continue;
    }
}
```

---

## 5. 信号处理机制

### 5.1 信号检测时机

信号在以下时机被检测和处理：

```
+------------------+----------------------------------------+
|     时机         |                说明                    |
+------------------+----------------------------------------+
| 系统调用返回     | 从系统调用返回用户态前检测信号        |
| 时钟中断返回     | 从时钟中断返回用户态前检测信号        |
| 调度程序选择进程 | schedule() 唤醒可中断睡眠的进程       |
+------------------+----------------------------------------+
```

### 5.2 ret_from_sys_call 汇编代码

定义在 **`kernel/system_call.s`**：

```asm
ret_from_sys_call:
    movl _current, %eax           # 获取当前进程指针
    
    # task[0] 不能有信号
    cmpl _task, %eax
    je 3f
    
    # 检查是否从用户态返回
    cmpw $0x0f, CS(%esp)          # CS 是用户态代码段吗？
    jne 3f
    cmpw $0x17, OLDSS(%esp)       # SS 是用户态栈段吗？
    jne 3f
    
    # 检查是否有待处理的信号
    movl signal(%eax), %ebx       # ebx = current->signal
    movl blocked(%eax), %ecx      # ecx = current->blocked
    notl %ecx                     # 取反，得到未阻塞的信号
    andl %ebx, %ecx               # ecx = signal & ~blocked
    bsfl %ecx, %ecx               # 找到第一个置位的位
    je 3f                         # 如果没有信号，跳转
    
    # 清除该信号位
    btrl %ecx, %ebx
    movl %ebx, signal(%eax)
    
    # 调用 do_signal 处理信号
    incl %ecx                     # 信号编号 = 位号 + 1
    pushl %ecx
    call _do_signal
    popl %eax
    
3:  popl %eax
    popl %ebx
    popl %ecx
    popl %edx
    pop %fs
    pop %es
    pop %ds
    iret                          # 返回用户态
```

### 5.3 do_signal() 函数

定义在 **`kernel/signal.c`**：

```c
void do_signal(long signr, long eax, long ebx, long ecx, long edx,
    long fs, long es, long ds,
    long eip, long cs, long eflags,
    unsigned long * esp, long ss)
{
    unsigned long sa_handler;
    long old_eip = eip;
    struct sigaction * sa = current->sigaction + signr - 1;
    int longs;
    unsigned long * tmp_esp;

    sa_handler = (unsigned long) sa->sa_handler;
    
    /* 如果处理方式是忽略，直接返回 */
    if (sa_handler == 1)
        return;
    
    /* 如果是默认处理 */
    if (!sa_handler) {
        if (signr == SIGCHLD)
            return;               /* SIGCHLD 默认忽略 */
        else
            do_exit(1 << (signr - 1));  /* 其他信号默认终止进程 */
    }
    
    /* SA_ONESHOT: 处理一次后恢复默认 */
    if (sa->sa_flags & SA_ONESHOT)
        sa->sa_handler = NULL;
    
    /* 修改返回地址为信号处理函数 */
    *(&eip) = sa_handler;
    
    /* 计算需要压入用户栈的数据量 */
    longs = (sa->sa_flags & SA_NOMASK) ? 7 : 8;
    
    /* 在用户栈上预留空间 */
    *(&esp) -= longs;
    verify_area(esp, longs * 4);
    
    /* 向用户栈压入数据 */
    tmp_esp = esp;
    put_fs_long((long) sa->sa_restorer, tmp_esp++);  /* 恢复函数地址 */
    put_fs_long(signr, tmp_esp++);                    /* 信号编号 */
    
    if (!(sa->sa_flags & SA_NOMASK))
        put_fs_long(current->blocked, tmp_esp++);     /* 原来的阻塞信号集 */
    
    put_fs_long(eax, tmp_esp++);    /* 保存的寄存器值 */
    put_fs_long(ecx, tmp_esp++);
    put_fs_long(edx, tmp_esp++);
    put_fs_long(eflags, tmp_esp++);
    put_fs_long(old_eip, tmp_esp++); /* 原来的返回地址 */
    
    /* 阻塞当前信号 */
    current->blocked |= sa->sa_mask;
}
```

### 5.4 用户栈布局变化

信号处理时，用户栈的变化如下：

```
处理前的用户栈：                     处理后的用户栈：
+-------------+                     +-------------+
|    ...      |                     |    ...      |
+-------------+                     +-------------+
|  原返回地址  |  <-- esp            | sa_restorer |  <-- 新的返回地址
+-------------+                     +-------------+
                                     |   signr     |  信号编号
                                     +-------------+
                                     |   blocked   |  原阻塞信号集
                                     +-------------+
                                     |    eax      |
                                     +-------------+
                                     |    ecx      |
                                     +-------------+
                                     |    edx      |
                                     +-------------+
                                     |   eflags    |
                                     +-------------+
                                     |  old_eip    |  原返回地址
                                     +-------------+  <-- esp
```

### 5.5 信号处理函数返回流程

```
1. 用户进程执行中
        |
        v
2. 系统调用/时钟中断触发
        |
        v
3. 检测到待处理信号
        |
        v
4. do_signal() 修改用户栈
   - 设置 eip = sa_handler
   - 设置返回地址 = sa_restorer
   - 压入保存的上下文
        |
        v
5. iret 返回用户态
   - 执行用户定义的信号处理函数
        |
        v
6. 信号处理函数返回
   - 跳转到 sa_restorer
        |
        v
7. sa_restorer 执行 sigreturn 系统调用
   - 恢复原来的上下文
   - 恢复原来的阻塞信号集
        |
        v
8. 返回原执行流程
```

---

## 6. 系统调用中的信号检测

### 6.1 可中断睡眠

当进程调用 `interruptible_sleep_on()` 进入睡眠时，如果收到信号，进程会被唤醒：

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
    current->state = TASK_INTERRUPTIBLE;  /* 设置为可中断睡眠状态 */
    schedule();
    
    /* 如果被唤醒但不是自己，继续等待 */
    if (*p && *p != current) {
        (**p).state = 0;
        goto repeat;
    }
    
    *p = NULL;
    if (tmp)
        tmp->state = 0;
}
```

### 6.2 schedule() 中的信号处理

```c
void schedule(void)
{
    int i, next, c;
    struct task_struct **p;

    /* 检查 alarm，唤醒收到信号的可中断睡眠进程 */
    for (p = &LAST_TASK; p > &FIRST_TASK; --p)
        if (*p) {
            /* 检查并处理 alarm */
            if ((*p)->alarm && (*p)->alarm < jiffies) {
                (*p)->signal |= (1 << (SIGALRM - 1));
                (*p)->alarm = 0;
            }
            
            /* 如果进程有未阻塞的信号且处于可中断睡眠状态，则唤醒它 */
            if (((*p)->signal & ~(_BLOCKABLE & (*p)->blocked)) &&
                (*p)->state == TASK_INTERRUPTIBLE)
                (*p)->state = TASK_RUNNING;
        }

    /* 调度算法... */
    ...
}
```

### 6.3 系统调用被信号中断

当进程在可中断睡眠状态下收到信号时，系统调用会返回 `-EINTR` 错误：

```c
/* 以 sys_waitpid 为例 */
int sys_waitpid(pid_t pid, unsigned long * stat_addr, int options)
{
    ...
    
    if (flag) {
        if (options & WNOHANG)
            return 0;
        
        current->state = TASK_INTERRUPTIBLE;
        schedule();
        
        /* 如果被信号唤醒，返回 -EINTR */
        if (!(current->signal &= ~(1 << (SIGCHLD - 1))))
            goto repeat;
        else
            return -EINTR;
    }
    
    return -ECHILD;
}
```

---

## 7. 信号相关系统调用

### 7.1 sys_signal() 系统调用

```c
int sys_signal(int signum, long handler, long restorer)
{
    struct sigaction tmp;

    /* 参数检查 */
    if (signum < 1 || signum > 32 || signum == SIGKILL)
        return -1;
    
    /* 设置信号处理动作 */
    tmp.sa_handler = (void (*)(int)) handler;
    tmp.sa_mask = 0;
    tmp.sa_flags = SA_ONESHOT | SA_NOMASK;  /* 单次处理，不阻塞 */
    tmp.sa_restorer = (void (*)(void)) restorer;
    
    /* 保存原来的处理函数 */
    handler = (long) current->sigaction[signum - 1].sa_handler;
    
    /* 安装新的处理动作 */
    current->sigaction[signum - 1] = tmp;
    
    return handler;  /* 返回原来的处理函数 */
}
```

### 7.2 sys_sigaction() 系统调用

```c
int sys_sigaction(int signum, const struct sigaction * action,
    struct sigaction * oldaction)
{
    struct sigaction tmp;

    if (signum < 1 || signum > 32 || signum == SIGKILL)
        return -1;
    
    /* 保存原来的处理动作 */
    tmp = current->sigaction[signum - 1];
    
    /* 从用户空间复制新的处理动作 */
    get_new((char *) action, (char *) (signum - 1 + current->sigaction));
    
    /* 如果需要，返回原来的处理动作 */
    if (oldaction)
        save_old((char *) &tmp, (char *) oldaction);
    
    /* 设置信号屏蔽字 */
    if (current->sigaction[signum - 1].sa_flags & SA_NOMASK)
        current->sigaction[signum - 1].sa_mask = 0;
    else
        current->sigaction[signum - 1].sa_mask |= (1 << (signum - 1));
    
    return 0;
}
```

### 7.3 sys_sgetmask() 和 sys_ssetmask()

```c
/* 获取当前阻塞信号集 */
int sys_sgetmask()
{
    return current->blocked;
}

/* 设置阻塞信号集 */
int sys_ssetmask(int newmask)
{
    int old = current->blocked;

    /* SIGKILL 不能被阻塞 */
    current->blocked = newmask & ~(1 << (SIGKILL - 1));
    
    return old;  /* 返回原来的阻塞信号集 */
}
```

### 7.4 sys_alarm() 系统调用

```c
int sys_alarm(long seconds)
{
    int old = current->alarm;

    if (old)
        old = (old - jiffies) / HZ;  /* 转换为剩余秒数 */
    
    /* 设置新的 alarm */
    current->alarm = (seconds > 0) ? (jiffies + HZ * seconds) : 0;
    
    return old;
}
```

---

## 8. 信号处理流程图

### 8.1 信号发送流程

```
用户调用 kill(pid, sig)
           |
           v
    +-------------+
    | sys_kill()  |
    +------+------+
           |
           v
    +-------------+     +-------------+
    | pid == 0?   |---->| 同进程组    |
    +------+------+     +-------------+
           | 否
           v
    +-------------+     +-------------+
    | pid > 0?    |---->| 指定进程    |
    +------+------+     +-------------+
           | 否
           v
    +-------------+     +-------------+
    | pid == -1?  |---->| 所有进程    |
    +------+------+     +-------------+
           | 否
           v
    +-------------+
    | 进程组 |pid||
    +------+------+
           |
           v
    +-------------+
    | send_sig()  |
    +------+------+
           |
           v
    +-------------+
    | 权限检查    |
    +------+------+
           |
           v
    +---------------------------+
    | p->signal |= (1<<(sig-1))|
    +---------------------------+
           |
           v
    +-------------+
    | 设置信号位  |
    +-------------+
```

### 8.2 信号处理流程

```
系统调用/时钟中断返回
           |
           v
    +-------------------+
    | ret_from_sys_call |
    +---------+---------+
              |
              v
    +-------------------+
    | 检查是否从用户态  |
    | 返回？            |
    +---------+---------+
              | 是
              v
    +-------------------+
    | signal & ~blocked |
    | 是否有值？        |
    +---------+---------+
              | 是
              v
    +-------------------+
    | 找到第一个信号    |
    | bsfl 指令         |
    +---------+---------+
              |
              v
    +-------------------+
    | 清除该信号位      |
    +---------+---------+
              |
              v
    +-------------------+
    | 调用 do_signal()  |
    +---------+---------+
              |
              v
    +-------------------+
    | 检查 sa_handler   |
    +---------+---------+
              |
    +---------+---------+---------+
    |         |         |         |
    v         v         v         v
 SIG_IGN   SIG_DFL   用户函数   NULL
    |         |         |         |
    v         v         v         v
  返回    do_exit   修改栈    do_exit
```

### 8.3 用户态信号处理流程

```
+-------------------+
|   用户进程执行    |
+---------+---------+
          |
          v
+-------------------+
| 系统调用/中断     |
+---------+---------+
          |
          v
+-------------------+
| 内核态执行        |
+---------+---------+
          |
          v
+-------------------+
| 检测到信号        |
+---------+---------+
          |
          v
+-------------------+
| do_signal()       |
| 修改用户栈        |
| eip = sa_handler  |
+---------+---------+
          |
          v
+-------------------+
| iret 返回用户态   |
+---------+---------+
          |
          v
+-------------------+
| 执行信号处理函数  |
+---------+---------+
          |
          v
+-------------------+
| 返回到 sa_restorer|
+---------+---------+
          |
          v
+-------------------+
| sigreturn 系统调用|
| 恢复上下文        |
+---------+---------+
          |
          v
+-------------------+
| 继续原进程执行    |
+-------------------+
```

### 8.4 信号与系统调用的交互

```
                    +---------------------------+
                    |      用户进程             |
                    +-------------+-------------+
                                  |
                    +-------------v-------------+
                    |    系统调用 (如 read)     |
                    +-------------+-------------+
                                  |
                    +-------------v-------------+
                    |    进入内核态             |
                    +-------------+-------------+
                                  |
                    +-------------v-------------+
                    |    进程睡眠等待 I/O       |
                    |    state = TASK_          |
                    |    INTERRUPTIBLE          |
                    +-------------+-------------+
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
+---------v---------+   +---------v---------+   +---------v---------+
|    I/O 完成       |   |    收到信号      |   |    超时          |
|    唤醒进程       |   |    唤醒进程      |   |    alarm 到期    |
+---------+---------+   +---------+---------+   +---------+---------+
          |                       |                       |
          v                       v                       v
+-------------------+   +-------------------+   +-------------------+
| 正常返回          |   | 返回 -EINTR       |   | 发送 SIGALRM      |
| 系统调用完成      |   | 系统调用被中断    |   |                   |
+-------------------+   +-------------------+   +-------------------+
```

---

## 9. 总结

### 9.1 信号机制核心组件

```
+-------------------+     +-------------------+     +-------------------+
|    信号产生       |     |    信号发送       |     |    信号处理       |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          v                         v                         v
+-------------------+     +-------------------+     +-------------------+
| 硬件异常          |     | send_sig()        |     | do_signal()       |
| - 除零 (SIGFPE)   |     |                   |     |                   |
| - 段错误(SIGSEGV) |     | 设置 signal 位图  |     | 检查 sa_handler   |
|                   |     |                   |     |                   |
| 键盘输入          |     | sys_kill()        |     | 修改用户栈        |
| - Ctrl+C (SIGINT) |     |                   |     |                   |
| - Ctrl+\ (SIGQUIT)|     | 向进程/进程组发送 |     | 设置返回地址      |
|                   |     |                   |     |                   |
| 软件条件          |     | 内核内部发送      |     | 压入保存的上下文  |
| - alarm (SIGALRM) |     | - SIGCHLD         |     |                   |
| - 管道破裂(SIGPIPE)|     | - SIGALRM         |     |                   |
+-------------------+     +-------------------+     +-------------------+
```

### 9.2 关键数据结构大小

| 数据结构 | 大小 | 说明 |
|---------|------|------|
| signal | 4 字节 | 信号位图，32 位对应 32 个信号 |
| blocked | 4 字节 | 阻塞信号位图 |
| sigaction[32] | 512 字节 | 32 个信号的处理动作 |
| struct sigaction | 16 字节 | 单个信号的处理动作 |

### 9.3 信号处理要点

1. **信号是异步的**：进程无法预测何时会收到信号
2. **信号可能丢失**：标准信号是不可靠信号，多次发送只记录一次
3. **SIGKILL 和 SIGSTOP 不能被捕获或忽略**
4. **信号处理函数在用户态执行**：内核只是设置好栈和返回地址
5. **系统调用可能被信号中断**：返回 -EINTR 错误
6. **可中断睡眠的进程收到信号会被唤醒**