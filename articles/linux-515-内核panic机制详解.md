# Linux 5.15 内核Panic机制详解

> 本文档从初学者角度详细讲解Linux内核panic机制，涵盖核心概念、数据结构、内核实现、处理流程和应用场景。

---

## 目录

1. **`Panic概述`**
2. **`核心数据结构`**
3. **`Panic函数实现`**
4. **`Die函数与Oops处理`**
5. [内核污染标志(Taint)](五内核污染标志taint)
6. **`BUG与WARN宏`**
7. **`Crash Dump机制`**
8. **`Panic通知器`**
9. **`Kmsg Dump机制`**
10. **`Panic触发场景`**
11. **`调试与问题排查`**
12. **`总结`**

---

## 一、Panic概述

### 1.1 什么是Panic？

Panic是Linux内核处理**致命错误**的最终机制。当内核遇到无法恢复的严重错误时，会调用`panic()`函数，导致系统停止运行并显示错误信息。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Panic核心概念                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  致命错误   │───▶│   panic()   │───▶│  系统停止   │         │
│  │  触发条件   │    │   处理函数  │    │  或重启     │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                 │
│  • 致命错误：内核无法继续安全运行的错误                          │
│  • panic()：内核提供的错误处理函数                               │
│  • 系统停止：所有CPU停止，显示错误信息，可能重启                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 为什么需要Panic？

```
┌─────────────────────────────────────────────────────────────────┐
│                    Panic存在的意义                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 数据完整性保护                                              │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 当内核数据结构被破坏时，继续运行可能导致：            │    │
│     │ • 文件系统损坏                                       │    │
│     │ • 用户数据丢失                                       │    │
│     │ • 安全漏洞利用                                       │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. 错误诊断                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Panic会打印详细的错误信息：                          │    │
│     │ • 错误类型和位置                                     │    │
│     │ • 寄存器状态                                         │    │
│     │ • 调用栈回溯                                         │    │
│     │ • 内核污染标志                                       │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. 系统恢复                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Panic后的处理选项：                                  │    │
│     │ • 自动重启（panic_timeout）                          │    │
│     │ • 触发kdump转储内核崩溃信息                          │    │
│     │ • 等待用户手动干预                                   │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Panic与Oops的区别

| 特性 | Panic | Oops |
|------|-------|------|
| **严重程度** | 致命错误，无法恢复 | 严重错误，可能恢复 |
| **影响范围** | 整个系统停止 | 仅杀死当前进程 |
| **触发函数** | `panic()` | `die()` |
| **后续处理** | 系统重启或停止 | 进程终止，系统继续 |
| **典型场景** | 内核数据结构损坏 | 非法内存访问 |

### 1.4 生活中的类比

```
┌─────────────────────────────────────────────────────────────────┐
│                    生活类比：医院急救                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  正常运行 ──▶ 病人健康，医院正常运转                            │
│                                                                 │
│  WARN()   ──▶ 轻度不适，医生警告需要注意                         │
│              （内核发出警告，但可以继续运行）                     │
│                                                                 │
│  Oops     ──▶ 某个病人病情严重，需要紧急治疗                     │
│              （杀死问题进程，其他进程继续运行）                   │
│                                                                 │
│  Panic    ──▶ 医院发生重大事故（如火灾），必须全员撤离           │
│              （整个系统停止，无法继续运行）                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、核心数据结构

### 2.1 数据结构关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Panic相关数据结构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐                                         │
│  │   panic_cpu       │  当前执行panic的CPU                      │
│  │   (atomic_t)      │  用于SMP同步                            │
│  └───────────────────┘                                         │
│            │                                                    │
│            ▼                                                    │
│  ┌───────────────────┐    ┌───────────────────┐                │
│  │ panic_notifier_list│───▶│ atomic_notifier_head│               │
│  │                    │    │                    │                │
│  │ panic通知器链表    │    │ 注册的回调函数     │                │
│  └───────────────────┘    └───────────────────┘                │
│                                                                 │
│  ┌───────────────────┐    ┌───────────────────┐                │
│  │   tainted_mask    │    │   taint_flag      │                │
│  │   (unsigned long) │    │   (结构体数组)    │                │
│  │                    │    │                    │                │
│  │ 内核污染位掩码     │    │ 污染标志定义       │                │
│  └───────────────────┘    └───────────────────┘                │
│                                                                 │
│  ┌───────────────────┐    ┌───────────────────┐                │
│  │   panic_timeout   │    │   panic_print     │                │
│  │   (int)           │    │   (unsigned long) │                │
│  │                    │    │                    │                │
│  │ 重启超时时间(秒)   │    │ 打印信息控制位     │                │
│  └───────────────────┘    └───────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心全局变量

```c
/* kernel/panic.c */

/* 
 * panic_cpu - 用于同步多个CPU的panic调用
 * PANIC_CPU_INVALID (-1) 表示没有CPU正在执行panic
 */
atomic_t panic_cpu = ATOMIC_INIT(PANIC_CPU_INVALID);

/* 
 * panic_timeout - panic后自动重启的等待时间（秒）
 * 0 = 不重启，等待用户干预
 * >0 = 等待指定秒数后重启
 * <0 = 立即重启
 */
int panic_timeout = CONFIG_PANIC_TIMEOUT;
EXPORT_SYMBOL_GPL(panic_timeout);

/* 
 * panic_print - 控制panic时打印哪些额外信息
 * 位掩码，每位控制一种信息的打印
 */
unsigned long panic_print;

/* 
 * panic_on_oops - 当发生oops时是否触发panic
 * 0 = 不触发，仅杀死进程
 * 1 = 触发panic，系统停止
 */
int panic_on_oops = CONFIG_PANIC_ON_OOPS_VALUE;

/* 
 * panic_on_warn - 当发出WARN警告时是否触发panic
 * 用于调试，捕获所有警告
 */
int panic_on_warn __read_mostly;

/* 
 * tainted_mask - 内核污染状态位掩码
 * 每位代表一种污染源
 */
static unsigned long tainted_mask =
    IS_ENABLED(CONFIG_GCC_PLUGIN_RANDSTRUCT) ? (1 << TAINT_RANDSTRUCT) : 0;

/* 
 * crash_kexec_post_notifiers - 是否在通知器之后执行crash dump
 * true = 先运行通知器，再做crash dump
 * false = 先做crash dump
 */
bool crash_kexec_post_notifiers;
```

### 2.3 panic_print 控制位

