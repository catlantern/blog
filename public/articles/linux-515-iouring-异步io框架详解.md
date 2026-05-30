# Linux 5.15 io_uring 异步I/O框架详解

## 一、为什么需要io_uring？

### 1.1 传统I/O模型的困境

在深入理解io_uring之前，我们需要先了解传统I/O模型存在的问题。Linux系统中，I/O是程序与磁盘、网络等外部设备进行数据交互的核心方式。随着技术发展与应用场景日趋复杂，传统I/O模型在高并发、高性能场景下暴露出了诸多瓶颈。

#### 1.1.1 阻塞式I/O的局限

阻塞式I/O是最基础的I/O模型，当用户进程调用read/recvfrom等系统调用时，进程会被挂起直到数据到达。这就像去餐厅点菜后只能坐在座位上干等，什么也做不了。一个进程在阻塞期间无法处理其他I/O流，在高并发场景下完全无法满足需求。

#### 1.1.2 非阻塞式I/O的开销

非阻塞式I/O虽然不会阻塞进程，但需要不断轮询检查数据是否就绪，持续消耗CPU资源。描述符数量越多，CPU开销越大。这就像点完外卖后每隔几分钟就去问"我的菜好了吗？"，大部分时候得到的回答都是"还没好"。

#### 1.1.3 I/O多路复用的不足

I/O多路复用（select/poll/epoll）虽然解决了轮询问题，但仍存在以下缺陷：

1. **系统调用开销大**：每次I/O操作都需要多次系统调用。以网络通信为例，需要先调用epoll_wait()等待事件，然后调用accept()接受连接，再调用read()/write()进行数据读写。每次系统调用都伴随着用户态与内核态之间的上下文切换。

2. **数据拷贝次数多**：传统I/O在数据传输过程中，数据需要在用户空间和内核空间之间多次拷贝。从磁盘读取数据时，数据先从磁盘复制到内核缓冲区，再从内核缓冲区复制到用户缓冲区。

3. **异步处理能力有限**：epoll本质上是一种事件通知机制，当事件就绪后仍需应用程序主动进行I/O操作，无法充分发挥硬件性能。

### 1.2 io_uring的设计目标

io_uring是Linux内核在5.1版本引入的高性能异步I/O框架，由Jens Axboe开发，旨在解决传统异步I/O模型在大规模I/O操作中效率不高的问题。其设计目标包括：

1. **减少系统调用开销**：通过共享内存环形队列，用户态和内核态可以直接进行数据交互，减少系统调用次数。

2. **避免数据拷贝**：通过内存映射机制，用户态和内核态共享提交队列（SQ）和完成队列（CQ），避免不必要的数据拷贝。

3. **实现真正的异步I/O**：应用程序提交I/O请求后可以立即返回，内核在后台完成I/O操作后通过完成队列通知应用程序。

---

## 二、io_uring核心设计原理

### 2.1 共享环形队列机制

io_uring的核心创新在于使用共享内存构建的环形队列机制。这种设计打破了传统I/O模型中用户态与内核态通信需要多次数据拷贝的困境。

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户空间                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    提交队列 (SQ)                         │    │
│  │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐      │    │
│  │  │ SQE │ SQE │ SQE │ SQE │ SQE │ SQE │ SQE │ SQE │      │    │
│  │  │  0  │  1  │  2  │  3  │  4  │  5  │  6  │  7  │      │    │
│  │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘      │    │
│  │         ↑ tail (用户写)         ↑ head (内核读)         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↓ 提交请求                          │
├─────────────────────────────────────────────────────────────────┤
│                        内核空间                                   │
│                              ↓ 处理请求                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    完成队列 (CQ)                         │    │
│  │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐      │    │
│  │  │ CQE │ CQE │ CQE │ CQE │ CQE │ CQE │ CQE │ CQE │      │    │
│  │  │  0  │  1  │  2  │  3  │  4  │  5  │  6  │  7  │      │    │
│  │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘      │    │
│  │         ↑ head (用户读)         ↑ tail (内核写)         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↑ 返回结果                          │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计要点：**

1. **SQ（提交队列）**：用户是生产者，内核是消费者。用户通过操作tail指针写入新请求，内核通过head指针读取请求。

2. **CQ（完成队列）**：内核是生产者，用户是消费者。内核通过tail指针写入完成结果，用户通过head指针读取结果。

3. **零拷贝通信**：SQ和CQ通过mmap映射到用户空间，用户态和内核态可以直接访问，无需数据拷贝。

### 2.2 批量处理能力

io_uring支持单次系统调用提交多个I/O请求，并一次性收割多个完成事件，这一特性极大地减少了上下文切换的开销。

```
传统I/O模型：
  应用程序 → read() → 内核 → 返回 → 应用程序
  应用程序 → read() → 内核 → 返回 → 应用程序
  应用程序 → read() → 内核 → 返回 → 应用程序
  （每个请求都需要一次系统调用）

io_uring模型：
  应用程序 → [SQE1, SQE2, SQE3] → io_uring_enter() → 内核批量处理
  内核 → [CQE1, CQE2, CQE3] → 应用程序批量收割
  （多个请求只需一次系统调用）
```

---

## 三、核心数据结构

### 3.1 提交队列项（SQE）

SQE（Submission Queue Entry）是描述I/O请求的核心结构体，大小固定为64字节。

```c
/*
 * io_uring_sqe - 提交队列项
 * 定义在 include/uapi/linux/io_uring.h
 */
struct io_uring_sqe {
    __u8    opcode;         /* 操作类型：IORING_OP_READ, IORING_OP_WRITE 等 */
    __u8    flags;          /* IOSQE_ 标志 */
    __u16   ioprio;         /* I/O 优先级 */
    __s32   fd;             /* 文件描述符 */
    
    union {
        __u64   off;        /* 文件偏移量 */
        __u64   addr2;      /* 第二个地址 */
    };
    
    union {
        __u64   addr;       /* 缓冲区地址或 iovec 指针 */
        __u64   splice_off_in;
    };
    
    __u32   len;            /* 缓冲区大小或 iovec 数量 */
    
    union {
        __u32   rw_flags;       /* 读写标志 */
        __u32   fsync_flags;    /* fsync 标志 */
        __u32   poll_events;    /* poll 事件 */
        __u32   msg_flags;      /* sendmsg/recvmsg 标志 */
        __u32   timeout_flags;  /* timeout 标志 */
        __u32   accept_flags;   /* accept 标志 */
        __u32   open_flags;     /* open 标志 */
        __u32   statx_flags;    /* statx 标志 */
    };
    
    __u64   user_data;      /* 用户自定义数据，完成后原样返回 */
    
    union {
        __u16   buf_index;  /* 固定缓冲区索引 */
        __u16   buf_group;  /* 缓冲区组 */
    } __attribute__((packed));
    
    __u16   personality;    /* 凭证 ID */
    
    union {
        __s32   splice_fd_in;
        __u32   file_index;
    };
    
    __u64   __pad2[2];
};
```

**关键字段说明：**

| 字段 | 说明 |
|------|------|
| opcode | 操作类型，如IORING_OP_READ、IORING_OP_WRITE、IORING_OP_ACCEPT等 |
| fd | 文件描述符，指定操作的目标 |
| off | 文件偏移量 |
| addr | 缓冲区地址 |
| len | 数据长度 |
| user_data | 用户自定义数据，用于关联请求和完成结果 |

**支持的操作类型（opcode）：**

