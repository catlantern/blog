# Linux 5.15 CFS 调度器详解：从问题到解决方案

## 目标

读完本文，你要明白两件事：

1. **Linux CFS 是怎么工作的**
2. **为什么要设计成这样**

---

# 一、先从最根本的问题开始：CPU 一次只能运行一个进程

一个 CPU 核心在某一时刻，只能真正执行一个进程（更准确说是一个线程）。

但系统里往往同时有很多进程都想运行，比如：

- 终端程序
- 浏览器
- 编译器
- 音乐播放器
- 后台服务

所以操作系统必须回答一个问题：

> **下一个应该让谁运行？**

这就是**调度（scheduling）**。

---

# 二、最早的想法：进程自己主动让出 CPU

一种很朴素的方式是：

- 程序 A 运行一会儿
- 它主动告诉系统："我先不跑了"
- 然后切到程序 B
- B 再主动让出
- 再切回 A

这叫**主动调度 / 协作式调度**。

## 问题

如果某个程序很"自私"：

- 一直不主动让出 CPU
- 那其他程序就永远没机会运行

所以这种方式不可靠。

---

# 三、于是有了抢占式调度：内核强行拿回 CPU

现代操作系统采用的是**抢占式调度**。

做法是：

- 硬件时钟会周期性产生中断
- 每次时钟中断发生时，内核就有机会检查当前进程
- 如果发现它该停一下了，就强制切换到别的进程

这样即使某个程序不愿意让出 CPU，系统也能把 CPU 抢回来。

## 好处

- 不会因为某个程序"霸占"CPU 导致系统卡死
- 所有进程理论上都有机会运行

## Linux 5.15 的实现

**定义位置**：**`kernel/sched/core.c`**

```c
/*
 * scheduler_tick() - 时钟中断处理函数
 * 
 * 每次时钟中断（默认1000Hz）都会调用这个函数
 * 这是抢占式调度的核心机制
 */
void scheduler_tick(void)
{
    int cpu = smp_processor_id();
    struct rq *rq = cpu_rq(cpu);
    struct task_struct *curr = rq->curr;
    
    /* 更新运行队列时钟 */
    update_rq_clock(rq);
    
    /* 
     * 调用调度类的task_tick方法
     * 这个方法会检查当前进程是否应该被抢占
     */
    curr->sched_class->task_tick(rq, curr, 0);
    
    /* 触发负载均衡 */
    trigger_load_balance(rq);
}
```

**关键点**：
- 时钟中断定期触发（通常每秒1000次）
- 每次中断都给内核一个"检查是否需要切换进程"的机会
- 这就是"抢占"的实现基础

---

# 四、进程并不总是能运行：于是有就绪队列和等待队列

不是所有进程都随时能跑。

例如：

- 有的进程在等磁盘 IO
- 有的进程在 sleep
- 有的进程在等锁
- 有的进程在等网络数据

所以进程通常分成两类：

## 1. 就绪队列（Run Queue）

表示：

- 这个进程现在可以运行
- 只差 CPU

## 2. 等待队列（Wait Queue）

表示：

- 这个进程现在不能运行
- 需要等某个条件满足

比如：

- sleep 到时间了
- IO 完成了
- 锁可用了

条件满足后，它再从等待队列回到就绪队列。

## Linux 5.15 的实现

**定义位置**：**`kernel/sched/sched.h`**

```c
/*
 * struct rq - 运行队列（Run Queue）
 * 
 * 每个CPU都有一个独立的运行队列
 * 这是调度器最核心的数据结构
 */
struct rq {
    /* 锁和时间 */
    raw_spinlock_t          lock;           // 保护运行队列的自旋锁
    unsigned int            nr_running;     // 当前运行队列中的进程数
    u64                     clock;          // 运行队列时钟
    
    /* 各调度类的运行队列 */
    struct cfs_rq           cfs;            // CFS运行队列（普通进程）
    struct rt_rq            rt;             // RT运行队列（实时进程）
    struct dl_rq            dl;             // Deadline运行队列
    
    /* 当前运行的进程 */
    struct task_struct __rcu *curr;         // 当前正在运行的进程
    struct task_struct      *idle;          // 空闲进程
    
    /* CPU信息 */
    int                     cpu;            // CPU编号
    
    /* ... 其他字段 ... */
};

/* 每个CPU都有一个运行队列 */
DEFINE_PER_CPU_SHARED_ALIGNED(struct rq, runqueues);
```

**关键操作**：

```c
/* 获取指定CPU的运行队列 */
#define cpu_rq(cpu)     (&per_cpu(runqueues, (cpu)))

/* 获取当前CPU的运行队列 */
#define this_rq()       (this_cpu_ptr(&runqueues))

/* 获取当前运行的进程 */
#define current         (this_rq()->curr)
```

**进程状态**：

**定义位置**：**`include/linux/sched.h`**

```c
/* 进程状态定义 */
#define TASK_RUNNING            0x0000  // 运行中或就绪
#define TASK_INTERRUPTIBLE      0x0001  // 可中断睡眠（在等待队列中）
#define TASK_UNINTERRUPTIBLE    0x0002  // 不可中断睡眠
#define __TASK_STOPPED          0x0004  // 停止状态
#define __TASK_TRACED           0x0008  // 被跟踪状态

/* 进程状态转换：
 * 
 * TASK_RUNNING (就绪) ←→ TASK_RUNNING (运行中)
 *        ↓                      ↓
 * TASK_INTERRUPTIBLE (等待) ←→ TASK_RUNNING (唤醒)
 */
```

---

# 五、最简单的公平方式：大家轮流跑

一个很自然的想法是：

- 每个进程跑一小段时间
- 到时间就换下一个
- 大家轮流

这就是**时间片轮转**。

例如：

- A 跑 10ms
- B 跑 10ms
- C 跑 10ms
- 再回到 A

## 这个方法解决了什么？

- 不会有某个进程一直独占 CPU
- 所有人都能获得机会

