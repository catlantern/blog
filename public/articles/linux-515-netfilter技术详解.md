# Linux 5.15 Netfilter技术详解

> 本文档从初学者角度详细讲解Linux内核Netfilter框架，涵盖5个钩子点、nf_hook_ops注册机制、iptables底层实现，以及如何编写内核模块在NF_IP_LOCAL_OUT钩子上打印所有本机发出的包。

---

## 目录

1. **`Netfilter概述`**
2. **`Netfilter核心数据结构`**
3. **`五个钩子点详解`**
4. **`nf_hook_ops注册机制`**
5. **`iptables底层实现`**
6. **`内核模块示例`**
7. **`实际应用场景`**
8. **`调试与问题排查`**
9. **`总结`**

---

## 一、Netfilter概述

### 1.1 Netfilter在网络协议栈中的位置

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter框架位置                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    应用层                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Socket层                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              ★ Netfilter框架 ★                          │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │  5个钩子点：                                     │   │   │
│  │  │                                                 │   │   │
│  │  │  1. NF_INET_PRE_ROUTING   (路由前)              │   │   │
│  │  │  2. NF_INET_LOCAL_IN      (本地接收)            │   │   │
│  │  │  3. NF_INET_FORWARD       (转发)                │   │   │
│  │  │  4. NF_INET_LOCAL_OUT     (本地发送)            │   │   │
│  │  │  5. NF_INET_POST_ROUTING  (路由后)              │   │   │
│  │  │                                                 │   │   │
│  │  │  功能：                                         │   │   │
│  │  │  • 包过滤（iptables）                           │   │   │
│  │  │  • NAT（网络地址转换）                          │   │   │
│  │  │  • 连接跟踪（conntrack）                        │   │   │
│  │  │  • 包修改                                       │   │   │
│  │  │  • 包排队                                       │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    IP层                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    链路层                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Netfilter的功能

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter核心功能                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 包过滤（Packet Filtering）                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 根据规则决定是否接受或丢弃包                        │       │
│  │ • 支持多种匹配条件（源IP、目的IP、端口等）            │       │
│  │ • 实现防火墙功能                                      │       │
│  │ • 工具：iptables、nftables                            │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  2. NAT（Network Address Translation）                         │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 源NAT（SNAT）：修改源地址                           │       │
│  │ • 目的NAT（DNAT）：修改目的地址                       │       │
│  │ • 伪装（MASQUERADE）：动态SNAT                        │       │
│  │ • 端口转发（REDIRECT）：本地端口重定向                │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  3. 连接跟踪（Connection Tracking）                            │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 跟踪连接状态                                        │       │
│  │ • 支持状态检测（NEW、ESTABLISHED、RELATED等）         │       │
│  │ • NAT的基础                                           │       │
│  │ • 模块：nf_conntrack                                  │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  4. 包修改（Packet Mangling）                                  │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 修改TTL值                                           │       │
│  │ • 修改ToS字段                                         │       │
│  │ • 设置Mark标记                                        │       │
│  │ • 修改TCP选项                                         │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  5. 包排队（Packet Queuing）                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 将包传递到用户空间                                  │       │
│  │ • 用户空间处理后返回决策                              │       │
│  │ • 工具：libnetfilter_queue                            │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Netfilter设计理念

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter设计理念                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  核心思想：                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 1. 在协议栈关键位置插入钩子点                          │       │
│  │ 2. 允许内核模块注册回调函数                            │       │
│  │ 3. 数据包经过钩子点时调用所有注册的回调                │       │
│  │ 4. 回调函数返回决策（接受、丢弃、排队等）              │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  优势：                                                         │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 模块化：各功能独立实现                              │       │
│  │ • 可扩展：易于添加新功能                              │       │
│  │ • 高性能：在内核空间处理                              │       │
│  │ • 灵活性：支持复杂的包处理逻辑                        │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  架构层次：                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │                                                       │       │
│  │  用户空间工具                                         │       │
│  │  ├─▶ iptables / nftables（规则配置）                  │       │
│  │  └─▶ libnetfilter_queue（包排队处理）                 │       │
│  │                                                       │       │
│  │  内核模块                                             │       │
│  │  ├─▶ iptable_filter（过滤表）                         │       │
│  │  ├─▶ iptable_nat（NAT表）                             │       │
│  │  ├─▶ nf_conntrack（连接跟踪）                         │       │
│  │  └─▶ 自定义模块                                       │       │
│  │                                                       │       │
│  │  Netfilter核心                                        │       │
│  │  ├─▶ 钩子点管理                                       │       │
│  │  ├─▶ 回调注册                                         │       │
│  │  └─▶ 决策处理                                         │       │
│  │                                                       │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、Netfilter核心数据结构