```c
/*
 * io_uring 支持的操作类型
 * 定义在 include/uapi/linux/io_uring.h
 */
enum {
    IORING_OP_NOP,              /* 空操作 */
    IORING_OP_READV,            /* 向量读 */
    IORING_OP_WRITEV,           /* 向量写 */
    IORING_OP_FSYNC,            /* 文件同步 */
    IORING_OP_READ_FIXED,       /* 固定缓冲区读 */
    IORING_OP_WRITE_FIXED,      /* 固定缓冲区写 */
    IORING_OP_POLL_ADD,         /* 添加轮询 */
    IORING_OP_POLL_REMOVE,      /* 移除轮询 */
    IORING_OP_SYNC_FILE_RANGE,  /* 文件范围同步 */
    IORING_OP_SENDMSG,          /* 发送消息 */
    IORING_OP_RECVMSG,          /* 接收消息 */
    IORING_OP_TIMEOUT,          /* 超时 */
    IORING_OP_TIMEOUT_REMOVE,   /* 移除超时 */
    IORING_OP_ACCEPT,           /* 接受连接 */
    IORING_OP_ASYNC_CANCEL,     /* 异步取消 */
    IORING_OP_LINK_TIMEOUT,     /* 链接超时 */
    IORING_OP_CONNECT,          /* 连接 */
    IORING_OP_FALLOCATE,        /* 预分配空间 */
    IORING_OP_OPENAT,           /* 打开文件 */
    IORING_OP_CLOSE,            /* 关闭文件 */
    IORING_OP_FILES_UPDATE,     /* 更新文件集 */
    IORING_OP_STATX,            /* 获取文件状态 */
    IORING_OP_READ,             /* 读取 */
    IORING_OP_WRITE,            /* 写入 */
    IORING_OP_FADVISE,          /* 文件访问建议 */
    IORING_OP_MADVISE,          /* 内存访问建议 */
    IORING_OP_SEND,             /* 发送 */
    IORING_OP_RECV,             /* 接收 */
    IORING_OP_OPENAT2,          /* 打开文件（扩展） */
    IORING_OP_EPOLL_CTL,        /* epoll 控制 */
    IORING_OP_SPLICE,           /* 数据拼接 */
    IORING_OP_PROVIDE_BUFFERS,  /* 提供缓冲区 */
    IORING_OP_REMOVE_BUFFERS,   /* 移除缓冲区 */
    IORING_OP_TEE,              /* 数据复制 */
    IORING_OP_SHUTDOWN,         /* 关闭连接 */
    IORING_OP_RENAMEAT,         /* 重命名 */
    IORING_OP_UNLINKAT,         /* 删除文件 */
    IORING_OP_MKDIRAT,          /* 创建目录 */
    IORING_OP_SYMLINKAT,        /* 创建符号链接 */
    IORING_OP_LINKAT,           /* 创建硬链接 */
};
```

### 3.2 完成队列项（CQE）

CQE（Completion Queue Entry）是描述I/O完成结果的核心结构体。

```c
/*
 * io_uring_cqe - 完成队列项
 * 定义在 include/uapi/linux/io_uring.h
 */
struct io_uring_cqe {
    __u64   user_data;      /* 与 SQE 中设置的一致 */
    __s32   res;            /* 返回值：成功时为字节数，失败时为 -errno */
    __u32   flags;          /* 完成标志 */
};
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| user_data | 与提交时SQE中的user_data一致，用于关联请求和结果 |
| res | 操作结果，成功时为实际传输的字节数，失败时为负的错误码 |
| flags | 完成标志，如IORING_CQE_F_BUFFER表示使用了提供的缓冲区 |

### 3.3 io_rings 结构体

io_rings是共享环形队列的核心结构体，包含了SQ和CQ的元数据。

```c
/*
 * io_rings - 共享环形队列结构
 * 定义在 io_uring/io_uring.c
 * 
 * 这个结构体通过 mmap 映射到用户空间
 * 用户态和内核态共享这段内存
 */
struct io_rings {
    /*
     * SQ 和 CQ 的头尾指针
     * 内核控制 SQ 的 head 和 CQ 的 tail
     * 应用程序控制 SQ 的 tail 和 CQ 的 head
     */
    struct io_uring     sq, cq;
    
    /*
     * 环形队列掩码（等于 ring_entries - 1）
     * 用于快速计算索引：index = offset & ring_mask
     */
    u32                 sq_ring_mask, cq_ring_mask;
    
    /* 环形队列大小（2的幂次方） */
    u32                 sq_ring_entries, cq_ring_entries;
    
    /*
     * 被内核丢弃的无效条目数
     * 由内核写入，应用程序不应修改
     */
    u32                 sq_dropped;
    
    /*
     * SQ 运行时标志
     * IORING_SQ_NEED_WAKEUP: 需要唤醒 SQ 线程
     * IORING_SQ_CQ_OVERFLOW: CQ 溢出
     */
    u32                 sq_flags;
    
    /* CQ 运行时标志 */
    u32                 cq_flags;
    
    /*
     * 因 CQ 满而丢失的完成事件数
     * 应用程序应确保 CQ 有足够空间避免溢出
     */
    u32                 cq_overflow;
    
    /*
     * 完成队列条目数组
     * 内核每次产生完成事件时写入
     */
    struct io_uring_cqe cqes[] ____cacheline_aligned_in_smp;
};

/*
 * io_uring - 简单的头尾指针结构
 */
struct io_uring {
    u32 head ____cacheline_aligned_in_smp;
    u32 tail ____cacheline_aligned_in_smp;
};
```

### 3.4 io_ring_ctx 结构体

io_ring_ctx是io_uring实例的核心上下文结构体，包含了所有状态信息。

```c
/*
 * io_ring_ctx - io_uring 实例上下文
 * 定义在 io_uring/io_uring.c
 * 
 * 这是内核中 io_uring 实例的核心数据结构
 * 包含了 SQ、CQ、文件表、缓冲区等所有状态
 */
struct io_ring_ctx {
    /* 常量或只读的热数据 */
    struct {
        struct percpu_ref   refs;           /* 引用计数 */
        struct io_rings     *rings;         /* 共享环形队列 */
        unsigned int        flags;          /* 设置标志 */
        unsigned int        compat: 1;      /* 兼容模式 */
        unsigned int        drain_next: 1;  /* 排空下一个 */
        unsigned int        eventfd_async: 1;
        unsigned int        restricted: 1;
        unsigned int        off_timeout_used: 1;
        unsigned int        drain_active: 1;
    } ____cacheline_aligned_in_smp;

    /* 提交相关数据 */
    struct {
        struct mutex        uring_lock;     /* 核心锁 */
        
        u32                 *sq_array;      /* SQ 索引数组 */
        struct io_uring_sqe *sq_sqes;       /* SQE 数组 */
        unsigned            cached_sq_head; /* 缓存的 SQ head */
        unsigned            sq_entries;     /* SQ 条目数 */
        struct list_head    defer_list;     /* 延迟列表 */
        
        /* 固定资源 */
        struct io_rsrc_node *rsrc_node;
        struct io_file_table file_table;    /* 固定文件表 */
        unsigned            nr_user_files;  /* 用户文件数 */
        unsigned            nr_user_bufs;   /* 用户缓冲区数 */
        struct io_mapped_ubuf **user_bufs;  /* 用户缓冲区 */
        
        struct io_submit_state submit_state;/* 提交状态 */
        struct list_head    timeout_list;   /* 超时列表 */
        struct list_head    cq_overflow_list;/* CQ 溢出列表 */
        struct xarray       io_buffers;     /* IO 缓冲区 */
        struct xarray       personalities;  /* 凭证 */
        u32                 pers_next;
        unsigned            sq_thread_idle; /* SQ 线程空闲时间 */
    } ____cacheline_aligned_in_smp;

    /* IRQ 完成列表 */
    struct list_head    locked_free_list;
    unsigned int        locked_free_nr;

    const struct cred   *sq_creds;          /* SQ 线程凭证 */
    struct io_sq_data   *sq_data;           /* SQ 轮询线程数据 */

    struct wait_queue_head sqo_sq_wait;
    struct list_head    sqd_list;

    unsigned long       check_cq_overflow;

