# Linux 5.15 邻居子系统(ARP/ND)详解

> 本文档从初学者角度详细讲解Linux内核邻居子系统，涵盖核心概念、数据结构、ARP/ND协议实现、状态机和实际应用场景。

---

## 目录

1. **`邻居子系统概述`**
2. **`核心数据结构`**
3. **`NUD状态机`**
4. **`邻居缓存操作`**
5. **`ARP协议实现`**
6. **`ND协议实现`**
7. **`邻居表初始化`**
8. **`数据包发送流程`**
9. **`代理ARP与代理ND`**
10. **`垃圾回收机制`**
11. **`调试与问题排查`**
12. **`总结`**

---

## 一、邻居子系统概述

### 1.1 什么是邻居子系统？

邻居子系统是Linux内核网络协议栈中负责**地址解析**的核心组件。它实现了将网络层地址（如IP地址）转换为链路层地址（如MAC地址）的功能。

```
┌─────────────────────────────────────────────────────────────────┐
│                    邻居子系统核心概念                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │   网络层地址    │    │   链路层地址    │                    │
│  │  (IP地址)       │───▶│  (MAC地址)      │                    │
│  │  192.168.1.100  │    │  00:11:22:33:44 │                    │
│  └─────────────────┘    └─────────────────┘                    │
│           │                     ▲                               │
│           │                     │                               │
│           ▼                     │                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    邻居子系统                            │   │
│  │                                                         │   │
│  │  IPv4 ──▶ ARP (Address Resolution Protocol)             │   │
│  │  IPv6 ──▶ ND  (Neighbor Discovery)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 ARP与ND的对比

| 特性 | ARP (IPv4) | ND (IPv6) |
|------|------------|-----------|
| **协议类型** | 独立的链路层协议 | ICMPv6消息 |
| **请求方式** | 广播 | 组播 |
| **响应方式** | 单播 | 单播 |
| **消息类型** | Request/Reply | NS/NA/RS/RA/Redirect |
| **自动配置** | 不支持 | 支持SLAAC |
| **重复地址检测** | 不支持 | 支持DAD |
| **路由器发现** | 不支持 | 支持RA |

### 1.3 邻居子系统的作用

```
┌─────────────────────────────────────────────────────────────────┐
│                    邻居子系统的作用                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 地址解析                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 当需要发送数据包时，通过邻居子系统获取目标MAC地址    │    │
│     │ IP: 192.168.1.100 ──▶ MAC: 00:11:22:33:44:55        │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. 邻居可达性检测 (NUD)                                        │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 持续监控邻居的可达性状态                             │    │
│     │ • 检测链路是否仍然有效                               │    │
│     │ • 自动更新邻居状态                                   │    │
│     │ • 触发重新解析                                       │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. 缓存管理                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 维护邻居缓存表，提高效率                             │    │
│     │ • 避免重复的地址解析                                 │    │
│     │ • 垃圾回收过期条目                                   │    │
│     │ • 管理缓存大小                                       │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  4. 代理功能                                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ 代理ARP/代理ND                                       │    │
│     │ • 代替其他节点响应ARP请求                            │    │
│     │ • 用于路由器、VPN等场景                              │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 生活中的类比

```
┌─────────────────────────────────────────────────────────────────┐
│                    生活类比：快递投递                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  发送网络数据包 ──▶ 寄送快递                                    │
│                                                                 │
│  IP地址         ──▶ 收件人姓名                                  │
│                    （网络层标识，如"张三"）                      │
│                                                                 │
│  MAC地址        ──▶ 具体门牌号                                  │
│                    （链路层标识，如"3号楼502室"）                │
│                                                                 │
│  ARP请求        ──▶ 询问"张三住哪里？"                          │
│                    （在小区广播询问）                            │
│                                                                 │
│  ARP响应        ──▶ 回答"张三住在3号楼502室"                    │
│                    （有人回应具体地址）                          │
│                                                                 │
│  邻居缓存       ──▶ 地址簿                                      │
│                    （记录下地址，下次不用再问）                  │
│                                                                 │
│  NUD状态机      ──▶ 定期确认地址是否有效                        │
│                    （搬家了需要更新地址）                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、核心数据结构

### 2.1 数据结构关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                    邻居子系统数据结构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   neigh_table                            │   │
│  │  (邻居表 - ARP表或ND表)                                  │   │
│  │                                                         │   │
│  │  • family: AF_INET/AF_INET6                             │   │
│  │  • nht: 哈希表                                          │   │
│  │  • parms: 默认参数                                      │   │
│  │  • gc_work: 垃圾回收工作                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   neighbour                              │   │
│  │  (邻居条目 - 单个邻居)                                   │   │
│  │                                                         │   │
│  │  • primary_key: IP地址                                  │   │
│  │  • ha: 硬件地址(MAC)                                    │   │
│  │  • nud_state: NUD状态                                   │   │
│  │  • dev: 网络设备                                        │   │
│  │  • timer: 状态定时器                                    │   │
│  │  • arp_queue: 等待解析的skb队列                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   neigh_parms                            │   │
│  │  (邻居参数 - 配置参数)                                   │   │
│  │                                                         │   │
│  │  • reachable_time: 可达时间                             │   │
│  │  • retrans_time: 重传时间                               │   │
│  │  • mcast_probes: 组播探测次数                           │   │
│  │  • ucast_probes: 单播探测次数                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 neighbour 结构体

```c
/* include/net/neighbour.h */

/*
 * neighbour - 邻居条目结构体
 * 
 * 这是邻居子系统的核心数据结构，表示一个邻居节点
 */
struct neighbour {
    struct neighbour __rcu  *next;      /* 哈希链表下一个节点 */
    struct neigh_table     *tbl;       /* 所属邻居表 */
    struct neigh_parms     *parms;     /* 参数配置 */
    
    unsigned long           confirmed;  /* 最后确认时间 */
    unsigned long           updated;    /* 最后更新时间 */
    
    rwlock_t                lock;       /* 保护此结构的锁 */
    refcount_t              refcnt;     /* 引用计数 */
    
    unsigned int            arp_queue_len_bytes;  /* 队列字节长度 */
    struct sk_buff_head     arp_queue;  /* 等待解析的skb队列 */
    struct timer_list       timer;      /* 状态定时器 */
    
    unsigned long           used;       /* 最后使用时间 */
    atomic_t                probes;     /* 探测计数 */
    
    __u8                    flags;      /* 标志位 (NTF_*) */
    __u8                    nud_state;  /* NUD状态 */
    __u8                    type;       /* 邻居类型 */
    __u8                    dead;       /* 是否已删除 */
    u8                      protocol;   /* 协议标识 */
    
    seqlock_t               ha_lock;    /* 硬件地址锁 */
    unsigned char           ha[ALIGN(MAX_ADDR_LEN, sizeof(unsigned long))];
    /* ha: 硬件地址(MAC地址) */
    
    struct hh_cache         hh;         /* 硬件头缓存 */
    
    int                     (*output)(struct neighbour *, struct sk_buff *);
    /* output: 输出函数指针 */
    
    const struct neigh_ops  *ops;       /* 操作函数集 */
    struct list_head        gc_list;    /* 垃圾回收链表 */
    struct rcu_head         rcu;        /* RU回调头 */
    struct net_device       *dev;       /* 网络设备 */
    u8                      primary_key[0];  /* IP地址（柔性数组） */
} __randomize_layout;
```

### 2.3 neigh_table 结构体

```c
/* include/net/neighbour.h */

/*
 * neigh_table - 邻居表结构体
 *
 * 管理所有邻居条目的表，ARP和ND各有一个
 */
struct neigh_table {
    int             family;         /* 协议族 AF_INET/AF_INET6 */
    unsigned int    entry_size;     /* 条目大小 */
    unsigned int    key_len;        /* 键长度（IP地址长度） */
    __be16          protocol;       /* 协议类型 ETH_P_IP/ETH_P_IPV6 */
    
    /* 哈希函数 */
    __u32           (*hash)(const void *pkey,
                            const struct net_device *dev,
                            __u32 *hash_rnd);
    
    /* 键比较函数 */
    bool            (*key_eq)(const struct neighbour *, const void *pkey);
    
    /* 构造函数 */
    int             (*constructor)(struct neighbour *);
    
    /* 代理相关 */
    int             (*pconstructor)(struct pneigh_entry *);
    void            (*pdestructor)(struct pneigh_entry *);
    void            (*proxy_redo)(struct sk_buff *skb);
    
    /* 组播检测 */
    int             (*is_multicast)(const void *pkey);
    
    char            *id;            /* 表标识名 */
    struct neigh_parms parms;       /* 默认参数 */
    struct list_head parms_list;    /* 参数链表 */
    
    /* 垃圾回收参数 */
    int             gc_interval;    /* GC间隔 */
    int             gc_thresh1;     /* GC阈值1 */
    int             gc_thresh2;     /* GC阈值2 */
    int             gc_thresh3;     /* GC阈值3 */
    
    unsigned long   last_flush;     /* 最后刷新时间 */
    struct delayed_work gc_work;    /* GC工作 */
    
    struct timer_list proxy_timer;  /* 代理定时器 */
    struct sk_buff_head proxy_queue;/* 代理队列 */
    
    atomic_t        entries;        /* 条目计数 */
    atomic_t        gc_entries;     /* GC条目计数 */
    struct list_head gc_list;       /* GC链表 */
    
    rwlock_t        lock;           /* 表锁 */
    unsigned long   last_rand;      /* 最后随机时间 */
    
    struct neigh_statistics __percpu *stats;  /* 统计信息 */
    struct neigh_hash_table __rcu *nht;       /* 哈希表 */
    struct pneigh_entry **phash_buckets;      /* 代理哈希表 */
};
```

### 2.4 neigh_parms 结构体

```c
/* include/net/neighbour.h */

/*
 * neigh_parms - 邻居参数结构体
 *
 * 控制邻居条目的行为参数
 */
struct neigh_parms {
    possible_net_t net;             /* 网络命名空间 */
    struct net_device *dev;         /* 网络设备 */
    struct list_head list;          /* 链表节点 */
    
    int (*neigh_setup)(struct neighbour *);  /* 设置函数 */
    struct neigh_table *tbl;        /* 所属表 */
    
    void *sysctl_table;             /* sysctl表 */
    
    int dead;                       /* 是否已删除 */
    refcount_t refcnt;              /* 引用计数 */
    struct rcu_head rcu_head;       /* RCU头 */
    
    int reachable_time;             /* 可达时间（计算值） */
    int data[NEIGH_VAR_DATA_MAX];   /* 参数数组 */
    DECLARE_BITMAP(data_state, NEIGH_VAR_DATA_MAX);  /* 参数状态 */
};

