# Linux 5.15 NAPI（New API）详解

## 目录
1. **`引言：为什么需要NAPI`**
2. **`传统收包模式的困境`**
3. **`NAPI核心概念`**
4. **`NAPI数据结构`**
5. **`NAPI核心函数`**
6. **`NAPI工作流程`**
7. **`GRO通用接收卸载`**
8. **`NAPI完整使用示例`**
9. **`NAPI配置与调优`**
10. **`常见问题与注意事项`**

---

## 一、引言：为什么需要NAPI

### 1.1 高并发网络的核心挑战

在高并发网络场景中，系统收包性能是决定服务上限的关键：

```
┌─────────────────────────────────────────────────────────────┐
│                    高并发网络挑战                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  场景：数据中心、高负载服务器                                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  网络流量：每秒数十万到数百万数据包                   │   │
│  │                                                      │   │
│  │  问题：                                               │   │
│  │    - CPU飙升                                          │   │
│  │    - 收包卡顿                                         │   │
│  │    - 中断风暴                                         │   │
│  │    - 系统响应慢                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  根本原因：传统中断驱动模式无法应对高流量                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 NAPI的设计目标

NAPI（New API）是Linux内核网络子系统的核心优化机制：

| 目标 | 说明 | 解决的问题 |
|------|------|------------|
| 减少中断次数 | 批量处理数据包 | 中断风暴 |
| 提高CPU利用率 | 避免频繁上下文切换 | CPU资源浪费 |
| 公平调度 | 多网卡负载均衡 | 单网卡独占CPU |
| 低延迟响应 | 小流量时及时响应 | 延迟过大 |

### 1.3 NAPI的核心思想

```
┌─────────────────────────────────────────────────────────────┐
│                    NAPI核心思想                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  "中断 + 轮询" 混合模式                                      │
│                                                             │
│  低流量时：中断驱动模式                                       │
│    └─ 及时响应，低延迟                                       │
│                                                             │
│  高流量时：轮询模式                                           │
│    └─ 批量处理，高效率                                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  网卡收到数据包                                       │   │
│  │        │                                              │   │
│  │        ▼                                              │   │
│  │  触发硬中断（只触发一次）                             │   │
│  │        │                                              │   │
│  │        ▼                                              │   │
│  │  禁用网卡硬中断                                       │   │
│  │        │                                              │   │
│  │        ▼                                              │   │
│  │  触发软中断NET_RX_SOFTIRQ                             │   │
│  │        │                                              │   │
│  │        ▼                                              │   │
│  │  轮询处理数据包（批量）                               │   │
│  │        │                                              │   │
│  │        ├─ 处理完毕 → 重新启用硬中断                   │   │
│  │        │                                              │   │
│  │        └─ 时间片用完 → 等待下次软中断                 │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、传统收包模式的困境

### 2.1 传统中断驱动模式

```
┌─────────────────────────────────────────────────────────────┐
│                    传统中断驱动模式                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  每个数据包的处理流程：                                      │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 数据包1  │    │ 数据包2  │    │ 数据包3  │    ...       │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│       ▼               ▼               ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 硬中断1  │    │ 硬中断2  │    │ 硬中断3  │    ...       │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │               │                     │
│       ▼               ▼               ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 处理包1  │    │ 处理包2  │    │ 处理包3  │    ...       │
│  └──────────┘    └──────────┘    └──────────┘              │
│                                                             │
│  问题：每个数据包都触发一次硬中断！                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 中断风暴问题

```
┌─────────────────────────────────────────────────────────────┐
│                    中断风暴分析                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  假设：                                                      │
│    - 网络流量：100万PPS（包/秒）                             │
│    - 每次中断处理时间：10微秒                                │
│                                                             │
│  传统模式：                                                  │
│    中断次数 = 100万次/秒                                     │
│    CPU中断时间 = 100万 × 10微秒 = 10秒                       │
│    结果：CPU 100% 时间都在处理中断！                         │
│                                                             │
│  NAPI模式（假设weight=64）：                                 │
│    中断次数 = 100万 / 64 ≈ 1.56万次/秒                      │
│    CPU中断时间 = 1.56万 × 10微秒 = 0.156秒                   │
│    结果：CPU 中断时间降低 98.4%！                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 性能瓶颈详解

| 瓶颈 | 原因 | 影响 |
|------|------|------|
| CPU占用高 | 频繁中断处理 | 其他任务饥饿 |
| 缓存失效 | 上下文切换 | 性能下降 |
| 响应延迟 | 中断处理排队 | 网络延迟增加 |
| 系统不稳定 | 中断风暴 | 可能崩溃 |

---

## 三、NAPI核心概念

### 3.1 NAPI状态机