```c
/* kernel/panic.c */

#define PANIC_PRINT_TASK_INFO       0x00000001  /* 打印所有任务状态 */
#define PANIC_PRINT_MEM_INFO        0x00000002  /* 打印内存信息 */
#define PANIC_PRINT_TIMER_INFO      0x00000004  /* 打印定时器信息 */
#define PANIC_PRINT_LOCK_INFO       0x00000008  /* 打印锁信息 */
#define PANIC_PRINT_FTRACE_INFO     0x00000010  /* 打印ftrace信息 */
#define PANIC_PRINT_ALL_PRINTK_MSG  0x00000020  /* 打印所有printk消息 */

/*
 * 使用方法：
 * panic_print = PANIC_PRINT_TASK_INFO | PANIC_PRINT_MEM_INFO;
 * 或通过内核参数：panic_print=0x3
 */
```

### 2.4 内核污染标志定义

```c
/* include/linux/panic.h */

/* 
 * 污染标志索引
 * 每个标志代表一种可能导致内核行为异常的因素
 */
#define TAINT_PROPRIETARY_MODULE    0   /* 加载了专有模块 (P) */
#define TAINT_FORCED_MODULE         1   /* 强制加载模块 (F) */
#define TAINT_CPU_OUT_OF_SPEC       2   /* CPU超出规格运行 (S) */
#define TAINT_FORCED_RMMOD          3   /* 强制卸载模块 (R) */
#define TAINT_MACHINE_CHECK         4   /* 发生机器检查异常 (M) */
#define TAINT_BAD_PAGE              5   /* 检测到坏页 (B) */
#define TAINT_USER                  6   /* 用户请求污染 (U) */
#define TAINT_DIE                   7   /* 内核发生oops (D) */
#define TAINT_OVERRIDDEN_ACPI_TABLE 8   /* 覆盖了ACPI表 (A) */
#define TAINT_WARN                  9   /* 发出警告 (W) */
#define TAINT_CRAP                  10  /* 加载了测试/ crap模块 (C) */
#define TAINT_FIRMWARE_WORKAROUND   11  /* 固件绕过 (I) */
#define TAINT_OOT_MODULE            12  /* 树外模块 (O) */
#define TAINT_UNSIGNED_MODULE       13  /* 未签名模块 (E) */
#define TAINT_SOFTLOCKUP            14  /* 发生软锁死 (L) */
#define TAINT_LIVEPATCH             15  /* 应用实时补丁 (K) */
#define TAINT_AUX                   16  /* 辅助污染 (X) */
#define TAINT_RANDSTRUCT            17  /* 随机化结构 (T) */

#define TAINT_FLAGS_COUNT           18  /* 污染标志总数 */
```

### 2.5 taint_flag 结构体

```c
/* kernel/panic.c */

/*
 * taint_flags - 污染标志的字符表示
 * c_true: 污染时显示的字符
 * c_false: 未污染时显示的字符
 * module: 是否也作为模块污染标志
 */
const struct taint_flag taint_flags[TAINT_FLAGS_COUNT] = {
    [ TAINT_PROPRIETARY_MODULE ]    = { 'P', 'G', true },
    [ TAINT_FORCED_MODULE ]         = { 'F', ' ', true },
    [ TAINT_CPU_OUT_OF_SPEC ]       = { 'S', ' ', false },
    [ TAINT_FORCED_RMMOD ]          = { 'R', ' ', false },
    [ TAINT_MACHINE_CHECK ]         = { 'M', ' ', false },
    [ TAINT_BAD_PAGE ]              = { 'B', ' ', false },
    [ TAINT_USER ]                  = { 'U', ' ', false },
    [ TAINT_DIE ]                   = { 'D', ' ', false },
    [ TAINT_OVERRIDDEN_ACPI_TABLE ] = { 'A', ' ', false },
    [ TAINT_WARN ]                  = { 'W', ' ', false },
    [ TAINT_CRAP ]                  = { 'C', ' ', true },
    [ TAINT_FIRMWARE_WORKAROUND ]   = { 'I', ' ', false },
    [ TAINT_OOT_MODULE ]            = { 'O', ' ', true },
    [ TAINT_UNSIGNED_MODULE ]       = { 'E', ' ', true },
    [ TAINT_SOFTLOCKUP ]            = { 'L', ' ', false },
    [ TAINT_LIVEPATCH ]             = { 'K', ' ', true },
    [ TAINT_AUX ]                   = { 'X', ' ', true },
    [ TAINT_RANDSTRUCT ]            = { 'T', ' ', true },
};
```

---

## 三、Panic函数实现

### 3.1 panic() 函数完整实现

```c
/* kernel/panic.c */

/**
 * panic - halt the system
 * @fmt: The text string to print
 *
 * Display a message, then perform cleanups.
 *
 * This function never returns.
 */
void panic(const char *fmt, ...)
{
    static char buf[1024];
    va_list args;
    long i, i_next = 0, len;
    int state = 0;
    int old_cpu, this_cpu;
    bool _crash_kexec_post_notifiers = crash_kexec_post_notifiers;

    /* 步骤1: 重置panic_on_warn，防止递归 */
    if (panic_on_warn) {
        panic_on_warn = 0;
    }

    /* 步骤2: 禁用本地中断和抢占 */
    local_irq_disable();
    preempt_disable_notrace();

    /* 步骤3: SMP同步 - 只允许一个CPU执行panic */
    this_cpu = raw_smp_processor_id();
    old_cpu  = atomic_cmpxchg(&panic_cpu, PANIC_CPU_INVALID, this_cpu);

    if (old_cpu != PANIC_CPU_INVALID && old_cpu != this_cpu)
        panic_smp_self_stop();  /* 其他CPU停止自己 */

    /* 步骤4: 设置控制台为详细模式 */
    console_verbose();
    bust_spinlocks(1);

    /* 步骤5: 格式化并打印panic消息 */
    va_start(args, fmt);
    len = vscnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    if (len && buf[len - 1] == '\n')
        buf[len - 1] = '\0';

    pr_emerg("Kernel panic - not syncing: %s\n", buf);

    /* 步骤6: 打印调用栈 */
#ifdef CONFIG_DEBUG_BUGVERBOSE
    if (!test_taint(TAINT_DIE) && oops_in_progress <= 1)
        dump_stack();
#endif

    /* 步骤7: 给kgdb调试器一个机会 */
    kgdb_panic(buf);

    /* 步骤8: 尝试crash dump（如果配置了kdump） */
    if (!_crash_kexec_post_notifiers) {
        __crash_kexec(NULL);
        smp_send_stop();  /* 停止其他CPU */
    } else {
        crash_smp_send_stop();
    }

    /* 步骤9: 执行panic通知器链 */
    atomic_notifier_call_chain(&panic_notifier_list, 0, buf);

    /* 步骤10: 转储内核日志消息 */
    kmsg_dump(KMSG_DUMP_PANIC);

    /* 步骤11: 如果需要，在通知器之后执行crash dump */
    if (_crash_kexec_post_notifiers)
        __crash_kexec(NULL);

    /* 步骤12: 清屏并刷新控制台 */
#ifdef CONFIG_VT
    unblank_screen();
#endif
    console_unblank();
    debug_locks_off();
    console_flush_on_panic(CONSOLE_FLUSH_PENDING);

    /* 步骤13: 打印系统信息 */
    panic_print_sys_info();

    /* 步骤14: 处理重启超时 */
    if (!panic_blink)
        panic_blink = no_blink;

    if (panic_timeout > 0) {
        pr_emerg("Rebooting in %d seconds..\n", panic_timeout);

        for (i = 0; i < panic_timeout * 1000; i += PANIC_TIMER_STEP) {
            touch_nmi_watchdog();
            if (i >= i_next) {
                i += panic_blink(state ^= 1);
                i_next = i + 3600 / PANIC_BLINK_SPD;
            }
            mdelay(PANIC_TIMER_STEP);
        }
    }

    /* 步骤15: 执行重启 */
    if (panic_timeout != 0) {
        if (panic_reboot_mode != REBOOT_UNDEFINED)
            reboot_mode = panic_reboot_mode;
        emergency_restart();
    }

    /* 步骤16: 死循环 - 永不返回 */
    pr_emerg("---[ end Kernel panic - not syncing: %s ]---\n", buf);
    suppress_printk = 1;

    console_flush_on_panic(CONSOLE_FLUSH_PENDING);

    local_irq_enable();
    for (i = 0; ; i += PANIC_TIMER_STEP) {
        touch_softlockup_watchdog();
        if (i >= i_next) {
            i += panic_blink(state ^= 1);
            i_next = i + 3600 / PANIC_BLINK_SPD;
        }
        mdelay(PANIC_TIMER_STEP);
    }
}

EXPORT_SYMBOL(panic);
```

