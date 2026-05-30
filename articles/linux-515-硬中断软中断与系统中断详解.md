# Linux 5.15 硬中断、软中断与系统中断详解

## 目录
1. **`引言：中断的本质`**
2. **`三种中断类型对比`**
3. **`硬中断（Hardware Interrupt）`**
4. **`软中断（Softirq）`**
5. **`系统中断与异常`**
6. **`中断与调度的关系`**
7. **`中断上下文详解`**
8. **`中断处理完整流程`**
9. **`常见问题与最佳实践`**

---

## 一、引言：中断的本质

### 1.1 什么是中断

中断是CPU响应外部或内部事件的一种机制，它打破了程序的正常执行流程：

```
┌─────────────────────────────────────────────────────────────┐
│                    中断的基本概念                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  正常执行流程：                                              │
│  ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐                      │
│  │指令1│ → │指令2│ → │指令3│ → │指令4│ → ...                │
│  └─────┘   └─────┘   └─────┘   └─────┘                      │
│                                                             │
│  中断发生时：                                                │
│  ┌─────┐   ┌─────┐         ┌─────────────┐   ┌─────┐        │
│  │指令1│ → │指令2│ → 中断 → │中断处理程序 │ → │指令3│        │
│  └─────┘   └─────┘         └─────────────┘   └─────┘        │
│                             ↓                               │
│                        保存/恢复上下文                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 为什么需要中断

| 场景 | 无中断方案 | 有中断方案 |
|------|------------|------------|
| 网络数据到达 | 轮询检查网卡 | 网卡主动通知 |
| 键盘输入 | 循环扫描键盘 | 键盘触发中断 |
| 定时任务 | 忙等待计时 | 定时器中断 |
| 磁盘I/O完成 | 轮询状态 | 完成后中断 |

### 1.3 Linux中断体系结构

```
┌─────────────────────────────────────────────────────────────┐
│                    Linux中断层次结构                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    用户空间                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↑↓ 系统调用                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    内核空间                          │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │              进程上下文                       │    │   │
│  │  │  - 可以睡眠                                   │    │   │
│  │  │  - 可以调度                                   │    │   │
│  │  │  - 使用进程栈                                 │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │                        ↓                            │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │              软中断上下文                     │    │   │
│  │  │  - 不可睡眠                                   │    │   │
│  │  │  - 不可调度（可抢占）                         │    │   │
│  │  │  - 使用软中断栈                               │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │                        ↓                            │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │              硬中断上下文                     │    │   │
│  │  │  - 不可睡眠                                   │    │   │
│  │  │  - 不可调度                                   │    │   │
│  │  │  - 使用中断栈                                 │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、三种中断类型对比

### 2.1 概念对比表

| 特性 | 硬中断 | 软中断 | 系统中断/异常 |
|------|--------|--------|---------------|
| 触发源 | 硬件设备 | 软件触发 | 软件指令/硬件异常 |
| 响应速度 | 最快 | 较快 | 快 |
| 优先级 | 最高 | 中等 | 高 |
| 可睡眠 | 否 | 否 | 部分 |
| 可调度 | 否 | 可抢占 | 是 |
| 上下文 | 中断上下文 | 软中断上下文 | 进程上下文 |
| 处理函数 | ISR | softirq handler | trap handler |
| 典型例子 | 网卡中断 | NET_RX_SOFTIRQ | 缺页异常 |

### 2.2 处理时机对比

```
┌─────────────────────────────────────────────────────────────┐
│                    中断处理时机                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  时间线 →                                                   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │  进程A执行                                             │  │
│  │       │                                                │  │
│  │       │ ← 硬件中断（网卡收到数据包）                   │  │
│  │       │                                                │  │
│  │       ├────────────────────────────────┐              │  │
│  │       │     硬中断处理（ISR）           │              │  │
│  │       │     - 立即执行                  │              │  │
│  │       │     - 关中断                    │              │  │
│  │       │     - 快速处理                  │              │  │
│  │       │     - 触发软中断                │              │  │
│  │       ├────────────────────────────────┘              │  │
│  │       │                                                │  │
│  │       │ ← 硬中断返回，检查软中断pending                │  │
│  │       │                                                │  │
│  │       ├────────────────────────────────┐              │  │
│  │       │     软中断处理                  │              │  │
│  │       │     - 开中断                    │              │  │
│  │       │     - 批量处理                  │              │  │
│  │       │     - 可被硬中断打断            │              │  │
│  │       ├────────────────────────────────┘              │  │
│  │       │                                                │  │
│  │       │ ← 软中断处理完毕                               │  │
│  │       │                                                │  │
│  │  进程A继续执行（或调度到进程B）                         │  │
│  │                                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 代码执行位置对比

| 类型 | 执行位置 | 栈 | 抢占计数 |
|------|----------|-----|----------|
| 硬中断 | IRQ entry | 中断栈 | HARDIRQ_OFFSET |
| 软中断 | irq_exit | 软中断栈 | SOFTIRQ_OFFSET |
| 系统调用 | syscall entry | 进程栈 | 0 |

---

## 三、硬中断（Hardware Interrupt）

### 3.1 硬中断概述

硬中断由硬件设备触发，是CPU与外部设备通信的主要方式：

```
┌─────────────────────────────────────────────────────────────┐
│                    硬中断来源                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  外部中断（可屏蔽）：                                        │
│    - 网卡中断（数据包到达）                                  │
│    - 磁盘中断（I/O完成）                                     │
│    - 键盘/鼠标中断                                           │
│    - 定时器中断                                              │
│                                                             │
│  内部中断（不可屏蔽，NMI）：                                 │
│    - 硬件故障                                                │
│    - 看门狗超时                                              │
│    - 性能监控事件                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 硬中断处理流程