    /* 完成相关数据 */
    struct {
        unsigned        cached_cq_tail;     /* 缓存的 CQ tail */
        unsigned        cq_entries;         /* CQ 条目数 */
        struct eventfd_ctx *cq_ev_fd;       /* eventfd */
        struct wait_queue_head poll_wait;   /* 轮询等待队列 */
        struct wait_queue_head cq_wait;     /* CQ 等待队列 */
        unsigned        cq_extra;
        atomic_t        cq_timeouts;
        unsigned        cq_last_tm_flush;
    } ____cacheline_aligned_in_smp;

    /* 完成锁保护的数据 */
    struct {
        spinlock_t      completion_lock;
        spinlock_t      timeout_lock;
        struct list_head iopoll_list;       /* IOPOLL 列表 */
        struct hlist_head *cancel_hash;     /* 取消哈希表 */
        unsigned        cancel_hash_bits;
        bool            poll_multi_queue;
    } ____cacheline_aligned_in_smp;

    struct io_restriction restrictions;      /* 限制配置 */
    
    /* 慢路径资源数据 */
    struct {
        struct io_rsrc_node *rsrc_backup_node;
        struct io_mapped_ubuf *dummy_ubuf;
        struct io_rsrc_data *file_data;
        struct io_rsrc_data *buf_data;
        struct delayed_work rsrc_put_work;
        struct llist_head rsrc_put_llist;
        struct list_head rsrc_ref_list;
        spinlock_t rsrc_ref_lock;
    };

    /* 最后部分，非快速路径 */
    struct {
        struct io_wq_hash *hash_map;
        struct user_struct *user;
        struct mm_struct *mm_account;
        struct llist_head fallback_llist;
        struct delayed_work fallback_work;
        struct work_struct exit_work;
        struct list_head tctx_list;
        struct completion ref_comp;
        u32 iowq_limits[2];
        bool iowq_limits_set;
    };
};
```

### 3.5 io_kiocb 结构体

io_kiocb是内核中表示一个I/O请求的结构体，类似于传统的kiocb。

```c
/*
 * io_kiocb - 内核 I/O 请求结构
 * 定义在 io_uring/io_uring.c
 * 
 * 每个提交的 SQE 都会对应一个 io_kiocb
 * 包含了请求的所有状态信息
 */
struct io_kiocb {
    union {
        struct file      *file;            /* 文件指针 */
        struct io_rw     rw;               /* 读写操作数据 */
        struct io_poll_iocb poll;          /* 轮询操作数据 */
        struct io_poll_update poll_update; /* 轮询更新数据 */
        struct io_accept accept;           /* accept 操作数据 */
        struct io_sync   sync;             /* 同步操作数据 */
        struct io_cancel cancel;           /* 取消操作数据 */
        struct io_timeout timeout;         /* 超时操作数据 */
        struct io_timeout_rem timeout_rem; /* 超时移除数据 */
        struct io_connect connect;         /* 连接操作数据 */
        struct io_sr_msg sr_msg;           /* 消息发送接收数据 */
        struct io_open   open;             /* 打开操作数据 */
        struct io_close  close;            /* 关闭操作数据 */
        struct io_rsrc_update rsrc_update; /* 资源更新数据 */
        struct io_fadvise fadvise;         /* fadvise 数据 */
        struct io_madvise madvise;         /* madvise 数据 */
        struct io_epoll  epoll;            /* epoll 数据 */
        struct io_splice splice;           /* splice 数据 */
        struct io_provide_buf pbuf;        /* 提供缓冲区数据 */
        struct io_statx  statx;            /* statx 数据 */
        struct io_shutdown shutdown;       /* shutdown 数据 */
        struct io_rename rename;           /* 重命名数据 */
        struct io_unlink unlink;           /* 删除数据 */
        struct io_mkdir  mkdir;            /* 创建目录数据 */
        struct io_symlink symlink;         /* 符号链接数据 */
        struct io_hardlink hardlink;       /* 硬链接数据 */
        struct io_completion compl;        /* 完成回调数据 */
    };

    void                *async_data;       /* 异步数据 */
    u8                  opcode;            /* 操作码 */
    u8                  iopoll_completed;  /* IOPOLL 完成标志 */
    
    u16                 buf_index;         /* 缓冲区索引 */
    u32                 result;            /* 结果 */

    struct io_ring_ctx  *ctx;              /* 所属上下文 */
    unsigned int        flags;             /* 请求标志 */
    atomic_t            refs;              /* 引用计数 */
    struct task_struct  *task;             /* 所属任务 */
    u64                 user_data;         /* 用户数据 */

    struct io_kiocb     *link;             /* 链接的下一个请求 */
    struct percpu_ref   *fixed_rsrc_refs;  /* 固定资源引用 */

    struct list_head    inflight_entry;    /* 飞行列表条目 */
    struct io_task_work io_task_work;      /* 任务工作 */
    struct hlist_node   hash_node;         /* 哈希节点 */
    struct async_poll   *apoll;            /* 异步轮询 */
    struct io_wq_work   work;              /* 工作队列工作 */
    const struct cred   *creds;            /* 凭证 */
    struct io_mapped_ubuf *imu;            /* 映射的用户缓冲区 */
    struct io_buffer    *kbuf;             /* 选中的缓冲区 */
    atomic_t            poll_refs;         /* 轮询引用 */
};
```

---

## 四、系统调用详解

io_uring提供了三个核心系统调用：

### 4.1 io_uring_setup

```c
/*
 * io_uring_setup - 创建并初始化 io_uring 实例
 * 定义在 io_uring/io_uring.c
 * 
 * 参数：
 *   entries - SQ 和 CQ 的大小（建议为 2 的幂次方）
 *   params  - 配置参数，同时返回内核填充的信息
 * 
 * 返回值：
 *   成功：文件描述符
 *   失败：负的错误码
 */
SYSCALL_DEFINE2(io_uring_setup, u32, entries,
        struct io_uring_params __user *, params)
{
    return io_uring_setup(entries, params);
}

static long io_uring_setup(u32 entries, struct io_uring_params __user *params)
{
    struct io_uring_params p;
    int i;

    /* 从用户空间复制参数 */
    if (copy_from_user(&p, params, sizeof(p)))
        return -EFAULT;
    
    /* 检查保留字段是否为 0 */
    for (i = 0; i < ARRAY_SIZE(p.resv); i++) {
        if (p.resv[i])
            return -EINVAL;
    }

    /* 检查标志有效性 */
    if (p.flags & ~(IORING_SETUP_IOPOLL | IORING_SETUP_SQPOLL |
            IORING_SETUP_SQ_AFF | IORING_SETUP_CQSIZE |
            IORING_SETUP_CLAMP | IORING_SETUP_ATTACH_WQ |
            IORING_SETUP_R_DISABLED))
        return -EINVAL;

    return io_uring_create(entries, &p, params);
}
```

**io_uring_params 结构体：**

```c
/*
 * io_uring_params - io_uring 配置参数
 * 定义在 include/uapi/linux/io_uring.h
 */
struct io_uring_params {
    __u32 sq_entries;           /* SQ 条目数（内核填充） */
    __u32 cq_entries;           /* CQ 条目数（内核填充） */
    __u32 flags;                /* 设置标志 */
    __u32 sq_thread_cpu;        /* SQ 线程绑定的 CPU */
    __u32 sq_thread_idle;       /* SQ 线程空闲超时（毫秒） */
    __u32 features;             /* 支持的特性（内核填充） */
    __u32 wq_fd;                /* 工作队列文件描述符 */
    __u32 resv[3];              /* 保留 */
    struct io_sqring_offsets sq_off;  /* SQ 偏移量 */
    struct io_cqring_offsets cq_off;  /* CQ 偏移量 */
};
```

**设置标志（flags）：**

| 标志 | 说明 |
|------|------|
| IORING_SETUP_IOPOLL | 启用 I/O 轮询模式，适用于 NVMe 等高速设备 |
| IORING_SETUP_SQPOLL | 启用 SQ 轮询线程，内核线程持续轮询 SQ |
| IORING_SETUP_SQ_AFF | sq_thread_cpu 有效，绑定 SQ 线程到指定 CPU |
| IORING_SETUP_CQSIZE | 使用 params.cq_entries 作为 CQ 大小 |
| IORING_SETUP_CLAMP | 限制 SQ/CQ 大小不超过最大值 |
| IORING_SETUP_ATTACH_WQ | 附加到已存在的工作队列 |
| IORING_SETUP_R_DISABLED | 创建时禁用 ring，需要显式启用 |

**io_uring_create 核心实现：**

```c
/*
 * io_uring_create - 创建 io_uring 实例
 * 定义在 io_uring/io_uring.c
 */
