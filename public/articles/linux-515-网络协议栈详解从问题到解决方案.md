# Linux 5.15 网络协议栈详解：从问题到解决方案

## 目标

读完本文，你要明白两件事：

1. **Linux 网络协议栈是怎么工作的**
2. **为什么要设计成这样**

---

# 一、先从最根本的问题开始：程序需要网络通信

程序需要网络通信来：

- 发送数据（如 HTTP 请求）
- 接收数据（如 HTTP 响应）
- 与其他机器交互（如数据库连接）

但直接使用网络硬件有很多问题。

---

# 二、直接使用网络硬件的问题

假设我们直接使用网卡发送数据：

## 问题 1：协议复杂性

```
发送一个 HTTP 请求需要：
1. 构建 HTTP 数据
2. 添加 TCP 头部（序列号、确认号、窗口等）
3. 添加 IP 头部（源 IP、目的 IP 等）
4. 添加以太网帧头（源 MAC、目的 MAC）
5. 计算校验和
6. ...

每个应用程序都要实现这些？太复杂了！
```

## 问题 2：并发访问

```
多个程序同时使用网络：
程序 A 想访问网站 X
程序 B 想访问网站 Y
程序 C 想访问网站 Z

如何区分哪个数据属于哪个程序？
```

## 问题 3：可靠性

```
网络是不可靠的：
- 数据包可能丢失
- 数据包可能乱序
- 数据包可能重复
- 数据包可能损坏

每个应用程序都要处理这些问题？
```

## 问题 4：异构网络

```
不同的网络环境：
- 有线网络
- 无线网络
- 光纤网络
- 卫星网络

每种网络都有不同的特性，应用程序如何适配？
```

---

# 三、于是引入网络协议栈：分层处理网络通信

## 核心思想

> **将网络通信分解为多个层次，每层只关注自己的职责**

## OSI 七层模型 vs TCP/IP 四层模型

```
OSI 七层模型              TCP/IP 四层模型
┌─────────────────┐      ┌─────────────────┐
│   应用层         │      │                 │
├─────────────────┤      │    应用层        │
│   表示层         │      │                 │
├─────────────────┤      │                 │
│   会话层         │      │                 │
├─────────────────┤      ├─────────────────┤
│   传输层         │      │    传输层        │
├─────────────────┤      ├─────────────────┤
│   网络层         │      │    网络层        │
├─────────────────┤      ├─────────────────┤
│   数据链路层     │      │                 │
├─────────────────┤      │    网络接口层    │
│   物理层         │      │                 │
└─────────────────┘      └─────────────────┘
```

## Linux 网络协议栈的层次

```
┌─────────────────────────────────────────┐
│         应用层（用户空间）               │
│    HTTP / FTP / SSH / DNS / ...         │
└─────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────┐
│         Socket 层（内核空间）            │
│         系统调用接口                     │
└─────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────┐
│         传输层                           │
│    TCP / UDP / SCTP / ...               │
└─────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────┐
│         网络层                           │
│    IPv4 / IPv6 / ARP / ICMP / ...       │
└─────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────┐
│         数据链路层                       │
│    Ethernet / WiFi / PPP / ...          │
└─────────────────────────────────────────┘
                    ↕
┌─────────────────────────────────────────┐
│         物理层                           │
│         网卡驱动                         │
└─────────────────────────────────────────┘
```

## 好处

1. **模块化**：每层独立，易于开发和维护
2. **复用性**：上层可以使用下层提供的通用服务
3. **灵活性**：可以替换某一层的实现而不影响其他层
4. **标准化**：每层都有明确的标准和接口

---

# 四、数据包的封装与解封装

## 发送数据：封装（Encapsulation）

```
应用层：
┌─────────────────────────────┐
│      HTTP 数据               │
└─────────────────────────────┘
            ↓ 添加 TCP 头部
传输层：
┌─────────────────────────────┐
│ TCP 头部 │   HTTP 数据       │
└─────────────────────────────┘
            ↓ 添加 IP 头部
网络层：
┌─────────────────────────────┐
│ IP 头部 │ TCP 头部 │ HTTP 数据│
└─────────────────────────────┘
            ↓ 添加以太网帧头
数据链路层：
┌─────────────────────────────────────┐
│以太网帧头│ IP 头部 │ TCP 头部 │ HTTP 数据│
└─────────────────────────────────────┘
            ↓ 发送到网卡
物理层：
电信号/光信号传输
```

## 接收数据：解封装（Decapsulation）

```
物理层：
接收电信号/光信号
            ↓ 去除以太网帧头
数据链路层：
┌─────────────────────────────────────┐
│以太网帧头│ IP 头部 │ TCP 头部 │ HTTP 数据│
└─────────────────────────────────────┘
            ↓ 去除 IP 头部
网络层：
┌─────────────────────────────┐
│ IP 头部 │ TCP 头部 │ HTTP 数据│
└─────────────────────────────┘
            ↓ 去除 TCP 头部
传输层：
┌─────────────────────────────┐
│ TCP 头部 │   HTTP 数据       │
└─────────────────────────────┘
            ↓ 去除 HTTP 头部
应用层：
┌─────────────────────────────┐
│      HTTP 数据               │
└─────────────────────────────┘
```

---

# 五、核心数据结构：sk_buff

## 问题：如何高效管理数据包？

数据包在协议栈中流动时：

- 需要添加/删除头部
- 需要在各层之间传递
- 需要支持零拷贝

如果每次都复制数据，性能会很差！

## 解决方案：sk_buff（Socket Buffer）

**定义位置**：**`include/linux/skbuff.h`**

```c
/*
 * struct sk_buff - 网络数据包的核心数据结构
 * 
 * 这是 Linux 网络协议栈最重要的数据结构
 * 它代表一个网络数据包，在协议栈各层之间传递
 */
struct sk_buff {
    /* 链表管理 */
    struct sk_buff      *next, *prev;
    
    /* 所属的 socket */
    struct sock         *sk;
    
    /* 接收/发送时间戳 */
    ktime_t             tstamp;
    
    /* 网络设备 */
    struct net_device   *dev;
    
    /* 
     * 数据指针
     * 
     * transport_header: 传输层头部
     * network_header:   网络层头部
     * mac_header:       数据链路层头部
     * 
     * head: 数据缓冲区的起始地址
     * data: 数据的起始地址
     * tail: 数据的结束地址
     * end:  数据缓冲区的结束地址
     */
    unsigned char       *transport_header;
    unsigned char       *network_header;
    unsigned char       *mac_header;
    
    unsigned char       *head;
    unsigned char       *data;
    unsigned char       *tail;
    unsigned char       *end;
    
    /* 数据长度 */
    unsigned int        len;        /* 数据总长度 */
    unsigned int        data_len;   /* 分片数据长度 */
    unsigned int        mac_len;    /* MAC 头部长度 */
    
    /* 校验和 */
    __wsum              csum;
    __u8                ip_summed;  /* 校验和状态 */
    
    /* 协议信息 */
    __be16              protocol;   /* 协议类型 */
    __u16               transport_header; /* 传输层头部偏移 */
    __u16               network_header;   /* 网络层头部偏移 */
    __u16               mac_header;       /* MAC 头部偏移 */
    
    /* 标志位 */
    __u32               priority;   /* 数据包优先级 */
    __u8                pkt_type;   /* 数据包类型 */
    __u8                cloned;     /* 是否被克隆 */
    __u8                ip_summed;  /* 校验和状态 */
    
    /* 引用计数 */
    refcount_t          users;
    
    /* ... 其他字段 ... */
};
```

## sk_buff 的巧妙设计

```
数据缓冲区布局：

head                          data                        tail                        end
│                             │                           │                           │
▼                             ▼                           ▼                           ▼
┌─────────────────────────────┬───────────────────────────┬───────────────────────────┐
│     预留空间（用于添加头部）  │        实际数据           │    预留空间（用于扩展）    │
└─────────────────────────────┴───────────────────────────┴───────────────────────────┘

添加头部时：
- 只需要移动 data 指针
- 不需要复制数据！

删除头部时：
- 只需要移动 data 指针
- 不需要复制数据！

这就是"零拷贝"的实现基础！
```