### 3.2 Panic处理流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    panic() 处理流程                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. 禁用中断和抢占                                        │   │
│  │    local_irq_disable()                                  │   │
│  │    preempt_disable_notrace()                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 2. SMP同步（只允许一个CPU执行）                          │   │
│  │    atomic_cmpxchg(&panic_cpu, PANIC_CPU_INVALID, cpu)   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 3. 打印panic消息                                         │   │
│  │    pr_emerg("Kernel panic - not syncing: %s\n", buf)    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 4. 尝试kdump crash dump                                  │   │
│  │    __crash_kexec(NULL)                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 5. 停止其他CPU                                           │   │
│  │    smp_send_stop()                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 6. 执行panic通知器链                                     │   │
│  │    atomic_notifier_call_chain(&panic_notifier_list...)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 7. 转储内核日志                                          │   │
│  │    kmsg_dump(KMSG_DUMP_PANIC)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 8. 刷新控制台，打印系统信息                              │   │
│  │    console_flush_on_panic()                             │   │
│  │    panic_print_sys_info()                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 9. 检查panic_timeout                                     │   │
│  │    > 0: 等待后重启                                       │   │
│  │    < 0: 立即重启                                         │   │
│  │    = 0: 死循环等待                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 10. 执行emergency_restart() 或 进入死循环                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 panic_print_sys_info() 实现

```c
/* kernel/panic.c */

/*
 * panic_print_sys_info - 根据panic_print打印系统信息
 */
static void panic_print_sys_info(void)
{
    /* 打印所有printk消息 */
    if (panic_print & PANIC_PRINT_ALL_PRINTK_MSG)
        console_flush_on_panic(CONSOLE_REPLAY_ALL);

    /* 打印所有任务状态 */
    if (panic_print & PANIC_PRINT_TASK_INFO)
        show_state();

    /* 打印内存信息 */
    if (panic_print & PANIC_PRINT_MEM_INFO)
        show_mem(0, NULL);

    /* 打印定时器信息 */
    if (panic_print & PANIC_PRINT_TIMER_INFO)
        sysrq_timer_list_show();

    /* 打印锁信息 */
    if (panic_print & PANIC_PRINT_LOCK_INFO)
        debug_show_all_locks();

    /* 打印ftrace信息 */
    if (panic_print & PANIC_PRINT_FTRACE_INFO)
        ftrace_dump(DUMP_ALL);
}
```

### 3.4 NMI Panic处理

```c
/* kernel/panic.c */

/*
 * nmi_panic - 在NMI上下文中调用的panic变体
 * @regs: 寄存器状态
 * @msg: panic消息
 *
 * NMI (Non-Maskable Interrupt) 上下文有特殊限制，
 * 需要使用这个函数而不是直接调用panic()
 */
void nmi_panic(struct pt_regs *regs, const char *msg)
{
    int old_cpu, cpu;

    cpu = raw_smp_processor_id();
    old_cpu = atomic_cmpxchg(&panic_cpu, PANIC_CPU_INVALID, cpu);

    if (old_cpu == PANIC_CPU_INVALID)
        panic("%s", msg);  /* 第一个触发panic的CPU */
    else if (old_cpu != cpu)
        nmi_panic_self_stop(regs);  /* 其他CPU停止自己 */
}
EXPORT_SYMBOL(nmi_panic);
```

---

## 四、Die函数与Oops处理

### 4.1 die() 函数实现

```c
/* arch/x86/kernel/dumpstack.c */

/*
 * die - 处理内核oops
 * @str: 错误描述字符串
 * @regs: 寄存器状态
 * @err: 错误码
 *
 * 这是x86架构的oops处理函数，
 * 当内核发生严重错误但可能恢复时调用
 */
void die(const char *str, struct pt_regs *regs, long err)
{
    unsigned long flags = oops_begin();
    int sig = SIGSEGV;

    if (__die(str, regs, err))
        sig = 0;
    
    oops_end(flags, regs, sig);
}
```

### 4.2 oops_begin() 和 oops_end()