## 但新问题来了

现实中，进程的重要程度不一样。

例如：

- 音频播放进程，响应要快
- 后台压缩程序，慢一点没关系

所以"所有人完全一样"并不合理。

---

# 六、于是引入优先级：重要的进程先跑

系统给每个进程一个**优先级**。

- 优先级高：先运行
- 优先级低：后运行

一个典型做法是：

- 每个优先级对应一个队列
- 调度时，从最高优先级开始找
- 找到第一个非空队列，就从里面选一个进程运行

为了快速知道哪个优先级队列非空，还会用**位图 bitmap** 来加速查找。

## 这样做的好处

- 重要进程能更快得到 CPU
- 系统响应更符合需求

## Linux 5.15 的实时调度器仍然使用这种方式

**定义位置**：**`kernel/sched/rt.c`**

```c
/*
 * RT（实时）调度器使用传统的优先级队列方式
 * 适用于 SCHED_FIFO 和 SCHED_RR 两种实时策略
 */

/* 优先级数组 */
struct rt_prio_array {
    DECLARE_BITMAP(bitmap, MAX_RT_PRIO+1);  // 位图：哪些优先级有进程
    struct list_head queue[MAX_RT_PRIO];    // 每个优先级的进程链表
};

/* RT运行队列 */
struct rt_rq {
    struct rt_prio_array    active;         // 活跃优先级数组
    unsigned int            rt_nr_running;  // RT进程数
    int                     highest_prio;   // 最高优先级缓存
};

/* 选择下一个RT进程 */
static struct sched_rt_entity *pick_next_rt_entity(struct rt_rq *rt_rq)
{
    struct rt_prio_array *array = &rt_rq->active;
    struct sched_rt_entity *next = NULL;
    struct list_head *queue;
    int idx;
    
    /* 找到最高优先级（位图中最低位的1） */
    idx = sched_find_first_bit(array->bitmap);
    
    /* 从该优先级的链表中取第一个进程 */
    queue = array->queue + idx;
    next = list_entry(queue->next, struct sched_rt_entity, run_list);
    
    return next;
}
```

**实时调度策略**：

```c
/*
 * SCHED_FIFO（先进先出）：
 * - 没有时间片，一直运行直到主动放弃或被更高优先级进程抢占
 * - 相同优先级的进程按FIFO顺序运行
 */

/*
 * SCHED_RR（时间片轮转）：
 * - 有时间片，默认100ms
 * - 时间片用完后放到同优先级队列末尾
 * - 相同优先级的进程轮流运行
 */
int sched_rr_timeslice = RR_TIMESLICE;  // 100ms
```

---

# 七、但纯优先级调度会有严重问题：低优先级容易饿死

假设：

- 高优先级队列里永远都有进程
- 调度器每次都优先选高优先级

那结果就是：

- 低优先级进程几乎永远得不到运行机会

这就叫**饥饿（starvation）**。

## 举个例子

- A 是高优先级，一直可运行
- B 是低优先级，也一直想运行

如果调度器规则是"总选最高优先级"

那 A 会一直被选中

B 可能长期没机会

---

# 八、为了缓解这个问题，早期 Linux 用了 active / expired 机制

这是 Linux 早期 O(1) 调度器的重要思路。

## 两组队列

- **active 队列**：当前这一轮还能参与调度的进程
- **expired 队列**：这一轮已经跑过了，先放着，等下一轮

## 调度规则

1. 只从 active 中选进程
2. 进程用完自己的时间片后，不再立刻放回 active
3. 而是放到 expired
4. 当 active 空了，说明这一轮大家都跑过了
5. 交换 active 和 expired，开始下一轮

## 它解决了什么？

它防止某些进程在一轮里反复抢 CPU。

于是即便高优先级进程很强势，

它也不能"刚跑完又马上回来继续抢"。

低优先级进程至少在某些时候能等到机会。

## 但它仍然不完美

因为它更像是：

- "让大家一轮一轮地跑"

而不是：

- "精确地按某种比例公平分 CPU"

---

# 九、接下来要解决一个更深的问题：不是谁先跑，而是谁该分到多少 CPU

这很关键。

前面的优先级队列主要解决的是：

> **谁先运行**

但现代系统更关心的是：

> **在一段时间内，每个进程应该分到多少 CPU 时间**

因为仅仅"先跑"还不够。

比如：

- 一个高优先级进程，不只是想更早启动
- 它通常还应该得到更多 CPU 份额

于是 Linux 后来的思路变成：

> **不同进程按权重（weight）来分配 CPU 份额**

---

# 十、CFS 的目标：尽量模拟"理想公平的 CPU"

CFS 的全名是：

> **Completely Fair Scheduler**
> 完全公平调度器

它想象有一个"理想 CPU"：

- 如果有 n 个同样重要的进程
- 那么每个进程都应得到 1/n 的 CPU

如果进程权重不同，就按权重比例分配。

例如：

- A 权重 1
- B 权重 2
- C 权重 3

那 CPU 时间占比就应该大致是：

- A：1/6
- B：2/6
- C：3/6

这就是 CFS 的根本目标：

> **不是简单轮流，也不是单纯抢高优先级，而是按权重公平分享 CPU。**

---

# 十一、为什么不能只看"实际运行时间"？

假设我们想做到公平，

一个自然想法是：

- 谁运行得少，谁先跑

但这只适用于**所有进程权重都一样**的情况。

如果权重不同，就不能直接看真实运行时间。

## 例子

- A 权重大，本来就应该多跑
- B 权重小，本来就应该少跑

如果：

- A 跑了 20ms
- B 跑了 10ms

不能直接说"B 跑得少，所以该 B 了"

因为也许按它们的权重，这个比例本来就是合理的。

所以必须找到一种方法，把不同权重下的运行时间"折算"到同一标准上比较。

---

# 十二、于是 CFS 引入了 vruntime：虚拟运行时间

这就是 CFS 的核心。