```
┌─────────────────────────────────────────────────────────────┐
│                    NAPI状态转换                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐                                            │
│  │   空闲状态   │ ← 硬中断启用，等待数据包                   │
│  │   (IDLE)    │                                            │
│  └──────┬──────┘                                            │
│         │ 收到数据包                                         │
│         ▼                                                    │
│  ┌─────────────┐                                            │
│  │   调度状态   │ ← 硬中断禁用，等待软中断                   │
│  │  (SCHED)   │                                            │
│  └──────┬──────┘                                            │
│         │ 软中断执行                                         │
│         ▼                                                    │
│  ┌─────────────┐                                            │
│  │   轮询状态   │ ← 执行poll函数，批量收包                   │
│  │   (POLL)   │                                            │
│  └──────┬──────┘                                            │
│         │                                                    │
│         ├─ 处理完毕 → 返回空闲状态                           │
│         │                                                    │
│         └─ 时间片用完 → 返回调度状态                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 NAPI状态标志

定义在 **`include/linux/netdevice.h`**：

```c
enum {
	NAPI_STATE_SCHED,            /* Poll is scheduled - 已调度 */
	NAPI_STATE_MISSED,           /* reschedule a napi - 错过调度 */
	NAPI_STATE_DISABLE,          /* Disable pending - 禁用中 */
	NAPI_STATE_NPSVC,            /* Netpoll - don't dequeue */
	NAPI_STATE_LISTED,           /* NAPI added to system lists */
	NAPI_STATE_NO_BUSY_POLL,     /* Do not add in napi_hash */
	NAPI_STATE_IN_BUSY_POLL,     /* sk_busy_loop() owns this NAPI */
	NAPI_STATE_PREFER_BUSY_POLL, /* prefer busy-polling */
	NAPI_STATE_THREADED,         /* The poll is performed inside its own thread */
	NAPI_STATE_SCHED_THREADED,   /* Napi is currently scheduled in threaded mode */
};
```

### 3.3 权重（Weight）概念

```
┌─────────────────────────────────────────────────────────────┐
│                    权重的作用                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  weight = 单次轮询最大处理数据包数量                         │
│                                                             │
│  默认值：NAPI_POLL_WEIGHT = 64                               │
│                                                             │
│  作用：                                                      │
│    1. 限制单次软中断的CPU时间                                │
│    2. 实现多NAPI实例的公平调度                               │
│    3. 防止单网卡独占CPU                                      │
│                                                             │
│  示例：                                                      │
│    weight = 64                                               │
│    当前队列有 200 个数据包                                   │
│                                                             │
│    第一次轮询：处理 64 个包                                  │
│    第二次轮询：处理 64 个包                                  │
│    第三次轮询：处理 64 个包                                  │
│    第四次轮询：处理 8 个包（队列空）                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、NAPI数据结构

### 4.1 napi_struct结构体

定义在 **`include/linux/netdevice.h`**：

```c
/*
 * Structure for NAPI scheduling similar to tasklet but with weighting
 */
struct napi_struct {
	/* 轮询链表：由管理NAPI_STATE_SCHED状态的实体管理 */
	struct list_head	poll_list;

	/* NAPI状态标志 */
	unsigned long		state;
	
	/* 单次轮询最大处理数据包数量（权重） */
	int			weight;
	
	/* 延迟硬中断计数 */
	int			defer_hard_irqs_count;
	
	/* GRO哈希位掩码 */
	unsigned long		gro_bitmask;
	
	/* 驱动实现的轮询回调函数 */
	int			(*poll)(struct napi_struct *, int);
	
#ifdef CONFIG_NETPOLL
	int			poll_owner;
#endif
	
	/* 关联的网络设备 */
	struct net_device	*dev;
	
	/* GRO哈希桶 */
	struct gro_list		gro_hash[GRO_HASH_BUCKETS];
	
	/* 临时数据包缓冲区 */
	struct sk_buff		*skb;
	
	/* 待处理的GRO_NORMAL数据包链表 */
	struct list_head	rx_list;
	
	/* rx_list长度 */
	int			rx_count;
	
	/* NAPI看门狗定时器 */
	struct hrtimer		timer;
	
	/* 设备级NAPI链表节点 */
	struct list_head	dev_list;
	
	/* 哈希表节点 */
	struct hlist_node	napi_hash_node;
	
	/* NAPI唯一标识 */
	unsigned int		napi_id;
	
	/* NAPI线程（线程化NAPI） */
	struct task_struct	*thread;
};
```

### 4.2 关键字段详解

| 字段 | 类型 | 说明 |
|------|------|------|
| poll_list | list_head | 将NAPI挂载到CPU的poll_list |
| state | unsigned long | NAPI状态标志位 |
| weight | int | 单次轮询最大处理包数 |
| poll | 函数指针 | 驱动实现的收包函数 |
| dev | net_device* | 关联的网络设备 |
| gro_hash | gro_list[] | GRO合并用的哈希桶 |
| timer | hrtimer | 看门狗定时器 |

### 4.3 softnet_data结构体

定义在 **`include/linux/netdevice.h`**：