```
┌─────────────────────────────────────────────────────────────┐
│                    硬中断处理流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 硬件设备发出中断信号                                     │
│         │                                                    │
│         ▼                                                    │
│  2. 中断控制器（APIC）接收信号                               │
│         │                                                    │
│         ▼                                                    │
│  3. CPU响应中断，保存当前上下文                               │
│         │                                                    │
│         ▼                                                    │
│  4. 根据中断向量号查找IDT                                     │
│         │                                                    │
│         ▼                                                    │
│  5. 执行中断入口代码（entry_64.S）                            │
│         │                                                    │
│         ▼                                                    │
│  6. 调用irq_enter()进入中断上下文                             │
│         │                                                    │
│         ▼                                                    │
│  7. 执行handle_irq()处理具体中断                              │
│         │                                                    │
│         ▼                                                    │
│  8. 调用irq_exit()退出中断上下文                              │
│         │                                                    │
│         ├─ 检查是否有软中断pending                           │
│         │                                                    │
│         └─ 恢复上下文，返回被中断的代码                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 irq_enter和irq_exit

定义在 **`kernel/softirq.c`**：

```c
/**
 * irq_enter_rcu - Enter an interrupt context with RCU watching
 */
void irq_enter_rcu(void)
{
	__irq_enter_raw();

	if (tick_nohz_full_cpu(smp_processor_id()) ||
	    (is_idle_task(current) && (irq_count() == HARDIRQ_OFFSET)))
		tick_irq_enter();

	account_hardirq_enter(current);
}

/**
 * irq_enter - Enter an interrupt context including RCU update
 */
void irq_enter(void)
{
	rcu_irq_enter();
	irq_enter_rcu();
}
```

```c
static inline void __irq_exit_rcu(void)
{
#ifndef __ARCH_IRQ_EXIT_IRQS_DISABLED
	local_irq_disable();
#else
	lockdep_assert_irqs_disabled();
#endif
	account_hardirq_exit(current);
	preempt_count_sub(HARDIRQ_OFFSET);
	
	/* 检查是否有软中断pending，如果有则执行 */
	if (!in_interrupt() && local_softirq_pending())
		invoke_softirq();

	tick_irq_exit();
}

/**
 * irq_exit - Exit an interrupt context, update RCU and lockdep
 */
void irq_exit(void)
{
	__irq_exit_rcu();
	rcu_irq_exit();
	lockdep_hardirq_exit();
}
```

### 3.4 硬中断处理函数

定义在 **`kernel/irq/handle.c`**：

```c
/*
 * 处理每个CPU的中断事件
 * 遍历该中断号注册的所有处理函数
 */
irqreturn_t __handle_irq_event_percpu(struct irq_desc *desc, unsigned int *flags)
{
	irqreturn_t retval = IRQ_NONE;
	unsigned int irq = desc->irq_data.irq;
	struct irqaction *action;

	record_irq_time(desc);

	/* 遍历该中断的所有处理函数（支持共享中断） */
	for_each_action_of_desc(desc, action) {
		irqreturn_t res;

		trace_irq_handler_entry(irq, action);
		
		/* 调用驱动的中断处理函数 */
		res = action->handler(irq, action->dev_id);
		
		trace_irq_handler_exit(irq, action, res);

		if (WARN_ONCE(!irqs_disabled(),
			      "irq %u handler %pS enabled interrupts\n",
			      irq, action->handler))
			local_irq_disable();

		switch (res) {
		case IRQ_WAKE_THREAD:
			/* 唤醒中断线程 */
			__irq_wake_thread(desc, action);
			fallthrough;
		case IRQ_HANDLED:
			*flags |= action->flags;
			break;
		default:
			break;
		}

		retval |= res;
	}

	return retval;
}
```

### 3.5 中断描述符和irqaction

定义在 **`include/linux/interrupt.h`**：

```c
/**
 * struct irqaction - per interrupt action descriptor
 * @handler:    中断处理函数
 * @name:       设备名称
 * @dev_id:     设备标识
 * @next:       指向下一个irqaction（共享中断）
 * @irq:        中断号
 * @flags:      标志位（IRQF_*）
 * @thread_fn:  线程化中断处理函数
 * @thread:     中断线程指针
 */
