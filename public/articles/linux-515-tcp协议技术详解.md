# Linux 5.15 TCP协议技术详解

> 本文档从初学者角度详细讲解Linux内核TCP协议实现，涵盖三次握手/四次挥手、拥塞控制框架、发送/接收窗口、TSO/GRO卸载特性，以及ss -ti输出对应的内核变量。

---

## 目录

1. **`TCP协议概述`**
2. **`TCP核心数据结构`**
3. **`三次握手实现`**
4. **`四次挥手实现`**
5. **`拥塞控制框架`**
6. **`发送窗口与接收窗口`**
7. **`TSO/GRO卸载特性`**
8. **`ss命令输出解析`**
9. **`调试与问题排查`**
10. **`总结`**

---

## 一、TCP协议概述

### 1.1 TCP在网络协议栈中的位置

```
┌─────────────────────────────────────────────────────────────────┐
│                    网络协议栈分层                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    应用层                                │   │
│  │  HTTP, FTP, SSH, SMTP, Telnet, ...                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              ★ 传输层 ★                                 │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              TCP (Transmission Control           │   │   │
│  │  │                   Protocol)                      │   │   │
│  │  │                                                 │   │   │
│  │  │  • 面向连接                                     │   │   │
│  │  │  • 可靠传输                                     │   │   │
│  │  │  • 流量控制（滑动窗口）                         │   │   │
│  │  │  • 拥塞控制（慢启动、拥塞避免等）               │   │   │
│  │  │  • 有序传输                                     │   │   │
│  │  │  • 全双工                                       │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    IP层                                 │   │
│  │  IPv4 / IPv6                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    链路层                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 TCP协议特性

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP协议特性                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 面向连接（Connection-Oriented）                             │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ • 三次握手建立连接                                   │    │
│     │ • 四次挥手断开连接                                   │    │
│     │ • 维护连接状态（11种状态）                           │    │
│     │ • 连接期间保持状态信息                               │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. 可靠传输（Reliable Transmission）                           │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ • 确认机制（ACK）                                    │    │
│     │ • 超时重传（RTO）                                    │    │
│     │ • 快速重传（Fast Retransmit）                        │    │
│     │ • 选择性确认（SACK）                                 │    │
│     │ • 序列号保证顺序                                     │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. 流量控制（Flow Control）                                    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ • 滑动窗口机制                                       │    │
│     │ • 接收窗口（rcv_wnd）                                │    │
│     │ • 发送窗口（snd_wnd）                                │    │
│     │ • 防止发送方淹没接收方                               │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  4. 拥塞控制（Congestion Control）                              │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ • 慢启动（Slow Start）                               │    │
│     │ • 拥塞避免（Congestion Avoidance）                   │    │
│     │ • 快速恢复（Fast Recovery）                          │    │
│     │ • 拥塞窗口（cwnd）                                   │    │
│     │ • 多种算法：CUBIC、BBR、Reno等                       │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  5. 全双工（Full-Duplex）                                       │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ • 双向同时传输                                       │    │
│     │ • 独立的发送和接收通道                               │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 TCP状态转换图

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP状态转换图                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                              ┌─────────┐                        │
│                              │ CLOSED  │                        │
│                              └────┬────┘                        │
│                                   │                             │
│                    ┌──────────────┴──────────────┐             │
│                    │                             │             │
│              passive open                  active open          │
│            (listen()调用)                (connect()调用)        │
│                    │                             │             │
│                    ▼                             ▼             │
│              ┌─────────┐                  ┌─────────┐          │
│              │ LISTEN  │                  │SYN_SENT │          │
│              └────┬────┘                  └────┬────┘          │
│                   │                             │               │
│             收到SYN                        收到SYN+ACK          │
│           发送SYN+ACK                     发送ACK               │
│                   │                             │               │
│                   ▼                             │               │
│              ┌─────────┐                        │               │
│              │SYN_RECV │                        │               │
│              └────┬────┘                        │               │
│                   │                             │               │
│              收到ACK                             │               │
│                   │                             │               │
│                   └──────────────┬──────────────┘             │
│                                  │                             │
│                                  ▼                             │
│                           ┌─────────────┐                      │
│                           │ ESTABLISHED │                      │
│                           └──────┬──────┘                      │
│                                  │                             │
│                    ┌─────────────┴─────────────┐              │
│                    │                           │              │
│              close()主动关闭              close()被动关闭       │
│              发送FIN                      收到FIN              │
│                    │                      发送ACK              │
│                    ▼                           │              │
│              ┌─────────┐                       │              │
│              │FIN_WAIT1│                       │              │
│              └────┬────┘                       │              │
│                   │                            │              │
│              收到ACK                            │              │
│                   │                            │              │
│                   ▼                            ▼              │
│              ┌─────────┐                 ┌─────────┐          │
│              │FIN_WAIT2│                 │CLOSE_WAIT│         │
│              └────┬────┘                 └────┬────┘          │
│                   │                           │               │
│              收到FIN                      close()             │
│              发送ACK                      发送FIN              │
│                   │                           │               │
│                   └───────────┬───────────────┘              │
│                               │                              │
│                               ▼                              │
│                         ┌─────────┐                           │
│                         │ LAST_ACK│                           │
│                         └────┬────┘                           │
│                              │                                │
│                         收到ACK                                │
│                              │                                │
│                              ▼                                │
│                         ┌─────────┐                           │
│                         │ CLOSED  │                           │
│                         └─────────┘                           │
│                                                                 │
│              ┌─────────┐                                        │
│              │TIME_WAIT│  (2MSL等待)                            │
│              └────┬────┘                                        │
│                   │                                             │
│              超时后进入CLOSED                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、TCP核心数据结构

### 2.1 tcp_sock 结构

```c
/* include/linux/tcp.h */

struct tcp_sock {
    /* inet_connection_sock has to be the first member of tcp_sock */
    struct inet_connection_sock inet_conn;
    
    u16 tcp_header_len;  /* TCP头部长度 */
    u16 gso_segs;        /* GSO分段数 */
    
    __be32 pred_flags;   /* 预测标志 */
    
/*
 *  RFC793变量 - 核心序列号管理
 */
    u64 bytes_received;  /* 接收的总字节数 */
    u32 segs_in;         /* 接收的总段数 */
    u32 data_segs_in;    /* 接收的数据段数 */
    
    u32 rcv_nxt;         /* ★ 期望接收的下一个序列号 */ 
    u32 copied_seq;      /* 已复制到用户空间的序列号 */
    u32 rcv_wup;         /* 最后一次窗口更新时的rcv_nxt */
    
    u32 snd_nxt;         /* ★ 下一个要发送的序列号 */
    u32 segs_out;        /* 发送的总段数 */
    u32 data_segs_out;   /* 发送的数据段数 */
    
    u64 bytes_sent;      /* 发送的总字节数 */
    u64 bytes_acked;     /* 已确认的总字节数 */
    
    u32 snd_una;         /* ★ 最老的未确认序列号 */
    u32 snd_sml;         /* 最近发送的小包的最后一个字节 */
    
    u32 rcv_tstamp;      /* 最后收到ACK的时间戳 */
    u32 lsndtime;        /* 最后发送数据包的时间戳 */
    
/*
 *  发送和接收窗口
 */
    u32 snd_wl1;         /* 用于窗口更新的序列号 */
    u32 snd_wnd;         /* ★ 发送窗口大小 */
    u32 max_window;      /* 曾见过的最大窗口 */
    u32 mss_cache;       /* 缓存的MSS */
    
    u32 window_clamp;    /* 最大可通告窗口 */
    u32 rcv_ssthresh;    /* 当前接收窗口阈值 */
    
/*
 *  RTT测量
 */
    u64 tcp_mstamp;      /* 最近包的时间戳 */
    u32 srtt_us;         /* ★ 平滑RTT（微秒） */
    u32 mdev_us;         /* RTT平均偏差 */
    u32 mdev_max_us;     /* 最大平均偏差 */
    u32 rttvar_us;       /* 平滑的RTT方差 */
    
/*
 *  拥塞控制相关
 */
    u32 snd_ssthresh;    /* ★ 慢启动阈值 */
    u32 snd_cwnd;        /* ★ 拥塞窗口 */
    u32 snd_cwnd_cnt;    /* 拥塞窗口计数器 */
    u32 snd_cwnd_clamp;  /* 拥塞窗口上限 */
    
    u32 prior_cwnd;      /* 恢复前的cwnd */
    u32 prr_delivered;   /* 恢复期间已交付的包数 */
    u32 prr_out;         /* 恢复期间发送的总包数 */
    
    u32 delivered;       /* 总交付的数据包数 */
    u32 delivered_ce;    /* 带ECE标记的交付包数 */
    u32 lost;            /* ★ 丢失的总数据包数 */
    
/*
 *  接收窗口
 */
    u32 rcv_wnd;         /* ★ 当前接收窗口 */
    u32 write_seq;       /* 发送缓冲区尾部的序列号 */
    
/*
 *  重传相关
 */
    u32 retrans_out;     /* 重传的包数 */
    u32 lost_out;        /* 丢失的包数 */
    u32 sacked_out;      /* SACK确认的包数 */
    
    u32 total_retrans;   /* 总重传次数 */
    
/*
 *  其他重要字段
 */
    u32 urg_data;        /* 紧急数据 */
    u8  ecn_flags;       /* ECN标志 */
    u8  keepalive_probes;/* 保活探测次数 */
    u32 reordering;      /* 包重排序度量 */
    
    /* SACK相关 */
    struct tcp_sack_block duplicate_sack[1];  /* D-SACK块 */
    struct tcp_sack_block selective_acks[4];  /* SACK块 */
    