## vruntime 是什么？

它不是进程真实运行了多久，

而是：

> **把实际运行时间按权重修正后的"虚拟运行时间"**

### 规则

- 权重大（优先级高）的进程：
  运行同样的真实时间，vruntime 增长得慢
- 权重小（优先级低）的进程：
  运行同样的真实时间，vruntime 增长得快

## 为什么这么做？

因为高权重进程本来就应该多拿 CPU，

所以它即使跑了较多真实时间，也不应该很快被认为"跑过头"。

而低权重进程本来就应该少拿 CPU，

所以它稍微跑一点，公平账本上就应该增长得更快。

## Linux 5.15 的实现

**定义位置**：**`include/linux/sched.h`**

```c
/*
 * struct sched_entity - CFS调度实体
 * 
 * 每个进程都有一个sched_entity，用于CFS调度
 */
struct sched_entity {
    /* 负载权重 */
    struct load_weight      load;           // 进程权重
    struct rb_node          run_node;       // 红黑树节点
    unsigned int            on_rq;          // 是否在运行队列
    
    /* 时间统计 */
    u64                     exec_start;     // 开始执行时间
    u64                     sum_exec_runtime;   // 累计执行时间（真实时间）
    u64                     vruntime;       // 虚拟运行时间（核心！）
    u64                     prev_sum_exec_runtime;
    
    /* 组调度相关 */
    struct sched_entity     *parent;        // 父调度实体
    struct cfs_rq           *cfs_rq;        // 所属的CFS运行队列
    
    /* 利用率追踪 */
    struct sched_avg        avg;            // 平均负载和利用率
};
```

**权重与优先级的映射**：

**定义位置**：**`kernel/sched/core.c`**

```c
/*
 * nice值到权重的映射表
 * 
 * nice值的范围：-20 到 +19
 * nice值越小，优先级越高，权重越大
 */
const int sched_prio_to_weight[40] = {
 /* -20 */     88761,     71755,     56483,     46273,     36291,
 /* -15 */     29154,     23254,     18705,     14949,     11916,
 /* -10 */      9548,      7620,      6100,      4904,      3906,
 /*  -5 */      3121,      2501,      1991,      1586,      1277,
 /*   0 */      1024,       820,       655,       526,       423,
 /*   5 */       335,       272,       215,       172,       137,
 /*  10 */       110,        87,        70,        56,        45,
 /*  15 */        36,        29,        23,        18,        15,
};

/* nice 0 的权重（基准权重） */
#define NICE_0_LOAD     1024
```

**权重计算示例**：

```
nice 0  → 权重 1024 → vruntime增长速度 = 1.0
nice -5 → 权重 3121 → vruntime增长速度 = 1024/3121 ≈ 0.33
nice 5  → 权重 335  → vruntime增长速度 = 1024/335 ≈ 3.06

结论：
- nice值越小（优先级越高），权重越大，vruntime增长越慢
- 这意味着高优先级进程可以获得更多CPU时间
```

**vruntime 的计算**：

**定义位置**：**`kernel/sched/fair.c`**

```c
/*
 * calc_delta_fair - 计算虚拟运行时间增量
 * 
 * 参数：
 *   delta - 实际运行时间增量
 *   se - 调度实体
 * 
 * 返回：
 *   虚拟运行时间增量
 * 
 * 计算公式：
 *   vruntime_delta = delta_exec * (NICE_0_LOAD / weight)
 * 
 * 这意味着：
 * - 权重越大，vruntime增长越慢
 * - 权重越小，vruntime增长越快
 */
static inline u64 calc_delta_fair(u64 delta, struct sched_entity *se)
{
    /* 如果权重是NICE_0_LOAD（基准权重），直接返回delta */
    if (unlikely(se->load.weight != NICE_0_LOAD))
        delta = __calc_delta(delta, NICE_0_LOAD, &se->load);
    
    return delta;
}

/*
 * __calc_delta - 实际计算函数
 * 
 * 为了避免浮点运算，使用位移和乘法：
 *   vruntime_delta = delta_exec * weight * inv_weight >> WMULT_SHIFT
 */
static u64 __calc_delta(u64 delta_exec, unsigned long weight, struct load_weight *lw)
{
    u64 fact = scale_load_down(weight);
    u32 fact_hi = (u32)(fact >> 32);
    int shift = WMULT_SHIFT;
    u64 vruntime;
    
    /* 计算逆权重 */
    __update_inv_weight(lw);
    
    if (unlikely(fact_hi)) {
        fact = mul_u32_u32(fact, lw->inv_weight);
        while (fact >> 32) {
            fact >>= 1;
            shift--;
        }
    } else {
        fact = mul_u32_u32(fact, lw->inv_weight);
    }
    
    vruntime = delta_exec * fact;
    
    if (shift)
        vruntime >>= shift;
    
    return vruntime;
}
```

**更新当前进程的 vruntime**：

```c
/*
 * update_curr - 更新当前进程的时间统计
 * 
 * 这个函数在每次调度时都会调用
 * 它负责更新当前进程的vruntime
 */
static void update_curr(struct cfs_rq *cfs_rq)
{
    struct sched_entity *curr = cfs_rq->curr;
    u64 now = rq_clock_task(rq_of(cfs_rq));
    u64 delta_exec;
    
    if (unlikely(!curr))
        return;
    
    /* 计算本次运行的时间 */
    delta_exec = now - curr->exec_start;
    if (unlikely((s64)delta_exec <= 0))
        return;
    
    /* 更新开始时间 */
    curr->exec_start = now;
    
    /* 更新累计执行时间 */
    curr->sum_exec_runtime += delta_exec;
    
    /* 更新vruntime（核心！） */
    curr->vruntime += calc_delta_fair(delta_exec, curr);
    
    /* 更新min_vruntime */
    update_min_vruntime(cfs_rq);
}
```

---

# 十三、CFS 的核心规则：总是选 vruntime 最小的进程