struct irqaction {
	irq_handler_t		handler;      /* 硬中断处理函数 */
	void			*dev_id;      /* 设备私有数据 */
	void __percpu		*percpu_dev_id;
	struct irqaction	*next;        /* 共享中断链表 */
	irq_handler_t		thread_fn;    /* 线程处理函数 */
	struct task_struct	*thread;      /* 中断线程 */
	struct irqaction	*secondary;
	unsigned int		irq;          /* 中断号 */
	unsigned int		flags;        /* IRQF_* 标志 */
	unsigned long		thread_flags;
	unsigned long		thread_mask;
	const char		*name;        /* 名称 */
	struct proc_dir_entry	*dir;
} ____cacheline_internodealigned_in_smp;
```

### 3.6 中断标志位

定义在 **`include/linux/interrupt.h`**：

```c
/*
 * IRQF_SHARED   - 允许多个设备共享同一中断线
 * IRQF_TIMER    - 标记为定时器中断
 * IRQF_PERCPU   - 每CPU中断
 * IRQF_ONESHOT  - 硬中断处理完后不复位中断线
 * IRQF_NO_THREAD - 不允许线程化
 */
#define IRQF_SHARED		0x00000080
#define IRQF_PROBE_SHARED	0x00000100
#define __IRQF_TIMER		0x00000200
#define IRQF_PERCPU		0x00000400
#define IRQF_NOBALANCING	0x00000800
#define IRQF_IRQPOLL		0x00001000
#define IRQF_ONESHOT		0x00002000
#define IRQF_NO_SUSPEND		0x00004000
#define IRQF_FORCE_RESUME	0x00008000
#define IRQF_NO_THREAD		0x00010000
```

---

## 四、软中断（Softirq）

### 4.1 软中断概述

软中断是内核模拟的"软"中断机制，用于延迟处理硬中断中的耗时操作：

```
┌─────────────────────────────────────────────────────────────┐
│                    为什么需要软中断                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  硬中断的限制：                                              │
│    - 执行时关闭中断，影响系统响应                             │
│    - 不能睡眠，不能调用可能阻塞的函数                         │
│    - 处理时间必须尽可能短                                     │
│                                                             │
│  软中断的优势：                                              │
│    - 执行时开中断，可被硬中断打断                             │
│    - 可以执行更复杂的操作                                     │
│    - 批量处理，提高效率                                       │
│    - 优先级高于普通进程                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 软中断类型

定义在 **`include/linux/interrupt.h`**：

```c
/*
 * 软中断类型定义（按优先级从高到低）
 * 请避免添加新的软中断，tasklet通常足够使用
 */
enum
{
	HI_SOFTIRQ=0,       /* 高优先级tasklet */
	TIMER_SOFTIRQ,      /* 定时器软中断 */
	NET_TX_SOFTIRQ,     /* 网络发送 */
	NET_RX_SOFTIRQ,     /* 网络接收 */
	BLOCK_SOFTIRQ,      /* 块设备 */
	IRQ_POLL_SOFTIRQ,   /* 中断轮询 */
	TASKLET_SOFTIRQ,    /* 普通tasklet */
	SCHED_SOFTIRQ,      /* 调度软中断 */
	HRTIMER_SOFTIRQ,    /* 高精度定时器 */
	RCU_SOFTIRQ,        /* RCU回调（必须是最后一个） */

	NR_SOFTIRQS         /* 软中断总数 */
};
```

### 4.3 软中断数据结构

定义在 **`kernel/softirq.c`**：

```c
/* 软中断动作数组 */
static struct softirq_action softirq_vec[NR_SOFTIRQS] __cacheline_aligned_in_smp;

/* 软中断守护进程（每CPU一个） */
DEFINE_PER_CPU(struct task_struct *, ksoftirqd);

/* 软中断名称 */
const char * const softirq_to_name[NR_SOFTIRQS] = {
	"HI", "TIMER", "NET_TX", "NET_RX", "BLOCK", "IRQ_POLL",
	"TASKLET", "SCHED", "HRTIMER", "RCU"
};
```

```c
/* 软中断动作结构 */
struct softirq_action
{
	void	(*action)(struct softirq_action *);
};
```

### 4.4 软中断处理函数

定义在 **`kernel/softirq.c`**：