    /* 乱序队列 */
    struct rb_root out_of_order_queue;
    
    /* 选项信息 */
    struct tcp_options_received rx_opt;
    
    /* 保活设置 */
    unsigned int keepalive_time;   /* 保活时间 */
    unsigned int keepalive_intvl;  /* 保活间隔 */
};
```

**关键成员说明：**

1. **序列号管理**：
   - `snd_nxt`: 下一个要发送的序列号
   - `snd_una`: 最老的未确认序列号
   - `rcv_nxt`: 期望接收的下一个序列号

2. **窗口管理**：
   - `snd_wnd`: 发送窗口（对端通告的窗口大小）
   - `rcv_wnd`: 接收窗口（本端通告给对端的窗口大小）
   - `snd_cwnd`: 拥塞窗口

3. **RTT测量**：
   - `srtt_us`: 平滑RTT（Smoothed RTT）
   - `rttvar_us`: RTT方差

4. **拥塞控制**：
   - `snd_ssthresh`: 慢启动阈值
   - `snd_cwnd`: 拥塞窗口
   - `lost`: 丢失的包数

### 2.2 tcp_congestion_ops 结构

```c
/* include/net/tcp.h */

struct tcp_congestion_ops {
/* 快速路径字段放在前面，填充一个缓存行 */

    /* 返回慢启动阈值（必须） */
    u32 (*ssthresh)(struct sock *sk);

    /* 拥塞避免计算（必须） */
    void (*cong_avoid)(struct sock *sk, u32 ack, u32 acked);

    /* 状态改变前调用（可选） */
    void (*set_state)(struct sock *sk, u8 new_state);

    /* cwnd事件发生时调用（可选） */
    void (*cwnd_event)(struct sock *sk, enum tcp_ca_event ev);

    /* ACK到达时调用（可选） */
    void (*in_ack_event)(struct sock *sk, u32 flags);

    /* 包ACK记账钩子（可选） */
    void (*pkts_acked)(struct sock *sk, const struct ack_sample *sample);

    /* 覆盖sysctl_tcp_min_tso_segs */
    u32 (*min_tso_segs)(struct sock *sk);

    /* 包交付后更新cwnd和pacing rate（可选） */
    void (*cong_control)(struct sock *sk, const struct rate_sample *rs);

    /* 丢失后cwnd的新值（必须） */
    u32 (*undo_cwnd)(struct sock *sk);
    
    /* tcp_sndbuf_expand的乘数（可选） */
    u32 (*sndbuf_expand)(struct sock *sk);

/* 控制/慢路径放在最后 */

    /* 获取诊断信息（可选） */
    size_t (*get_info)(struct sock *sk, u32 ext, int *attr,
                       union tcp_cc_info *info);

    char name[TCP_CA_NAME_MAX];  /* 算法名称 */
    struct module *owner;        /* 所属模块 */
    struct list_head list;       /* 链表节点 */
    u32 key;                     /* 算法键值 */
    u32 flags;                   /* 标志 */

    /* 初始化私有数据（可选） */
    void (*init)(struct sock *sk);
    
    /* 清理私有数据（可选） */
    void (*release)(struct sock *sk);
} ____cacheline_aligned_in_smp;
```

**关键回调函数说明：**

1. **ssthresh()**: 计算新的慢启动阈值
2. **cong_avoid()**: 拥塞避免算法（慢启动+拥塞避免）
3. **set_state()**: 拥塞状态改变时的回调
4. **pkts_acked()**: 包被确认时的回调
5. **cong_control()**: 新的拥塞控制接口（BBR使用）
6. **undo_cwnd()**: 恢复cwnd（错误检测后的撤销）

### 2.3 TCP数据结构关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP数据结构关系                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  struct sock (通用socket)                                       │
│  └─▶ struct inet_connection_sock (INET连接socket)               │
│       └─▶ struct tcp_sock (TCP socket)                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  tcp_sock                                               │   │
│  │                                                         │   │
│  │  序列号管理：                                           │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ snd_una <────── In Flight ──────> snd_nxt       │   │   │
│  │  │                                                 │   │   │
│  │  │ 发送窗口：snd_wnd (对端通告)                     │   │   │
│  │  │ 拥塞窗口：snd_cwnd (本端计算)                    │   │   │
│  │  │ 有效窗口：min(snd_wnd, snd_cwnd)                │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  接收管理：                                             │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ rcv_nxt (期望接收)                               │   │   │
│  │  │ rcv_wnd (接收窗口)                               │   │   │
│  │  │ copied_seq (已复制到用户空间)                    │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  拥塞控制：                                             │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ icsk_ca_ops ──▶ tcp_congestion_ops              │   │   │
│  │  │                   (CUBIC/BBR/Reno等)             │   │   │
│  │  │                                                 │   │   │
│  │  │ snd_ssthresh (慢启动阈值)                        │   │   │
│  │  │ snd_cwnd (拥塞窗口)                              │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  RTT测量：                                              │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ srtt_us (平滑RTT)                                │   │   │
│  │  │ rttvar_us (RTT方差)                              │   │   │
│  │  │ RTO = srtt + 4*rttvar                            │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、三次握手实现

### 3.1 三次握手流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP三次握手流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  客户端                                服务端                    │
│  CLOSED                                LISTEN                    │
│    │                                     │                       │
│    │  1. connect()                       │                       │
│    │     tcp_v4_connect()                │                       │
│    │     tcp_connect()                   │                       │
│    │     发送SYN                         │                       │
│    ├─────────────────────────────────────▶                       │
│    │   SYN, seq=x                        │                       │
│    │                                     │                       │
│    │  SYN_SENT                           │                       │
│    │                                     │                       │
│    │                   2. 收到SYN        │                       │
│    │                      tcp_rcv_state_process()               │
│    │                      发送SYN+ACK   │                       │
│    ◀─────────────────────────────────────┤                       │
│    │   SYN+ACK, seq=y, ack=x+1           │                       │
│    │                                     │                       │
│    │                                     │  SYN_RECV             │
│    │                                     │                       │
│    │  3. 收到SYN+ACK                     │                       │
│    │     tcp_rcv_state_process()         │                       │
│    │     发送ACK                         │                       │
│    ├─────────────────────────────────────▶                       │
│    │   ACK, seq=x+1, ack=y+1             │                       │
│    │                                     │                       │
│    │  ESTABLISHED                        │                       │
│    │                                     │                       │
│    │                   4. 收到ACK        │                       │
│    │                      tcp_rcv_state_process()               │
│    │                                     │                       │
│    │                                     │  ESTABLISHED          │
│    │                                     │                       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 tcp_v4_connect 函数

```c
/* net/ipv4/tcp_ipv4.c */

/*
 * tcp_v4_connect - TCP IPv4连接建立（客户端）
 * @sk:       socket
 * @uaddr:    目标地址
 * @addr_len: 地址长度
 *
 * 这是客户端发起连接的入口函数
 * 对应应用层的connect()系统调用
 */
int tcp_v4_connect(struct sock *sk, struct sockaddr *uaddr, int addr_len)
{
    struct sockaddr_in *usin = (struct sockaddr_in *)uaddr;
    struct inet_sock *inet = inet_sk(sk);
    struct tcp_sock *tp = tcp_sk(sk);
    __be16 orig_sport, orig_dport;
    __be32 daddr, nexthop;
    struct flowi4 *fl4;
    struct rtable *rt;
    int err;
    struct ip_options_rcu *inet_opt;

    /* 1. 参数检查 */
    if (addr_len < sizeof(struct sockaddr_in))
        return -EINVAL;

    if (usin->sin_family != AF_INET)
        return -EAFNOSUPPORT;

    nexthop = daddr = usin->sin_addr.s_addr;
    
    /* 2. 处理IP选项（源路由等） */
    inet_opt = rcu_dereference_protected(inet->inet_opt,
                                         lockdep_sock_is_held(sk));
    if (inet_opt && inet_opt->opt.srr) {
        if (!daddr)
            return -EINVAL;
        nexthop = inet_opt->opt.faddr;
    }

    orig_sport = inet->inet_sport;
    orig_dport = usin->sin_port;
    
    /* 3. 路由查找 */
    fl4 = &inet->cork.fl.u.ip4;
    rt = ip_route_connect(fl4, nexthop, inet->inet_saddr,
                          RT_CONN_FLAGS(sk), sk->sk_bound_dev_if,
                          IPPROTO_TCP,
                          orig_sport, orig_dport, sk);
    if (IS_ERR(rt)) {
        err = PTR_ERR(rt);
        if (err == -ENETUNREACH)
            IP_INC_STATS(sock_net(sk), IPSTATS_MIB_OUTNOROUTES);
        return err;
    }

    /* 检查是否为组播或广播地址 */
    if (rt->rt_flags & (RTCF_MULTICAST | RTCF_BROADCAST)) {
        ip_rt_put(rt);
        return -ENETUNREACH;
    }

    if (!inet_opt || !inet_opt->opt.srr)
        daddr = fl4->daddr;

    /* 4. 设置源IP地址 */
    if (!inet->inet_saddr)
        inet->inet_saddr = fl4->saddr;
    sk_rcv_saddr_set(sk, inet->inet_saddr);

    /* 5. 重置时间戳（如果目标地址改变） */
    if (tp->rx_opt.ts_recent_stamp && inet->inet_daddr != daddr) {
        tp->rx_opt.ts_recent = 0;
        tp->rx_opt.ts_recent_stamp = 0;
        if (likely(!tp->repair))
            WRITE_ONCE(tp->write_seq, 0);
    }

    /* 6. 设置目标地址和端口 */
    inet->inet_dport = usin->sin_port;
    sk_daddr_set(sk, daddr);

    inet_csk(sk)->icsk_ext_hdr_len = 0;
    if (inet_opt)
        inet_csk(sk)->icsk_ext_hdr_len = inet_opt->opt.optlen;

    tp->rx_opt.mss_clamp = TCP_MSS_DEFAULT;

    /* 7. ★ 设置状态为SYN_SENT ★ */
    tcp_set_state(sk, TCP_SYN_SENT);
    
    /* 8. 哈希socket（选择本地端口） */
    err = inet_hash_connect(tcp_death_row, sk);
    if (err)
        goto failure;

    sk_set_txhash(sk);

    /* 9. 重新路由（端口可能改变） */
    rt = ip_route_newports(fl4, rt, orig_sport, orig_dport,
                           inet->inet_sport, inet->inet_dport, sk);
    if (IS_ERR(rt)) {
        err = PTR_ERR(rt);
        rt = NULL;
        goto failure;
    }
    
    /* 10. 设置GSO和路由 */
    sk->sk_gso_type = SKB_GSO_TCPV4;
    sk_setup_caps(sk, &rt->dst);
    rt = NULL;

    /* 11. 生成初始序列号（ISS） */
    if (likely(!tp->repair)) {
        if (!tp->write_seq)
            WRITE_ONCE(tp->write_seq,
                       secure_tcp_seq(inet->inet_saddr,
                                      inet->inet_daddr,
                                      inet->inet_sport,
                                      usin->sin_port));
        tp->tsoffset = secure_tcp_ts_off(sock_net(sk),
                                         inet->inet_saddr,
                                         inet->inet_daddr);
    }

    inet->inet_id = prandom_u32();

    /* 12. Fast Open处理 */
    if (tcp_fastopen_defer_connect(sk, &err))
        return err;
    if (err)
        goto failure;

    /* 13. ★ 发送SYN包 ★ */
    err = tcp_connect(sk);

    if (err)
        goto failure;

    return 0;

failure:
    tcp_set_state(sk, TCP_CLOSE);
    if (!(sk->sk_userlocks & SOCK_BINDADDR_LOCK))
        inet_reset_saddr(sk);
    ip_rt_put(rt);
    sk->sk_route_caps = 0;
    inet->inet_dport = 0;
    return err;
}
```

### 3.3 tcp_connect 函数

```c
/* net/ipv4/tcp_output.c */