## 关键操作

```c
/* 分配 sk_buff */
struct sk_buff *alloc_skb(unsigned int size, gfp_t priority);

/* 释放 sk_buff */
void kfree_skb(struct sk_buff *skb);

/* 添加头部（移动 data 指针） */
unsigned char *skb_push(struct sk_buff *skb, unsigned int len);

/* 删除头部（移动 data 指针） */
unsigned char *skb_pull(struct sk_buff *skb, unsigned int len);

/* 添加尾部数据 */
unsigned char *skb_put(struct sk_buff *skb, unsigned int len);

/* 删除尾部数据 */
void skb_trim(struct sk_buff *skb, unsigned int len);

/* 克隆 sk_buff（共享数据缓冲区） */
struct sk_buff *skb_clone(struct sk_buff *skb, gfp_t gfp_mask);

/* 复制 sk_buff（复制数据缓冲区） */
struct sk_buff *skb_copy(const struct sk_buff *skb, gfp_t gfp_mask);
```

---

# 六、网络设备：net_device

## 问题：如何管理各种网络设备？

系统可能有多个网络设备：

- 以太网卡（eth0, eth1）
- 无线网卡（wlan0）
- 回环设备（lo）
- 虚拟设备（docker0, veth）

如何统一管理这些设备？

## 解决方案：net_device 结构

**定义位置**：**`include/linux/netdevice.h`**

```c
/*
 * struct net_device - 网络设备描述符
 * 
 * 每个网络设备（物理或虚拟）都有一个 net_device 结构
 * 它包含了设备的所有信息和操作方法
 */
struct net_device {
    /* 设备名称 */
    char                    name[IFNAMSIZ];
    
    /* 设备标识 */
    int                     ifindex;    /* 设备索引 */
    int                     iflink;     /* 链路索引 */
    
    /* 设备状态 */
    unsigned int            flags;      /* 设备标志（IFF_UP, IFF_PROMISC 等） */
    unsigned int            mtu;        /* 最大传输单元 */
    unsigned short          type;       /* 设备类型（ARPHRD_ETHER 等） */
    unsigned short          hard_header_len; /* 硬件头部长度 */
    
    /* 硬件地址 */
    unsigned char           dev_addr[MAX_ADDR_LEN];
    unsigned char           broadcast[MAX_ADDR_LEN];
    unsigned char           addr_len;
    
    /* 统计信息 */
    struct net_device_stats stats;
    
    /* 操作函数 */
    const struct net_device_ops *netdev_ops;
    const struct ethtool_ops    *ethtool_ops;
    const struct header_ops     *header_ops;
    
    /* 发送队列 */
    unsigned int            tx_queue_len;
    struct Qdisc            *qdisc;
    
    /* 接收队列 */
    struct netdev_rx_queue  *_rx;
    unsigned int            num_rx_queues;
    
    /* 发送队列 */
    struct netdev_queue    *_tx;
    unsigned int            num_tx_queues;
    
    /* NAPI 结构 */
    struct napi_struct      napi;
    
    /* 设备特性 */
    netdev_features_t       features;
    netdev_features_t       hw_features;
    netdev_features_t       wanted_features;
    
    /* ... 其他字段 ... */
};

/*
 * 网络设备操作函数
 */
struct net_device_ops {
    int (*ndo_open)(struct net_device *dev);
    int (*ndo_stop)(struct net_device *dev);
    netdev_tx_t (*ndo_start_xmit)(struct sk_buff *skb, struct net_device *dev);
    int (*ndo_set_rx_mode)(struct net_device *dev);
    int (*ndo_set_mac_address)(struct net_device *dev, void *addr);
    int (*ndo_validate_addr)(struct net_device *dev);
    int (*ndo_do_ioctl)(struct net_device *dev, struct ifreq *ifr, int cmd);
    void (*ndo_set_rx_headroom)(struct net_device *dev, int new_headroom);
    int (*ndo_change_mtu)(struct net_device *dev, int new_mtu);
    /* ... 其他操作 ... */
};
```

## 网络设备的注册

```c
/* 注册网络设备 */
int register_netdev(struct net_device *dev);

/* 注销网络设备 */
void unregister_netdev(struct net_device *dev);

/* 分配网络设备 */
struct net_device *alloc_netdev(int sizeof_priv, const char *name,
                                void (*setup)(struct net_device *));
```

---

# 七、Socket：应用层与内核的接口

## 问题：应用程序如何使用网络？

应用程序需要：

- 创建连接
- 发送数据
- 接收数据
- 关闭连接

如何提供统一的接口？

## 解决方案：Socket API

### Socket 的创建

```c
/* 创建 socket */
int socket(int domain, int type, int protocol);

/* domain: 地址族 */
AF_INET      /* IPv4 */
AF_INET6     /* IPv6 */
AF_UNIX      /* Unix 域 */
AF_PACKET    /* 原始套接字 */

/* type: 套接字类型 */
SOCK_STREAM    /* TCP */
SOCK_DGRAM     /* UDP */
SOCK_RAW       /* 原始套接字 */
```

### Socket 的内核表示

**定义位置**：**`include/net/sock.h`**

```c
/*
 * struct sock - Socket 的内核表示
 * 
 * 这是 Socket 在内核中的完整表示
 * 包含了 Socket 的所有状态和信息
 */
struct sock {
    /* 基本字段 */
    struct sock_common      __sk_common;
#define sk_family           __sk_common.skc_family
#define sk_state            __sk_common.skc_state
#define sk_daddr            __sk_common.skc_daddr
#define sk_rcv_saddr        __sk_common.skc_rcv_saddr
#define sk_dport            __sk_common.skc_dport
#define sk_num              __sk_common.skc_num
    
    /* 锁 */
    socket_lock_t           sk_lock;
    
    /* 接收和发送缓冲区 */
    int                     sk_rcvbuf;      /* 接收缓冲区大小 */
    int                     sk_sndbuf;      /* 发送缓冲区大小 */
    
    /* 接收队列 */
    struct sk_buff_head     sk_receive_queue;
    
    /* 发送队列 */
    struct sk_buff_head     sk_write_queue;
    
    /* 错误队列 */
    struct sk_buff_head     sk_error_queue;
    
    /* 协议操作 */
    const struct proto      *sk_prot;
    
    /* Socket 选项 */
    int                     sk_err;         /* 错误码 */
    int                     sk_err_soft;    /* 软错误 */
    unsigned short          sk_type;        /* Socket 类型 */
    unsigned char           sk_protocol;    /* 协议 */
    
    /* 状态 */
    unsigned char           sk_state;       /* TCP 状态 */
    
    /* 回调函数 */
    void                    (*sk_state_change)(struct sock *sk);
    void                    (*sk_data_ready)(struct sock *sk);
    void                    (*sk_write_space)(struct sock *sk);
    void                    (*sk_error_report)(struct sock *sk);
    
    /* ... 其他字段 ... */
};

/*
 * 协议操作函数
 */
struct proto {
    int     (*connect)(struct sock *sk, struct sockaddr *addr, int addr_len);
    int     (*disconnect)(struct sock *sk, int flags);
    int     (*accept)(struct sock *sk, int flags, int *kern);
    int     (*ioctl)(struct sock *sk, int cmd, unsigned long arg);
    int     (*init)(struct sock *sk);
    void    (*destroy)(struct sock *sk);
    void    (*shutdown)(struct sock *sk, int how);
    int     (*setsockopt)(struct sock *sk, int level, int optname, 
                         sockptr_t optval, unsigned int optlen);
    int     (*getsockopt)(struct sock *sk, int level, int optname,
                         char __user *optval, int __user *option);
    int     (*sendmsg)(struct sock *sk, struct msghdr *msg, size_t len);
    int     (*recvmsg)(struct sock *sk, struct msghdr *msg, size_t len,
                       int noblock, int flags, int *addr_len);
    int     (*bind)(struct sock *sk, struct sockaddr *addr, int addr_len);
    /* ... 其他操作 ... */
};
```

---

# 七-A、核心数据结构关系：socket、sock、sk_buff、net_device

