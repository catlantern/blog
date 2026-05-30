# Linux 5.15 内核延时机制详解

## 目录
1. **`引言：为什么需要内核延时`**
2. **`内核延时的分类`**
3. **`忙延时机制`**
4. **`休眠延时机制`**
5. **`高精度定时器hrtimer`**
6. **`延时机制对比与选择`**
7. **`loops_per_jiffy校准机制`**
8. **`完整使用示例`**
9. **`常见问题与注意事项`**

---

## 一、引言：为什么需要内核延时

### 1.1 一个真实的场景

在Linux驱动开发中，延时是连接硬件与内核的关键桥梁：

```
┌─────────────────────────────────────────────────────────────┐
│                    为什么需要延时？                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  场景1：硬件初始化等待                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  写寄存器 → 等待硬件稳定 → 读取状态                  │   │
│  │                                                      │   │
│  │  iowrite32(0x1, REG_RESET);   // 发送复位命令        │   │
│  │  udelay(100);                  // 等待100微秒        │   │
│  │  status = ioread32(REG_STATUS); // 读取状态          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  场景2：通信协议时序                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  I2C/SPI通信需要精确的时序控制                        │   │
│  │                                                      │   │
│  │  发送起始位 → 等待4.7us → 发送数据 → 等待...         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  场景3：设备状态轮询                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  while (!device_ready()) {                           │   │
│  │      msleep(10);  // 每10ms检查一次，不占用CPU       │   │
│  │  }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 延时的核心作用

| 作用 | 说明 | 典型场景 |
|------|------|----------|
| 硬件时序控制 | 等待硬件完成操作 | 复位、初始化、状态转换 |
| 通信协议实现 | 满足协议时序要求 | I2C、SPI、UART |
| 状态轮询间隔 | 避免频繁轮询 | 设备就绪等待 |
| 调试与测试 | 模拟延迟场景 | 性能测试、竞态调试 |

### 1.3 错误使用延时的后果

```
┌─────────────────────────────────────────────────────────────┐
│                    常见错误与后果                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  错误1：在中断上下文使用休眠延时                              │
│    msleep() 在中断处理函数中使用 → 内核崩溃                  │
│                                                             │
│  错误2：长时间忙等待                                         │
│    udelay(1000000) → CPU空转1秒，系统卡死                   │
│                                                             │
│  错误3：延时时间不精确                                       │
│    协议时序错误 → 数据传输失败                               │
│                                                             │
│  错误4：忽略抢占影响                                         │
│    忙等待被中断 → 延时时间不确定                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、内核延时的分类

### 2.1 两大类别

Linux内核延时主要分为两类：

```
┌─────────────────────────────────────────────────────────────┐
│                    内核延时分类                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              忙延时（Busy Delay）                     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  特点：CPU空转等待，不释放CPU                         │   │
│  │  函数：ndelay(), udelay(), mdelay()                  │   │
│  │  精度：高（纳秒/微秒级）                              │   │
│  │  场景：短延时、中断上下文                             │   │
│  │  代价：占用CPU资源                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              休眠延时（Sleep Delay）                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  特点：进程休眠，释放CPU                              │   │
│  │  函数：msleep(), usleep_range(), ssleep()            │   │
│  │  精度：较低（受调度影响）                             │   │
│  │  场景：长延时、进程上下文                             │   │
│  │  代价：上下文切换开销                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 选择原则

```
延时时间 < 10微秒     →  udelay() / ndelay()
延时时间 < 1毫秒      →  udelay()
延时时间 < 20毫秒     →  usleep_range()
延时时间 >= 20毫秒    →  msleep()

中断上下文            →  只能用忙延时
进程上下文            →  优先用休眠延时
原子上下文            →  只能用忙延时
```

---

## 三、忙延时机制

### 3.1 忙延时原理

忙延时通过CPU执行空循环来消耗时间：

```
┌─────────────────────────────────────────────────────────────┐
│                    忙延时工作原理                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  udelay(100) 的执行过程：                                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  1. 计算 loops = loops_per_jiffy * usecs * ...      │   │
│  │                                                     │   │
│  │  2. 执行空循环：                                     │   │
│  │     for (i = 0; i < loops; i++)                     │   │
│  │         ; // 空操作                                  │   │
│  │                                                     │   │
│  │  3. 循环结束，延时完成                               │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  CPU状态：一直忙碌，执行空指令                               │
│  其他任务：无法获得CPU                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 delay.h头文件

定义在 **`include/linux/delay.h`**：

```c
#ifndef _LINUX_DELAY_H
#define _LINUX_DELAY_H

#include <linux/kernel.h>
#include <linux/sched.h>

extern unsigned long loops_per_jiffy;

#include <asm/delay.h>

/*
 * mdelay宏定义：毫秒级忙延时
 * 对于短延时（<= MAX_UDELAY_MS），直接调用udelay
 * 对于长延时，循环调用udelay(1000)
 */
#ifndef MAX_UDELAY_MS
#define MAX_UDELAY_MS	5
#endif

#ifndef mdelay
#define mdelay(n) (\
	(__builtin_constant_p(n) && (n)<=MAX_UDELAY_MS) ? udelay((n)*1000) : \
	({unsigned long __ms=(n); while (__ms--) udelay(1000);}))
#endif

/*
 * ndelay：纳秒级忙延时
 * 实际上转换为微秒延时
 */
#ifndef ndelay
static inline void ndelay(unsigned long x)
{
	udelay(DIV_ROUND_UP(x, 1000));
}
#endif

/* 休眠延时函数声明 */
void msleep(unsigned int msecs);
unsigned long msleep_interruptible(unsigned int msecs);
void usleep_range_state(unsigned long min, unsigned long max,
			unsigned int state);

/* usleep_range：微秒级休眠延时 */
static inline void usleep_range(unsigned long min, unsigned long max)
{
	usleep_range_state(min, max, TASK_UNINTERRUPTIBLE);
}

/* ssleep：秒级休眠 */
static inline void ssleep(unsigned int seconds)
{
	msleep(seconds * 1000);
}

/*
 * fsleep：智能延时函数
 * 根据延时时间自动选择最优方案
 */
static inline void fsleep(unsigned long usecs)
{
	if (usecs <= 10)
		udelay(usecs);           // 短延时：忙等待
	else if (usecs <= 20000)
		usleep_range(usecs, 2 * usecs);  // 中等延时：休眠
	else
		msleep(DIV_ROUND_UP(usecs, 1000)); // 长延时：毫秒休眠
}

#endif
```