```c
/* arch/x86/kernel/dumpstack.c */

/*
 * oops_begin - oops处理开始
 * 返回保存的irq标志
 */
unsigned long oops_begin(void)
{
    int cpu;
    unsigned long flags;

    oops_enter();  /* 通知panic.c的oops处理 */

    /* 保存中断状态并禁用中断 */
    raw_local_irq_save(flags);
    cpu = smp_processor_id();

    /* 获取die_lock，防止多个CPU同时打印 */
    if (!arch_spin_trylock(&die_lock)) {
        if (cpu == die_owner)
            /* 嵌套oops，继续 */;
        else
            arch_spin_lock(&die_lock);
    }
    
    die_nest_count++;
    die_owner = cpu;
    console_verbose();
    bust_spinlocks(1);
    
    return flags;
}

/*
 * oops_end - oops处理结束
 * @flags: oops_begin返回的irq标志
 * @regs: 寄存器状态
 * @signr: 要发送的信号
 */
void oops_end(unsigned long flags, struct pt_regs *regs, int signr)
{
    /* 尝试crash dump */
    if (regs && kexec_should_crash(current))
        crash_kexec(regs);

    bust_spinlocks(0);
    die_owner = -1;
    add_taint(TAINT_DIE, LOCKDEP_NOW_UNRELIABLE);
    die_nest_count--;
    
    if (!die_nest_count)
        arch_spin_unlock(&die_lock);
    
    raw_local_irq_restore(flags);
    oops_exit();

    /* 打印执行摘要 */
    __show_regs(&exec_summary_regs, SHOW_REGS_ALL, KERN_DEFAULT);

    if (!signr)
        return;
    
    /* 在中断上下文中发生致命异常 -> panic */
    if (in_interrupt())
        panic("Fatal exception in interrupt");
    
    /* panic_on_oops设置 -> panic */
    if (panic_on_oops)
        panic("Fatal exception");

    /* 杀死当前进程 */
    kasan_unpoison_task_stack(current);
    rewind_stack_and_make_dead(signr);
}
```

### 4.3 __die() 函数实现

```c
/* arch/x86/kernel/dumpstack.c */

/*
 * __die_header - 打印oops头部信息
 */
static void __die_header(const char *str, struct pt_regs *regs, long err)
{
    const char *pr = "";

    /* 保存第一个oops的寄存器用于执行摘要 */
    if (!die_counter)
        exec_summary_regs = *regs;

    if (IS_ENABLED(CONFIG_PREEMPTION))
        pr = IS_ENABLED(CONFIG_PREEMPT_RT) ? " PREEMPT_RT" : " PREEMPT";

    printk(KERN_DEFAULT
           "%s: %04lx [#%d]%s%s%s%s%s\n", str, err & 0xffff, ++die_counter,
           pr,
           IS_ENABLED(CONFIG_SMP)     ? " SMP"             : "",
           debug_pagealloc_enabled()  ? " DEBUG_PAGEALLOC" : "",
           IS_ENABLED(CONFIG_KASAN)   ? " KASAN"           : "",
           IS_ENABLED(CONFIG_PAGE_TABLE_ISOLATION) ?
           (boot_cpu_has(X86_FEATURE_PTI) ? " PTI" : " NOPTI") : "");
}

/*
 * __die_body - 打印oops主体信息
 */
static int __die_body(const char *str, struct pt_regs *regs, long err)
{
    show_regs(regs);      /* 显示寄存器 */
    print_modules();      /* 显示加载的模块 */

    /* 通知die事件监听者 */
    if (notify_die(DIE_OOPS, str, regs, err,
            current->thread.trap_nr, SIGSEGV) == NOTIFY_STOP)
        return 1;

    return 0;
}

/*
 * __die - 完整的oops信息打印
 */
int __die(const char *str, struct pt_regs *regs, long err)
{
    __die_header(str, regs, err);
    return __die_body(str, regs, err);
}
```

### 4.4 Oops处理流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Oops处理流程                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  异常触发（如除零、缺页、GP异常等）                              │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ do_trap_no_signal()                                      │   │
│  │ 检查是否可以修复异常                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ▼ 无法修复                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ die(str, regs, error_code)                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ oops_begin()                                             │   │
│  │ • 禁用中断                                               │   │
│  │ • 获取die_lock                                           │   │
│  │ • 设置控制台详细模式                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ __die()                                                   │   │
│  │ • 打印错误类型和错误码                                    │   │
│  │ • show_regs() 显示寄存器                                 │   │
│  │ • print_modules() 显示模块                               │   │
│  │ • 打印调用栈                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ oops_end()                                               │   │
│  │ • 尝试crash_kexec()                                      │   │
│  │ • 添加TAINT_DIE污染标志                                   │   │
│  │ • 释放die_lock                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ├─────────────────┬─────────────────┐               │
│            ▼                 ▼                 ▼               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │ in_interrupt │ │panic_on_oops │ │ 正常情况     │           │
│  │              │ │ = 1          │ │              │           │
│  │ panic()      │ │ panic()      │ │ 杀死进程     │           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、内核污染标志(Taint)

### 5.1 污染标志的作用

```
┌─────────────────────────────────────────────────────────────────┐
│                    污染标志的作用                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  内核污染标志用于标记内核处于"非纯净"状态，                      │
│  可能影响内核的稳定性和可靠性。                                  │
│                                                                 │
│  主要用途：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. 问题报告：开发者看到污染标志时，可能拒绝处理bug报告    │   │
│  │ 2. 调试信息：帮助判断问题是否由非标准因素引起            │   │
│  │ 3. 安全审计：某些安全功能在污染状态下可能被禁用          │   │
│  │ 4. 锁调试：某些污染会导致锁调试被禁用                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  污染标志显示位置：                                             │
│  • Oops/Panic消息中                                             │
│  • /proc/sys/kernel/tainted 文件                                │
│  • 'cat /proc/version' 输出                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 add_taint() 函数

```c
/* kernel/panic.c */

/**
 * add_taint: add a taint flag if not already set.
 * @flag: one of the TAINT_* constants.
 * @lockdep_ok: whether lock debugging is still OK.
 *
 * If something bad has gone wrong, you'll want @lockdebug_ok = false, but for
 * some notewortht-but-not-corrupting cases, it can be set to true.
 */
void add_taint(unsigned flag, enum lockdep_ok lockdep_ok)
{
    /* 如果锁调试变得不可靠，禁用它 */
    if (lockdep_ok == LOCKDEP_NOW_UNRELIABLE && __debug_locks_off())
        pr_warn("Disabling lock debugging due to kernel taint\n");

    /* 设置污染位 */
    set_bit(flag, &tainted_mask);

    /* 如果设置了panic_on_taint，触发panic */
    if (tainted_mask & panic_on_taint) {
        panic_on_taint = 0;
        panic("panic_on_taint set ...");
    }
}
EXPORT_SYMBOL(add_taint);
```

### 5.3 print_tainted() 函数

```c
/* kernel/panic.c */

/**
 * print_tainted - return a string to represent the kernel taint state.
 *
 * 返回格式: "Tainted: PWC..." 或 "Not tainted"
 */
const char *print_tainted(void)
{
    static char buf[TAINT_FLAGS_COUNT + sizeof("Tainted: ")];

    BUILD_BUG_ON(ARRAY_SIZE(taint_flags) != TAINT_FLAGS_COUNT);

    if (tainted_mask) {
        char *s;
        int i;

        s = buf + sprintf(buf, "Tainted: ");
        for (i = 0; i < TAINT_FLAGS_COUNT; i++) {
            const struct taint_flag *t = &taint_flags[i];
            *s++ = test_bit(i, &tainted_mask) ?
                    t->c_true : t->c_false;
        }
        *s = 0;
    } else
        snprintf(buf, sizeof(buf), "Not tainted");

    return buf;
}
```

### 5.4 污染标志示例

```
示例输出：
Tainted: PWOE   (解析如下)