/* 参数索引枚举 */
enum {
    NEIGH_VAR_MCAST_PROBES,         /* 组播探测次数 */
    NEIGH_VAR_UCAST_PROBES,         /* 单播探测次数 */
    NEIGH_VAR_APP_PROBES,           /* 应用探测次数 */
    NEIGH_VAR_MCAST_REPROBES,       /* 组播重探测次数 */
    NEIGH_VAR_RETRANS_TIME,         /* 重传时间 */
    NEIGH_VAR_BASE_REACHABLE_TIME,  /* 基硎可达时间 */
    NEIGH_VAR_DELAY_PROBE_TIME,     /* 延迟探测时间 */
    NEIGH_VAR_GC_STALETIME,         /* GC过期时间 */
    NEIGH_VAR_QUEUE_LEN_BYTES,      /* 队列长度（字节） */
    NEIGH_VAR_PROXY_QLEN,           /* 代理队列长度 */
    NEIGH_VAR_ANYCAST_DELAY,        /* 任播延迟 */
    NEIGH_VAR_PROXY_DELAY,          /* 代理延迟 */
    NEIGH_VAR_LOCKTIME,             /* 锁定时间 */
    /* ... */
};
```

### 2.5 neigh_ops 结构体

```c
/* include/net/neighbour.h */

/*
 * neigh_ops - 邻居操作函数集
 *
 * 定义邻居条目的操作方法
 */
struct neigh_ops {
    int     family;         /* 协议族 */
    
    /* 发送请求（ARP请求/NS） */
    void    (*solicit)(struct neighbour *, struct sk_buff *);
    
    /* 错误报告 */
    void    (*error_report)(struct neighbour *, struct sk_buff *);
    
    /* 输出函数（需要解析） */
    int     (*output)(struct neighbour *, struct sk_buff *);
    
    /* 已连接输出（已解析） */
    int     (*connected_output)(struct neighbour *, struct sk_buff *);
};
```

### 2.6 NUD状态定义

```c
/* include/uapi/linux/neighbour.h */

/*
 * NUD (Neighbor Unreachability Detection) 状态
 *
 * 邻居可达性检测状态机状态
 */

#define NUD_INCOMPLETE  0x01    /* 不完整：正在解析地址 */
#define NUD_REACHABLE   0x02    /* 可达：地址已解析且有效 */
#define NUD_STALE       0x04    /* 过期：地址可能已失效 */
#define NUD_DELAY       0x08    /* 延迟：等待确认 */
#define NUD_PROBE       0x10    /* 探测：正在发送探测 */
#define NUD_FAILED      0x20    /* 失败：解析失败 */

/* 伪状态 */
#define NUD_NOARP       0x40    /* 无ARP：不需要地址解析 */
#define NUD_PERMANENT   0x80    /* 永久：静态配置 */
#define NUD_NONE        0x00    /* 无状态 */

/* 状态组合定义 */
#define NUD_IN_TIMER    (NUD_INCOMPLETE|NUD_REACHABLE|NUD_DELAY|NUD_PROBE)
#define NUD_VALID       (NUD_PERMANENT|NUD_NOARP|NUD_REACHABLE|NUD_PROBE|NUD_STALE|NUD_DELAY)
#define NUD_CONNECTED   (NUD_PERMANENT|NUD_NOARP|NUD_REACHABLE)
```

### 2.7 NTF标志定义

```c
/* include/uapi/linux/neighbour.h */

/*
 * NTF (Neighbor Table Flags) - 邻居条目标志
 */
#define NTF_USE         0x01    /* 使用标志 */
#define NTF_SELF        0x02    /* 本地地址 */
#define NTF_MASTER      0x04    /* 主设备 */
#define NTF_PROXY       0x08    /* 代理条目 */
#define NTF_EXT_LEARNED 0x10    /* 外部学习（如FDB） */
#define NTF_OFFLOADED   0x20    /* 已卸载到硬件 */
#define NTF_STICKY      0x40    /* 粘性条目 */
#define NTF_ROUTER      0x80    /* 路由器标志 */
```

---

## 三、NUD状态机

### 3.1 NUD状态机详解

```
┌─────────────────────────────────────────────────────────────────┐
│                    NUD状态机转换图                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        创建邻居条目                             │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    NUD_INCOMPLETE                        │   │
│  │  (不完整状态)                                           │   │
│  │  • 正在发送ARP请求/NS                                   │   │
│  │  • 数据包在arp_queue中排队等待                          │   │
│  │  • 定时器触发重发探测                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │ 收到响应            │ 探测次数超限                │
│            ▼                     ▼                             │
│  ┌──────────────────┐   ┌──────────────────┐                  │
│  │  NUD_REACHABLE   │   │   NUD_FAILED     │                  │
│  │  (可达状态)      │   │   (失败状态)     │                  │
│  │  • 地址已解析    │   │  • 解析失败      │                  │
│  │  • 可以发送数据  │   │  • 删除条目      │                  │
│  └──────────────────┘   └──────────────────┘                  │
│            │ 超时未确认                                        │
│            ▼                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      NUD_STALE                           │   │
│  │  (过期状态)                                             │   │
│  │  • 地址可能已失效                                       │   │
│  │  • 可以使用旧地址发送                                   │   │
│  │  • 发送数据时触发延迟探测                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │ 使用时触发                                        │
│            ▼                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      NUD_DELAY                           │   │
│  │  (延迟状态)                                             │   │
│  │  • 等待上层确认                                         │   │
│  │  • 等待DELAY_PROBE_TIME时间                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │ 延迟超时未确认                                    │
│            ▼                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      NUD_PROBE                           │   │
│  │  (探测状态)                                             │   │
│  │  • 发送单播探测                                         │   │
│  │  • 等待响应确认                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│            │                                                   │
│            ├─────── 收到响应 ───────▶ NUD_REACHABLE           │
│            │                                                   │
│            └─────── 探测失败 ───────▶ NUD_FAILED              │
│                                                                 │
│  特殊状态：                                                     │
│  ┌──────────────────┐   ┌──────────────────┐                  │
│  │  NUD_PERMANENT   │   │    NUD_NOARP     │                  │
│  │  (永久静态配置)  │   │  (无需地址解析)  │                  │
│  │  • 不会过期      │   │  • 如点对点链路  │                  │
│  │  • 不参与状态机  │   │  • 不参与状态机  │                  │
│  └──────────────────┘   └──────────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 状态转换触发条件

| 当前状态 | 触发条件 | 新状态 | 说明 |
|----------|----------|--------|------|
| NUD_NONE | 创建条目 | NUD_INCOMPLETE | 开始地址解析 |
| NUD_INCOMPLETE | 收到响应 | NUD_REACHABLE | 地址解析成功 |
| NUD_INCOMPLETE | 探测超限 | NUD_FAILED | 地址解析失败 |
| NUD_REACHABLE | 超时未确认 | NUD_STALE | 可达性过期 |
| NUD_STALE | 使用条目 | NUD_DELAY | 触发延迟探测 |
| NUD_DELAY | 收到确认 | NUD_REACHABLE | 确认可达 |
| NUD_DELAY | 超时未确认 | NUD_PROBE | 开始主动探测 |
| NUD_PROBE | 收到响应 | NUD_REACHABLE | 探测成功 |
| NUD_PROBE | 探测超限 | NUD_FAILED | 探测失败 |

### 3.3 neigh_timer_handler 实现

```c
/* net/core/neighbour.c */

/*
 * neigh_timer_handler - 邻居状态定时器处理函数
 *
 * 处理邻居条目的状态转换和探测
 */
static void neigh_timer_handler(struct timer_list *t)
{
    unsigned long now, next;
    struct neighbour *neigh = from_timer(neigh, t, timer);
    unsigned int state;
    int notify = 0;

    write_lock(&neigh->lock);

    state = neigh->nud_state;
    now = jiffies;
    next = now + HZ;

    /* 检查是否在定时器状态 */
    if (!(state & NUD_IN_TIMER))
        goto out;

    /* 处理NUD_REACHABLE状态 */
    if (state & NUD_REACHABLE) {
        /* 检查是否仍然可达 */
        if (time_before_eq(now,
                   neigh->confirmed + neigh->parms->reachable_time)) {
            /* 仍然可达，更新下次检查时间 */
            next = neigh->confirmed + neigh->parms->reachable_time;
        } else if (time_before_eq(now,
                      neigh->used +
                      NEIGH_VAR(neigh->parms, DELAY_PROBE_TIME))) {
            /* 进入延迟状态 */
            neigh->nud_state = NUD_DELAY;
            neigh->updated = jiffies;
            neigh_suspect(neigh);
            next = now + NEIGH_VAR(neigh->parms, DELAY_PROBE_TIME);
        } else {
            /* 进入过期状态 */
            neigh->nud_state = NUD_STALE;
            neigh->updated = jiffies;
            neigh_suspect(neigh);
            notify = 1;
        }
    } 
    /* 处理NUD_DELAY状态 */
    else if (state & NUD_DELAY) {
        if (time_before_eq(now,
                   neigh->confirmed +
                   NEIGH_VAR(neigh->parms, DELAY_PROBE_TIME))) {
            /* 确认可达 */
            neigh->nud_state = NUD_REACHABLE;
            neigh->updated = jiffies;
            neigh_connect(neigh);
            notify = 1;
            next = neigh->confirmed + neigh->parms->reachable_time;
        } else {
            /* 进入探测状态 */
            neigh->nud_state = NUD_PROBE;
            neigh->updated = jiffies;
            atomic_set(&neigh->probes, 0);
            notify = 1;
            next = now + max(NEIGH_VAR(neigh->parms, RETRANS_TIME),
                     HZ/100);
        }
    } else {
        /* NUD_PROBE | NUD_INCOMPLETE */
        next = now + max(NEIGH_VAR(neigh->parms, RETRANS_TIME), HZ/100);
    }

    /* 检查探测次数是否超限 */
    if ((neigh->nud_state & (NUD_INCOMPLETE | NUD_PROBE)) &&
        atomic_read(&neigh->probes) >= neigh_max_probes(neigh)) {
        /* 探测失败 */
        neigh->nud_state = NUD_FAILED;
        notify = 1;
        neigh_invalidate(neigh);
        goto out;
    }

    /* 重新设置定时器 */
    if (neigh->nud_state & NUD_IN_TIMER) {
        if (time_before(next, jiffies + HZ/100))
            next = jiffies + HZ/100;
        if (!mod_timer(&neigh->timer, next))
            neigh_hold(neigh);
    }

    /* 发送探测 */
    if (neigh->nud_state & (NUD_INCOMPLETE | NUD_PROBE)) {
        neigh_probe(neigh);
    } else {
out:
        write_unlock(&neigh->lock);
    }

    /* 发送通知 */
    if (notify)
        neigh_update_notify(neigh, 0);

    neigh_release(neigh);
}
```