/*
 * tcp_connect - 发送SYN包，启动三次握手
 * @sk: socket
 *
 * 这是实际发送SYN包的函数
 */
int tcp_connect(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *buff;
    int err;

    /* BPF回调 */
    tcp_call_bpf(sk, BPF_SOCK_OPS_TCP_CONNECT_CB, 0, NULL);

    /* 重建IP头 */
    if (inet_csk(sk)->icsk_af_ops->rebuild_header(sk))
        return -EHOSTUNREACH;

    /* 初始化连接参数 */
    tcp_connect_init(sk);

    /* Repair模式（调试用） */
    if (unlikely(tp->repair)) {
        tcp_finish_connect(sk, NULL);
        return 0;
    }

    /* ★ 分配SYN包的skb ★ */
    buff = sk_stream_alloc_skb(sk, 0, sk->sk_allocation, true);
    if (unlikely(!buff))
        return -ENOBUFS;

    /* ★ 构造SYN包 ★ */
    tcp_init_nondata_skb(buff, tp->write_seq++, TCPHDR_SYN);
    tcp_mstamp_refresh(tp);
    tp->retrans_stamp = tcp_time_stamp(tp);
    
    /* 将SYN包加入发送队列 */
    tcp_connect_queue_skb(sk, buff);
    
    /* ECN处理 */
    tcp_ecn_send_syn(sk, buff);
    
    /* 插入重传队列 */
    tcp_rbtree_insert(&sk->tcp_rtx_queue, buff);

    /* ★ 发送SYN包 ★ */
    err = tp->fastopen_req ? tcp_send_syn_data(sk, buff) :
          tcp_transmit_skb(sk, buff, 1, sk->sk_allocation);
    if (err == -ECONNREFUSED)
        return err;

    /* 更新snd_nxt */
    WRITE_ONCE(tp->snd_nxt, tp->write_seq);
    tp->pushed_seq = tp->write_seq;
    
    buff = tcp_send_head(sk);
    if (unlikely(buff)) {
        WRITE_ONCE(tp->snd_nxt, TCP_SKB_CB(buff)->seq);
        tp->pushed_seq = TCP_SKB_CB(buff)->seq;
    }
    
    TCP_INC_STATS(sock_net(sk), TCP_MIB_ACTIVEOPENS);

    /* ★ 启动重传定时器 ★ */
    inet_csk_reset_xmit_timer(sk, ICSK_TIME_RETRANS,
                              inet_csk(sk)->icsk_rto, TCP_RTO_MAX);
    return 0;
}
```

### 3.4 三次握手关键步骤

```
┌─────────────────────────────────────────────────────────────────┐
│                三次握手关键步骤                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  客户端（主动打开）：                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. connect()系统调用                                   │   │
│  │     └─▶ tcp_v4_connect()                                │   │
│  │          ├─▶ 参数检查                                   │   │
│  │          ├─▶ 路由查找                                   │   │
│  │          ├─▶ 设置目标地址和端口                         │   │
│  │          ├─▶ 设置状态为TCP_SYN_SENT                     │   │
│  │          ├─▶ 选择本地端口（inet_hash_connect）           │   │
│  │          ├─▶ 生成初始序列号                             │   │
│  │          └─▶ tcp_connect()                              │   │
│  │               ├─▶ 分配SYN包skb                          │   │
│  │               ├─▶ 构造SYN包                             │   │
│  │               │    • seq = ISS（初始序列号）             │   │
│  │               │    • flags = SYN                        │   │
│  │               ├─▶ 发送SYN包                             │   │
│  │               └─▶ 启动重传定时器                        │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  服务端（被动打开）：                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. listen()系统调用                                    │   │
│  │     └─▶ 设置状态为TCP_LISTEN                            │   │
│  │                                                         │   │
│  │  2. 收到SYN包                                           │   │
│  │     └─▶ tcp_rcv_state_process()                         │   │
│  │          ├─▶ 检查状态为TCP_LISTEN                       │   │
│  │          ├─▶ 创建request_sock（半连接）                 │   │
│  │          ├─▶ 发送SYN+ACK                                │   │
│  │          │    • seq = ISS_server                        │   │
│  │          │    • ack = client_seq + 1                    │   │
│  │          │    • flags = SYN|ACK                         │   │
│  │          └─▶ 设置状态为TCP_SYN_RECV                     │   │
│  │                                                         │   │
│  │  3. 收到ACK包                                           │   │
│  │     └─▶ tcp_rcv_state_process()                         │   │
│  │          ├─▶ 检查状态为TCP_SYN_RECV                     │   │
│  │          ├─▶ 创建完整的socket                           │   │
│  │          └─▶ 设置状态为TCP_ESTABLISHED                  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  客户端收到SYN+ACK：                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. 收到SYN+ACK                                         │   │
│  │     └─▶ tcp_rcv_state_process()                         │   │
│  │          ├─▶ 检查状态为TCP_SYN_SENT                     │   │
│  │          ├─▶ 发送ACK                                    │   │
│  │          │    • seq = client_seq + 1                    │   │
│  │          │    • ack = server_seq + 1                    │   │
│  │          │    • flags = ACK                             │   │
│  │          └─▶ 设置状态为TCP_ESTABLISHED                  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、四次挥手实现

### 4.1 四次挥手流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP四次挥手流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  主动关闭方                            被动关闭方                │
│  ESTABLISHED                           ESTABLISHED              │
│    │                                     │                       │
│    │  1. close()                         │                       │
│    │     tcp_close()                     │                       │
│    │     发送FIN                         │                       │
│    ├─────────────────────────────────────▶                       │
│    │   FIN, seq=x                        │                       │
│    │                                     │                       │
│    │  FIN_WAIT1                          │                       │
│    │                                     │                       │
│    │                   2. 收到FIN        │                       │
│    │                      发送ACK        │                       │
│    ◀─────────────────────────────────────┤                       │
│    │   ACK, ack=x+1                      │                       │
│    │                                     │                       │
│    │  FIN_WAIT2                          │  CLOSE_WAIT           │
│    │                                     │                       │
│    │                                     │  3. close()           │
│    │                                     │     发送FIN           │
│    ◀─────────────────────────────────────┤                       │
│    │   FIN, seq=y                        │                       │
│    │                                     │                       │
│    │                                     │  LAST_ACK             │
│    │                                     │                       │
│    │  4. 收到FIN                         │                       │
│    │     发送ACK                         │                       │
│    ├─────────────────────────────────────▶                       │
│    │   ACK, ack=y+1                      │                       │
│    │                                     │                       │
│    │  TIME_WAIT                          │                       │
│    │   (等待2MSL)                        │  CLOSED               │
│    │                                     │                       │
│    │  CLOSED                             │                       │
│    │                                     │                       │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 tcp_close 函数

