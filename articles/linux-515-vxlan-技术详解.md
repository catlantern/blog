# Linux 5.15 VXLAN 技术详解

> 本文档从初学者角度详细讲解Linux内核VXLAN（Virtual eXtensible Local Area Network）技术，从"为什么需要VXLAN"开始，深入分析vxlan_xmit()如何封装原始以太帧成UDP包，vxlan_rcv()如何解封装，以及FDB（转发数据库）的实现，最后讲解Kubernetes中Flannel/Calico的VXLAN模式如何实现跨主机通信。

---

## 目录

1. **`引言：为什么需要VXLAN`**
2. **`VXLAN协议基础`**
3. **`VXLAN核心数据结构`**
4. **`vxlan_xmit()封装流程`**
5. **`vxlan_rcv()解封装流程`**
6. **`VXLAN FDB转发数据库`**
7. **`VXLAN设备创建与配置`**
8. **`Kubernetes Flannel/Calico VXLAN模式`**
9. **`实际应用场景`**
10. **`调试与问题排查`**
11. **`总结`**

---

## 一、引言：为什么需要VXLAN

### 1.1 传统VLAN的局限性

在传统网络中，VLAN（Virtual LAN）用于网络隔离，但存在诸多限制：

```
┌─────────────────────────────────────────────────────────────┐
│                  传统VLAN的局限性                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  问题1：VLAN ID数量限制                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • VLAN ID只有12位，最多4094个VLAN                    │   │
│  │  • 无法满足大规模云计算和容器环境需求                   │   │
│  │  • 每个租户需要独立的VLAN，租户数量受限                │   │
│  │                                                          │   │
│  │  结果：无法支持大规模多租户环境                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题2：二层网络扩展困难                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 二层网络（L2）无法跨越三层网络（L3）                │   │
│  │  • 虚拟机迁移需要二层连通                              │   │
│  │  • 跨机架、跨数据中心的二层扩展困难                    │   │
│  │                                                          │   │
│  │  结果：限制了虚拟机的灵活部署和迁移                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题3：STP（生成树协议）问题                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 大规模二层网络需要STP防止环路                       │   │
│  │  • STP收敛慢，影响网络稳定性                           │   │
│  │  • STP会阻塞冗余链路，浪费带宽                         │   │
│  │                                                          │   │
│  │  结果：网络性能和可靠性受限                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题4：多租户隔离需求                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 云环境需要大量独立的虚拟网络                        │   │
│  │  • 每个租户需要完全隔离的网络                          │   │
│  │  • 传统VLAN数量不足                                    │   │
│  │                                                          │   │
│  │  结果：无法满足云计算多租户需求                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 VXLAN提供的解决方案

```
┌─────────────────────────────────────────────────────────────┐
│                   VXLAN提供的解决方案                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  解决方案1：大规模VNI支持                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • VNI（VXLAN Network Identifier）有24位             │   │
│  │  • 支持1600万个虚拟网络（2^24 = 16,777,216）          │   │
│  │  • 完全满足云计算和容器环境需求                        │   │
│  │                                                          │   │
│  │  优势：支持大规模多租户环境                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  解决方案2：二层网络跨越三层                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • VXLAN将二层以太网帧封装在UDP包中                    │   │
│  │  • 可以跨越三层网络传输                                │   │
│  │  • 支持跨机架、跨数据中心部署                          │   │
│  │                                                          │   │
│  │  优势：虚拟机可以跨物理机迁移                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  解决方案3：无需STP                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • VXLAN基于三层网络，无需STP                          │   │
│  │  • 利用三层路由的ECMP实现负载均衡                      │   │
│  │  • 无环路问题，网络稳定性高                            │   │
│  │                                                          │   │
│  │  优势：网络性能和可靠性大幅提升                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  解决方案4：完美支持多租户                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 每个VNI代表一个独立的虚拟网络                       │   │
│  │  • 租户间完全隔离                                      │   │
│  │  • 支持数百万租户                                      │   │
│  │                                                          │   │
│  │  优势：完美适配云计算多租户需求                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 VXLAN应用场景

```
┌─────────────────────────────────────────────────────────────┐
│                    VXLAN应用场景                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  场景1：云计算虚拟网络                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • OpenStack Neutron使用VXLAN                         │   │
│  │  • 每个租户独立的虚拟网络                              │   │
│  │  • 虚拟机跨主机迁移                                    │   │
│  │                                                          │   │
│  │  示例：OpenStack、VMware NSX                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  场景2：Kubernetes容器网络                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Flannel VXLAN模式                                   │   │
│  │  • Calico VXLAN模式                                    │   │
│  │  • Pod跨主机通信                                       │   │
│  │                                                          │   │
│  │  示例：Kubernetes集群网络                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  场景3：数据中心互联                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 跨数据中心二层互联                                  │   │
│  │  • 虚拟机跨数据中心迁移                                │   │
│  │  • 灾备和容灾                                          │   │
│  │                                                          │   │
│  │  示例：EVPN-VXLAN                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、VXLAN协议基础

### 2.1 VXLAN协议格式

VXLAN由RFC 7348定义，将二层以太网帧封装在UDP包中：

```
┌─────────────────────────────────────────────────────────────┐
│                    VXLAN报文结构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  外层IP头（20字节）                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Version | IHL | TOS | Total Length                  │   │
│  │  Identification | Flags | Fragment Offset            │   │
│  │  TTL | Protocol (17=UDP) | Header Checksum           │   │
│  │  Source IP (VTEP IP)                                  │   │
│  │  Destination IP (Remote VTEP IP)                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  外层UDP头（8字节）                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Source Port (随机生成)                               │   │
│  │  Destination Port (4789或8472)                        │   │
│  │  Length | Checksum                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  VXLAN头（8字节）                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Flags (8位，第3位I=1表示VNI有效)                     │   │
│  │  Reserved (24位)                                      │   │
│  │  VNI (24位，VXLAN Network Identifier)                │   │
│  │  Reserved (8位)                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  原始以太网帧                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Destination MAC (6字节)                              │   │
│  │  Source MAC (6字节)                                   │   │
│  │  EtherType (2字节)                                    │   │
│  │  Payload (原始数据)                                   │   │
│  │  FCS (4字节，可选)                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 VXLAN头结构

```c
// include/net/vxlan.h
struct vxlanhdr {
    __be32 vx_flags;    // 标志位，第27位(I)表示VNI有效
    __be32 vx_vni;      // VNI（24位）+ Reserved（8位）
};

// VNI标志位
#define VXLAN_HF_VNI  cpu_to_be32(BIT(27))

// VNI相关定义
#define VXLAN_N_VID     (1u << 24)           // 16,777,216个VNI
#define VXLAN_VID_MASK  (VXLAN_N_VID - 1)    // VNI掩码
#define VXLAN_VNI_MASK  cpu_to_be32(VXLAN_VID_MASK << 8)
```

### 2.3 VTEP（VXLAN Tunnel Endpoint）

VTEP是VXLAN隧道的端点，负责封装和解封装：