---

## 四、邻居缓存操作

### 4.1 neigh_lookup 函数

```c
/* net/core/neighbour.c */

/*
 * neigh_lookup - 查找邻居条目
 * @tbl: 邻居表
 * @pkey: 主键（IP地址）
 * @dev: 网络设备
 *
 * 在邻居缓存中查找指定IP地址的条目
 */
struct neighbour *neigh_lookup(struct neigh_table *tbl, const void *pkey,
                   struct net_device *dev)
{
    struct neighbour *n;

    NEIGH_CACHE_STAT_INC(tbl, lookups);

    rcu_read_lock_bh();
    
    /* 在哈希表中查找 */
    n = __neigh_lookup_noref(tbl, pkey, dev);
    if (n) {
        /* 增加引用计数 */
        if (!refcount_inc_not_zero(&n->refcnt))
            n = NULL;
        NEIGH_CACHE_STAT_INC(tbl, hits);
    }

    rcu_read_unlock_bh();
    return n;
}
EXPORT_SYMBOL(neigh_lookup);
```

### 4.2 __neigh_create 函数

```c
/* net/core/neighbour.c */

/*
 * __neigh_create - 创建邻居条目
 * @tbl: 邻居表
 * @pkey: 主键（IP地址）
 * @dev: 网络设备
 * @flags: 创建标志
 *
 * 创建新的邻居条目并添加到缓存
 */
static struct neighbour *
___neigh_create(struct neigh_table *tbl, const void *pkey,
        struct net_device *dev, u8 flags,
        bool exempt_from_gc, bool want_ref)
{
    u32 hash_val, key_len = tbl->key_len;
    struct neighbour *n1, *rc, *n;
    struct neigh_hash_table *nht;
    int error;

    /* 分配邻居条目 */
    n = neigh_alloc(tbl, dev, flags, exempt_from_gc);
    if (IS_ERR(n)) {
        error = PTR_ERR(n);
        goto out;
    }

    /* 初始化邻居条目 */
    memcpy(n->primary_key, pkey, key_len);
    n->dev = dev;
    dev_hold(dev);
    n->parms = neigh_parms_alloc(dev, tbl);
    if (!n->parms) {
        error = -ENOENT;
        goto out_neigh_release;
    }

    /* 调用构造函数 */
    if (tbl->constructor && (error = tbl->constructor(n)) < 0) {
        error = -EINVAL;
        goto out_neigh_release;
    }

    /* 设置输出函数 */
    if (dev->header_ops->cache)
        n->ops = &tbl->hh_ops;
    else
        n->ops = &tbl->direct_ops;

    /* 计算哈希值 */
    write_lock_bh(&tbl->lock);
    nht = rcu_dereference_protected(tbl->nht,
                    lockdep_is_held(&tbl->lock));
    hash_val = tbl->hash(pkey, dev, nht->hash_rnd) >> 
           (32 - nht->hash_shift);

    /* 检查是否已存在 */
    for (n1 = rcu_dereference_protected(nht->hash_buckets[hash_val],
                        lockdep_is_held(&tbl->lock));
         n1 != NULL;
         n1 = rcu_dereference_protected(n1->next,
                        lockdep_is_held(&tbl->lock))) {
        if (n1->dev == dev && tbl->key_eq(n1, pkey)) {
            /* 已存在，返回现有条目 */
            if (want_ref && !refcount_inc_not_zero(&n1->refcnt))
                n1 = NULL;
            rc = n1;
            goto out_tbl_unlock;
        }
    }

    /* 添加到哈希表 */
    rcu_assign_pointer(n->next, nht->hash_buckets[hash_val]);
    rcu_assign_pointer(nht->hash_buckets[hash_val], n);
    
    atomic_inc(&tbl->entries);
    if (!exempt_from_gc) {
        list_add_tail(&n->gc_list, &tbl->gc_list);
        atomic_inc(&tbl->gc_entries);
    }

    rc = n;
out_tbl_unlock:
    write_unlock_bh(&tbl->lock);
    return rc;

out_neigh_release:
    neigh_release(n);
out:
    return ERR_PTR(error);
}
```

### 4.3 neigh_update 函数

```c
/* net/core/neighbour.c */

/*
 * neigh_update - 更新邻居条目
 * @neigh: 邻居条目
 * @lladdr: 链路层地址（MAC）
 * @new: 新的NUD状态
 * @flags: 更新标志
 *
 * 更新邻居条目的状态和地址
 */
static int __neigh_update(struct neighbour *neigh, const u8 *lladdr,
              u8 new, u32 flags, u32 nlmsg_pid,
              struct netlink_ext_ack *extack)
{
    bool ext_learn_change = false;
    u8 old;
    int err;
    int notify = 0;
    struct net_device *dev;
    int update_isrouter = 0;

    trace_neigh_update(neigh, lladdr, new, flags, nlmsg_pid);

    write_lock_bh(&neigh->lock);

    dev = neigh->dev;
    old = neigh->nud_state;
    err = -EPERM;

    /* 检查条目是否已删除 */
    if (neigh->dead) {
        NL_SET_ERR_MSG(extack, "Neighbor entry is now dead");
        new = old;
        goto out;
    }

    /* 检查是否允许更新 */
    if (!(flags & NEIGH_UPDATE_F_ADMIN) &&
        (old & (NUD_NOARP | NUD_PERMANENT)))
        goto out;

    /* 处理无效状态 */
    if (!(new & NUD_VALID)) {
        neigh_del_timer(neigh);
        if (old & NUD_CONNECTED)
            neigh_suspect(neigh);
        neigh->nud_state = new;
        err = 0;
        notify = old & NUD_VALID;
        if ((old & (NUD_INCOMPLETE | NUD_PROBE)) &&
            (new & NUD_FAILED)) {
            neigh_invalidate(neigh);
            notify = 1;
        }
        goto out;
    }

    /* 更新链路层地址 */
    if (!dev->addr_len) {
        lladdr = neigh->ha;
    } else if (lladdr) {
        /* 比较新旧地址 */
        if ((old & NUD_VALID) &&
            !memcmp(lladdr, neigh->ha, dev->addr_len))
            lladdr = neigh->ha;
    } else {
        err = -EINVAL;
        if (!(old & NUD_VALID)) {
            NL_SET_ERR_MSG(extack, "No link layer address given");
            goto out;
        }
        lladdr = neigh->ha;
    }

    /* 更新确认时间 */
    if (new & NUD_CONNECTED)
        neigh->confirmed = jiffies;

    /* 更新硬件地址 */
    if (lladdr != neigh->ha) {
        write_seqlock(&neigh->ha_lock);
        memcpy(&neigh->ha, lladdr, dev->addr_len);
        write_sequnlock(&neigh->ha_lock);
        
        /* 清除硬件头缓存 */
        neigh_update_hhs(neigh);
        
        if (!(new & NUD_CONNECTED))
            neigh->confirmed = jiffies - 
                (NEIGH_VAR(neigh->parms, BASE_REACHABLE_TIME) << 1);
        notify = 1;
    }

    /* 更新状态 */
    if (new != old) {
        neigh_del_timer(neigh);
        if (new & NUD_CONNECTED)
            neigh_connect(neigh);
        else if (!(flags & NEIGH_UPDATE_F_ISROUTER))
            neigh_suspect(neigh);
        neigh->nud_state = new;
        notify = 1;
    }

    /* 发送排队的skb */
    if ((new & NUD_CONNECTED) && 
        !(old & NUD_CONNECTED) && !list_empty(&neigh->arp_queue)) {
        struct sk_buff *skb;
        
        while ((skb = __skb_dequeue(&neigh->arp_queue)) != NULL) {
            /* 重新发送数据包 */
            dev_queue_xmit(skb);
        }
        neigh->arp_queue_len_bytes = 0;
    }

    neigh->updated = jiffies;

out:
    write_unlock_bh(&neigh->lock);

    if (notify)
        neigh_update_notify(neigh, nlmsg_pid);

    return err;
}
```

### 4.4 __neigh_event_send 函数

```c
/* net/core/neighbour.c */

/*
 * __neigh_event_send - 发送邻居事件
 * @neigh: 邻居条目
 * @skb: 待发送的数据包
 *
 * 当需要发送数据包但邻居状态不是可达时调用
 * 返回0表示可以发送，返回非0表示需要等待解析
 */
int __neigh_event_send(struct neighbour *neigh, struct sk_buff *skb)
{
    int rc;
    bool immediate_probe = false;

    write_lock_bh(&neigh->lock);

    rc = 0;
    
    /* 如果已经可达或正在探测，直接返回 */
    if (neigh->nud_state & (NUD_CONNECTED | NUD_DELAY | NUD_PROBE))
        goto out_unlock_bh;
    
    if (neigh->dead)
        goto out_dead;

    /* 处理初始状态 */
    if (!(neigh->nud_state & (NUD_STALE | NUD_INCOMPLETE))) {
        if (NEIGH_VAR(neigh->parms, MCAST_PROBES) +
            NEIGH_VAR(neigh->parms, APP_PROBES)) {
            unsigned long next, now = jiffies;

            /* 设置初始探测计数 */
            atomic_set(&neigh->probes,
                   NEIGH_VAR(neigh->parms, UCAST_PROBES));
            
            neigh_del_timer(neigh);
            neigh->nud_state = NUD_INCOMPLETE;
            neigh->updated = now;
            
            /* 设置定时器 */
            next = now + max(NEIGH_VAR(neigh->parms, RETRANS_TIME),
                     HZ/100);
            neigh_add_timer(neigh, next);
            immediate_probe = true;
        } else {
            /* 无法探测，标记失败 */
            neigh->nud_state = NUD_FAILED;
            neigh->updated = jiffies;
            write_unlock_bh(&neigh->lock);

            kfree_skb(skb);
            return 1;
        }
    } 
    /* 处理过期状态 */
    else if (neigh->nud_state & NUD_STALE) {
        neigh_dbg(2, "neigh %p is delayed\n", neigh);
        neigh_del_timer(neigh);
        neigh->nud_state = NUD_DELAY;
        neigh->updated = jiffies;
        neigh_add_timer(neigh, jiffies +
                NEIGH_VAR(neigh->parms, DELAY_PROBE_TIME));
    }

    /* 如果状态是INCOMPLETE，将skb加入队列 */
    if (neigh->nud_state == NUD_INCOMPLETE) {
        if (skb) {
            /* 检查队列长度限制 */
            while (neigh->arp_queue_len_bytes + skb->truesize >
                   NEIGH_VAR(neigh->parms, QUEUE_LEN_BYTES)) {
                struct sk_buff *buff;

                /* 丢弃最旧的skb */
                buff = __skb_dequeue(&neigh->arp_queue);
                if (!buff)
                    break;
                neigh->arp_queue_len_bytes -= buff->truesize;
                kfree_skb(buff);
                NEIGH_CACHE_STAT_INC(neigh->tbl, unres_discards);
            }
            
            /* 将skb加入队列 */
            __skb_queue_tail(&neigh->arp_queue, skb);
            neigh->arp_queue_len_bytes += skb->truesize;
            rc = 1;
        }
    }

out_unlock_bh:
    write_unlock_bh(&neigh->lock);

    /* 立即发送探测 */
    if (immediate_probe)
        neigh_probe(neigh);

    return rc;

out_dead:
    write_unlock_bh(&neigh->lock);
    kfree_skb(skb);
    return 1;
}
EXPORT_SYMBOL(__neigh_event_send);
```