这是最关键的一句话。

> **谁的 vruntime 最小，谁就最该运行。**

因为 vruntime 小说明：

- 这个进程相对于自己应得的 CPU 份额来说
- 目前"跑得还不够"
- 所以应该优先补给它 CPU

vruntime 大说明：

- 它最近已经相对跑得比较多了
- 可以先让别人运行

## Linux 5.15 的实现

**定义位置**：**`kernel/sched/fair.c`**

```c
/*
 * pick_next_task_fair - 选择下一个要运行的进程
 * 
 * 这是CFS调度器的核心函数
 * 它从CFS运行队列中选择vruntime最小的进程
 */
static struct task_struct *
pick_next_task_fair(struct rq *rq, struct task_struct *prev, struct rq_flags *rf)
{
    struct cfs_rq *cfs_rq = &rq->cfs;
    struct sched_entity *se;
    struct task_struct *p;
    
    /* 如果没有可运行的进程，返回NULL */
    if (!cfs_rq->nr_running)
        goto idle;
    
    /* 选择vruntime最小的进程 */
    do {
        se = pick_next_entity(cfs_rq, NULL);
        set_next_entity(cfs_rq, se);
        cfs_rq = group_cfs_rq(se);
    } while (cfs_rq);
    
    p = task_of(se);
    
    return p;
    
idle:
    /* 尝试从其他CPU拉取任务 */
    return NULL;
}

/*
 * pick_next_entity - 从CFS队列中选择下一个调度实体
 * 
 * 核心逻辑：选择vruntime最小的进程
 */
static struct sched_entity *
pick_next_entity(struct cfs_rq *cfs_rq, struct sched_entity *curr)
{
    struct sched_entity *left = __pick_first_entity(cfs_rq);
    struct sched_entity *se;
    
    /*
     * 如果curr不在运行队列上，left就是候选
     * 否则需要比较curr和left的vruntime
     */
    if (!left || (curr && entity_before(curr, left)))
        left = curr;
    
    se = left;
    
    return se;
}

/*
 * __pick_first_entity - 从红黑树中获取最左节点
 * 
 * 最左节点就是vruntime最小的进程
 */
static struct sched_entity *__pick_first_entity(struct cfs_rq *cfs_rq)
{
    struct rb_node *left = rb_first_cached(&cfs_rq->tasks_timeline);
    
    if (!left)
        return NULL;
    
    return rb_entry(left, struct sched_entity, run_node);
}

/*
 * entity_before - 比较两个实体的vruntime
 * 
 * 返回true表示a的vruntime小于b
 */
static inline bool entity_before(struct sched_entity *a, struct sched_entity *b)
{
    return (s64)(a->vruntime - b->vruntime) < 0;
}
```

---

# 十四、为什么这能自然照顾 IO 型/交互型进程？

这是 CFS 很漂亮的一点。

有些进程不是一直占 CPU，

而是经常：

- 运行一点点
- 然后去等 IO
- 或者睡眠
- 等条件满足后再回来

这些进程在等待期间：

- 不消耗 CPU
- 所以 vruntime 不会增长

而 CPU 密集型进程一直在跑：

- vruntime 会不断增长

于是当 IO 型进程醒来时，

它的 vruntime 往往还比较小，

调度器就会较快让它运行。

## 结果

- 交互型程序响应更好
- 用户体验更流畅

所以 CFS 对这类任务的"照顾"，

不是靠硬编码奖励，

而是公平机制自然产生的结果。

## Linux 5.15 的实现

```c
/*
 * enqueue_task_fair - 将进程加入运行队列
 * 
 * 当进程从等待队列醒来时，调用这个函数
 * 
 * 关键点：
 * - 进程在等待期间vruntime不会增长
 * - 醒来时vruntime往往比较小
 * - 所以能较快得到CPU
 */
static void
enqueue_task_fair(struct rq *rq, struct task_struct *p, int flags)
{
    struct cfs_rq *cfs_rq;
    struct sched_entity *se = &p->se;
    
    /* 从叶子节点向上遍历到根节点 */
    for_each_sched_entity(se) {
        if (se->on_rq)
            break;
        
        cfs_rq = cfs_rq_of(se);
        enqueue_entity(cfs_rq, se, flags);
        
        /* 更新负载和利用率 */
        update_load_avg(cfs_rq, se, UPDATE_TG);
        update_cfs_group(se);
    }
    
    /* 更新运行队列统计 */
    add_nr_running(rq, 1);
}

/*
 * enqueue_entity - 将调度实体加入CFS队列
 * 
 * 关键：进程醒来时vruntime不会重置
 * 它保持之前的值，所以能自然地获得优先权
 */
static void
enqueue_entity(struct cfs_rq *cfs_rq, struct sched_entity *se, int flags)
{
    bool renorm = !(flags & ENQUEUE_WAKEUP) || (flags & ENQUEUE_MIGRATED);
    bool curr = cfs_rq->curr == se;
    
    /* 更新当前进程的时间统计 */
    if (curr)
        update_curr(cfs_rq);
    
    /* 
     * 如果是唤醒操作，可能需要调整vruntime
     * 但通常保持原值，让IO型进程自然获得优先权
     */
    if (renorm && !curr)
        place_entity(cfs_rq, se, 0);
    
    /* 更新负载和利用率 */
    update_load_avg(cfs_rq, se, UPDATE_TG | DO_ATTACH);
    account_entity_enqueue(cfs_rq, se);
    
    /* 加入红黑树 */
    if (!curr)
        __enqueue_entity(cfs_rq, se);
    
    se->on_rq = 1;
}
```

---

# 十五、为什么要用红黑树？

既然 CFS 的规则是：

> 总是选择 vruntime 最小的进程

那就要有一种数据结构，能高效地完成：

- 插入一个可运行进程
- 删除一个进程
- 快速找到 vruntime 最小的进程

普通链表不适合，因为每次都得遍历找最小值。