```c
/* net/ipv4/tcp.c */

/*
 * tcp_close - TCP关闭连接
 * @sk:      socket
 * @timeout: 超时时间
 *
 * 这是应用层close()系统调用的处理函数
 */
void tcp_close(struct sock *sk, long timeout)
{
    lock_sock(sk);
    __tcp_close(sk, timeout);
    release_sock(sk);
    
    if (!sk->sk_net_refcnt)
        inet_csk_clear_xmit_timers_sync(sk);
    
    sock_put(sk);
}

/*
 * __tcp_close - TCP关闭连接的实际实现
 */
void __tcp_close(struct sock *sk, long timeout)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb;
    int data_was_unread = 0;
    int state;

    /* 检查接收队列中是否有未读数据 */
    if ((skb = __skb_dequeue(&sk->sk_receive_queue)) != NULL) {
        /* 有未读数据，设置RST标志 */
        data_was_unread = 1;
        /* 丢弃所有接收队列中的数据 */
        while ((skb = __skb_dequeue(&sk->sk_receive_queue)) != NULL)
            kfree_skb(skb);
    }

    /* 根据当前状态决定关闭方式 */
    state = sk->sk_state;
    
    if (state == TCP_LISTEN) {
        /* 监听状态：停止监听 */
        inet_csk_listen_stop(sk);
        goto adjudge_to_death;
    }

    if (state == TCP_SYN_SENT) {
        /* SYN_SENT状态：发送RST */
        tcp_disconnect(sk, 0);
        goto adjudge_to_death;
    }

    if (data_was_unread) {
        /* 有未读数据：发送RST */
        tcp_send_active_reset(sk, GFP_ATOMIC);
        goto adjudge_to_death;
    }

    if (tcp_close_state(sk)) {
        /* ★ 发送FIN包 ★ */
        tcp_send_fin(sk);
    }

    /* 处理TIME_WAIT状态 */
    if (sk->sk_state == TCP_FIN_WAIT2) {
        /* 等待对方的FIN */
        const int tmo = tcp_fin_time(sk);
        
        if (timeout == 0) {
            /* 立即关闭 */
            tcp_send_active_reset(sk, GFP_ATOMIC);
            goto adjudge_to_death;
        }
        
        if (tmo > TCP_TIMEWAIT_LEN) {
            /* 长时间等待 */
            inet_csk_reset_keepalive_timer(sk, tmo - TCP_TIMEWAIT_LEN);
        } else if (thmo <= TCP_TIMEWAIT_LEN) {
            /* 进入TIME_WAIT状态 */
            tcp_time_wait(sk, TCP_FIN_WAIT2, tmo);
            goto out;
        }
    }

    if (sk->sk_state == TCP_CLOSE) {
        /* 已经关闭 */
        goto adjudge_to_death;
    }

    /* 等待数据发送完成 */
    if (sk->sk_state == TCP_CLOSING || sk->sk_state == TCP_LAST_ACK) {
        if (!tcp_fin_time(sk)) {
            tcp_send_active_reset(sk, GFP_ATOMIC);
            goto adjudge_to_death;
        }
    }

adjudge_to_death:
    /* 设置SOCK_DEAD标志 */
    sock_orphan(sk);

    /* 释放资源 */
    if (sk->sk_state == TCP_CLOSE)
        inet_csk_destroy_sock(sk);

out:
    return;
}
```

### 4.3 tcp_send_fin 函数

```c
/* net/ipv4/tcp_output.c */

/*
 * tcp_send_fin - 发送FIN包
 * @sk: socket
 *
 * 构造并发送FIN包
 */
void tcp_send_fin(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct sk_buff *skb = tcp_write_queue_tail(sk);
    int mss_now;

    /* 如果发送队列最后一个包可以包含FIN */
    if (tcp_send_head(sk) != NULL) {
        /* 在最后一个数据包上设置FIN标志 */
        TCP_SKB_CB(skb)->tcp_flags |= TCPHDR_FIN;
        TCP_SKB_CB(skb)->end_seq++;
        tp->snd_nxt++;
    } else {
        /* 发送独立的FIN包 */
        mss_now = tcp_current_mss(sk);
        
        skb = sk_stream_alloc_skb(sk, 0, sk->sk_allocation, false);
        if (!skb)
            return;

        /* 初始化FIN包 */
        tcp_init_nondata_skb(skb, tp->write_seq,
                             TCPHDR_ACK | TCPHDR_FIN);
        tcp_queue_skb(sk, skb);
    }
    
    /* 发送FIN包 */
    __tcp_push_pending_frames(sk, tcp_current_mss(sk),
                              TCP_NAGLE_OFF);
}
```

### 4.4 四次挥手关键步骤

```
┌─────────────────────────────────────────────────────────────────┐
│                四次挥手关键步骤                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  主动关闭方：                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. close()系统调用                                     │   │
│  │     └─▶ tcp_close()                                     │   │
│  │          ├─▶ 检查接收队列是否有未读数据                 │   │
│  │          │    • 有：发送RST，立即关闭                   │   │
│  │          │    • 无：继续                                │   │
│  │          ├─▶ 检查当前状态                               │   │
│  │          │    • LISTEN：停止监听                        │   │
│  │          │    • SYN_SENT：发送RST                       │   │
│  │          │    • ESTABLISHED：发送FIN                    │   │
│  │          └─▶ tcp_send_fin()                             │   │
│  │               ├─▶ 构造FIN包                             │   │
│  │               │    • seq = snd_nxt                      │   │
│  │               │    • flags = FIN|ACK                    │   │
│  │               └─▶ 发送FIN包                             │   │
│  │                                                         │   │
│  │  2. 收到ACK                                             │   │
│  │     └─▶ 设置状态为TCP_FIN_WAIT2                         │   │
│  │          等待对方的FIN                                   │   │
│  │                                                         │   │
│  │  3. 收到FIN                                             │   │
│  │     └─▶ 发送ACK                                         │   │
│  │          └─▶ 设置状态为TCP_TIME_WAIT                    │   │
│  │               等待2MSL（60秒）                          │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  被动关闭方：                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. 收到FIN                                             │   │
│  │     └─▶ tcp_rcv_state_process()                         │   │
│  │          ├─▶ 发送ACK                                    │   │
│  │          └─▶ 设置状态为TCP_CLOSE_WAIT                   │   │
│  │                                                         │   │
│  │  2. 应用层调用close()                                   │   │
│  │     └─▶ tcp_close()                                     │   │
│  │          ├─▶ 发送FIN                                    │   │
│  │          └─▶ 设置状态为TCP_LAST_ACK                     │   │
│  │                                                         │   │
│  │  3. 收到ACK                                             │   │
│  │     └─▶ 设置状态为TCP_CLOSE                             │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  TIME_WAIT状态的作用：                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. 可靠地终止全双工连接                                │   │
│  │     • 确保最后的ACK能到达对方                           │   │
│  │     • 如果ACK丢失，对方会重发FIN                        │   │
│  │                                                         │   │
│  │  2. 避免旧连接的包干扰新连接                            │   │
│  │     • 等待2MSL，让网络中的旧包消失                      │   │
│  │     • MSL = Maximum Segment Lifetime（60秒）            │   │
│  │     • 2MSL = 120秒（Linux默认60秒）                     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、拥塞控制框架

### 5.1 拥塞控制概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP拥塞控制框架                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  拥塞控制的目标：                                               │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 防止网络拥塞                                       │       │
│  │ • 公平分配网络带宽                                   │       │
│  │ • 最大化网络利用率                                   │       │
│  │ • 保证TCP友好性                                      │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  核心概念：                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 1. 拥塞窗口（cwnd）                                  │       │
│  │    • 发送方维护的窗口                                │       │
│  │    • 根据网络状况动态调整                            │       │
│  │    • 限制发送速率                                    │       │
│  │                                                      │       │
│  │ 2. 慢启动阈值（ssthresh）                            │       │
│  │    • 区分慢启动和拥塞避免                            │       │
│  │    • cwnd < ssthresh：慢启动                         │       │
│  │    • cwnd >= ssthresh：拥塞避免                      │       │
│  │                                                      │       │
│  │ 3. 有效发送窗口                                      │       │
│  │    • min(snd_wnd, snd_cwnd)                          │       │
│  │    • snd_wnd：接收方通告窗口                         │       │
│  │    • snd_cwnd：拥塞窗口                              │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  拥塞控制阶段：                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │                                                      │       │
│  │  1. 慢启动（Slow Start）                             │       │
│  │     • 初始cwnd较小（通常10 MSS）                     │       │
│  │     • 每个ACK确认，cwnd增加1 MSS                     │       │
│  │     • 指数增长：cwnd = cwnd * 2                      │       │
│  │     • 直到达到ssthresh                               │       │
│  │                                                      │       │
│  │  2. 拥塞避免（Congestion Avoidance）                 │       │
│  │     • cwnd >= ssthresh时进入                         │       │
│  │     • 每个RTT，cwnd增加1 MSS                         │       │
│  │     • 线性增长：cwnd = cwnd + 1                      │       │
│  │                                                      │       │
│  │  3. 快速重传（Fast Retransmit）                      │       │
│  │     • 收到3个重复ACK                                 │       │
│  │     • 立即重传丢失的包                               │       │
│  │     • 不等待RTO超时                                  │       │
│  │                                                      │       │
│  │  4. 快速恢复（Fast Recovery）                        │       │
│  │     • 快速重传后进入                                 │       │
│  │     • ssthresh = cwnd / 2                            │       │
│  │     • cwnd = ssthresh + 3                            │       │
│  │     • 收到新ACK后退出                                │       │
│  │                                                      │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 拥塞控制算法框架

```c
/* 拥塞控制算法注册 */

/* 1. 定义拥塞控制算法 */
static struct tcp_congestion_ops tcp_cubic = {
    .name       = "cubic",
    .flags      = TCP_CONG_NON_RESTRICTED,
    .init       = cubic_init,
    .ssthresh   = cubic_ssthresh,
    .cong_avoid = cubic_cong_avoid,
    .set_state  = cubic_set_state,
    .pkts_acked = cubic_pkts_acked,
    .undo_cwnd  = cubic_undo_cwnd,
    .get_info   = cubic_get_info,
    .owner      = THIS_MODULE,
};