static int io_uring_create(unsigned entries, struct io_uring_params *p,
               struct io_uring_params __user *params)
{
    struct io_ring_ctx *ctx;
    struct file *file;
    int ret;

    if (!entries)
        return -EINVAL;
    if (entries > IORING_MAX_ENTRIES) {
        if (!(p->flags & IORING_SETUP_CLAMP))
            return -EINVAL;
        entries = IORING_MAX_ENTRIES;
    }

    /*
     * CQ 大小默认为 SQ 的两倍
     * 因为 SQE 只在提交时使用，而 CQE 需要保留直到应用程序消费
     */
    p->sq_entries = roundup_pow_of_two(entries);
    if (p->flags & IORING_SETUP_CQSIZE) {
        if (!p->cq_entries)
            return -EINVAL;
        if (p->cq_entries > IORING_MAX_CQ_ENTRIES) {
            if (!(p->flags & IORING_SETUP_CLAMP))
                return -EINVAL;
            p->cq_entries = IORING_MAX_CQ_ENTRIES;
        }
        p->cq_entries = roundup_pow_of_two(p->cq_entries);
        if (p->cq_entries < p->sq_entries)
            return -EINVAL;
    } else {
        p->cq_entries = 2 * p->sq_entries;
    }

    /* 分配上下文 */
    ctx = io_ring_ctx_alloc(p);
    if (!ctx)
        return -ENOMEM;
    ctx->compat = in_compat_syscall();
    if (!ns_capable_noaudit(&init_user_ns, CAP_IPC_LOCK))
        ctx->user = get_uid(current_user());

    /* 保存 mm 用于内存统计 */
    mmgrab(current->mm);
    ctx->mm_account = current->mm;

    /* 分配 SQ 和 CQ */
    ret = io_allocate_scq_urings(ctx, p);
    if (ret)
        goto err;

    /* 创建 SQ 卸载线程（如果启用 SQPOLL） */
    ret = io_sq_offload_create(ctx, p);
    if (ret)
        goto err;

    /* 初始化资源节点 */
    ret = io_rsrc_node_switch_start(ctx);
    if (ret)
        goto err;
    io_rsrc_node_switch(ctx, NULL);

    /* 填充偏移量信息，供用户空间 mmap 使用 */
    memset(&p->sq_off, 0, sizeof(p->sq_off));
    p->sq_off.head = offsetof(struct io_rings, sq.head);
    p->sq_off.tail = offsetof(struct io_rings, sq.tail);
    p->sq_off.ring_mask = offsetof(struct io_rings, sq_ring_mask);
    p->sq_off.ring_entries = offsetof(struct io_rings, sq_ring_entries);
    p->sq_off.flags = offsetof(struct io_rings, sq_flags);
    p->sq_off.dropped = offsetof(struct io_rings, sq_dropped);
    p->sq_off.array = (char *)ctx->sq_array - (char *)ctx->rings;

    memset(&p->cq_off, 0, sizeof(p->cq_off));
    p->cq_off.head = offsetof(struct io_rings, cq.head);
    p->cq_off.tail = offsetof(struct io_rings, cq.tail);
    p->cq_off.ring_mask = offsetof(struct io_rings, cq_ring_mask);
    p->cq_off.ring_entries = offsetof(struct io_rings, cq_ring_entries);
    p->cq_off.overflow = offsetof(struct io_rings, cq_overflow);
    p->cq_off.cqes = offsetof(struct io_rings, cqes);

    /* 填充特性标志 */
    p->features = IORING_FEAT_SINGLE_MMAP | IORING_FEAT_NODROP |
              IORING_FEAT_SUBMIT_STABLE | IORING_FEAT_RW_CUR_POS |
              IORING_FEAT_CUR_PERSONALITY | IORING_FEAT_FAST_POLL |
              IORING_FEAT_POLL_32BITS | IORING_FEAT_SQPOLL_NONFIXED |
              IORING_FEAT_EXT_ARG | IORING_FEAT_NATIVE_WORKERS |
              IORING_FEAT_RSRC_TAGS;

    /* 复制参数回用户空间 */
    if (copy_to_user(params, p, sizeof(*p))) {
        ret = -EFAULT;
        goto err;
    }

    /* 创建匿名 inode 和文件描述符 */
    file = io_uring_get_file(ctx);
    if (IS_ERR(file)) {
        ret = PTR_ERR(file);
        goto err;
    }

    ret = get_unused_fd_flags(O_RDWR | O_CLOEXEC);
    if (ret < 0) {
        fput(file);
        goto err;
    }
    
    fd_install(ret, file);
    return ret;

err:
    io_ring_ctx_wait_and_kill(ctx);
    return ret;
}
```

### 4.2 io_uring_enter

```c
/*
 * io_uring_enter - 提交 I/O 请求并等待完成
 * 定义在 io_uring/io_uring.c
 * 
 * 参数：
 *   fd          - io_uring 实例的文件描述符
 *   to_submit   - 要提交的 SQE 数量
 *   min_complete - 最少等待完成的 CQE 数量
 *   flags       - 操作标志
 *   argp        - 扩展参数（sigset 或 timespec）
 *   argsz       - 参数大小
 * 
 * 返回值：
 *   成功：提交的请求数量
 *   失败：负的错误码
 */