所以 CFS 选择了**红黑树**：

- 每个可运行进程按 vruntime 排序放入树中
- 最左边的节点就是 vruntime 最小的进程
- 调度时直接取它

## 好处

- 插入、删除效率高：O(log n)
- 查找最小值也高效：O(1)
- 适合 runnable 进程很多的场景

## Linux 5.15 的实现

**定义位置**：**`kernel/sched/sched.h`**

```c
/*
 * struct cfs_rq - CFS运行队列
 * 
 * 使用红黑树组织所有可运行进程
 */
struct cfs_rq {
    /* 负载和进程数 */
    struct load_weight      load;           // 总负载
    unsigned int            nr_running;     // 运行进程数
    
    /* 虚拟时间 */
    u64                     min_vruntime;   // 最小虚拟运行时间
    
    /* 红黑树（核心数据结构） */
    struct rb_root_cached   tasks_timeline; // 红黑树根节点
    
    /* 当前进程 */
    struct sched_entity     *curr;          // 当前运行的进程
    
    /* ... 其他字段 ... */
};
```

**红黑树操作**：

```c
/*
 * __enqueue_entity - 将实体加入红黑树
 * 
 * 按vruntime排序插入
 */
static void __enqueue_entity(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
    rb_add_cached(&se->run_node, &cfs_rq->tasks_timeline, __entity_less);
}

/*
 * __entity_less - 红黑树比较函数
 * 
 * 比较两个实体的vruntime
 */
static bool __entity_less(struct rb_node *a, const struct rb_node *b)
{
    return entity_before(__node_2_se(a), __node_2_se(b));
}

/*
 * __dequeue_entity - 从红黑树中移除实体
 */
static void __dequeue_entity(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
    rb_erase_cached(&se->run_node, &cfs_rq->tasks_timeline);
}
```

**红黑树的优势**：

```
CFS使用红黑树组织所有可运行进程：

         [vruntime=50]
              /\
             /  \
    [vruntime=30]  [vruntime=70]
        /  \            /\
       /    \          /  \
   [20]    [40]    [60]  [80]

- 树的左子节点：vruntime较小的进程
- 树的右子节点：vruntime较大的进程
- 最左节点：vruntime最小的进程（最需要运行）

优势：
- 插入/删除：O(log n)
- 查找最小值：O(1)（缓存最左节点）
- 自动保持平衡
```

---

# 十六、那优先级去哪了？是不是 CFS 完全不看优先级？

不是。

在 CFS 中，普通进程并不是像旧调度器那样：

- 直接按优先级队列排队
- 再从最高优先级队列选人

而是：

> **优先级先转换成权重，权重再影响 vruntime 的增长速度**

所以你可以理解为：

- 旧方法：优先级直接决定"你排哪个队列"
- CFS 方法：优先级不直接排队，而是影响"你公平记账的速度"

因此：

- CFS 直接看的确是 vruntime
- 但优先级并没有消失
- 它是通过 weight 间接发挥作用的

## Linux 5.15 的实现

```c
/*
 * nice值到权重的转换
 * 
 * nice值范围：-20 到 +19
 * nice值越小，优先级越高，权重越大
 * 
 * 权重影响vruntime的增长速度：
 * - 权重大 → vruntime增长慢 → 获得更多CPU时间
 * - 权重小 → vruntime增长快 → 获得较少CPU时间
 */

/* nice值到权重的映射表 */
const int sched_prio_to_weight[40] = {
 /* -20 */     88761,     71755,     56483,     46273,     36291,
 /* -15 */     29154,     23254,     18705,     14949,     11916,
 /* -10 */      9548,      7620,      6100,      4904,      3906,
 /*  -5 */      3121,      2501,      1991,      1586,      1277,
 /*   0 */      1024,       820,       655,       526,       423,
 /*   5 */       335,       272,       215,       172,       137,
 /*  10 */       110,        87,        70,        56,        45,
 /*  15 */        36,        29,        23,        18,        15,
};

/*
 * 设置进程的nice值
 * 
 * nice值会影响进程的权重
 * 权重会影响vruntime的增长速度
 */
static void set_load_weight(struct task_struct *p, bool update_load)
{
    int prio = p->static_prio - MAX_RT_PRIO;
    struct load_weight *load = &p->se.load;
    
    /*
     * nice值转换为权重
     * prio范围：0-39（对应nice值-20到+19）
     */
    load->weight = scale_load(sched_prio_to_weight[prio]);
    load->inv_weight = sched_prio_to_wmult[prio];
}
```

---

# 十七、CFS 为什么比旧方法更好？

因为它解决问题更自然、更统一。

## 旧方法的问题

旧式优先级队列 + 时间片 + active/expired：

- 更偏"分轮次"
- 更像"规则拼接"
- 需要很多启发式修补
- 很难精准表达"按权重公平分配 CPU"

## CFS 的优势

CFS 把很多问题统一到了一个指标上：

- 谁应得多少 CPU —— 通过权重表达
- 谁已经跑了多少 —— 通过 vruntime 记录
- 谁该先跑 —— 选 vruntime 最小者
- 睡眠后是否该尽快响应 —— 自然由 vruntime 体现

这就比"一个个补丁规则"更优雅。

## Linux 5.15 的关键参数

**定义位置**：**`kernel/sched/fair.c`**

```c
/*
 * 目标调度延迟（目标延迟）
 * 
 * 默认：6ms * (1 + ilog(ncpus))
 * 
 * 这是系统中所有可运行进程运行一轮的理想时间
 * 
 * 例如：如果有8个进程，目标延迟是6ms
 * 那么每个进程大约能获得 6ms/8 = 0.75ms 的时间片
 */
unsigned int sysctl_sched_latency = 6000000ULL;

/*
 * 最小调度粒度
 * 
 * 默认：0.75ms * (1 + ilog(ncpus))
 * 
 * 单个进程最少运行的时间
 * 防止进程切换过于频繁
 */
unsigned int sysctl_sched_min_granularity = 750000ULL;

/*
 * 唤醒抢占粒度
 * 
 * 默认：1ms * (1 + ilog(ncpus))
 * 
 * 唤醒的进程可以抢占当前进程的条件
 */
unsigned int sysctl_sched_wakeup_granularity = 1000000UL;
```