```c
static void handle_softirqs(bool ksirqd)
{
	unsigned long end = jiffies + MAX_SOFTIRQ_TIME;
	unsigned long old_flags = current->flags;
	int max_restart = MAX_SOFTIRQ_RESTART;
	struct softirq_action *h;
	bool in_hardirq;
	__u32 pending;
	int softirq_bit;

	current->flags &= ~PF_MEMALLOC;

	pending = local_softirq_pending();

	softirq_handle_begin();
	in_hardirq = lockdep_softirq_start();
	account_softirq_enter(current);

restart:
	/* 清除pending位 */
	set_softirq_pending(0);

	/* 开中断，允许硬中断打断 */
	local_irq_enable();

	h = softirq_vec;

	/* 遍历处理所有pending的软中断 */
	while ((softirq_bit = ffs(pending))) {
		unsigned int vec_nr;
		int prev_count;

		h += softirq_bit - 1;

		vec_nr = h - softirq_vec;
		prev_count = preempt_count();

		kstat_incr_softirqs_this_cpu(vec_nr);

		trace_softirq_entry(vec_nr);
		
		/* 调用软中断处理函数 */
		h->action(h);
		
		trace_softirq_exit(vec_nr);
		
		if (unlikely(prev_count != preempt_count())) {
			pr_err("huh, entered softirq %u %s %p with "
			       "preempt_count %08x, exited with %08x?\n",
			       vec_nr, softirq_to_name[vec_nr], h->action,
			       prev_count, preempt_count());
			preempt_count_set(prev_count);
		}
		h++;
		pending >>= softirq_bit;
	}

	local_irq_disable();

	pending = local_softirq_pending();
	
	/* 如果还有pending，检查是否继续处理 */
	if (pending) {
		if (time_before(jiffies, end) && !need_resched() &&
		    --max_restart)
			goto restart;

		/* 超过限制，唤醒ksoftirqd处理 */
		wakeup_softirqd();
	}

	account_softirq_exit(current);
	lockdep_softirq_end(in_hardirq);
	softirq_handle_end();
	current_restore_flags(old_flags, PF_MEMALLOC);
}
```

### 4.5 触发软中断

```c
/*
 * raise_softirq_irqoff - 触发软中断（中断已关闭）
 * @nr: 软中断号
 */
inline void raise_softirq_irqoff(unsigned int nr)
{
	__raise_softirq_irqoff(nr);

	/*
	 * 如果不在中断上下文，唤醒ksoftirqd
	 * 否则在irq_exit时会自动处理
	 */
	if (!in_interrupt() && should_wake_ksoftirqd())
		wakeup_softirqd();
}

/*
 * raise_softirq - 触发软中断
 * @nr: 软中断号
 */
void raise_softirq(unsigned int nr)
{
	unsigned long flags;

	local_irq_save(flags);
	raise_softirq_irqoff(nr);
	local_irq_restore(flags);
}

/*
 * __raise_softirq_irqoff - 底层触发函数
 */
void __raise_softirq_irqoff(unsigned int nr)
{
	lockdep_assert_irqs_disabled();
	trace_softirq_raise(nr);
	or_softirq_pending(1UL << nr);  /* 设置pending位 */
}
```

### 4.6 注册软中断

```c
/*
 * open_softirq - 注册软中断处理函数
 * @nr: 软中断号
 * @action: 处理函数
 */
void open_softirq(int nr, void (*action)(struct softirq_action *))
{
	softirq_vec[nr].action = action;
}
```

### 4.7 ksoftirqd守护进程

```
┌─────────────────────────────────────────────────────────────┐
│                    ksoftirqd的作用                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  当软中断负载过重时，由ksoftirqd内核线程处理：               │
│                                                             │
│  触发条件：                                                  │
│    - 软中断重新触发次数超过MAX_SOFTIRQ_RESTART（10次）       │
│    - 处理时间超过MAX_SOFTIRQ_TIME                           │
│    - need_resched()为真（需要调度）                          │
│                                                             │
│  优势：                                                      │
│    - 在进程上下文执行，可以被调度                            │
│    - 不会饿死用户进程                                        │
│    - 可以利用调度器的负载均衡                                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  CPU 0          CPU 1          CPU 2          CPU 3 │   │
│  │  ksoftirqd/0     ksoftirqd/1    ksoftirqd/2   ...   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、系统中断与异常

### 5.1 系统中断概述

系统中断（或称异常、陷阱）是由软件指令或硬件异常触发的：

```
┌─────────────────────────────────────────────────────────────┐
│                    系统中断类型                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 故障（Fault）- 可恢复                                   │
│     - 缺页异常（Page Fault）                                 │
│     - 除零异常                                               │
│     - 段错误（用户态）                                       │
│                                                             │
│  2. 陷阱（Trap）- 有意触发                                  │
│     - 系统调用（int 0x80 / syscall）                        │
│     - 断点调试（int 3）                                      │
│     - 性能追踪点                                             │
│                                                             │
│  3. 终止（Abort）- 严重错误                                 │
│     - 双重故障（Double Fault）                               │
│     - 机器检查异常                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 系统调用流程