### 3.3 x86架构的延时实现

定义在 **`arch/x86/lib/delay.c`**：

```c
/*
 * 简单循环延时：最基本的延时方式
 */
static void delay_loop(u64 __loops)
{
	unsigned long loops = (unsigned long)__loops;

	asm volatile(
		"	test %0,%0	\n"
		"	jz 3f		\n"
		"	jmp 1f		\n"

		".align 16		\n"
		"1:	jmp 2f		\n"

		".align 16		\n"
		"2:	dec %0		\n"
		"	jnz 2b		\n"
		"3:	dec %0		\n"

		: "+a" (loops)
		:
	);
}

/*
 * TSC（时间戳计数器）延时：更精确
 */
static void delay_tsc(u64 cycles)
{
	u64 bclock, now;
	int cpu;

	preempt_disable();
	cpu = smp_processor_id();
	bclock = rdtsc_ordered();    // 读取TSC起始值
	
	for (;;) {
		now = rdtsc_ordered();   // 读取当前TSC
		if ((now - bclock) >= cycles)
			break;

		/* 允许RT任务运行 */
		preempt_enable();
		rep_nop();
		preempt_disable();

		/* 处理CPU迁移的情况 */
		if (unlikely(cpu != smp_processor_id())) {
			cycles -= (now - bclock);
			cpu = smp_processor_id();
			bclock = rdtsc_ordered();
		}
	}
	preempt_enable();
}

/*
 * __delay：底层延时函数
 */
void __delay(unsigned long loops)
{
	delay_fn(loops);   // 根据系统选择最优延时方式
}
EXPORT_SYMBOL(__delay);

/*
 * __const_udelay：常量微秒延时
 */
noinline void __const_udelay(unsigned long xloops)
{
	unsigned long lpj = this_cpu_read(cpu_info.loops_per_jiffy) ? : loops_per_jiffy;
	int d0;

	xloops *= 4;
	asm("mull %%edx"
		:"=d" (xloops), "=&a" (d0)
		:"1" (xloops), "0" (lpj * (HZ / 4)));

	__delay(++xloops);
}
EXPORT_SYMBOL(__const_udelay);

/*
 * __udelay：微秒延时
 */
void __udelay(unsigned long usecs)
{
	__const_udelay(usecs * 0x000010c7); /* 2**32 / 1000000 */
}
EXPORT_SYMBOL(__udelay);

/*
 * __ndelay：纳秒延时
 */
void __ndelay(unsigned long nsecs)
{
	__const_udelay(nsecs * 0x00005); /* 2**32 / 1000000000 */
}
EXPORT_SYMBOL(__ndelay);
```

### 3.4 x86延时方式对比

| 延时方式 | 实现原理 | 精度 | 特点 |
|----------|----------|------|------|
| delay_loop | 空循环 | 一般 | 最简单，兼容性好 |
| delay_tsc | TSC计数器 | 高 | 精确，支持抢占 |
| delay_halt | TPAUSE/MWAITX | 高 | 节能，等待时CPU可休眠 |

### 3.5 忙延时使用示例

```c
#include <linux/delay.h>

/* 示例1：I2C时序控制 */
void i2c_start_condition(void)
{
    gpio_set_value(SDA, 1);
    gpio_set_value(SCL, 1);
    udelay(4);    // 等待4微秒
    gpio_set_value(SDA, 0);
    udelay(4);
    gpio_set_value(SCL, 0);
}

/* 示例2：硬件复位 */
void device_reset(void)
{
    iowrite32(0x1, REG_RESET);
    mdelay(10);   // 等待10毫秒
    iowrite32(0x0, REG_RESET);
    mdelay(50);   // 等待50毫秒让设备稳定
}

/* 示例3：短延时 */
void precise_timing(void)
{
    ndelay(500);  // 500纳秒延时
    udelay(2);    // 2微秒延时
}
```

---

## 四、休眠延时机制

### 4.1 休眠延时原理

休眠延时让当前进程进入睡眠状态，释放CPU给其他进程：

```
┌─────────────────────────────────────────────────────────────┐
│                    休眠延时工作原理                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  msleep(100) 的执行过程：                                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  1. 计算需要休眠的jiffies数                          │   │
│  │     timeout = msecs_to_jiffies(100) + 1             │   │
│  │                                                     │   │
│  │  2. 设置进程状态为TASK_UNINTERRUPTIBLE              │   │
│  │                                                     │   │
│  │  3. 将进程加入等待队列                               │   │
│  │                                                     │   │
│  │  4. 调用schedule()让出CPU                           │   │
│  │     ──────────────────────────────────              │   │
│  │     CPU执行其他进程...                              │   │
│  │     ──────────────────────────────────              │   │
│  │                                                     │   │
│  │  5. 定时器到期，唤醒进程                             │   │
│  │                                                     │   │
│  │  6. 进程继续执行                                     │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  CPU状态：空闲，可执行其他任务                               │
│  其他任务：可以获得CPU                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 msleep函数实现

定义在 **`kernel/time/timer.c`**：

```c
/**
 * msleep - sleep safely even with waitqueue interruptions
 * @msecs: Time in milliseconds to sleep for
 */