**时间片的计算**：

```c
/*
 * 计算进程的时间片
 * 
 * 时间片 = 目标延迟 / 进程数
 * 
 * 但不能小于最小调度粒度
 */
static u64 sched_slice(struct cfs_rq *cfs_rq, struct sched_entity *se)
{
    unsigned int nr_running = cfs_rq->nr_running;
    u64 slice;
    
    if (sched_feat(GENTLE_FAIR_SLEEPERS))
        nr_running = max(4UL, nr_running);
    
    slice = sysctl_sched_latency;
    
    if (sched_feat(ALT_PERIOD))
        slice = __sched_period(nr_running + !se->on_rq);
    
    /* 按权重分配时间片 */
    slice = div_u64(slice * se->load.weight, cfs_rq->load.weight);
    
    /* 不能小于最小粒度 */
    slice = max_t(u64, slice, sysctl_sched_min_granularity);
    
    return slice;
}
```

---

# 十八、核心调度函数：schedule()

现在我们来看整个调度流程是如何工作的。

## Linux 5.15 的实现

**定义位置**：**`kernel/sched/core.c`**

```c
/*
 * schedule() - 主调度函数
 * 
 * 这是调度器的入口点
 * 进程主动调用或被抢占时都会调用这个函数
 */
asmlinkage __visible void __sched schedule(void)
{
    struct task_struct *tsk = current;
    
    /* 提交RCU回调 */
    sched_submit_work(tsk);
    
    do {
        /* 禁止抢占 */
        preempt_disable();
        
        /* 核心调度函数 */
        __schedule(SM_NONE);
        
        /* 启用抢占 */
        sched_preempt_enable_no_resched();
        
    } while (need_resched());
    
    /* 更新阻塞时间统计 */
    sched_update_worker(tsk);
}
EXPORT_SYMBOL(schedule);

/*
 * __schedule() - 核心调度逻辑
 * 
 * 这是调度器的核心实现
 */
static void __sched notrace __schedule(unsigned int sched_mode)
{
    struct task_struct *prev, *next;
    unsigned long prev_state;
    struct rq_flags rf;
    struct rq *rq;
    int cpu;
    
    /* 获取当前CPU和运行队列 */
    cpu = smp_processor_id();
    rq = cpu_rq(cpu);
    prev = rq->curr;
    
    /* 获取运行队列锁 */
    rq_lock(rq, &rf);
    
    /* 更新运行队列时钟 */
    update_rq_clock(rq);
    
    /* 获取prev进程的状态 */
    prev_state = READ_ONCE(prev->__state);
    
    /* 如果prev是不可运行的，将其从运行队列移除 */
    if (!(sched_mode & SM_MASK_PREEMPT) && prev_state) {
        if (signal_pending_state(prev_state, prev)) {
            WRITE_ONCE(prev->__state, TASK_RUNNING);
        } else {
            /* 从运行队列移除 */
            deactivate_task(rq, prev, DEQUEUE_SLEEP | DEQUEUE_NOCLOCK);
        }
    }
    
    /* 选择下一个要运行的进程 */
    next = pick_next_task(rq, prev, &rf);
    
    /* 清除重新调度标志 */
    clear_tsk_need_resched(prev);
    clear_preempt_need_resched();
    
    /* 如果next和prev相同，直接返回 */
    if (likely(prev != next)) {
        /* 更新统计信息 */
        rq->nr_switches++;
        rq->curr = next;
        
        /* 执行上下文切换 */
        rq = context_switch(rq, prev, next, &rf);
    } else {
        /* 释放运行队列锁 */
        rq_unlock_irq(rq, &rf);
    }
}

/*
 * pick_next_task() - 选择下一个要运行的进程
 * 
 * 从所有调度类中选择优先级最高的进程
 */
static inline struct task_struct *
__pick_next_task(struct rq *rq, struct task_struct *prev, struct rq_flags *rf)
{
    const struct sched_class *class;
    struct task_struct *p;
    
    /*
     * 快速路径：如果所有进程都是CFS进程，
     * 直接调用CFS的选择函数
     */
    if (likely(prev->sched_class <= &fair_sched_class &&
               rq->nr_running == rq->cfs.h_nr_running)) {
        
        p = pick_next_task_fair(rq, prev, rf);
        if (unlikely(p == RETRY_TASK))
            goto restart;
        
        /* 如果没有CFS进程，选择idle进程 */
        if (!p) {
            put_prev_task(rq, prev);
            p = pick_next_task_idle(rq);
        }
        
        return p;
    }
    
restart:
    /* 慢速路径：遍历所有调度类 */
    put_prev_task_balance(rq, prev, rf);
    
    /* 从高到低遍历调度类 */
    for_each_class(class) {
        p = class->pick_next_task(rq);
        if (p)
            return p;
    }
    
    /* 至少应该有idle进程 */
    BUG();
}
```

---

# 十九、上下文切换：context_switch()

选择好下一个进程后，需要进行上下文切换。

## Linux 5.15 的实现