```c
/*
 * Incoming packets are placed on per-CPU queues
 */
struct softnet_data {
	/* NAPI轮询链表 */
	struct list_head	poll_list;
	
	/* 处理队列 */
	struct sk_buff_head	process_queue;

	/* 统计信息 */
	unsigned int		processed;      /* 已处理包数 */
	unsigned int		time_squeeze;   /* 时间片耗尽次数 */
	unsigned int		received_rps;   /* RPS接收包数 */
	
#ifdef CONFIG_RPS
	struct softnet_data	*rps_ipi_list;
#endif
#ifdef CONFIG_NET_FLOW_LIMIT
	struct sd_flow_limit __rcu *flow_limit;
#endif
	
	/* 输出队列 */
	struct Qdisc		*output_queue;
	struct Qdisc		**output_queue_tailp;
	struct sk_buff		*completion_queue;
	
	/* 发送相关 */
	struct {
		u16 recursion;
		u8  more;
	} xmit;
	
	/* 丢弃计数 */
	unsigned int		dropped;
	
	/* 输入包队列 */
	struct sk_buff_head	input_pkt_queue;
	
	/* 积压NAPI实例 */
	struct napi_struct	backlog;
};
```

### 4.4 数据结构关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    NAPI数据结构关系                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              softnet_data (per-CPU)                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  poll_list ──────┬─────┬─────┬─────┐                │   │
│  │                   │     │     │     │                │   │
│  └───────────────────┼─────┼─────┼─────┼────────────────┘   │
│                       │     │     │     │                    │
│                       ▼     ▼     ▼     ▼                    │
│  ┌─────────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │napi_struct  │ │napi_    │ │napi_    │ │napi_    │        │
│  │  (eth0)     │ │struct   │ │struct   │ │struct   │        │
│  │             │ │ (eth1)  │ │ (eth2)  │ │(backlog)│        │
│  ├─────────────┤ ├─────────┤ ├─────────┤ ├─────────┤        │
│  │ poll()      │ │ poll()  │ │ poll()  │ │ poll()  │        │
│  │ weight=64   │ │weight=64│ │weight=64│ │weight=64│        │
│  │ dev=eth0    │ │dev=eth1 │ │dev=eth2 │ │dev=NULL │        │
│  └─────────────┘ └─────────┘ └─────────┘ └─────────┘        │
│                                                             │
│  每个网卡驱动注册一个napi_struct实例                        │
│  所有napi_struct通过poll_list链接到softnet_data             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、NAPI核心函数

### 5.1 netif_napi_add - 初始化NAPI

定义在 **`net/core/dev.c`**：

```c
/**
 * netif_napi_add - initialize a NAPI context
 * @dev:  network device
 * @napi: NAPI context
 * @poll: polling function
 * @weight: default weight
 *
 * netif_napi_add() must be used to initialize a NAPI context
 * prior to calling *any* of the other NAPI-related functions.
 */
void netif_napi_add(struct net_device *dev, struct napi_struct *napi,
		    int (*poll)(struct napi_struct *, int), int weight)
{
	if (WARN_ON(test_and_set_bit(NAPI_STATE_LISTED, &napi->state)))
		return;

	INIT_LIST_HEAD(&napi->poll_list);
	INIT_HLIST_NODE(&napi->napi_hash_node);
	
	/* 初始化看门狗定时器 */
	hrtimer_init(&napi->timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL_PINNED);
	napi->timer.function = napi_watchdog;
	
	init_gro_hash(napi);
	napi->skb = NULL;
	INIT_LIST_HEAD(&napi->rx_list);
	napi->rx_count = 0;
	
	/* 注册驱动的poll函数 */
	napi->poll = poll;
	
	/* 设置权重（建议不超过64） */
	if (weight > NAPI_POLL_WEIGHT)
		netdev_err_once(dev, "%s() called with weight %d\n", 
				__func__, weight);
	napi->weight = weight;
	
	/* 绑定网络设备 */
	napi->dev = dev;
	
#ifdef CONFIG_NETPOLL
	napi->poll_owner = -1;
#endif
	
	/* 设置初始状态 */
	set_bit(NAPI_STATE_SCHED, &napi->state);
	set_bit(NAPI_STATE_NPSVC, &napi->state);
	
	/* 添加到设备的NAPI链表 */
	list_add_rcu(&napi->dev_list, &dev->napi_list);
	napi_hash_add(napi);
	
	/* 如果启用线程化NAPI，创建内核线程 */
	if (dev->threaded && napi_kthread_create(napi))
		dev->threaded = 0;
}
EXPORT_SYMBOL(netif_napi_add);
```

### 5.2 napi_schedule_prep - 调度前置检查

定义在 **`net/core/dev.c`**：

```c
/**
 * napi_schedule_prep - check if napi can be scheduled
 * @n: napi context
 *
 * Test if NAPI routine is already running, and if not mark
 * it as running. This is used as a condition variable to
 * insure only one NAPI poll instance runs.
 */
bool napi_schedule_prep(struct napi_struct *n)
{
	unsigned long val, new;

	do {
		val = READ_ONCE(n->state);
		
		/* 如果NAPI被禁用，返回false */
		if (unlikely(val & NAPIF_STATE_DISABLE))
			return false;
		
		new = val | NAPIF_STATE_SCHED;

		/* 如果已经调度，设置MISSED标志 */
		new |= (val & NAPIF_STATE_SCHED) / NAPIF_STATE_SCHED *
						   NAPIF_STATE_MISSED;
	} while (cmpxchg(&n->state, val, new) != val);

	return !(val & NAPIF_STATE_SCHED);
}
EXPORT_SYMBOL(napi_schedule_prep);
```

### 5.3 __napi_schedule - 调度NAPI