```
┌─────────────────────────────────────────────────────────────┐
│                    系统调用流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户空间                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  应用程序调用 read(fd, buf, count)                   │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  glibc封装，设置系统调用号和参数                      │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  执行syscall指令（或int 0x80）                        │   │
│  └─────────┼─────────────────────────────────────────────┘   │
│            │ 特权级切换                                      │
│            ▼                                                 │
│  内核空间                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  entry_SYSCALL_64_fastpath                           │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  保存用户态寄存器                                     │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  根据系统调用号查找sys_call_table                     │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  执行sys_read()                                      │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │  恢复用户态寄存器，返回用户空间                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 异常处理示例：缺页异常

```c
/* 缺页异常处理流程 */
void do_page_fault(struct pt_regs *regs, unsigned long error_code)
{
	struct vm_area_struct *vma;
	struct task_struct *tsk = current;
	struct mm_struct *mm = tsk->mm;
	unsigned long address;

	/* 获取触发异常的地址 */
	address = read_cr2();

	/* 
	 * 在进程上下文中处理
	 * 可以睡眠，可以调度
	 */
	
	/* 查找对应的VMA */
	vma = find_vma(mm, address);
	if (!vma || address < vma->vm_start) {
		/* 没有对应的VMA，段错误 */
		bad_area_nosemaphore(regs, error_code, address);
		return;
	}

	/* 处理缺页：分配物理页面，建立映射 */
	if (error_code & PF_WRITE) {
		/* 写时复制 */
		do_wp_page(mm, vma, address);
	} else {
		/* 按需加载 */
		do_no_page(mm, vma, address);
	}
}
```

### 5.4 系统中断与硬中断的区别

| 特性 | 系统中断/异常 | 硬中断 |
|------|---------------|--------|
| 触发方式 | 软件指令/硬件异常 | 外部硬件信号 |
| 同步/异步 | 同步（与指令相关） | 异步（与指令无关） |
| 上下文 | 进程上下文 | 中断上下文 |
| 可睡眠 | 部分（如缺页异常） | 否 |
| 可调度 | 是 | 否 |
| 返回点 | 触发指令处 | 被中断指令处 |

---

## 六、中断与调度的关系

### 6.1 调度函数概述

定义在 **`kernel/sched/core.c`**：

```c
/*
 * __schedule() 是核心调度函数
 *
 * 进入调度的主要途径：
 *
 *   1. 显式阻塞：mutex, semaphore, waitqueue等
 *
 *   2. TIF_NEED_RESCHED标志在中断和用户态返回路径被检查
 *      例如，定时器中断处理函数scheduler_tick()设置该标志
 *
 *   3. 唤醒操作不直接进入调度，而是将任务加入运行队列
 *      如果新任务抢占当前任务，则设置TIF_NEED_RESCHED
 */
static void __sched notrace __schedule(unsigned int sched_mode)
{
	struct task_struct *prev, *next;
	unsigned long *switch_count;
	unsigned long prev_state;
	struct rq_flags rf;
	struct rq *rq;
	int cpu;

	cpu = smp_processor_id();
	rq = cpu_rq(cpu);
	prev = rq->curr;

	schedule_debug(prev, !!sched_mode);

	local_irq_disable();
	rcu_note_context_switch(!!sched_mode);

	rq_lock(rq, &rf);
	smp_mb__after_spinlock();

	update_rq_clock(rq);

	/* 选择下一个要运行的任务 */
	next = pick_next_task(rq, prev, &rf);

	if (likely(prev != next)) {
		/* 执行上下文切换 */
		rq = context_switch(rq, prev, next, &rf);
	}

	rq_unlock_irq(rq, &rf);
}
```

### 6.2 中断触发调度的时机

```
┌─────────────────────────────────────────────────────────────┐
│                    中断触发调度的时机                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 时钟中断                                                 │
│     └─ scheduler_tick() 检查时间片                          │
│        └─ 设置 TIF_NEED_RESCHED                             │
│                                                             │
│  2. 唤醒进程                                                 │
│     └─ try_to_wake_up() 将进程加入运行队列                   │
│        └─ 如果优先级更高，设置 TIF_NEED_RESCHED             │
│                                                             │
│  3. 中断返回时                                               │
│     └─ 检查 TIF_NEED_RESCHED                                │
│        └─ 如果设置，调用 preempt_schedule_irq()             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  时钟中断 → scheduler_tick() → resched_curr()        │   │
│  │       │                                              │   │
│  │       ▼                                              │   │
│  │  irq_exit() → 检查need_resched                       │   │
│  │       │                                              │   │
│  │       ▼                                              │   │
│  │  preempt_schedule_irq() → __schedule()               │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 preempt_schedule_irq