```c
/*
 * context_switch() - 上下文切换
 * 
 * 切换到新进程，包括：
 * 1. 内存管理上下文切换
 * 2. 寄存器和栈切换
 */
static __always_inline struct rq *
context_switch(struct rq *rq, struct task_struct *prev,
               struct task_struct *next, struct rq_flags *rf)
{
    struct mm_struct *mm, *oldmm;
    
    /* 准备任务切换 */
    prepare_task_switch(rq, prev, next);
    
    /* 获取内存管理信息 */
    mm = next->mm;
    oldmm = prev->active_mm;
    
    /*
     * 内核线程没有用户空间地址空间
     * 
     * 情况1：内核线程 -> 内核线程
     *   - 懒惰TLB，直接继承active_mm
     * 
     * 情况2：用户进程 -> 内核线程
     *   - 懒惰TLB，继承用户进程的active_mm
     * 
     * 情况3：内核线程 -> 用户进程
     *   - 切换到用户进程的mm
     * 
     * 情况4：用户进程 -> 用户进程
     *   - 正常切换mm
     */
    if (!mm) {
        /* next是内核线程 */
        enter_lazy_tlb(prev->active_mm, next);
        
        next->active_mm = prev->active_mm;
        if (prev->mm)
            mmgrab(prev->active_mm);
        else
            prev->active_mm = NULL;
    } else {
        /* next是用户进程 */
        membarrier_switch_mm(rq, prev->active_mm, next->mm);
        
        /* 切换内存管理上下文 */
        switch_mm_irqs_off(prev->active_mm, next->mm, next);
        
        if (!prev->mm) {
            /* prev是内核线程 */
            rq->prev_mm = prev->active_mm;
            prev->active_mm = NULL;
        }
    }
    
    /* 
     * 这里切换寄存器状态和栈
     * switch_to是一个宏，最终调用架构相关的汇编代码
     */
    switch_to(prev, next, prev);
    barrier();
    
    /* 完成任务切换 */
    return finish_task_switch(prev);
}
```

---

# 二十、调度类架构：支持多种调度策略

Linux 5.15 采用模块化的调度类架构，支持多种调度策略。

## 调度类层次结构

```
调度类优先级（从高到低）：
┌─────────────────────────┐
│   stop_sched_class      │  最高优先级，用于CPU热插拔等关键操作
├─────────────────────────┤
│   dl_sched_class        │  Deadline调度，保证实时任务的截止时间
├─────────────────────────┤
│   rt_sched_class        │  实时调度（SCHED_FIFO/SCHED_RR）
├─────────────────────────┤
│   fair_sched_class      │  CFS完全公平调度（SCHED_NORMAL）
├─────────────────────────┤
│   idle_sched_class      │  空闲调度，当没有其他任务时运行
└─────────────────────────┘
```

## Linux 5.15 的实现

**定义位置**：**`kernel/sched/sched.h`**

```c
/*
 * struct sched_class - 调度类
 * 
 * 每个调度类都实现这个接口
 */
struct sched_class {
    /* 下一个调度类（优先级更低） */
    const struct sched_class *next;
    
    /* 入队和出队 */
    void (*enqueue_task) (struct rq *rq, struct task_struct *p, int flags);
    void (*dequeue_task) (struct rq *rq, struct task_struct *p, int flags);
    
    /* 选择下一个要运行的进程 */
    struct task_struct *(*pick_next_task)(struct rq *rq);
    
    /* 放回当前进程 */
    void (*put_prev_task)(struct rq *rq, struct task_struct *p);
    
    /* 时间片处理 */
    void (*task_tick)(struct rq *rq, struct task_struct *p, int queued);
    
    /* ... 其他方法 ... */
};

/* 从高到低遍历所有调度类 */
#define for_each_class(class) \
    for (class = highest_sched_class(); class; class = class->next)
```

**调度类的作用**：

```c
/*
 * 调度类的作用：
 * 
 * 1. stop_sched_class：
 *    - 最高优先级
 *    - 用于CPU热插拔等关键操作
 *    - 每个CPU只有一个stop任务
 * 
 * 2. dl_sched_class：
 *    - Deadline调度
 *    - 基于EDF算法
 *    - 保证实时任务的截止时间
 * 
 * 3. rt_sched_class：
 *    - 实时调度
 *    - SCHED_FIFO：先进先出，无时间片
 *    - SCHED_RR：时间片轮转
 * 
 * 4. fair_sched_class：
 *    - CFS完全公平调度
 *    - 适用于普通进程
 *    - 基于vruntime的公平调度
 * 
 * 5. idle_sched_class：
 *    - 最低优先级
 *    - 当没有其他进程可运行时执行
 */
```

---

# 二十一、多核与负载均衡

在多核系统中，调度器还需要考虑负载均衡。

## 调度域层次结构

```
                    All CPUs (NUMA节点）
                        │
                ┌───────┴───────┐
                │   NUMA Node   │  sd_numa
                └───────┬───────┘
                        │
            ┌───────────┼───────────┐
            │           │           │
        ┌───┴───┐   ┌───┴───┐   ┌───┴───┐
        │Socket │   │Socket │   │Socket │  sd_socket
        └───┬───┘   └───┬───┘   └───┬───┘
            │           │           │
        ┌───┴───┐   ┌───┴───┐   ┌───┴───┐
        │  LLC  │   │  LLC  │   │  LLC  │  sd_llc (Last Level Cache)
        └───┬───┘   └───┬───┘   └───┬───┘
            │           │           │
        ┌───┴───┐   ┌───┴───┐   ┌───┴───┐
        │  CPU  │   │  CPU  │   │  CPU  │
        └───────┘   └───────┘   └───────┘
```

## Linux 5.15 的实现

**定义位置**：**`include/linux/sched/topology.h`**

```c
/*
 * struct sched_domain - 调度域
 * 
 * 调度域定义了CPU的层次结构
 * 负载均衡在调度域内进行
 */
struct sched_domain {
    /* 层次结构 */
    struct sched_domain     *parent;        // 父调度域
    struct sched_domain     *child;         // 子调度域
    struct sched_group      *groups;        // 调度组
    
    /* 负载均衡参数 */
    unsigned long           min_interval;   // 最小均衡间隔
    unsigned long           max_interval;   // 最大均衡间隔
    unsigned int            imbalance_pct;  // 不平衡百分比
    
    /* 标志 */
    int                     flags;          // 调度域标志
    int                     level;          // 层级
    
    /* 负载均衡状态 */
    unsigned long           last_balance;   // 上次均衡时间
    unsigned int            balance_interval; // 均衡间隔
    
    /* ... */
};
```