P - Proprietary module loaded (加载了专有模块)
W - Warning issued (发出了警告)
O - Out-of-tree module loaded (加载了树外模块)
E - Unsigned module loaded (加载了未签名模块)

完整字符含义：
P - Proprietary module (专有模块)
F - Forced module (强制加载模块)
S - SMP with CPUs not designed for SMP (CPU超出规格)
R - Forced module removal (强制卸载模块)
M - Machine check exception (机器检查异常)
B - Bad page (坏页)
U - User taint (用户请求污染)
D - Kernel oops (内核oops)
A - ACPI table overridden (ACPI表覆盖)
W - Warning (警告)
C - Crap module (测试模块)
I - Firmware workaround (固件绕过)
O - Out-of-tree module (树外模块)
E - Unsigned module (未签名模块)
L - Soft lockup (软锁死)
K - Live patching (实时补丁)
X - Auxiliary (辅助)
T - Struct randomization (结构随机化)
```

---

## 六、BUG与WARN宏

### 6.1 BUG() 宏定义

```c
/* include/asm-generic/bug.h */

/*
 * BUG() - 触发致命错误
 * 
 * 使用场景：当遇到无法恢复的错误时
 * 注意：这会导致系统panic，谨慎使用！
 */
#ifndef HAVE_ARCH_BUG
#define BUG() do { \
    printk("BUG: failure at %s:%d/%s()!\n", __FILE__, __LINE__, __func__); \
    barrier_before_unreachable(); \
    panic("BUG!"); \
} while (0)
#endif

/*
 * BUG_ON() - 条件触发BUG
 * @condition: 检查条件
 */
#ifndef HAVE_ARCH_BUG_ON
#define BUG_ON(condition) do { if (unlikely(condition)) BUG(); } while (0)
#endif
```

### 6.2 WARN() 宏定义

```c
/* include/asm-generic/bug.h */

/*
 * WARN(), WARN_ON(), WARN_ON_ONCE - 发出警告
 *
 * 使用场景：报告重要但可恢复的内核问题
 * 注意：不要用于外部输入验证或临时条件（如ENOMEM）
 */
#ifndef WARN_ON
#define WARN_ON(condition) ({                      \
    int __ret_warn_on = !!(condition);             \
    if (unlikely(__ret_warn_on))                   \
        __WARN();                                  \
    unlikely(__ret_warn_on);                       \
})
#endif

#ifndef WARN
#define WARN(condition, format...) ({              \
    int __ret_warn_on = !!(condition);             \
    if (unlikely(__ret_warn_on))                   \
        __WARN_printf(TAINT_WARN, format);         \
    unlikely(__ret_warn_on);                       \
})
#endif

/* WARN_ON_ONCE - 只警告一次 */
#ifndef WARN_ON_ONCE
#define WARN_ON_ONCE(condition)                    \
    DO_ONCE_LITE_IF(condition, WARN_ON, 1)
#endif

/* WARN_ONCE - 只警告一次，带格式化消息 */
#define WARN_ONCE(condition, format...)            \
    DO_ONCE_LITE_IF(condition, WARN, 1, format)
```

### 6.3 __warn() 函数实现

```c
/* kernel/panic.c */

/*
 * __warn - 内部警告处理函数
 * @file: 源文件名
 * @line: 行号
 * @caller: 调用者地址
 * @taint: 污染标志
 * @regs: 寄存器状态（可选）
 * @args: 额外参数（可选）
 */
void __warn(const char *file, int line, void *caller, unsigned taint,
        struct pt_regs *regs, struct warn_args *args)
{
    disable_trace_on_warning();

    /* 打印警告头部 */
    if (file)
        pr_warn("WARNING: CPU: %d PID: %d at %s:%d %pS\n",
            raw_smp_processor_id(), current->pid, file, line,
            caller);
    else
        pr_warn("WARNING: CPU: %d PID: %d at %pS\n",
            raw_smp_processor_id(), current->pid, caller);

    /* 打印额外消息 */
    if (args)
        vprintk(args->fmt, args->args);

    print_modules();

    /* 显示寄存器（如果提供） */
    if (regs)
        show_regs(regs);

    /* 检查是否需要panic */
    check_panic_on_warn("kernel");

    if (!regs)
        dump_stack();

    print_irqtrace_events(current);
    print_oops_end_marker();

    /* 添加污染标志 */
    add_taint(taint, LOCKDEP_STILL_OK);
}
```

### 6.4 check_panic_on_warn() 函数

```c
/* kernel/panic.c */

/*
 * check_panic_on_warn - 检查是否需要在警告时触发panic
 * @origin: 警告来源标识
 */
void check_panic_on_warn(const char *origin)
{
    unsigned int limit;

    /* 如果设置了panic_on_warn，触发panic */
    if (panic_on_warn)
        panic("%s: panic_on_warn set ...\n", origin);

    /* 检查警告次数限制 */
    limit = READ_ONCE(warn_limit);
    if (atomic_inc_return(&warn_count) >= limit && limit)
        panic("%s: system warned too often (kernel.warn_limit is %d)",
              origin, limit);
}
```

### 6.5 BUG vs WARN 使用指南

```
┌─────────────────────────────────────────────────────────────────┐
│                    BUG vs WARN 使用指南                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  BUG() / BUG_ON()                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 使用场景：                                               │   │
│  │ • 内核数据结构损坏                                       │   │
│  │ • 无法恢复的一致性错误                                   │   │
│  │ • 逻辑上不可能到达的代码路径                             │   │
│  │ • 继续运行会导致更严重问题                               │   │
│  │                                                         │   │
│  │ 示例：                                                   │   │
│  │ if (list_empty(&task->children) && !list_empty(&task->...))   │
│  │     BUG();  /* 数据结构不一致 */                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  WARN() / WARN_ON()                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 使用场景：                                               │   │
│  │ • 检测到可疑但可恢复的情况                               │   │
│  │ • 违反预期的条件                                         │   │
│  │ • 需要记录的重要事件                                     │   │
│  │ • 可能指示bug的情况                                      │   │
│  │                                                         │   │
│  │ 示例：                                                   │   │
│  │ WARN_ON(!spin_is_locked(&lock));  /* 锁应该被持有 */    │   │
│  │ WARN(refcount == 0, "refcount underflow");              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  不应该使用WARN/BUG的场景：                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ • 验证用户空间输入（使用错误码返回）                     │   │
│  │ • 处理ENOMEN、EAGAIN等临时错误                          │   │
│  │ • 网络/设备数据验证（使用pr_err + dump_stack）          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、Crash Dump机制