## 问题：这四个核心结构是什么关系？

前面我们分别介绍了：
- **socket**：应用层与内核的接口
- **sock**：协议栈中的通信端点
- **sk_buff**：网络数据包的载体
- **net_device**：网络设备抽象

但它们之间的关系是什么？数据是如何在这些结构之间流转的？

## 四者关系总览

```
四者位置关系图：

┌─────────────────────────────────────────────────────────────────────────┐
│                           用户态                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    应用程序                                      │   │
│  │                 app buffer                                      │   │
│  │              "GET / HTTP/1.1 ..."                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          send()/write()
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           内核态                                         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  struct socket                                                   │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │ - 文件描述符关联                                           │  │   │
│  │  │ - 系统调用接口                                             │  │   │
│  │  │ - 面向应用的 API 层                                        │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    │ 关联                                │
│                                    ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  struct sock                                                     │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │ - 本地/对端 IP、端口                                       │  │   │
│  │  │ - TCP 状态机                                               │  │   │
│  │  │ - 发送队列/接收队列                                        │  │   │
│  │  │ - 协议栈核心状态                                           │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    │ 创建/使用                           │
│                                    ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  struct sk_buff (skb)                                            │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │ [headroom][payload][tailroom]                              │  │   │
│  │  │ [L2头][IP头][TCP头][数据]                                   │  │   │
│  │  │ 数据包在协议栈中流动的载体                                  │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    │ 路由查找决定出口                    │
│                                    ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  struct net_device                                               │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │ - eth0, lo, wlan0, veth                                    │  │   │
│  │  │ - 网络设备抽象                                             │  │   │
│  │  │ - 包的进出口                                               │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    │ ndo_start_xmit()                   │
│                                    ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  网卡驱动 / 硬件                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                                  网络
```

## 它们各自"站在什么位置"

### 1. socket：站在用户态系统调用接口这一侧

```
socket 的角色：
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  特点：                                                                  │
│  +-------------------+                                                    │
│  | 应用拿着 fd 调用 send/recv |                                            │
│  | 内核通过 socket 接住这些操作 |                                           │
│  | 它更像"API 接口层对象"     |                                              │
│  +-------------------+                                                    │
│                                                                          │
│  所以它靠近应用。                                                        │
│                                                                          │
│  关键字段：                                                              │
│  +-------------------+                                                    │
│  | struct file *file    |  关联文件描述符                                 │
│  | struct sock *sk      |  关联内核 sock                                  │
│  | short type           |  Socket 类型（SOCK_STREAM/SOCK_DGRAM）         │
│  | const struct proto_ops *ops |  操作函数指针                            │
│  +-------------------+                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. sock：站在协议栈核心状态这一侧

```
sock 的角色：
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  特点：                                                                  │
│  +-------------------+                                                    │
│  | 维护连接状态       |                                                    │
│  | 保存本地/远端地址端口 |                                                   │
│  | 管理发送队列、接收队列 |                                                  │
│  | 处理 TCP 状态机    |                                                    │
│  +-------------------+                                                    │
│                                                                          │
│  所以它是"连接/端点本体"。                                               │
│                                                                          │
│  关键字段：                                                              │
│  +-------------------+                                                    │
│  | sk_state          |  TCP 状态（TCP_ESTABLISHED 等）                   │
│  | sk_daddr          |  目的 IP 地址                                      │
│  | sk_dport          |  目的端口                                          │
│  | sk_rcv_saddr      |  本地 IP 地址                                      │
│  | sk_num            |  本地端口                                          │
│  | sk_receive_queue  |  接收队列（sk_buff 链表）                          │
│  | sk_write_queue    |  发送队列（sk_buff 链表）                          │
│  | sk_prot           |  协议操作函数                                      │
│  +-------------------+                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. skb：站在数据包流转这一侧

```
skb 的角色：
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  特点：                                                                  │
│  +-------------------+                                                    │
│  | 表示一个正在协议栈中流动的包 |                                            │
│  | 发送时承载待发数据和协议头 |                                              │
│  | 接收时承载收到的完整包和解析状态 |                                        │
│  +-------------------+                                                    │
│                                                                          │
│  所以它是"包裹"。                                                        │
│                                                                          │
│  关键字段：                                                              │
│  +-------------------+                                                    │
│  | struct sock *sk   |  所属的 sock                                       │
│  | struct net_device *dev |  关联的网络设备                                │
│  | unsigned char *head |  缓冲区起始                                       │
│  | unsigned char *data |  数据起始                                         │
│  | unsigned char *tail |  数据结束                                         │
│  | unsigned char *end  |  缓冲区结束                                       │
│  | transport_header  |  传输层头部                                        │
│  | network_header    |  网络层头部                                        │
│  | mac_header        |  链路层头部                                        │
│  +-------------------+                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4. net_device：站在设备接口这一侧

```
net_device 的角色：
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  特点：                                                                  │
│  +-------------------+                                                    │
│  | 表示 eth0、lo、wlan0、veth 这类网络接口 |                                │
│  | 发送时是包的出口   |                                                    │
│  | 接收时是包的入口来源 |                                                   │
│  +-------------------+                                                    │
│                                                                          │
│  所以它是"进出口"。                                                      │
│                                                                          │
│  关键字段：                                                              │
│  +-------------------+                                                    │
│  | char name[IFNAMSIZ] |  设备名（eth0, lo 等）                           │
│  | int ifindex       |  设备索引                                          │
│  | unsigned int flags |  设备标志（IFF_UP 等）                            │
│  | unsigned int mtu  |  最大传输单元                                      │
│  | unsigned char dev_addr[] |  MAC 地址                                  │
│  | const struct net_device_ops *netdev_ops |  设备操作函数               │
│  | struct napi_struct napi |  NAPI 结构                                   │
│  +-------------------+                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 发送路径（TX）：从应用到网卡

```
发送路径详解：
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  用户态                                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ app buffer                                                        │  │
│  │ "GET / HTTP/1.1 ..."                                              │  │
│  │ ← 普通字节数据，不是 skb                                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                          send()/write()                                  │
│                                    │                                     │
│                                    ▼                                     │
│  内核态                                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 1: 通过 fd 找到 socket                                        │  │
│  │         fdget(fd) → struct file → file->private_data → socket     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 2: 从 socket 获取 sock                                        │  │
│  │         socket->sk → struct sock                                   │  │
│  │         sock 包含连接状态、地址端口、收发队列                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 3: 创建 sk_buff，填充用户数据                                  │  │
│  │         alloc_skb() 分配 skb                                       │  │
│  │         skb_put() 添加用户数据                                      │  │
│  │         skb->sk = sock  关联 sock                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 4: 传输层添加头部（TCP/UDP）                                   │  │
│  │         skb_push() 添加 TCP 头部                                    │  │
│  │         设置源端口、目的端口、序列号、确认号等                       │  │
│  │         skb->transport_header 指向 TCP 头部                         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 5: 网络层添加头部（IP）                                        │  │
│  │         skb_push() 添加 IP 头部                                     │  │
│  │         设置源 IP、目的 IP、协议号等                                 │  │
│  │         skb->network_header 指向 IP 头部                            │  │
│  │         路由查找决定出口设备                                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 6: 链路层添加头部（以太网）                                    │  │
│  │         skb_push() 添加以太网头部                                   │  │
│  │         设置源 MAC、目的 MAC、协议类型等                             │  │
│  │         skb->mac_header 指向以太网头部                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 7: 关联出口网络设备                                            │  │
│  │         skb->dev = net_device（如 eth0）                            │  │
│  │         调用 dev_queue_xmit(skb)                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 8: 网卡驱动发送                                                │  │
│  │         net_device->netdev_ops->ndo_start_xmit(skb, dev)           │  │
│  │         驱动将 skb 数据写入网卡硬件                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│                                  网络                                    │
│                                                                          │
│  最终 skb 结构：                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ [以太网头][IP头][TCP头][HTTP数据]                                   │  │
│  │   L2       L3     L4     L7                                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

发送路径一句话总结：
app数据 → socket → sock → skb → net_device → 驱动/网卡
```

## 接收路径（RX）：从网卡到应用