SYSCALL_DEFINE6(io_uring_enter, unsigned int, fd, u32, to_submit,
        u32, min_complete, u32, flags, const void __user *, argp,
        size_t, argsz)
{
    struct io_ring_ctx *ctx;
    int submitted = 0;
    struct fd f;
    long ret;

    /* 运行任务工作队列 */
    io_run_task_work();

    /* 检查标志有效性 */
    if (unlikely(flags & ~(IORING_ENTER_GETEVENTS | IORING_ENTER_SQ_WAKEUP |
                   IORING_ENTER_SQ_WAIT | IORING_ENTER_EXT_ARG)))
        return -EINVAL;

    /* 获取文件描述符 */
    f = fdget(fd);
    if (unlikely(!f.file))
        return -EBADF;

    /* 检查是否是 io_uring 文件 */
    ret = -EOPNOTSUPP;
    if (unlikely(f.file->f_op != &io_uring_fops))
        goto out_fput;

    /* 获取 io_uring 上下文 */
    ret = -ENXIO;
    ctx = f.file->private_data;
    if (unlikely(!percpu_ref_tryget(&ctx->refs)))
        goto out_fput;

    ret = -EBADFD;
    if (unlikely(ctx->flags & IORING_SETUP_R_DISABLED))
        goto out;

    ret = 0;
    
    /*
     * SQPOLL 模式：
     * 内核线程会持续轮询 SQ 并处理请求
     * 应用程序只需唤醒线程或等待 SQ 空间
     */
    if (ctx->flags & IORING_SETUP_SQPOLL) {
        io_cqring_overflow_flush(ctx);

        if (unlikely(ctx->sq_data->thread == NULL)) {
            ret = -EOWNERDEAD;
            goto out;
        }
        
        /* 唤醒 SQ 线程 */
        if (flags & IORING_ENTER_SQ_WAKEUP)
            wake_up(&ctx->sq_data->wait);
        
        /* 等待 SQ 空间 */
        if (flags & IORING_ENTER_SQ_WAIT) {
            ret = io_sqpoll_wait_sq(ctx);
            if (ret)
                goto out;
        }
        submitted = to_submit;
    } else if (to_submit) {
        /* 非 SQPOLL 模式：直接提交请求 */
        ret = io_uring_add_tctx_node(ctx);
        if (unlikely(ret))
            goto out;
        mutex_lock(&ctx->uring_lock);
        submitted = io_submit_sqes(ctx, to_submit);
        mutex_unlock(&ctx->uring_lock);

        if (submitted != to_submit)
            goto out;
    }
    
    /* 等待完成事件 */
    if (flags & IORING_ENTER_GETEVENTS) {
        const sigset_t __user *sig;
        struct __kernel_timespec __user *ts;

        ret = io_get_ext_arg(flags, argp, &argsz, &ts, &sig);
        if (unlikely(ret))
            goto out;

        min_complete = min(min_complete, ctx->cq_entries);

        /* IOPOLL 模式：主动轮询完成事件 */
        if (ctx->flags & IORING_SETUP_IOPOLL &&
            !(ctx->flags & IORING_SETUP_SQPOLL)) {
            ret = io_iopoll_check(ctx, min_complete);
        } else {
            /* 普通 I/O：等待完成事件 */
            ret = io_cqring_wait(ctx, min_complete, sig, argsz, ts);
        }
    }

out:
    percpu_ref_put(&ctx->refs);
out_fput:
    fdput(f);
    return submitted ? submitted : ret;
}
```

**io_uring_enter 标志：**

| 标志 | 说明 |
|------|------|
| IORING_ENTER_GETEVENTS | 等待完成事件，min_complete 指定最少等待数量 |
| IORING_ENTER_SQ_WAKEUP | 唤醒 SQ 轮询线程（SQPOLL 模式） |
| IORING_ENTER_SQ_WAIT | 等待 SQ 有可用空间（SQPOLL 模式） |
| IORING_ENTER_EXT_ARG | 使用扩展参数结构 |

### 4.3 io_uring_register

```c
/*
 * io_uring_register - 注册资源或配置 io_uring
 * 定义在 io_uring/io_uring.c
 * 
 * 参数：
 *   fd      - io_uring 实例的文件描述符
 *   opcode  - 操作码
 *   arg     - 参数
 *   nr_args - 参数数量
 * 
 * 返回值：
 *   成功：0 或正数
 *   失败：负的错误码
 */
SYSCALL_DEFINE4(io_uring_register, unsigned int, fd, unsigned int, opcode,
        void __user *, arg, unsigned int, nr_args)
{
    struct io_ring_ctx *ctx;
    long ret = -EBADF;
    struct fd f;

    if (opcode >= IORING_REGISTER_LAST)
        return -EINVAL;

    f = fdget(fd);
    if (!f.file)
        return -EBADF;

    ret = -EOPNOTSUPP;
    if (f.file->f_op != &io_uring_fops)
        goto out_fput;

    ctx = f.file->private_data;

    io_run_task_work();

    mutex_lock(&ctx->uring_lock);
    ret = __io_uring_register(ctx, opcode, arg, nr_args);
    mutex_unlock(&ctx->uring_lock);
    
    trace_io_uring_register(ctx, opcode, ctx->nr_user_files, ctx->nr_user_bufs,
                            ctx->cq_ev_fd != NULL, ret);
out_fput:
    fdput(f);
    return ret;
}
```

**注册操作码：**

| 操作码 | 说明 |
|--------|------|
| IORING_REGISTER_BUFFERS | 注册用户缓冲区，用于固定缓冲区 I/O |
| IORING_UNREGISTER_BUFFERS | 取消注册用户缓冲区 |
| IORING_REGISTER_FILES | 注册文件描述符集，避免每次查找 |
| IORING_UNREGISTER_FILES | 取消注册文件描述符集 |
| IORING_REGISTER_EVENTFD | 注册 eventfd 用于完成通知 |
| IORING_UNREGISTER_EVENTFD | 取消注册 eventfd |
| IORING_REGISTER_FILES_UPDATE | 更新已注册的文件描述符 |
| IORING_REGISTER_EVENTFD_ASYNC | 注册异步 eventfd |
| IORING_REGISTER_PROBE | 探测支持的操作 |
| IORING_REGISTER_PERSONALITY | 注册凭证 |
| IORING_UNREGISTER_PERSONALITY | 取消注册凭证 |
| IORING_REGISTER_RESTRICTIONS | 注册限制规则 |
| IORING_REGISTER_ENABLE_RINGS | 启用被禁用的 ring |

---

## 五、请求处理流程

### 5.1 提交流程

```c
/*
 * io_submit_sqes - 提交 SQE 到内核
 * 定义在 io_uring/io_uring.c
 */
static int io_submit_sqes(struct io_ring_ctx *ctx, unsigned int nr)
    __must_hold(&ctx->uring_lock)
{
    int submitted = 0;

    /* 确保 SQ 条目在 tail 之后读取 */
    nr = min3(nr, ctx->sq_entries, io_sqring_entries(ctx));
    if (!percpu_ref_tryget_many(&ctx->refs, nr))
        return -EAGAIN;
    io_get_task_refs(nr);

    io_submit_state_start(&ctx->submit_state, nr);
    
    while (submitted < nr) {
        const struct io_uring_sqe *sqe;
        struct io_kiocb *req;

        /* 分配请求结构 */
        req = io_alloc_req(ctx);
        if (unlikely(!req)) {
            if (!submitted)
                submitted = -EAGAIN;
            break;
        }
        
        /* 获取 SQE */
        sqe = io_get_sqe(ctx);
        if (unlikely(!sqe)) {
            list_add(&req->inflight_entry, &ctx->submit_state.free_list);
            break;
        }
        
        /* 计为已提交 */
        submitted++;
        
        /* 提交单个 SQE */
        if (io_submit_sqe(ctx, req, sqe))
            break;
    }

    if (unlikely(submitted != nr)) {
        int ref_used = (submitted == -EAGAIN) ? 0 : submitted;
        int unused = nr - ref_used;

        current->io_uring->cached_refs += unused;
        percpu_ref_put_many(&ctx->refs, unused);
    }

    io_submit_state_end(&ctx->submit_state, ctx);
    
    /* 提交 SQ ring head */
    io_commit_sqring(ctx);

    return submitted;
}
```

### 5.2 请求执行流程

```c
/*
 * io_issue_sqe - 执行 SQE 指定的操作
 * 定义在 io_uring/io_uring.c
 */
static int io_issue_sqe(struct io_kiocb *req, unsigned int issue_flags)
{
    struct io_ring_ctx *ctx = req->ctx;
    const struct cred *creds = NULL;
    int ret;

    /* 切换凭证（如果需要） */
    if ((req->flags & REQ_F_CREDS) && req->creds != current_cred())
        creds = override_creds(req->creds);

    switch (req->opcode) {
    case IORING_OP_NOP:
        ret = io_nop(req, issue_flags);
        break;
    case IORING_OP_READV:
    case IORING_OP_READ_FIXED:
    case IORING_OP_READ:
        ret = io_read(req, issue_flags);
        break;
    case IORING_OP_WRITEV:
    case IORING_OP_WRITE_FIXED:
    case IORING_OP_WRITE:
        ret = io_write(req, issue_flags);
        break;
    case IORING_OP_FSYNC:
        ret = io_fsync(req, issue_flags);
        break;
    case IORING_OP_POLL_ADD:
        ret = io_poll_add(req, issue_flags);
        break;
    case IORING_OP_SENDMSG:
        ret = io_sendmsg(req, issue_flags);
        break;
    case IORING_OP_SEND:
        ret = io_send(req, issue_flags);
        break;
    case IORING_OP_RECVMSG:
        ret = io_recvmsg(req, issue_flags);
        break;
    case IORING_OP_RECV:
        ret = io_recv(req, issue_flags);
        break;
    case IORING_OP_TIMEOUT:
        ret = io_timeout(req, issue_flags);
        break;
    case IORING_OP_ACCEPT:
        ret = io_accept(req, issue_flags);
        break;
    case IORING_OP_CONNECT:
        ret = io_connect(req, issue_flags);
        break;
    case IORING_OP_OPENAT:
        ret = io_openat(req, issue_flags);
        break;
    case IORING_OP_CLOSE:
        ret = io_close(req, issue_flags);
        break;
    case IORING_OP_STATX:
        ret = io_statx(req, issue_flags);
        break;
    /* ... 其他操作 ... */
    default:
        ret = -EINVAL;
        break;
    }

    if (creds)
        revert_creds(creds);
    if (ret)
        return ret;
    
    /* IOPOLL 模式：记录已发出的请求 */
    if ((ctx->flags & IORING_SETUP_IOPOLL) && req->file)
        io_iopoll_req_issued(req);

    return 0;
}