void msleep(unsigned int msecs)
{
	unsigned long timeout = msecs_to_jiffies(msecs) + 1;

	while (timeout)
		timeout = schedule_timeout_uninterruptible(timeout);
}
EXPORT_SYMBOL(msleep);

/**
 * msleep_interruptible - sleep waiting for signals
 * @msecs: Time in milliseconds to sleep for
 *
 * 返回：剩余的毫秒数
 */
unsigned long msleep_interruptible(unsigned int msecs)
{
	unsigned long timeout = msecs_to_jiffies(msecs) + 1;

	while (timeout && !signal_pending(current))
		timeout = schedule_timeout_interruptible(timeout);
	return jiffies_to_msecs(timeout);
}
EXPORT_SYMBOL(msleep_interruptible);
```

### 4.3 usleep_range函数实现

```c
/**
 * usleep_range_state - Sleep for an approximate time in a given state
 * @min:	Minimum time in usecs to sleep
 * @max:	Maximum time in usecs to sleep
 * @state:	State of the current task that will be while sleeping
 *
 * 使用范围延时的好处：
 * 1. 允许hrtimer利用已调度中断，减少新中断
 * 2. 提高电源效率
 */
void __sched usleep_range_state(unsigned long min, unsigned long max,
				unsigned int state)
{
	ktime_t exp = ktime_add_us(ktime_get(), min);
	u64 delta = (u64)(max - min) * NSEC_PER_USEC;

	for (;;) {
		__set_current_state(state);
		/* 确保至少休眠min微秒 */
		if (!schedule_hrtimeout_range(&exp, delta, HRTIMER_MODE_ABS))
			break;
	}
}
EXPORT_SYMBOL(usleep_range_state);
```

### 4.4 休眠延时函数对比

| 函数 | 单位 | 可中断 | 精度 | 适用场景 |
|------|------|--------|------|----------|
| msleep | 毫秒 | 否 | 低 | 一般延时 |
| msleep_interruptible | 毫秒 | 是 | 低 | 需要响应信号 |
| usleep_range | 微秒 | 否 | 中 | 精确延时 |
| ssleep | 秒 | 否 | 低 | 长时间休眠 |

### 4.5 休眠延时使用示例

```c
#include <linux/delay.h>

/* 示例1：设备状态轮询 */
int wait_device_ready(void)
{
    int timeout = 100;  // 最多等待1秒
    
    while (!device_ready() && timeout > 0) {
        msleep(10);     // 每10ms检查一次
        timeout--;
    }
    
    return timeout > 0 ? 0 : -ETIMEDOUT;
}

/* 示例2：可中断等待 */
long wait_for_event(void)
{
    long remaining;
    
    remaining = msleep_interruptible(5000);  // 等待5秒
    if (remaining) {
        printk("被信号中断，剩余%ld毫秒\n", remaining);
        return -EINTR;
    }
    
    return 0;
}

/* 示例3：精确延时范围 */
void precise_delay(void)
{
    /* 休眠1-2毫秒，允许调度器优化 */
    usleep_range(1000, 2000);
}

/* 示例4：智能延时 */
void smart_delay(unsigned long usecs)
{
    fsleep(usecs);  // 自动选择最优方案
}
```

---

## 五、高精度定时器hrtimer

### 5.1 hrtimer概述

hrtimer（High Resolution Timer）是Linux内核的高精度定时器框架：

```
┌─────────────────────────────────────────────────────────────┐
│                    hrtimer特点                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  精度：纳秒级                                                │
│    └─ 依托硬件时钟源（TSC、HPET）                            │
│                                                             │
│  管理：红黑树                                                │
│    └─ 插入、删除、查找复杂度O(log N)                         │
│                                                             │
│  模式：单次 / 周期                                           │
│    └─ 支持一次性触发和周期触发                               │
│                                                             │
│  上下文：硬中断 / 软中断                                     │
│    └─ 可选择回调执行上下文                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 hrtimer数据结构

定义在 **`include/linux/hrtimer.h`**：

```c
/**
 * struct hrtimer - 高精度定时器结构体
 * @node:		定时器队列节点（红黑树节点）
 * @_softexpires:	最早到期时间
 * @function:		到期回调函数
 * @base:		定时器基础（per cpu和per clock）
 * @state:		状态信息
 * @is_rel:		是否相对时间
 * @is_soft:		是否软中断模式
 * @is_hard:		是否硬中断模式
 */
struct hrtimer {
	struct timerqueue_node		node;
	ktime_t				_softexpires;
	enum hrtimer_restart		(*function)(struct hrtimer *);
	struct hrtimer_clock_base	*base;
	u8				state;
	u8				is_rel;
	u8				is_soft;
	u8				is_hard;
};

/**
 * struct hrtimer_sleeper - 简单休眠结构
 * @timer:	嵌入的定时器结构
 * @task:	要唤醒的任务
 */
struct hrtimer_sleeper {
	struct hrtimer timer;
	struct task_struct *task;
};

/**
 * struct hrtimer_clock_base - 特定时钟的定时器基础
 * @cpu_base:		per cpu时钟基础
 * @index:		时钟类型索引
 * @clockid:		时钟ID
 * @active:		活动定时器的红黑树根
 * @get_time:		获取当前时间的函数
 */
struct hrtimer_clock_base {
	struct hrtimer_cpu_base	*cpu_base;
	unsigned int		index;
	clockid_t		clockid;
	seqcount_raw_spinlock_t	seq;
	struct hrtimer		*running;
	struct timerqueue_head	active;    // 红黑树根
	ktime_t			(*get_time)(void);
	ktime_t			offset;
};

/**
 * struct hrtimer_cpu_base - per cpu时钟基础
 * @lock:		保护基础和定时器的锁
 * @cpu:		CPU编号
 * @active_bases:	标记有活动定时器的基础
 * @expires_next:	下一个事件的绝对时间
 * @next_timer:		指向最早到期的定时器
 * @clock_base:		此CPU的时钟基础数组
 */
struct hrtimer_cpu_base {
	raw_spinlock_t			lock;
	unsigned int			cpu;
	unsigned int			active_bases;
	ktime_t				expires_next;
	struct hrtimer			*next_timer;
	struct hrtimer_clock_base	clock_base[HRTIMER_MAX_CLOCK_BASES];
};
```