```
接收路径详解：
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                  网络                                    │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 1: 网卡硬件收到完整帧                                          │  │
│  │         [以太网头][IP头][TCP头][HTTP数据]                           │  │
│  │         网卡触发中断                                                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 2: 网卡驱动处理                                                │  │
│  │         分配 skb: alloc_skb()                                      │  │
│  │         填充数据: skb_put()                                         │  │
│  │         设置来源设备: skb->dev = net_device                         │  │
│  │         调用 napi_schedule() 或 netif_rx()                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 3: 软中断处理（NET_RX_SOFTIRQ）                                │  │
│  │         调用 netif_receive_skb(skb)                                 │  │
│  │         开始协议栈处理                                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 4: 链路层处理                                                  │  │
│  │         解析以太网头部                                              │  │
│  │         skb->mac_header 指向以太网头部                              │  │
│  │         skb_pull() 移除以太网头部                                   │  │
│  │         根据协议类型决定上层协议                                    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 5: 网络层处理（IP）                                            │  │
│  │         解析 IP 头部                                                │  │
│  │         skb->network_header 指向 IP 头部                            │  │
│  │         skb_pull() 移除 IP 头部                                     │  │
│  │         根据协议号决定上层协议                                      │  │
│  │         检查目的 IP 是否是本机                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 6: 传输层处理（TCP/UDP）                                       │  │
│  │         解析 TCP/UDP 头部                                           │  │
│  │         skb->transport_header 指向 TCP 头部                         │  │
│  │         skb_pull() 移除 TCP 头部                                    │  │
│  │         根据 5 元组查找 sock：                                      │  │
│  │           {源IP, 源端口, 目的IP, 目的端口, 协议}                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 7: 找到对应的 sock                                             │  │
│  │         __inet_lookup() 查找 sock                                   │  │
│  │         skb->sk = sock  关联 sock                                   │  │
│  │         将 skb 放入 sock 的接收队列                                  │  │
│  │         skb_queue_tail(&sock->sk_receive_queue, skb)                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 8: 唤醒等待的进程                                              │  │
│  │         sock->sk_data_ready(sock)                                   │  │
│  │         唤醒在 socket 上等待的进程                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 步骤 9: 应用程序读取数据                                            │  │
│  │         通过 fd 找到 socket                                         │  │
│  │         从 socket->sk->sk_receive_queue 取出 skb                    │  │
│  │         将 skb 中的数据拷贝到用户态 buffer                           │  │
│  │         recv()/read() 返回                                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  用户态                                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ app buffer                                                        │  │
│  │ "HTTP/1.1 200 OK ..."                                             │  │
│  │ ← 拷贝出应用数据                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

接收路径一句话总结：
网卡/驱动 → net_device → skb → sock → socket → app数据
```

## 关键代码：四者的关联

```c
/*
 * socket 和 sock 的关联
 * 定义在 net/socket.c
 */
struct socket {
    struct sock     *sk;        /* 关联的 sock */
    struct file     *file;      /* 关联的文件 */
    /* ... */
};

/*
 * skb 和 sock 的关联
 * 定义在 include/linux/skbuff.h
 */
struct sk_buff {
    struct sock         *sk;            /* 所属的 sock */
    struct net_device   *dev;           /* 关联的网络设备 */
    /* ... */
};

/*
 * 发送时：创建 skb 并关联 sock
 */
static int tcp_sendmsg(struct sock *sk, struct msghdr *msg, size_t size)
{
    struct sk_buff *skb;
    
    /* 分配 skb */
    skb = alloc_skb(size, sk->sk_allocation);
    if (!skb)
        return -ENOMEM;
    
    /* 关联 sock */
    skb->sk = sk;
    
    /* 填充数据 */
    err = skb_add_data(skb, msg, size);
    
    /* 添加到发送队列 */
    skb_queue_tail(&sk->sk_write_queue, skb);
    
    /* 触发发送 */
    tcp_push(sk, flags);
    
    return err;
}

/*
 * 接收时：查找 sock 并关联 skb
 */
int tcp_v4_rcv(struct sk_buff *skb)
{
    struct tcphdr *th;
    struct sock *sk;
    
    /* 解析 TCP 头部 */
    th = (struct tcphdr *)skb->data;
    
    /* 根据 5 元组查找 sock */
    sk = __inet_lookup_skb(&tcp_hashinfo, skb, th->source, th->dest);
    if (!sk)
        goto discard;
    
    /* 关联 sock */
    skb->sk = sk;
    
    /* 放入接收队列 */
    tcp_queue_rcv(sk, skb);
    
    /* 唤醒等待进程 */
    sk->sk_data_ready(sk);
    
    return 0;
    
discard:
    kfree_skb(skb);
    return 0;
}

/*
 * 发送时：关联出口设备
 */
int ip_local_out(struct net *net, struct sock *sk, struct sk_buff *skb)
{
    int err;
    
    err = __ip_local_out(net, sk, skb);
    if (likely(err == 1))
        err = dst_output(net, sk, skb);
    
    return err;
}

/*
 * 路由查找后设置出口设备
 */
static int ip_output(struct net *net, struct sock *sk, struct sk_buff *skb)
{
    struct net_device *dev = skb_dst(skb)->dev;
    
    /* 设置出口设备 */
    skb->dev = dev;
    
    /* 调用邻居子系统 */
    return NF_HOOK(NFPROTO_IPV4, NF_INET_POST_ROUTING,
               net, sk, skb, NULL, dev,
               ip_finish_output);
}

/*
 * 最终发送：调用网卡驱动
 */
static int dev_hard_start_xmit(struct sk_buff *skb, struct net_device *dev,
                   struct netdev_queue *txq)
{
    const struct net_device_ops *ops = dev->netdev_ops;
    
    /* 调用网卡驱动的发送函数 */
    rc = ops->ndo_start_xmit(skb, dev);
    
    return rc;
}
```

## 文字版总结

```
Linux 网络栈里，socket、sock、skb、net_device 分别处在不同层次：

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  socket：                                                                │
│  +-------------------+                                                    │
│  | 应用程序使用网络的接口对象 |                                              │
│  | 承接 send/recv 等系统调用 |                                              │
│  | 靠近应用层         |                                                    │
│  +-------------------+                                                    │
│                                                                          │
│  sock：                                                                  │
│  +-------------------+                                                    │
│  | 协议栈中的核心通信端点对象 |                                              │
│  | 保存连接状态和收发队列 |                                                  │
│  | 协议栈核心状态     |                                                    │
│  +-------------------+                                                    │
│                                                                          │
│  sk_buff（skb）：                                                        │
│  +-------------------+                                                    │
│  | 内核中表示一个网络包的对象 |                                              │
│  | 是网络数据在协议栈中流动的统一载体 |                                      │
│  | 数据包流转的载体   |                                                    │
│  +-------------------+                                                    │
│                                                                          │
│  net_device：                                                            │
│  +-------------------+                                                    │
│  | 网络设备抽象       |                                                    │
│  | 表示包从哪个设备进入或从哪个设备发出 |                                    │
│  | 包的进出口         |                                                    │
│  +-------------------+                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

发送时：
应用传给内核的是普通用户态字节数据，不是 skb。

内核根据 fd 找到对应的 socket 和 sock，再把数据组织进一个或多个 skb。
随后协议栈在 skb 中逐层添加传输层、网络层、链路层头部，
并根据路由选择出口 net_device，最后交给驱动和网卡发出。

接收时：
网卡收到的是已经包含完整协议头的网络帧/包。

驱动把这些收到的数据包装成 skb，并标记来源 net_device。
协议栈再逐层解析 skb 的各层头部，找到对应的 sock，
将应用数据放入其接收队列/缓冲区。
最后应用通过 socket 对应的 recv/read 从内核中把数据读到用户态。
```

---

# 八、数据包接收流程：从网卡到应用

## 完整流程

