# Linux 5.15 网络设备模块详解

## 一、网络设备模块概述

### 1.1 什么是网络设备模块？

网络设备模块是 Linux 内核网络协议栈的最底层，它负责与物理网络硬件进行交互。如果把整个网络协议栈比作一座建筑，那么网络设备模块就是这座建筑的地基——所有的网络数据包都必须经过这里才能进出系统。

### 1.2 为什么需要网络设备模块？

想象一下，如果没有统一的网络设备模块，会发生什么？

- **驱动混乱**：每个网卡厂商都需要自己实现完整的协议栈，代码重复且难以维护
- **接口不统一**：不同网卡的配置方式各异，用户无法使用统一的工具（如 ifconfig、ip）管理
- **功能难以扩展**：添加新功能（如流量控制、QoS）需要修改所有驱动

Linux 通过引入网络设备抽象层，解决了这些问题：
- 提供统一的 `net_device` 结构体表示网络设备
- 定义标准的 `net_device_ops` 操作接口
- 实现 NAPI 机制提高数据包处理效率

### 1.3 网络设备模块在协议栈中的位置

```
┌─────────────────────────────────────────┐
│           用户空间应用程序                │
└─────────────────────────────────────────┘
                    ↑↓ 系统调用
┌─────────────────────────────────────────┐
│           Socket 层 (socket/sock)        │
└─────────────────────────────────────────┘
                    ↑↓
┌─────────────────────────────────────────┐
│           传输层 (TCP/UDP)               │
└─────────────────────────────────────────┘
                    ↑↓
┌─────────────────────────────────────────┐
│           网络层 (IP/ICMP)               │
└─────────────────────────────────────────┘
                    ↑↓
┌─────────────────────────────────────────┐
│        网络设备模块 (net_device)         │  ← 本文档重点
└─────────────────────────────────────────┘
                    ↑↓
┌─────────────────────────────────────────┐
│           网卡驱动程序                   │
└─────────────────────────────────────────┘
                    ↑↓
┌─────────────────────────────────────────┐
│           物理网络硬件                   │
└─────────────────────────────────────────┘
```

---

## 二、net_device 结构体详解

### 2.1 什么是 net_device？

`net_device` 是内核中用来表示一个网络设备的核心数据结构。无论是物理网卡（如 eth0）、虚拟设备（如 lo、docker0），还是隧道设备（如 tun0），在内核中都由一个 `net_device` 结构体来表示。

### 2.2 net_device 结构体的设计思路

让我们思考一下，如果要设计一个能表示各种网络设备的结构体，需要包含哪些信息？

1. **设备标识**：名字、索引号、MAC 地址
2. **设备状态**：是否启动、是否连接
3. **配置参数**：MTU、队列数量
4. **操作接口**：如何发送/接收数据包
5. **统计信息**：收发包数量、错误计数
6. **功能特性**：支持哪些硬件卸载功能

### 2.3 net_device 结构体定义

```c
struct net_device {
    char            name[IFNAMSIZ];          // 设备名称，如 "eth0"
    struct netdev_name_node *name_node;      // 名称哈希节点
    struct dev_ifalias __rcu *ifalias;       // 接口别名

    unsigned long   mem_end;                 // 设备内存结束地址
    unsigned long   mem_start;               // 设备内存起始地址
    unsigned long   base_addr;               // 设备 I/O 基地址

    unsigned long   state;                   // 设备状态位图

    struct list_head dev_list;               // 全局设备链表
    struct list_head napi_list;              // NAPI 实例链表
    struct list_head unreg_list;             // 注销链表
    struct list_head close_list;             // 关闭链表
    struct list_head ptype_all;              // 协议类型链表（抓包用）
    struct list_head ptype_specific;         // 特定协议链表

    struct {
        struct list_head upper;              // 上层设备链表（bonding等）
        struct list_head lower;              // 下层设备链表
    } adj_list;

    unsigned int    flags;                   // 接口标志（IFF_UP等）
    unsigned int    priv_flags;              // 私有标志
    
    const struct net_device_ops *netdev_ops; // 设备操作函数指针
    
    int             ifindex;                 // 接口索引
    unsigned short  gflags;                  // 全局标志
    unsigned short  hard_header_len;         // 硬件头长度

    unsigned int    mtu;                     // 最大传输单元
    unsigned short  needed_headroom;         // 需要的头部预留空间
    unsigned short  needed_tailroom;         // 需要的尾部预留空间

    netdev_features_t features;              // 设备特性
    netdev_features_t hw_features;           // 硬件可配置特性
    netdev_features_t wanted_features;       // 期望启用的特性
    netdev_features_t vlan_features;         // VLAN 特性
    netdev_features_t hw_enc_features;       // 硬件封装特性

    unsigned int    min_mtu;                 // 最小 MTU
    unsigned int    max_mtu;                 // 最大 MTU
    unsigned short  type;                    // 接口类型（ARPHRD_ETHER等）
    unsigned char   min_header_len;          // 最小头部长度

    int             group;                   // 设备组

    struct net_device_stats stats;           // 统计信息

    atomic_long_t   rx_dropped;              // 接收丢包计数
    atomic_long_t   tx_dropped;              // 发送丢包计数
    atomic_long_t   rx_nohandler;            // 无处理程序的包计数

    atomic_t        carrier_up_count;        // 载波启动计数
    atomic_t        carrier_down_count;      // 载波关闭计数

    const struct ethtool_ops *ethtool_ops;   // ethtool 操作
    const struct header_ops *header_ops;     // 头部操作

    unsigned char   operstate;               // 操作状态
    unsigned char   link_mode;               // 链接模式

    unsigned char   if_port;                 // 端口类型
    unsigned char   dma;                     // DMA 通道

    unsigned char   perm_addr[MAX_ADDR_LEN]; // 永久 MAC 地址
    unsigned char   addr_assign_type;        // 地址分配类型
    unsigned char   addr_len;                // 地址长度

    spinlock_t      addr_list_lock;          // 地址列表锁
    int             irq;                     // 中断号

    struct netdev_hw_addr_list uc;           // 单播地址列表
    struct netdev_hw_addr_list mc;           // 多播地址列表
    struct netdev_hw_addr_list dev_addrs;    // 设备地址列表

    unsigned int    promiscuity;             // 混杂模式计数
    unsigned int    allmulti;                // 全多播计数

    // 接收路径相关字段
    struct netdev_rx_queue *_rx;             // 接收队列数组
    unsigned int    num_rx_queues;           // 接收队列数量
    unsigned int    real_num_rx_queues;      // 实际使用的接收队列数

    struct bpf_prog __rcu *xdp_prog;         // XDP 程序
    unsigned long   gro_flush_timeout;       // GRO 刷新超时
    int             napi_defer_hard_irqs;    // NAPI 延迟硬中断数

    rx_handler_func_t __rcu *rx_handler;     // 接收处理函数
    void __rcu      *rx_handler_data;        // 接收处理函数数据

    unsigned char   broadcast[MAX_ADDR_LEN]; // 广播地址

    // 发送路径相关字段
    struct netdev_queue *_tx;                // 发送队列数组
    unsigned int    num_tx_queues;           // 发送队列数量
    unsigned int    real_num_tx_queues;      // 实际使用的发送队列数
    struct Qdisc __rcu *qdisc;               // 默认排队规则
    unsigned int    tx_queue_len;            // 发送队列长度
    spinlock_t      tx_global_lock;          // 全局发送锁

    struct timer_list watchdog_timer;        // 看门狗定时器
    int             watchdog_timeo;          // 看门狗超时

    struct list_head todo_list;              // 待处理列表

    // 引用计数
#ifdef CONFIG_PCPU_DEV_REFCNT
    int __percpu    *pcpu_refcnt;
#else
    refcount_t      dev_refcnt;
#endif

    struct list_head link_watch_list;        // 链接监视列表

    // 注册状态
    enum { 
        NETREG_UNINITIALIZED = 0,
        NETREG_REGISTERED,                   // 已注册
        NETREG_UNREGISTERING,                // 正在注销
        NETREG_UNREGISTERED,                 // 已注销
        NETREG_RELEASED,                     // 已释放
        NETREG_DUMMY,                        // 虚拟设备
    } reg_state:8;

    bool dismantle;                          // 正在拆除
    bool needs_free_netdev;                  // 需要释放 netdev
    void (*priv_destructor)(struct net_device *dev); // 私有数据析构函数

    possible_net_t nd_net;                   // 所属网络命名空间

    struct device dev;                       // 嵌入的设备结构体
    const struct rtnl_link_ops *rtnl_link_ops; // RTNL 链接操作

    unsigned int    gso_max_size;            // GSO 最大大小
    u16             gso_max_segs;            // GSO 最大段数

    s16             num_tc;                  // 流量类别数
    struct netdev_tc_txq tc_to_txq[TC_MAX_QUEUE]; // TC 到 TXQ 映射
    u8              prio_tc_map[TC_BITMASK + 1];  // 优先级到 TC 映射
};
```