定义在 **`net/core/dev.c`**：

```c
/**
 * __napi_schedule - schedule for receive
 * @n: entry to schedule
 *
 * The entry's receive function will be scheduled to run.
 * Consider using __napi_schedule_irqoff() if hard irqs are masked.
 */
void __napi_schedule(struct napi_struct *n)
{
	unsigned long flags;

	local_irq_save(flags);
	____napi_schedule(this_cpu_ptr(&softnet_data), n);
	local_irq_restore(flags);
}
EXPORT_SYMBOL(__napi_schedule);
```

### 5.4 ____napi_schedule - 底层调度

定义在 **`net/core/dev.c`**：

```c
/* Called with irq disabled */
static inline void ____napi_schedule(struct softnet_data *sd,
				     struct napi_struct *napi)
{
	struct task_struct *thread;

	/* 如果是线程化NAPI */
	if (test_bit(NAPI_STATE_THREADED, &napi->state)) {
		thread = READ_ONCE(napi->thread);
		if (thread) {
			if (READ_ONCE(thread->__state) != TASK_INTERRUPTIBLE)
				set_bit(NAPI_STATE_SCHED_THREADED, &napi->state);
			wake_up_process(thread);
			return;
		}
	}

	/* 将napi添加到poll_list */
	list_add_tail(&napi->poll_list, &sd->poll_list);
	
	/* 触发NET_RX软中断 */
	raise_softirq_irqoff(NET_RX_SOFTIRQ);
}
```

### 5.5 napi_schedule - 标准调度函数

定义在 **`include/linux/netdevice.h`**：

```c
/**
 * napi_schedule - schedule NAPI poll
 * @n: NAPI context
 *
 * Schedule NAPI poll routine to be called if it is not already
 * running.
 */
static inline void napi_schedule(struct napi_struct *n)
{
	if (napi_schedule_prep(n))
		__napi_schedule(n);
}
```

### 5.6 napi_poll - 执行轮询

定义在 **`net/core/dev.c`**：

```c
static int napi_poll(struct napi_struct *n, struct list_head *repoll)
{
	bool do_repoll = false;
	void *have;
	int work;

	/* 从poll_list中移除 */
	list_del_init(&n->poll_list);

	have = netpoll_poll_lock(n);

	/* 调用__napi_poll执行实际轮询 */
	work = __napi_poll(n, &do_repoll);

	/* 如果需要重新轮询，添加到repoll链表 */
	if (do_repoll)
		list_add_tail(&n->poll_list, repoll);

	netpoll_poll_unlock(have);

	return work;
}
```

### 5.7 __napi_poll - 实际轮询逻辑

定义在 **`net/core/dev.c`**：

```c
static int __napi_poll(struct napi_struct *n, bool *repoll)
{
	int work, weight;

	weight = n->weight;

	work = 0;
	if (test_bit(NAPI_STATE_SCHED, &n->state)) {
		/* 调用驱动注册的poll函数 */
		work = n->poll(n, weight);
		trace_napi_poll(n, work, weight);
	}

	/* 检查poll函数返回值 */
	if (unlikely(work > weight))
		pr_err_once("NAPI poll function %pS returned %d, "
			    "exceeding its budget of %d.\n",
			    n->poll, work, weight);

	/* 如果处理包数小于权重，说明处理完毕 */
	if (likely(work < weight))
		return work;

	/* 如果NAPI被禁用，完成处理 */
	if (unlikely(napi_disable_pending(n))) {
		napi_complete(n);
		return work;
	}

	/* 如果偏好busy poll，特殊处理 */
	if (napi_prefer_busy_poll(n)) {
		if (napi_complete_done(n, work)) {
			napi_schedule(n);
		}
		return work;
	}

	/* 刷新GRO */
	if (n->gro_bitmask) {
		napi_gro_flush(n, HZ >= 1000);
	}

	gro_normal_list(n);

	/* 标记需要重新轮询 */
	*repoll = true;

	return work;
}
```

### 5.8 net_rx_action - 软中断处理函数

定义在 **`net/core/dev.c`**：

```c
static __latent_entropy void net_rx_action(struct softirq_action *h)
{
	struct softnet_data *sd = this_cpu_ptr(&softnet_data);
	unsigned long time_limit = jiffies +
		usecs_to_jiffies(READ_ONCE(netdev_budget_usecs));
	int budget = READ_ONCE(netdev_budget);
	LIST_HEAD(list);
	LIST_HEAD(repoll);

	local_irq_disable();
	/* 获取poll_list */
	list_splice_init(&sd->poll_list, &list);
	local_irq_enable();

	for (;;) {
		struct napi_struct *n;

		if (list_empty(&list)) {
			if (!sd_has_rps_ipi_waiting(sd) && list_empty(&repoll))
				return;
			break;
		}

		n = list_first_entry(&list, struct napi_struct, poll_list);
		
		/* 调用napi_poll处理 */
		budget -= napi_poll(n, &repoll);

		/* 检查是否超出时间限制或预算 */
		if (unlikely(budget <= 0 ||
			     time_after_eq(jiffies, time_limit))) {
			sd->time_squeeze++;
			break;
		}
	}

	local_irq_disable();

	/* 重新组织链表 */
	list_splice_tail_init(&sd->poll_list, &list);
	list_splice_tail(&repoll, &list);
	list_splice(&list, &sd->poll_list);
	
	/* 如果还有待处理的NAPI，重新触发软中断 */
	if (!list_empty(&sd->poll_list))
		__raise_softirq_irqoff(NET_RX_SOFTIRQ);

	net_rps_action_and_irq_enable(sd);
}
```