```
1. 网卡接收数据包
    │
    ▼
2. 网卡驱动处理中断
    │
    ▼
3. 调用 NAPI 接口
    │
    ▼
4. 数据包进入接收队列
    │
    ▼
5. 软中断处理（NET_RX_SOFTIRQ）
    │
    ▼
6. 调用 netif_receive_skb()
    │
    ▼
7. 数据链路层处理
    │
    ▼
8. 网络层处理（IP）
    │
    ▼
9. 传输层处理（TCP/UDP）
    │
    ▼
10. 数据放入 Socket 接收队列
    │
    ▼
11. 唤醒等待的进程
    │
    ▼
12. 应用程序读取数据
```

## Linux 5.15 的实现

### 1. 网卡驱动接收数据

**定义位置**：**`net/core/dev.c`**

```c
/*
 * 网卡驱动调用此函数将数据包传递给协议栈
 * 
 * 通常在 NAPI poll 函数中调用
 */
int netif_receive_skb(struct sk_buff *skb)
{
    /* 更新统计信息 */
    trace_netif_receive_skb_entry(skb);
    
    /* 处理数据包 */
    return __netif_receive_skb(skb);
}

/*
 * 实际的数据包处理函数
 */
static int __netif_receive_skb(struct sk_buff *skb)
{
    struct packet_type *ptype;
    struct net_device *orig_dev;
    
    /* 设置数据包类型 */
    skb->pkt_type = PACKET_HOST;
    
    /* 处理数据链路层 */
    list_for_each_entry_rcu(ptype, &ptype_all, list) {
        if (pt_prev) {
            ret = deliver_skb(skb, pt_prev, orig_dev);
        }
        pt_prev = ptype;
    }
    
    /* 根据协议类型分发 */
    switch (skb->protocol) {
    case htons(ETH_P_IP):
        ret = ip_rcv(skb, dev, pt_prev, orig_dev);
        break;
    case htons(ETH_P_IPV6):
        ret = ipv6_rcv(skb, dev, pt_prev, orig_dev);
        break;
    case htons(ETH_P_ARP):
        ret = arp_rcv(skb, dev, pt_prev, orig_dev);
        break;
    /* ... 其他协议 ... */
    }
    
    return ret;
}
```

### 2. IP 层处理

**定义位置**：**`net/ipv4/ip_input.c`**

```c
/*
 * IP 层接收函数
 */
int ip_rcv(struct sk_buff *skb, struct net_device *dev,
           struct packet_type *pt, struct net_device *orig_dev)
{
    struct net *net = dev_net(dev);
    struct iphdr *iph;
    
    /* 验证 IP 头部 */
    if (!pskb_may_pull(skb, sizeof(struct iphdr)))
        goto drop;
    
    iph = ip_hdr(skb);
    
    /* 检查 IP 头部校验和 */
    if (unlikely(ip_fast_csum((u8 *)iph, iph->ihl)))
        goto csum_error;
    
    /* 检查数据包长度 */
    if (skb->len < ntohs(iph->tot_len))
        goto drop;
    
    /* 调用 Netfilter */
    return NF_HOOK(NFPROTO_IPV4, NF_INET_PRE_ROUTING,
                   net, NULL, skb, dev, NULL,
                   ip_rcv_finish);
    
drop:
    kfree_skb(skb);
    return NET_RX_DROP;
}

/*
 * IP 层处理完成
 */
static int ip_rcv_finish(struct net *net, struct sock *sk,
                         struct sk_buff *skb)
{
    /* 路由查找 */
    if (!skb_dst(skb)) {
        if (ip_route_input_noref(skb, iph->daddr, iph->saddr,
                                 iph->tos, skb->dev))
            goto drop;
    }
    
    /* 根据协议类型分发 */
    return ip_local_deliver(skb);
    
drop:
    kfree_skb(skb);
    return NET_RX_DROP;
}

/*
 * IP 本地投递
 */
int ip_local_deliver(struct sk_buff *skb)
{
    /* IP 分片重组 */
    if (ip_is_fragment(ip_hdr(skb))) {
        if (ip_defrag(net, skb, IP_DEFRAG_LOCAL_DELIVER))
            return 0;
    }
    
    /* 调用 Netfilter */
    return NF_HOOK(NFPROTO_IPV4, NF_INET_LOCAL_IN,
                   net, NULL, skb, skb->dev, NULL,
                   ip_local_deliver_finish);
}

/*
 * 投递到传输层
 */
static int ip_local_deliver_finish(struct net *net, struct sock *sk,
                                   struct sk_buff *skb)
{
    /* 根据协议类型分发到传输层 */
    int protocol = ip_hdr(skb)->protocol;
    
    return ip_protocol_deliver_rcu(net, skb, protocol);
}
```

### 3. TCP 层处理

**定义位置**：**`net/ipv4/tcp_ipv4.c`**

```c
/*
 * TCP 接收函数
 */
int tcp_v4_rcv(struct sk_buff *skb)
{
    struct tcphdr *th;
    struct iphdr *iph;
    struct sock *sk;
    struct net *net = dev_net(skb->dev);
    
    /* 验证 TCP 头部 */
    if (!pskb_may_pull(skb, sizeof(struct tcphdr)))
        goto discard;
    
    th = tcp_hdr(skb);
    iph = ip_hdr(skb);
    
    /* 检查 TCP 校验和 */
    if (skb_checksum_complete(skb))
        goto csum_error;
    
    /* 查找对应的 Socket */
    sk = __inet_lookup_skb(&tcp_hashinfo, skb, th->source, th->dest);
    if (!sk)
        goto no_tcp_socket;
    
process:
    /* 根据Socket 状态处理 */
    if (sk->sk_state == TCP_TIME_WAIT)
        goto do_time_wait;
    
    if (sk->sk_state == TCP_NEW_SYN_RECV)
        goto handle_syn_recv;
    
    /* 加锁 */
    bh_lock_sock(sk);
    
    /* 处理 TCP 数据 */
    ret = tcp_v4_do_rcv(sk, skb);
    
    bh_unlock_sock(sk);
    
    return ret;
}

/*
 * TCP 数据处理
 */
int tcp_v4_do_rcv(struct sock *sk, struct sk_buff *skb)
{
    /* 连接建立阶段 */
    if (sk->sk_state == TCP_ESTABLISHED) {
        tcp_rcv_established(sk, skb);
        return 0;
    }
    
    /* 连接建立阶段 */
    if (sk->sk_state == TCP_LISTEN) {
        struct request_sock *req;
        
        req = inet_reqsk(sk);
        if (tcp_v4_conn_request(sk, skb))
            goto reset;
        
        return 0;
    }
    
    /* 其他状态 */
    return tcp_rcv_state_process(sk, skb);
}

/*
 * 已建立连接的数据处理
 */
void tcp_rcv_established(struct sock *sk, struct sk_buff *skb)
{
    unsigned int count = 0;
    
    /* 快速路径：数据按序到达 */
    if (eaten = tcp_queue_rcv(sk, skb, &fragstolen)) {
        /* 数据已放入接收队列 */
        /* 唤醒等待的进程 */
        sk->sk_data_ready(sk);
        return;
    }
    
    /* 慢速路径：乱序或其他情况 */
    tcp_data_queue(sk, skb);
    
    /* 发送 ACK */
    tcp_send_ack(sk);
}
```

---

# 九、数据包发送流程：从应用到网卡

## 完整流程

```
1. 应用程序调用 send()/write()
    │
    ▼
2. 系统调用进入内核
    │
    ▼
3. Socket 层处理
    │
    ▼
4. 传输层处理（TCP/UDP）
    │
    ▼
5. 网络层处理（IP）
    │
    ▼
6. 数据链路层处理
    │
    ▼
7. 流量控制（Qdisc）
    │
    ▼
8. 网卡驱动发送
    │
    ▼
9. 网卡硬件发送
```

## Linux 5.15 的实现

### 1. Socket 层发送

```c
/*
 * sendmsg 系统调用
 */
SYSCALL_DEFINE4(sendmsg, int, fd, struct msghdr __user *, msg, unsigned int, flags)
{
    return __sys_sendmsg(fd, msg, flags, true);
}

/*
 * 实际的发送函数
 */
int sock_sendmsg(struct socket *sock, struct msghdr *msg)
{
    struct sockaddr_storage *address = NULL;
    int ret;
    
    /* 调用协议的 sendmsg 方法 */
    ret = sock->ops->sendmsg(sock, msg, msg_data_left(msg));
    
    return ret;
}
```