/*
 * __io_queue_sqe - 将 SQE 加入执行队列
 * 定义在 io_uring/io_uring.c
 */
static void __io_queue_sqe(struct io_kiocb *req)
    __must_hold(&req->ctx->uring_lock)
{
    struct io_kiocb *linked_timeout;
    int ret;

issue_sqe:
    /* 尝试非阻塞执行 */
    ret = io_issue_sqe(req, IO_URING_F_NONBLOCK|IO_URING_F_COMPLETE_DEFER);

    /*
     * 如果成功且可以延迟完成：
     * 将请求加入批量完成列表
     */
    if (likely(!ret)) {
        if (req->flags & REQ_F_COMPLETE_INLINE) {
            struct io_ring_ctx *ctx = req->ctx;
            struct io_submit_state *state = &ctx->submit_state;

            state->compl_reqs[state->compl_nr++] = req;
            if (state->compl_nr == ARRAY_SIZE(state->compl_reqs))
                io_submit_flush_completions(ctx);
            return;
        }

        linked_timeout = io_prep_linked_timeout(req);
        if (linked_timeout)
            io_queue_linked_timeout(linked_timeout);
    } else if (ret == -EAGAIN && !(req->flags & REQ_F_NOWAIT)) {
        /*
         * 需要 async 执行：
         * 尝试使用 poll 机制或工作队列
         */
        linked_timeout = io_prep_linked_timeout(req);

        switch (io_arm_poll_handler(req)) {
        case IO_APOLL_READY:
            if (linked_timeout)
                io_queue_linked_timeout(linked_timeout);
            goto issue_sqe;
        case IO_APOLL_ABORTED:
            /* 需要工作队列处理 */
            io_queue_async_work(req, NULL);
            break;
        case IO_APOLL_OK:
            if (linked_timeout)
                io_queue_linked_timeout(linked_timeout);
            break;
        }
    } else {
        /* 执行失败，完成请求 */
        io_req_complete_failed(req, ret);
    }
}
```

### 5.3 完成流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        完成流程                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. I/O 操作完成                                                │
│     ↓                                                           │
│  2. 生成 CQE                                                    │
│     io_fill_cqe() / io_cqring_fill_event()                     │
│     ↓                                                           │
│  3. 写入 CQ                                                     │
│     - 更新 cq.tail                                              │
│     - 如果 CQ 满，加入溢出列表                                   │
│     ↓                                                           │
│  4. 通知应用程序                                                │
│     - 唤醒等待的进程                                            │
│     - 触发 eventfd（如果注册）                                  │
│     ↓                                                           │
│  5. 应用程序收割 CQE                                            │
│     - 读取 cq.head 到 cq.tail 之间的条目                        │
│     - 更新 cq.head                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、工作模式详解

### 6.1 默认模式

默认模式下，应用程序需要主动调用 io_uring_enter 来提交请求和等待完成。

```
应用程序流程：
1. 获取 SQE：sqe = io_uring_get_sqe(&ring)
2. 准备请求：io_uring_prep_read(sqe, fd, buf, len, off)
3. 提交请求：io_uring_submit(&ring) → io_uring_enter()
4. 等待完成：io_uring_wait_cqe(&ring, &cqe) → io_uring_enter(GETEVENTS)
5. 处理结果：检查 cqe->res
6. 标记完成：io_uring_cqe_seen(&ring, cqe)
```

### 6.2 SQPOLL 模式

SQPOLL（Submission Queue Polling）模式创建一个内核线程持续轮询 SQ，应用程序无需调用 io_uring_enter 来提交请求。

```c
/*
 * SQPOLL 模式特点：
 * 1. 内核线程持续轮询 SQ，发现新请求立即处理
 * 2. 应用程序只需将 SQE 写入 SQ，无需系统调用
 * 3. 适用于低延迟场景
 * 4. 会占用 CPU 资源
 */

/* 启用 SQPOLL 模式 */
struct io_uring_params params = {0};
params.flags = IORING_SETUP_SQPOLL;
params.sq_thread_idle = 2000;  /* 空闲 2 秒后休眠 */
params.sq_thread_cpu = 0;      /* 绑定到 CPU 0 */

io_uring_queue_init_params(128, &ring, &params);

/* 提交请求时无需系统调用 */
sqe = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe, fd, buf, len, off);
sqe->user_data = 1;

/* 只需更新 tail，内核线程会自动发现 */
io_uring_submit(&ring);  /* 可能只是内存屏障 */

/* 如果 SQ 线程休眠，需要唤醒 */
if (ring.sq->flags & IORING_SQ_NEED_WAKEUP)
    io_uring_enter(ring_fd, 0, 0, IORING_ENTER_SQ_WAKEUP);
```

### 6.3 IOPOLL 模式

IOPOLL 模式适用于 NVMe 等支持轮询的高速存储设备，应用程序需要主动轮询完成事件。

```c
/*
 * IOPOLL 模式特点：
 * 1. 不使用中断，应用程序主动轮询完成状态
 * 2. 适用于低延迟、高 IOPS 场景
 * 3. 需要设备支持轮询
 */

struct io_uring_params params = {0};
params.flags = IORING_SETUP_IOPOLL;

io_uring_queue_init_params(128, &ring, &params);

/* 提交请求 */
sqe = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe, fd, buf, len, off);
io_uring_submit(&ring);

/* 主动轮询完成事件 */
while (1) {
    ret = io_uring_peek_cqe(&ring, &cqe);
    if (ret == 0) {
        /* 处理完成事件 */
        io_uring_cqe_seen(&ring, cqe);
        break;
    }
    /* 可以做其他工作 */
}
```

---

## 七、高级特性

### 7.1 链式请求

io_uring 支持将多个请求链接在一起，前一个请求成功后才执行下一个。

```c
/*
 * 链式请求示例：
 * 读取文件 → 处理数据 → 写入文件
 */

/* 第一个请求：读取文件 */
sqe1 = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe1, fd_in, buf, len, 0);
sqe1->flags |= IOSQE_IO_LINK;  /* 链接下一个请求 */
sqe1->user_data = 1;

/* 第二个请求：写入文件（只有读取成功才执行） */
sqe2 = io_uring_get_sqe(&ring);
io_uring_prep_write(sqe2, fd_out, buf, len, 0);
sqe2->user_data = 2;

io_uring_submit(&ring);

/* 如果读取失败，写入请求会被取消 */
```

### 7.2 超时请求

可以为请求设置超时，超时后请求会被取消。

```c
/*
 * 超时请求示例
 */
struct __kernel_timespec ts = {
    .tv_sec = 1,
    .tv_nsec = 0,
};

sqe = io_uring_get_sqe(&ring);
io_uring_prep_timeout(sqe, &ts, 0, 0);
sqe->user_data = TIMEOUT_ID;