### 5.9 napi_gro_receive - GRO接收

定义在 **`net/core/dev.c`**：

```c
gro_result_t napi_gro_receive(struct napi_struct *napi, struct sk_buff *skb)
{
	gro_result_t ret;

	/* 标记NAPI ID */
	skb_mark_napi_id(skb, napi);
	trace_napi_gro_receive_entry(skb);

	/* 重置GRO偏移 */
	skb_gro_reset_offset(skb, 0);

	/* 执行GRO合并并投递到协议栈 */
	ret = napi_skb_finish(napi, skb, dev_gro_receive(napi, skb));
	trace_napi_gro_receive_exit(ret);

	return ret;
}
EXPORT_SYMBOL(napi_gro_receive);
```

---

## 六、NAPI工作流程

### 6.1 完整工作流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    NAPI完整工作流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 网卡收到数据包                                           │
│         │                                                    │
│         ▼                                                    │
│  2. 触发硬中断（ISR）                                        │
│         │                                                    │
│         ├─ 读取中断状态                                      │
│         │                                                    │
│         ▼                                                    │
│  3. 驱动中断处理函数                                         │
│         │                                                    │
│         │  if (napi_schedule_prep(&napi)) {                  │
│         │      __napi_schedule(&napi);                       │
│         │  }                                                 │
│         │                                                    │
│         ▼                                                    │
│  4. napi_schedule_prep检查状态                               │
│         │                                                    │
│         ├─ 检查是否已调度                                    │
│         │                                                    │
│         ├─ 检查是否被禁用                                    │
│         │                                                    │
│         ▼                                                    │
│  5. __napi_schedule调度                                      │
│         │                                                    │
│         ├─ 将napi添加到poll_list                             │
│         │                                                    │
│         ├─ 触发NET_RX_SOFTIRQ                                │
│         │                                                    │
│         ▼                                                    │
│  6. 禁用网卡硬中断                                           │
│         │                                                    │
│         ▼                                                    │
│  7. NET_RX软中断触发                                         │
│         │                                                    │
│         ▼                                                    │
│  8. net_rx_action执行                                        │
│         │                                                    │
│         ├─ 遍历poll_list                                     │
│         │                                                    │
│         ▼                                                    │
│  9. napi_poll执行                                            │
│         │                                                    │
│         ├─ 调用驱动的poll函数                                │
│         │                                                    │
│         ▼                                                    │
│  10. 驱动poll函数                                            │
│         │                                                    │
│         ├─ 从DMA读取数据包                                   │
│         │                                                    │
│         ├─ 封装skb                                           │
│         │                                                    │
│         ├─ 调用napi_gro_receive                              │
│         │                                                    │
│         ├─ 返回处理包数                                      │
│         │                                                    │
│         ▼                                                    │
│  11. 检查处理结果                                            │
│         │                                                    │
│         ├─ work < weight → 处理完毕                          │
│         │       │                                            │
│         │       └─ 重新启用硬中断                            │
│         │                                                    │
│         └─ work >= weight → 时间片用完                       │
│                 │                                            │
│                 └─ 重新加入poll_list                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 时序图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    NAPI时序图                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  网卡硬件    驱动ISR    NAPI子系统    软中断    驱动poll    协议栈   │
│     │          │           │           │          │          │      │
│     │ 数据包   │           │           │          │          │      │
│     │─────────►│           │           │          │          │      │
│     │          │           │           │          │          │      │
│     │ 硬中断   │           │           │          │          │      │
│     │─────────►│           │           │          │          │      │
│     │          │ napi_     │           │          │          │      │
│     │          │ schedule  │           │          │          │      │
│     │          │──────────►│           │          │          │      │
│     │          │           │ 添加到    │          │          │      │
│     │          │           │ poll_list │          │          │      │
│     │          │           │──────────►│          │          │      │
│     │          │           │ 触发软中断│          │          │      │
│     │          │           │           │ net_rx_  │          │      │
│     │          │           │           │ action   │          │      │
│     │          │           │           │─────────►│          │      │
│     │          │           │           │          │ poll()   │      │
│     │          │           │           │          │─────────►│      │
│     │          │           │           │          │ napi_gro │      │
│     │          │           │           │          │_receive  │      │
│     │          │           │           │          │─────────►│      │
│     │          │           │           │          │          │ 处理 │
│     │          │           │           │          │          │──┐   │
│     │          │           │           │          │          │  │   │
│     │          │           │           │          │          │◄─┘   │
│     │          │           │           │          │◄─────────│      │
│     │          │           │           │◄─────────│          │      │
│     │          │           │◄──────────│          │          │      │
│     │◄─────────│           │           │          │          │      │
│     │ 重新启用 │           │           │          │          │      │
│     │ 硬中断   │           │           │          │          │      │
│     │          │           │           │          │          │      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 七、GRO通用接收卸载