定义在 **`kernel/sched/core.c`**：

```c
/*
 * 从中断上下文进入调度的入口点
 * 注意：调用时中断已禁用，返回时中断仍禁用
 * 这保护我们免受中断递归调用的影响
 */
asmlinkage __visible void __sched preempt_schedule_irq(void)
{
	enum ctx_state prev_state;

	/* 检查调用者是否正确 */
	BUG_ON(preempt_count() || !irqs_disabled());

	prev_state = exception_enter();

	do {
		preempt_disable();
		local_irq_enable();      /* 开中断 */
		__schedule(SM_PREEMPT);  /* 执行调度 */
		local_irq_disable();     /* 关中断 */
		sched_preempt_enable_no_resched();
	} while (need_resched());    /* 循环直到不需要调度 */

	exception_exit(prev_state);
}
```

### 6.4 中断返回时的调度检查

定义在 **`kernel/entry/common.c`**：

```c
/*
 * 中断返回时的条件调度
 */
void irqentry_exit_cond_resched(void)
{
	if (!preempt_count()) {
		/* 检查RCU和线程栈 */
		rcu_irq_exit_check_preempt();
		if (IS_ENABLED(CONFIG_DEBUG_ENTRY))
			WARN_ON_ONCE(!on_thread_stack());
		
		/* 如果需要调度，执行调度 */
		if (need_resched())
			preempt_schedule_irq();
	}
}

/*
 * 中断退出处理
 */
noinstr void irqentry_exit(struct pt_regs *regs, irqentry_state_t state)
{
	lockdep_assert_irqs_disabled();

	/* 检查是否返回用户态 */
	if (user_mode(regs)) {
		irqentry_exit_to_user_mode(regs);
	} else if (!regs_irqs_disabled(regs)) {
		/* 返回内核态 */
		if (state.exit_rcu) {
			/* RCU处理 */
			rcu_irq_exit();
			return;
		}

		/* 如果启用了抢占，检查是否需要调度 */
		if (IS_ENABLED(CONFIG_PREEMPTION)) {
			irqentry_exit_cond_resched();
		}
	}
}
```

### 6.5 调度与中断的关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    调度与中断的关系                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    进程A运行                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              时钟中断发生                             │   │
│  │  - 保存进程A上下文                                    │   │
│  │  - 进入硬中断上下文                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              scheduler_tick()                        │   │
│  │  - 更新进程A的时间统计                                │   │
│  │  - 检查时间片是否用完                                 │   │
│  │  - 如果用完，设置TIF_NEED_RESCHED                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              irq_exit()                              │   │
│  │  - 处理软中断（如果有）                               │   │
│  │  - 检查need_resched                                  │   │
│  │  - 如果需要调度，调用preempt_schedule_irq()          │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              __schedule()                            │   │
│  │  - 选择下一个要运行的进程（进程B）                    │   │
│  │  - 执行上下文切换                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    进程B运行                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、中断上下文详解

### 7.1 抢占计数

定义在 **`include/linux/preempt.h`**：

```c
/*
 * 抢占计数各部分含义（32位）：
 *
 *  bit 0-7:   抢占计数（PREEMPT_MASK）
 *  bit 8-15:  软中断计数（SOFTIRQ_MASK）
 *  bit 16-23: 硬中断计数（HARDIRQ_MASK）
 *  bit 24-31: NMI计数（NMI_MASK）
 */

#define nmi_count()     (preempt_count() & NMI_MASK)
#define hardirq_count() (preempt_count() & HARDIRQ_MASK)
#define softirq_count() (preempt_count() & SOFTIRQ_MASK)
#define irq_count()     (preempt_count() & (NMI_MASK | HARDIRQ_MASK | SOFTIRQ_MASK))

/*
 * 上下文检查宏
 */
#define in_nmi()            (nmi_count())
#define in_hardirq()        (hardirq_count())
#define in_serving_softirq() (softirq_count() & SOFTIRQ_OFFSET)
#define in_task()           (!(preempt_count() & (NMI_MASK | HARDIRQ_MASK | SOFTIRQ_OFFSET)))

/*
 * 已弃用的宏（新代码不应使用）
 */
#define in_irq()            (hardirq_count())       /* 使用in_hardirq() */
#define in_softirq()        (softirq_count())       /* BH禁用或软中断中 */
#define in_interrupt()      (irq_count())           /* NMI/IRQ/SoftIRQ/BH禁用 */
```