---

## 五、ARP协议实现

### 5.1 ARP表定义

```c
/* net/ipv4/arp.c */

/*
 * arp_tbl - ARP邻居表
 *
 * IPv4使用的邻居表，管理所有ARP条目
 */
struct neigh_table arp_tbl = {
    .family     = AF_INET,              /* IPv4 */
    .key_len    = 4,                    /* IP地址长度 */
    .protocol   = cpu_to_be16(ETH_P_IP),
    .hash       = arp_hash,             /* 哈希函数 */
    .key_eq     = arp_key_eq,           /* 键比较函数 */
    .constructor = arp_constructor,     /* 构造函数 */
    .proxy_redo = parp_redo,            /* 代理重做 */
    .is_multicast = arp_is_multicast,   /* 组播检测 */
    .id         = "arp_cache",
    .parms      = {
        .tbl            = &arp_tbl,
        .reachable_time = 30 * HZ,      /* 30秒 */
        .data   = {
            [NEIGH_VAR_MCAST_PROBES] = 3,        /* 组播探测3次 */
            [NEIGH_VAR_UCAST_PROBES] = 3,        /* 单播探测3次 */
            [NEIGH_VAR_RETRANS_TIME] = 1 * HZ,   /* 重传间隔1秒 */
            [NEIGH_VAR_BASE_REACHABLE_TIME] = 30 * HZ,
            [NEIGH_VAR_DELAY_PROBE_TIME] = 5 * HZ,
            [NEIGH_VAR_GC_STALETIME] = 60 * HZ,  /* 过期时间60秒 */
            [NEIGH_VAR_QUEUE_LEN_BYTES] = SK_WMEM_MAX,
            [NEIGH_VAR_PROXY_QLEN] = 64,
            [NEIGH_VAR_ANYCAST_DELAY] = 1 * HZ,
            [NEIGH_VAR_PROXY_DELAY] = (8 * HZ) / 10,
            [NEIGH_VAR_LOCKTIME] = 1 * HZ,
        },
    },
    .gc_interval = 30 * HZ,             /* GC间隔30秒 */
    .gc_thresh1 = 128,                  /* GC阈值1 */
    .gc_thresh2 = 512,                  /* GC阈值2 */
    .gc_thresh3 = 1024,                 /* GC阈值3 */
};
```

### 5.2 ARP操作函数集

```c
/* net/ipv4/arp.c */

/*
 * ARP通用操作函数集
 */
static const struct neigh_ops arp_generic_ops = {
    .family =           AF_INET,
    .solicit =          arp_solicit,        /* 发送ARP请求 */
    .error_report =     arp_error_report,   /* 错误报告 */
    .output =           neigh_resolve_output,
    .connected_output = neigh_connected_output,
};

/*
 * ARP硬件头缓存操作函数集
 */
static const struct neigh_ops arp_hh_ops = {
    .family =           AF_INET,
    .solicit =          arp_solicit,
    .error_report =     arp_error_report,
    .output =           neigh_resolve_output,
    .connected_output = neigh_resolve_output,
};

/*
 * ARP直接输出操作函数集（无需解析）
 */
static const struct neigh_ops arp_direct_ops = {
    .family =           AF_INET,
    .output =           neigh_direct_output,
    .connected_output = neigh_direct_output,
};
```

### 5.3 arp_solicit 函数

```c
/* net/ipv4/arp.c */

/*
 * arp_solicit - 发送ARP请求
 * @neigh: 邻居条目
 * @skb: 触发请求的数据包
 *
 * 发送ARP请求以解析目标MAC地址
 */
static void arp_solicit(struct neighbour *neigh, struct sk_buff *skb)
{
    __be32 saddr = 0;
    u8 dst_ha[MAX_ADDR_LEN], *dst_hw = NULL;
    struct net_device *dev = neigh->dev;
    __be32 target = *(__be32 *)neigh->primary_key;  /* 目标IP */
    int probes = atomic_read(&neigh->probes);
    struct in_device *in_dev;
    struct dst_entry *dst = NULL;

    rcu_read_lock();
    in_dev = __in_dev_get_rcu(dev);
    if (!in_dev) {
        rcu_read_unlock();
        return;
    }

    /* 根据arp_announce配置选择源地址 */
    switch (IN_DEV_ARP_ANNOUNCE(in_dev)) {
    default:
    case 0:     /* 默认：使用任何本地IP */
        if (skb && inet_addr_type_dev_table(dev_net(dev), dev,
                      ip_hdr(skb)->saddr) == RTN_LOCAL)
            saddr = ip_hdr(skb)->saddr;
        break;
    case 1:     /* 限制：使用同一子网的IP */
        if (!skb)
            break;
        saddr = ip_hdr(skb)->saddr;
        if (inet_addr_type_dev_table(dev_net(dev), dev,
                         saddr) == RTN_LOCAL) {
            if (inet_addr_onlink(in_dev, target, saddr))
                break;
        }
        saddr = 0;
        break;
    case 2:     /* 避免使用辅助IP */
        break;
    }
    rcu_read_unlock();

    /* 如果没有源地址，选择一个合适的 */
    if (!saddr)
        saddr = inet_select_addr(dev, target, RT_SCOPE_LINK);

    /* 检查探测次数 */
    probes -= NEIGH_VAR(neigh->parms, UCAST_PROBES);
    if (probes < 0) {
        /* 单播探测：使用已知的目标MAC */
        if (!(neigh->nud_state & NUD_VALID)) {
            /* 还不知道MAC，无法单播 */
        } else {
            dst_hw = neigh->ha;  /* 使用缓存的MAC */
        }
    } else {
        /* 组播/广播探测 */
        probes -= NEIGH_VAR(neigh->parms, APP_PROBES);
        if (probes < 0) {
            /* 应用层探测（如arpd） */
            neigh_app_ns(neigh);
        } else {
            /* 广播ARP请求 */
            dst_hw = NULL;
        }
    }

    /* 发送ARP请求 */
    arp_send(ARPOP_REQUEST, ETH_P_ARP, target, dev, saddr,
         dst_hw, dev->dev_addr, NULL);
}
```

### 5.4 arp_rcv 函数

```c
/* net/ipv4/arp.c */

/*
 * arp_rcv - ARP报文接收处理
 * @skb: 接收到的ARP报文
 * @dev: 接收设备
 *
 * 处理接收到的ARP报文
 */
static int arp_rcv(struct sk_buff *skb, struct net_device *dev,
           struct packet_type *pt, struct net_device *orig_dev)
{
    const struct arphdr *arp;

    /* 检查设备是否支持ARP */
    if (dev->flags & IFF_NOARP ||
        skb->pkt_type == PACKET_OTHERHOST ||
        skb->pkt_type == PACKET_LOOPBACK)
        goto consumeskb;

    /* 共享检查 */
    skb = skb_share_check(skb, GFP_ATOMIC);
    if (!skb)
        goto out_of_mem;

    /* 检查报文长度 */
    if (!pskb_may_pull(skb, arp_hdr_len(dev)))
        goto freeskb;

    arp = arp_hdr(skb);
    
    /* 检查硬件地址长度和协议地址长度 */
    if (arp->ar_hln != dev->addr_len || arp->ar_pln != 4)
        goto freeskb;

    /* 初始化邻居控制块 */
    memset(NEIGH_CB(skb), 0, sizeof(struct neighbour_cb));

    /* 通过Netfilter钩子处理 */
    return NF_HOOK(NFPROTO_ARP, NF_ARP_IN,
               dev_net(dev), NULL, skb, dev, NULL,
               arp_process);

consumeskb:
    consume_skb(skb);
    return NET_RX_SUCCESS;
freeskb:
    kfree_skb(skb);
out_of_mem:
    return NET_RX_DROP;
}
```

### 5.5 arp_process 函数