### 2. TCP 层发送

**定义位置**：**`net/ipv4/tcp.c`**

```c
/*
 * TCP 发送函数
 */
int tcp_sendmsg(struct sock *sk, struct msghdr *msg, size_t size)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    int flags, err, copied = 0;
    long timeo;
    
    /* 加锁 */
    lock_sock(sk);
    
    /* 获取超时时间 */
    timeo = sock_sndtimeo(sk, flags & MSG_DONTWAIT);
    
    /* 等待连接建立 */
    if (sk->sk_state != TCP_ESTABLISHED)
        goto out;
    
    /* 循环发送数据 */
    while (msg_data_left(msg)) {
        int copy;
        
        /* 获取发送缓冲区 */
        skb = tcp_write_queue_tail(sk);
        
        if (!skb || skb_is_gso(skb) ||
            !skb_can_coalesce(skb, msg)) {
            /* 分配新的 sk_buff */
            skb = sk_stream_alloc_skb(sk, size,
                                      sk->sk_allocation);
            if (!skb)
                goto wait_for_sndbuf;
            
            /* 添加到发送队列 */
            tcp_skb_entail(sk, skb);
        }
        
        /* 复制数据到 sk_buff */
        copy = min_t(int, size, skb_availroom(skb));
        err = skb_add_data_nocache(sk, skb, &msg->msg_iter, copy);
        if (err)
            goto do_error;
        
        copied += copy;
        
        /* 发送数据 */
        tcp_push(sk, flags);
    }
    
out:
    release_sock(sk);
    return copied;
}
```

### 3. IP 层发送

**定义位置**：**`net/ipv4/ip_output.c`**

```c
/*
 * IP 层发送函数
 */
int ip_queue_xmit(struct sock *sk, struct sk_buff *skb, struct flowi *fl)
{
    struct inet_sock *inet = inet_sk(sk);
    struct ip_options_rcu *inet_opt;
    struct rtable *rt;
    struct iphdr *iph;
    
    /* 查找路由 */
    rt = ip_route_output_ports(net, fl4, sk,
                               inet->inet_daddr,
                               inet->inet_saddr,
                               inet->inet_dport,
                               inet->inet_sport,
                               sk->sk_protocol,
                               RT_CONN_FLAGS(sk),
                               sk->sk_bound_dev_if);
    
    /* 设置路由 */
    skb_dst_set_noref(skb, &rt->dst);
    
    /* 构建 IP 头部 */
    iph = ip_hdr(skb);
    iph->version = 4;
    iph->ihl = 5;
    iph->tos = inet->tos;
    iph->tot_len = htons(skb->len);
    iph->id = htons(ip_idents_reserve(inet, 1));
    iph->frag_off = htons(IP_DF);
    iph->ttl = ip4_dst_hoplimit(&rt->dst);
    iph->protocol = sk->sk_protocol;
    iph->saddr = fl4->saddr;
    iph->daddr = fl4->daddr;
    
    /* 调用 Netfilter */
    return NF_HOOK(NFPROTO_IPV4, NF_INET_LOCAL_OUT,
                   net, sk, skb, NULL, rt->dst.dev,
                   dst_output);
}

/*
 * 输出到邻居子系统
 */
int ip_output(struct net *net, struct sock *sk, struct sk_buff *skb)
{
    /* 更新统计信息 */
    IP_UPD_PO_STATS(net, IPSTATS_MIB_OUT, skb->len);
    
    /* 输出到邻居 */
    return NF_HOOK_COND(NFPROTO_IPV4, NF_INET_POST_ROUTING,
                        net, sk, skb, NULL, dev,
                        ip_finish_output,
                        !(IPCB(skb)->flags & IPSKB_REROUTED));
}

/*
 * 完成输出
 */
static int ip_finish_output(struct net *net, struct sock *sk,
                            struct sk_buff *skb)
{
    unsigned int hh_len = LL_RESERVED_SPACE(skb->dev);
    
    /* 检查是否需要分片 */
    if (skb->len > skb->dev->mtu)
        return ip_fragment(net, sk, skb, ip_finish_output2);
    
    return ip_finish_output2(net, sk, skb);
}

/*
 * 输出到邻居
 */
static int ip_finish_output2(struct net *net, struct sock *sk,
                             struct sk_buff *skb)
{
    struct dst_entry *dst = skb_dst(skb);
    struct rtable *rt = (struct rtable *)dst;
    struct net_device *dev = dst->dev;
    
    /* 查找邻居 */
    if (!dst->hh)
        return neigh_resolve_output(dst->neighbour, skb);
    
    /* 输出到设备 */
    return dev_queue_xmit(skb);
}
```

### 4. 设备层发送

**定义位置**：**`net/core/dev.c`**

```c
/*
 * 设备发送队列
 */
int dev_queue_xmit(struct sk_buff *skb)
{
    struct net_device *dev = skb->dev;
    struct netdev_queue *txq;
    struct Qdisc *q;
    
    /* 选择发送队列 */
    txq = netdev_core_pick_tx(dev, skb);
    q = rcu_dereference_bh(txq->qdisc);
    
    /* 调用 Qdisc 发送 */
    return __dev_queue_xmit(skb, q);
}

/*
 * 实际的发送函数
 */
static int __dev_queue_xmit(struct sk_buff *skb, struct Qdisc *q)
{
    struct net_device *dev = skb->dev;
    struct netdev_queue *txq;
    
    /* 获取发送队列 */
    txq = netdev_get_tx_queue(dev, skb_get_queue_mapping(skb));
    
    /* 加锁 */
    __netif_tx_lock(txq, cpu);
    
    /* 检查队列是否停止 */
    if (!netif_xmit_stopped(txq)) {
        /* 调用驱动的发送函数 */
        dev_hard_start_xmit(skb, dev, txq);
    }
    
    __netif_tx_unlock(txq);
    
    return NETDEV_TX_OK;
}

/*
 * 调用驱动的发送函数
 */
netdev_tx_t dev_hard_start_xmit(struct sk_buff *skb, struct net_device *dev,
                                struct netdev_queue *txq)
{
    const struct net_device_ops *ops = dev->netdev_ops;
    netdev_tx_t rc;
    
    /* 调用驱动的 ndo_start_xmit */
    rc = ops->ndo_start_xmit(skb, dev);
    
    return rc;
}
```

---

# 十、NAPI：高效的数据包接收

## 问题：中断风暴

传统方式：每个数据包都触发一次中断

```
高速网络（10Gbps）：
- 每秒约 1,488,095 个数据包（MTU=1500）
- 每秒约 1,488,095 次中断
- CPU 大量时间用于处理中断
- 系统性能严重下降
```

## 解决方案：NAPI（New API）

### 核心思想

> **混合使用中断和轮询：高负载时轮询，低负载时中断**

### 工作流程

```
低负载：
1. 网卡接收数据包
2. 触发硬件中断
3. 中断处理程序调度软中断
4. 软中断处理数据包

高负载：
1. 网卡接收数据包
2. 禁用中断，启动轮询
3. 持续轮询处理数据包
4. 数据包处理完毕，重新启用中断
```

## Linux 5.15 的实现