### 7.2 上下文判断

```
┌─────────────────────────────────────────────────────────────┐
│                    上下文判断示例                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  /* 检查是否在中断上下文 */                                  │
│  if (in_interrupt()) {                                       │
│      /* 在中断上下文，不能睡眠 */                            │
│      pr_err("Cannot sleep in interrupt context!\n");         │
│  }                                                           │
│                                                             │
│  /* 检查是否在硬中断上下文 */                                │
│  if (in_hardirq()) {                                         │
│      /* 在硬中断上下文 */                                    │
│  }                                                           │
│                                                             │
│  /* 检查是否在软中断上下文 */                                │
│  if (in_serving_softirq()) {                                 │
│      /* 正在执行软中断处理函数 */                            │
│  }                                                           │
│                                                             │
│  /* 检查是否在进程上下文 */                                  │
│  if (in_task()) {                                            │
│      /* 在进程上下文，可以睡眠 */                            │
│  }                                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 各上下文的限制

| 上下文 | in_interrupt | 可睡眠 | 可调度 | 可阻塞 | 使用栈 |
|--------|--------------|--------|--------|--------|--------|
| 进程上下文 | false | 是 | 是 | 是 | 进程栈 |
| 软中断上下文 | true | 否 | 可抢占 | 否 | 软中断栈 |
| 硬中断上下文 | true | 否 | 否 | 否 | 中断栈 |
| NMI上下文 | true | 否 | 否 | 否 | NMI栈 |

### 7.4 硬中断进入/退出宏

定义在 **`include/linux/hardirq.h`**：

```c
/*
 * 进入硬中断上下文
 */
#define __irq_enter()					\
	do {						\
		preempt_count_add(HARDIRQ_OFFSET);	\
		lockdep_hardirq_enter();		\
		account_hardirq_enter(current);		\
	} while (0)

/*
 * 退出硬中断上下文
 */
#define __irq_exit()					\
	do {						\
		account_hardirq_exit(current);		\
		lockdep_hardirq_exit();			\
		preempt_count_sub(HARDIRQ_OFFSET);	\
	} while (0)
```

---

## 八、中断处理完整流程

### 8.1 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    中断处理完整流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  进程A正在执行用户态代码                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼ 硬件中断信号                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  CPU响应中断                                         │   │
│  │  - 保存EFLAGS, CS, EIP到栈                          │   │
│  │  - 如果特权级改变，保存SS, ESP                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  执行中断门代码（entry_64.S）                         │   │
│  │  - 保存更多寄存器                                    │   │
│  │  - 切换到中断栈                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  irq_enter()                                         │   │
│  │  - preempt_count += HARDIRQ_OFFSET                  │   │
│  │  - 进入RCU                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  handle_irq(desc)                                    │   │
│  │  - 调用驱动的中断处理函数                            │   │
│  │  - 处理硬件事件                                      │   │
│  │  - 可能触发软中断（raise_softirq）                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  irq_exit()                                          │   │
│  │  - preempt_count -= HARDIRQ_OFFSET                  │   │
│  │  - 检查软中断pending                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ├─ 有软中断pending                 │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  invoke_softirq()                                    │   │
│  │  - __do_softirq()                                    │   │
│  │  - 开中断，处理软中断                                │   │
│  │  - 可被硬中断打断                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  检查need_resched                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ├─ 需要调度                        │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  preempt_schedule_irq()                              │   │
│  │  - __schedule()                                      │   │
│  │  - 切换到进程B                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  进程B开始执行                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 中断嵌套

```
┌─────────────────────────────────────────────────────────────┐
│                    中断嵌套示意                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  进程A                                                       │
│    │                                                         │
│    ├─ 硬中断1（网卡）                                        │
│    │    │                                                    │
│    │    ├─ 关中断                                            │
│    │    ├─ ISR处理                                           │
│    │    ├─ 触发NET_RX_SOFTIRQ                                │
│    │    └─ 开中断                                            │
│    │                                                         │
│    ├─ 硬中断2（时钟）← 可打断硬中断1的后续处理               │
│    │    │                                                    │
│    │    ├─ scheduler_tick()                                  │
│    │    └─ 设置need_resched                                  │
│    │                                                         │
│    ├─ 软中断处理（NET_RX_SOFTIRQ）                           │
│    │    │                                                    │
│    │    ├─ 开中断                                            │
│    │    ├─ napi_poll()                                       │
│    │    │   └─ 可被硬中断打断                                │
│    │    └─ 开中断                                            │
│    │                                                         │
│    └─ 调度 → 进程B                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、常见问题与最佳实践

### 9.1 常见错误