### 2.1 nf_hook_ops 结构

```c
/* include/linux/netfilter.h */

/*
 * nf_hook_ops - Netfilter钩子操作结构
 * 
 * 这是Netfilter最核心的数据结构
 * 每个内核模块通过此结构注册自己的钩子函数
 */
struct nf_hook_ops {
    /* 钩子函数指针（必须） */
    nf_hookfn *hook;
    
    /* 关联的网络设备（可选） */
    struct net_device *dev;
    
    /* 私有数据（可选） */
    void *priv;
    
    /* 协议族（必须） */
    u8 pf;  /* NFPROTO_IPV4, NFPROTO_IPV6等 */
    
    /* 钩子操作类型 */
    enum nf_hook_ops_type hook_ops_type:8;
    
    /* 钩子点编号（必须） */
    unsigned int hooknum;  /* NF_INET_PRE_ROUTING等 */
    
    /* 优先级（必须） */
    int priority;  /* 数值越小优先级越高 */
};
```

**关键字段说明：**

1. **hook**: 钩子函数指针
   - 原型：`unsigned int nf_hookfn(void *priv, struct sk_buff *skb, const struct nf_hook_state *state)`
   - 返回值：NF_ACCEPT、NF_DROP、NF_STOLEN、NF_QUEUE等

2. **pf**: 协议族
   - NFPROTO_IPV4 (2): IPv4
   - NFPROTO_IPV6 (10): IPv6
   - NFPROTO_ARP (3): ARP
   - NFPROTO_BRIDGE (7): 桥接

3. **hooknum**: 钩子点编号
   - NF_INET_PRE_ROUTING (0): 路由前
   - NF_INET_LOCAL_IN (1): 本地接收
   - NF_INET_FORWARD (2): 转发
   - NF_INET_LOCAL_OUT (3): 本地发送
   - NF_INET_POST_ROUTING (4): 路由后

4. **priority**: 优先级
   - 数值越小优先级越高
   - 常用优先级：NF_IP_PRI_FIRST (-2147483648)、NF_IP_PRI_CONNTRACK (-200)、NF_IP_PRI_MANGLE (-150)、NF_IP_PRI_NAT_SRC (100)、NF_IP_PRI_LAST (2147483647)

### 2.2 nf_hook_state 结构

```c
/* include/linux/netfilter.h */

/*
 * nf_hook_state - 钩子状态结构
 * 
 * 在钩子函数调用时传递，包含包处理的上下文信息
 */
struct nf_hook_state {
    u8 hook;      /* 钩子点编号 */
    u8 pf;        /* 协议族 */
    
    struct net_device *in;   /* 输入网络设备 */
    struct net_device *out;  /* 输出网络设备 */
    
    struct sock *sk;         /* 关联的socket */
    struct net *net;         /* 网络命名空间 */
    
    /* 继续处理函数 */
    int (*okfn)(struct net *, struct sock *, struct sk_buff *);
};
```

**关键字段说明：**

1. **hook**: 当前钩子点编号
2. **pf**: 协议族
3. **in**: 输入网络设备（对于接收的包）
4. **out**: 输出网络设备（对于发送的包）
5. **sk**: 关联的socket（如果有的话）
6. **net**: 网络命名空间（支持容器）
7. **okfn**: 如果所有钩子都返回NF_ACCEPT，最终调用的函数

### 2.3 钩子函数返回值

```c
/* include/uapi/linux/netfilter.h */

/* 钩子函数的返回值（决策） */
#define NF_DROP    0  /* 丢弃包 */
#define NF_ACCEPT  1  /* 接受包，继续处理 */
#define NF_STOLEN  2  /* 包已被钩子函数接管，不再继续处理 */
#define NF_QUEUE   3  /* 将包排队到用户空间 */
#define NF_REPEAT  4  /* 重新调用当前钩子 */
#define NF_STOP    5  /* 停止调用后续钩子，已废弃 */
```

**返回值详解：**

| 返回值 | 含义 | 说明 |
|--------|------|------|
| **NF_DROP** | 丢弃包 | 包被丢弃，释放skb |
| **NF_ACCEPT** | 接受包 | 继续调用下一个钩子或okfn |
| **NF_STOLEN** | 接管包 | 钩子函数已处理包，不再继续 |
| **NF_QUEUE** | 排队包 | 将包发送到用户空间处理 |
| **NF_REPEAT** | 重复调用 | 重新调用当前钩子（慎用） |