**负载均衡流程**：

```c
/*
 * 负载均衡触发时机：
 * 1. 时钟中断（scheduler_tick）
 * 2. CPU进入idle（idle_balance）
 * 3. 进程唤醒（select_task_rq）
 */

/* 触发负载均衡 */
void trigger_load_balance(struct rq *rq)
{
    int cpu = cpu_of(rq);
    
    /* 检查是否需要均衡 */
    if (time_after_eq(jiffies, rq->next_balance))
        raise_softirq(SCHED_SOFTIRQ);
}
```

---

# 二十二、高级特性：PELT、组调度、EAS

## 1. PELT（Per-Entity Load Tracking）

**定义位置**：**`kernel/sched/pelt.c`**

```c
/*
 * PELT：每个实体的负载追踪
 * 
 * 核心思想：
 * - 每个调度实体（进程、组）维护自己的负载和利用率
 * - 使用指数衰减平均，近期负载权重更高
 * - 周期：约1ms（1024us）
 */

struct sched_avg {
    u64                     last_update_time;   // 上次更新时间
    u64                     load_sum;           // 负载累积和
    u64                     runnable_sum;       // 可运行时间累积和
    u32                     util_sum;           // 利用率累积和
    
    unsigned long           load_avg;           // 平均负载
    unsigned long           runnable_avg;       // 平均可运行时间
    unsigned long           util_avg;           // 平均利用率
};

/*
 * 负载计算公式：
 * load_avg = load_sum / divider
 * 
 * 其中：
 * load_sum = Σ (load_i * y^i)
 * y = 0.978 (衰减因子，约等于每秒衰减50%)
 */
```

## 2. 组调度（Group Scheduling）

```c
/*
 * 组调度：将进程分组，组之间公平调度
 * 
 * 用途：
 * - 用户级公平：不同用户的进程组公平竞争
 * - 容器：不同容器的进程组公平竞争
 */

struct task_group {
    struct cgroup_subsys_state css;
    
    /* CFS相关 */
    struct sched_entity **se;     // 每个CPU的调度实体
    struct cfs_rq **cfs_rq;       // 每个CPU的CFS队列
    unsigned long shares;         // 权重份额
    
    struct task_group *parent;
    struct list_head siblings;
    struct list_head children;
};

/*
 * 组调度示例：
 * 
 * 用户A（shares=1024）：
 *   进程A1, A2, A3
 * 
 * 用户B（shares=2048）：
 *   进程B1, B2
 * 
 * 结果：用户B获得2倍于用户A的CPU时间
 */
```

## 3. 能效感知调度（EAS）

```c
/*
 * EAS：Energy Aware Scheduling
 * 
 * 目的：
 * - 在异构CPU系统（如big.LITTLE）上优化能耗
 * - 根据任务特性选择合适的CPU
 */

static int find_energy_efficient_cpu(struct task_struct *p, int prev_cpu)
{
    /* 遍历所有性能域，计算能耗 */
    /* 选择能耗最低的CPU */
}
```

---

# 二十三、初学者可以这样记住 CFS 的完整逻辑

你可以把它背成下面这条链：

### 1. CPU 一次只能运行一个进程

所以必须调度。

### 2. 不能靠进程自己让出

所以使用抢占式调度。

### 3. 可运行进程在就绪队列，不可运行的进程在等待队列

等待条件满足后再回来。

### 4. 早期先用时间片轮转

但所有进程一视同仁不合理。

### 5. 于是加优先级

但纯优先级调度会导致低优先级饿死。

### 6. 早期 Linux 用 active/expired 缓解问题

让一轮中跑过的进程先别回来。

### 7. 但系统真正需要的是"按权重公平分 CPU"

而不是只决定谁先跑。

### 8. CFS 引入权重和 vruntime

把不同优先级下的运行量折算到统一标准。

### 9. 调度器总选 vruntime 最小的进程

因为它相对自己应得份额跑得最少。

### 10. 用红黑树维护所有可运行进程

高效找到最小 vruntime 的那个。

---

# 二十四、一句话总结 CFS

> **CFS 的核心思想是：让所有普通可运行进程按权重公平地分享 CPU。**
> 
> 它通过给每个进程维护一个虚拟运行时间 vruntime，把不同优先级带来的时间份额差异折算到统一标准上；调度时总是选择 vruntime 最小的进程运行，并用红黑树高效维护这些进程的有序关系。

---

# 二十五、Linux 5.15 调度器的关键特性总结

| 特性 | 说明 | 优势 |
|------|------|------|
| **CFS** | 完全公平调度器 | 真正的公平性，优秀的交互响应 |
| **多调度类** | stop/dl/rt/fair/idle | 支持多种工作负载 |
| **红黑树** | CFS进程组织 | O(log n)的选择效率 |
| **PELT** | 每实体负载追踪 | 精确的负载和利用率统计 |
| **SMP负载均衡** | 多层次调度域 | 高效的多核利用 |
| **组调度** | 进程组公平调度 | 用户/容器级公平性 |
| **EAS** | 能效感知调度 | 异构CPU能耗优化 |
| **实时调度** | FIFO/RR/Deadline | 实时任务保证 |

---

## 参考资料

### 源码文件

- **`kernel/sched/core.c`** - 核心调度器
- **`kernel/sched/fair.c`** - CFS调度器
- **`kernel/sched/rt.c`** - RT调度器
- **`kernel/sched/deadline.c`** - Deadline调度器
- **`kernel/sched/sched.h`** - 调度器头文件
- **`include/linux/sched.h`** - 进程描述符

### 文档

- Documentation/scheduler/sched-design-CFS.rst
- Documentation/scheduler/sched-rt-group.rst
- Documentation/scheduler/sched-deadline.rst

---

**文档版本**: 2.0  
**创建日期**: 2026-05-07  
**基于内核版本**: Linux 5.15.204