### 5.3 hrtimer初始化

定义在 **`kernel/time/hrtimer.c`**：

```c
static void __hrtimer_init(struct hrtimer *timer, clockid_t clock_id,
			   enum hrtimer_mode mode)
{
	bool softtimer = !!(mode & HRTIMER_MODE_SOFT);
	struct hrtimer_cpu_base *cpu_base;
	int base;

	/* 在PREEMPT_RT内核上，未标记硬中断的定时器移到软中断 */
	if (IS_ENABLED(CONFIG_PREEMPT_RT) && !(mode & HRTIMER_MODE_HARD))
		softtimer = true;

	memset(timer, 0, sizeof(struct hrtimer));

	cpu_base = raw_cpu_ptr(&hrtimer_bases);

	/* POSIX兼容：相对CLOCK_REALTIME转换为CLOCK_MONOTONIC */
	if (clock_id == CLOCK_REALTIME && mode & HRTIMER_MODE_REL)
		clock_id = CLOCK_MONOTONIC;

	base = softtimer ? HRTIMER_MAX_CLOCK_BASES / 2 : 0;
	base += hrtimer_clockid_to_base(clock_id);
	timer->is_soft = softtimer;
	timer->is_hard = !!(mode & HRTIMER_MODE_HARD);
	timer->base = &cpu_base->clock_base[base];
	timerqueue_init(&timer->node);
}

/**
 * hrtimer_init - 初始化定时器
 * @timer:	要初始化的定时器
 * @clock_id:	时钟类型
 * @mode:	模式（绝对/相对，软/硬中断）
 */
void hrtimer_init(struct hrtimer *timer, clockid_t clock_id,
		  enum hrtimer_mode mode)
{
	debug_init(timer, clock_id, mode);
	__hrtimer_init(timer, clock_id, mode);
}
EXPORT_SYMBOL_GPL(hrtimer_init);
```

### 5.4 hrtimer启动

定义在 **`kernel/time/hrtimer.c`**：

```c
/**
 * hrtimer_start_range_ns - 启动定时器
 * @timer:	要添加的定时器
 * @tim:	到期时间
 * @delta_ns:	"松弛"范围
 * @mode:	定时器模式
 */
void hrtimer_start_range_ns(struct hrtimer *timer, ktime_t tim,
			    u64 delta_ns, const enum hrtimer_mode mode)
{
	struct hrtimer_clock_base *base;
	unsigned long flags;

	if (WARN_ON_ONCE(!timer->function))
		return;

	base = lock_hrtimer_base(timer, &flags);

	if (__hrtimer_start_range_ns(timer, tim, delta_ns, mode, base))
		hrtimer_reprogram(timer, true);   // 重新编程硬件定时器

	unlock_hrtimer_base(timer, &flags);
}
EXPORT_SYMBOL_GPL(hrtimer_start_range_ns);

/* 常用宏定义 */
#define hrtimer_start(timer, tim, mode) \
	hrtimer_start_range_ns(timer, tim, 0, mode)
```

### 5.5 时钟类型

```c
enum hrtimer_base_type {
	HRTIMER_BASE_MONOTONIC,       // 单调时钟（不受系统时间调整影响）
	HRTIMER_BASE_REALTIME,        // 实时时钟（受系统时间调整影响）
	HRTIMER_BASE_BOOTTIME,        // 启动时钟
	HRTIMER_BASE_TAI,             // TAI时钟
	HRTIMER_BASE_MONOTONIC_SOFT,  // 软中断模式
	HRTIMER_BASE_REALTIME_SOFT,
	HRTIMER_BASE_BOOTTIME_SOFT,
	HRTIMER_BASE_TAI_SOFT,
	HRTIMER_MAX_CLOCK_BASES,
};
```

### 5.6 定时器模式

```c
/* 定时器模式标志 */
#define HRTIMER_MODE_ABS		0x00  /* 绝对时间 */
#define HRTIMER_MODE_REL		0x01  /* 相对时间 */
#define HRTIMER_MODE_PINNED		0x02  /* 固定在当前CPU */
#define HRTIMER_MODE_SOFT		0x04  /* 软中断模式 */
#define HRTIMER_MODE_HARD		0x08  /* 硬中断模式 */

/* 常用组合 */
#define HRTIMER_MODE_ABS_SOFT		(HRTIMER_MODE_ABS | HRTIMER_MODE_SOFT)
#define HRTIMER_MODE_REL_SOFT		(HRTIMER_MODE_REL | HRTIMER_MODE_SOFT)
#define HRTIMER_MODE_ABS_HARD		(HRTIMER_MODE_ABS | HRTIMER_MODE_HARD)
#define HRTIMER_MODE_REL_HARD		(HRTIMER_MODE_REL | HRTIMER_MODE_HARD)
```

### 5.7 回调函数返回值

```c
enum hrtimer_restart {
	HRTIMER_NORESTART,    /* 不重启定时器 */
	HRTIMER_RESTART,      /* 重启定时器（周期性） */
};
```

### 5.8 hrtimer使用示例