### 7.1 Kdump概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kdump Crash Dump机制                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Kdump是Linux内核的崩溃转储机制，允许在内核崩溃时               │
│  保存内存映像以供事后分析。                                      │
│                                                                 │
│  工作原理：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  正常内核 (Production Kernel)                           │   │
│  │       │                                                 │   │
│  │       ▼ 发生panic                                       │   │
│  │  ┌─────────────────────────────────┐                   │   │
│  │  │ kexec加载crash kernel           │                   │   │
│  │  │ 跳转到crash kernel执行          │                   │   │
│  │  └─────────────────────────────────┘                   │   │
│  │       │                                                 │   │
│  │       ▼                                                 │   │
│  │  Crash Kernel (Capture Kernel)                         │   │
│  │       │                                                 │   │
│  │       ▼                                                 │   │
│  │  ┌─────────────────────────────────┐                   │   │
│  │  │ 保存vmcore到磁盘                │                   │   │
│  │  │ 包含崩溃时的完整内存映像        │                   │   │
│  │  └─────────────────────────────────┘                   │   │
│  │       │                                                 │   │
│  │       ▼                                                 │   │
│  │  重启或等待用户干预                                     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 crash_kexec() 函数

```c
/* kernel/kexec_core.c */

/*
 * crash_kexec - 尝试执行crash kernel
 * @regs: 寄存器状态
 *
 * 在panic时调用，尝试跳转到预加载的crash kernel
 */
void crash_kexec(struct pt_regs *regs)
{
    int old_cpu, this_cpu;

    /*
     * 只允许一个CPU执行crash_kexec()
     * 使用panic_cpu进行同步
     */
    this_cpu = raw_smp_processor_id();
    old_cpu = atomic_cmpxchg(&panic_cpu, PANIC_CPU_INVALID, this_cpu);
    
    if (old_cpu == PANIC_CPU_INVALID) {
        /* 这是第一个到达的CPU，执行crash dump */
        __crash_kexec(regs);

        /* 重置panic_cpu，允许再次调用 */
        atomic_set(&panic_cpu, PANIC_CPU_INVALID);
    }
}
```

### 7.3 __crash_kexec() 函数

```c
/* kernel/kexec_core.c */

/*
 * __crash_kexec - 实际执行crash kernel的函数
 * @regs: 寄存器状态
 *
 * 不检查panic_cpu，直接尝试执行crash kernel
 */
void __noclone __crash_kexec(struct pt_regs *regs)
{
    /*
     * 获取kexec_lock，防止sys_kexec_load
     * 在另一个CPU上替换crash kernel
     */
    if (kexec_trylock()) {
        if (kexec_crash_image) {
            struct pt_regs fixed_regs;

            /* 设置寄存器 */
            crash_setup_regs(&fixed_regs, regs);
            
            /* 保存vmcoreinfo */
            crash_save_vmcoreinfo();
            
            /* 关闭机器，准备跳转 */
            machine_crash_shutdown(&fixed_regs);
            
            /* 跳转到crash kernel */
            machine_kexec(kexec_crash_image);
        }
        kexec_unlock();
    }
}
STACK_FRAME_NON_STANDARD(__crash_kexec);
```

### 7.4 crash_kexec_post_notifiers 选项

```c
/*
 * crash_kexec_post_notifiers 控制crash dump的执行时机
 *
 * false (默认): panic -> crash_kexec -> notifiers -> kmsg_dump
 * true:         panic -> notifiers -> kmsg_dump -> crash_kexec
 *
 * 设置为true可以让通知器和kmsg_dump先运行，
 * 收集更多信息后再做crash dump。
 * 但也可能因为通知器使内核更不稳定而导致dump失败。
 */
bool crash_kexec_post_notifiers;

/* 通过内核参数设置：
 * crash_kexec_post_notifiers=1
 */
```

---

## 八、Panic通知器

### 8.1 通知器机制概述

```c
/* include/linux/panic_notifier.h */

/*
 * panic_notifier_list - panic通知器链
 *
 * 在panic时调用的回调函数列表
 * 驱动和子系统可以注册自己的处理函数
 */
extern struct atomic_notifier_head panic_notifier_list;
```

```c
/* kernel/panic.c */

/* 定义panic通知器链 */
ATOMIC_NOTIFIER_HEAD(panic_notifier_list);
EXPORT_SYMBOL(panic_notifier_list);
```

### 8.2 注册和使用通知器

```c
/*
 * 使用示例：注册panic通知器
 */

#include <linux/notifier.h>
#include <linux/panic_notifier.h>

/* 通知器回调函数 */
static int my_panic_handler(struct notifier_block *nb,
                            unsigned long action, void *data)
{
    const char *panic_msg = data;
    
    pr_emerg("My driver panic handler: %s\n", panic_msg);
    
    /* 执行驱动特定的清理工作 */
    my_driver_emergency_cleanup();
    
    return NOTIFY_OK;
}

/* 定义通知器块 */
static struct notifier_block my_panic_notifier = {
    .notifier_call = my_panic_handler,
    .priority = INT_MAX,  /* 优先级，数值越大越先执行 */
};

/* 模块初始化时注册 */
static int __init my_init(void)
{
    atomic_notifier_chain_register(&panic_notifier_list, &my_panic_notifier);
    return 0;
}

/* 模块卸载时注销 */
static void __exit my_exit(void)
{
    atomic_notifier_chain_unregister(&panic_notifier_list, &my_panic_notifier);
}
```

### 8.3 通知器执行时机

```
┌─────────────────────────────────────────────────────────────────┐
│                Panic通知器执行时机                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  panic() 调用流程：                                             │
│                                                                 │
│  1. 禁用中断、抢占                                              │
│  2. SMP同步                                                     │
│  3. 打印panic消息                                               │
│  4. kgdb_panic()                                                │
│  5. ┌─────────────────────────────────────────────────────┐    │
│     │ if (!crash_kexec_post_notifiers)                     │    │
│     │     __crash_kexec(NULL);  ← 先执行crash dump         │    │
│     │     smp_send_stop();                                 │    │
│     └─────────────────────────────────────────────────────┘    │
│  6. ┌─────────────────────────────────────────────────────┐    │
│     │ atomic_notifier_call_chain(&panic_notifier_list...)  │    │
│     │                    ↑                                 │    │
│     │            执行通知器链                              │    │
│     └─────────────────────────────────────────────────────┘    │
│  7. kmsg_dump(KMSG_DUMP_PANIC)                                 │
│  8. ┌─────────────────────────────────────────────────────┐    │
│     │ if (crash_kexec_post_notifiers)                      │    │
│     │     __crash_kexec(NULL);  ← 后执行crash dump         │    │
│     └─────────────────────────────────────────────────────┘    │
│  9. 刷新控制台                                                  │
│  10. 处理重启或死循环                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、Kmsg Dump机制

### 9.1 Kmsg Dump概述

```c
/* include/linux/kmsg_dump.h */