### 2.4 关键字段详解

#### 2.4.1 设备标识字段

```c
char name[IFNAMSIZ];      // 设备名称，最大 16 字节
int ifindex;              // 全局唯一的设备索引
unsigned char perm_addr[MAX_ADDR_LEN]; // 永久硬件地址
```

设备名称是用户空间识别设备的主要方式，如 `eth0`、`wlan0`、`lo` 等。`ifindex` 是内核分配的唯一数字标识，用于快速查找设备。

#### 2.4.2 设备状态字段

```c
unsigned long state;      // 状态位图
unsigned int flags;       // 接口标志
unsigned char operstate;  // 操作状态
```

`state` 使用位图表示设备的内部状态：
- `__LINK_STATE_START`：设备已启动
- `__LINK_STATE_PRESENT`：设备存在
- `__LINK_STATE_NOCARRIER`：无载波

`flags` 是用户可见的接口标志：
- `IFF_UP`：接口已启用
- `IFF_BROADCAST`：支持广播
- `IFF_PROMISC`：混杂模式
- `IFF_LOOPBACK`：回环设备

#### 2.4.3 队列相关字段

```c
struct netdev_rx_queue *_rx;      // 接收队列
unsigned int num_rx_queues;       // 接收队列数量
struct netdev_queue *_tx;         // 发送队列
unsigned int num_tx_queues;       // 发送队列数量
```

现代网卡支持多队列（RSS/RPS），可以充分利用多核 CPU 的并行处理能力。每个队列可以绑定到不同的 CPU 或 NAPI 实例。

---

## 三、net_device_ops 操作接口

### 3.1 为什么需要操作接口？

不同的网络设备有不同的硬件特性：
- 物理网卡需要配置 MAC 地址、设置 MTU
- 虚拟设备可能不需要这些操作
- 某些设备支持硬件校验和卸载
- 某些设备支持硬件加密

通过函数指针的方式，内核可以统一调用接口，而具体实现由各设备驱动提供。

### 3.2 net_device_ops 结构体定义