```c
/*
 * NAPI 结构
 */
struct napi_struct {
    struct list_head    poll_list;      /* 轮询链表 */
    unsigned long       state;          /* 状态 */
    int                 weight;         /* 轮询权重 */
    int                 (*poll)(struct napi_struct *, int);
    struct net_device   *dev;
    struct list_head    dev_list;
    struct hlist_node   napi_hash_node;
    unsigned int        napi_id;
};

/*
 * 注册 NAPI
 */
void netif_napi_add(struct net_device *dev, struct napi_struct *napi,
                    int (*poll)(struct napi_struct *, int), int weight);

/*
 * 调度 NAPI
 */
void __napi_schedule(struct napi_struct *n);

/*
 * NAPI 轮询
 */
static int napi_poll(struct napi_struct *n, struct list_head *repoll)
{
    int work, work_limit;
    
    work_limit = n->weight;
    work = n->poll(n, work_limit);
    
    /* 如果还有数据包，继续轮询 */
    if (work >= work_limit) {
        list_add_tail(&n->poll_list, repoll);
    }
    
    return work;
}

/*
 * 网卡驱动的中断处理
 */
static irqreturn_t driver_interrupt(int irq, void *dev_id)
{
    struct net_device *dev = dev_id;
    struct driver_priv *priv = netdev_priv(dev);
    
    /* 禁用中断 */
    disable_irq_nosync(priv->irq);
    
    /* 调度 NAPI */
    napi_schedule(&priv->napi);
    
    return IRQ_HANDLED;
}

/*
 * 网卡驱动的轮询函数
 */
static int driver_poll(struct napi_struct *napi, int budget)
{
    struct driver_priv *priv = container_of(napi, struct driver_priv, napi);
    int work_done = 0;
    
    /* 轮询接收数据包 */
    while (work_done < budget && has_packets(priv)) {
        struct sk_buff *skb = receive_packet(priv);
        if (skb) {
            netif_receive_skb(skb);
            work_done++;
        }
    }
    
    /* 如果处理完所有数据包，重新启用中断 */
    if (work_done < budget) {
        napi_complete_done(napi, work_done);
        enable_irq(priv->irq);
    }
    
    return work_done;
}
```

---

# 十一、TCP 协议：可靠的传输

## 问题：网络是不可靠的

网络传输面临的问题：

- 数据包丢失
- 数据包乱序
- 数据包重复
- 数据包损坏
- 网络拥塞

如何提供可靠的传输？

## 解决方案：TCP 协议

### TCP 头部

```
TCP 头部格式（20 字节 + 选项）：
┌─────────────────────────────────────────────────────────┐
│   源端口（16位）   │   目的端口（16位）                  │
├─────────────────────────────────────────────────────────┤
│                    序列号（32位）                        │
├─────────────────────────────────────────────────────────┤
│                    确认号（32位）                        │
├────┬────┬─────────────────────────┬─────────────────────┤
│头长│保留│      标志位              │   窗口大小（16位）  │
├─────────────────────────────────────────────────────────┤
│   校验和（16位）   │   紧急指针（16位）                  │
└─────────────────────────────────────────────────────────┘

标志位：
- URG: 紧急指针有效
- ACK: 确认号有效
- PSH: 接收方应尽快将数据传给应用层
- RST: 重置连接
- SYN: 同步序列号
- FIN: 发送方完成发送
```

### TCP 连接建立（三次握手）

```
客户端                              服务器
  │                                   │
  │─────── SYN（seq=x）─────────────→│
  │                                   │
  │←────── SYN+ACK（seq=y, ack=x+1）─│
  │                                   │
  │─────── ACK（ack=y+1）───────────→│
  │                                   │
  │         连接建立                   │
```

### TCP 连接关闭（四次挥手）

```
主动关闭方                          被动关闭方
  │                                   │
  │─────── FIN（seq=m）─────────────→│
  │                                   │
  │←────── ACK（ack=m+1）────────────│
  │                                   │
  │←────── FIN（seq=n）─────────────│
  │                                   │
  │─────── ACK（ack=n+1）───────────→│
  │                                   │
  │         连接关闭                   │
```

### TCP 状态机

```
TCP 状态转换图：

                    ┌─────────┐
                    │ CLOSED  │
                    └────┬────┘
                         │
        active open      │     passive open
        send SYN         │     create TCB
                         │
                    ┌────▼────┐
                    │ SYN_SENT│
                    └────┬────┘
                         │
        receive SYN+ACK  │     send SYN
        send ACK         │
                         │
                    ┌────▼────┐
                    │ESTABLISHED│◄─────────────┐
                    └────┬────┘               │
                         │                    │
        close            │     receive SYN    │
        send FIN         │     send SYN+ACK   │
                         │                    │
                    ┌────▼────┐          ┌────┴────┐
                    │FIN_WAIT_1│          │ SYN_RCVD│
                    └────┬────┘          └────┬────┘
                         │                    │
        receive FIN+ACK  │     receive ACK   │
        send ACK         │                    │
                         │                    │
                    ┌────▼────┐          ┌────▼────┐
                    │FIN_WAIT_2│          │ESTABLISHED│
                    └────┬────┘          └────┬────┘
                         │                    │
        receive FIN      │     close          │
        send ACK         │     send FIN       │
                         │                    │
                    ┌────▼────┐          ┌────▼────┐
                    │ TIME_WAIT│          │FIN_WAIT_1│
                    └────┬────┘          └────┬────┘
                         │                    │
        timeout          │     receive FIN    │
        delete TCB       │     send ACK       │
                         │                    │
                    ┌────▼────┐          ┌────▼────┐
                    │ CLOSED  │          │CLOSING  │
                    └─────────┘          └────┬────┘
                                              │
                          receive ACK         │
                                              │
                                         ┌────▼────┐
                                         │ TIME_WAIT│
                                         └────┬────┘
                                              │
                          timeout             │
                          delete TCB          │
                                              │
                                         ┌────▼────┐
                                         │ CLOSED  │
                                         └─────────┘
```

## Linux 5.15 的 TCP 实现

### TCP 连接建立

**定义位置**：**`net/ipv4/tcp_input.c`**

```c
/*
 * 处理 SYN 请求
 */
int tcp_v4_conn_request(struct sock *sk, struct sk_buff *skb)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct request_sock *req;
    struct tcphdr *th = tcp_hdr(skb);
    
    /* 分配请求结构 */
    req = inet_reqsk_alloc(&tcp_request_sock_ops, sk, false);
    if (!req)
        goto drop;
    
    /* 初始化请求 */
    tcp_rsk(req)->snt_isn = tcp_init_seq(skb);
    tcp_rsk(req)->rcv_isn = ntohl(th->seq);
    
    /* 发送 SYN+ACK */
    tcp_v4_send_synack(sk, req, skb);
    
    return 0;
    
drop:
    return -1;
}

/*
 * 处理 SYN+ACK
 */
static void tcp_rcv_synrecv_state_process(struct sock *sk, struct sk_buff *skb)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct tcphdr *th = tcp_hdr(skb);
    
    /* 发送 ACK */
    tcp_send_ack(sk);
    
    /* 状态转换 */
    tcp_set_state(sk, TCP_ESTABLISHED);
}
```

### TCP 数据传输

**定义位置**：**`net/ipv4/tcp.c`**

```c
/*
 * TCP 发送数据
 */
int tcp_sendmsg(struct sock *sk, struct msghdr *msg, size_t size)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    int copied = 0;
    
    /* 循环发送数据 */
    while (msg_data_left(msg)) {
        /* 获取发送缓冲区 */
        skb = tcp_write_queue_tail(sk);
        
        if (!skb || !skb_can_coalesce(skb, msg)) {
            /* 分配新的 sk_buff */
            skb = sk_stream_alloc_skb(sk, size, sk->sk_allocation);
            tcp_skb_entail(sk, skb);
        }
        
        /* 复制数据 */
        copy = min_t(int, size, skb_availroom(skb));
        skb_add_data_nocache(sk, skb, &msg->msg_iter, copy);
        
        copied += copy;
        
        /* 发送数据 */
        tcp_push(sk, flags);
    }
    
    return copied;
}

/*
 * TCP 接收数据
 */
int tcp_recvmsg(struct sock *sk, struct msghdr *msg, size_t len,
                int nonblock, int flags, int *addr_len)
{
    struct tcp_sock *tp = tcp_sk(sk);
    int copied = 0;
    
    /* 循环接收数据 */
    while (copied < len) {
        struct sk_buff *skb;
        
        /* 从接收队列获取数据 */
        skb = tcp_recv_skb(sk, seq, &offset);
        
        if (!skb) {
            /* 等待数据 */
            if (copied)
                break;
            
            if (sk_wait_data(sk, &timeo, NULL))
                goto out;
            
            continue;
        }
        
        /* 复制数据到用户空间 */
        copy = min_t(int, len - copied, skb->len - offset);
        skb_copy_datagram_msg(skb, offset, msg, copy);
        
        copied += copy;
        seq += copy;
    }
    
out:
    return copied;
}
```