/*
 * kmsg_dump_reason - 内核消息转储的原因
 */
enum kmsg_dump_reason {
    KMSG_DUMP_UNDEF,      /* 未定义 */
    KMSG_DUMP_PANIC,      /* 内核panic */
    KMSG_DUMP_OOPS,       /* 内核oops */
    KMSG_DUMP_EMERG,      /* 紧急消息 */
    KMSG_DUMP_SHUTDOWN,   /* 系统关机 */
    KMSG_DUMP_MAX
};

/*
 * struct kmsg_dumper - 内核消息转储器
 * @list: 链表节点
 * @dump: 转储回调函数
 * @max_reason: 最大转储原因（过滤）
 * @registered: 是否已注册
 */
struct kmsg_dumper {
    struct list_head list;
    void (*dump)(struct kmsg_dumper *dumper, enum kmsg_dump_reason reason);
    enum kmsg_dump_reason max_reason;
    bool registered;
};
```

### 9.2 kmsg_dump() 函数

```c
/* kernel/printk/printk.c */

/*
 * kmsg_dump - 触发内核消息转储
 * @reason: 转储原因
 *
 * 遍历所有注册的转储器，调用其dump回调
 */
void kmsg_dump(enum kmsg_dump_reason reason)
{
    struct kmsg_dumper *dumper;

    rcu_read_lock();
    list_for_each_entry_rcu(dumper, &dump_list, list) {
        enum kmsg_dump_reason max_reason = dumper->max_reason;

        /*
         * 如果没有指定max_reason，默认为KMSG_DUMP_OOPS
         * 除非设置了always_kmsg_dump
         */
        if (max_reason == KMSG_DUMP_UNDEF) {
            max_reason = always_kmsg_dump ? KMSG_DUMP_MAX :
                            KMSG_DUMP_OOPS;
        }
        
        /* 检查原因是否在范围内 */
        if (reason > max_reason)
            continue;

        /* 调用转储器 */
        dumper->dump(dumper, reason);
    }
    rcu_read_unlock();
}
```

### 9.3 注册Kmsg Dumper

```c
/*
 * 使用示例：注册内核消息转储器
 */

#include <linux/kmsg_dump.h>

/* 转储回调函数 */
static void my_kmsg_dump(struct kmsg_dumper *dumper,
                         enum kmsg_dump_reason reason)
{
    struct kmsg_dump_iter iter;
    char buf[1024];
    size_t len;

    /* 初始化迭代器 */
    kmsg_dump_rewind(&iter);

    /* 读取内核消息 */
    while (kmsg_dump_get_line(&iter, true, buf, sizeof(buf), &len)) {
        /* 将消息保存到持久存储 */
        my_pstore_write(buf, len);
    }
}

/* 定义转储器 */
static struct kmsg_dumper my_dumper = {
    .dump = my_kmsg_dump,
    .max_reason = KMSG_DUMP_PANIC,  /* 只在panic时转储 */
};

/* 注册转储器 */
static int __init my_init(void)
{
    return kmsg_dump_register(&my_dumper);
}

/* 注销转储器 */
static void __exit my_exit(void)
{
    kmsg_dump_unregister(&my_dumper);
}
```

---

## 十、Panic触发场景

### 10.1 常见Panic触发场景

```
┌─────────────────────────────────────────────────────────────────┐
│                    常见Panic触发场景                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. BUG() 宏调用                                                │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ BUG();                                               │    │
│     │ BUG_ON(invalid_condition);                           │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. 栈保护检查失败                                              │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ __stack_chk_fail() -> panic("stack-protector...")    │    │
│     │ 检测到栈溢出攻击                                     │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. Oops在中断上下文                                            │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ oops_end() 中检测到 in_interrupt()                   │    │
│     │ panic("Fatal exception in interrupt")                │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  4. panic_on_oops 设置                                          │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 内核参数: oops=panic                                 │    │
│     │ 任何oops都会触发panic                                │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  5. panic_on_warn 设置                                          │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 内核参数: panic_on_warn=1                            │    │
│     │ 任何WARN都会触发panic                                │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  6. 内存分配失败（某些情况）                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 关键数据结构分配失败                                 │    │
│     │ 无法继续运行                                         │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  7. 硬件故障                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 不可恢复的机器检查异常 (MCE)                          │    │
│     │ 严重的硬件错误                                       │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  8. 文件系统损坏                                                │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 关键元数据损坏                                       │    │
│     │ 超级块损坏                                           │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 栈保护失败示例

```c
/* kernel/panic.c */

#ifdef CONFIG_STACKPROTECTOR

/*
 * __stack_chk_fail - 栈保护检查失败时调用
 *
 * 当gcc的-fstack-protector检测到栈canary被破坏时调用
 * 这通常表示发生了栈缓冲区溢出
 */
__visible noinstr void __stack_chk_fail(void)
{
    instrumentation_begin();
    panic("stack-protector: Kernel stack is corrupted in: %pB",
        __builtin_return_address(0));
    instrumentation_end();
}
EXPORT_SYMBOL(__stack_chk_fail);

#endif
```

### 10.3 内核参数控制

```
┌─────────────────────────────────────────────────────────────────┐
│                    Panic相关内核参数                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  panic=seconds                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ panic后等待多少秒后重启                                  │   │
│  │ 0 = 不自动重启（默认）                                   │   │
│  │ >0 = 等待指定秒数后重启                                  │   │
│  │ <0 = 立即重启                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  panic_print= bitmask                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 控制panic时打印哪些信息                                  │   │
│  │ 0x01 = 任务信息                                          │   │
│  │ 0x02 = 内存信息                                          │   │
│  │ 0x04 = 定时器信息                                        │   │
│  │ 0x08 = 锁信息                                            │   │
│  │ 0x10 = ftrace信息                                        │   │
│  │ 0x20 = 所有printk消息                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  oops=panic                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 设置后，任何oops都会触发panic                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  panic_on_warn=1                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 设置后，任何WARN都会触发panic                            │   │
│  │ 用于调试和测试                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  crash_kexec_post_notifiers=1                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 在通知器之后执行crash dump                               │   │
│  │ 允许通知器收集更多信息                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  panic_on_taint= bitmask                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 当指定的污染标志被设置时触发panic                        │   │
│  │ 例如: panic_on_taint=0x200 (TAINT_WARN)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 十一、调试与问题排查

### 11.1 查看Panic信息

```bash
# 查看内核污染状态
cat /proc/sys/kernel/tainted