```
┌─────────────────────────────────────────────────────────────┐
│                      VTEP工作原理                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主机A（VTEP-A）                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  虚拟机/容器                                          │   │
│  │     ↓                                                 │   │
│  │  原始以太网帧                                          │   │
│  │     ↓                                                 │   │
│  │  VXLAN设备（VTEP-A）                                  │   │
│  │  • 查FDB：目的MAC → 远端VTEP IP                       │   │
│  │  • 封装：添加VXLAN头 + UDP头 + IP头                   │   │
│  │     ↓                                                 │   │
│  │  UDP封装包                                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  物理网络（三层传输）                                         │
│                          ↓                                  │
│  主机B（VTEP-B）                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UDP封装包                                            │   │
│  │     ↓                                                 │   │
│  │  VXLAN设备（VTEP-B）                                  │   │
│  │  • 解封装：去掉IP头 + UDP头 + VXLAN头                 │   │
│  │  • 学习：源MAC → 源VTEP IP                            │   │
│  │     ↓                                                 │   │
│  │  原始以太网帧                                          │   │
│  │     ↓                                                 │   │
│  │  虚拟机/容器                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 VXLAN vs VLAN对比

```
┌─────────────────────────────────────────────────────────────┐
│                    VXLAN vs VLAN对比                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特性                VLAN              VXLAN                 │
│  ────────────────────────────────────────────────────────  │
│  标识符位数          12位              24位                  │
│  最大数量            4,094             16,777,216            │
│  工作层次            二层              二层 over 三层        │
│  封装方式            添加VLAN标签      UDP封装               │
│  跨三层支持          不支持            支持                  │
│  STP需求             需要              不需要                │
│  多租户支持          有限              强大                  │
│  性能开销            小                较大                  │
│  应用场景            传统网络          云计算、容器          │
│                                                             │
│  报文结构对比：                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  VLAN：[Ethernet Header] [VLAN Tag] [IP] [Payload]   │   │
│  │  VXLAN：[Outer IP] [UDP] [VXLAN] [Inner Ethernet]    │   │
│  │         [Inner IP] [Payload]                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、VXLAN核心数据结构

### 3.1 vxlan_dev结构体

`vxlan_dev`表示一个VXLAN设备（VTEP）：

```c
// include/net/vxlan.h: 235
struct vxlan_dev {
    struct vxlan_dev_node hlist4;    // IPv4 VNI哈希表节点
#if IS_ENABLED(CONFIG_IPV6)
    struct vxlan_dev_node hlist6;    // IPv6 VNI哈希表节点
#endif
    struct list_head      next;      // vxlan的per namespace链表
    struct vxlan_sock __rcu *vn4_sock;  // IPv4监听socket
#if IS_ENABLED(CONFIG_IPV6)
    struct vxlan_sock __rcu *vn6_sock;  // IPv6监听socket
#endif
    struct net_device     *dev;      // 关联的net_device
    struct net            *net;      // 网络命名空间
    struct vxlan_rdst     default_dst; // 默认目的地址

    struct timer_list     age_timer;  // FDB老化定时器
    spinlock_t            hash_lock[FDB_HASH_SIZE]; // FDB哈希锁
    unsigned int          addrcnt;    // 地址计数
    struct gro_cells      gro_cells;  // GRO支持

    struct vxlan_config   cfg;        // 配置信息

    struct hlist_head     fdb_head[FDB_HASH_SIZE]; // FDB哈希表
};
```

**关键字段说明**：
- `vn4_sock`/`vn6_sock`：监听VXLAN UDP包的socket
- `default_dst`：默认目的VTEP地址（用于泛洪）
- `fdb_head[]`：FDB（转发数据库）哈希表
- `age_timer`：FDB条目老化定时器

### 3.2 vxlan_fdb结构体

`vxlan_fdb`表示FDB（转发数据库）中的一个条目：

```c
// drivers/net/vxlan/vxlan_core.c: 73
struct vxlan_fdb {
    struct hlist_node hlist;        // 哈希链表节点
    struct rcu_head   rcu;          // RCU回调
    unsigned long     updated;      // 更新时间（jiffies）
    unsigned long     used;         // 使用时间
    struct list_head  remotes;      // 远端VTEP列表
    u8                eth_addr[ETH_ALEN]; // MAC地址
    u16               state;        // 状态（ndm_state）
    __be32            vni;          // VNI
    u16               flags;        // 标志位
    struct list_head  nh_list;      // 下一跳列表
    struct nexthop __rcu *nh;       // 下一跳
    struct vxlan_dev  __rcu *vdev;  // 关联的vxlan_dev
};
```

**关键字段说明**：
- `eth_addr`：MAC地址（键）
- `remotes`：远端VTEP IP地址列表（值）
- `vni`：VNI
- `updated`/`used`：用于老化机制

### 3.3 vxlan_rdst结构体

`vxlan_rdst`表示一个远端VTEP：

```c
// include/net/vxlan.h
struct vxlan_rdst {
    union vxlan_addr  remote_ip;    // 远端VTEP IP地址
    __be16            remote_port;  // 远端UDP端口
    __be32            remote_vni;   // 远端VNI
    u32               remote_ifindex; // 出接口索引
    struct list_head  list;         // 链表节点
    struct rcu_head   rcu;          // RCU回调
    struct dst_cache  dst_cache;    // 路由缓存
};
```

### 3.4 vxlanhdr结构体

VXLAN头部结构：

```c
// include/net/vxlan.h: 23
struct vxlanhdr {
    __be32 vx_flags;    // 标志位
    __be32 vx_vni;      // VNI（24位）+ Reserved（8位）
};
```

### 3.5 数据结构关系图

```
┌─────────────────────────────────────────────────────────────┐
│                  VXLAN数据结构关系                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  vxlan_dev (VTEP)                    │   │
│  │  ┌───────────────────────────────────────────────┐ │   │
│  │  │  struct net_device *dev                        │ │   │
│  │  │  struct vxlan_sock *vn4_sock                   │ │   │
│  │  │  struct vxlan_rdst default_dst                 │ │   │
│  │  │  struct hlist_head fdb_head[FDB_HASH_SIZE] ─┐ │ │   │
│  │  │  struct vxlan_config cfg                     │ │ │   │
│  │  └───────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  FDB哈希表                           │   │
│  │  ┌───────────────────────────────────────────────┐ │   │
│  │  │  fdb_head[0] → vxlan_fdb → vxlan_fdb → ...    │ │   │
│  │  │  fdb_head[1] → vxlan_fdb → ...                │ │   │
│  │  │  ...                                            │ │   │
│  │  │  fdb_head[255] → vxlan_fdb → ...              │ │   │
│  │  └───────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  vxlan_fdb (FDB条目)                 │   │
│  │  ┌───────────────────────────────────────────────┐ │   │
│  │  │  u8 eth_addr[ETH_ALEN] (MAC地址)              │ │   │
│  │  │  __be32 vni (VNI)                             │ │   │
│  │  │  struct list_head remotes ─────────────┐      │ │   │
│  │  │  unsigned long updated, used             │      │ │   │
│  │  └───────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  vxlan_rdst (远端VTEP)               │   │
│  │  ┌───────────────────────────────────────────────┐ │   │
│  │  │  union vxlan_addr remote_ip (VTEP IP)         │ │   │
│  │  │  __be16 remote_port (UDP端口)                 │ │   │
│  │  │  __be32 remote_vni (VNI)                      │ │   │
│  │  │  struct dst_cache dst_cache (路由缓存)        │ │   │
│  │  └───────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  查找流程：MAC地址 → FDB条目 → 远端VTEP IP → 封装发送        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、vxlan_xmit()封装流程

### 4.1 vxlan_xmit()函数

当向VXLAN设备发送数据包时，调用`vxlan_xmit()`进行封装：

```c
// drivers/net/vxlan/vxlan_core.c: 2891
static netdev_tx_t vxlan_xmit(struct sk_buff *skb, struct net_device *dev)
{
    struct vxlan_dev *vxlan = netdev_priv(dev);
    struct vxlan_rdst *rdst, *fdst = NULL;
    const struct ip_tunnel_info *info;
    bool did_rsc = false;
    struct vxlan_fdb *f;
    struct ethhdr *eth;
    __be32 vni = 0;

    info = skb_tunnel_info(skb);

    skb_reset_mac_header(skb);

    // 步骤1：处理元数据模式
    if (vxlan->cfg.flags & VXLAN_F_COLLECT_METADATA) {
        if (info && info->mode & IP_TUNNEL_INFO_BRIDGE &&
            info->mode & IP_TUNNEL_INFO_TX) {
            vni = tunnel_id_to_key32(info->key.tun_id);
        } else {
            if (info && info->mode & IP_TUNNEL_INFO_TX)
                vxlan_xmit_one(skb, dev, vni, NULL, false);
            else
                kfree_skb(skb);
            return NETDEV_TX_OK;
        }
    }

    // 步骤2：处理ARP/ND代理
    if (vxlan->cfg.flags & VXLAN_F_PROXY) {
        eth = eth_hdr(skb);
        if (ntohs(eth->h_proto) == ETH_P_ARP)
            return arp_reduce(dev, skb, vni);
#if IS_ENABLED(CONFIG_IPV6)
        else if (ntohs(eth->h_proto) == ETH_P_IPV6 &&
                 pskb_may_pull(skb, sizeof(struct ipv6hdr) +
                                sizeof(struct nd_msg)) &&
                 ipv6_hdr(skb)->nexthdr == IPPROTO_ICMPV6) {
            struct nd_msg *m = (struct nd_msg *)(ipv6_hdr(skb) + 1);

            if (m->icmph.icmp6_code == 0 &&
                m->icmph.icmp6_type == NDISC_NEIGHBOUR_SOLICITATION)
                return neigh_reduce(dev, skb, vni);
        }
#endif
    }

    // 步骤3：查找FDB，获取目的VTEP
    eth = eth_hdr(skb);
    f = vxlan_find_mac(vxlan, eth->h_dest, vni);
    did_rsc = false;

    // 步骤4：处理路由短路（Route Short-Circuit）
    if (f && (f->flags & NTF_ROUTER) && (vxlan->cfg.flags & VXLAN_F_RSC) &&
        (ntohs(eth->h_proto) == ETH_P_IP ||
         ntohs(eth->h_proto) == ETH_P_IPV6)) {
        did_rsc = route_shortcircuit(dev, skb);
        if (did_rsc)
            f = vxlan_find_mac(vxlan, eth->h_dest, vni);
    }

    // 步骤5：如果FDB未找到，使用默认目的（泛洪）
    if (f == NULL) {
        f = vxlan_find_mac(vxlan, all_zeros_mac, vni);
        if (f == NULL) {
            if ((vxlan->cfg.flags & VXLAN_F_L2MISS) &&
                !is_multicast_ether_addr(eth->h_dest))
                vxlan_fdb_miss(vxlan, eth->h_dest);

            dev->stats.tx_dropped++;
            kfree_skb(skb);
            return NETDEV_TX_OK;
        }
    }

    // 步骤6：发送到所有远端VTEP
    if (rcu_access_pointer(f->nh)) {
        // 使用下一跳
        vxlan_xmit_nh(skb, dev, f,
                      (vni ? : vxlan->default_dst.remote_vni), did_rsc);
    } else {
        // 遍历所有远端VTEP
        list_for_each_entry_rcu(rdst, &f->remotes, list) {
            struct sk_buff *skb1;

            if (!fdst) {
                fdst = rdst;
                continue;
            }
            skb1 = skb_clone(skb, GFP_ATOMIC);
            if (skb1)
                vxlan_xmit_one(skb1, dev, vni, rdst, did_rsc);
        }
        if (fdst)
            vxlan_xmit_one(skb, dev, vni, fdst, did_rsc);
        else
            kfree_skb(skb);
    }

    return NETDEV_TX_OK;
}
```

### 4.2 vxlan_xmit_one()函数（核心封装）

`vxlan_xmit_one()`执行实际的VXLAN封装：

```c
// drivers/net/vxlan/vxlan_core.c: 2600
static void vxlan_xmit_one(struct sk_buff *skb, struct net_device *dev,
                           __be32 default_vni, struct vxlan_rdst *rdst,
                           bool did_rsc)
{
    struct dst_cache *dst_cache;
    struct ip_tunnel_info *info;
    struct vxlan_dev *vxlan = netdev_priv(dev);
    const struct iphdr *old_iph = ip_hdr(skb);
    union vxlan_addr *dst;
    union vxlan_addr remote_ip, local_ip;
    struct vxlan_metadata _md;
    struct vxlan_metadata *md = &_md;
    __be16 src_port = 0, dst_port;
    struct dst_entry *ndst = NULL;
    __be32 vni, label;
    __u8 tos, ttl;
    int ifindex;
    int err;
    u32 flags = vxlan->cfg.flags;
    bool udp_sum = false;
    bool xnet = !net_eq(vxlan->net, dev_net(vxlan->dev));

    info = skb_tunnel_info(skb);

    if (rdst) {
        // 步骤1：获取远端VTEP信息
        dst = &rdst->remote_ip;
        if (vxlan_addr_any(dst)) {
            if (did_rsc) {
                // 短路回本地bridge
                vxlan_encap_bypass(skb, vxlan, vxlan,
                                   default_vni, true);
                return;
            }
            goto drop;
        }

        dst_port = rdst->remote_port ? rdst->remote_port : vxlan->cfg.dst_port;
        vni = (rdst->remote_vni) ? : default_vni;
        ifindex = rdst->remote_ifindex;
        local_ip = vxlan->cfg.saddr;
        dst_cache = &rdst->dst_cache;
        md->gbp = skb->mark;

        // 步骤2：设置TTL和TOS
        if (flags & VXLAN_F_TTL_INHERIT) {
            ttl = ip_tunnel_get_ttl(old_iph, skb);
        } else {
            ttl = vxlan->cfg.ttl;
            if (!ttl && vxlan_addr_multicast(dst))
                ttl = 1;
        }

        tos = vxlan->cfg.tos;
        if (tos == 1)
            tos = ip_tunnel_get_dsfield(old_iph, skb);

        // 步骤3：设置UDP校验和
        if (dst->sa.sa_family == AF_INET)
            udp_sum = !(flags & VXLAN_F_UDP_ZERO_CSUM_TX);
        else
            udp_sum = !(flags & VXLAN_F_UDP_ZERO_CSUM6_TX);
        label = vxlan->cfg.label;
    } else {
        // ... 处理元数据模式
    }

    // 步骤4：计算源UDP端口（用于多路径）
    src_port = udp_flow_src_port(dev_net(dev), skb, vxlan->cfg.port_min,
                                  vxlan->cfg.port_max, true);

    // 步骤5：查找路由
    if (dst->sa.sa_family == AF_INET) {
        // IPv4路由查找
        struct rtable *rt;

        if (!vxlan->vn4_sock)
            goto drop;

        rt = vxlan_get_route(vxlan, dev, skb, ifindex, tos,
                             local_ip.sin.sin_addr.s_addr,
                             dst->sin.sin_addr.s_addr,
                             dst_port, src_port, dst_cache, info);
        if (IS_ERR(rt)) {
            err = PTR_ERR(rt);
            goto drop;
        }

        ndst = &rt->dst;
        // ... 设置路由
    }

    // 步骤6：执行VXLAN封装
    if (dst->sa.sa_family == AF_INET) {
        // IPv4封装
        err = vxlan_build_skb(skb, ndst, sizeof(struct iphdr),
                              sizeof(struct udphdr) + sizeof(struct vxlanhdr),
                              vni, md, flags, udp_sum);
        if (err)
            goto drop;

        // 设置IP头
        // 设置UDP头
        // 设置VXLAN头
    }

    // 步骤7：发送封装后的包
    udp_tunnel_xmit_skb(ndst, skb, ...);

    return;

drop:
    dev->stats.tx_dropped++;
    kfree_skb(skb);
}
```

### 4.3 VXLAN封装流程图

```
┌─────────────────────────────────────────────────────────────┐
│                  VXLAN封装流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  应用程序发送数据包                                          │
│     ↓                                                        │
│  协议栈处理                                                  │
│     ↓                                                        │
│  路由查找 → VXLAN设备                                        │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_xmit(skb, dev)                                │   │
│  │  • skb_reset_mac_header(skb)                         │   │
│  │  • eth = eth_hdr(skb)                                │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  查找FDB：f = vxlan_find_mac(vxlan, eth->h_dest)    │   │
│  │  • 目的MAC → 远端VTEP IP                             │   │
│  │  • 如果未找到，使用默认目的（泛洪）                   │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_xmit_one(skb, dev, vni, rdst)                 │   │
│  │  • 获取远端VTEP IP和端口                             │   │
│  │  • 计算源UDP端口（用于多路径）                        │   │
│  │  • 查找路由                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_build_skb(skb, ...)                           │   │
│  │  • 添加VXLAN头（8字节）                              │   │
│  │    - vx_flags = VXLAN_HF_VNI                         │   │
│  │    - vx_vni = vni << 8                               │   │
│  │  • 添加UDP头（8字节）                                │   │
│  │    - source port (随机)                              │   │
│  │    - dest port (4789/8472)                           │   │
│  │  • 添加外层IP头（20字节）                            │   │
│  │    - source IP (本地VTEP IP)                         │   │
│  │    - dest IP (远端VTEP IP)                           │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  udp_tunnel_xmit_skb(ndst, skb, ...)                 │   │
│  │  • 发送封装后的UDP包                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  物理网络传输                                                │
│                                                             │
│  原始包：[Ethernet Header] [IP Header] [Payload]            │
│     ↓                                                        │
│  封装后：[Outer IP] [UDP] [VXLAN] [Inner Ethernet]           │
│          [Inner IP] [Payload]                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、vxlan_rcv()解封装流程

### 5.1 vxlan_rcv()函数

当收到VXLAN UDP包时，调用`vxlan_rcv()`进行解封装：

```c
// drivers/net/vxlan/vxlan_core.c: 1829
static int vxlan_rcv(struct sock *sk, struct sk_buff *skb)
{
    struct vxlan_dev *vxlan;
    struct vxlan_sock *vs;
    struct vxlanhdr unparsed;
    struct vxlan_metadata _md;
    struct vxlan_metadata *md = &_md;
    __be16 protocol = htons(ETH_P_TEB);
    bool raw_proto = false;
    void *oiph;
    __be32 vni = 0;

    // 步骤1：检查VXLAN头是否存在
    if (!pskb_may_pull(skb, VXLAN_HLEN))
        goto drop;

    unparsed = *vxlan_hdr(skb);

    // 步骤2：检查VNI标志位
    if (!(unparsed.vx_flags & VXLAN_HF_VNI)) {
        netdev_dbg(skb->dev, "invalid vxlan flags=%#x vni=%#x\n",
                   ntohl(vxlan_hdr(skb)->vx_flags),
                   ntohl(vxlan_hdr(skb)->vx_vni));
        goto drop;
    }
    unparsed.vx_flags &= ~VXLAN_HF_VNI;
    unparsed.vx_vni &= ~VXLAN_VNI_MASK;

    // 步骤3：获取vxlan_sock
    vs = rcu_dereference_sk_user_data(sk);
    if (!vs)
        goto drop;

    // 步骤4：提取VNI
    vni = vxlan_vni(vxlan_hdr(skb)->vx_vni);

    // 步骤5：根据VNI查找vxlan_dev
    vxlan = vxlan_vs_find_vni(vs, skb->dev->ifindex, vni);
    if (!vxlan)
        goto drop;

    // 步骤6：处理VXLAN扩展（GPE、GBP等）
    if (vs->flags & VXLAN_F_GPE) {
        if (!vxlan_parse_gpe_proto(&unparsed, &protocol))
            goto drop;
        unparsed.vx_flags &= ~VXLAN_GPE_USED_BITS;
        raw_proto = true;
    }

    // 步骤7：去掉外层头（IP + UDP + VXLAN）
    if (__iptunnel_pull_header(skb, VXLAN_HLEN, protocol, raw_proto,
                               !net_eq(vxlan->net, dev_net(vxlan->dev))))
        goto drop;

    // 步骤8：处理远程校验和卸载
    if (vs->flags & VXLAN_F_REMCSUM_RX)
        if (unlikely(!vxlan_remcsum(&unparsed, skb, vs->flags)))
            goto drop;

    // 步骤9：处理元数据
    if (vxlan_collect_metadata(vs)) {
        struct metadata_dst *tun_dst;

        tun_dst = udp_tun_rx_dst(skb, vxlan_get_sk_family(vs), TUNNEL_KEY,
                                 key32_to_tunnel_id(vni), sizeof(*md));

        if (!tun_dst)
            goto drop;

        md = ip_tunnel_info_opts(&tun_dst->u.tun_info);

        skb_dst_set(skb, (struct dst_entry *)tun_dst);
    } else {
        memset(md, 0, sizeof(*md));
    }

    // 步骤10：处理GBP扩展
    if (vs->flags & VXLAN_F_GBP)
        vxlan_parse_gbp_hdr(&unparsed, skb, vs->flags, md);

    // 步骤11：检查未处理的标志位
    if (unparsed.vx_flags || unparsed.vx_vni) {
        goto drop;
    }

    // 步骤12：设置MAC地址并学习
    if (!raw_proto) {
        if (!vxlan_set_mac(vxlan, vs, skb, vni))
            goto drop;
    } else {
        skb_reset_mac_header(skb);
        skb->dev = vxlan->dev;
        skb->pkt_type = PACKET_HOST;
    }

    oiph = skb_network_header(skb);

    // 步骤13：重置网络头
    skb_reset_network_header(skb);

    // 步骤14：处理GRO
    if (gro_cells_receive(&vxlan->gro_cells, skb))
        return 0;

    // 步骤15：送入协议栈
    if (skb->protocol == htons(ETH_P_TEB)) {
        // 以太网帧
        skb_reset_mac_header(skb);
        skb->dev = vxlan->dev;
        netif_rx(skb);
    } else {
        // 其他协议
        skb->dev = vxlan->dev;
        netif_rx(skb);
    }

    return 0;

drop:
    kfree_skb(skb);
    return 0;
}
```

### 5.2 vxlan_set_mac()函数（MAC学习）

`vxlan_set_mac()`设置MAC地址并执行MAC学习：

```c
// drivers/net/vxlan/vxlan_core.c
static bool vxlan_set_mac(struct vxlan_dev *vxlan, struct vxlan_sock *vs,
                          struct sk_buff *skb, __be32 vni)
{
    struct ethhdr *eth = eth_hdr(skb);

    // 步骤1：检查源MAC是否有效
    if (!is_valid_ether_addr(eth->h_source))
        return false;

    // 步骤2：设置skb的设备
    skb_reset_mac_header(skb);
    skb->dev = vxlan->dev;

    // 步骤3：设置包类型
    if (ether_addr_equal(eth->h_dest, vxlan->dev->dev_addr))
        skb->pkt_type = PACKET_HOST;
    else if (is_broadcast_ether_addr(eth->h_dest))
        skb->pkt_type = PACKET_BROADCAST;
    else if (is_multicast_ether_addr(eth->h_dest))
        skb->pkt_type = PACKET_MULTICAST;
    else
        skb->pkt_type = PACKET_OTHERHOST;

    // 步骤4：MAC学习（如果启用）
    if ((vxlan->cfg.flags & VXLAN_F_LEARN) &&
        !(vs->flags & VXLAN_F_COLLECT_METADATA))
        vxlan_snoop(skb->dev, &vs->sock, eth->h_source,
                    ip_hdr(skb)->saddr, vni);

    return true;
}
```

### 5.3 vxlan_snoop()函数（MAC学习）

`vxlan_snoop()`执行实际的MAC学习，更新FDB：

```c
// drivers/net/vxlan/vxlan_core.c
static void vxlan_snoop(struct net_device *dev,
                        struct sock *sk,
                        const u8 *mac,
                        union vxlan_addr *remote_ip,
                        __be32 vni)
{
    struct vxlan_dev *vxlan = netdev_priv(dev);
    struct vxlan_fdb *f;

    // 步骤1：在FDB中查找MAC地址
    f = vxlan_find_mac(vxlan, mac, vni);
    if (likely(f)) {
        // 步骤2：如果找到，更新远端VTEP IP
        struct vxlan_rdst *rdst = first_remote_rcu(f);

        if (likely(vxlan_addr_equal(&rdst->remote_ip, remote_ip)))
            return;

        // 远端IP改变，更新FDB
        // ...
    } else {
        // 步骤3：如果未找到，创建新的FDB条目
        u32 hash = vxlan_fdb_hash(vxlan, mac, vni);

        spin_lock_bh(&vxlan->hash_lock[hash]);
        f = vxlan_fdb_create(vxlan, mac, remote_ip, vni, hash,
                             NTF_SELF, NUD_REACHABLE, 0, false);
        spin_unlock_bh(&vxlan->hash_lock[hash]);
    }
}
```

### 5.4 VXLAN解封装流程图

```
┌─────────────────────────────────────────────────────────────┐
│                  VXLAN解封装流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  收到UDP包（目的端口4789/8472）                               │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_rcv(sk, skb)                                  │   │
│  │  • 检查VXLAN头是否存在                               │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  提取VXLAN头                                         │   │
│  │  • vx_flags = vxlan_hdr(skb)->vx_flags              │   │
│  │  • vx_vni = vxlan_hdr(skb)->vx_vni                  │   │
│  │  • vni = vxlan_vni(vx_vni)                          │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  根据VNI查找vxlan_dev                                │   │
│  │  vxlan = vxlan_vs_find_vni(vs, ifindex, vni)        │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  去掉外层头                                           │   │
│  │  __iptunnel_pull_header(skb, VXLAN_HLEN, ...)       │   │
│  │  • 去掉外层IP头（20字节）                             │   │
│  │  • 去掉UDP头（8字节）                                │   │
│  │  • 去掉VXLAN头（8字节）                              │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_set_mac(vxlan, vs, skb, vni)                  │   │
│  │  • 设置skb->dev = vxlan->dev                         │   │
│  │  • 设置skb->pkt_type                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  MAC学习（如果启用VXLAN_F_LEARN）                     │   │
│  │  vxlan_snoop(dev, sk, eth->h_source, remote_ip, vni)│   │
│  │  • 源MAC → 源VTEP IP                                 │   │
│  │  • 更新或创建FDB条目                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  送入协议栈                                           │   │
│  │  netif_rx(skb)                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│     ↓                                                        │
│  以太网层 → IP层 → 传输层 → 应用程序                         │
│                                                             │
│  封装包：[Outer IP] [UDP] [VXLAN] [Inner Ethernet]           │
│          [Inner IP] [Payload]                                │
│     ↓                                                        │
│  解封装后：[Ethernet Header] [IP Header] [Payload]           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、VXLAN FDB转发数据库

### 6.1 FDB的作用

FDB（Forwarding Database，转发数据库）是VXLAN的核心组件，用于：

```
┌─────────────────────────────────────────────────────────────┐
│                      FDB的作用                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. MAC地址到VTEP IP的映射                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 键：MAC地址 + VNI                                 │   │
│  │  • 值：远端VTEP IP地址                               │   │
│  │  • 用于确定数据包应该发送到哪个VTEP                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 支持单播和泛洪                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 单播：目的MAC已知，查FDB得到目的VTEP IP            │   │
│  │  • 泛洪：目的MAC未知，发送到所有VTEP（默认目的）       │   │
│  │  • 组播：发送到组播组                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. MAC地址学习                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 从收到的VXLAN包中学习                             │   │
│  │  • 源MAC → 源VTEP IP                                 │   │
│  │  • 自动更新FDB                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 条目老化                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 定期扫描FDB                                       │   │
│  │  • 删除过期的条目                                    │   │
│  │  • 默认老化时间：300秒                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 FDB查找函数

```c
// drivers/net/vxlan/vxlan_core.c: 539
static struct vxlan_fdb *vxlan_find_mac(struct vxlan_dev *vxlan,
                                        const u8 *mac, __be32 vni)
{
    struct vxlan_fdb *f;

    // 在FDB哈希表中查找
    f = __vxlan_find_mac(vxlan, mac, vni);
    if (f && READ_ONCE(f->used) != jiffies)
        WRITE_ONCE(f->used, jiffies);  // 更新使用时间

    return f;
}

// 内部查找函数
static struct vxlan_fdb *__vxlan_find_mac(struct vxlan_dev *vxlan,
                                          const u8 *mac, __be32 vni)
{
    struct hlist_head *head = vxlan_fdb_head(vxlan, mac, vni);
    struct vxlan_fdb *f;

    // 遍历哈希链表
    hlist_for_each_entry_rcu(f, head, hlist) {
        if (f->vni == vni &&
            ether_addr_equal(mac, f->eth_addr)) {
            return f;  // 找到匹配的条目
        }
    }

    return NULL;  // 未找到
}
```

### 6.3 FDB创建函数

```c
// drivers/net/vxlan/vxlan_core.c
static struct vxlan_fdb *vxlan_fdb_create(struct vxlan_dev *vxlan,
                                          const u8 *mac,
                                          union vxlan_addr *remote_ip,
                                          __be32 vni,
                                          u32 hash,
                                          u16 state,
                                          u16 ndm_flags,
                                          u32 ext_flags,
                                          bool use_src_port)
{
    struct vxlan_fdb *f;
    struct vxlan_rdst *rd;

    // 步骤1：分配vxlan_fdb结构
    f = kmalloc(sizeof(*f), GFP_ATOMIC);
    if (!f)
        return NULL;

    // 步骤2：初始化vxlan_fdb
    memcpy(f->eth_addr, mac, ETH_ALEN);
    f->vni = vni;
    f->state = state;
    f->flags = ndm_flags;
    f->updated = f->used = jiffies;
    f->nh = NULL;
    INIT_LIST_HEAD(&f->remotes);
    INIT_LIST_HEAD(&f->nh_list);

    // 步骤3：分配vxlan_rdst结构
    rd = vxlan_fdb_alloc_rdst(remote_ip, vxlan->cfg.dst_port,
                              vni, 0, use_src_port);
    if (!rd) {
        kfree(f);
        return NULL;
    }

    // 步骤4：将rd添加到f->remotes链表
    list_add_rcu(&rd->list, &f->remotes);

    // 步骤5：将f添加到FDB哈希表
    hlist_add_head_rcu(&f->hlist, &vxlan->fdb_head[hash]);

    return f;
}
```

### 6.4 FDB老化机制

```c
// drivers/net/vxlan/vxlan_core.c: 2991
static void vxlan_cleanup(struct timer_list *t)
{
    struct vxlan_dev *vxlan = from_timer(vxlan, t, age_timer);
    unsigned long next_timer = jiffies + FDB_AGE_INTERVAL;
    unsigned int h;

    // 遍历所有FDB哈希桶
    for (h = 0; h < FDB_HASH_SIZE; ++h) {
        struct vxlan_fdb *f;
        struct hlist_node *p;

        spin_lock_bh(&vxlan->hash_lock[h]);
        hlist_for_each_entry_safe(f, p, &vxlan->fdb_head[h], hlist) {
            unsigned long timeout;

            // 计算超时时间
            if (f->state & NUD_PERMANENT)
                continue;  // 永久条目，不老化

            timeout = vxlan->cfg.age_interval;
            if (timeout == 0)
                timeout = FDB_AGE_DEFAULT * HZ;

            // 检查是否过期
            if (time_before_eq(jiffies, f->used + timeout))
                continue;

            // 删除过期条目
            // ...
        }
        spin_unlock_bh(&vxlan->hash_lock[h]);
    }

    // 重新设置定时器
    mod_timer(&vxlan->age_timer, next_timer);
}
```

### 6.5 FDB管理命令

```bash
# 查看FDB
bridge fdb show dev vxlan0

# 添加FDB条目
bridge fdb add 00:11:22:33:44:55 dev vxlan0 dst 192.168.1.2 vni 100

# 删除FDB条目
bridge fdb del 00:11:22:33:44:55 dev vxlan0

# 查看指定VNI的FDB
bridge fdb show dev vxlan0 vni 100
```

---

## 七、VXLAN设备创建与配置

### 7.1 创建VXLAN设备

```bash
# 方法1：使用ip link命令
ip link add vxlan0 type vxlan id 100 \
    dev eth0 \
    local 192.168.1.1 \
    remote 192.168.1.2 \
    dstport 4789

# 方法2：多播模式
ip link add vxlan0 type vxlan id 100 \
    dev eth0 \
    local 192.168.1.1 \
    group 239.1.1.1 \
    dstport 4789

# 方法3：仅本地VTEP（不指定remote）
ip link add vxlan0 type vxlan id 100 \
    dev eth0 \
    local 192.168.1.1 \
    dstport 4789

# 启动设备
ip link set vxlan0 up

# 配置IP地址
ip addr add 10.0.0.1/24 dev vxlan0
```

### 7.2 VXLAN设备参数说明

```
┌─────────────────────────────────────────────────────────────┐
│                  VXLAN设备参数                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  id VNI          VXLAN Network Identifier（必需）            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 24位VNI，范围：0 ~ 16777215                       │   │
│  │  • 每个VNI代表一个独立的虚拟网络                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  dev DEVICE      物理设备（用于路由）                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 指定出接口                                        │   │
│  │  • 用于路由查找                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  local IP        本地VTEP IP地址                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 外层IP包的源IP地址                                │   │
│  │  • 通常是物理网卡的IP                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  remote IP       远端VTEP IP地址（单播模式）                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 外层IP包的目的IP地址                              │   │
│  │  • 用于点对点VXLAN                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  group IP        组播组地址（组播模式）                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 用于泛洪和广播                                    │   │
│  │  • 所有VTEP加入同一个组播组                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  dstport PORT    目的UDP端口                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • IANA标准端口：4789                                │   │
│  │  • Linux默认端口：8472                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ageing SECONDS  FDB老化时间                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 默认：300秒                                       │   │
│  │  • 0表示不老化                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  learning        启用MAC学习                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 从收到的包中学习源MAC → VTEP IP                   │   │
│  │  • 默认启用                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  nolearning      禁用MAC学习                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 不自动学习MAC地址                                 │   │
│  │  • 需要手动配置FDB                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 完整示例：创建VXLAN网络

```bash
#!/bin/bash

# 主机A（192.168.1.1）
# 步骤1：创建VXLAN设备
ip link add vxlan0 type vxlan id 100 \
    dev eth0 \
    local 192.168.1.1 \
    dstport 4789

# 步骤2：启动设备
ip link set vxlan0 up

# 步骤3：配置IP地址
ip addr add 10.0.0.1/24 dev vxlan0

# 步骤4：手动添加FDB条目（如果不使用learning）
bridge fdb add 00:00:00:00:00:00 dev vxlan0 dst 192.168.1.2

# 主机B（192.168.1.2）
# 步骤1：创建VXLAN设备
ip link add vxlan0 type vxlan id 100 \
    dev eth0 \
    local 192.168.1.2 \
    dstport 4789

# 步骤2：启动设备
ip link set vxlan0 up

# 步骤3：配置IP地址
ip addr add 10.0.0.2/24 dev vxlan0

# 步骤4：手动添加FDB条目
bridge fdb add 00:00:00:00:00:00 dev vxlan0 dst 192.168.1.1

# 测试连通性
# 在主机A上：ping 10.0.0.2
```

---

## 八、Kubernetes Flannel/Calico VXLAN模式

### 8.1 Flannel VXLAN模式架构

Flannel使用VXLAN实现跨主机Pod通信：

```
┌─────────────────────────────────────────────────────────────┐
│                Flannel VXLAN架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主机1（192.168.1.1）                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Pod1 (10.244.1.2)                                   │   │
│  │     ↓                                                 │   │
│  │  cni0 Bridge                                          │   │
│  │     ↓                                                 │   │
│  │  flannel.1 (VXLAN设备)                               │   │
│  │  • VNI: 1                                             │   │
│  │  • 本地IP: 192.168.1.1                               │   │
│  │  • 查FDB: 目的Pod MAC → 主机2 IP                     │   │
│  │     ↓                                                 │   │
│  │  封装成UDP包                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  物理网络                                                    │
│                          ↓                                  │
│  主机2（192.168.1.2）                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UDP包                                                │   │
│  │     ↓                                                 │   │
│  │  flannel.1 (VXLAN设备)                               │   │
│  │  • 解封装                                             │   │
│  │  • 学习: Pod1 MAC → 主机1 IP                         │   │
│  │     ↓                                                 │   │
│  │  cni0 Bridge                                          │   │
│  │     ↓                                                 │   │
│  │  Pod2 (10.244.2.2)                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Flannel VXLAN配置

```yaml
# kube-flannel.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kube-flannel-cfg
  namespace: kube-system
data:
  net-conf.json: |
    {
      "Network": "10.244.0.0/16",      # Pod网段
      "Backend": {
        "Type": "vxlan",               # 使用VXLAN
        "VNI": 1,                      # VNI编号
        "Port": 8472                   # UDP端口
      }
    }
```

### 8.3 Flannel VXLAN工作流程

```
┌─────────────────────────────────────────────────────────────┐
│              Flannel VXLAN跨主机通信流程                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  步骤1：Pod1发送数据到Pod2                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Pod1 (10.244.1.2) → Pod2 (10.244.2.2)               │   │
│  │  源MAC: Pod1的MAC                                    │   │
│  │  目的MAC: Pod2的MAC（通过ARP获取）                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤2：数据包到达flannel.1                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_xmit()                                        │   │
│  │  • 查FDB: Pod2 MAC → 主机2 IP (192.168.1.2)          │   │
│  │  • 封装: 添加VXLAN头 + UDP头 + IP头                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤3：封装后的UDP包                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  外层IP:                                             │   │
│  │    源IP: 192.168.1.1 (主机1)                         │   │
│  │    目的IP: 192.168.1.2 (主机2)                       │   │
│  │  UDP:                                                │   │
│  │    源端口: 随机                                      │   │
│  │    目的端口: 8472                                    │   │
│  │  VXLAN:                                              │   │
│  │    VNI: 1                                            │   │
│  │  内层以太网帧:                                        │   │
│  │    源MAC: Pod1的MAC                                  │   │
│  │    目的MAC: Pod2的MAC                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤4：主机2收到并解封装                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  vxlan_rcv()                                         │   │
│  │  • 去掉外层IP + UDP + VXLAN头                        │   │
│  │  • 学习: Pod1 MAC → 主机1 IP                         │   │
│  │  • 送入cni0 Bridge                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤5：数据包到达Pod2                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  cni0 Bridge转发到Pod2                               │   │
│  │  Pod2收到原始以太网帧                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 Calico VXLAN模式架构

Calico也支持VXLAN模式：

```
┌─────────────────────────────────────────────────────────────┐
│                Calico VXLAN架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主机1（192.168.1.1）                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Pod1 (10.244.1.2)                                   │   │
│  │     ↓                                                 │   │
│  │  cali接口（每个Pod一个）                              │   │
│  │     ↓                                                 │   │
│  │  vxlan.calico (VXLAN设备)                            │   │
│  │  • VNI: 4096                                          │   │
│  │  • 本地IP: 192.168.1.1                               │   │
│  │  • 查FDB: 目的Pod MAC → 主机2 IP                     │   │
│  │     ↓                                                 │   │
│  │  封装成UDP包                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Calico VXLAN特点：                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 每个Pod有独立的cali接口                            │   │
│  │  • 使用代理ARP减少ARP流量                             │   │
│  │  • 支持网络策略                                      │   │
│  │  • VNI: 4096（默认）                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.5 Calico VXLAN配置

```yaml
# calico-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: calico-config
  namespace: kube-system
data:
  calico_backend: "vxlan"  # 使用VXLAN模式
  veth_mtu: "1440"         # MTU（考虑VXLAN开销）
  vxlan_vni: "4096"        # VNI编号
```

### 8.6 Flannel vs Calico VXLAN对比

```
┌─────────────────────────────────────────────────────────────┐
│              Flannel vs Calico VXLAN对比                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特性                Flannel VXLAN    Calico VXLAN           │
│  ────────────────────────────────────────────────────────  │
│  架构                简单              复杂                  │
│  性能                中等              高                    │
│  网络策略            不支持            支持                  │
│  VNI                 1（固定）         4096（可配置）        │
│  UDP端口             8472             4789                  │
│  MTU                 1450             1440                  │
│  代理ARP             不使用            使用                  │
│  FDB管理             自动学习          自动学习              │
│  适用场景            简单网络          复杂网络策略          │
│                                                             │
│  性能对比：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Flannel VXLAN:                                     │   │
│  │  • 封装开销：~50字节                                 │   │
│  │  • 吞吐量：~8 Gbps                                   │   │
│  │  • 延迟：~0.5ms                                      │   │
│  │                                                          │   │
│  │  Calico VXLAN:                                       │   │
│  │  • 封装开销：~50字节                                 │   │
│  │  • 吞吐量：~9 Gbps                                   │   │
│  │  • 延迟：~0.3ms                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、实际应用场景

### 9.1 OpenStack虚拟机网络

```
┌─────────────────────────────────────────────────────────────┐
│                OpenStack VXLAN网络                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  计算节点1                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  VM1 (租户A)                                          │   │
│  │     ↓                                                 │   │
│  │  tap设备                                              │   │
│  │     ↓                                                 │   │
│  │  Linux Bridge (brq-xxx)                               │   │
│  │     ↓                                                 │   │
│  │  VLAN设备 (vlan100)                                   │   │
│  │     ↓                                                 │   │
│  │  VXLAN设备 (vxlan-100)                                │   │
│  │  • VNI: 100                                           │   │
│  │  • 封装并发送到计算节点2                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  物理网络                                                    │
│                          ↓                                  │
│  计算节点2                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  VXLAN设备 (vxlan-100)                                │   │
│  │  • 解封装                                             │   │
│  │     ↓                                                 │   │
│  │  VLAN设备 (vlan100)                                   │   │
│  │     ↓                                                 │   │
│  │  Linux Bridge (brq-xxx)                               │   │
│  │     ↓                                                 │   │
│  │  tap设备                                              │   │
│  │     ↓                                                 │   │
│  │  VM2 (租户A)                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  OpenStack VXLAN特点：                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 每个租户网络一个VNI                                │   │
│  │  • 支持跨主机虚拟机迁移                               │   │
│  │  • 支持Neutron网络隔离                               │   │
│  │  • 支持安全组                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Docker容器网络

```
┌─────────────────────────────────────────────────────────────┐
│                Docker VXLAN网络                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主机1                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Container1                                          │   │
│  │     ↓                                                 │   │
│  │  veth pair                                           │   │
│  │     ↓                                                 │   │
│  │  docker0 Bridge                                       │   │
│  │     ↓                                                 │   │
│  │  vxlan0 (VXLAN设备)                                   │   │
│  │  • VNI: 100                                           │   │
│  │  • 跨主机通信                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Docker VXLAN配置：                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # 创建VXLAN网络                                     │   │
│  │  docker network create -d overlay \                  │   │
│  │    --subnet=10.0.0.0/24 \                            │   │
│  │    my-overlay-network                                │   │
│  │                                                          │   │
│  │  # 启动容器                                           │   │
│  │  docker run -d --network my-overlay-network nginx    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 EVPN-VXLAN（数据中心互联）

```
┌─────────────────────────────────────────────────────────────┐
│                EVPN-VXLAN架构                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  EVPN（Ethernet VPN）使用BGP分发VXLAN FDB：                   │
│                                                             │
│  数据中心1                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  VTEP-1                                               │   │
│  │  • VXLAN设备                                          │   │
│  │  • BGP EVPN                                           │   │
│  │  • 分发MAC/IP信息到其他VTEP                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  BGP EVPN路由                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Type-2: MAC/IP Advertisement                        │   │
│  │    • MAC地址                                         │   │
│  │    • IP地址                                          │   │
│  │    • VNI                                             │   │
│  │    • VTEP IP                                         │   │
│  │                                                          │   │
│  │  Type-3: Inclusive Multicast Ethernet Tag Route      │   │
│  │    • 用于BUM流量（广播、未知单播、组播）              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  数据中心2                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  VTEP-2                                               │   │
│  │  • 接收BGP EVPN路由                                   │   │
│  │  • 更新FDB                                            │   │
│  │  • MAC → VTEP IP映射                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  EVPN-VXLAN优势：                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 控制平面学习（BGP），替代数据平面学习              │   │
│  │  • 支持跨数据中心二层互联                             │   │
│  │  • 支持虚拟机跨数据中心迁移                           │   │
│  │  • 无需泛洪，减少网络流量                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 十、调试与问题排查

### 10.1 常用调试命令

```bash
# 1. 查看VXLAN设备
ip -d link show vxlan0

# 2. 查看VXLAN统计信息
ip -s link show vxlan0

# 3. 查看FDB
bridge fdb show dev vxlan0

# 4. 查看指定VNI的FDB
bridge fdb show dev vxlan0 vni 100

# 5. 抓包分析VXLAN
tcpdump -i eth0 udp port 4789 -w vxlan.pcap

# 6. 查看VXLAN邻居
ip neigh show dev vxlan0

# 7. 查看路由
ip route show table all | grep vxlan

# 8. 查看内核日志
dmesg | grep vxlan

# 9. 查看网络命名空间中的VXLAN设备
ip netns exec <ns> ip link show

# 10. 查看VXLAN配置
cat /sys/class/net/vxlan0/ifalias
```

### 10.2 常见问题与解决方案

```
┌─────────────────────────────────────────────────────────────┐
│                  常见问题与解决方案                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  问题1：VXLAN设备无法通信                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：ping不通远端VXLAN网络                         │   │
│  │  原因：                                              │   │
│  │    • FDB条目缺失                                     │   │
│  │    • 路由配置错误                                    │   │
│  │    • 防火墙阻止UDP端口                               │   │
│  │  解决：                                              │   │
│  │    • 检查FDB：bridge fdb show dev vxlan0             │   │
│  │    • 添加FDB：bridge fdb add ... dev vxlan0 dst ... │   │
│  │    • 检查路由：ip route get <remote-ip>              │   │
│  │    • 开放防火墙：iptables -I INPUT -p udp --dport 4789 -j ACCEPT │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题2：MTU问题导致大包无法传输                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：小包能通，大包不通                             │   │
│  │  原因：                                              │   │
│  │    • VXLAN封装增加50字节开销                         │   │
│  │    • MTU设置过大                                     │   │
│  │  解决：                                              │   │
│  │    • 设置MTU：ip link set vxlan0 mtu 1450            │   │
│  │    • 或设置物理网卡MTU更大                           │   │
│  │    • MTU计算：物理MTU - 50 = VXLAN MTU               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题3：MAC学习不工作                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：FDB条目不自动学习                             │   │
│  │  原因：                                              │   │
│  │    • VXLAN设备禁用了learning                         │   │
│  │    • FDB老化时间太短                                 │   │
│  │  解决：                                              │   │
│  │    • 启用learning：ip link add vxlan0 type vxlan ... learning │
│  │    • 设置老化时间：ip link add vxlan0 type vxlan ... ageing 300 │
│  │    • 手动添加FDB：bridge fdb add ...                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题4：性能问题                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：VXLAN吞吐量低                                 │   │
│  │  原因：                                              │   │
│  │    • CPU校验和计算开销大                             │   │
│  │    • 未启用GRO/GSO                                   │   │
│  │  解决：                                              │   │
│  │    • 启用GRO：ethtool -K vxlan0 gro on               │   │
│  │    • 启用GSO：ethtool -K vxlan0 gso on               │   │
│  │    • 启用TX checksum：ethtool -K vxlan0 tx on        │   │
│  │    • 使用UDP零校验和：ip link add vxlan0 type vxlan ... udp零csumtx │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题5：VNI冲突                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：不同租户网络互相干扰                           │   │
│  │  原因：                                              │   │
│  │    • 不同网络使用了相同的VNI                         │   │
│  │  • VNI规划不合理                                     │   │
│  │  解决：                                              │   │
│  │    • 为每个网络分配独立的VNI                         │   │
│  │    • 检查VNI：ip -d link show vxlan0                 │   │
│  │    • 重新规划VNI分配                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.3 性能优化建议

```
┌─────────────────────────────────────────────────────────────┐
│                  VXLAN性能优化                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 启用GRO/GSO                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ethtool -K vxlan0 gro on                            │   │
│  │  ethtool -K vxlan0 gso on                            │   │
│  │  • 减少协议栈处理次数                                │   │
│  │  • 提升吞吐量                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 启用校验和卸载                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ethtool -K vxlan0 tx on                             │   │
│  │  ethtool -K vxlan0 rx on                             │   │
│  │  • 减少CPU校验和计算                                 │   │
│  │  • 提升性能                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 使用UDP零校验和                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ip link add vxlan0 type vxlan ... \                 │   │
│  │    udp零csumtx udp零csum6tx                          │   │
│  │  • 禁用UDP校验和                                     │   │
│  │  • 提升性能（安全性略降）                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 多队列支持                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ip link add vxlan0 type vxlan ... \                 │   │
│  │    numtxqueues 4 numrxqueues 4                       │   │
│  │  • 多队列并行处理                                    │   │
│  │  • 提升多核性能                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. 调整源端口范围                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ip link add vxlan0 type vxlan ... \                 │   │
│  │    srcport 10000 20000                               │   │
│  │  • 增加源端口范围                                    │   │
│  │  • 支持更多并发流                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  6. 使用硬件卸载                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 支持VXLAN硬件封装/解封装的网卡                    │   │
│  │  • Mellanox、Intel等网卡                             │   │
│  │  • 大幅提升性能                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 总结