/* 2. 注册算法 */
static int __init cubic_register(void)
{
    BUILD_BUG_ON(sizeof(struct cubic) > ICSK_CA_PRIV_SIZE);
    return tcp_register_congestion_control(&tcp_cubic);
}

/* 3. 设置默认算法 */
tcp_set_default_congestion_control(net, "cubic");
```

### 5.3 CUBIC算法

```c
/* net/ipv4/tcp_cubic.c */

/*
 * CUBIC - TCP拥塞控制算法
 * 
 * 特点：
 * 1. 使用三次函数增长cwnd
 * 2. 在高带宽长延迟网络中表现良好
 * 3. Linux默认算法
 */

struct cubic {
    u32 epoch;          /* 拥塞事件开始时间 */
    u32 orig_epoch;     /* 原始epoch */
    u32 last_max;       /* 上次最大cwnd */
    u32 last_cwnd;      /* 上次cwnd */
    u32 last_time;      /* 上次更新时间 */
    u32 bic_origin_point; /* 原点 */
    u32 bic_K;          /* K值 */
    u32 delay_min;      /* 最小延迟 */
    u32 tcp_cwnd;       /* TCP友好cwnd */
};

/*
 * cubic_ssthresh - 计算新的ssthresh
 */
static u32 cubic_ssthresh(struct sock *sk)
{
    const struct tcp_sock *tp = tcp_sk(sk);
    
    /* ssthresh = cwnd * beta (beta = 0.7) */
    return max(tp->snd_cwnd * 7 / 10, 2U);
}

/*
 * cubic_cong_avoid - 拥塞避免主函数
 */
static void cubic_cong_avoid(struct sock *sk, u32 ack, u32 acked)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct cubic *ca = inet_csk_ca(sk);
    u32 delta, bic_target, max_cnt;
    u32 acked_cnt;

    /* 如果处于慢启动 */
    if (!tcp_is_cwnd_limited(sk))
        return;

    /* 慢启动阶段 */
    if (tp->snd_cwnd <= tp->snd_ssthresh) {
        acked = tcp_slow_start(tp, acked);
        if (!acked)
            return;
    }

    /* 拥塞避免阶段 */
    /* 计算时间差 */
    delta = tcp_time_stamp - ca->epoch;
    
    /* 计算CUBIC目标cwnd */
    bic_target = cubic_root(ca, delta);
    
    /* 更新cwnd */
    if (bic_target > tp->snd_cwnd) {
        /* 增加cwnd */
        acked_cnt = bic_target - tp->snd_cwnd;
        if (acked > acked_cnt)
            acked = acked_cnt;
        
        tp->snd_cwnd += acked;
    }
}
```

### 5.4 BBR算法

```c
/* net/ipv4/tcp_bbr.c */

/*
 * BBR - Bottleneck Bandwidth and RTT
 * 
 * 特点：
 * 1. 基于带宽和RTT的拥塞控制
 * 2. 不依赖丢包作为拥塞信号
 * 3. 由Google开发
 */

enum bbr_mode {
    BBR_STARTUP,    /* 启动阶段 */
    BBR_DRAIN,      /* 排空阶段 */
    BBR_PROBE_BW,   /* 探测带宽 */
    BBR_PROBE_RTT,  /* 探测RTT */
};

struct bbr {
    u32 min_rtt_us;      /* 最小RTT */
    u32 min_rtt_stamp;   /* 最小RTT时间戳 */
    u32 bw_lo;           /* 带宽下限 */
    u32 bw_hi;           /* 带宽上限 */
    u32 bw;              /* 当前带宽估计 */
    u32 rtt_cnt;         /* RTT计数 */
    u64 cycle_mstamp;    /* 周期时间戳 */
    u32 mode:2,          /* 当前模式 */
        prev_ca_loss:1,  /* 上次是否丢包 */
        round_start:1,   /* 新的RTT轮次 */
        cycle_idx:3,     /* 周期索引 */
        has_seen_rtt:1;  /* 是否见过RTT */
    u32 target_cwnd;     /* 目标cwnd */
    u32 full_bw;         /* 满带宽 */
    u32 full_bw_cnt;     /* 满带宽计数 */
};

/*
 * bbr_main - BBR主控制函数
 */
static void bbr_main(struct sock *sk, const struct rate_sample *rs)
{
    struct bbr *bbr = inet_csk_ca(sk);
    struct tcp_sock *tp = tcp_sk(sk);
    u32 bw;

    /* 更新带宽估计 */
    bbr_update_bw(sk, rs);
    
    /* 更新RTT */
    bbr_update_min_rtt(sk, rs);
    
    /* 状态机 */
    bbr_check_drain(sk, rs);
    bbr_check_probe_rtt(sk, rs);
    
    /* 计算目标cwnd */
    bbr->target_cwnd = bbr_bdp(sk, bw);
    
    /* 设置pacing rate */
    bbr_set_pacing_rate(sk, bw, bbr->pacing_gain);
}

/*
 * bbr_set_cwnd - 设置cwnd
 */
static void bbr_set_cwnd(struct sock *sk, const struct rate_sample *rs)
{
    struct tcp_sock *tp = tcp_sk(sk);
    struct bbr *bbr = inet_csk_ca(sk);
    u32 cwnd = 0;

    /* 根据模式设置cwnd */
    switch (bbr->mode) {
    case BBR_STARTUP:
        /* 启动阶段：指数增长 */
        cwnd = tp->snd_cwnd + rs->acked_sacked;
        break;
        
    case BBR_PROBE_BW:
        /* 探测带宽：基于BDP */
        cwnd = bbr->target_cwnd;
        break;
        
    case BBR_PROBE_RTT:
        /* 探测RTT：最小cwnd */
        cwnd = 4;
        break;
    }
    
    tp->snd_cwnd = min(cwnd, tp->snd_cwnd_clamp);
}
```

### 5.5 拥塞控制算法对比

| 算法 | 特点 | 适用场景 | Linux默认 |
|------|------|----------|-----------|
| **Reno** | 经典算法，基于AIMD | 低带宽网络 | 否 |
| **CUBIC** | 三次函数增长，TCP友好 | 高带宽长延迟网络 | **是** |
| **BBR** | 基于带宽和RTT，不依赖丢包 | 高性能网络 | 否 |
| **Vegas** | 基于延迟检测 | 低延迟网络 | 否 |
| **Westwood** | 适合无线网络 | 无线网络 | 否 |

### 5.6 拥塞控制操作流程

```
┌─────────────────────────────────────────────────────────────────┐
│                拥塞控制操作流程                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  数据包确认流程：                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. 收到ACK                                             │   │
│  │     └─▶ tcp_ack()                                       │   │
│  │          ├─▶ 更新snd_una                                │   │
│  │          ├─▶ 更新RTT测量                                │   │
│  │          └─▶ tcp_cong_control()                         │   │
│  │               │                                         │   │
│  │               ├─▶ 检查是否需要拥塞控制                  │   │
│  │               │                                         │   │
│  │               └─▶ 调用拥塞控制算法                      │   │
│  │                    if (icsk_ca_ops->cong_control)       │   │
│  │                        icsk_ca_ops->cong_control(sk, rs)│   │
│  │                    else                                 │   │
│  │                        icsk_ca_ops->cong_avoid(sk, ...) │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  丢包检测流程：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  1. 检测到丢包（3个重复ACK或超时）                       │   │
│  │     └─▶ tcp_enter_loss()                                │   │
│  │          ├─▶ 调用ssthresh()                             │   │
│  │          │    new_ssthresh = icsk_ca_ops->ssthresh(sk)  │   │
│  │          ├─▶ 更新cwnd                                   │   │
│  │          │    cwnd = icsk_ca_ops->undo_cwnd(sk)         │   │
│  │          └─▶ 进入快速恢复                               │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  拥塞控制状态转换：                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  TCP_CA_Open ──▶ 正常状态                               │   │
│  │       │                                                 │   │
│  │       │ 检测到拥塞                                      │   │
│  │       ▼                                                 │   │
│  │  TCP_CA_Disorder ──▶ 乱序状态                           │   │
│  │       │                                                 │   │
│  │       │ 收到重复ACK                                     │   │
│  │       ▼                                                 │   │
│  │  TCP_CA_CWR ──▶ 拥塞窗口减少                            │   │
│  │       │                                                 │   │
│  │       │ 进入恢复                                        │   │
│  │       ▼                                                 │   │
│  │  TCP_CA_Recovery ──▶ 快速恢复                           │   │
│  │       │                                                 │   │
│  │       │ 严重拥塞                                        │   │
│  │       ▼                                                 │   │
│  │  TCP_CA_Loss ──▶ 丢失状态                               │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、发送窗口与接收窗口