### 7.1 GRO概述

GRO（Generic Receive Offload）是NAPI的重要扩展，用于合并相同流的数据包：

```
┌─────────────────────────────────────────────────────────────┐
│                    GRO工作原理                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  不使用GRO：                                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                            │
│  │包1  │ │包2  │ │包3  │ │包4  │  → 协议栈处理4次          │
│  └─────┘ └─────┘ └─────┘ └─────┘                            │
│                                                             │
│  使用GRO：                                                   │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                            │
│  │包1  │ │包2  │ │包3  │ │包4  │                            │
│  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘                            │
│     │        │        │        │                             │
│     └────────┴────────┴────────┘                             │
│              │                                               │
│              ▼                                               │
│  ┌─────────────────────────────────┐                         │
│  │      合并后的大包               │  → 协议栈处理1次        │
│  └─────────────────────────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 GRO结果类型

```c
enum gro_result {
	GRO_MERGED,      /* 已合并到现有包 */
	GRO_MERGED_FREE, /* 已合并并释放新包 */
	GRO_HELD,        /* 暂存，等待更多包 */
	GRO_NORMAL,      /* 正常投递，不合并 */
	GRO_CONSUMED,    /* 已消费，无需投递 */
};
```

### 7.3 GRO优势

| 优势 | 说明 |
|------|------|
| 减少协议栈处理次数 | 多个小包合并成大包 |
| 降低CPU开销 | 减少协议头解析次数 |
| 提高吞吐量 | 更高效的数据处理 |
| 透明支持 | 无需应用层修改 |

---

## 八、NAPI完整使用示例

### 8.1 驱动初始化NAPI

```c
#include <linux/netdevice.h>
#include <linux/etherdevice.h>

struct my_nic_priv {
    struct napi_struct napi;
    struct net_device *dev;
    /* 其他私有数据 */
};

/* 驱动的poll函数 */
static int my_nic_poll(struct napi_struct *napi, int budget)
{
    struct my_nic_priv *priv = container_of(napi, struct my_nic_priv, napi);
    int work_done = 0;
    
    /* 从网卡DMA读取数据包，最多处理budget个 */
    while (work_done < budget && has_packet(priv)) {
        struct sk_buff *skb;
        
        /* 从硬件获取数据包 */
        skb = receive_packet(priv);
        if (!skb)
            break;
        
        /* 通过NAPI投递到协议栈 */
        napi_gro_receive(napi, skb);
        work_done++;
    }
    
    /* 如果处理完所有包，通知NAPI完成 */
    if (work_done < budget) {
        napi_complete_done(napi, work_done);
        /* 重新启用硬中断 */
        enable_interrupts(priv);
    }
    
    return work_done;
}

/* 驱动初始化 */
static int my_nic_probe(struct pci_dev *pdev, const struct pci_device_id *ent)
{
    struct net_device *dev;
    struct my_nic_priv *priv;
    
    /* 分配网络设备 */
    dev = alloc_etherdev(sizeof(struct my_nic_priv));
    if (!dev)
        return -ENOMEM;
    
    priv = netdev_priv(dev);
    priv->dev = dev;
    
    /* 初始化NAPI */
    netif_napi_add(dev, &priv->napi, my_nic_poll, NAPI_POLL_WEIGHT);
    
    /* 注册网络设备 */
    register_netdev(dev);
    
    return 0;
}
```

### 8.2 中断处理函数

```c
/* 硬件中断处理函数 */
static irqreturn_t my_nic_interrupt(int irq, void *dev_id)
{
    struct net_device *dev = dev_id;
    struct my_nic_priv *priv = netdev_priv(dev);
    u32 status;
    
    /* 读取中断状态 */
    status = readl(priv->mmio + REG_INTR_STATUS);
    
    /* 检查是否有接收中断 */
    if (status & INTR_RX) {
        /* 禁用接收中断 */
        writel(INTR_RX, priv->mmio + REG_INTR_MASK);
        
        /* 调度NAPI */
        if (napi_schedule_prep(&priv->napi)) {
            __napi_schedule(&priv->napi);
        }
    }
    
    /* 检查是否有发送中断 */
    if (status & INTR_TX) {
        /* 处理发送完成 */
        my_nic_tx_complete(priv);
    }
    
    return IRQ_HANDLED;
}
```

### 8.3 完整驱动示例

```c
#include <linux/module.h>
#include <linux/netdevice.h>
#include <linux/etherdevice.h>
#include <linux/interrupt.h>

#define MY_NIC_WEIGHT 64

struct my_nic_priv {
    struct napi_struct napi;
    struct net_device *dev;
    void __iomem *mmio;
    struct sk_buff *rx_skb[256];
    int rx_head;
    int rx_tail;
};