```c
struct net_device_ops {
    int     (*ndo_init)(struct net_device *dev);
    void    (*ndo_uninit)(struct net_device *dev);
    int     (*ndo_open)(struct net_device *dev);
    int     (*ndo_stop)(struct net_device *dev);
    netdev_tx_t (*ndo_start_xmit)(struct sk_buff *skb, struct net_device *dev);
    netdev_features_t (*ndo_features_check)(struct sk_buff *skb,
                                            struct net_device *dev,
                                            netdev_features_t features);
    u16     (*ndo_select_queue)(struct net_device *dev, struct sk_buff *skb,
                                struct net_device *sb_dev);
    void    (*ndo_change_rx_flags)(struct net_device *dev, int flags);
    void    (*ndo_set_rx_mode)(struct net_device *dev);
    int     (*ndo_set_mac_address)(struct net_device *dev, void *addr);
    int     (*ndo_validate_addr)(struct net_device *dev);
    int     (*ndo_do_ioctl)(struct net_device *dev, struct ifreq *ifr, int cmd);
    int     (*ndo_eth_ioctl)(struct net_device *dev, struct ifreq *ifr, int cmd);
    int     (*ndo_set_config)(struct net_device *dev, struct ifmap *map);
    int     (*ndo_change_mtu)(struct net_device *dev, int new_mtu);
    void    (*ndo_tx_timeout)(struct net_device *dev, unsigned int txqueue);
    void    (*ndo_get_stats64)(struct net_device *dev,
                               struct rtnl_link_stats64 *storage);
    int     (*ndo_vlan_rx_add_vid)(struct net_device *dev, __be16 proto, u16 vid);
    int     (*ndo_vlan_rx_kill_vid)(struct net_device *dev, __be16 proto, u16 vid);
    int     (*ndo_set_vf_mac)(struct net_device *dev, int queue, u8 *mac);
    int     (*ndo_set_vf_vlan)(struct net_device *dev, int queue, u16 vlan,
                               u8 qos, __be16 proto);
    int     (*ndo_setup_tc)(struct net_device *dev, enum tc_setup_type type,
                            void *type_data);
    // ... 更多操作函数
};
```

### 3.3 关键操作函数详解

#### 3.3.1 ndo_open / ndo_stop

```c
int (*ndo_open)(struct net_device *dev);   // 启动设备
int (*ndo_stop)(struct net_device *dev);   // 停止设备
```

当用户执行 `ip link set eth0 up` 时，内核会调用 `ndo_open`。驱动需要：
1. 申请硬件资源（IRQ、DMA、内存映射）
2. 初始化硬件寄存器
3. 启用 NAPI
4. 设置载波状态

`ndo_stop` 执行相反的操作。

#### 3.3.2 ndo_start_xmit

```c
netdev_tx_t (*ndo_start_xmit)(struct sk_buff *skb, struct net_device *dev);
```

这是数据包发送的核心函数。当内核有数据包需要发送时，会调用此函数。驱动需要：
1. 将 sk_buff 中的数据映射到 DMA 缓冲区
2. 通知硬件开始发送
3. 返回发送状态

返回值：
- `NETDEV_TX_OK`：发送成功
- `NETDEV_TX_BUSY`：设备忙，稍后重试

#### 3.3.3 ndo_set_rx_mode

```c
void (*ndo_set_rx_mode)(struct net_device *dev);
```

设置接收过滤器。当设备的混杂模式、多播列表发生变化时调用。驱动需要配置硬件过滤器：
- 混杂模式：接收所有数据包
- 多播模式：只接收特定多播组的数据包
- 正常模式：只接收目标为本机的数据包

#### 3.3.4 ndo_change_mtu

```c
int (*ndo_change_mtu)(struct net_device *dev, int new_mtu);
```

修改 MTU（最大传输单元）。某些设备有硬件限制，驱动需要检查新 MTU 是否合法。

---

## 四、NAPI 机制详解

### 4.1 什么是 NAPI？

NAPI（New API）是 Linux 内核中用于高效处理网络数据包的机制。它结合了中断驱动和轮询两种方式的优点。

### 4.2 为什么需要 NAPI？

让我们先看看传统的中断驱动方式有什么问题：

**传统中断方式的问题：**

假设一个高速网络接口每秒接收 100 万个数据包：
1. 每个数据包都会触发一次中断
2. 中断处理程序需要保存/恢复上下文
3. CPU 大量时间花在中断处理上
4. 这就是著名的"接收活锁"（Receive Livelock）问题

**NAPI 的解决方案：**

1. 第一个数据包到达时，触发中断
2. 中断处理程序关闭中断，调度轮询
3. 轮询程序批量处理所有待处理的数据包
4. 处理完成后，重新启用中断

这样，高负载时切换到轮询模式，低负载时使用中断模式，兼顾了效率和响应速度。

### 4.3 napi_struct 结构体

```c
struct napi_struct {
    struct list_head poll_list;     // 轮询链表节点
    unsigned long state;            // 状态位图
    int weight;                     // 每次轮询的最大预算
    int defer_hard_irqs_count;      // 延迟硬中断计数
    unsigned long gro_bitmask;      // GRO 位掩码
    int (*poll)(struct napi_struct *, int); // 轮询函数
    struct net_device *dev;         // 所属设备
    struct gro_list gro_hash[GRO_HASH_BUCKETS]; // GRO 哈希表
    struct sk_buff *skb;            // 当前处理的 skb
    struct list_head rx_list;       // 接收列表
    int rx_count;                   // 接收计数
    struct hrtimer timer;           // 高精度定时器
    struct list_head dev_list;      // 设备链表节点
    struct hlist_node napi_hash_node; // NAPI 哈希节点
    unsigned int napi_id;           // NAPI ID
    struct task_struct *thread;     // 轮询线程（可选）
};
```

### 4.4 NAPI 状态位

```c
enum {
    NAPI_STATE_SCHED,           // 已调度轮询
    NAPI_STATE_MISSED,          // 错过的调度
    NAPI_STATE_DISABLE,         // 禁用中
    NAPI_STATE_NPSVC,           // Netpoll 服务
    NAPI_STATE_LISTED,          // 已加入系统列表
    NAPI_STATE_NO_BUSY_POLL,    // 禁用忙轮询
    NAPI_STATE_IN_BUSY_POLL,    // 正在忙轮询
    NAPI_STATE_PREFER_BUSY_POLL,// 首选忙轮询
    NAPI_STATE_THREADED,        // 线程化模式
    NAPI_STATE_SCHED_THREADED,  // 线程化调度中
};
```

### 4.5 NAPI 工作流程