```c
/* net/ipv4/arp.c */

/*
 * arp_process - ARP报文处理
 * @net: 网络命名空间
 * @sk: 套接字
 * @skb: ARP报文
 *
 * 处理ARP请求和响应
 */
static int arp_process(struct net *net, struct sock *sk, struct sk_buff *skb)
{
    struct net_device *dev = skb->dev;
    struct in_device *in_dev = __in_dev_get_rcu(dev);
    struct arphdr *arp;
    unsigned char *arp_ptr;
    struct rtable *rt;
    unsigned char *sha;     /* 源硬件地址 */
    unsigned char *tha = NULL;  /* 目标硬件地址 */
    __be32 sip, tip;        /* 源IP、目标IP */
    u16 dev_type = dev->type;
    int addr_type;
    struct neighbour *n;
    struct dst_entry *reply_dst = NULL;
    bool is_garp = false;   /* 是否是免费ARP */

    if (!in_dev)
        goto out_free_skb;

    arp = arp_hdr(skb);

    /* 检查硬件类型和协议类型 */
    switch (dev_type) {
    default:
        if (arp->ar_pro != htons(ETH_P_IP) ||
            htons(dev_type) != arp->ar_hrd)
            goto out_free_skb;
        break;
    case ARPHRD_ETHER:
    case ARPHRD_FDDI:
    case ARPHRD_IEEE802:
        if ((arp->ar_hrd != htons(ARPHRD_ETHER) &&
             arp->ar_hrd != htons(ARPHRD_IEEE802)) ||
            arp->ar_pro != htons(ETH_P_IP))
            goto out_free_skb;
        break;
    }

    /* 只处理REQUEST和REPLY */
    if (arp->ar_op != htons(ARPOP_REPLY) &&
        arp->ar_op != htons(ARPOP_REQUEST))
        goto out_free_skb;

    /* 提取ARP字段 */
    arp_ptr = (unsigned char *)(arp + 1);
    sha = arp_ptr;                  /* 源MAC */
    arp_ptr += dev->addr_len;
    memcpy(&sip, arp_ptr, 4);       /* 源IP */
    arp_ptr += 4;
    
    switch (dev_type) {
    default:
        tha = arp_ptr;              /* 目标MAC */
        arp_ptr += dev->addr_len;
    }
    memcpy(&tip, arp_ptr, 4);       /* 目标IP */

    /* 检查源IP是否有效 */
    if (sip == 0)
        goto out_free_skb;

    /* 处理ARP请求 */
    if (arp->ar_op == htons(ARPOP_REQUEST)) {
        /* 检查目标IP是否是本机 */
        if (inet_addr_type_dev_table(net, dev, tip) != RTN_LOCAL)
            goto out_free_skb;

        /* 发送ARP响应 */
        arp_send(ARPOP_REPLY, ETH_P_ARP, sip, dev, tip, sha,
             dev->dev_addr, sha);
    }

    /* 更新邻居缓存 */
    if (sip != 0) {
        /* 查找或创建邻居条目 */
        n = __neigh_lookup(&arp_tbl, &sip, dev, 1);
        if (n) {
            /* 更新邻居状态 */
            neigh_update(n, sha, NUD_REACHABLE,
                     NEIGH_UPDATE_F_OVERRIDE |
                     NEIGH_UPDATE_F_OVERRIDE_ISROUTER, 0);
            neigh_release(n);
        }
    }

out_free_skb:
    consume_skb(skb);
    return 0;
}
```

### 5.6 ARP报文格式

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARP报文格式                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  以太网帧：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 目标MAC (6字节) │ 源MAC (6字节) │ 类型=0x0806 (2字节)   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ARP报文 (28字节)：                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 硬件类型 (2字节)        │ 协议类型 (2字节)              │   │
│  │ HTYPE = 1 (以太网)      │ PTYPE = 0x0800 (IPv4)         │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 硬件地址长度 (1字节)    │ 协议地址长度 (1字节)          │   │
│  │ HLEN = 6                │ PLEN = 4                      │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 操作码 (2字节)                                          │   │
│  │ OPER = 1 (请求) / 2 (响应)                              │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 发送方硬件地址 (6字节) - SHA                            │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 发送方协议地址 (4字节) - SIP                            │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 目标硬件地址 (6字节) - THA                              │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 目标协议地址 (4字节) - TIP                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ARP请求示例：                                                  │
│  "谁有IP 192.168.1.100？请告诉192.168.1.1"                     │
│  SHA = 发送方MAC, SIP = 192.168.1.1                            │
│  THA = 00:00:00:00:00:00, TIP = 192.168.1.100                  │
│                                                                 │
│  ARP响应示例：                                                  │
│  "IP 192.168.1.100 在 MAC 00:11:22:33:44:55"                   │
│  SHA = 00:11:22:33:44:55, SIP = 192.168.1.100                  │
│  THA = 发送方MAC, TIP = 192.168.1.1                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、ND协议实现

### 6.1 ND表定义

```c
/* net/ipv6/ndisc.c */

/*
 * nd_tbl - ND邻居表
 *
 * IPv6使用的邻居表，管理所有ND条目
 */
struct neigh_table nd_tbl = {
    .family =   AF_INET6,             /* IPv6 */
    .key_len =  sizeof(struct in6_addr),  /* 16字节 */
    .protocol = cpu_to_be16(ETH_P_IPV6),
    .hash =     ndisc_hash,
    .key_eq =   ndisc_key_eq,
    .constructor = ndisc_constructor,
    .pconstructor = pndisc_constructor,
    .pdestructor = pndisc_destructor,
    .proxy_redo = pndisc_redo,
    .is_multicast = ndisc_is_multicast,
    .allow_add  =   ndisc_allow_add,
    .id =       "ndisc_cache",
    .parms = {
        .tbl            = &nd_tbl,
        .reachable_time = ND_REACHABLE_TIME,  /* 默认30秒 */
        .data = {
            [NEIGH_VAR_MCAST_PROBES] = 3,
            [NEIGH_VAR_UCAST_PROBES] = 3,
            [NEIGH_VAR_RETRANS_TIME] = ND_RETRANS_TIMER,  /* 1秒 */
            [NEIGH_VAR_BASE_REACHABLE_TIME] = ND_REACHABLE_TIME,
            [NEIGH_VAR_DELAY_PROBE_TIME] = 5 * HZ,
            [NEIGH_VAR_GC_STALETIME] = 60 * HZ,
            [NEIGH_VAR_QUEUE_LEN_BYTES] = SK_WMEM_MAX,
            [NEIGH_VAR_PROXY_QLEN] = 64,
            [NEIGH_VAR_ANYCAST_DELAY] = 1 * HZ,
            [NEIGH_VAR_PROXY_DELAY] = (8 * HZ) / 10,
        },
    },
    .gc_interval =  30 * HZ,
    .gc_thresh1 = 128,
    .gc_thresh2 = 512,
    .gc_thresh3 = 1024,
};
EXPORT_SYMBOL_GPL(nd_tbl);
```

### 6.2 ND操作函数集

```c
/* net/ipv6/ndisc.c */

/*
 * ND通用操作函数集
 */
static const struct neigh_ops ndisc_generic_ops = {
    .family =           AF_INET6,
    .solicit =          ndisc_solicit,      /* 发送NS */
    .error_report =     ndisc_error_report,
    .output =           neigh_resolve_output,
    .connected_output = neigh_connected_output,
};

/*
 * ND硬件头缓存操作函数集
 */
static const struct neigh_ops ndisc_hh_ops = {
    .family =           AF_INET6,
    .solicit =          ndisc_solicit,
    .error_report =     ndisc_error_report,
    .output =           neigh_resolve_output,
    .connected_output = neigh_resolve_output,
};

/*
 * ND直接输出操作函数集
 */
static const struct neigh_ops ndisc_direct_ops = {
    .family =           AF_INET6,
    .output =           neigh_direct_output,
    .connected_output = neigh_direct_output,
};
```

### 6.3 ndisc_solicit 函数

```c
/* net/ipv6/ndisc.c */

/*
 * ndisc_solicit - 发送邻居请求(NS)
 * @neigh: 邻居条目
 * @skb: 触发请求的数据包
 *
 * 发送IPv6邻居请求报文
 */
static void ndisc_solicit(struct neighbour *neigh, struct sk_buff *skb)
{
    struct in6_addr *saddr = NULL;
    struct in6_addr mcaddr;
    struct net_device *dev = neigh->dev;
    struct in6_addr *target = (struct in6_addr *)&neigh->primary_key;
    int probes = atomic_read(&neigh->probes);

    /* 选择源地址 */
    if (skb && ipv6_chk_addr_and_flags(dev_net(dev), &ipv6_hdr(skb)->saddr,
                       dev, false, 1,
                       IFA_F_TENTATIVE|IFA_F_OPTIMISTIC))
        saddr = &ipv6_hdr(skb)->saddr;

    /* 计算剩余单播探测次数 */
    probes -= NEIGH_VAR(neigh->parms, UCAST_PROBES);
    
    if (probes < 0) {
        /* 单播探测阶段 */
        if (!(neigh->nud_state & NUD_VALID)) {
            ND_PRINTK(1, dbg,
                  "%s: trying to ucast probe in NUD_INVALID: %pI6\n",
                  __func__, target);
        }
        /* 发送单播NS */
        ndisc_send_ns(dev, target, target, saddr, 0);
    } else if ((probes -= NEIGH_VAR(neigh->parms, APP_PROBES)) < 0) {
        /* 应用层探测 */
        neigh_app_ns(neigh);
    } else {
        /* 组播探测阶段 */
        /* 计算被请求节点的组播地址 */
        addrconf_addr_solict_mult(target, &mcaddr);
        /* 发送组播NS */
        ndisc_send_ns(dev, target, &mcaddr, saddr, 0);
    }
}
```

### 6.4 ndisc_rcv 函数

```c
/* net/ipv6/ndisc.c */

/*
 * ndisc_rcv - ND报文接收处理
 * @skb: 接收到的ND报文
 *
 * 处理接收到的IPv6邻居发现报文
 */
int ndisc_rcv(struct sk_buff *skb)
{
    struct nd_msg *msg;

    /* 抑制分片的ND报文 */
    if (ndisc_suppress_frag_ndisc(skb))
        return 0;

    /* 线性化skb */
    if (skb_linearize(skb))
        return 0;

    msg = (struct nd_msg *)skb_transport_header(skb);

    __skb_push(skb, skb->data - skb_transport_header(skb));

    /* 检查跳数限制必须为255 */
    if (ipv6_hdr(skb)->hop_limit != 255) {
        ND_PRINTK(2, warn, "NDISC: invalid hop-limit: %d\n",
              ipv6_hdr(skb)->hop_limit);
        return 0;
    }

    /* 检查ICMPv6代码必须为0 */
    if (msg->icmph.icmp6_code != 0) {
        ND_PRINTK(2, warn, "NDISC: invalid ICMPv6 code: %d\n",
              msg->icmph.icmp6_code);
        return 0;
    }

    /* 根据ICMPv6类型分发处理 */
    switch (msg->icmph.icmp6_type) {
    case NDISC_NEIGHBOUR_SOLICITATION:
        /* 邻居请求 */
        memset(NEIGH_CB(skb), 0, sizeof(struct neighbour_cb));
        ndisc_recv_ns(skb);
        break;

    case NDISC_NEIGHBOUR_ADVERTISEMENT:
        /* 邻居通告 */
        ndisc_recv_na(skb);
        break;

    case NDISC_ROUTER_SOLICITATION:
        /* 路由器请求 */
        ndisc_recv_rs(skb);
        break;

    case NDISC_ROUTER_ADVERTISEMENT:
        /* 路由器通告 */
        ndisc_router_discovery(skb);
        break;

    case NDISC_REDIRECT:
        /* 重定向 */
        ndisc_redirect_rcv(skb);
        break;
    }

    return 0;
}
```

### 6.5 ND报文类型