```c
#include <linux/hrtimer.h>
#include <linux/ktime.h>

/* 定义定时器管理结构 */
struct my_timer_data {
    struct hrtimer timer;
    ktime_t period;
    int count;
};

static struct my_timer_data timer_data;

/* 定时器回调函数 */
static enum hrtimer_restart my_timer_callback(struct hrtimer *timer)
{
    struct my_timer_data *data = container_of(timer, struct my_timer_data, timer);
    
    data->count++;
    pr_info("定时器触发: count=%d\n", data->count);
    
    /* 设置下次触发时间（周期性定时器） */
    hrtimer_forward_now(timer, data->period);
    
    return HRTIMER_RESTART;  /* 重启定时器 */
}

/* 初始化定时器 */
static int my_timer_init(void)
{
    /* 设置周期为100毫秒 */
    timer_data.period = ktime_set(0, 100 * NSEC_PER_MSEC);
    timer_data.count = 0;
    
    /* 初始化定时器 */
    hrtimer_init(&timer_data.timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
    timer_data.timer.function = my_timer_callback;
    
    /* 启动定时器 */
    hrtimer_start(&timer_data.timer, timer_data.period, HRTIMER_MODE_REL);
    
    pr_info("定时器已启动\n");
    return 0;
}

/* 停止定时器 */
static void my_timer_exit(void)
{
    hrtimer_cancel(&timer_data.timer);
    pr_info("定时器已停止, 总触发次数=%d\n", timer_data.count);
}
```

### 5.9 hrtimer红黑树管理

```
┌─────────────────────────────────────────────────────────────┐
│                    hrtimer红黑树组织                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  定时器按到期时间组织在红黑树中：                             │
│                                                             │
│                    ┌─────────┐                              │
│                    │ Timer A │ (最早到期)                    │
│                    │ t=100ns │                              │
│                    └────┬────┘                              │
│                         │                                   │
│            ┌────────────┼────────────┐                      │
│            │            │            │                      │
│       ┌────┴────┐       │       ┌────┴────┐                 │
│       │ Timer B │       │       │ Timer C │                 │
│       │ t=200ns │       │       │ t=300ns │                 │
│       └─────────┘       │       └─────────┘                 │
│                         │                                   │
│                    ┌────┴────┐                              │
│                    │ Timer D │                              │
│                    │ t=250ns │                              │
│                    └─────────┘                              │
│                                                             │
│  查找最早到期定时器：O(1)（缓存在next_timer）                │
│  插入定时器：O(log N)                                        │
│  删除定时器：O(log N)                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、延时机制对比与选择

### 6.1 完整对比表

| 特性 | ndelay | udelay | mdelay | msleep | usleep_range | hrtimer |
|------|--------|--------|--------|--------|--------------|---------|
| 单位 | 纳秒 | 微秒 | 毫秒 | 毫秒 | 微秒 | 纳秒 |
| 类型 | 忙等待 | 忙等待 | 忙等待 | 休眠 | 休眠 | 定时器 |
| CPU占用 | 100% | 100% | 100% | 0% | 0% | 0% |
| 精度 | 高 | 高 | 高 | 低 | 中 | 最高 |
| 中断上下文 | 可用 | 可用 | 可用 | 不可 | 不可 | 可用 |
| 进程上下文 | 可用 | 可用 | 可用 | 可用 | 可用 | 可用 |
| 推荐时长 | <1μs | <1ms | <5ms | >20ms | 10μs-20ms | 任意 |

### 6.2 选择流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    延时函数选择流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  开始                                                        │
│    │                                                         │
│    ▼                                                         │
│  是否在中断/原子上下文？                                     │
│    │                                                         │
│    ├─ 是 ─► 使用忙延时                                       │
│    │         │                                               │
│    │         ├─ < 1微秒 ─► ndelay()                          │
│    │         ├─ < 1毫秒 ─► udelay()                          │
│    │         └─ < 5毫秒 ─► mdelay()                          │
│    │                                                         │
│    └─ 否 ─► 可以使用休眠延时                                 │
│              │                                               │
│              ├─ < 10微秒 ─► udelay()                         │
│              ├─ < 20毫秒 ─► usleep_range()                   │
│              ├─ >= 20毫秒 ─► msleep()                        │
│              │                                               │
│              └─ 需要周期性/高精度 ─► hrtimer                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 fsleep智能延时

```c
/* fsleep：自动选择最优方案 */
static inline void fsleep(unsigned long usecs)
{
	if (usecs <= 10)
		udelay(usecs);              // 极短：忙等待
	else if (usecs <= 20000)
		usleep_range(usecs, 2 * usecs);  // 中等：休眠
	else
		msleep(DIV_ROUND_UP(usecs, 1000)); // 长：毫秒休眠
}
```

---

## 七、loops_per_jiffy校准机制

### 7.1 什么是loops_per_jiffy

`loops_per_jiffy` 表示在一个时钟节拍（jiffy）内CPU能执行多少次空循环：

```
┌─────────────────────────────────────────────────────────────┐
│                    loops_per_jiffy含义                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  loops_per_jiffy = CPU在一个jiffy内执行的空循环次数          │
│                                                             │
│  例如：                                                      │
│    HZ = 1000 (1 jiffy = 1ms)                                │
│    loops_per_jiffy = 5000000                                │
│                                                             │
│  则：                                                        │
│    CPU每毫秒可执行500万次空循环                              │
│    BogoMIPS = loops_per_jiffy * HZ / 500000                 │
│            = 5000000 * 1000 / 500000                        │
│            = 10000.00 BogoMIPS                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 校准函数

定义在 **`init/calibrate.c`**：