# 查看内核版本和污染状态
cat /proc/version

# 使用dmesg查看最近的内核消息
dmesg | tail -100

# 查看kmsg
cat /dev/kmsg

# 如果配置了kdump，分析vmcore
crash /usr/lib/debug/lib/modules/$(uname -r)/vmlinux /var/crash/vmcore
```

### 11.2 解析污染状态

```bash
#!/bin/bash
# tainted_decode.sh - 解析内核污染状态

tainted=$(cat /proc/sys/kernel/tainted)

if [ "$tainted" -eq 0 ]; then
    echo "Kernel is not tainted"
    exit 0
fi

echo "Kernel is tainted: $tainted"
echo "Taint flags:"

flags=("P-proprietary" "F-forced_module" "S-cpu_out_of_spec" \
       "R-forced_rmmod" "M-machine_check" "B-bad_page" \
       "U-user" "D-die" "A-acpi_override" "W-warn" \
       "C-crap" "I-firmware_workaround" "O-oot_module" \
       "E-unsigned_module" "L-softlockup" "K-livepatch" \
       "X-aux" "T-randstruct")

for i in "${!flags[@]}"; do
    if (( tainted & (1 << i) )); then
        echo "  [${flags[$i]}]"
    fi
done
```

### 11.3 常见Panic原因分析

```
┌─────────────────────────────────────────────────────────────────┐
│                    常见Panic原因分析                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. "Kernel panic - not syncing: VFS: Unable to mount root fs" │
│     ┌─────────────────────────────────────────────────────────┐│
│     │ 原因：无法挂载根文件系统                                 ││
│     │ 解决：                                                   ││
│     │ • 检查root=内核参数是否正确                             ││
│     │ • 检查initrd/initramfs是否包含必要驱动                  ││
│     │ • 检查文件系统类型是否支持                              ││
│     └─────────────────────────────────────────────────────────┘│
│                                                                 │
│  2. "Kernel panic - not syncing: Attempted to kill init!"      │
│     ┌─────────────────────────────────────────────────────────┐│
│     │ 原因：init进程被杀死                                    ││
│     │ 解决：                                                   ││
│     │ • 检查init程序是否存在                                  ││
│     │ • 检查init是否缺少依赖库                                ││
│     │ • 检查init配置是否正确                                  ││
│     └─────────────────────────────────────────────────────────┘│
│                                                                 │
│  3. "stack-protector: Kernel stack is corrupted"               │
│     ┌─────────────────────────────────────────────────────────┐│
│     │ 原因：栈缓冲区溢出                                      ││
│     │ 解决：                                                   ││
│     │ • 检查最近加载的模块                                    ││
│     │ • 使用KASAN检测内存错误                                 ││
│     │ • 检查驱动代码中的缓冲区操作                            ││
│     └─────────────────────────────────────────────────────────┘│
│                                                                 │
│  4. "BUG: unable to handle kernel NULL pointer dereference"    │
│     ┌─────────────────────────────────────────────────────────┐│
│     │ 原因：空指针解引用                                      ││
│     │ 解决：                                                   ││
│     │ • 分析调用栈定位问题代码                                ││
│     │ • 检查指针初始化                                        ││
│     │ • 检查错误处理路径                                      ││
│     └─────────────────────────────────────────────────────────┘│
│                                                                 │
│  5. "Kernel panic - not syncing: Fatal exception"              │
│     ┌─────────────────────────────────────────────────────────┐│
│     │ 原因：oops在中断上下文或panic_on_oops设置               ││
│     │ 解决：                                                   ││
│     │ • 分析oops消息和调用栈                                  ││
│     │ • 检查中断处理函数                                      ││
│     │ • 检查硬件状态                                          ││
│     └─────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 11.4 使用Crash工具分析vmcore

```bash
# 基本crash命令
crash> sys          # 系统信息
crash> bt           # 当前任务调用栈
crash> bt -a        # 所有任务调用栈
crash> ps           # 进程列表
crash> files        # 打开的文件
crash> mount        # 挂载信息
crash> dev          # 设备信息
crash> irq          # 中断信息
crash> log          # 内核日志
crash> set          # 当前上下文
crash> foreach bt   # 每个进程的调用栈

# 内存分析
crash> kmem -i      # 内存使用信息
crash> kmem -s      # slab信息
crash> vtop <addr>  # 虚拟地址到物理地址

# 查找panic位置
crash> bt | grep -A 5 "panic"
```

---

## 总结

### 核心要点回顾

```
┌─────────────────────────────────────────────────────────────────┐
│                    Panic核心要点                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Panic的本质                                                 │
│     • 内核遇到无法恢复的致命错误                                │
│     • 系统必须停止以保证数据完整性                              │
│     • 提供详细的诊断信息                                        │
│                                                                 │
│  2. 核心函数                                                    │
│     • panic(): 致命错误处理                                     │
│     • die(): Oops处理                                           │
│     • add_taint(): 设置污染标志                                 │
│     • __crash_kexec(): 触发crash dump                           │
│                                                                 │
│  3. 关键机制                                                    │
│     • SMP同步：只允许一个CPU执行panic                           │
│     • 通知器链：允许驱动注册处理函数                            │
│     • Kmsg dump：保存内核日志                                   │
│     • Kdump：保存完整内存映像                                   │
│                                                                 │
│  4. 调试工具                                                    │
│     • BUG()/BUG_ON(): 触发panic                                 │
│     • WARN()/WARN_ON(): 发出警告                                │
│     • 污染标志：标记非纯净状态                                  │
│                                                                 │
│  5. 配置选项                                                    │
│     • panic_timeout: 自动重启                                   │
│     • panic_on_oops: Oops时panic                                │
│     • panic_on_warn: Warn时panic                                │
│     • panic_print: 额外打印信息                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 关键源码文件

| 文件 | 说明 |
|------|------|
| **`kernel/panic.c`** | Panic核心实现 |
| **`include/linux/panic.h`** | Panic头文件 |
| **`include/linux/panic_notifier.h`** | Panic通知器头文件 |
| **`arch/x86/kernel/dumpstack.c`** | x86架构die/oops处理 |
| **`arch/x86/kernel/traps.c`** | x86异常处理 |
| **`include/asm-generic/bug.h`** | BUG/WARN宏定义 |
| **`kernel/kexec_core.c`** | Kexec核心实现 |
| **`include/linux/kmsg_dump.h`** | Kmsg dump头文件 |

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了Panic机制的原理、数据结构、内核实现和应用场景。理解Panic机制对于进行内核开发和系统故障排查至关重要。*