/* Poll函数实现 */
static int my_nic_poll(struct napi_struct *napi, int budget)
{
    struct my_nic_priv *priv = container_of(napi, struct my_nic_priv, napi);
    int work_done = 0;
    
    while (work_done < budget) {
        struct sk_buff *skb;
        u32 status;
        
        /* 检查是否有新包 */
        status = readl(priv->mmio + REG_RX_STATUS);
        if (!(status & RX_PKT_READY))
            break;
        
        /* 获取skb */
        skb = priv->rx_skb[priv->rx_tail];
        priv->rx_tail = (priv->rx_tail + 1) % 256;
        
        /* 设置skb长度 */
        skb_put(skb, status & RX_PKT_LEN_MASK);
        
        /* 投递到协议栈 */
        napi_gro_receive(napi, skb);
        
        /* 分配新的skb用于下次接收 */
        priv->rx_skb[priv->rx_head] = netdev_alloc_skb(priv->dev, 1536);
        priv->rx_head = (priv->rx_head + 1) % 256;
        
        work_done++;
    }
    
    /* 处理完毕 */
    if (work_done < budget) {
        /* 通知NAPI完成 */
        if (napi_complete_done(napi, work_done)) {
            /* 重新启用接收中断 */
            u32 intr_mask = readl(priv->mmio + REG_INTR_MASK);
            writel(intr_mask | INTR_RX, priv->mmio + REG_INTR_MASK);
        }
    }
    
    return work_done;
}

/* 中断处理 */
static irqreturn_t my_nic_isr(int irq, void *dev_id)
{
    struct net_device *dev = dev_id;
    struct my_nic_priv *priv = netdev_priv(dev);
    u32 status;
    
    status = readl(priv->mmio + REG_INTR_STATUS);
    
    if (status & INTR_RX) {
        /* 禁用接收中断 */
        u32 intr_mask = readl(priv->mmio + REG_INTR_MASK);
        writel(intr_mask & ~INTR_RX, priv->mmio + REG_INTR_MASK);
        
        /* 调度NAPI */
        napi_schedule(&priv->napi);
    }
    
    if (status & INTR_TX) {
        /* 发送完成处理 */
        my_nic_tx_done(priv);
    }
    
    /* 清除中断状态 */
    writel(status, priv->mmio + REG_INTR_STATUS);
    
    return IRQ_HANDLED;
}

/* 打开设备 */
static int my_nic_open(struct net_device *dev)
{
    struct my_nic_priv *priv = netdev_priv(dev);
    
    /* 启用NAPI */
    napi_enable(&priv->napi);
    
    /* 请求中断 */
    request_irq(priv->irq, my_nic_isr, IRQF_SHARED, dev->name, dev);
    
    /* 启用硬件 */
    writel(INTR_RX | INTR_TX, priv->mmio + REG_INTR_MASK);
    writel(DEV_ENABLE, priv->mmio + REG_CTRL);
    
    netif_start_queue(dev);
    
    return 0;
}

/* 关闭设备 */
static int my_nic_stop(struct net_device *dev)
{
    struct my_nic_priv *priv = netdev_priv(dev);
    
    netif_stop_queue(dev);
    
    /* 禁用硬件 */
    writel(0, priv->mmio + REG_CTRL);
    writel(0, priv->mmio + REG_INTR_MASK);
    
    /* 释放中断 */
    free_irq(priv->irq, dev);
    
    /* 禁用NAPI */
    napi_disable(&priv->napi);
    
    return 0;
}

/* 初始化 */
static int my_nic_init_one(struct pci_dev *pdev, 
                           const struct pci_device_id *ent)
{
    struct net_device *dev;
    struct my_nic_priv *priv;
    int err;
    
    err = pci_enable_device(pdev);
    if (err)
        return err;
    
    dev = alloc_etherdev(sizeof(struct my_nic_priv));
    if (!dev)
        return -ENOMEM;
    
    SET_NETDEV_DEV(dev, &pdev->dev);
    priv = netdev_priv(dev);
    priv->dev = dev;
    
    /* 映射MMIO */
    priv->mmio = pci_iomap(pdev, 0, 0);
    
    /* 初始化NAPI */
    netif_napi_add(dev, &priv->napi, my_nic_poll, MY_NIC_WEIGHT);
    
    /* 设置网络设备操作 */
    dev->netdev_ops = &my_nic_netdev_ops;
    
    err = register_netdev(dev);
    if (err)
        goto err_register;
    
    pci_set_drvdata(pdev, dev);
    
    return 0;
    
err_register:
    netif_napi_del(&priv->napi);
    pci_iounmap(pdev, priv->mmio);
    free_netdev(dev);
    return err;
}

/* 清理 */
static void my_nic_remove_one(struct pci_dev *pdev)
{
    struct net_device *dev = pci_get_drvdata(pdev);
    struct my_nic_priv *priv = netdev_priv(dev);
    
    unregister_netdev(dev);
    netif_napi_del(&priv->napi);
    pci_iounmap(pdev, priv->mmio);
    free_netdev(dev);
    pci_disable_device(pdev);
}

static struct pci_driver my_nic_driver = {
    .name = "my_nic",
    .id_table = my_nic_pci_tbl,
    .probe = my_nic_init_one,
    .remove = my_nic_remove_one,
};