io_uring_submit(&ring);
```

### 7.3 固定文件和缓冲区

通过注册固定文件和缓冲区，可以避免每次请求都查找文件和验证缓冲区。

```c
/*
 * 注册固定文件
 */
int files[2] = {fd1, fd2};
io_uring_register_files(&ring, files, 2);

/* 使用固定文件 */
sqe = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe, 0, buf, len, 0);  /* 0 表示第一个注册的文件 */
sqe->flags |= IOSQE_FIXED_FILE;

/*
 * 注册固定缓冲区
 */
struct iovec iov = {
    .iov_base = buf,
    .iov_len = buf_size,
};
io_uring_register_buffers(&ring, &iov, 1);

/* 使用固定缓冲区 */
sqe = io_uring_get_sqe(&ring);
io_uring_prep_read_fixed(sqe, fd, buf, len, 0, 0);  /* 最后一个参数是缓冲区索引 */
```

### 7.4 提供缓冲区

应用程序可以提供一组缓冲区，内核在接收数据时自动选择。

```c
/*
 * 提供缓冲区示例
 */
#define BUF_SIZE 4096
#define BUF_COUNT 16

struct io_uring_sqe *sqe;
struct io_uring_cqe *cqe;
char *bufs[BUF_COUNT];
int i;

/* 分配缓冲区 */
for (i = 0; i < BUF_COUNT; i++) {
    bufs[i] = malloc(BUF_SIZE);
}

/* 提供缓冲区 */
sqe = io_uring_get_sqe(&ring);
io_uring_prep_provide_buffers(sqe, bufs[0], BUF_SIZE, BUF_COUNT, 0, 0);
sqe->user_data = PROVIDE_BUF_ID;

io_uring_submit(&ring);
io_uring_wait_cqe(&ring, &cqe);
io_uring_cqe_seen(&ring, cqe);

/* 接收数据时使用提供的缓冲区 */
sqe = io_uring_get_sqe(&ring);
io_uring_prep_recv(sqe, sockfd, NULL, BUF_SIZE, 0);
sqe->flags |= IOSQE_BUFFER_SELECT;
sqe->buf_group = 0;  /* 缓冲区组 ID */
sqe->user_data = RECV_ID;

io_uring_submit(&ring);
io_uring_wait_cqe(&ring, &cqe);

if (cqe->flags & IORING_CQE_F_BUFFER) {
    int buf_id = cqe->flags >> IORING_CQE_BUFFER_SHIFT;
    printf("Received data in buffer %d\n", buf_id);
}
```

---

## 八、性能优化建议

### 8.1 合理设置队列深度

队列深度决定了 SQ 和 CQ 的大小，需要根据负载情况合理设置：

- **高并发场景**：设置较大的队列深度（如 1024 或更高）
- **内存受限场景**：设置较小的队列深度（如 64 或 128）
- **建议**：队列深度设为 2 的幂次方，优化内存访问效率

### 8.2 使用 SQPOLL 模式

对于低延迟场景，启用 SQPOLL 模式可以避免系统调用开销：

```c
struct io_uring_params params = {0};
params.flags = IORING_SETUP_SQPOLL;
params.sq_thread_idle = 2000;  /* 2 秒空闲后休眠 */
```

**注意事项：**
- SQPOLL 会占用 CPU 资源
- 需要设置合理的 sq_thread_idle 值
- 适合持续有请求的场景

### 8.3 批量提交和收割

尽量批量提交请求和收割完成事件，减少系统调用次数：

```c
/* 批量提交 */
for (i = 0; i < BATCH_SIZE; i++) {
    sqe = io_uring_get_sqe(&ring);
    io_uring_prep_read(sqe, fds[i], bufs[i], len, 0);
    sqe->user_data = i;
}
io_uring_submit(&ring);  /* 一次系统调用提交所有请求 */

/* 批量收割 */
unsigned int head;
struct io_uring_cqe *cqe;
io_uring_for_each_cqe(&ring, head, cqe) {
    /* 处理完成事件 */
}
io_uring_cq_advance(&ring, count);  /* 一次更新 head */
```

### 8.4 使用固定资源

注册固定文件和缓冲区可以减少每次请求的开销：

```c
/* 注册常用文件 */
io_uring_register_files(&ring, files, file_count);

/* 注册常用缓冲区 */
io_uring_register_buffers(&ring, iovecs, iov_count);
```

### 8.5 避免CQ溢出

确保 CQ 有足够空间容纳完成事件，避免溢出：

- CQ 大小默认为 SQ 的两倍
- 及时收割完成事件
- 监控 cq_overflow 计数器

---

## 九、代码示例

### 9.1 基本文件读取

```c
/*
 * 使用 io_uring 读取文件
 */
#include <liburing.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

#define BUFFER_SIZE 4096
#define QUEUE_DEPTH 8

int main()
{
    struct io_uring ring;
    char buffer[BUFFER_SIZE];
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    int fd, ret;

    /* 初始化 io_uring */
    ret = io_uring_queue_init(QUEUE_DEPTH, &ring, 0);
    if (ret < 0) {
        perror("io_uring_queue_init");
        return 1;
    }

    /* 打开文件 */
    fd = open("example.txt", O_RDONLY);
    if (fd < 0) {
        perror("open");
        io_uring_queue_exit(&ring);
        return 1;
    }

    /* 获取一个 SQE 并准备 read 操作 */
    sqe = io_uring_get_sqe(&ring);
    if (!sqe) {
        fprintf(stderr, "Failed to get SQE\n");
        close(fd);
        io_uring_queue_exit(&ring);
        return 1;
    }

    io_uring_prep_read(sqe, fd, buffer, BUFFER_SIZE, 0);
    sqe->user_data = 0;

    /* 提交请求 */
    ret = io_uring_submit(&ring);
    if (ret < 0) {
        fprintf(stderr, "io_uring_submit failed: %s\n", strerror(-ret));
        close(fd);
        io_uring_queue_exit(&ring);
        return 1;
    }

    /* 等待完成并获取 CQE */
    ret = io_uring_wait_cqe(&ring, &cqe);
    if (ret < 0) {
        fprintf(stderr, "io_uring_wait_cqe failed: %s\n", strerror(-ret));
        close(fd);
        io_uring_queue_exit(&ring);
        return 1;
    }

    /* 检查是否成功 */
    if (cqe->res >= 0) {
        printf("Read %d bytes: %.*s\n", cqe->res, (int)cqe->res, buffer);
    } else {
        printf("Read failed: %s\n", strerror(-cqe->res));
    }

    /* 标记 CQE 已处理 */
    io_uring_cqe_seen(&ring, cqe);

    /* 释放资源 */
    close(fd);
    io_uring_queue_exit(&ring);

    return 0;
}
```

### 9.2 批量读取文件

```c
/*
 * 批量读取多个文件
 */
#include <liburing.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

#define BUFFER_SIZE 4096
#define QUEUE_DEPTH 8
#define FILE_COUNT 8