### 2.4 数据结构关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter数据结构关系                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  struct net (网络命名空间)                                      │
│  └─▶ net->nf.hooks_ipv4[5]                                     │
│       │                                                         │
│       ├─▶ hooks_ipv4[0] ──▶ nf_hook_entries (PREROUTING)        │
│       │                    ├─▶ hook[0] (priority=-200)          │
│       │                    ├─▶ hook[1] (priority=-150)          │
│       │                    └─▶ hook[2] (priority=0)             │
│       │                                                         │
│       ├─▶ hooks_ipv4[1] ──▶ nf_hook_entries (LOCAL_IN)          │
│       │                                                         │
│       ├─▶ hooks_ipv4[2] ──▶ nf_hook_entries (FORWARD)           │
│       │                                                         │
│       ├─▶ hooks_ipv4[3] ──▶ nf_hook_entries (LOCAL_OUT)         │
│       │                                                         │
│       └─▶ hooks_ipv4[4] ──▶ nf_hook_entries (POST_ROUTING)      │
│                                                                 │
│  注册流程：                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 1. 定义nf_hook_ops结构                                │       │
│  │    ├─▶ 设置hook函数                                   │       │
│  │    ├─▶ 设置pf（协议族）                               │       │
│  │    ├─▶ 设置hooknum（钩子点）                          │       │
│  │    └─▶ 设置priority（优先级）                         │       │
│  │                                                       │       │
│  │ 2. 调用nf_register_net_hook()注册                     │       │
│  │    └─▶ 将ops插入到对应钩子点数组                      │       │
│  │        └─▶ 按priority排序                             │       │
│  │                                                       │       │
│  │ 3. 包经过钩子点时                                     │       │
│  │    └─▶ 按优先级顺序调用所有hook函数                   │       │
│  │        └─▶ 根据返回值决定后续处理                     │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、五个钩子点详解

### 3.1 钩子点位置图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter五个钩子点位置                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    外部网络                                     │
│                       │                                         │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │  网络接口       │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│                       ▼                                         │
│        ┌──────────────────────────────┐                         │
│        │  ① NF_INET_PRE_ROUTING      │  ← 路由判断前           │
│        │     (PREROUTING)             │                         │
│        └──────────┬───────────────────┘                         │
│                   │                                             │
│                   ▼                                             │
│        ┌─────────────────────┐                                  │
│        │    路由判断         │                                  │
│        └──────┬──────────────┘                                  │
│               │                                                 │
│        ┌──────┴──────┐                                          │
│        │             │                                          │
│        ▼             ▼                                          │
│   ┌─────────┐   ┌─────────┐                                     │
│   │ 本地    │   │ 转发    │                                     │
│   │ 接收    │   │ 路径    │                                     │
│   └────┬────┘   └────┬────┘                                     │
│        │             │                                          │
│        ▼             ▼                                          │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │② NF_INET_    │  │③ NF_INET_    │  ← 转发前                  │
│  │  LOCAL_IN    │  │  FORWARD     │                             │
│  └──────┬───────┘  └──────┬───────┘                             │
│         │                 │                                     │
│         ▼                 │                                     │
│  ┌──────────────┐         │                                     │
│  │  本地处理    │         │                                     │
│  │  (应用层)    │         │                                     │
│  └──────┬───────┘         │                                     │
│         │                 │                                     │
│         ▼                 │                                     │
│  ┌──────────────┐         │                                     │
│  │④ NF_INET_    │         │  ← 本地发送前                       │
│  │  LOCAL_OUT   │         │                                     │
│  └──────┬───────┘         │                                     │
│         │                 │                                     │
│         └────────┬────────┘                                     │
│                  │                                              │
│                  ▼                                              │
│        ┌──────────────────────┐                                 │
│        │ ⑤ NF_INET_POST_     │  ← 路由判断后，发送前           │
│        │    ROUTING           │                                 │
│        └──────────┬───────────┘                                 │
│                   │                                             │
│                   ▼                                             │
│              ┌─────────────────┐                                │
│              │  网络接口       │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│                       ▼                                         │
│                    外部网络                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 各钩子点详解

#### ① NF_INET_PRE_ROUTING (PREROUTING)