module_pci_driver(my_nic_driver);
MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("NAPI-enabled Network Driver Example");
```

---

## 九、NAPI配置与调优

### 9.1 内核参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| netdev_budget | 300 | 全局收包预算 |
| netdev_budget_usecs | 2000 | 软中断时间限制（微秒） |
| netdev_max_backlog | 1000 | 输入队列最大长度 |
| gro_normal_batch | 8 | GRO批量投递大小 |

### 9.2 查看NAPI统计

```bash
# 查看软中断统计
cat /proc/softirqs | grep NET_RX

# 查看网络设备统计
cat /proc/net/dev

# 查看NAPI相关统计
cat /proc/net/softnet_stat

# 输出格式说明：
# 列1: 已处理包数
# 列2: time_squeeze次数（时间片耗尽）
# 列3: 丢弃包数
```

### 9.3 调优建议

```bash
# 1. 增加全局预算（高流量场景）
sysctl -w net.core.netdev_budget=600

# 2. 增加输入队列长度
sysctl -w net.core.netdev_max_backlog=2000

# 3. 启用RPS（多核负载均衡）
echo f > /sys/class/net/eth0/queues/rx-0/rps_cpus

# 4. 调整中断亲和性
echo 2 > /proc/irq/24/smp_affinity

# 5. 启用GRO
ethtool -K eth0 gro on

# 6. 查看当前NAPI权重
cat /sys/class/net/eth0/queues/rx-0/napi/weight
```

### 9.4 性能监控脚本

```bash
#!/bin/bash
# NAPI性能监控脚本

echo "NAPI Performance Monitor"
echo "========================"

while true; do
    echo "Time: $(date)"
    
    # 软中断统计
    echo "NET_RX softirq:"
    cat /proc/softirqs | grep NET_RX
    
    # softnet_data统计
    echo "Softnet stats:"
    cat /proc/net/softnet_stat | head -n 4
    
    # 网络设备统计
    echo "Network device:"
    cat /proc/net/dev | grep -E "eth|ens|enp"
    
    echo "---"
    sleep 1
done
```

---

## 十、常见问题与注意事项

### 10.1 常见错误

```c
/* 错误1：忘记调用napi_complete */
static int bad_poll(struct napi_struct *napi, int budget)
{
    int work = process_packets(budget);
    /* 忘记调用napi_complete！ */
    return work;  /* 硬中断永远不会重新启用 */
}

/* 正确做法 */
static int good_poll(struct napi_struct *napi, int budget)
{
    int work = process_packets(budget);
    
    if (work < budget) {
        napi_complete_done(napi, work);
        enable_interrupts();
    }
    return work;
}

/* 错误2：在poll函数中睡眠 */
static int bad_poll2(struct napi_struct *napi, int budget)
{
    msleep(10);  /* 错误！poll在软中断上下文 */
    return 0;
}

/* 错误3：返回值超过budget */
static int bad_poll3(struct napi_struct *napi, int budget)
{
    return budget + 10;  /* 错误！返回值不能超过budget */
}
```

### 10.2 调试技巧

```c
/* 使用tracepoint跟踪NAPI */
// 启用NAPI tracepoint
echo 1 > /sys/kernel/debug/tracing/events/napi/enable

// 查看trace输出
cat /sys/kernel/debug/tracing/trace

// 典型输出：
// napi_poll: dev=eth0 napi_id=1 work=64 weight=64
```

### 10.3 性能问题诊断

| 问题 | 症状 | 诊断方法 | 解决方案 |
|------|------|----------|----------|
| 中断风暴 | CPU占用高 | /proc/softirqs | 增加weight |
| 丢包 | 统计有drop | /proc/net/softnet_stat | 增加backlog |
| 延迟大 | 响应慢 | time_squeeze高 | 增加budget_usecs |
| 负载不均 | 单核忙 | 查看CPU占用 | 启用RPS |

### 10.4 最佳实践

1. **权重设置**：使用默认值64，除非有特殊需求
2. **及时完成**：处理完毕立即调用napi_complete
3. **正确返回**：返回实际处理包数，不超过budget
4. **避免阻塞**：poll函数中不能睡眠
5. **启用GRO**：提高吞吐量
6. **监控统计**：定期检查softnet_stat

---

## 十一、总结

### 11.1 NAPI API速查表

| 函数 | 说明 | 调用位置 |
|------|------|----------|
| netif_napi_add | 初始化NAPI | 驱动probe |
| netif_napi_del | 删除NAPI | 驱动remove |
| napi_enable | 启用NAPI | 设备open |
| napi_disable | 禁用NAPI | 设备stop |
| napi_schedule | 调度NAPI | 硬中断 |
| napi_complete | 完成处理 | poll函数 |
| napi_gro_receive | GRO投递 | poll函数 |

### 11.2 设计要点总结

1. **混合模式**：中断唤醒 + 批量轮询
2. **权重控制**：限制单次处理包数
3. **公平调度**：多NAPI实例轮询
4. **GRO合并**：减少协议栈开销
5. **软中断处理**：避免硬中断风暴

### 11.3 进一步学习

- **`include/linux/netdevice.h`** - NAPI数据结构定义
- **`net/core/dev.c`** - NAPI核心实现
- Documentation/networking/napi.rst - NAPI文档

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了NAPI机制的原理、实现和使用方法。NAPI是Linux高性能网络收包的核心机制，理解它是掌握Linux网络子系统的关键。*