### 6.1 发送窗口机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP发送窗口机制                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  发送窗口组成：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  发送序列号空间：                                       │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 1. 已确认且对端已接收                             │  │   │
│  │  │    [0, snd_una)                                  │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 2. 已发送但未确认（In Flight）                    │  │   │
│  │  │    [snd_una, snd_nxt)                            │  │   │
│  │  │    长度：packets_out                              │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 3. 可发送但未发送（可用窗口）                      │  │   │
│  │  │    [snd_nxt, snd_una + wnd)                       │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 4. 不能发送（窗口外）                              │  │   │
│  │  │    [snd_una + wnd, ...)                           │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  窗口计算：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  发送窗口（snd_wnd）：                                  │   │
│  │    • 对端通告的窗口大小                                 │   │
│  │    • 来自TCP头部的window字段                            │   │
│  │    • 考虑窗口缩放因子                                   │   │
│  │                                                         │   │
│  │  拥塞窗口（snd_cwnd）：                                 │   │
│  │    • 本端计算的拥塞窗口                                 │   │
│  │    • 由拥塞控制算法维护                                 │   │
│  │                                                         │   │
│  │  有效发送窗口：                                         │   │
│  │    effective_wnd = min(snd_wnd, snd_cwnd)               │   │
│  │                                                         │   │
│  │  可用窗口：                                             │   │
│  │    usable_wnd = effective_wnd - (snd_nxt - snd_una)     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  图示：                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  0         snd_una         snd_nxt      snd_una+wnd     │   │
│  │  │            │               │              │          │   │
│  │  ├────────────┼───────────────┼──────────────┤          │   │
│  │  │  已确认    │  In Flight   │  可用窗口    │          │   │
│  │  │            │               │              │          │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 接收窗口机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    TCP接收窗口机制                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  接收窗口组成：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  接收序列号空间：                                       │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 1. 已接收且已读（已复制到用户空间）                 │  │   │
│  │  │    [0, copied_seq)                               │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 2. 已接收但未读（接收缓冲区）                       │  │   │
│  │  │    [copied_seq, rcv_nxt)                         │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 3. 可接收（接收窗口）                               │  │   │
│  │  │    [rcv_nxt, rcv_nxt + rcv_wnd)                  │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ 4. 不能接收（窗口外）                               │  │   │
│  │  │    [rcv_nxt + rcv_wnd, ...)                       │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  接收窗口计算：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  基本接收窗口：                                         │   │
│  │    rcv_wnd = min(sk_rcvbuf - rcv_buffered,              │   │
│  │                  window_clamp)                          │   │
│  │                                                         │   │
│  │  其中：                                                 │   │
│  │    • sk_rcvbuf：接收缓冲区大小                          │   │
│  │    • rcv_buffered：当前接收缓冲区使用量                 │   │
│  │    • window_clamp：最大窗口限制                         │   │
│  │                                                         │   │
│  │  窗口缩放：                                             │   │
│  │    实际窗口 = rcv_wnd << rcv_wscale                     │   │
│  │    • rcv_wscale：接收窗口缩放因子                       │   │
│  │    • 在三次握手时协商                                   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  图示：                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  0        copied_seq      rcv_nxt     rcv_nxt+rcv_wnd   │   │
│  │  │            │              │              │           │   │
│  │  ├────────────┼──────────────┼──────────────┤           │   │
│  │  │  已读      │  未读       │  可接收     │           │   │
│  │  │            │              │              │           │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 窗口相关代码

```c
/* 计算接收窗口 */
static u32 tcp_receive_window(const struct tcp_sock *tp)
{
    s32 win = tp->rcv_wnd + tp->rcv_wup - tp->rcv_nxt;

    if (win < 0)
        win = 0;
    
    return (u32)win;
}

/* 更新接收窗口 */
void tcp_update_rcv_wnd(struct sock *sk)
{
    struct tcp_sock *tp = tcp_sk(sk);
    u32 window = tcp_receive_window(tp);
    
    /* 检查是否需要发送窗口更新 */
    if (window >= tp->rcv_wnd) {
        /* 窗口增大，立即通告 */
        tcp_send_ack(sk);
    }
}

/* 计算可用发送窗口 */
static unsigned int tcp_snd_wnd_test(const struct tcp_sock *tp,
                                      const struct sk_buff *skb,
                                      unsigned int packets)
{
    u32 left = tp->snd_wnd - (tp->snd_nxt - tp->snd_una);
    
    return left >= tcp_skb_pcount(skb) * packets;
}
```

---

## 七、TSO/GRO卸载特性

### 7.1 TSO (TCP Segmentation Offload)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TSO (TCP Segmentation Offload)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  什么是TSO？                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • TCP分段卸载                                        │       │
│  │ • 将TCP分段工作从CPU转移到网卡                       │       │
│  │ • 减少CPU负载，提高性能                              │       │
│  │ • 支持发送大于MSS的数据块                            │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  工作原理：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  传统方式（无TSO）：                                    │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ 应用层                                           │   │   │
│  │  │   │                                              │   │   │
│  │  │   ▼ write(64KB)                                 │   │   │
│  │  │ TCP层                                            │   │   │
│  │  │   ├─▶ 分段为44个MSS包（每个1460字节）            │   │   │
│  │  │   ├─▶ 为每个包构造TCP头部                        │   │   │
│  │  │   └─▶ 44次CPU处理                                │   │   │
│  │  │ IP层                                             │   │   │
│  │  │   └─▶ 44次IP处理                                 │   │   │
│  │  │ 网卡                                             │   │   │
│  │  │   └─▶ 发送44个包                                 │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  TSO方式：                                              │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ 应用层                                           │   │   │
│  │  │   │                                              │   │   │
│  │  │   ▼ write(64KB)                                 │   │   │
│  │  │ TCP层                                            │   │   │
│  │  │   └─▶ 构造1个大包（64KB）                        │   │   │
│  │  │ IP层                                             │   │   │
│  │  │   └─▶ 1次IP处理                                 │   │   │
│  │  │ 网卡                                             │   │   │
│  │  │   ├─▶ 硬件分段为44个MSS包                        │   │   │
│  │  │   └─▶ 发送44个包                                 │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  TSO的优势：                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 减少CPU处理次数（44次 → 1次）                       │       │
│  │ • 减少内存拷贝                                        │       │
│  │ • 提高吞吐量                                          │       │
│  │ • 降低延迟                                            │       │
│  │ • 节省总线带宽                                        │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  TSO相关代码：                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ /* 检查是否支持TSO */                                 │       │
│  │ if (sk->sk_gso_type & SKB_GSO_TCPV4) {               │       │
│  │     /* 可以发送大包 */                                │       │
│  │     mss = tcp_send_mss(sk, &size_goal, flags);       │       │
│  │     /* size_goal可能远大于MSS */                      │       │
│  │ }                                                     │       │
│  │                                                       │       │
│  │ /* 设置GSO信息 */                                     │       │
│  │ skb_shinfo(skb)->gso_size = mss;                      │       │
│  │ skb_shinfo(skb)->gso_type = SKB_GSO_TCPV4;            │       │
│  │ skb_shinfo(skb)->gso_segs = DIV_ROUND_UP(len, mss);   │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 GRO (Generic Receive Offload)

```
┌─────────────────────────────────────────────────────────────────┐
│                    GRO (Generic Receive Offload)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  什么是GRO？                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 通用接收卸载                                        │       │
│  │ • 将多个小包合并成一个大包                            │       │
│  │ • 减少协议栈处理次数                                  │       │
│  │ • LRO（Large Receive Offload）的软件实现              │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  工作原理：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  传统方式（无GRO）：                                    │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ 网卡                                             │   │   │
│  │  │   └─▶ 接收44个小包                               │   │   │
│  │  │ IP层                                             │   │   │
│  │  │   └─▶ 44次IP处理                                 │   │   │
│  │  │ TCP层                                            │   │   │
│  │  │   ├─▶ 44次TCP处理                                │   │   │
│  │  │   └─▶ 44次ACK处理                                │   │   │
│  │  │ 应用层                                           │   │   │
│  │  │   └─▶ read()获取数据                             │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  GRO方式：                                              │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ 网卡                                             │   │   │
│  │  │   └─▶ 接收44个小包                               │   │   │
│  │  │ GRO层                                            │   │   │
│  │  │   └─▶ 合并为1个大包（64KB）                      │   │   │
│  │  │ IP层                                             │   │   │
│  │  │   └─▶ 1次IP处理                                 │   │   │
│  │  │ TCP层                                            │   │   │
│  │  │   └─▶ 1次TCP处理                                │   │   │
│  │  │ 应用层                                           │   │   │
│  │  │   └─▶ read()获取数据                             │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  GRO合并条件：                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 1. 相同的TCP流（五元组相同）                          │       │
│  │ 2. 序列号连续                                        │       │
│  │ 3. TCP头部相同（除了序列号和ACK号）                   │       │
│  │ 4. 时间戳选项兼容                                    │       │
│  │ 5. 不跨越窗口边界                                    │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  GRO相关代码：                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ /* GRO入口函数 */                                     │       │
│  │ struct sk_buff *tcp_gro_receive(struct list_head *head,│       │
│  │                                 struct sk_buff *skb)  │       │
│  │ {                                                     │       │
│  │     /* 检查是否可以合并 */                            │       │
│  │     if (!tcp_gro_coalesce(skb, p))                    │       │
│  │         return NULL;                                  │       │
│  │                                                       │       │
│  │     /* 合并skb到p */                                  │       │
│  │     skb_shinfo(p)->gso_size = mss;                    │       │
│  │     skb_shinfo(p)->gso_segs++;                        │       │
│  │                                                       │       │
│  │     return p;                                         │       │
│  │ }                                                     │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 TSO/GRO配置

```bash
# 查看网卡TSO/GRO状态
ethtool -k eth0 | grep -E "tso|gro"

# 输出示例：
tso: on
gso: on
gro: on
lro: off

# 启用/禁用TSO
ethtool -K eth0 tso on   # 启用TSO
ethtool -K eth0 tso off  # 禁用TSO

# 启用/禁用GRO
ethtool -K eth0 gro on   # 启用GRO
ethtool -K eth0 gro off  # 禁用GRO

# 查看网卡卸载能力
ethtool -k eth0