```c
void calibrate_delay(void)
{
	unsigned long lpj;
	static bool printed;
	int this_cpu = smp_processor_id();

	/* 优先级1：已校准过 */
	if (per_cpu(cpu_loops_per_jiffy, this_cpu)) {
		lpj = per_cpu(cpu_loops_per_jiffy, this_cpu);
		if (!printed)
			pr_info("Calibrating delay loop (skipped) "
				"already calibrated this CPU");
	} 
	/* 优先级2：预设值（通过lpj=内核参数） */
	else if (preset_lpj) {
		lpj = preset_lpj;
		if (!printed)
			pr_info("Calibrating delay loop (skipped) "
				"preset value.. ");
	} 
	/* 优先级3：基于定时器频率计算 */
	else if ((!printed) && lpj_fine) {
		lpj = lpj_fine;
		pr_info("Calibrating delay loop (skipped), "
			"value calculated using timer frequency.. ");
	} 
	/* 优先级4：架构已知值 */
	else if ((lpj = calibrate_delay_is_known())) {
		;
	} 
	/* 优先级5：直接测量（使用TSC等） */
	else if ((lpj = calibrate_delay_direct()) != 0) {
		if (!printed)
			pr_info("Calibrating delay using timer "
				"specific routine.. ");
	} 
	/* 优先级6：收敛算法测量 */
	else {
		if (!printed)
			pr_info("Calibrating delay loop... ");
		lpj = calibrate_delay_converge();
	}
	
	per_cpu(cpu_loops_per_jiffy, this_cpu) = lpj;
	if (!printed)
		pr_cont("%lu.%02lu BogoMIPS (lpj=%lu)\n",
			lpj/(500000/HZ),
			(lpj/(5000/HZ)) % 100, lpj);

	loops_per_jiffy = lpj;
	printed = true;

	calibration_delay_done();
}
```

### 7.3 收敛校准算法

```c
static unsigned long calibrate_delay_converge(void)
{
	unsigned long lpj, lpj_base, ticks, loopadd, loopadd_base, chop_limit;
	int trials = 0, band = 0, trial_in_band = 0;

	lpj = (1<<12);  // 初始猜测值：4096

	/* 等待时钟节拍开始 */
	ticks = jiffies;
	while (ticks == jiffies)
		; /* nothing */
	
	/* 第一阶段：快速找到大致范围 */
	ticks = jiffies;
	do {
		if (++trial_in_band == (1<<band)) {
			++band;
			trial_in_band = 0;
		}
		__delay(lpj * band);
		trials += band;
	} while (ticks == jiffies);
	
	/* 第二阶段：二分逼近精确值 */
	trials -= band;
	loopadd_base = lpj * band;
	lpj_base = lpj * trials;

recalibrate:
	lpj = lpj_base;
	loopadd = loopadd_base;

	/* 二分查找精确值 */
	chop_limit = lpj >> LPS_PREC;
	while (loopadd > chop_limit) {
		lpj += loopadd;
		ticks = jiffies;
		while (ticks == jiffies)
			; /* nothing */
		ticks = jiffies;
		__delay(lpj);
		if (jiffies != ticks)	/* 超过1个节拍 */
			lpj -= loopadd;
		loopadd >>= 1;
	}
	
	return lpj;
}
```

### 7.4 校准流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    校准流程                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  calibrate_delay()                                          │
│         │                                                    │
│         ├─► 已校准？ ─是─► 使用缓存值                        │
│         │                                                    │
│         ├─► 有预设值？ ─是─► 使用preset_lpj                  │
│         │                                                    │
│         ├─► 有定时器频率？ ─是─► 计算lpj_fine                │
│         │                                                    │
│         ├─► 架构已知？ ─是─► 使用架构值                      │
│         │                                                    │
│         ├─► 支持直接测量？ ─是─► calibrate_delay_direct()    │
│         │                                                    │
│         └─► 使用收敛算法：calibrate_delay_converge()         │
│                   │                                          │
│                   ├─► 快速扫描找范围                         │
│                   │                                          │
│                   └─► 二分逼近精确值                         │
│                                                             │
│  输出：X.XX BogoMIPS (lpj=YYYYYY)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、完整使用示例

### 8.1 示例1：驱动初始化延时

```c
#include <linux/module.h>
#include <linux/delay.h>
#include <linux/io.h>

#define REG_CTRL    0x00
#define REG_STATUS  0x04
#define REG_DATA    0x08

static void __iomem *mmio_base;

/* 设备初始化 */
static int device_init(void)
{
    u32 status;
    int timeout;
    
    /* 1. 发送复位命令 */
    iowrite32(0x1, mmio_base + REG_CTRL);
    
    /* 2. 等待复位完成（短延时，使用忙等待） */
    udelay(100);
    
    /* 3. 等待设备就绪（长延时，使用休眠） */
    timeout = 100;
    while (timeout > 0) {
        status = ioread32(mmio_base + REG_STATUS);
        if (status & 0x1)
            break;
        msleep(10);
        timeout--;
    }
    
    if (timeout == 0)
        return -ETIMEDOUT;
    
    pr_info("设备初始化完成\n");
    return 0;
}
```

### 8.2 示例2：I2C通信时序

```c
#include <linux/delay.h>
#include <linux/gpio.h>

#define SCL  1
#define SDA  0

/* I2C起始条件 */
static void i2c_start(void)
{
    gpio_set_value(SDA, 1);
    gpio_set_value(SCL, 1);
    udelay(4);    // tSU;STA > 4.7us
    
    gpio_set_value(SDA, 0);
    udelay(4);    // tHD;STA > 4.0us
    
    gpio_set_value(SCL, 0);
    udelay(4);
}

/* I2C停止条件 */
static void i2c_stop(void)
{
    gpio_set_value(SDA, 0);
    gpio_set_value(SCL, 1);
    udelay(4);    // tSU;STO > 4.0us
    
    gpio_set_value(SDA, 1);
    udelay(4);
}

/* 发送一个字节 */
static int i2c_send_byte(u8 data)
{
    int i;
    
    for (i = 7; i >= 0; i--) {
        gpio_set_value(SDA, (data >> i) & 1);
        udelay(2);
        
        gpio_set_value(SCL, 1);
        udelay(4);    // tHIGH > 4.0us
        
        gpio_set_value(SCL, 0);
        udelay(2);
    }
    
    /* 等待ACK */
    gpio_set_value(SDA, 1);
    gpio_set_value(SCL, 1);
    udelay(4);
    
    i = gpio_get_value(SDA);
    gpio_set_value(SCL, 0);
    udelay(4);
    
    return i;  // 0=ACK, 1=NACK
}
```