```
┌──────────────────────────────────────────────────────────────┐
│                      NAPI 工作流程                            │
└──────────────────────────────────────────────────────────────┘

1. 初始化阶段
   ┌─────────────┐
   │ 驱动初始化   │
   │ netif_napi_add() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ napi_struct │
   │ 初始化完成   │
   └─────────────┘

2. 数据包到达（第一个包）
   ┌─────────────┐
   │ 硬件中断    │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 中断处理程序 │
   │ napi_schedule() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 关闭中断    │
   │ 加入轮询列表 │
   │ 触发软中断   │
   └─────────────┘

3. 软中断处理
   ┌─────────────┐
   │ NET_RX_SOFTIRQ │
   │ net_rx_action() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ napi_poll() │
   │ 调用驱动的poll函数 │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 批量处理数据包 │
   │ (最多weight个) │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 还有数据包？ │
   └─────────────┘
      /        \
     /          \
   是            否
    │             │
    ↓             ↓
┌─────────┐   ┌─────────────┐
│ 继续轮询 │   │ napi_complete() │
└─────────┘   │ 重新启用中断  │
              └─────────────┘
```

### 4.6 关键 NAPI 函数

#### 4.6.1 netif_napi_add - 注册 NAPI 实例

```c
void netif_napi_add(struct net_device *dev, struct napi_struct *napi,
                    int (*poll)(struct napi_struct *, int), int weight)
{
    if (WARN_ON(test_and_set_bit(NAPI_STATE_LISTED, &napi->state)))
        return;

    INIT_LIST_HEAD(&napi->poll_list);
    INIT_HLIST_NODE(&napi->napi_hash_node);
    hrtimer_init(&napi->timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL_PINNED);
    napi->timer.function = napi_watchdog;
    init_gro_hash(napi);
    napi->skb = NULL;
    INIT_LIST_HEAD(&napi->rx_list);
    napi->rx_count = 0;
    napi->poll = poll;          // 设置轮询函数
    napi->weight = weight;      // 设置预算（通常为 64）
    napi->dev = dev;
    set_bit(NAPI_STATE_SCHED, &napi->state);
    set_bit(NAPI_STATE_NPSVC, &napi->state);
    list_add_rcu(&napi->dev_list, &dev->napi_list);
    napi_hash_add(napi);
}
```

驱动在初始化时调用此函数注册 NAPI 实例。

#### 4.6.2 napi_schedule - 调度 NAPI 轮询

```c
static inline void napi_schedule(struct napi_struct *n)
{
    if (napi_schedule_prep(n))      // 检查是否可以调度
        __napi_schedule(n);         // 执行调度
}

void __napi_schedule(struct napi_struct *n)
{
    unsigned long flags;

    local_irq_save(flags);
    ____napi_schedule(this_cpu_ptr(&softnet_data), n);
    local_irq_restore(flags);
}

static inline void ____napi_schedule(struct softnet_data *sd,
                                     struct napi_struct *napi)
{
    struct task_struct *thread;

    if (test_bit(NAPI_STATE_THREADED, &napi->state)) {
        // 线程化模式：唤醒专用线程
        thread = READ_ONCE(napi->thread);
        if (thread) {
            if (READ_ONCE(thread->__state) != TASK_INTERRUPTIBLE)
                set_bit(NAPI_STATE_SCHED_THREADED, &napi->state);
            wake_up_process(thread);
            return;
        }
    }

    // 传统模式：加入软中断轮询列表
    list_add_tail(&napi->poll_list, &sd->poll_list);
    __raise_softirq_irqoff(NET_RX_SOFTIRQ);
}
```

#### 4.6.3 napi_poll - 执行轮询

```c
static int napi_poll(struct napi_struct *n, struct list_head *repoll)
{
    bool do_repoll = false;
    void *have;
    int work;

    list_del_init(&n->poll_list);

    have = netpoll_poll_lock(n);

    work = __napi_poll(n, &do_repoll);  // 调用驱动的 poll 函数

    if (do_repoll)
        list_add_tail(&n->poll_list, repoll);

    netpoll_poll_unlock(have);

    return work;
}

static int __napi_poll(struct napi_struct *n, bool *repoll)
{
    int work, weight;

    weight = n->weight;
    work = n->poll(n, weight);         // 调用驱动的 poll 函数

    // 如果处理的工作量等于预算，说明可能还有更多数据包
    if (work >= weight)
        *repoll = true;

    return work;
}
```

#### 4.6.4 napi_complete - 完成轮询

```c
bool napi_complete_done(struct napi_struct *n, int work_done)
{
    unsigned long flags, val, new, timeout = 0;
    bool ret = true;

    // ... 省略部分代码 ...

    // 清除 SCHED 状态
    do {
        val = READ_ONCE(n->state);

        WARN_ON(!(val & NAPIF_STATE_SCHED));

        new = val & ~(NAPIF_STATE_SCHED | NAPIF_STATE_NPSVC);

        // 如果有 MISSED 标志，需要重新调度
        if (val & NAPIF_STATE_MISSED) {
            new |= NAPIF_STATE_SCHED;
            if (new != val)
                continue;
            __napi_schedule(n);
            return false;
        }

    } while (cmpxchg(&n->state, val, new) != val);

    // 重新启用硬件中断
    if (n->dev->threaded)
        return false;

    if (n->dev->priv_flags & IFF_NAPI) {
        if (work_done)
            timeout = n->dev->gro_flush_timeout;
        if (timeout)
            hrtimer_start(&n->timer, ns_to_ktime(timeout),
                         HRTIMER_MODE_REL_PINNED);
    }

    return true;
}
```

---

## 五、数据包接收流程

### 5.1 接收流程概述

```
┌──────────────────────────────────────────────────────────────┐
│                    数据包接收流程                             │
└──────────────────────────────────────────────────────────────┘

1. 硬件层
   ┌─────────────┐
   │ 网卡接收数据 │
   │ DMA到内存    │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 触发硬件中断 │
   └─────────────┘

2. 中断处理
   ┌─────────────┐
   │ 驱动中断处理 │
   │ napi_schedule() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 关闭中断    │
   │ 调度软中断   │
   └─────────────┘

3. 软中断处理
   ┌─────────────┐
   │ net_rx_action() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ napi_poll() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 驱动poll函数 │
   │ 从环形缓冲区取包 │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 构建sk_buff │
   │ netif_receive_skb() │
   └─────────────┘

4. 协议栈处理
   ┌─────────────┐
   │ __netif_receive_skb_core() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 协议分发    │
   │ ip_rcv/ipv6_rcv │
   └─────────────┘
```

### 5.2 netif_receive_skb 函数

```c
int netif_receive_skb(struct sk_buff *skb)
{
    int ret;

    trace_netif_receive_skb_entry(skb);

    ret = netif_receive_skb_internal(skb);
    trace_netif_receive_skb_exit(ret);

    return ret;
}

static int __netif_receive_skb(struct sk_buff *skb)
{
    int ret;

    if (sk_memalloc_socks() && skb_pfmemalloc(skb)) {
        unsigned int noreclaim_flag;

        noreclaim_flag = memalloc_noreclaim_save();
        ret = __netif_receive_skb_one_core(skb, true);
        memalloc_noreclaim_restore(noreclaim_flag);
    } else
        ret = __netif_receive_skb_one_core(skb, false);

    return ret;
}

static int __netif_receive_skb_one_core(struct sk_buff *skb, bool pfmemalloc)
{
    struct net_device *orig_dev = skb->dev;
    struct packet_type *pt_prev = NULL;
    int ret;

    ret = __netif_receive_skb_core(&skb, pfmemalloc, &pt_prev);
    if (pt_prev)
        ret = INDIRECT_CALL_INET(pt_prev->func, ipv6_rcv, ip_rcv, skb,
                                 skb->dev, pt_prev, orig_dev);
    return ret;
}
```

### 5.3 __netif_receive_skb_core 核心处理

```c
static int __netif_receive_skb_core(struct sk_buff **pskb, bool pfmemalloc,
                                    struct packet_type **ppt_prev)
{
    struct packet_type *ptype, *pt_prev;
    rx_handler_func_t *rx_handler;
    struct sk_buff *skb = *pskb;
    struct net_device *orig_dev;
    bool deliver_exact = false;
    int ret = NET_RX_DROP;
    __be16 type;

    net_timestamp_check(!READ_ONCE(netdev_tstamp_prequeue), skb);

    trace_netif_receive_skb(skb);

    orig_dev = skb->dev;

    skb_reset_network_header(skb);
    if (!skb_transport_header_was_set(skb))
        skb_reset_transport_header(skb);
    skb_reset_mac_len(skb);

    pt_prev = NULL;

another_round:
    skb->skb_iif = skb->dev->ifindex;

    __this_cpu_inc(softnet_data.processed);

    // XDP 处理
    if (static_branch_unlikely(&generic_xdp_needed_key)) {
        int ret2 = do_xdp_generic(rcu_dereference(skb->dev->xdp_prog), skb);
        if (ret2 != XDP_PASS) {
            ret = NET_RX_DROP;
            goto out;
        }
    }

    // 处理抓包（tcpdump 等）
    list_for_each_entry_rcu(ptype, &ptype_all, list) {
        if (pt_prev)
            ret = deliver_skb(skb, pt_prev, orig_dev);
        pt_prev = ptype;
    }

    // 调用设备的 rx_handler（用于 bridge、bonding 等）
    rx_handler = rcu_dereference(skb->dev->rx_handler);
    if (rx_handler) {
        switch (rx_handler(&skb)) {
        case RX_HANDLER_CONSUMED:
            ret = NET_RX_SUCCESS;
            goto out;
        case RX_HANDLER_ANOTHER:
            goto another_round;
        case RX_HANDLER_EXACT:
            deliver_exact = true;
            break;
        case RX_HANDLER_PASS:
            break;
        }
    }

    // 根据协议类型分发
    type = skb->protocol;

    list_for_each_entry_rcu(ptype, &skb->dev->ptype_specific, list) {
        if (ptype->type == type &&
            (ptype->dev == null_or_dev || ptype->dev == skb->dev)) {
            if (pt_prev)
                ret = deliver_skb(skb, pt_prev, orig_dev);
            pt_prev = ptype;
        }
    }

    if (pt_prev) {
        *ppt_prev = pt_prev;
    } else {
        kfree_skb(skb);
        ret = NET_RX_DROP;
    }

out:
    return ret;
}
```

---

## 六、数据包发送流程

### 6.1 发送流程概述

```
┌──────────────────────────────────────────────────────────────┐
│                    数据包发送流程                             │
└──────────────────────────────────────────────────────────────┘

1. 协议栈层
   ┌─────────────┐
   │ TCP/UDP层   │
   │ 构建数据包   │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ IP层        │
   │ 路由查找    │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 邻居子系统   │
   │ 解析MAC地址 │
   └─────────────┘

2. 设备层
   ┌─────────────┐
   │ dev_queue_xmit() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 选择发送队列 │
   │ netdev_core_pick_tx() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ Qdisc排队   │
   │ __dev_xmit_skb() │
   └─────────────┘

3. 驱动层
   ┌─────────────┐
   │ ndo_start_xmit() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 映射DMA     │
   │ 写描述符    │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 通知硬件发送 │
   └─────────────┘

4. 硬件层
   ┌─────────────┐
   │ DMA传输     │
   │ 发送到网络   │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 发送完成中断 │
   │ 清理发送缓冲 │
   └─────────────┘
```

### 6.2 dev_queue_xmit 函数

```c
int dev_queue_xmit(struct sk_buff *skb)
{
    return __dev_queue_xmit(skb, NULL);
}

static int __dev_queue_xmit(struct sk_buff *skb, struct net_device *sb_dev)
{
    struct net_device *dev = skb->dev;
    struct netdev_queue *txq;
    struct Qdisc *q;
    int rc = -ENOMEM;
    bool again = false;

    skb_reset_mac_header(skb);
    skb_assert_len(skb);

    // 禁用软中断，获取 RCU 读锁
    rcu_read_lock_bh();

    skb_update_prio(skb);

    qdisc_pkt_len_init(skb);

    // 处理 Egress Qdisc
#ifdef CONFIG_NET_CLS_ACT
    skb->tc_at_ingress = 0;
#ifdef CONFIG_NET_EGRESS
    if (static_branch_unlikely(&egress_needed_key)) {
        skb = sch_handle_egress(skb, &rc, dev);
        if (!skb)
            goto out;
    }
#endif
#endif

    // 释放或强制保留 skb->dst
    if (dev->priv_flags & IFF_XMIT_DST_RELEASE)
        skb_dst_drop(skb);
    else
        skb_dst_force(skb);

    // 选择发送队列
    txq = netdev_core_pick_tx(dev, skb, sb_dev);
    q = rcu_dereference_bh(txq->qdisc);

    trace_net_dev_queue(skb);

    // 如果有 Qdisc，通过 Qdisc 发送
    if (q->enqueue) {
        rc = __dev_xmit_skb(skb, q, dev, txq);
        goto out;
    }

    // 无队列设备（如 loopback），直接发送
    if (dev->flags & IFF_UP) {
        int cpu = smp_processor_id();

        if (txq->xmit_lock_owner != cpu) {
            HARD_TX_LOCK(dev, txq, cpu);

            if (!netif_xmit_stopped(txq)) {
                dev_xmit_recursion_inc();
                rc = netdev_start_xmit(skb, dev, txq, false);
                dev_xmit_recursion_dec();
            }
            HARD_TX_UNLOCK(dev, txq);
        } else {
            // 递归发送检测
            rc = NET_XMIT_DROP;
        }
    } else {
        rc = NET_XMIT_DROP;
    }

out:
    rcu_read_unlock_bh();
    return rc;
}
```

### 6.3 __dev_xmit_skb 函数

```c
static inline int __dev_xmit_skb(struct sk_buff *skb, struct Qdisc *q,
                                 struct net_device *dev,
                                 struct netdev_queue *txq)
{
    spinlock_t *root_lock = qdisc_lock(q);
    struct sk_buff *to_free = NULL;
    bool contended;
    int rc;

    qdisc_calculate_pkt_len(skb, q);

    // 无锁 Qdisc 快速路径
    if (q->flags & TCQ_F_NOLOCK) {
        if (q->flags & TCQ_F_CAN_BYPASS && nolock_qdisc_is_empty(q) &&
            qdisc_run_begin(q)) {
            // 队列为空，可以直接发送
            if (unlikely(!nolock_qdisc_is_empty(q))) {
                rc = dev_qdisc_enqueue(skb, q, &to_free, txq);
                __qdisc_run(q);
                qdisc_run_end(q);
                goto no_lock_out;
            }

            qdisc_bstats_cpu_update(q, skb);
            // 直接发送
            if (sch_direct_xmit(skb, q, dev, txq, NULL, true) &&
                !nolock_qdisc_is_empty(q))
                __qdisc_run(q);

            qdisc_run_end(q);
            return NET_XMIT_SUCCESS;
        }

        rc = dev_qdisc_enqueue(skb, q, &to_free, txq);
        qdisc_run(q);

no_lock_out:
        if (unlikely(to_free))
            kfree_skb_list(to_free);
        return rc;
    }

    // 有锁 Qdisc
    contended = qdisc_is_running(q);
    if (unlikely(contended))
        spin_lock(&q->busylock);

    spin_lock(root_lock);

    if (unlikely(test_bit(__QDISC_STATE_DEACTIVATED, &q->state))) {
        rc = NET_XMIT_DROP;
    } else {
        rc = dev_qdisc_enqueue(skb, q, &to_free, txq);
        if (qdisc_run_begin(q)) {
            __qdisc_run(q);
            qdisc_run_end(q);
        }
    }

    spin_unlock(root_lock);
    if (unlikely(contended))
        spin_unlock(&q->busylock);

    if (unlikely(to_free))
        kfree_skb_list(to_free);

    return rc;
}
```

### 6.4 netdev_start_xmit 函数

```c
static inline netdev_tx_t netdev_start_xmit(struct sk_buff *skb, 
                                            struct net_device *dev,
                                            struct netdev_queue *txq, 
                                            bool more)
{
    const struct net_device_ops *ops = dev->netdev_ops;
    netdev_tx_t rc;

    rc = __netdev_start_xmit(ops, skb, dev, more);
    if (rc == NETDEV_TX_OK)
        txq_trans_update(txq);

    return rc;
}

static inline netdev_tx_t __netdev_start_xmit(const struct net_device_ops *ops,
                                              struct sk_buff *skb, 
                                              struct net_device *dev,
                                              bool more)
{
    __this_cpu_write(softnet_data.xmit.more, more);
    return ops->ndo_start_xmit(skb, dev);  // 调用驱动的发送函数
}
```

---

## 七、网络设备注册流程

### 7.1 注册流程概述

```
┌──────────────────────────────────────────────────────────────┐
│                  网络设备注册流程                             │
└──────────────────────────────────────────────────────────────┘

1. 驱动探测
   ┌─────────────┐
   │ PCI设备探测  │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ alloc_etherdev() │
   │ 分配net_device │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 初始化私有数据 │
   │ 设置netdev_ops │
   └─────────────┘

2. 注册设备
   ┌─────────────┐
   │ register_netdev() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ register_netdevice() │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 分配设备名称 │
   │ 调用ndo_init │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ netdev_register_kobject() │
   │ 创建sysfs节点 │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ 通知链通知  │
   │ NETDEV_REGISTER │
   └─────────────┘

3. 启动设备
   ┌─────────────┐
   │ dev_open()  │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ ndo_open()  │
   │ 申请资源    │
   └─────────────┘
          │
          ↓
   ┌─────────────┐
   │ napi_enable() │
   │ 启用NAPI    │
   └─────────────┘
```

### 7.2 register_netdev 函数

```c
int register_netdev(struct net_device *dev)
{
    int err;

    if (rtnl_lock_killable())
        return -EINTR;
    err = register_netdevice(dev);
    rtnl_unlock();
    return err;
}

int register_netdevice(struct net_device *dev)
{
    int ret;
    struct net *net = dev_net(dev);

    BUILD_BUG_ON(sizeof(netdev_features_t) * BITS_PER_BYTE <
                 NETDEV_FEATURE_COUNT);
    BUG_ON(dev_boot_phase);
    ASSERT_RTNL();

    might_sleep();

    BUG_ON(dev->reg_state != NETREG_UNINITIALIZED);
    BUG_ON(!net);

    ret = ethtool_check_ops(dev->ethtool_ops);
    if (ret)
        return ret;

    spin_lock_init(&dev->addr_list_lock);
    netdev_set_addr_lockdep_class(dev);

    // 获取有效的设备名称
    ret = dev_get_valid_name(net, dev, dev->name);
    if (ret < 0)
        goto out;

    ret = -ENOMEM;
    dev->name_node = netdev_name_node_head_alloc(dev);
    if (!dev->name_node)
        goto out;

    // 调用驱动的初始化函数
    if (dev->netdev_ops->ndo_init) {
        ret = dev->netdev_ops->ndo_init(dev);
        if (ret) {
            if (ret > 0)
                ret = -EIO;
            goto err_free_name;
        }
    }

    // 初始化队列
    if (dev->netdev_ops->ndo_select_queue)
        dev->priv_flags |= IFF_SELECT_QUEUE;

    // 设置默认 MTU
    if (!dev->mtu)
        dev->mtu = dev->max_mtu;

    // 设置默认 MAC 地址
    if (!dev->addr_len)
        dev->addr_len = ETH_ALEN;

    // 设置默认广播地址
    memset(dev->broadcast, 0xFF, dev->addr_len);

    // 初始化统计
    dev->flags &= ~IFF_UP;
    dev->reg_state = NETREG_REGISTERED;

    // 注册 kobject（创建 sysfs 节点）
    ret = netdev_register_kobject(dev);
    if (ret)
        goto err_uninit;

    // 加入网络命名空间的设备列表
    list_netdevice(dev, net);

    // 通知其他子系统
    call_netdevice_notifiers(NETDEV_REGISTER, dev);

    return 0;

err_uninit:
    if (dev->netdev_ops->ndo_uninit)
        dev->netdev_ops->ndo_uninit(dev);
err_free_name:
    netdev_name_node_free(dev->name_node);
out:
    return ret;
}
```

### 7.3 设备注销流程

```c
void unregister_netdev(struct net_device *dev)
{
    rtnl_lock();
    unregister_netdevice(dev);
    rtnl_unlock();
}

void unregister_netdevice(struct net_device *dev)
{
    ASSERT_RTNL();

    might_sleep();

    // 关闭设备
    dev_close(dev);

    // 通知其他子系统
    call_netdevice_notifiers(NETDEV_UNREGISTER, dev);

    // 从网络命名空间移除
    unlist_netdevice(dev, true);

    // 设置注销状态
    dev->reg_state = NETREG_UNREGISTERING;

    // 处理待处理的操作
    netdev_wait_allrefs(dev);

    // 释放资源
    if (dev->netdev_ops->ndo_uninit)
        dev->netdev_ops->ndo_uninit(dev);

    // 移除 sysfs 节点
    netdev_unregister_kobject(dev);

    dev->reg_state = NETREG_UNREGISTERED;

    // 释放设备结构
    netdev_put(dev, &dev->dev);
}
```

---

## 八、驱动接口示例

### 8.1 一个简单的网卡驱动框架

```c
#include <linux/module.h>
#include <linux/netdevice.h>
#include <linux/etherdevice.h>

struct my_nic_priv {
    struct napi_struct napi;
    void __iomem *mmio_base;
    struct sk_buff *tx_skb;
    dma_addr_t tx_dma;
};

static int my_nic_open(struct net_device *dev)
{
    struct my_nic_priv *priv = netdev_priv(dev);
    
    // 申请 IRQ
    if (request_irq(dev->irq, my_nic_interrupt, IRQF_SHARED,
                    dev->name, dev))
        return -EAGAIN;
    
    // 启用 NAPI
    napi_enable(&priv->napi);
    
    // 启动硬件
    my_nic_hw_start(dev);
    
    // 设置载波状态
    netif_carrier_on(dev);
    netif_start_queue(dev);
    
    return 0;
}

static int my_nic_stop(struct net_device *dev)
{
    struct my_nic_priv *priv = netdev_priv(dev);
    
    // 停止队列
    netif_stop_queue(dev);
    netif_carrier_off(dev);
    
    // 停止硬件
    my_nic_hw_stop(dev);
    
    // 禁用 NAPI
    napi_disable(&priv->napi);
    
    // 释放 IRQ
    free_irq(dev->irq, dev);
    
    return 0;
}

static netdev_tx_t my_nic_start_xmit(struct sk_buff *skb,
                                     struct net_device *dev)
{
    struct my_nic_priv *priv = netdev_priv(dev);
    
    // 映射 DMA
    priv->tx_skb = skb;
    priv->tx_dma = dma_map_single(&dev->dev, skb->data, skb->len,
                                   DMA_TO_DEVICE);
    
    // 设置 DMA 描述符
    writel(priv->tx_dma, priv->mmio_base + TX_DESC_ADDR);
    writel(skb->len, priv->mmio_base + TX_DESC_LEN);
    
    // 通知硬件发送
    writel(TX_START, priv->mmio_base + TX_CMD);
    
    return NETDEV_TX_OK;
}

static int my_nic_poll(struct napi_struct *napi, int budget)
{
    struct my_nic_priv *priv = container_of(napi, struct my_nic_priv, napi);
    struct net_device *dev = priv->napi.dev;
    int work_done = 0;
    
    // 处理接收数据包
    while (work_done < budget) {
        struct sk_buff *skb;
        
        // 检查是否有新数据包
        if (!(readl(priv->mmio_base + RX_STATUS) & RX_PKT_READY))
            break;
        
        // 分配 sk_buff
        skb = netdev_alloc_skb(dev, pkt_len);
        if (!skb)
            break;
        
        // 复制数据
        dma_sync_single_for_cpu(&dev->dev, rx_dma, pkt_len,
                                DMA_FROM_DEVICE);
        skb_copy_to_linear_data(skb, rx_data, pkt_len);
        skb_put(skb, pkt_len);
        
        // 设置协议
        skb->protocol = eth_type_trans(skb, dev);
        
        // 传递给协议栈
        netif_receive_skb(skb);
        
        work_done++;
    }
    
    // 如果处理完所有数据包，完成轮询
    if (work_done < budget) {
        napi_complete_done(napi, work_done);
        // 重新启用中断
        writel(RX_IRQ_ENABLE, priv->mmio_base + INT_ENABLE);
    }
    
    return work_done;
}

static irqreturn_t my_nic_interrupt(int irq, void *dev_id)
{
    struct net_device *dev = dev_id;
    struct my_nic_priv *priv = netdev_priv(dev);
    u32 status;
    
    status = readl(priv->mmio_base + INT_STATUS);
    
    if (status & RX_IRQ) {
        // 禁用接收中断
        writel(RX_IRQ_DISABLE, priv->mmio_base + INT_ENABLE);
        // 调度 NAPI
        napi_schedule(&priv->napi);
    }
    
    if (status & TX_IRQ) {
        // 发送完成，清理
        if (priv->tx_skb) {
            dma_unmap_single(&dev->dev, priv->tx_dma,
                             priv->tx_skb->len, DMA_TO_DEVICE);
            dev_kfree_skb_irq(priv->tx_skb);
            priv->tx_skb = NULL;
            
            // 唤醒发送队列
            netif_wake_queue(dev);
        }
    }
    
    return IRQ_HANDLED;
}

static const struct net_device_ops my_nic_ops = {
    .ndo_open       = my_nic_open,
    .ndo_stop       = my_nic_stop,
    .ndo_start_xmit = my_nic_start_xmit,
    .ndo_validate_addr = eth_validate_addr,
    .ndo_set_mac_address = eth_mac_addr,
};

static int my_nic_probe(struct pci_dev *pdev,
                        const struct pci_device_id *ent)
{
    struct net_device *dev;
    struct my_nic_priv *priv;
    int err;
    
    // 启用 PCI 设备
    err = pci_enable_device(pdev);
    if (err)
        return err;
    
    // 分配 net_device
    dev = alloc_etherdev(sizeof(struct my_nic_priv));
    if (!dev) {
        err = -ENOMEM;
        goto err_disable;
    }
    
    priv = netdev_priv(dev);
    priv->mmio_base = pci_iomap(pdev, 0, 0);
    if (!priv->mmio_base) {
        err = -ENOMEM;
        goto err_free_dev;
    }
    
    // 设置设备操作
    dev->netdev_ops = &my_nic_ops;
    
    // 初始化 NAPI
    netif_napi_add(dev, &priv->napi, my_nic_poll, 64);
    
    // 设置 MAC 地址
    eth_hw_addr_random(dev);
    
    // 注册设备
    err = register_netdev(dev);
    if (err)
        goto err_iounmap;
    
    pci_set_drvdata(pdev, dev);
    
    return 0;
    
err_iounmap:
    pci_iounmap(pdev, priv->mmio_base);
err_free_dev:
    free_netdev(dev);
err_disable:
    pci_disable_device(pdev);
    return err;
}

static void my_nic_remove(struct pci_dev *pdev)
{
    struct net_device *dev = pci_get_drvdata(pdev);
    struct my_nic_priv *priv = netdev_priv(dev);
    
    unregister_netdev(dev);
    netif_napi_del(&priv->napi);
    pci_iounmap(pdev, priv->mmio_base);
    free_netdev(dev);
    pci_disable_device(pdev);
}

static struct pci_driver my_nic_driver = {
    .name       = "my_nic",
    .id_table   = my_nic_pci_tbl,
    .probe      = my_nic_probe,
    .remove     = my_nic_remove,
};

module_pci_driver(my_nic_driver);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Example");
MODULE_DESCRIPTION("Example NIC Driver");
```

---

## 九、总结

### 9.1 网络设备模块的核心要点

1. **net_device 结构体**：内核中表示网络设备的核心数据结构，包含设备标识、状态、配置、操作接口等所有信息。

2. **net_device_ops 操作接口**：定义了设备的标准操作函数，驱动通过实现这些函数来提供具体功能。

3. **NAPI 机制**：结合中断和轮询的优点，在高负载时使用轮询提高效率，低负载时使用中断节省 CPU。

4. **数据包收发流程**：
   - 接收：硬件中断 → NAPI 调度 → 轮询处理 → 协议分发
   - 发送：协议栈 → Qdisc 排队 → 驱动发送 → DMA 传输

5. **设备注册流程**：分配设备 → 初始化 → 注册 → 启动

### 9.2 关键数据结构关系

```
┌─────────────────────────────────────────────────────────────┐
│                    数据结构关系图                            │
└─────────────────────────────────────────────────────────────┘

    ┌──────────────────┐
    │   net_device     │
    │  (网络设备)       │
    └────────┬─────────┘
             │
    ┌────────┴─────────┐
    │                  │
    ↓                  ↓
┌───────────────┐  ┌───────────────┐
│ net_device_ops│  │ napi_struct  │
│  (操作接口)    │  │  (NAPI实例)   │
└───────┬───────┘  └───────┬───────┘
        │                  │
        ↓                  ↓
┌───────────────┐  ┌───────────────┐
│ndo_start_xmit │  │    poll()     │
│ ndo_open      │  │  (轮询函数)    │
│ ndo_stop      │  └───────────────┘
└───────────────┘
```

### 9.3 与其他模块的关系

网络设备模块是整个网络协议栈的基础：
- **向上**：为协议栈提供统一的设备抽象
- **向下**：为驱动程序提供标准的注册和操作接口
- **横向**：与流量控制（Qdisc）、网络命名空间、sysfs 等子系统交互

通过这种分层设计，Linux 内核实现了网络设备的统一管理，使得添加新设备驱动变得简单，同时保证了高性能和高可扩展性。