# 输出示例：
Features for eth0:
rx-checksumming: on
tx-checksumming: on
scatter-gather: on
tcp-segmentation-offload: on
generic-segmentation-offload: on
generic-receive-offload: on
large-receive-offload: off
```

### 7.4 TSO/GRO性能影响

```
┌─────────────────────────────────────────────────────────────────┐
│                TSO/GRO性能影响                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  性能提升场景：                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • 高带宽长延迟网络（BDP大）                          │       │
│  │ • 大量小包传输                                      │       │
│  │ • CPU性能瓶颈                                       │       │
│  │ • 10Gbps及以上网络                                  │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  性能数据示例：                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │                                                       │       │
│  │  场景：10Gbps网络，传输64KB数据                       │       │
│  │                                                       │       │
│  │  无TSO/GRO：                                          │       │
│  │  ├─▶ CPU使用率：80%                                   │       │
│  │  ├─▶ 吞吐量：6 Gbps                                   │       │
│  │  └─▶ 中断次数：44000次/秒                             │       │
│  │                                                       │       │
│  │  有TSO/GRO：                                          │       │
│  │  ├─▶ CPU使用率：20%                                   │       │
│  │  ├─▶ 吞吐量：9.5 Gbps                                 │       │
│  │  └─▶ 中断次数：1000次/秒                              │       │
│  │                                                       │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  注意事项：                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 1. 需要网卡硬件支持                                  │       │
│  │ 2. 可能影响延迟敏感应用                              │       │
│  │ 3. GRO可能增加接收延迟                               │       │
│  │ 4. 虚拟化环境需特殊配置                              │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、ss命令输出解析

### 8.1 ss -ti 输出示例

```bash
# 查看TCP连接详细信息
ss -ti

# 输出示例：
State      Recv-Q Send-Q Local Address:Port  Peer Address:Port
ESTAB      0      0      192.168.1.100:ssh    192.168.1.200:54321
    cubic cwnd:10 ssthresh:2147483647 rtt:1.5 rttvar:0.75 rto:4.5 
    mss:1460 pmtu:1500 rcvmss:1460 advmss:1460 
    bytes_acked:12345 bytes_received:67890 segs_out:100 segs_in:80 
    data_segs_out:90 data_segs_in:70 send 45.2Mbps lastsnd:10 lastrcv:5 
    lastack:5 pacing_rate 90.4Mbps delivery_rate 45.2Mbps 
    delivered:90 app_limited busy:100ms rcv_rtt:1 rcv_space:28960 
    rcv_ssthresh:28960 minrtt:0.5
```

### 8.2 ss -ti 输出字段详解

```
┌─────────────────────────────────────────────────────────────────┐
│                ss -ti 输出字段详解                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  拥塞控制相关：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段          │ 内核变量              │ 说明             │   │
│  ├───────────────┼────────────────────────┼──────────────────┤   │
│  │ cubic         │ icsk_ca_ops->name     │ 拥塞控制算法     │   │
│  │ cwnd          │ tp->snd_cwnd          │ 拥塞窗口         │   │
│  │ ssthresh      │ tp->snd_ssthresh      │ 慢启动阈值       │   │
│  │ lost          │ tp->lost              │ 丢失的包数       │   │
│  │ retrans       │ tp->total_retrans     │ 总重传次数       │   │
│  └───────────────┴────────────────────────┴──────────────────┘   │
│                                                                 │
│  RTT测量相关：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段          │ 内核变量              │ 说明             │   │
│  ├───────────────┼────────────────────────┼──────────────────┤   │
│  │ rtt           │ tp->srtt_us / 1000    │ 平滑RTT（毫秒）  │   │
│  │ rttvar        │ tp->rttvar_us / 1000  │ RTT方差（毫秒）  │   │
│  │ rto           │ icsk->icsk_rto / 1000 │ 重传超时（毫秒） │   │
│  │ minrtt        │ tp->rtt_min           │ 最小RTT          │   │
│  │ rcv_rtt       │ tp->rcv_rtt           │ 接收端RTT        │   │
│  └───────────────┴────────────────────────┴──────────────────┘   │
│                                                                 │
│  MSS和MTU相关：                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段          │ 内核变量              │ 说明             │   │
│  ├───────────────┼────────────────────────┼──────────────────┤   │
│  │ mss           │ tp->mss_cache         │ 当前MSS          │   │
│  │ pmtu          │ icsk->icsk_pmtu       │ 路径MTU          │   │
│  │ rcvmss        │ tp->rx_opt.mss_clamp  │ 接收MSS          │   │
│  │ advmss        │ tp->advmss            │ 通告MSS          │   │
│  └───────────────┴────────────────────────┴──────────────────┘   │
│                                                                 │
│  数据传输统计：                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段            │ 内核变量             │ 说明             │   │
│  ├─────────────────┼──────────────────────┼──────────────────┤   │
│  │ bytes_acked     │ tp->bytes_acked      │ 已确认字节数     │   │
│  │ bytes_received  │ tp->bytes_received   │ 已接收字节数     │   │
│  │ segs_out        │ tp->segs_out         │ 发送段数         │   │
│  │ segs_in         │ tp->segs_in          │ 接收段数         │   │
│  │ data_segs_out   │ tp->data_segs_out    │ 发送数据段数     │   │
│  │ data_segs_in    │ tp->data_segs_in     │ 接收数据段数     │   │
│  └─────────────────┴──────────────────────┴──────────────────┘   │
│                                                                 │
│  速率和带宽：                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段            │ 内核变量             │ 说明             │   │
│  ├─────────────────┼──────────────────────┼──────────────────┤   │
│  │ send            │ 计算值               │ 发送速率         │   │
│  │ pacing_rate     │ sk->sk_pacing_rate   │ Pacing速率       │   │
│  │ delivery_rate   │ tp->rate_delivered   │ 交付速率         │   │
│  └─────────────────┴──────────────────────┴──────────────────┘   │
│                                                                 │
│  时间戳：                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段          │ 内核变量              │ 说明             │   │
│  ├───────────────┼────────────────────────┼──────────────────┤   │
│  │ lastsnd       │ now - tp->lsndtime    │ 最后发送时间     │   │
│  │ lastrcv       │ now - tp->rcv_tstamp  │ 最后接收时间     │   │
│  │ lastack       │ now - tp->rcv_tstamp  │ 最后ACK时间      │   │
│  │ busy          │ 计算值                │ 忙碌时间         │   │
│  └───────────────┴────────────────────────┴──────────────────┘   │
│                                                                 │
│  接收窗口：                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 字段            │ 内核变量             │ 说明             │   │
│  ├─────────────────┼──────────────────────┼──────────────────┤   │
│  │ rcv_space       │ tp->rcv_wnd          │ 接收窗口         │   │
│  │ rcv_ssthresh    │ tp->rcv_ssthresh     │ 接收阈值         │   │
│  └─────────────────┴──────────────────────┴──────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.3 关键变量映射表

| ss输出字段 | 内核变量 | 结构体 | 说明 |
|-----------|---------|--------|------|
| **cwnd** | snd_cwnd | tcp_sock | 拥塞窗口（包数） |
| **ssthresh** | snd_ssthresh | tcp_sock | 慢启动阈值 |
| **rtt** | srtt_us | tcp_sock | 平滑RTT（微秒→毫秒） |
| **rttvar** | rttvar_us | tcp_sock | RTT方差（微秒→毫秒） |
| **rto** | icsk_rto | inet_connection_sock | 重传超时 |
| **lost** | lost | tcp_sock | 丢失的包数 |
| **retrans** | total_retrans | tcp_sock | 总重传次数 |
| **mss** | mss_cache | tcp_sock | 当前MSS |
| **bytes_acked** | bytes_acked | tcp_sock | 已确认字节数 |
| **bytes_received** | bytes_received | tcp_sock | 已接收字节数 |

### 8.4 实用命令示例

```bash
# 查看所有TCP连接的拥塞控制信息
ss -ti state established

# 查看特定端口的连接
ss -ti 'sport = :80 or dport = :80'

# 查看TCP重传情况
ss -ti | grep -E "retrans|lost"

# 查看拥塞窗口较小的连接（可能有问题）
ss -ti | awk '/cwnd:/ {if ($2 < 10) print}'

# 查看RTT较大的连接
ss -ti | awk '/rtt:/ {if ($2 > 100) print}'

# 统计各拥塞控制算法的使用情况
ss -ti | grep -oP '(cubic|bbr|reno|dctcp)' | sort | uniq -c

# 查看TIME_WAIT状态的连接数
ss -ti state time-wait | wc -l

# 查看接收队列积压的连接
ss -ti | awk '$1 > 0 {print}'

# 查看发送队列积压的连接
ss -ti | awk '$2 > 0 {print}'