### 8.3 示例3：周期性任务

```c
#include <linux/module.h>
#include <linux/hrtimer.h>
#include <linux/ktime.h>

struct periodic_task {
    struct hrtimer timer;
    ktime_t interval;
    void (*callback)(void *data);
    void *data;
    int running;
};

static enum hrtimer_restart periodic_timer_callback(struct hrtimer *timer)
{
    struct periodic_task *task = container_of(timer, struct periodic_task, timer);
    
    /* 执行任务 */
    if (task->callback)
        task->callback(task->data);
    
    /* 设置下次触发时间 */
    hrtimer_forward_now(timer, task->interval);
    
    return task->running ? HRTIMER_RESTART : HRTIMER_NORESTART;
}

/* 启动周期性任务 */
void start_periodic_task(struct periodic_task *task, 
                         unsigned long interval_us,
                         void (*callback)(void *), void *data)
{
    task->interval = ktime_set(0, interval_us * NSEC_PER_USEC);
    task->callback = callback;
    task->data = data;
    task->running = 1;
    
    hrtimer_init(&task->timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
    task->timer.function = periodic_timer_callback;
    hrtimer_start(&task->timer, task->interval, HRTIMER_MODE_REL);
}

/* 停止周期性任务 */
void stop_periodic_task(struct periodic_task *task)
{
    task->running = 0;
    hrtimer_cancel(&task->timer);
}
```

### 8.4 示例4：超时等待

```c
#include <linux/delay.h>
#include <linux/jiffies.h>
#include <linux/sched.h>

/* 方式1：忙等待超时（短超时） */
int wait_timeout_busy(u32 __iomem *reg, u32 mask, unsigned long timeout_us)
{
    unsigned long start = ktime_get_ns();
    
    while ((ioread32(reg) & mask) == 0) {
        if ((ktime_get_ns() - start) > timeout_us * 1000)
            return -ETIMEDOUT;
        udelay(1);    // 短延时
    }
    
    return 0;
}

/* 方式2：休眠等待超时（长超时） */
int wait_timeout_sleep(u32 __iomem *reg, u32 mask, unsigned long timeout_ms)
{
    unsigned long deadline = jiffies + msecs_to_jiffies(timeout_ms);
    
    while (time_before(jiffies, deadline)) {
        if (ioread32(reg) & mask)
            return 0;
        msleep(10);
    }
    
    return -ETIMEDOUT;
}

/* 方式3：可中断等待 */
int wait_interruptible(u32 __iomem *reg, u32 mask, unsigned long timeout_ms)
{
    unsigned long deadline = jiffies + msecs_to_jiffies(timeout_ms);
    
    while (time_before(jiffies, deadline)) {
        if (signal_pending(current))
            return -ERESTARTSYS;
        
        if (ioread32(reg) & mask)
            return 0;
        
        if (msleep_interruptible(10))
            return -ERESTARTSYS;
    }
    
    return -ETIMEDOUT;
}
```

### 8.5 示例5：完整内核模块

```c
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/delay.h>
#include <linux/hrtimer.h>
#include <linux/ktime.h>

static struct hrtimer my_timer;
static ktime_t timer_period;
static int timer_count;

/* 定时器回调 */
static enum hrtimer_restart timer_callback(struct hrtimer *timer)
{
    timer_count++;
    pr_info("定时器触发: count=%d, time=%lld ns\n", 
            timer_count, ktime_get_ns());
    
    hrtimer_forward_now(timer, timer_period);
    return HRTIMER_RESTART;
}

static int __init delay_demo_init(void)
{
    pr_info("延时演示模块加载\n");
    
    /* 演示各种延时函数 */
    pr_info("测试udelay...\n");
    udelay(100);
    pr_info("udelay完成\n");
    
    pr_info("测试mdelay...\n");
    mdelay(1);
    pr_info("mdelay完成\n");
    
    pr_info("测试usleep_range...\n");
    usleep_range(1000, 2000);
    pr_info("usleep_range完成\n");
    
    pr_info("测试msleep...\n");
    msleep(10);
    pr_info("msleep完成\n");
    
    /* 启动周期性定时器 */
    timer_period = ktime_set(0, 100 * NSEC_PER_MSEC);  // 100ms
    timer_count = 0;
    
    hrtimer_init(&my_timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
    my_timer.function = timer_callback;
    hrtimer_start(&my_timer, timer_period, HRTIMER_MODE_REL);
    
    pr_info("周期性定时器已启动（100ms间隔）\n");
    
    return 0;
}

static void __exit delay_demo_exit(void)
{
    hrtimer_cancel(&my_timer);
    pr_info("延时演示模块卸载，定时器触发%d次\n", timer_count);
}

module_init(delay_demo_init);
module_exit(delay_demo_exit);

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("内核延时机制演示");
MODULE_AUTHOR("Kernel Developer");
```

---

## 九、常见问题与注意事项

### 9.1 上下文限制