```
┌─────────────────────────────────────────────────────────────────┐
│                    ND报文类型                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 邻居请求 (NS - Neighbor Solicitation)                      │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ ICMPv6类型: 135                                     │    │
│     │ 功能: 解析IPv6地址对应的MAC地址                      │    │
│     │ 目标地址: 被请求节点的组播地址                       │    │
│     │ 包含: 目标IPv6地址、源链路层地址选项                 │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. 邻居通告 (NA - Neighbor Advertisement)                     │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ ICMPv6类型: 136                                     │    │
│     │ 功能: 响应NS，或主动通告地址变化                     │    │
│     │ 标志: Router, Solicited, Override                    │    │
│     │ 包含: 目标IPv6地址、目标链路层地址选项               │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. 路由器请求 (RS - Router Solicitation)                      │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ ICMPv6类型: 133                                     │    │
│     │ 功能: 请求路由器发送RA                               │    │
│     │ 目标地址: 所有路由器组播地址 ff02::2                 │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  4. 路由器通告 (RA - Router Advertisement)                     │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ ICMPv6类型: 134                                     │    │
│     │ 功能: 通告路由器存在和配置信息                       │    │
│     │ 包含: 前缀信息、MTU、DNS配置等                       │    │
│     │ 用于SLAAC自动配置                                   │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  5. 重定向 (Redirect)                                          │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ ICMPv6类型: 137                                     │    │
│     │ 功能: 通知更好的下一跳                               │    │
│     │ 包含: 目标地址、目的地地址                           │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.6 IPv6组播地址计算

```
┌─────────────────────────────────────────────────────────────────┐
│                被请求节点组播地址计算                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  对于IPv6地址: 2001:db8::1234:5678                              │
│                                                                 │
│  被请求节点组播地址格式:                                        │
│  ff02:0:0:0:0:1:ffXX:XXXX                                       │
│                                                                 │
│  其中XX:XXXX是目标IPv6地址的最后24位                            │
│                                                                 │
│  计算过程：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 目标地址: 2001:0db8:0000:0000:0000:0000:1234:5678       │   │
│  │ 最后24位: 34:5678                                       │   │
│  │ 组播地址: ff02:0:0:0:0:1:ff34:5678                      │   │
│  │ 简写: ff02::1:ff34:5678                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  对应的以太网组播MAC:                                           │
│  33:33:ff:34:56:78                                              │
│                                                                 │
│  优势：                                                         │
│  • 不需要广播到所有节点                                         │
│  • 只有目标节点会响应                                           │
│  • 减少网络负载                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、邻居表初始化

### 7.1 邻居表初始化流程

```c
/* net/core/neighbour.c */

/*
 * neigh_table_init - 初始化邻居表
 * @index: 表索引
 * @tbl: 邻居表
 */
void neigh_table_init(int index, struct neigh_table *tbl)
{
    /* 初始化参数链表 */
    INIT_LIST_HEAD(&tbl->parms_list);
    list_add(&tbl->parms.list, &tbl->parms_list);
    
    /* 初始化写锁 */
    rwlock_init(&tbl->lock);
    
    /* 初始化代理队列 */
    skb_queue_head_init(&tbl->proxy_queue);
    
    /* 初始化定时器 */
    timer_setup(&tbl->proxy_timer, neigh_proxy_timer, 0);
    
    /* 初始化垃圾回收工作 */
    INIT_DEFERRABLE_WORK(&tbl->gc_work, neigh_periodic_work);
    
    /* 初始化垃圾回收链表 */
    INIT_LIST_HEAD(&tbl->gc_list);
    
    /* 分配统计信息 */
    tbl->stats = alloc_percpu(struct neigh_statistics);
    
    /* 创建初始哈希表 */
    neigh_hash_grow(tbl, 32);
    
    /* 注册到全局表数组 */
    neigh_tables[index] = tbl;
}
EXPORT_SYMBOL(neigh_table_init);
```

### 7.2 ARP初始化

```c
/* net/ipv4/arp.c */

/*
 * arp_init - ARP模块初始化
 */
void __init arp_init(void)
{
    /* 初始化ARP邻居表 */
    neigh_table_init(NEIGH_ARP_TABLE, &arp_tbl);
    
    /* 注册协议处理 */
    dev_add_pack(&arp_packet_type);
    
    /* 注册proc接口 */
    arp_proc_init();
    
#ifdef CONFIG_SYSCTL
    /* 注册sysctl接口 */
    arp_sysctl_init();
#endif
    
    /* 注册netlink通知 */
    rtnetlink_link(RTM_NEWNEIGH, rtnl_doit_func, rtnl_dumpit_func);
}
```

### 7.3 ND初始化

```c
/* net/ipv6/ndisc.c */

/*
 * ndisc_init - ND模块初始化
 */
int __init ndisc_init(void)
{
    /* 初始化ND邻居表 */
    neigh_table_init(NEIGH_ND_TABLE, &nd_tbl);
    
    /* 注册ICMPv6处理 */
    icmpv6_notify_chain_register(&ndisc_notify_chain);
    
    /* 注册proc接口 */
    ndisc_proc_init();
    
#ifdef CONFIG_SYSCTL
    /* 注册sysctl接口 */
    ndisc_sysctl_init();
#endif
    
    return 0;
}
```

---

## 八、数据包发送流程

### 8.1 数据包发送流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    数据包发送流程                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  应用层发送数据                                                 │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ IP层路由查找                                            │   │
│  │ ip_route_output_key()                                   │   │
│  │ 确定下一跳IP地址                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 邻居查找                                                │   │
│  │ neigh_lookup(&arp_tbl, &nexthop, dev)                   │   │
│  │ 或 neigh_lookup(&nd_tbl, &nexthop, dev)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ├─── 找到条目 ───┐                                       │
│       │                │                                       │
│       ▼                ▼                                       │
│  ┌──────────────┐  ┌──────────────────────────────────────┐   │
│  │ 未找到条目   │  │ 检查NUD状态                          │   │
│  │              │  │                                      │   │
│  │ 创建新条目   │  │ ┌────────────────────────────────┐ │   │
│  │ neigh_create │  │ │ NUD_REACHABLE/PERMANENT/NOARP  │ │   │
│  │              │  │ │ 直接发送数据包                  │ │   │
│  │ 状态:        │  │ │ neigh->output()                │ │   │
│  │ NUD_INCOMP-  │  │ └────────────────────────────────┘ │   │
│  │ LETE         │  │                                      │   │
│  └──────────────┘  │ ┌────────────────────────────────┐ │   │
│                     │ │ NUD_STALE/DELAY/PROBE/        │ │   │
│                     │ │ INCOMPLETE                     │ │   │
│                     │ │ 调用 neigh_event_send()       │ │   │
│                     │ └────────────────────────────────┘ │   │
│                     └──────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 状态处理                                                │   │
│  │                                                         │   │
│  │ NUD_INCOMPLETE:                                         │   │
│  │   • 将skb加入arp_queue等待                              │   │
│  │   • 发送ARP请求/NS                                      │   │
│  │                                                         │   │
│  │ NUD_STALE:                                              │   │
│  │   • 转换到NUD_DELAY                                     │   │
│  │   • 使用旧MAC地址发送                                   │   │
│  │                                                         │   │
│  │ NUD_DELAY/NUD_PROBE:                                    │   │
│  │   • 等待确认或探测响应                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 neigh_resolve_output 函数

```c
/* net/core/neighbour.c */

/*
 * neigh_resolve_output - 解析邻居并输出数据包
 * @neigh: 邻居条目
 * @skb: 待发送的数据包
 *
 * 这是邻居子系统的核心输出函数
 */
int neigh_resolve_output(struct neighbour *neigh, struct sk_buff *skb)
{
    int rc = 0;

    /* 发送邻居事件，可能触发地址解析 */
    if (!neigh_event_send(neigh, skb)) {
        int err;
        struct net_device *dev = neigh->dev;
        unsigned int seq;

        /* 如果设备支持硬件头缓存，初始化缓存 */
        if (dev->header_ops->cache && !READ_ONCE(neigh->hh.hh_len))
            neigh_hh_init(neigh);

        /* 填充硬件头 */
        do {
            __skb_pull(skb, skb_network_offset(skb));
            seq = read_seqbegin(&neigh->ha_lock);
            err = dev_hard_header(skb, dev, ntohs(skb->protocol),
                          neigh->ha, NULL, skb->len);
        } while (read_seqretry(&neigh->ha_lock, seq));

        /* 发送数据包 */
        if (err >= 0)
            rc = dev_queue_xmit(skb);
        else
            goto out_kfree_skb;
    }
out:
    return rc;

out_kfree_skb:
    rc = -EINVAL;
    kfree_skb(skb);
    goto out;
}
EXPORT_SYMBOL(neigh_resolve_output);
```

### 8.3 完整发送流程示例

```
┌─────────────────────────────────────────────────────────────────┐
│              发送数据到192.168.1.100的完整流程                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  步骤1: 应用层调用sendto()                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ sendto(sock, data, len, 0, &dest_addr, sizeof(dest))    │   │
│  │ dest_addr.sin_addr.s_addr = 192.168.1.100               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  步骤2: IP层路由查找                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ip_route_output_key()                                   │   │
│  │ • 查找路由表                                            │   │
│  │ • 确定输出设备 eth0                                     │   │
│  │ • 确定下一跳 192.168.1.100 (直连)                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  步骤3: 邻居查找                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ neigh = neigh_lookup(&arp_tbl, &192.168.1.100, eth0)    │   │
│  │                                                         │   │
│  │ 情况A: 找到条目                                         │   │
│  │   └─▶ 使用现有条目                                      │   │
│  │                                                         │   │
│  │ 情况B: 未找到条目                                       │   │
│  │   └─▶ neigh_create() 创建新条目                        │   │
│  │       └─▶ 状态 = NUD_INCOMPLETE                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  步骤4: 状态检查                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ neigh_event_send(neigh, skb)                            │   │
│  │                                                         │   │
│  │ 如果状态是 NUD_REACHABLE:                               │   │
│  │   └─▶ 返回0，可以发送                                   │   │
│  │                                                         │   │
│  │ 如果状态是 NUD_INCOMPLETE:                              │   │
│  │   └─▶ 将skb加入arp_queue                                │   │
│  │   └─▶ 发送ARP请求                                       │   │
│  │   └─▶ 返回1，等待解析                                   │   │
│  │                                                         │   │
│  │ 如果状态是 NUD_STALE:                                   │   │
│  │   └─▶ 转换到 NUD_DELAY                                  │   │
│  │   └─▶ 使用旧MAC发送                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  步骤5: ARP请求发送（如果需要）                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ arp_solicit(neigh, skb)                                 │   │
│  │   └─▶ 构造ARP请求报文                                   │   │
│  │   └─▶ 目标IP: 192.168.1.100                             │   │
│  │   └─▶ 目标MAC: ff:ff:ff:ff:ff:ff (广播)                 │   │
│  │   └─▶ dev_queue_xmit() 发送                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  步骤6: ARP响应接收                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ arp_rcv(skb)                                            │   │
│  │   └─▶ arp_process(skb)                                  │   │
│  │       └─▶ 解析ARP响应                                   │   │
│  │       └─▶ neigh_update(neigh, mac, NUD_REACHABLE)       │   │
│  │       └─▶ 发送arp_queue中的skb                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  步骤7: 数据包发送                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ neigh_resolve_output(neigh, skb)                        │   │
│  │   └─▶ 填充以太网头                                      │   │
│  │       • 目标MAC: 从neigh->ha获取                        │   │
│  │       • 源MAC: eth0的MAC地址                            │   │
│  │   └─▶ dev_queue_xmit(skb)                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、代理ARP与代理ND

### 9.1 代理ARP原理

```
┌─────────────────────────────────────────────────────────────────┐
│                    代理ARP工作原理                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  场景：主机A想访问主机B，但B在另一个网段                         │
│                                                                 │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐           │
│  │  主机A  │         │  路由器 │         │  主机B  │           │
│  │192.168.1.10       │         │         │192.168.2.20         │
│  └─────────┘         └─────────┘         └─────────┘           │
│       │                   │                   │                 │
│       │ 1. ARP请求        │                   │                 │
│       │ "谁有192.168.2.20?"                   │                 │
│       │──────────────────▶│                   │                 │
│       │                   │                   │                 │
│       │ 2. 代理ARP响应    │                   │                 │
│       │ "192.168.2.20在我这"                  │                 │
│       │◀──────────────────│                   │                 │
│       │                   │                   │                 │
│       │ 3. 数据包发给路由器MAC                │                 │
│       │──────────────────▶│                   │                 │
│       │                   │ 4. 路由转发       │                 │
│       │                   │──────────────────▶│                 │
│                                                                 │
│  优点：                                                         │
│  • 主机A不需要配置路由                                          │
│  • 透明代理，对主机A隐藏网络拓扑                                │
│                                                                 │
│  缺点：                                                         │
│  • 增加ARP流量                                                  │
│  • 可能造成ARP表混乱                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 代理ARP实现