# 导出TCP统计信息到文件
ss -ti > tcp_stats.txt
```

---

## 九、调试与问题排查

### 9.1 常见TCP问题

```
┌─────────────────────────────────────────────────────────────────┐
│                    常见TCP问题                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 连接建立慢                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 现象：connect()超时或耗时很长                         │       │
│  │ 原因：                                                │       │
│  │   • 网络不通                                          │       │
│  │   • 防火墙阻止                                        │       │
│  │   • 服务端未监听                                      │       │
│  │   • SYN队列满                                         │       │
│  │ 排查：                                                │       │
│  │   • ping测试网络                                      │       │
│  │   • tcpdump抓包                                       │       │
│  │   • 检查防火墙规则                                    │       │
│  │   • 查看netstat -s | grep ListenOverflows            │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  2. 传输速度慢                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 现象：吞吐量远低于带宽                                │       │
│  │ 原因：                                                │       │
│  │   • 拥塞窗口过小                                      │       │
│  │   • 接收窗口过小                                      │       │
│  │   • RTT过大                                           │       │
│  │   • 丢包严重                                          │       │
│  │   • MSS设置不当                                       │       │
│  │ 排查：                                                │       │
│  │   • ss -ti查看cwnd、rtt、lost                         │       │
│  │   • 调整tcp_rmem/tcp_wmem                             │       │
│  │   • 检查MTU设置                                       │       │
│  │   • 使用BBR算法                                       │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  3. 连接重置                                                   │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 现象：收到RST包，连接中断                             │       │
│  │ 原因：                                                │       │
│  │   • 连接超时                                          │       │
│  │   • 对端异常关闭                                      │       │
│  │   • 防火墙发送RST                                     │       │
│  │   • 连接不存在                                        │       │
│  │ 排查：                                                │       │
│  │   • tcpdump抓包查看RST来源                            │       │
│  │   • 检查keepalive设置                                 │       │
│  │   • 查看应用层日志                                    │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  4. TIME_WAIT过多                                              │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 现象：大量TIME_WAIT状态连接                           │       │
│  │ 原因：                                                │       │
│  │   • 短连接过多                                        │       │
│  │   • 主动关闭方未复用                                  │       │
│  │ 影响：                                                │       │
│  │   • 占用端口资源                                      │       │
│  │   • 占用内存                                          │       │
│  │ 解决：                                                │       │
│  │   • 启用tcp_tw_reuse                                  │       │
│  │   • 启用tcp_tw_recycle（已废弃）                      │       │
│  │   • 调整tcp_max_tw_buckets                            │       │
│  │   • 使用长连接                                        │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
│  5. 零窗口问题                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 现象：发送方停止发送，接收方窗口为0                    │       │
│  │ 原因：                                                │       │
│  │   • 接收缓冲区满                                      │       │
│  │   • 应用层未及时读取                                  │       │
│  │   • 接收窗口通告丢失                                  │       │
│  │ 排查：                                                │       │
│  │   • ss -ti查看rcv_space                               │       │
│  │   • 检查应用层读取逻辑                                │       │
│  │   • 增大接收缓冲区                                    │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 调试工具

```bash
# 1. tcpdump - 抓包分析
# 抓取特定端口的TCP包
tcpdump -i eth0 tcp port 80 -w tcp.pcap

# 抓取SYN包
tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0'

# 抓取RST包
tcpdump -i eth0 'tcp[tcpflags] & tcp-rst != 0'

# 抓取FIN包
tcpdump -i eth0 'tcp[tcpflags] & tcp-fin != 0'

# 2. ss - socket统计
# 查看所有TCP连接
ss -ta

# 查看TCP监听socket
ss -tl

# 查看详细信息
ss -ti

# 查看内存使用
ss -tm

# 3. netstat - 网络统计
# 查看TCP统计
netstat -s | grep -A 20 Tcp

# 查看TCP连接
netstat -tn

# 查看监听端口
netstat -tln

# 4. ip - 网络配置
# 查看网络接口
ip link show

# 查看IP地址
ip addr show

# 查看路由
ip route show

# 5. ethtool - 网卡工具
# 查看网卡统计
ethtool -S eth0

# 查看网卡特性
ethtool -k eth0

# 查看网卡驱动信息
ethtool -i eth0

# 6. perf - 性能分析
# 跟踪TCP函数
perf trace -e tcp:*

# 查看TCP热点函数
perf top -e 'syscalls:sys_enter_*tcp*'

# 7. tracepoint - 内核跟踪
# 跟踪TCP连接建立
trace-cmd record -e tcp:tcp_connect -p function

# 跟踪TCP数据传输
trace-cmd record -e tcp:tcp_data_queue -p function
```

### 9.3 内核参数调优

```bash
# TCP内存相关
# TCP读缓冲区（最小/默认/最大）
sysctl -w net.ipv4.tcp_rmem="4096 87380 6291456"

# TCP写缓冲区（最小/默认/最大）
sysctl -w net.ipv4.tcp_wmem="4096 65536 4194304"

# TCP内存限制（页数）
sysctl -w net.ipv4.tcp_mem="8388608 12582912 16777216"

# 拥塞控制相关
# 拥塞控制算法
sysctl -w net.ipv4.tcp_congestion_control="bbr"

# 初始拥塞窗口
sysctl -w net.ipv4.tcp_init_cwnd=10

# 连接相关
# SYN队列长度
sysctl -w net.ipv4.tcp_max_syn_backlog=8192

# ACCEPT队列长度
sysctl -w net.core.somaxconn=4096

# SYN重试次数
sysctl -w net.ipv4.tcp_syn_retries=5

# SYN+ACK重试次数
sysctl -w net.ipv4.tcp_synack_retries=5

# TIME_WAIT相关
# TIME_WAIT复用
sysctl -w net.ipv4.tcp_tw_reuse=1

# TIME_WAIT最大数量
sysctl -w net.ipv4.tcp_max_tw_buckets=262144

# TIME_WAIT超时时间
sysctl -w net.ipv4.tcp_fin_timeout=30

# Keepalive相关
# TCP keepalive时间
sysctl -w net.ipv4.tcp_keepalive_time=7200

# TCP keepalive间隔
sysctl -w net.ipv4.tcp_keepalive_intvl=75

# TCP keepalive探测次数
sysctl -w net.ipv4.tcp_keepalive_probes=9

# MTU相关
# PMTU发现
sysctl -w net.ipv4.tcp_mtu_probing=1

# 最小MSS
sysctl -w net.ipv4.tcp_mss_min=536

# SACK相关
# 启用SACK
sysctl -w net.ipv4.tcp_sack=1

# 启用FACK
sysctl -w net.ipv4.tcp_fack=1

# 窗口缩放
# 启用窗口缩放
sysctl -w net.ipv4.tcp_window_scaling=1

# 最大窗口缩放因子
sysctl -w net.ipv4.tcp_adv_win_scale=1
```

### 9.4 性能监控脚本

```bash
#!/bin/bash
# tcp_monitor.sh - TCP性能监控脚本

echo "=== TCP连接统计 ==="
ss -s

echo -e "\n=== TCP拥塞控制统计 ==="
ss -ti state established | grep -oP '(cubic|bbr|reno|dctcp)' | sort | uniq -c

echo -e "\n=== TCP重传统计 ==="
ss -ti | awk '/retrans:/ {print}' | head -10

echo -e "\n=== TCP丢包统计 ==="
ss -ti | awk '/lost:/ {print}' | head -10

echo -e "\n=== TCP零窗口连接 ==="
ss -ti | awk '/rcv_space:0/ {print}' | head -10

echo -e "\n=== TCP内核统计 ==="
netstat -s | grep -A 30 Tcp

echo -e "\n=== TCP内存使用 ==="
cat /proc/net/sockstat

echo -e "\n=== 网卡统计 ==="
ip -s link show eth0
```

---

## 总结

### 核心要点回顾

1. **三次握手实现**
   - 客户端：`tcp_v4_connect()` → `tcp_connect()` → 发送SYN
   - 服务端：收到SYN → 发送SYN+ACK → 收到ACK → ESTABLISHED
   - 关键：序列号生成、状态转换、超时重传

2. **四次挥手实现**
   - 主动方：`tcp_close()` → 发送FIN → FIN_WAIT1/2 → TIME_WAIT
   - 被动方：收到FIN → 发送ACK → CLOSE_WAIT → 发送FIN → LAST_ACK
   - 关键：TIME_WAIT的作用、优雅关闭

3. **拥塞控制框架**
   - 核心结构：`tcp_congestion_ops`
   - 关键回调：`ssthresh()`、`cong_avoid()`、`undo_cwnd()`
   - 算法：CUBIC（默认）、BBR、Reno等
   - 可插拔、可扩展

4. **发送/接收窗口**
   - 发送窗口 = min(对端通告窗口, 拥塞窗口)
   - 接收窗口 = 接收缓冲区剩余空间
   - 流量控制的核心机制

5. **TSO/GRO卸载**
   - TSO：发送端硬件分段，减少CPU负载
   - GRO：接收端软件合并，减少协议栈处理
   - 显著提升高带宽网络性能

6. **ss命令输出**
   - cwnd → tp->snd_cwnd（拥塞窗口）
   - rtt → tp->srtt_us（平滑RTT）
   - lost → tp->lost（丢失包数）
   - ssthresh → tp->snd_ssthresh（慢启动阈值）

### 学习建议

1. **从简单到复杂**
   - 先理解TCP协议原理
   - 再看内核实现代码
   - 最后深入拥塞控制算法

2. **理论结合实践**
   - 使用tcpdump抓包观察
   - 使用ss命令监控连接
   - 调整内核参数实验

3. **关注关键路径**
   - 连接建立/断开路径
   - 数据发送/接收路径
   - 拥塞控制路径

4. **善用调试工具**
   - tcpdump、ss、netstat
   - perf、trace-cmd
   - 内核调试选项

### 参考资源

1. **RFC文档**
   - RFC 793: TCP协议规范
   - RFC 2581: TCP拥塞控制
   - RFC 6298: RTO计算
   - RFC 7413: TCP Fast Open

2. **内核文档**
   - Documentation/networking/tcp.txt
   - Documentation/sysctl/net.txt

3. **书籍推荐**
   - 《TCP/IP详解 卷1》
   - 《Linux内核网络协议栈源码剖析》

---

**文档版本**: v1.0  
**内核版本**: Linux 5.15  
**最后更新**: 2026-06-05
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  图示：                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │