# Linux 5.15 套接字模块详解

## 一、从一个问题开始：应用程序如何通信？

### 1.1 假设你要写一个聊天程序

```
场景：聊天程序需要解决的问题
+===========================================================================+
|                                                                           |
|   问题 1：如何找到对方？                                                  |
|   +-------------------+                                                    |
|   | 需要知道对方的地址 |  IP 地址 + 端口号                               |
|   | 需要统一的地址格式 |  不同协议地址不同                                |
|   +-------------------+                                                    |
|                                                                           |
|   问题 2：如何传输数据？                                                  |
|   +-------------------+                                                    |
|   | TCP？UDP？        |  选择什么协议？                                  |
|   | 可靠还是快速？    |  不同需求不同选择                                |
|   +-------------------+                                                    |
|                                                                           |
|   问题 3：如何让应用程序使用？                                            |
|   +-------------------+                                                    |
|   | 提供简单的接口    |  不能让每个应用都实现网络协议                    |
|   | 隐藏底层细节      |  应用只需关心发送和接收                          |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 1.2 套接字的解决方案

**套接字（Socket）**：应用程序与网络协议栈之间的接口。

```
套接字的位置：
+===========================================================================+
|                                                                           |
|   应用程序                                                                |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | 套接字层 (Socket) |  ← 我们要讲的重点                                 |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | 协议栈 (TCP/UDP)  |  传输层                                          |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | 网络层 (IP)       |  网络层                                          |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | 网络设备 (NIC)    |  数据链路层 + 物理层                             |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 1.3 为什么需要套接字？

```
套接字解决的问题：
+===========================================================================+
|                                                                           |
|   1. 统一的编程接口                                                       |
|   +-------------------+                                                    |
|   | 不管底层用什么协议 |  应用程序使用相同的 API                         |
|   | 不管底层用什么网络 |  socket(), bind(), connect(), send(), recv()   |
|   +-------------------+                                                    |
|                                                                           |
|   2. 协议无关性                                                           |
|   +-------------------+                                                    |
|   | 应用不需要关心 TCP 细节 |  如何建立连接、如何重传                     |
|   | 应用不需要关心 IP 细节  |  如何路由、如何分片                         |
|   +-------------------+                                                    |
|                                                                           |
|   3. 资源管理                                                             |
|   +-------------------+                                                    |
|   | 文件描述符管理     |  套接字也是一种文件                            |
|   | 缓冲区管理         |  发送/接收缓冲区                               |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 二、核心数据结构：socket 与 sock

### 2.1 两个关键结构体

Linux 套接字模块有两个核心结构体：**socket** 和 **sock**。

```
socket 与 sock 的关系：
+===========================================================================+
|                                                                           |
|   socket（面向用户空间）                                                  |
|   +-------------------------------------------------------------------+   |
|   | 作用：给应用程序使用的接口                                        |   |
|   | 特点：与文件系统关联，有文件描述符                                |   |
|   | 内容：状态、类型、操作函数指针                                    |   |
|   +-------------------------------------------------------------------+   |
|           |                                                               |
|           | 指向                                                          |
|           v                                                               |
|   sock（面向内核协议栈）                                                  |
|   +-------------------------------------------------------------------+   |
|   | 作用：内核协议栈使用的内部表示                                    |   |
|   | 特点：包含协议相关的所有信息                                      |   |
|   | 内容：地址、端口、缓冲区、回调函数                                |   |
|   +-------------------------------------------------------------------+   |
|                                                                           |
+===========================================================================+
```

### 2.2 socket 结构体详解

```c
/*
 * socket 结构体 - 用户可见的套接字表示
 * 定义在 include/linux/net.h
 */
struct socket {
    socket_state       state;      /* 套接字状态 */
    short              type;       /* 套接字类型 */
    unsigned long      flags;      /* 套接字标志 */
    struct file        *file;      /* 关联的文件结构 */
    struct sock        *sk;        /* 指向内核 sock 结构 */
    const struct proto_ops *ops;   /* 协议操作函数指针 */
    struct socket_wq   wq;         /* 等待队列 */
};
```

```
socket 结构体各字段含义：
+===========================================================================+
|                                                                           |
|   state：套接字状态                                                       |
|   +-------------------+                                                    |
|   | SS_UNCONNECTED  |  未连接（初始状态）                                |
|   | SS_CONNECTING   |  正在连接                                          |
|   | SS_CONNECTED    |  已连接                                            |
|   | SS_DISCONNECTING|  正在断开                                          |
|   +-------------------+                                                    |
|                                                                           |
|   type：套接字类型                                                        |
|   +-------------------+                                                    |
|   | SOCK_STREAM     |  流式套接字（TCP）                                |
|   | SOCK_DGRAM      |  数据报套接字（UDP）                              |
|   | SOCK_RAW        |  原始套接字                                       |
|   +-------------------+                                                    |
|                                                                           |
|   ops：协议操作函数表                                                     |
|   +-------------------+                                                    |
|   | 指向 proto_ops 结构 |  包含 bind, connect, sendmsg, recvmsg 等     |
|   | 不同协议有不同实现   |  AF_INET 用 inet_stream_ops, inet_dgram_ops  |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 2.3 sock 结构体详解

```c
/*
 * sock 结构体 - 内核内部的套接字表示
 * 定义在 include/net/sock.h
 * 
 * 这是网络层的核心结构，包含协议处理所需的所有信息
 */
struct sock {
    /* 公共部分（与 inet_timewait_sock 共享） */
    struct sock_common  __sk_common;
    
    /* 锁和同步 */
    socket_lock_t       sk_lock;           /* 套接字锁 */
    
    /* 接收相关 */
    struct sk_buff_head sk_receive_queue;  /* 接收队列 */
    int                 sk_rcvbuf;         /* 接收缓冲区大小 */
    int                 sk_rcvlowat;       /* 接收低水位 */
    
    /* 发送相关 */
    struct sk_buff_head sk_write_queue;    /* 发送队列 */
    int                 sk_sndbuf;         /* 发送缓冲区大小 */
    atomic_t            sk_wmem_alloc;     /* 发送内存分配计数 */
    
    /* 状态和错误 */
    volatile unsigned char sk_state;       /* 连接状态 */
    int                 sk_err;            /* 错误码 */
    
    /* 地址信息（通过宏定义访问 sock_common） */
    #define sk_family    __sk_common.skc_family    /* 地址族 */
    #define sk_daddr     __sk_common.skc_daddr     /* 目的 IP */
    #define sk_rcv_saddr __sk_common.skc_rcv_saddr /* 本地 IP */
    #define sk_dport     __sk_common.skc_dport     /* 目的端口 */
    #define sk_num       __sk_common.skc_num       /* 本地端口 */
    
    /* 回调函数 */
    void (*sk_state_change)(struct sock *sk);  /* 状态变化回调 */
    void (*sk_data_ready)(struct sock *sk);    /* 数据就绪回调 */
    void (*sk_write_space)(struct sock *sk);   /* 写空间可用回调 */
    void (*sk_error_report)(struct sock *sk);  /* 错误报告回调 */
    
    /* 协议相关 */
    struct proto        *sk_prot;           /* 协议操作函数 */
    struct socket       *sk_socket;         /* 指回 socket 结构 */
};
```

### 2.4 sock_common：最小公共部分

```c
/*
 * sock_common - sock 的最小表示
 * 用于哈希查找和快速访问关键字段
 */
struct sock_common {
    union {
        __addrpair  skc_addrpair;           /* 地址对 */
        struct {
            __be32  skc_daddr;              /* 目的地址 */
            __be32  skc_rcv_saddr;          /* 源地址 */
        };
    };
    
    union {
        __portpair  skc_portpair;           /* 端口对 */
        struct {
            __be16  skc_dport;              /* 目的端口 */
            __u16   skc_num;                /* 本地端口 */
        };
    };
    
    unsigned short      skc_family;         /* 地址族 */
    volatile unsigned char skc_state;       /* 连接状态 */
    struct proto        *skc_prot;          /* 协议处理 */
    refcount_t          skc_refcnt;         /* 引用计数 */
};
```

### 2.5 两层结构的设计原因

```
为什么要分成 socket 和 sock 两层？
+===========================================================================+
|                                                                           |
|   原因 1：分离关注点                                                      |
|   +-------------------+                                                    |
|   | socket：文件系统相关 |  文件描述符、权限、标志                        |
|   | sock：网络协议相关   |  地址、端口、缓冲区、状态                      |
|   +-------------------+                                                    |
|                                                                           |
|   原因 2：支持多种协议族                                                  |
|   +-------------------+                                                    |
|   | socket 层：协议无关 |  统一的 API                                    |
|   | sock 层：协议相关   |  inet_sock, unix_sock, netlink_sock           |
|   +-------------------+                                                    |
|                                                                           |
|   原因 3：内核内部优化                                                    |
|   +-------------------+                                                    |
|   | sock_common：最小字段 |  用于哈希查找，缓存友好                      |
|   | sock：完整字段       |  完整的套接字信息                            |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 三、套接字的创建流程

### 3.1 应用程序调用 socket()

```c
/* 应用程序代码 */
int fd = socket(AF_INET, SOCK_STREAM, 0);
```

### 3.2 系统调用入口

```c
/*
 * socket 系统调用
 * 定义在 net/socket.c
 */
SYSCALL_DEFINE3(socket, int, family, int, type, int, protocol)
{
    return __sys_socket(family, type, protocol);
}

/*
 * __sys_socket - 创建套接字的主体函数
 */
int __sys_socket(int family, int type, int protocol)
{
    int retval;
    struct socket *sock;
    int flags;
    
    /* 步骤 1：提取标志位 */
    flags = type & ~SOCK_TYPE_MASK;
    if (flags & ~(SOCK_CLOEXEC | SOCK_NONBLOCK))
        return -EINVAL;
    type &= SOCK_TYPE_MASK;
    
    /* 步骤 2：创建套接字结构 */
    retval = sock_create(family, type, protocol, &sock);
    if (retval < 0)
        return retval;
    
    /* 步骤 3：映射到文件描述符 */
    return sock_map_fd(sock, flags & (O_CLOEXEC | O_NONBLOCK));
}
```

### 3.3 套接字创建流程图

```
socket() 系统调用流程：
+===========================================================================+
|                                                                           |
|   用户空间：socket(AF_INET, SOCK_STREAM, 0)                              |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | 系统调用入口     |  SYSCALL_DEFINE3(socket, ...)                     |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | __sys_socket()   |                                                    |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | sock_create()    |  创建 socket 结构                                 |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | __sock_create()  |  核心创建逻辑                                     |
|   +-------------------+                                                    |
|       |                                                                   |
|       +-----+-----+-----+                                                  |
|       |           |                                                        |
|       v           v                                                        |
|   +--------+  +-------------------+                                        |
|   |sock_alloc| | 查找协议族      |  net_families[family]                  |
|   +--------+  +-------------------+                                        |
|       |           |                                                        |
|       |           v                                                        |
|       |       +-------------------+                                        |
|       |       | pf->create()     |  调用协议族的 create 函数              |
|       |       +-------------------+                                        |
|       |           |                                                        |
|       |           v                                                        |
|       |       +-------------------+                                        |
|       |       | inet_create()    |  AF_INET 的创建函数                    |
|       |       +-------------------+                                        |
|       |           |                                                        |
|       |           v                                                        |
|       |       +-------------------+                                        |
|       |       | sk_alloc()       |  分配 sock 结构                        |
|       |       +-------------------+                                        |
|       |           |                                                        |
|       +-----------+                                                        |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | sock_map_fd()    |  分配文件描述符                                   |
|   +-------------------+                                                    |
|       |                                                                   |
|       v                                                                   |
|   返回文件描述符                                                          |
|                                                                           |
+===========================================================================+
```

### 3.4 __sock_create 详解

```c
/*
 * __sock_create - 套接字创建的核心函数
 * 定义在 net/socket.c
 */
int __sock_create(struct net *net, int family, int type, int protocol,
                  struct socket **res, int kern)
{
    int err;
    struct socket *sock;
    const struct net_proto_family *pf;
    
    /* 步骤 1：参数检查 */
    if (family < 0 || family >= NPROTO)
        return -EAFNOSUPPORT;
    if (type < 0 || type >= SOCK_MAX)
        return -EINVAL;
    
    /* 步骤 2：安全检查 */
    err = security_socket_create(family, type, protocol, kern);
    if (err)
        return err;
    
    /* 步骤 3：分配 socket 结构 */
    sock = sock_alloc();
    if (!sock)
        return -ENFILE;
    
    sock->type = type;
    
    /* 步骤 4：查找协议族 */
    rcu_read_lock();
    pf = rcu_dereference(net_families[family]);
    if (!pf) {
        rcu_read_unlock();
        goto out_release;
    }
    
    /* 步骤 5：调用协议族的 create 函数 */
    err = pf->create(net, sock, protocol, kern);
    if (err < 0)
        goto out_module_put;
    
    /* 步骤 6：安全后处理 */
    err = security_socket_post_create(sock, family, type, protocol, kern);
    if (err)
        goto out_sock_release;
    
    *res = sock;
    return 0;
}
```

### 3.5 sock_alloc：分配 socket 结构

```c
/*
 * sock_alloc - 分配 socket 结构
 * 
 * 注意：socket 结构是通过 inode 分配的
 * 这体现了 Linux "一切皆文件" 的设计哲学
 */
struct socket *sock_alloc(void)
{
    struct inode *inode;
    struct socket *sock;
    
    /* 从 sockfs 文件系统分配 inode */
    inode = new_inode_pseudo(sock_mnt->mnt_sb);
    if (!inode)
        return NULL;
    
    /* 从 inode 获取 socket 结构 */
    sock = SOCKET_I(inode);
    
    /* 初始化 inode */
    inode->i_ino = get_next_ino();
    inode->i_mode = S_IFSOCK | S_IRWXUGO;
    inode->i_uid = current_fsuid();
    inode->i_gid = current_fsgid();
    inode->i_op = &sockfs_inode_ops;
    
    return sock;
}
```

### 3.6 inet_create：AF_INET 协议族的创建

```c
/*
 * inet_create - AF_INET 协议族的套接字创建
 * 定义在 net/ipv4/af_inet.c
 */
static int inet_create(struct net *net, struct socket *sock, int protocol,
                       int kern)
{
    struct sock *sk;
    struct inet_protosw *answer;
    struct inet_sock *inet;
    struct proto *answer_prot;
    
    sock->state = SS_UNCONNECTED;
    
    /* 步骤 1：查找匹配的协议 */
    rcu_read_lock();
    list_for_each_entry_rcu(answer, &inetsw[sock->type], list) {
        if (protocol == answer->protocol) {
            if (protocol != IPPROTO_IP)
                break;
        } else {
            if (IPPROTO_IP == protocol) {
                protocol = answer->protocol;
                break;
            }
        }
    }
    
    /* 步骤 2：设置 socket 操作函数 */
    sock->ops = answer->ops;      /* 如 inet_stream_ops */
    answer_prot = answer->prot;   /* 如 tcp_prot */
    
    rcu_read_unlock();
    
    /* 步骤 3：分配 sock 结构 */
    sk = sk_alloc(net, PF_INET, GFP_KERNEL, answer_prot, kern);
    if (!sk)
        goto out;
    
    /* 步骤 4：初始化 sock */
    inet = inet_sk(sk);
    inet->is_icsk = (INET_PROTOSW_ICSK & answer->flags) != 0;
    
    sock_init_data(sock, sk);  /* 关联 socket 和 sock */
    
    sk->sk_destruct = inet_sock_destruct;
    sk->sk_protocol = protocol;
    
    return 0;
}
```

---

## 四、协议操作函数：proto_ops 与 proto

### 4.1 两层操作函数

```
两层操作函数结构：
+===========================================================================+
|                                                                           |
|   proto_ops（socket 层操作）                                              |
|   +-------------------------------------------------------------------+   |
|   | 作用：socket 结构上的操作                                         |   |
|   | 调用者：用户空间系统调用                                          |   |
|   | 函数：bind, connect, listen, accept, sendmsg, recvmsg             |   |
|   +-------------------------------------------------------------------+   |
|           |                                                               |
|           | 调用                                                          |
|           v                                                               |
|   proto（sock 层操作）                                                    |
|   +-------------------------------------------------------------------+   |
|   | 作用：sock 结构上的操作                                           |   |
|   | 调用者：proto_ops 内部调用                                        |   |
|   | 函数：connect, sendmsg, recvmsg, bind, hash                       |   |
|   +-------------------------------------------------------------------+   |
|                                                                           |
+===========================================================================+
```

### 4.2 proto_ops 结构体

```c
/*
 * proto_ops - socket 层操作函数表
 * 定义在 include/linux/net.h
 */
struct proto_ops {
    int     family;         /* 协议族 */
    struct module *owner;   /* 所属模块 */
    
    /* 套接字操作 */
    int     (*release)(struct socket *sock);
    int     (*bind)(struct socket *sock, struct sockaddr *addr, int len);
    int     (*connect)(struct socket *sock, struct sockaddr *addr, 
                       int len, int flags);
    int     (*socketpair)(struct socket *sock1, struct socket *sock2);
    int     (*accept)(struct socket *sock, struct socket *newsock, 
                      int flags, bool kern);
    int     (*getname)(struct socket *sock, struct sockaddr *addr, int peer);
    
    /* 数据传输 */
    int     (*sendmsg)(struct socket *sock, struct msghdr *m, size_t len);
    int     (*recvmsg)(struct socket *sock, struct msghdr *m, 
                       size_t len, int flags);
    
    /* 其他操作 */
    int     (*listen)(struct socket *sock, int len);
    int     (*shutdown)(struct socket *sock, int flags);
    int     (*setsockopt)(struct socket *sock, int level, int optname,
                          sockptr_t optval, unsigned int optlen);
    int     (*getsockopt)(struct socket *sock, int level, int optname,
                          char __user *optval, int __user *optlen);
    __poll_t (*poll)(struct file *file, struct socket *sock,
                     struct poll_table_struct *wait);
    int     (*ioctl)(struct socket *sock, unsigned int cmd, unsigned long arg);
};
```

### 4.3 proto 结构体

```c
/*
 * proto - sock 层操作函数表
 * 定义在 include/net/sock.h
 */
struct proto {
    /* 连接相关 */
    int     (*connect)(struct sock *sk, struct sockaddr *uaddr, int addr_len);
    int     (*disconnect)(struct sock *sk, int flags);
    struct sock *(*accept)(struct sock *sk, int flags, int *err, bool kern);
    
    /* 数据传输 */
    int     (*sendmsg)(struct sock *sk, struct msghdr *msg, size_t len);
    int     (*recvmsg)(struct sock *sk, struct msghdr *msg, size_t len,
                       int noblock, int flags, int *addr_len);
    
    /* 套接字操作 */
    void    (*close)(struct sock *sk, long timeout);
    int     (*bind)(struct sock *sk, struct sockaddr *addr, int addr_len);
    void    (*shutdown)(struct sock *sk, int how);
    int     (*setsockopt)(struct sock *sk, int level, int optname,
                          sockptr_t optval, unsigned int optlen);
    int     (*getsockopt)(struct sock *sk, int level, int optname,
                          char __user *optval, int __user *option);
    
    /* 哈希管理 */
    int     (*hash)(struct sock *sk);
    void    (*unhash)(struct sock *sk);
    int     (*get_port)(struct sock *sk, unsigned short snum);
    
    /* 内存管理 */
    atomic_long_t *memory_allocated;
    struct percpu_counter *sockets_allocated;
    
    /* 对象缓存 */
    struct kmem_cache *slab;
    unsigned int obj_size;
    
    /* 名称 */
    char name[32];  /* 如 "TCP", "UDP" */
};
```

### 4.4 TCP 协议的 proto_ops 和 proto

```
TCP 协议的操作函数：
+===========================================================================+
|                                                                           |
|   proto_ops: inet_stream_ops                                             |
|   +-------------------------------------------------------------------+   |
|   | .family     = PF_INET                                             |   |
|   | .release    = inet_release                                        |   |
|   | .bind       = inet_bind                                           |   |
|   | .connect    = inet_stream_connect                                 |   |
|   | .accept     = inet_accept                                         |   |
|   | .sendmsg    = inet_sendmsg                                        |   |
|   | .recvmsg    = inet_recvmsg                                        |   |
|   | .listen     = inet_listen                                         |   |
|   +-------------------------------------------------------------------+   |
|                                                                           |
|   proto: tcp_prot                                                        |
|   +-------------------------------------------------------------------+   |
|   | .name       = "TCP"                                               |   |
|   | .close      = tcp_close                                           |   |
|   | .connect    = tcp_v4_connect                                      |   |
|   | .disconnect = tcp_disconnect                                      |   |
|   | .accept     = inet_csk_accept                                     |   |
|   | .sendmsg    = tcp_sendmsg                                         |   |
|   | .recvmsg    = tcp_recvmsg                                         |   |
|   | .hash       = inet_hash                                           |   |
|   +-------------------------------------------------------------------+   |
|                                                                           |
+===========================================================================+
```

---

## 五、套接字状态管理

### 5.1 socket 状态

```c
/* socket 状态 */
typedef enum {
    SS_UNCONNECTED,     /* 未连接 */
    SS_CONNECTING,      /* 正在连接 */
    SS_CONNECTED,       /* 已连接 */
    SS_DISCONNECTING    /* 正在断开 */
} socket_state;
```

### 5.2 sock 状态（TCP）

```c
/* TCP 套接字状态 */
enum {
    TCP_ESTABLISHED = 1,    /* 已建立连接 */
    TCP_SYN_SENT,           /* SYN 已发送 */
    TCP_SYN_RECV,           /* SYN 已接收 */
    TCP_FIN_WAIT1,          /* FIN 等待 1 */
    TCP_FIN_WAIT2,          /* FIN 等待 2 */
    TCP_TIME_WAIT,          /* 时间等待 */
    TCP_CLOSE,              /* 关闭 */
    TCP_CLOSE_WAIT,         /* 关闭等待 */
    TCP_LAST_ACK,           /* 最后确认 */
    TCP_LISTEN,             /* 监听 */
    TCP_CLOSING,            /* 正在关闭 */
    TCP_NEW_SYN_RECV,       /* 新 SYN 已接收 */
};
```

### 5.3 TCP 状态转换图

```
TCP 状态转换：
+===========================================================================+
|                                                                           |
|   客户端状态转换：                                                        |
|   +-------------------+                                                    |
|   | CLOSED → SYN_SENT |  connect() 发送 SYN                              |
|   | SYN_SENT → ESTABLISHED | 收到 SYN+ACK，发送 ACK                      |
|   | ESTABLISHED → FIN_WAIT1 | close() 发送 FIN                           |
|   | FIN_WAIT1 → FIN_WAIT2 | 收到 ACK                                      |
|   | FIN_WAIT2 → TIME_WAIT | 收到 FIN，发送 ACK                            |
|   | TIME_WAIT → CLOSED | 2MSL 超时                                        |
|   +-------------------+                                                    |
|                                                                           |
|   服务器状态转换：                                                        |
|   +-------------------+                                                    |
|   | CLOSED → LISTEN   |  listen()                                        |
|   | LISTEN → SYN_RECV |  收到 SYN，发送 SYN+ACK                          |
|   | SYN_RECV → ESTABLISHED | 收到 ACK                                     |
|   | ESTABLISHED → CLOSE_WAIT | 收到 FIN，发送 ACK                         |
|   | CLOSE_WAIT → LAST_ACK | close() 发送 FIN                              |
|   | LAST_ACK → CLOSED | 收到 ACK                                          |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 六、套接字缓冲区管理

### 6.1 接收和发送队列

```c
struct sock {
    /* 接收队列 */
    struct sk_buff_head sk_receive_queue;  /* 接收到的数据包队列 */
    int                 sk_rcvbuf;         /* 接收缓冲区大小 */
    atomic_t            sk_rmem_alloc;     /* 已分配的接收内存 */
    
    /* 发送队列 */
    struct sk_buff_head sk_write_queue;    /* 待发送的数据包队列 */
    int                 sk_sndbuf;         /* 发送缓冲区大小 */
    atomic_t            sk_wmem_alloc;     /* 已分配的发送内存 */
};
```

### 6.2 缓冲区工作原理

```
发送和接收缓冲区：
+===========================================================================+
|                                                                           |
|   发送过程：                                                              |
|   +-------------------+                                                    |
|   | 应用调用 send()  |                                                    |
|   |      ↓           |                                                    |
|   | 数据复制到内核   |                                                    |
|   |      ↓           |                                                    |
|   | 加入 sk_write_queue |                                                 |
|   |      ↓           |                                                    |
|   | 协议栈处理       |  TCP 分段、IP 分片                               |
|   |      ↓           |                                                    |
|   | 发送到网络设备   |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   接收过程：                                                              |
|   +-------------------+                                                    |
|   | 网络设备接收     |                                                    |
|   |      ↓           |                                                    |
|   | 协议栈处理       |  IP 重组、TCP 重组                               |
|   |      ↓           |                                                    |
|   | 加入 sk_receive_queue |                                                |
|   |      ↓           |                                                    |
|   | 应用调用 recv()  |                                                    |
|   |      ↓           |                                                    |
|   | 数据复制到用户空间 |                                                  |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 6.3 缓冲区大小控制

```
缓冲区大小参数：
+===========================================================================+
|                                                                           |
|   /proc/sys/net/ipv4/tcp_rmem (接收缓冲区)                               |
|   +-------------------+                                                    |
|   | 第一个值：最小值  |  默认 4096 字节                                  |
|   | 第二个值：默认值  |  默认 131072 字节 (128KB)                        |
|   | 第三个值：最大值  |  默认 6291456 字节 (6MB)                         |
|   +-------------------+                                                    |
|                                                                           |
|   /proc/sys/net/ipv4/tcp_wmem (发送缓冲区)                               |
|   +-------------------+                                                    |
|   | 第一个值：最小值  |  默认 4096 字节                                  |
|   | 第二个值：默认值  |  默认 16384 字节 (16KB)                          |
|   | 第三个值：最大值  |  默认 4194304 字节 (4MB)                         |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 七、套接字回调机制

### 7.1 回调函数

```c
struct sock {
    /* 状态变化回调 */
    void (*sk_state_change)(struct sock *sk);
    /* 数据就绪回调 */
    void (*sk_data_ready)(struct sock *sk);
    /* 写空间可用回调 */
    void (*sk_write_space)(struct sock *sk);
    /* 错误报告回调 */
    void (*sk_error_report)(struct sock *sk);
};
```

### 7.2 回调函数的使用场景

```
回调函数触发场景：
+===========================================================================+
|                                                                           |
|   sk_state_change：                                                       |
|   +-------------------+                                                    |
|   | TCP 连接建立完成 |  ESTABLISHED 状态                                |
|   | TCP 连接关闭     |  CLOSE 状态                                      |
|   | TCP 连接出错     |  错误状态                                        |
|   +-------------------+                                                    |
|                                                                           |
|   sk_data_ready：                                                         |
|   +-------------------+                                                    |
|   | 接收到新数据     |  数据加入接收队列                                |
|   | 有紧急数据       |  OOB 数据                                        |
|   +-------------------+                                                    |
|                                                                           |
|   sk_write_space：                                                        |
|   +-------------------+                                                    |
|   | 发送缓冲区有空间 |  可以发送更多数据                                |
|   +-------------------+                                                    |
|                                                                           |
|   sk_error_report：                                                       |
|   +-------------------+                                                    |
|   | 连接错误         |  ICMP 不可达等                                   |
|   | 连接重置         |  RST 包                                          |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 7.3 等待队列

```c
/*
 * socket_wq - 套接字等待队列
 */
struct socket_wq {
    wait_queue_head_t wait;        /* 等待队列头 */
    struct fasync_struct *fasync_list;  /* 异步通知列表 */
    unsigned long flags;           /* 标志 */
};
```

---

## 八、套接字与文件系统

### 8.1 套接字文件操作

```c
/*
 * socket_file_ops - 套接字文件操作
 * 定义在 net/socket.c
 */
static const struct file_operations socket_file_ops = {
    .owner      = THIS_MODULE,
    .llseek     = no_llseek,
    .read_iter  = sock_read_iter,
    .write_iter = sock_write_iter,
    .poll       = sock_poll,
    .unlocked_ioctl = sock_ioctl,
    .mmap       = sock_mmap,
    .release    = sock_close,
    .fasync     = sock_fasync,
};
```

### 8.2 套接字与文件描述符

```
套接字与文件描述符的关系：
+===========================================================================+
|                                                                           |
|   应用程序：                                                              |
|   +-------------------+                                                    |
|   | int fd = socket(...) |  返回文件描述符                              |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   文件描述符表：                                                           |
|   +-------------------+                                                    |
|   | fd → file 结构    |  进程的文件描述符表                              |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   file 结构：                                                              |
|   +-------------------+                                                    |
|   | f_op = socket_file_ops |  文件操作函数                               |
|   | private_data = socket  |  指向 socket 结构                           |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   socket 结构：                                                            |
|   +-------------------+                                                    |
|   | file → file 结构  |  双向关联                                        |
|   | sk → sock 结构    |  内部表示                                        |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 九、协议族注册

### 9.1 net_proto_family 结构

```c
/*
 * net_proto_family - 协议族注册结构
 */
struct net_proto_family {
    int     family;         /* 协议族号 */
    int     (*create)(struct net *net, struct socket *sock,
                      int protocol, int kern);
    struct module *owner;
};
```

### 9.2 协议族注册表