```c
/* net/ipv4/arp.c */

/*
 * pneigh_lookup - 查找代理邻居条目
 * @tbl: 邻居表
 * @net: 网络命名空间
 * @pkey: 主键（IP地址）
 * @dev: 设备
 * @creat: 是否创建
 *
 * 查找或创建代理邻居条目
 */
struct pneigh_entry *pneigh_lookup(struct neigh_table *tbl,
                   struct net *net, const void *pkey,
                   struct net_device *dev, int creat)
{
    struct pneigh_entry *n;
    u32 hash_val;

    /* 计算哈希值 */
    hash_val = tbl->hash(pkey, dev, NULL) & PNEIGH_HASHMASK;

    /* 查找代理条目 */
    read_lock_bh(&tbl->lock);
    for (n = tbl->phash_buckets[hash_val]; n; n = n->next) {
        if (n->net == net && 
            !memcmp(n->key, pkey, tbl->key_len) &&
            (n->dev == dev || !n->dev)) {
            read_unlock_bh(&tbl->lock);
            return n;
        }
    }
    read_unlock_bh(&tbl->lock);

    /* 创建新条目 */
    if (creat) {
        n = kmalloc(sizeof(*n) + tbl->key_len, GFP_ATOMIC);
        if (n) {
            memcpy(n->key, pkey, tbl->key_len);
            n->net = net;
            n->dev = dev;
            if (tbl->pconstructor && tbl->pconstructor(n)) {
                kfree(n);
                return NULL;
            }
            
            write_lock_bh(&tbl->lock);
            n->next = tbl->phash_buckets[hash_val];
            tbl->phash_buckets[hash_val] = n;
            write_unlock_bh(&tbl->lock);
        }
    }
    return n;
}
EXPORT_SYMBOL(pneigh_lookup);
```

### 9.3 代理ARP配置

```bash
# 启用代理ARP
# 方法1: 通过sysctl
sysctl -w net.ipv4.conf.eth0.proxy_arp=1

# 方法2: 通过ip命令
ip neigh add proxy 192.168.2.20 dev eth0

# 查看代理ARP条目
ip neigh show proxy

# 删除代理ARP条目
ip neigh del proxy 192.168.2.20 dev eth0
```

---

## 十、垃圾回收机制

### 10.1 垃圾回收原理

```
┌─────────────────────────────────────────────────────────────────┐
│                    邻居表垃圾回收                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  垃圾回收阈值：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ gc_thresh1 = 128   (最小阈值)                           │   │
│  │ gc_thresh2 = 512   (开始GC阈值)                         │   │
│  │ gc_thresh3 = 1024  (强制GC阈值)                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  GC触发条件：                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  条件1: 条目数 > gc_thresh3                             │   │
│  │    └─▶ 立即强制GC                                       │   │
│  │                                                         │   │
│  │  条件2: 条目数 > gc_thresh2                             │   │
│  │    └─▶ 在下次定时器触发时GC                             │   │
│  │                                                         │   │
│  │  条件3: 条目数 > gc_thresh1                             │   │
│  │    └─▶ GC过期条目                                       │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  GC选择标准：                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 优先删除：                                               │   │
│  │ 1. NUD_FAILED 状态的条目                                │   │
│  │ 2. 超过 gc_staletime 未使用的条目                       │   │
│  │ 3. 引用计数为1的条目                                    │   │
│  │ 4. 最久未使用的条目                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 垃圾回收实现

```c
/* net/core/neighbour.c */

/*
 * neigh_periodic_work - 周期性垃圾回收工作
 */
static void neigh_periodic_work(struct work_struct *work)
{
    struct neigh_table *tbl;
    struct neighbour *n;
    struct neighbour *neigh_list = NULL;
    unsigned long now = jiffies;
    bool do_gc = false;

    tbl = container_of(work, struct neigh_table, gc_work.work);

    write_lock_bh(&tbl->lock);

    /* 检查是否需要GC */
    if (atomic_read(&tbl->gc_entries) > tbl->gc_thresh3) {
        /* 超过最大阈值，强制GC */
        do_gc = true;
    } else if (atomic_read(&tbl->gc_entries) > tbl->gc_thresh2) {
        /* 超过中间阈值，执行GC */
        do_gc = true;
    } else if (time_after_eq(now, tbl->last_flush + 
                  5 * HZ * tbl->gc_interval)) {
        /* 定期GC */
        do_gc = true;
    }

    if (do_gc) {
        struct neighbour *prev = NULL;

        /* 遍历GC链表 */
        list_for_each_entry_safe_reverse(n, tmp, &tbl->gc_list, gc_list) {
            /* 检查是否应该删除 */
            if (atomic_read(&n->refcnt) == 1 &&
                (n->nud_state & NUD_FAILED ||
                 time_after(now, n->used + 
                       NEIGH_VAR(n->parms, GC_STALETIME)))) {
                /* 从链表移除 */
                list_del(&n->gc_list);
                atomic_dec(&tbl->gc_entries);
                
                /* 加入待删除列表 */
                n->gc_list.next = neigh_list;
                neigh_list = n;
                
                continue;
            }
            
            /* 只处理一定数量的条目 */
            if (--entries_to_gc < 0)
                break;
        }
    }

    /* 调整哈希表大小 */
    if (time_after_eq(now, tbl->last_rand + 300 * HZ)) {
        neigh_hash_grow(tbl, 0);
        tbl->last_rand = now;
    }

    write_unlock_bh(&tbl->lock);

    /* 删除收集的条目 */
    while ((n = neigh_list) != NULL) {
        neigh_list = n->gc_list.next;
        neigh_cleanup_and_release(n);
    }

    /* 重新调度GC工作 */
    schedule_delayed_work(&tbl->gc_work, tbl->gc_interval);
}
```

### 10.3 哈希表扩展

```c
/* net/core/neighbour.c */

/*
 * neigh_hash_grow - 扩展邻居哈希表
 * @tbl: 邻居表
 * @new_entries: 新的条目数（0表示自动计算）
 */
static void neigh_hash_grow(struct neigh_table *tbl, unsigned long new_entries)
{
    struct neigh_hash_table *old_nht, *new_nht;
    unsigned int i, hash_shift, n_buckets;

    old_nht = rcu_dereference_protected(tbl->nht,
                        lockdep_is_held(&tbl->lock));

    /* 计算新的哈希表大小 */
    if (!new_entries) {
        n_buckets = old_nht->hash_buckets_count;
        if (atomic_read(&tbl->entries) > n_buckets)
            n_buckets *= 2;
    } else {
        n_buckets = new_entries;
    }

    /* 分配新哈希表 */
    hash_shift = ilog2(n_buckets);
    new_nht = neigh_hash_alloc(hash_shift);
    if (!new_nht)
        return;

    /* 重新哈希所有条目 */
    for (i = 0; i < old_nht->hash_buckets_count; i++) {
        struct neighbour *n, *next;

        for (n = rcu_dereference_protected(old_nht->hash_buckets[i],
                    lockdep_is_held(&tbl->lock));
             n != NULL;
             n = next) {
            u32 hash_val;

            next = rcu_dereference_protected(n->next,
                    lockdep_is_held(&tbl->lock));

            /* 计算新的哈希值 */
            hash_val = tbl->hash(n->primary_key, n->dev,
                       new_nht->hash_rnd) >> (32 - hash_shift);

            /* 插入新哈希表 */
            rcu_assign_pointer(n->next,
                       new_nht->hash_buckets[hash_val]);
            rcu_assign_pointer(new_nht->hash_buckets[hash_val], n);
        }
    }

    /* 替换哈希表 */
    rcu_assign_pointer(tbl->nht, new_nht);
    neigh_hash_free_rcu(old_nht);
}
```

---

## 十一、调试与问题排查

### 11.1 查看邻居表

```bash
# 查看ARP表（IPv4）
ip neigh show
# 或
arp -a

# 查看指定接口的邻居表
ip neigh show dev eth0

# 查看IPv6邻居表
ip -6 neigh show

# 查看详细的邻居信息
ip -s neigh show

# 输出示例：
# 192.168.1.1 dev eth0 lladdr 00:11:22:33:44:55 REACHABLE
# 192.168.1.100 dev eth0 lladdr 00:aa:bb:cc:dd:ee STALE
# 192.168.1.200 dev eth0  INCOMPLETE
```

### 11.2 添加/删除邻居条目

```bash
# 添加静态ARP条目
ip neigh add 192.168.1.100 lladdr 00:11:22:33:44:55 dev eth0 nud permanent