```c
/* 错误1：在中断上下文中睡眠 */
static irqreturn_t bad_isr(int irq, void *dev_id)
{
    msleep(10);  /* 错误！会导致内核崩溃 */
    return IRQ_HANDLED;
}

/* 正确做法：使用工作队列延迟处理 */
static irqreturn_t good_isr(int irq, void *dev_id)
{
    struct my_dev *dev = dev_id;
    schedule_work(&dev->work);  /* 在进程上下文中处理 */
    return IRQ_HANDLED;
}

/* 错误2：在中断处理函数中调用可能睡眠的函数 */
static irqreturn_t bad_isr2(int irq, void *dev_id)
{
    mutex_lock(&lock);  /* 错误！mutex可能睡眠 */
    /* ... */
    mutex_unlock(&lock);
    return IRQ_HANDLED;
}

/* 正确做法：使用自旋锁 */
static irqreturn_t good_isr2(int irq, void *dev_id)
{
    spin_lock(&lock);  /* 正确 */
    /* ... */
    spin_unlock(&lock);
    return IRQ_HANDLED;
}

/* 错误3：忘记检查上下文 */
static void my_function(void)
{
    /* 应该检查是否在中断上下文 */
    if (in_interrupt()) {
        /* 中断上下文：不能睡眠 */
        do_quick_work();
    } else {
        /* 进程上下文：可以睡眠 */
        do_slow_work();
    }
}
```

### 9.2 最佳实践

```
┌─────────────────────────────────────────────────────────────┐
│                    中断处理最佳实践                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 硬中断处理函数（ISR）                                    │
│     - 尽可能短小精悍                                         │
│     - 只做最必要的处理                                       │
│     - 将耗时操作延迟到软中断或工作队列                       │
│     - 使用自旋锁而非互斥锁                                   │
│                                                             │
│  2. 软中断处理                                               │
│     - 适合网络、块设备等高频操作                             │
│     - 开中断执行，可被硬中断打断                             │
│     - 避免添加新的软中断类型                                 │
│                                                             │
│  3. 工作队列                                                  │
│     - 适合可以睡眠的操作                                     │
│     - 在进程上下文执行                                       │
│     - 可以指定CPU亲和性                                      │
│                                                             │
│  4. 线程化中断                                                │
│     - 使用request_threaded_irq()                             │
│     - 硬中断做最小处理                                       │
│     - 线程函数做主要处理                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 调试技巧

```bash
# 查看中断统计
cat /proc/interrupts

# 查看软中断统计
cat /proc/softirqs

# 查看当前CPU的中断计数
cat /proc/stat | grep intr

# 使用tracepoint跟踪中断
echo 1 > /sys/kernel/debug/tracing/events/irq/enable
cat /sys/kernel/debug/tracing/trace

# 查看中断处理时间
perf record -e irq:irq_handler_entry -e irq:irq_handler_exit -a sleep 10
perf report
```

### 9.4 性能优化

| 优化点 | 方法 | 效果 |
|--------|------|------|
| 中断亲和性 | /proc/irq/N/smp_affinity | 分散中断负载 |
| 软中断处理 | 调整netdev_budget | 提高网络吞吐 |
| 中断合并 | ethtool -C eth0 rx-usecs N | 减少中断次数 |
| 线程化中断 | request_threaded_irq | 降低中断延迟 |

---

## 十、总结

### 10.1 三种中断对比总结

| 特性 | 硬中断 | 软中断 | 系统中断 |
|------|--------|--------|----------|
| 触发源 | 硬件设备 | 软件触发 | 软件指令 |
| 处理时机 | 立即 | 延迟 | 立即 |
| 上下文 | 中断上下文 | 软中断上下文 | 进程上下文 |
| 可睡眠 | 否 | 否 | 部分 |
| 与调度关系 | 触发调度检查 | 可被抢占 | 可直接调度 |

### 10.2 关键API速查

| 函数 | 说明 |
|------|------|
| request_irq() | 注册硬中断处理函数 |
| free_irq() | 释放硬中断 |
| raise_softirq() | 触发软中断 |
| open_softirq() | 注册软中断处理函数 |
| in_interrupt() | 检查是否在中断上下文 |
| in_hardirq() | 检查是否在硬中断上下文 |
| in_task() | 检查是否在进程上下文 |
| irq_enter() | 进入中断上下文 |
| irq_exit() | 退出中断上下文 |

### 10.3 进一步学习

- **`include/linux/interrupt.h`** - 中断API定义
- **`include/linux/hardirq.h`** - 硬中断相关
- **`kernel/softirq.c`** - 软中断实现
- **`kernel/irq/handle.c`** - 中断处理
- **`kernel/sched/core.c`** - 调度器核心

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了硬中断、软中断和系统中断的区别，以及它们与调度函数的关系。理解中断机制是掌握Linux内核的关键基础。*