```
┌─────────────────────────────────────────────────────────────┐
│                    上下文使用限制                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  上下文类型          可用延时函数                            │
│  ─────────────────────────────────────────────              │
│  进程上下文           所有延时函数                           │
│  中断上下文           ndelay, udelay, mdelay, hrtimer        │
│  软中断上下文         ndelay, udelay, mdelay, hrtimer        │
│  原子上下文           ndelay, udelay, mdelay                 │
│  自旋锁内             ndelay, udelay, mdelay                 │
│                                                             │
│  ⚠️ 错误示例：                                              │
│  void my_interrupt_handler(int irq, void *dev_id)           │
│  {                                                           │
│      msleep(10);  // 错误！中断上下文不能休眠                │
│  }                                                           │
│                                                             │
│  ✓ 正确示例：                                               │
│  void my_interrupt_handler(int irq, void *dev_id)           │
│  {                                                           │
│      udelay(10);  // 正确：使用忙延时                        │
│  }                                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 精度问题

| 问题 | 原因 | 解决方法 |
|------|------|----------|
| udelay时间不准 | loops_per_jiffy计算误差 | 使用TSC延时 |
| msleep时间过长 | 调度延迟 | 使用hrtimer |
| 忙延时被抢占 | 抢占式内核 | 考虑禁用抢占 |
| TSC频率变化 | CPU频率调节 | 使用恒定TSC |

### 9.3 性能影响

```
┌─────────────────────────────────────────────────────────────┐
│                    性能影响分析                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  忙延时影响：                                                │
│    - CPU利用率100%，影响其他任务                             │
│    - 可能触发软锁检测（soft lockup）                         │
│    - 影响系统响应性                                          │
│                                                             │
│  建议：                                                      │
│    - udelay不超过1毫秒                                       │
│    - mdelay不超过5毫秒                                       │
│    - 更长延时使用休眠                                        │
│                                                             │
│  休眠延时影响：                                              │
│    - 上下文切换开销                                          │
│    - 唤醒延迟（wakeup latency）                              │
│    - 可能错过精确时间                                        │
│                                                             │
│  建议：                                                      │
│    - 短延时不用休眠                                          │
│    - 使用usleep_range允许范围                                │
│    - 高精度需求用hrtimer                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.4 调试技巧

```c
/* 1. 使用ftrace跟踪延时函数 */
// 启用跟踪
echo 1 > /sys/kernel/debug/tracing/events/irq/enable
echo function > /sys/kernel/debug/tracing/current_tracer
echo udelay > /sys/kernel/debug/tracing/set_ftrace_filter

/* 2. 测量实际延时时间 */
static void measure_delay(void)
{
    u64 start, end;
    
    start = ktime_get_ns();
    udelay(100);
    end = ktime_get_ns();
    
    pr_info("udelay(100)实际延时: %lld ns\n", end - start);
}

/* 3. 检查loops_per_jiffy */
static void check_calibration(void)
{
    pr_info("loops_per_jiffy = %lu\n", loops_per_jiffy);
    pr_info("BogoMIPS = %lu.%02lu\n", 
            loops_per_jiffy/(500000/HZ),
            (loops_per_jiffy/(5000/HZ)) % 100);
}

/* 4. 使用tracepoint */
// 启用hrtimer tracepoint
echo 1 > /sys/kernel/debug/tracing/events/timer/hrtimer_start/enable
echo 1 > /sys/kernel/debug/tracing/events/timer/hrtimer_expire_entry/enable
```

### 9.5 常见错误

```c
/* 错误1：中断上下文休眠 */
irqreturn_t my_handler(int irq, void *dev)
{
    msleep(1);  // 错误！会导致内核崩溃
    return IRQ_HANDLED;
}

/* 错误2：过长的忙延时 */
void bad_delay(void)
{
    udelay(1000000);  // 错误！CPU空转1秒
}

/* 错误3：自旋锁内休眠 */
void bad_lock(void)
{
    spin_lock(&my_lock);
    msleep(10);  // 错误！可能导致死锁
    spin_unlock(&my_lock);
}

/* 错误4：忽略返回值 */
void ignore_result(void)
{
    /* msleep_interruptible可能提前返回 */
    msleep_interruptible(1000);  // 应该检查返回值
}

/* 正确做法 */
void correct_delay(void)
{
    unsigned long remaining;
    
    remaining = msleep_interruptible(1000);
    if (remaining) {
        pr_info("被信号中断，剩余%ld毫秒\n", remaining);
        return;
    }
}
```

---

## 十、总结

### 10.1 API速查表

| 函数 | 头文件 | 说明 | 推荐场景 |
|------|--------|------|----------|
| ndelay(n) | linux/delay.h | 纳秒忙延时 | < 1微秒 |
| udelay(n) | linux/delay.h | 微秒忙延时 | < 1毫秒 |
| mdelay(n) | linux/delay.h | 毫秒忙延时 | < 5毫秒 |
| msleep(n) | linux/delay.h | 毫秒休眠 | > 20毫秒 |
| usleep_range(min, max) | linux/delay.h | 微秒范围休眠 | 10μs-20ms |
| ssleep(n) | linux/delay.h | 秒休眠 | 秒级 |
| fsleep(n) | linux/delay.h | 智能延时 | 任意 |
| hrtimer_init | linux/hrtimer.h | 初始化定时器 | 周期/高精度 |
| hrtimer_start | linux/hrtimer.h | 启动定时器 | 周期/高精度 |
| hrtimer_cancel | linux/hrtimer.h | 取消定时器 | 清理 |

### 10.2 设计原则总结

1. **上下文优先**：中断上下文只能用忙延时
2. **时间优先**：短延时用忙等待，长延时用休眠
3. **精度优先**：高精度需求用hrtimer
4. **资源优先**：考虑CPU占用和系统影响
5. **可维护性**：使用fsleep自动选择最优方案

### 10.3 进一步学习

- **`include/linux/delay.h`** - 延时函数头文件
- **`arch/x86/lib/delay.c`** - x86延时实现
- **`kernel/time/timer.c`** - 定时器和休眠实现
- **`kernel/time/hrtimer.c`** - 高精度定时器实现
- **`init/calibrate.c`** - loops_per_jiffy校准

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了内核延时机制的原理、实现和使用方法。理解延时机制是Linux驱动开发的基础，正确选择延时方式对系统稳定性和性能至关重要。*