### 核心知识点回顾

```
┌─────────────────────────────────────────────────────────────┐
│                    VXLAN核心知识点                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 为什么需要VXLAN                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • VLAN ID数量限制（4094个）                         │   │
│  │  • 二层网络无法跨越三层                              │   │
│  │  • 云计算需要大规模多租户支持                        │   │
│  │  • VXLAN提供1600万个VNI                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. VXLAN协议                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 将二层以太网帧封装在UDP包中                       │   │
│  │  • 外层IP + UDP + VXLAN头 + 内层以太网帧             │   │
│  │  • VNI：24位，支持1600万个虚拟网络                   │   │
│  │  • UDP端口：4789（IANA）或8472（Linux默认）          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. vxlan_xmit()封装流程                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 查FDB：目的MAC → 远端VTEP IP                      │   │
│  │  • 添加VXLAN头（VNI）                                │   │
│  │  • 添加UDP头（源端口、目的端口）                     │   │
│  │  • 添加外层IP头（源VTEP IP、目的VTEP IP）            │   │
│  │  • 发送封装后的UDP包                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. vxlan_rcv()解封装流程                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 提取VXLAN头，获取VNI                              │   │
│  │  • 根据VNI查找vxlan_dev                              │   │
│  │  • 去掉外层IP + UDP + VXLAN头                        │   │
│  │  • MAC学习：源MAC → 源VTEP IP                        │   │
│  │  • 送入协议栈                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. FDB转发数据库                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • MAC地址到VTEP IP的映射                            │   │
│  │  • 支持单播、泛洪、组播                              │   │
│  │  • 自动MAC学习                                       │   │
│  │  • 条目老化机制                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  6. Kubernetes应用                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Flannel VXLAN：简单易用                           │   │
│  │  • Calico VXLAN：支持网络策略                        │   │
│  │  • 实现Pod跨主机通信                                 │   │
│  │  • 每个节点一个VXLAN设备                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 掌握标准检验

```
┌─────────────────────────────────────────────────────────────┐
│                    掌握标准检验清单                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  □ 1. 能解释为什么需要VXLAN，以及VLAN的局限性                 │
│                                                             │
│  □ 2. 能画出VXLAN报文结构，说明各字段含义                     │
│                                                             │
│  □ 3. 能解释VTEP的作用和工作原理                             │
│                                                             │
│  □ 4. 能手动创建VXLAN设备并配置                              │
│                                                             │
│  □ 5. 能解释vxlan_xmit()如何封装原始以太帧成UDP包             │
│                                                             │
│  □ 6. 能解释vxlan_rcv()如何解封装并执行MAC学习                │
│                                                             │
│  □ 7. 能解释FDB的作用，以及MAC学习机制                        │
│                                                             │
│  □ 8. 能手动添加FDB条目                                      │
│                                                             │
│  □ 9. 能解释Kubernetes Flannel/Calico的VXLAN模式如何跨主机通信 │
│                                                             │
│  □ 10. 能排查VXLAN网络问题                                   │
│                                                             │
│  □ 11. 能优化VXLAN性能                                       │
│                                                             │
│  □ 12. 理解VXLAN在实际应用中的场景（OpenStack、Docker、K8s）  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关键代码位置

```
┌─────────────────────────────────────────────────────────────┐
│                    关键代码位置                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  VXLAN核心实现：                                             │
│  • drivers/net/vxlan/vxlan_core.c                           │
│    - vxlan_xmit()：封装函数                                  │
│    - vxlan_rcv()：解封装函数                                 │
│    - vxlan_xmit_one()：实际封装逻辑                          │
│    - vxlan_find_mac()：FDB查找                               │
│    - vxlan_snoop()：MAC学习                                  │
│                                                             │
│  VXLAN头文件：                                               │
│  • include/net/vxlan.h                                       │
│    - struct vxlan_dev：VXLAN设备结构                         │
│    - struct vxlan_fdb：FDB条目结构                           │
│    - struct vxlanhdr：VXLAN头结构                            │
│                                                             │
│  VXLAN用户态接口：                                            │
│  • include/uapi/linux/if_link.h                              │
│    - IFLA_VXLAN_*：VXLAN配置属性                             │
│                                                             │
│  VXLAN文档：                                                  │
│  • Documentation/networking/vxlan.rst                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 进一步学习

```
┌─────────────────────────────────────────────────────────────┐
│                    进一步学习方向                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. EVPN-VXLAN                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • BGP EVPN协议                                      │   │
│  │  • 控制平面学习替代数据平面学习                      │   │
│  │  • 跨数据中心互联                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. VXLAN扩展                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • VXLAN-GPE（Generic Protocol Extension）           │   │
│  │  • VXLAN-GBP（Group Based Policy）                   │   │
│  │  • 远程校验和卸载                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 硬件卸载                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • SmartNIC                                          │   │
│  │  • VXLAN硬件封装/解封装                              │   │
│  │  • 性能优化                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 其他overlay技术                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • GRE                                               │   │
│  │  • Geneve                                            │   │
│  │  • GTP                                               │   │
│  │  • 对比学习                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 参考资料

1. **RFC 7348**: Virtual eXtensible Local Area Network (VXLAN): A Framework for Overlaying Virtualized Layer 2 Networks over Layer 3 Networks
2. **Linux内核源码**: drivers/net/vxlan/vxlan_core.c
3. **Linux文档**: Documentation/networking/vxlan.rst
4. **Kubernetes文档**: https://kubernetes.io/docs/concepts/cluster-administration/networking/
5. **Flannel文档**: https://github.com/coreos/flannel
6. **Calico文档**: https://docs.projectcalico.org/

---

**文档版本**: v1.0  
**创建时间**: 2024年  
**适用内核版本**: Linux 5.15  
**作者**: AI Assistant

---

**说明**: 本文档详细讲解了Linux内核VXLAN技术的实现原理，从"为什么需要VXLAN"开始，深入分析了vxlan_xmit()封装流程、vxlan_rcv()解封装流程、FDB转发数据库的实现，以及Kubernetes中Flannel/Calico的VXLAN模式如何实现跨主机通信。通过本文档，读者应该能够理解VXLAN的核心机制，并能够在实际工作中应用和排查VXLAN相关问题。