# 修改邻居条目
ip neigh change 192.168.1.100 lladdr 00:aa:bb:cc:dd:ee dev eth0

# 删除邻居条目
ip neigh del 192.168.1.100 dev eth0

# 刷新邻居表
ip neigh flush dev eth0
```

### 11.3 通过proc查看

```bash
# 查看ARP表
cat /proc/net/arp

# 输出格式：
# IP address       HW type     Flags       HW address            Mask     Device
# 192.168.1.1      0x1         0x2         00:11:22:33:44:55     *        eth0

# 查看邻居统计
cat /proc/net/stat/arp_cache

# 查看ND表
cat /proc/net/ndisc_cache
```

### 11.4 sysctl参数配置

```bash
# ARP相关参数
sysctl -a | grep arp

# 常用参数：
# net.ipv4.neigh.default.gc_thresh1 = 128
# net.ipv4.neigh.default.gc_thresh2 = 512
# net.ipv4.neigh.default.gc_thresh3 = 1024
# net.ipv4.neigh.default.base_reachable_time_ms = 30000
# net.ipv4.neigh.default.retrans_time_ms = 1000
# net.ipv4.neigh.default.delay_first_probe_time = 5
# net.ipv4.neigh.default.gc_stale_time = 60
# net.ipv4.neigh.default.proxy_qlen = 64
# net.ipv4.neigh.default.anycast_delay = 100
# net.ipv4.neigh.default.proxy_delay = 80
# net.ipv4.neigh.default.locktime = 100

# 修改参数
sysctl -w net.ipv4.neigh.eth0.gc_thresh3=2048
```

### 11.5 常见问题排查

```
┌─────────────────────────────────────────────────────────────────┐
│                    常见问题与解决方案                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  问题1: ARP解析失败                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 现象: ping失败，状态显示INCOMPLETE                       │   │
│  │                                                         │   │
│  │ 排查步骤:                                               │   │
│  │ 1. 检查目标主机是否在线                                 │   │
│  │ 2. 检查防火墙是否阻止ARP                                │   │
│  │ 3. 使用tcpdump抓包分析                                  │   │
│  │    tcpdump -i eth0 arp                                  │   │
│  │ 4. 检查VLAN配置是否正确                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  问题2: ARP表项频繁失效                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 现象: 状态频繁变为STALE                                 │   │
│  │                                                         │   │
│  │ 解决方案:                                               │   │
│  │ 1. 增加reachable_time                                  │   │
│  │    sysctl -w net.ipv4.neigh.eth0.base_reachable_time_ms=60000 │
│  │                                                         │   │
│  │ 2. 添加静态ARP条目                                      │   │
│  │    ip neigh add ... nud permanent                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  问题3: ARP表溢出                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 现象: 内核日志显示"neighbor table overflow"             │   │
│  │                                                         │   │
│  │ 解决方案:                                               │   │
│  │ 1. 增加GC阈值                                           │   │
│  │    sysctl -w net.ipv4.neigh.default.gc_thresh3=8192     │   │
│  │                                                         │   │
│  │ 2. 检查是否有ARP攻击                                    │   │
│  │ 3. 启用ARP过滤                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  问题4: ARP欺骗攻击                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 现象: 网络不稳定，数据被劫持                            │   │
│  │                                                         │   │
│  │ 解决方案:                                               │   │
│  │ 1. 使用静态ARP条目                                      │   │
│  │ 2. 启用ARP验证                                          │   │
│  │ 3. 部署ARP防火墙                                        │   │
│  │ 4. 使用动态ARP检测工具                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 11.6 使用tcpdump分析

```bash
# 抓取ARP报文
tcpdump -i eth0 arp -nn

# 抓取IPv6 ND报文
tcpdump -i eth0 icmp6 and ip6[40] == 135 -nn  # NS
tcpdump -i eth0 icmp6 and ip6[40] == 136 -nn  # NA

# 输出示例：
# ARP, Request who-has 192.168.1.100 tell 192.168.1.1, length 28
# ARP, Reply 192.168.1.100 is-at 00:11:22:33:44:55, length 28
```

---

## 十二、用户空间API

### 12.1 netlink接口

```c
/* include/uapi/linux/neighbour.h */

/*
 * ndmsg - 邻居消息结构
 */
struct ndmsg {
    __u8    ndm_family;     /* 协议族 AF_INET/AF_INET6 */
    __u8    ndm_pad1;
    __u16   ndm_pad2;
    __s32   ndm_ifindex;    /* 接口索引 */
    __u16   ndm_state;      /* NUD状态 */
    __u8    ndm_flags;      /* NTF标志 */
    __u8    ndm_type;       /* 路由类型 */
};

/*
 * nda_cacheinfo - 缓存信息
 */
struct nda_cacheinfo {
    __u32   ndm_confirmed;  /* 确认时间 */
    __u32   ndm_used;       /* 使用时间 */
    __u32   ndm_updated;    /* 更新时间 */
    __u32   ndm_refcnt;     /* 引用计数 */
};

/* 属性类型 */
enum {
    NDA_UNSPEC,
    NDA_DST,        /* 目标地址 */
    NDA_LLADDR,     /* 链路层地址 */
    NDA_CACHEINFO,  /* 缓存信息 */
    NDA_PROBES,     /* 探测次数 */
    NDA_VLAN,       /* VLAN ID */
    NDA_PORT,       /* 端口号 */
    NDA_VNI,        /* VNI */
    NDA_IFINDEX,    /* 接口索引 */
    /* ... */
};
```

### 12.2 rtnetlink操作

```c
/* RTM_NEWNEIGH - 添加/修改邻居条目 */
/* RTM_DELNEIGH - 删除邻居条目 */
/* RTM_GETNEIGH - 获取邻居条目 */

/* 示例：添加邻居条目 */
struct nlmsghdr *nlh;
struct ndmsg *ndm;

nlh = nlmsg_put(skb, pid, seq, RTM_NEWNEIGH, sizeof(*ndm), NLM_F_CREATE|NLM_F_EXCL);
ndm = nlmsg_data(nlh);
ndm->ndm_family = AF_INET;
ndm->ndm_ifindex = if_nametoindex("eth0");
ndm->ndm_state = NUD_PERMANENT;
ndm->ndm_flags = 0;

nla_put(skb, NDA_DST, 4, &ip_addr);
nla_put(skb, NDA_LLADDR, 6, mac_addr);
```

---

## 十三、性能优化

### 13.1 硬件头缓存

```
┌─────────────────────────────────────────────────────────────────┐
│                    硬件头缓存 (hh_cache)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  目的：避免每次发送都重新构造以太网头                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ struct hh_cache {                                       │   │
│  │     struct hh_cache *hh_next;                           │   │
│  │     atomic_t    hh_refcnt;                              │   │
│  │     __be16      hh_type;     /* 协议类型 */             │   │
│  │     int         hh_len;      /* 头长度 */               │   │
│  │     char        hh_data[HH_DATA_MOD]; /* 缓存的头 */     │   │
│  │ };                                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  工作流程：                                                     │
│  1. 第一次发送时，解析MAC地址                                   │
│  2. 构造完整的以太网头                                          │
│  3. 缓存到hh_cache中                                           │
│  4. 后续发送直接复制缓存的头                                    │
│                                                                 │
│  性能提升：                                                     │
│  • 减少dev_hard_header()调用次数                                │
│  • 对于高速网络（10Gbps+）效果明显                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 13.2 参数调优建议

```bash
# 高流量服务器优化

# 增加邻居表大小
sysctl -w net.ipv4.neigh.default.gc_thresh1=512
sysctl -w net.ipv4.neigh.default.gc_thresh2=2048
sysctl -w net.ipv4.neigh.default.gc_thresh3=4096

# 增加可达时间（减少探测）
sysctl -w net.ipv4.neigh.default.base_reachable_time_ms=60000

# 减少重传时间
sysctl -w net.ipv4.neigh.default.retrans_time_ms=500

# 增加队列长度
sysctl -w net.ipv4.neigh.default.queue_len_bytes=1048576

# IPv6同样配置
sysctl -w net.ipv6.neigh.default.gc_thresh3=4096
sysctl -w net.ipv6.neigh.default.base_reachable_time_ms=60000
```

---

## 总结

### 核心要点回顾

```
┌─────────────────────────────────────────────────────────────────┐
│                    邻居子系统核心要点                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 架构设计                                                    │
│     • 统一的邻居子系统框架，同时支持ARP和ND                     │
│     • 核心数据结构：neighbour、neigh_table、neigh_parms         │
│     • 通过neigh_ops实现协议特定的操作                           │
│                                                                 │
│  2. NUD状态机                                                   │
│     • 六个主要状态：INCOMPLETE、REACHABLE、STALE、              │
│       DELAY、PROBE、FAILED                                      │
│     • 定时器驱动的状态转换                                      │
│     • 可达性检测保证邻居有效性                                  │
│                                                                 │
│  3. ARP vs ND                                                   │
│     • ARP：独立协议，广播请求                                   │
│     • ND：ICMPv6消息，组播请求，功能更丰富                      │
│                                                                 │
│  4. 缓存管理                                                    │
│     • 哈希表组织邻居条目                                        │
│     • 垃圾回收防止表溢出                                        │
│     • 硬件头缓存提升性能                                        │
│                                                                 │
│  5. 代理功能                                                    │
│     • 代理ARP/代理ND支持                                        │
│     • 用于路由器、VPN等场景                                     │
│                                                                 │
│  6. 用户接口                                                    │
│     • ip neigh命令管理                                          │
│     • sysctl参数配置                                            │
│     • netlink编程接口                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 关键源文件

| 文件路径 | 功能说明 |
|----------|----------|
| `include/net/neighbour.h` | 邻居子系统核心数据结构定义 |
| `include/uapi/linux/neighbour.h` | 用户空间API定义 |
| `net/core/neighbour.c` | 邻居子系统核心实现 |
| `net/ipv4/arp.c` | ARP协议实现 |
| `net/ipv6/ndisc.c` | ND协议实现 |

### 学习建议

1. **从实践入手**：使用`ip neigh`命令观察和操作邻居表
2. **理解状态机**：通过tcpdump观察ARP/ND报文，理解状态转换
3. **阅读源码**：从`neigh_lookup`、`neigh_update`等核心函数开始
4. **实验验证**：修改参数，观察行为变化
5. **深入细节**：研究垃圾回收、代理等高级功能

---

> 本文档基于 Linux 5.15 内核源码分析，从初学者角度详细讲解了邻居子系统的核心概念、数据结构、协议实现和工作流程。通过理解邻居子系统，可以更好地掌握Linux网络协议栈的地址解析机制。