```
协议族注册表：
+===========================================================================+
|                                                                           |
|   net_families[] 数组：                                                   |
|   +-------------------+-------------------+                                |
|   | 索引 (family)    | 注册的结构        |                                |
|   +-------------------+-------------------+                                |
|   | AF_INET (2)      | inet_family_ops   |  TCP/IP 协议族                |
|   | AF_UNIX (1)      | unix_family_ops   |  Unix 域套接字                |
|   | AF_NETLINK (16)  | netlink_family_ops|  Netlink 套接字               |
|   | AF_PACKET (17)   | packet_family_ops |  原始套接字                   |
|   | AF_INET6 (10)    | inet6_family_ops  |  IPv6 协议族                  |
|   +-------------------+-------------------+                                |
|                                                                           |
+===========================================================================+
```

### 9.3 AF_INET 协议族注册

```c
/*
 * AF_INET 协议族注册
 */
static const struct net_proto_family inet_family_ops = {
    .family = PF_INET,
    .create = inet_create,
    .owner  = THIS_MODULE,
};

/* 注册 */
static int __init inet_init(void)
{
    /* ... */
    sock_register(&inet_family_ops);
    /* ... */
}
```

---

## 十、总结

### 10.1 套接字模块核心概念

```
套接字模块核心概念：
+===========================================================================+
|                                                                           |
|   1. 两层结构                                                             |
|   +-------------------+                                                    |
|   | socket：用户接口  |  文件描述符、状态、操作函数                      |
|   | sock：内核实现    |  协议状态、缓冲区、回调                          |
|   +-------------------+                                                    |
|                                                                           |
|   2. 两层操作函数                                                         |
|   +-------------------+                                                    |
|   | proto_ops：socket 层 |  bind, connect, sendmsg, recvmsg             |
|   | proto：sock 层       |  具体协议实现                                |
|   +-------------------+                                                    |
|                                                                           |
|   3. 协议族机制                                                           |
|   +-------------------+                                                    |
|   | net_proto_family |  协议族注册和创建                                |
|   | inet_create      |  AF_INET 的具体实现                             |
|   +-------------------+                                                    |
|                                                                           |
|   4. 文件系统集成                                                         |
|   +-------------------+                                                    |
|   | socket 也是文件  |  通过文件描述符访问                              |
|   | socket_file_ops  |  文件操作函数                                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 10.2 关键数据结构关系

```
数据结构关系图：
+===========================================================================+
|                                                                           |
|   用户空间                                                                |
|       |                                                                   |
|       v                                                                   |
|   文件描述符 (fd)                                                         |
|       |                                                                   |
|       v                                                                   |
|   +-------------------+                                                    |
|   | struct file      |  文件结构                                         |
|   | .private_data    |──────────────────────┐                            |
|   +-------------------+                      │                            |
|                                              v                            |
|   +-------------------+                +-------------------+               |
|   | struct socket    |◄───────────────| sockfs inode      |               |
|   | .state           |                +-------------------+               |
|   | .type            |                                                    |
|   | .ops ────────────┼──────► proto_ops (inet_stream_ops)                 |
|   | .sk ─────────────┼──────┐                                             |
|   +-------------------+      │                                             |
|                              v                                             |
|   +-------------------+                                                    |
|   | struct sock      |  内核套接字表示                                   |
|   | .sk_state        |  TCP 状态                                         |
|   | .sk_prot ────────┼──────► proto (tcp_prot)                           |
|   | .sk_receive_queue|  接收队列                                         |
|   | .sk_write_queue  |  发送队列                                         |
|   | .sk_socket ──────┼──────► 指回 socket                                |
|   +-------------------+                                                    |
|                              │                                             |
|                              v                                             |
|   +-------------------+                                                    |
|   | struct inet_sock |  TCP/IP 特定信息                                  |
|   | .inet_daddr      |  目的 IP                                          |
|   | .inet_dport      |  目的端口                                         |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 10.3 套接字模块的作用

1. **统一接口**：为应用程序提供统一的网络编程接口
2. **协议抽象**：隐藏底层协议细节，支持多种协议族
3. **资源管理**：管理缓冲区、文件描述符等资源
4. **状态管理**：维护连接状态，实现状态机
5. **事件通知**：通过回调机制通知应用程序事件

套接字模块是 Linux 网络协议栈的核心，它连接了用户空间应用程序和内核协议栈，实现了网络通信的抽象和封装。