int main()
{
    struct io_uring ring;
    char buffers[FILE_COUNT][BUFFER_SIZE];
    int fds[FILE_COUNT];
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    int ret, i;
    unsigned int head;
    unsigned int count;

    /* 初始化 io_uring */
    ret = io_uring_queue_init(QUEUE_DEPTH, &ring, 0);
    if (ret < 0) {
        perror("io_uring_queue_init");
        return 1;
    }

    /* 打开多个文件并提交读请求 */
    for (i = 0; i < FILE_COUNT; i++) {
        char filename[32];
        snprintf(filename, sizeof(filename), "file%d.txt", i);
        
        fds[i] = open(filename, O_RDONLY);
        if (fds[i] < 0) {
            perror("open");
            continue;
        }

        sqe = io_uring_get_sqe(&ring);
        if (!sqe) {
            fprintf(stderr, "Failed to get SQE\n");
            close(fds[i]);
            continue;
        }

        io_uring_prep_read(sqe, fds[i], buffers[i], BUFFER_SIZE, 0);
        sqe->user_data = i;
    }

    /* 批量提交所有请求 */
    ret = io_uring_submit(&ring);
    if (ret < 0) {
        fprintf(stderr, "io_uring_submit failed: %s\n", strerror(-ret));
        return 1;
    }

    printf("Submitted %d requests\n", ret);

    /* 批量收割完成事件 */
    count = 0;
    io_uring_for_each_cqe(&ring, head, cqe) {
        int file_idx = cqe->user_data;
        
        if (cqe->res >= 0) {
            printf("File %d: Read %d bytes\n", file_idx, cqe->res);
        } else {
            printf("File %d: Read failed: %s\n", file_idx, strerror(-cqe->res));
        }
        
        count++;
    }

    /* 一次更新 CQ head */
    io_uring_cq_advance(&ring, count);

    /* 释放资源 */
    for (i = 0; i < FILE_COUNT; i++) {
        if (fds[i] >= 0)
            close(fds[i]);
    }
    io_uring_queue_exit(&ring);

    return 0;
}
```

### 9.3 网络服务器示例

```c
/*
 * 使用 io_uring 实现简单的 echo 服务器
 */
#include <liburing.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#define QUEUE_DEPTH 256
#define BUFFER_SIZE 1024
#define PORT 8888

enum {
    OP_ACCEPT = 0,
    OP_READ,
    OP_WRITE,
};

struct conn_info {
    int fd;
    int op;
};

int main()
{
    struct io_uring ring;
    struct io_uring_params params = {0};
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    struct sockaddr_in client_addr;
    socklen_t client_len = sizeof(client_addr);
    int listen_fd, client_fd;
    int ret;
    char *buffer;

    /* 初始化 io_uring */
    ret = io_uring_queue_init_params(QUEUE_DEPTH, &ring, &params);
    if (ret < 0) {
        perror("io_uring_queue_init_params");
        return 1;
    }

    /* 创建监听 socket */
    listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd < 0) {
        perror("socket");
        io_uring_queue_exit(&ring);
        return 1;
    }

    int opt = 1;
    setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in server_addr = {
        .sin_family = AF_INET,
        .sin_port = htons(PORT),
        .sin_addr.s_addr = INADDR_ANY,
    };

    if (bind(listen_fd, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        perror("bind");
        close(listen_fd);
        io_uring_queue_exit(&ring);
        return 1;
    }

    if (listen(listen_fd, 10) < 0) {
        perror("listen");
        close(listen_fd);
        io_uring_queue_exit(&ring);
        return 1;
    }

    printf("Server listening on port %d\n", PORT);

    /* 提交 accept 请求 */
    sqe = io_uring_get_sqe(&ring);
    io_uring_prep_accept(sqe, listen_fd, (struct sockaddr *)&client_addr, 
                         &client_len, 0);
    struct conn_info accept_info = { .fd = listen_fd, .op = OP_ACCEPT };
    memcpy(&sqe->user_data, &accept_info, sizeof(accept_info));

    io_uring_submit(&ring);

    /* 事件循环 */
    while (1) {
        ret = io_uring_wait_cqe(&ring, &cqe);
        if (ret < 0) {
            perror("io_uring_wait_cqe");
            continue;
        }

        struct conn_info info;
        memcpy(&info, &cqe->user_data, sizeof(info));

        if (info.op == OP_ACCEPT) {
            /* 接受新连接 */
            if (cqe->res >= 0) {
                client_fd = cqe->res;
                printf("New connection: fd=%d\n", client_fd);

                /* 提交 read 请求 */
                buffer = malloc(BUFFER_SIZE);
                sqe = io_uring_get_sqe(&ring);
                io_uring_prep_recv(sqe, client_fd, buffer, BUFFER_SIZE, 0);
                struct conn_info read_info = { .fd = client_fd, .op = OP_READ };
                memcpy(&sqe->user_data, &read_info, sizeof(read_info));
                sqe->flags |= IOSQE_BUFFER_SELECT;

                io_uring_submit(&ring);

                /* 继续提交 accept */
                sqe = io_uring_get_sqe(&ring);
                io_uring_prep_accept(sqe, listen_fd, 
                                     (struct sockaddr *)&client_addr,
                                     &client_len, 0);
                memcpy(&sqe->user_data, &accept_info, sizeof(accept_info));
                io_uring_submit(&ring);
            }
        } else if (info.op == OP_READ) {
            /* 读取数据 */
            if (cqe->res > 0) {
                printf("Received %d bytes from fd=%d\n", cqe->res, info.fd);

                /* Echo 回去 */
                buffer = malloc(cqe->res);
                sqe = io_uring_get_sqe(&ring);
                io_uring_prep_send(sqe, info.fd, buffer, cqe->res, 0);
                struct conn_info write_info = { .fd = info.fd, .op = OP_WRITE };
                memcpy(&sqe->user_data, &write_info, sizeof(write_info));

                io_uring_submit(&ring);
            } else {
                /* 连接关闭 */
                printf("Connection closed: fd=%d\n", info.fd);
                close(info.fd);
            }
        } else if (info.op == OP_WRITE) {
            /* 写入完成，继续读取 */
            buffer = malloc(BUFFER_SIZE);
            sqe = io_uring_get_sqe(&ring);
            io_uring_prep_recv(sqe, info.fd, buffer, BUFFER_SIZE, 0);
            struct conn_info read_info = { .fd = info.fd, .op = OP_READ };
            memcpy(&sqe->user_data, &read_info, sizeof(read_info));

            io_uring_submit(&ring);
        }

        io_uring_cqe_seen(&ring, cqe);
    }

    close(listen_fd);
    io_uring_queue_exit(&ring);
    return 0;
}
```

---

## 十、io_uring 与 epoll 对比

### 10.1 系统调用次数

| 场景 | epoll | io_uring |
|------|-------|----------|
| 单次读取 | epoll_wait + read (2次) | io_uring_enter (1次) |
| 批量读取 | epoll_wait + N * read | io_uring_enter (1次) |
| 接受连接 | epoll_wait + accept | io_uring_enter (1次) |

### 10.2 数据拷贝

| 方面 | epoll | io_uring |
|------|-------|----------|
| 事件通知 | 需要内核到用户空间拷贝 | 共享内存，零拷贝 |
| I/O 数据 | 需要内核到用户空间拷贝 | 可使用固定缓冲区减少拷贝 |

### 10.3 异步程度

| 方面 | epoll | io_uring |
|------|-------|----------|
| 事件通知 | 异步 | 异步 |
| I/O 操作 | 同步（需要应用程序执行） | 完全异步（内核执行） |
| 操作范围 | 主要是网络 I/O | 网络 I/O、文件 I/O、系统调用 |

### 10.4 性能对比

在高并发场景下，io_uring 相比 epoll 有显著优势：

- **延迟降低**：约 40%
- **吞吐量提升**：约 50%
- **CPU 占用率降低**：约 25%
- **内存使用减少**：约 15%

---

## 十一、总结

io_uring 是 Linux 内核 I/O 子系统的重大革新，通过共享内存环形队列机制，实现了：

1. **减少系统调用开销**：批量提交和收割，一次系统调用处理多个请求
2. **避免数据拷贝**：用户态和内核态共享队列，零拷贝通信
3. **真正的异步 I/O**：应用程序提交请求后立即返回，内核后台处理
4. **统一的操作接口**：支持文件 I/O、网络 I/O、系统调用等多种操作

io_uring 的出现为高性能服务器、存储引擎、网络框架提供了新的底层支撑，是衡量开发者内核功底的重要技术。掌握 io_uring 不仅能提升系统性能，更能深入理解 Linux 内核的 I/O 子系统设计。