---

# 十二、拥塞控制：防止网络过载

## 问题：网络拥塞

```
网络容量有限：
- 路由器缓冲区有限
- 链路带宽有限
- 过多的数据包导致拥塞

拥塞的表现：
- 数据包丢失
- 延迟增加
- 吞吐量下降
```

## 解决方案：TCP 拥塞控制

### 拥塞控制算法

Linux 5.15 支持多种拥塞控制算法：

1. **Reno**：经典的 AIMD 算法
2. **CUBIC**：Linux 默认算法
3. **BBR**：Google 开发的算法
4. **DCTCP**：数据中心 TCP

### CUBIC 算法

**定义位置**：**`net/ipv4/tcp_cubic.c`**

```c
/*
 * CUBIC 拥塞控制算法
 * 
 * 使用三次函数计算拥塞窗口
 * W(t) = C(t - K)^3 + W_max
 * 
 * 其中：
 * - W(t): t 时刻的拥塞窗口
 * - W_max: 上次拥塞时的窗口大小
 * - C: 常数（默认 0.4）
 * - K: W_max 达到的时间
 */
struct bictcp {
    u32     cnt;            /* 增加 cwnd 的计数 */
    u32     last_max_cwnd;  /* 上次拥塞时的窗口 */
    u32     last_cwnd;      /* 上次的窗口 */
    u32     last_time;      /* 上次的时间 */
    u32     bic_origin_point;/* 原点 */
    u32     bic_K;          /* 时间常数 */
    u32     delay_min;      /* 最小延迟 */
    u32     epoch_start;    /* 拥塞周期开始时间 */
    u32     ack_cnt;        /* ACK 计数 */
    u32     tcp_cwnd;       /* TCP 友好窗口 */
};

/*
 * 计算拥塞窗口
 */
static u32 bictcp_recalc_ssthresh(struct sock *sk)
{
    const struct tcp_sock *tp = tcp_sk(sk);
    struct bictcp *ca = inet_csk_ca(sk);
    
    ca->last_max_cwnd = tp->snd_cwnd;
    
    /* 计算 K */
    ca->bic_K = cubic_root(ca->last_max_cwnd);
    
    return max((tp->snd_cwnd * beta) >> 3, 2U);
}

/*
 * 更新拥塞窗口
 */
static void bictcp_cong_avoid(struct sock *sk, u32 ack, u32 acked)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct bictcp *ca = inet_csk_ca(sk);
    
    /* 慢启动阶段 */
    if (tp->snd_cwnd <= tp->snd_ssthresh) {
        tp->snd_cwnd++;
        return;
    }
    
    /* 拥塞避免阶段 */
    bictcp_update(ca, tp->snd_cwnd);
    
    if (ca->cnt > 0)
        tp->snd_cwnd += acked / ca->cnt;
}
```

---

# 十三、Socket 缓冲区：流量控制

## 问题：发送方和接收方速度不匹配

```
发送方：快速发送数据
接收方：处理速度慢

结果：
- 接收方缓冲区溢出
- 数据包丢失
- 网络拥塞
```

## 解决方案：滑动窗口

### 发送窗口

```
发送窗口：
┌─────────────────────────────────────────────────────┐
│   已发送已确认   │   已发送未确认   │   可发送   │不可发送│
└─────────────────────────────────────────────────────┘
                   ↑                ↑           ↑
               snd_una          snd_nxt    snd_una + wnd

- snd_una: 已确认的序列号
- snd_nxt: 下一个要发送的序列号
- wnd: 接收方通告的窗口大小
```

### 接收窗口

```
接收窗口：
┌─────────────────────────────────────────────────────┐
│   已接收已读取   │   已接收未读取   │   可接收   │不可接收│
└─────────────────────────────────────────────────────┘
                   ↑                ↑           ↑
               rcv_wup           rcv_nxt    rcv_wup + wnd

- rcv_wup: 已通告的序列号
- rcv_nxt: 期望接收的序列号
- wnd: 接收缓冲区剩余空间
```

## Linux 5.15 的实现

```c
/*
 * TCP 缓冲区管理
 */
struct tcp_sock {
    /* 发送缓冲区 */
    u32     snd_una;        /* 已确认的序列号 */
    u32     snd_nxt;        /* 下一个发送序列号 */
    u32     snd_wnd;        /* 发送窗口大小 */
    u32     snd_cwnd;       /* 拥塞窗口大小 */
    u32     snd_ssthresh;   /* 慢启动阈值 */
    
    /* 接收缓冲区 */
    u32     rcv_nxt;        /* 期望接收的序列号 */
    u32     rcv_wnd;        /* 接收窗口大小 */
    u32     rcv_wup;        /* 窗口更新点 */
    
    /* 缓冲区大小 */
    int     sk_rcvbuf;      /* 接收缓冲区大小 */
    int     sk_sndbuf;      /* 发送缓冲区大小 */
    
    /* 队列 */
    struct sk_buff_head     out_of_order_queue;  /* 乱序队列 */
    struct sk_buff_head     receive_queue;       /* 接收队列 */
    struct sk_buff_head     write_queue;         /* 发送队列 */
};

/*
 * 更新接收窗口
 */
static void tcp_update_rcv_wnd(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    u32 new_window;
    
    /* 计算新的窗口大小 */
    new_window = tcp_select_window(sk);
    
    /* 更新窗口 */
    tp->rcv_wnd = new_window;
}

/*
 * 发送窗口更新
 */
static void tcp_send_window_update(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    
    /* 发送 ACK，通告新的窗口 */
    tcp_send_ack(sk);
}
```

---

# 十四、总结：Linux 网络协议栈的完整逻辑链

你可以把它背成下面这条链：

### 1. 程序需要网络通信

但直接使用网络硬件有协议复杂性、并发访问、可靠性、异构网络等问题。

### 2. 于是引入网络协议栈

将网络通信分解为多个层次，每层只关注自己的职责。

### 3. 数据包需要高效管理

使用 sk_buff 结构，支持零拷贝和高效的数据包处理。

### 4. 网络设备需要统一管理

使用 net_device 结构，提供统一的设备接口。

### 5. 应用程序需要统一接口

使用 Socket API，屏蔽底层细节。

### 6. 数据包需要从网卡到应用

通过分层处理，逐层解封装，最终到达应用程序。

### 7. 数据包需要从应用到网卡

通过分层处理，逐层封装，最终由网卡发送。

### 8. 高速网络需要高效接收

使用 NAPI，混合使用中断和轮询。

### 9. 网络传输需要可靠性

使用 TCP 协议，提供可靠的传输服务。

### 10. 网络需要防止拥塞

使用拥塞控制算法，动态调整发送速率。

### 11. 发送方和接收方需要协调

使用滑动窗口，实现流量控制。

---

# 十五、一句话总结 Linux 网络协议栈

> **Linux 网络协议栈的核心思想是：通过分层设计将复杂的网络通信分解为可管理的模块，使用 sk_buff 高效管理数据包，通过 Socket 提供统一的应用接口，使用 TCP 提供可靠的传输服务，通过拥塞控制和流量控制保证网络的稳定性和公平性。**

---

## 参考资料

### 源码文件

- **`net/core/dev.c`** - 网络设备核心
- **`net/core/skbuff.c`** - sk_buff 操作
- **`net/core/sock.c`** - Socket 核心
- **`net/ipv4/tcp.c`** - TCP 协议
- **`net/ipv4/tcp_input.c`** - TCP 输入处理
- **`net/ipv4/tcp_output.c`** - TCP 输出处理
- **`net/ipv4/ip_input.c`** - IP 输入处理
- **`net/ipv4/ip_output.c`** - IP 输出处理
- **`include/linux/skbuff.h`** - sk_buff 定义
- **`include/linux/netdevice.h`** - net_device 定义
- **`include/net/sock.h`** - sock 定义

### 文档

- Documentation/networking/index.rst
- Documentation/networking/napi.rst
- Documentation/networking/tcp.rst

---

**文档版本**: 1.0  
**创建日期**: 2026-05-08  
**基于内核版本**: Linux 5.15.204