```
┌─────────────────────────────────────────────────────────────────┐
│  ① NF_INET_PRE_ROUTING (PREROUTING)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  触发时机：                                                     │
│  • 包刚从网络接口接收                           │
│  • IP层处理之前                                                 │
│  • 路由判断之前                                                 │
│                                                                 │
│  特点：                                                         │
│  • 所有接收到的包都会经过此点                                   │
│  • 此时包的目的地址还未确定（本地或转发）                       │
│  • 可以看到最原始的包                                           │
│                                                                 │
│  典型应用：                                                     │
│  • DNAT（目的地址转换）                                         │
│  • 连接跟踪初始化                                               │
│  • 去重（defragmentation）                                      │
│  • 原始包日志记录                                               │
│                                                                 │
│  iptables链：PREROUTING                                         │
│  • raw表、conntrack表、mangle表、nat表                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### ② NF_INET_LOCAL_IN (INPUT)

```
┌─────────────────────────────────────────────────────────────────┐
│  ② NF_INET_LOCAL_IN (INPUT)                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  触发时机：                                                     │
│  • 路由判断确定包是发给本机的                                   │
│  • 传递给本地上层协议之前                                       │
│                                                                 │
│  特点：                                                         │
│  • 只有目的地址是本机的包才经过                                 │
│  • 可以用于过滤进入本机的包                                     │
│  • 此时已经完成了DNAT                                           │
│                                                                 │
│  典型应用：                                                     │
│  • 防火墙过滤（INPUT链）                                        │
│  • 连接跟踪确认                                                 │
│  • 包统计                                                       │
│                                                                 │
│  iptables链：INPUT                                              │
│  • mangle表、filter表、security表                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### ③ NF_INET_FORWARD (FORWARD)

```
┌─────────────────────────────────────────────────────────────────┐
│  ③ NF_INET_FORWARD (FORWARD)                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  触发时机：                                                     │
│  • 路由判断确定包需要转发                                       │
│  • 转发到输出接口之前                                           │
│                                                                 │
│  特点：                                                         │
│  • 只有需要转发的包才经过                                       │
│  • 源和目的地址都不是本机                                       │
│  • 用于路由器/网关                                              │
│                                                                 │
│  典型应用：                                                     │
│  • 转发过滤（FORWARD链）                                        │
│  • 路由器防火墙                                                 │
│  • 转发包统计                                                   │
│                                                                 │
│  iptables链：FORWARD                                            │
│  • mangle表、filter表、security表                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### ④ NF_INET_LOCAL_OUT (OUTPUT)

```
┌─────────────────────────────────────────────────────────────────┐
│  ④ NF_INET_LOCAL_OUT (OUTPUT)                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  触发时机：                                                     │
│  • 本机产生的包                                                 │
│  • 路由判断之前                                                 │
│  • 发送到网络接口之前                                           │
│                                                                 │
│  特点：                                                         │
│  • 只有本机发出的包才经过                                       │
│  • 源地址是本机                                                 │
│  • 可以修改本地发出的包                                         │
│                                                                 │
│  典型应用：                                                     │
│  • 本地包过滤（OUTPUT链）                                       │
│  • 本地包修改                                                   │
│  • 本地包日志                                                   │
│  • ★ 监控本机发出的所有包（本次任务重点）                       │
│                                                                 │
│  iptables链：OUTPUT                                             │
│  • raw表、conntrack表、mangle表、nat表、filter表、security表    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### ⑤ NF_INET_POST_ROUTING (POSTROUTING)

```
┌─────────────────────────────────────────────────────────────────┐
│  ⑤ NF_INET_POST_ROUTING (POSTROUTING)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  触发时机：                                                     │
│  • 路由判断之后                                                 │
│  • 发送到网络接口之前                                           │
│  • 所有发出的包（本地发出或转发）                               │
│                                                                 │
│  特点：                                                         │
│  • 所有发出的包都会经过此点                                     │
│  • 最后一个钩子点                                               │
│  • 可以看到最终的包（已完成所有修改）                           │
│                                                                 │
│  典型应用：                                                     │
│  • SNAT（源地址转换）                                           │
│  • 伪装（MASQUERADE）                                           │
│  • 最终包日志                                                   │
│  • QoS标记                                                      │
│                                                                 │
│  iptables链：POSTROUTING                                        │
│  • mangle表、nat表                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、nf_hook_ops注册机制

### 4.1 注册函数

```c
/* net/netfilter/core.c */

/*
 * nf_register_net_hook - 注册Netfilter钩子
 * @net: 网络命名空间
 * @reg: 钩子操作结构
 *
 * 返回：0成功，负数错误码
 */
int nf_register_net_hook(struct net *net, const struct nf_hook_ops *reg)
{
    int err;

    /* 根据协议族选择处理方式 */
    switch (reg->pf) {
    case NFPROTO_INET:
        /* 同时注册IPv4和IPv6 */
        err = __nf_register_net_hook(net, NFPROTO_INET, reg);
        if (err < 0)
            return err;
        break;
        
    case NFPROTO_IPV4:
    case NFPROTO_IPV6:
        /* 单独注册IPv4或IPv6 */
        err = __nf_register_net_hook(net, reg->pf, reg);
        if (err < 0)
            return err;
        break;
        
    default:
        /* 其他协议族 */
        err = __nf_register_net_hook(net, reg->pf, reg);
        if (err < 0)
            return err;
    }

    return 0;
}
EXPORT_SYMBOL(nf_register_net_hook);
```

### 4.2 注销函数

```c
/*
 * nf_unregister_net_hook - 注销Netfilter钩子
 * @net: 网络命名空间
 * @reg: 钩子操作结构
 */
void nf_unregister_net_hook(struct net *net, const struct nf_hook_ops *reg)
{
    /* 根据协议族选择处理方式 */
    switch (reg->pf) {
    case NFPROTO_INET:
        __nf_unregister_net_hook(net, NFPROTO_INET, reg);
        break;
    case NFPROTO_IPV4:
    case NFPROTO_IPV6:
        __nf_unregister_net_hook(net, reg->pf, reg);
        break;
    default:
        __nf_unregister_net_hook(net, reg->pf, reg);
    }
}
EXPORT_SYMBOL(nf_unregister_net_hook);
```

### 4.3 注册流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                nf_hook_ops注册流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 定义nf_hook_ops结构                                         │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ static struct nf_hook_ops my_hook = {                │       │
│  │     .hook = my_hook_function,                        │       │
│  │     .pf = NFPROTO_IPV4,                              │       │
│  │     .hooknum = NF_INET_LOCAL_OUT,                    │       │
│  │     .priority = NF_IP_PRI_FIRST,                     │       │
│  │ };                                                   │       │
│  └─────────────────────────────────────────────────────┘       │
│                           │                                     │
│                           ▼                                     │
│  2. 调用nf_register_net_hook()                                  │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ nf_register_net_hook(&init_net, &my_hook);           │       │
│  └─────────────────────────────────────────────────────┘       │
│                           │                                     │
│                           ▼                                     │
│  3. 注册完成，钩子函数生效                                       │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 当包经过NF_INET_LOCAL_OUT时，                        │       │
│  │ my_hook_function()会被调用                           │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、iptables底层实现

### 5.1 iptables架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    iptables架构层次                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户空间                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  iptables命令                                            │   │
│  │  ├─▶ 解析命令行参数                                      │   │
│  │  ├─▶ 构造规则结构                                        │   │
│  │  └─▶ 通过setsockopt()传递到内核                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  内核空间                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  x_tables框架                                            │   │
│  │  ├─▶ 规则管理                                            │   │
│  │  ├─▶ 表管理                                              │   │
│  │  └─▶ 匹配和目标管理                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  具体表实现                                              │   │
│  │  ├─▶ iptable_filter（filter表）                          │   │
│  │  ├─▶ iptable_nat（nat表）                                │   │
│  │  ├─▶ iptable_mangle（mangle表）                          │   │
│  │  └─▶ iptable_raw（raw表）                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Netfilter核心                                           │   │
│  │  └─▶ 钩子点调用                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 iptables与Netfilter的连接

```
┌─────────────────────────────────────────────────────────────────┐
│            iptables如何注册到Netfilter                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 模块初始化（以iptable_filter为例）                           │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ static int __init iptable_filter_init(void)          │       │
│  │ {                                                     │       │
│  │     /* 注册Netfilter钩子 */                           │       │
│  │     return xt_register_template(&filter_template,    │       │
│  │                                 packet_ops);         │       │
│  │ }                                                     │       │
│  └─────────────────────────────────────────────────────┘       │
│                           │                                     │
│                           ▼                                     │
│  2. 定义钩子操作                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ static const struct nf_hook_ops packet_ops[] = {     │       │
│  │     {                                                 │       │
│  │         .hook     = ipt_do_table,                    │       │
│  │         .pf       = NFPROTO_IPV4,                    │       │
│  │         .hooknum  = NF_INET_LOCAL_IN,                │       │
│  │         .priority = NF_IP_PRI_FILTER,                │       │
│  │         .priv     = (void *) &filter_table,          │       │
│  │     },                                                │       │
│  │     /* ... 其他钩子点 ... */                          │       │
│  │ };                                                   │       │
│  └─────────────────────────────────────────────────────┘       │
│                           │                                     │
│                           ▼                                     │
│  3. 数据包处理流程                                               │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ a. 数据包到达Netfilter钩子点                         │       │
│  │                                                       │       │
│  │ b. 调用ipt_do_table()                                │       │
│  │    ├─▶ 获取filter表的规则                            │       │
│  │    ├─▶ 遍历规则进行匹配                              │       │
│  │    └─▶ 执行匹配规则的目标                            │       │
│  │                                                       │       │
│  │ c. 返回决策（NF_ACCEPT/NF_DROP等）                   │       │
│  │                                                       │       │
│  │ d. Netfilter根据决策处理包                           │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、内核模块示例

### 6.1 完整的内核模块代码

```c
/*
 * nf_local_out_monitor.c - 监控本机发出的所有包
 * 
 * 功能：在NF_INET_LOCAL_OUT钩子上打印所有本机发出的包
 * 
 * 编译：
 *   make
 * 
 * 加载：
 *   insmod nf_local_out_monitor.ko
 * 
 * 卸载：
 *   rmmod nf_local_out_monitor
 * 
 * 查看输出：
 *   dmesg | tail
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/netfilter.h>
#include <linux/netfilter_ipv4.h>
#include <linux/skbuff.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <linux/udp.h>
#include <linux/icmp.h>
#include <net/tcp.h>

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Your Name");
MODULE_DESCRIPTION("Monitor all outgoing packets via NF_INET_LOCAL_OUT");
MODULE_VERSION("1.0");

/* 钩子函数 */
static unsigned int
local_out_hook(void *priv, struct sk_buff *skb,
               const struct nf_hook_state *state)
{
    struct iphdr *iph;
    struct tcphdr *tcph;
    struct udphdr *udph;
    char saddr[16], daddr[16];
    
    /* 检查skb是否有效 */
    if (!skb)
        return NF_ACCEPT;
    
    /* 获取IP头 */
    iph = ip_hdr(skb);
    if (!iph)
        return NF_ACCEPT;
    
    /* 将IP地址转换为字符串 */
    snprintf(saddr, sizeof(saddr), "%pI4", &iph->saddr);
    snprintf(daddr, sizeof(daddr), "%pI4", &iph->daddr);
    
    /* 根据协议类型打印不同信息 */
    switch (iph->protocol) {
    case IPPROTO_TCP:
        tcph = tcp_hdr(skb);
        if (tcph) {
            pr_info("[LOCAL_OUT] TCP: %s:%d -> %s:%d, len=%u, flags=%s%s%s%s\n",
                    saddr, ntohs(tcph->source),
                    daddr, ntohs(tcph->dest),
                    skb->len,
                    tcph->syn ? "SYN " : "",
                    tcph->ack ? "ACK " : "",
                    tcph->fin ? "FIN " : "",
                    tcph->rst ? "RST " : "");
        }
        break;
        
    case IPPROTO_UDP:
        udph = udp_hdr(skb);
        if (udph) {
            pr_info("[LOCAL_OUT] UDP: %s:%d -> %s:%d, len=%u\n",
                    saddr, ntohs(udph->source),
                    daddr, ntohs(udph->dest),
                    skb->len);
        }
        break;
        
    case IPPROTO_ICMP:
        pr_info("[LOCAL_OUT] ICMP: %s -> %s, len=%u, type=%d\n",
                saddr, daddr, skb->len, iph->protocol);
        break;
        
    default:
        pr_info("[LOCAL_OUT] IP: %s -> %s, proto=%d, len=%u\n",
                saddr, daddr, iph->protocol, skb->len);
        break;
    }
    
    /* 返回NF_ACCEPT，允许包继续传递 */
    return NF_ACCEPT;
}

/* 定义钩子操作结构 */
static struct nf_hook_ops local_out_ops = {
    .hook     = local_out_hook,        /* 钩子函数 */
    .pf       = NFPROTO_IPV4,          /* IPv4协议 */
    .hooknum  = NF_INET_LOCAL_OUT,     /* LOCAL_OUT钩子点 */
    .priority = NF_IP_PRI_FIRST,       /* 最高优先级 */
};

/* 模块初始化 */
static int __init nf_local_out_init(void)
{
    int ret;
    
    pr_info("nf_local_out_monitor: Initializing module\n");
    
    /* 注册钩子 */
    ret = nf_register_net_hook(&init_net, &local_out_ops);
    if (ret) {
        pr_err("nf_local_out_monitor: Failed to register hook\n");
        return ret;
    }
    
    pr_info("nf_local_out_monitor: Hook registered successfully\n");
    return 0;
}

/* 模块退出 */
static void __exit nf_local_out_exit(void)
{
    pr_info("nf_local_out_monitor: Exiting module\n");
    
    /* 注销钩子 */
    nf_unregister_net_hook(&init_net, &local_out_ops);
    
    pr_info("nf_local_out_monitor: Hook unregistered\n");
}

module_init(nf_local_out_init);
module_exit(nf_local_out_exit);
```

### 6.2 Makefile

```makefile
# Makefile for nf_local_out_monitor

obj-m += nf_local_out_monitor.o

KDIR := /lib/modules/$(shell uname -r)/build
PWD := $(shell pwd)

all:
	$(MAKE) -C $(KDIR) M=$(PWD) modules

clean:
	$(MAKE) -C $(KDIR) M=$(PWD) clean

install:
	insmod nf_local_out_monitor.ko

uninstall:
	rmmod nf_local_out_monitor
```

### 6.3 使用说明

```bash
# 编译模块
make

# 加载模块
sudo insmod nf_local_out_monitor.ko

# 查看输出
dmesg | tail

# 输出示例：
[12345.678901] nf_local_out_monitor: Initializing module
[12345.678902] nf_local_out_monitor: Hook registered successfully
[12346.123456] [LOCAL_OUT] TCP: 192.168.1.100:54321 -> 8.8.8.8:80, len=60, flags=SYN 
[12346.123789] [LOCAL_OUT] TCP: 192.168.1.100:54321 -> 8.8.8.8:80, len=60, flags=ACK 
[12346.124012] [LOCAL_OUT] UDP: 192.168.1.100:12345 -> 8.8.4.4:53, len=60

# 卸载模块
sudo rmmod nf_local_out_monitor
```

---

## 七、实际应用场景

### 7.1 防火墙实现

```c
/*
 * 简单防火墙示例
 * 根据IP地址和端口过滤包
 */
static unsigned int
firewall_hook(void *priv, struct sk_buff *skb,
              const struct nf_hook_state *state)
{
    struct iphdr *iph;
    struct tcphdr *tcph;
    
    if (!skb)
        return NF_ACCEPT;
    
    iph = ip_hdr(skb);
    if (!iph)
        return NF_ACCEPT;
    
    /* 示例：阻止特定IP */
    if (iph->saddr == htonl(0xC0A80101)) { /* 192.168.1.1 */
        pr_info("Firewall: Blocked packet from 192.168.1.1\n");
        return NF_DROP;
    }
    
    /* 示例：阻止特定端口 */
    if (iph->protocol == IPPROTO_TCP) {
        tcph = tcp_hdr(skb);
        if (tcph && ntohs(tcph->dest) == 23) { /* Telnet */
            pr_info("Firewall: Blocked Telnet traffic\n");
            return NF_DROP;
        }
    }
    
    return NF_ACCEPT;
}
```

### 7.2 NAT实现

```c
/*
 * 简单NAT示例
 * 修改源IP地址
 */
static unsigned int
snat_hook(void *priv, struct sk_buff *skb,
          const struct nf_hook_state *state)
{
    struct iphdr *iph;
    __be32 new_saddr = htonl(0xC0A80164); /* 192.168.1.100 */
    
    if (!skb)
        return NF_ACCEPT;
    
    iph = ip_hdr(skb);
    if (!iph)
        return NF_ACCEPT;
    
    /* 修改源地址 */
    iph->saddr = new_saddr;
    
    /* 重新计算校验和 */
    ip_send_check(iph);
    
    pr_info("SNAT: Changed source to 192.168.1.100\n");
    
    return NF_ACCEPT;
}
```

---

## 八、调试与问题排查

### 8.1 常见问题

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter常见问题                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 钩子函数未被调用                                           │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 原因：                                                │       │
│  │   • 钩子未正确注册                                    │       │
│  │   • 协议族错误                                        │       │
│  │   • 钩子点编号错误                                    │       │
│  │ 排查：                                                │       │
│  │   • 检查nf_register_net_hook()返回值                 │       │
│  │   • 使用dmesg查看错误信息                             │       │
│  │   • 检查pf和hooknum是否正确                           │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  2. 系统崩溃或死锁                                             │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 原因：                                                │       │
│  │   • 钩子函数中睡眠                                    │       │
│  │   • 锁使用不当                                        │       │
│  │   • 访问无效内存                                      │       │
│  │ 解决：                                                │       │
│  │   • 钩子函数不能睡眠                                  │       │
│  │   • 使用spin_lock而不是mutex                         │       │
│  │   • 检查所有指针有效性                                │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  3. 性能问题                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 原因：                                                │       │
│  │   • 钩子函数处理太慢                                  │       │
│  │   • 打印太多日志                                      │       │
│  │   • 锁竞争严重                                        │       │
│  │ 解决：                                                │       │
│  │   • 优化钩子函数逻辑                                  │       │
│  │   • 减少不必要的打印                                  │       │
│  │   • 使用per-cpu变量                                   │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 调试工具

```bash
# 1. dmesg - 查看内核日志
dmesg | tail

# 2. lsmod - 查看已加载模块
lsmod | grep nf

# 3. modinfo - 查看模块信息
modinfo nf_local_out_monitor

# 4. iptables - 查看规则
iptables -L -n -v
iptables -t nat -L -n -v
iptables -t mangle -L -n -v

# 5. conntrack - 查看连接跟踪
cat /proc/net/nf_conntrack
conntrack -L

# 6. tcpdump - 抓包验证
tcpdump -i eth0 -nn
```

### 8.3 最佳实践

```
┌─────────────────────────────────────────────────────────────────┐
│                    Netfilter最佳实践                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 性能优化                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 钩子函数要快速执行                                  │       │
│  │ • 避免在钩子函数中睡眠                                │       │
│  │ • 使用per-cpu变量减少锁竞争                          │       │
│  │ • 尽早返回NF_ACCEPT                                   │       │
│  │ • 减少不必要的日志打印                                │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  2. 安全性                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 检查所有指针有效性                                  │       │
│  │ • 检查skb长度是否足够                                 │       │
│  │ • 使用RCU保护共享数据                                 │       │
│  │ • 正确处理错误情况                                    │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  3. 可维护性                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 添加清晰的注释                                      │       │
│  │ • 使用有意义的变量名                                  │       │
│  │ • 提供统计和调试接口                                  │       │
│  │ • 正确处理模块卸载                                    │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 总结

### 核心要点回顾

1. **Netfilter框架**
   - Linux内核包处理的核心框架
   - 通过5个钩子点实现包的拦截和处理
   - 支持包过滤、NAT、连接跟踪等功能

2. **五个钩子点**
   - **NF_INET_PRE_ROUTING**: 路由前，所有接收包
   - **NF_INET_LOCAL_IN**: 本地接收包
   - **NF_INET_FORWARD**: 转发包
   - **NF_INET_LOCAL_OUT**: 本地发送包（本次重点）
   - **NF_INET_POST_ROUTING**: 路由后，所有发送包

3. **nf_hook_ops结构**
   - 核心数据结构，用于注册钩子函数
   - 关键字段：hook、pf、hooknum、priority
   - 通过nf_register_net_hook()注册

4. **内核模块示例**
   - 实现了在NF_INET_LOCAL_OUT钩子上监控所有本机发出的包
   - 包含完整的代码、Makefile和使用说明
   - 可以直接编译使用

### 学习建议

1. **从简单到复杂**
   - 先理解Netfilter框架原理
   - 再学习钩子点位置和作用
   - 最后编写内核模块实践

2. **理论结合实践**
   - 编写并加载示例模块
   - 使用dmesg观察输出
   - 尝试修改和扩展功能

3. **关注关键点**
   - 钩子函数的返回值含义
   - 优先级的作用
   - 性能和安全性考虑

4. **善用调试工具**
   - dmesg、lsmod、modinfo
   - iptables、tcpdump
   - 内核调试选项

### 参考资源

1. **内核文档**
   - Documentation/networking/netfilter.txt
   - net/netfilter/core.c

2. **书籍推荐**
   - 《Linux内核网络协议栈源码剖析》
   - 《Understanding Linux Network Internals》

---

**文档版本**: v1.0  
**内核版本**: Linux 5.15  
**最后更新**: 2026-06-05