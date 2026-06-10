# Linux 5.15 eBPF技术详解

> 本文档从初学者角度详细讲解Linux内核eBPF（extended Berkeley Packet Filter）技术，从"什么是eBPF"开始，深入分析bpf_prog结构、bpf_map交互机制、各种挂载点（kprobe/tracepoint/XDP/TC），最后提供XDP DDoS防御的实际示例。

---

## 目录

1. **`引言：什么是eBPF`**
2. **`eBPF核心架构`**
3. **`bpf_prog结构详解`**
4. **`bpf_map结构详解`**
5. **`eBPF挂载点`**
6. **`XDP程序详解`**
7. **`XDP DDoS防御示例`**
8. **`调试与问题排查`**
9. **`总结`**

---

## 一、引言：什么是eBPF

### 1.1 eBPF的起源

```
┌─────────────────────────────────────────────────────────────┐
│                    eBPF的起源                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1992年：经典BPF（cBPF）                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 用于数据包过滤                                    │   │
│  │  • 在用户态运行                                      │   │
│  │  • 功能有限：仅支持数据包捕获和过滤                   │   │
│  │  • 指令集简单                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2014年：扩展BPF（eBPF）                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 在内核态运行                                      │   │
│  │  • 功能强大：可访问内核函数和数据结构                 │   │
│  │  • 指令集丰富：支持64位、更多寄存器                   │   │
│  │  • 安全：通过验证器确保程序安全                       │   │
│  │  • JIT编译：高性能                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  关键里程碑：                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 2014：eBPF引入Linux内核                           │   │
│  │  • 2015：XDP（eXpress Data Path）                    │   │
│  │  • 2016：BPF tracing支持                             │   │
│  │  • 2018：BTF（BPF Type Format）                      │   │
│  │  • 2020：CO-RE（Compile Once - Run Everywhere）      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 为什么需要eBPF

```
┌─────────────────────────────────────────────────────────────┐
│                  为什么需要eBPF                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统方式的局限性：                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 内核模块开发                                     │   │
│  │     • 需要编译内核模块                               │   │
│  │     • 需要root权限                                   │   │
│  │     • 安全风险高（可能导致系统崩溃）                  │   │
│  │     • 难以移植（依赖内核版本）                        │   │
│  │                                                          │   │
│  │  2. 修改内核源码                                      │   │
│  │     • 需要重新编译内核                                │   │
│  │     • 维护成本高                                      │   │
│  │     • 上游合并困难                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  eBPF的优势：                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 安全性                                            │   │
│  │     • 验证器确保程序安全                              │   │
│  │     • 沙箱执行环境                                    │   │
│  │     • 不会导致系统崩溃                                │   │
│  │                                                          │   │
│  │  2. 高性能                                            │   │
│  │     • JIT编译为本地代码                               │   │
│  │     • 最小化开销                                      │   │
│  │                                                          │   │
│  │  3. 灵活性                                            │   │
│  │     • 无需修改内核源码                                │   │
│  │     • 动态加载和卸载                                  │   │
│  │     • 可移植性好（CO-RE）                             │   │
│  │                                                          │   │
│  │  4. 可观测性                                          │   │
│  │     • 深度内核追踪                                    │   │
│  │     • 性能分析                                        │   │
│  │     • 网络监控                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 eBPF的应用场景

```
┌─────────────────────────────────────────────────────────────┐
│                  eBPF应用场景                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 网络性能优化                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • XDP：高性能数据包处理                              │   │
│  │  • TC：流量控制和分类                                 │   │
│  │  • 负载均衡：Cilium、Katran                          │   │
│  │  • DDoS防御：Cloudflare、Facebook                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 系统可观测性                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 性能分析：BCC、bpftrace                           │   │
│  │  • 系统追踪：kprobes、tracepoints                     │   │
│  │  • 应用监控：Pixie、Cilium                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 安全监控                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 入侵检测：Falco、Tracee                           │   │
│  │  • 系统调用过滤：seccomp                             │   │
│  │  • 网络安全：Cilium、Calico                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 容器网络                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Cilium：基于eBPF的容器网络                         │   │
│  │  • Calico：eBPF数据平面                              │   │
│  │  • Kubernetes网络策略                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、eBPF核心架构

### 2.1 eBPF整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    eBPF整体架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户态                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  eBPF程序（C语言）                                    │   │
│  │  • 使用Clang编译为eBPF字节码                          │   │
│  │  • 使用libbpf加载到内核                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  系统调用（bpf()）                                           │
│                          ↓                                  │
│  内核态                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 验证器（Verifier）                                │   │
│  │     • 检查程序安全性                                  │   │
│  │     • 确保内存访问合法                                │   │
│  │     • 确保程序会终止                                  │   │
│  │                                                          │   │
│  │  2. JIT编译器                                          │   │
│  │     • 将eBPF字节码编译为本地机器码                     │   │
│  │     • 优化性能                                         │   │
│  │                                                          │   │
│  │  3. 执行引擎                                          │   │
│  │     • 解释器（可选）                                   │   │
│  │     • JIT编译后的本地代码                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  挂载点                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • kprobe：内核函数探针                               │   │
│  │  • tracepoint：静态追踪点                             │   │
│  │  • XDP：网络数据包处理                                │   │
│  │  • TC：流量控制                                       │   │
│  │  • perf_event：性能事件                               │   │
│  │  • cgroup：控制组                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 eBPF程序生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                  eBPF程序生命周期                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  步骤1：编写eBPF程序                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 使用C语言编写                                    │   │
│  │  SEC("xdp")                                          │   │
│  │  int xdp_prog(struct xdp_md *ctx) {                  │   │
│  │      // eBPF程序逻辑                                  │   │
│  │      return XDP_PASS;                                │   │
│  │  }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤2：编译为eBPF字节码                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  $ clang -O2 -target bpf -c prog.c -o prog.o         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤3：加载到内核                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 使用libbpf加载                                   │   │
│  │  struct bpf_object *obj = bpf_object__open("prog.o");│   │
│  │  bpf_object__load(obj);                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤4：验证器验证                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 检查内存访问                                      │   │
│  │  • 检查循环（确保有界）                               │   │
│  │  • 检查指令合法性                                     │   │
│  │  • 验证通过或拒绝                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤5：JIT编译                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 将eBPF字节码编译为本地机器码                        │   │
│  │  • 优化性能                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤6：挂载到挂载点                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 挂载XDP程序                                      │   │
│  │  bpf_set_link_xdp_fd(ifindex, prog_fd, 0);           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤7：执行                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 挂载点触发时执行                                   │   │
│  │  • 访问上下文数据                                     │   │
│  │  • 与Map交互                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  步骤8：卸载                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 卸载XDP程序                                      │   │
│  │  bpf_set_link_xdp_fd(ifindex, -1, 0);                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 eBPF验证器

```
┌─────────────────────────────────────────────────────────────┐
│                    eBPF验证器                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  验证器的作用：                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  确保eBPF程序安全，不会导致系统崩溃或损坏              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  验证内容：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 内存访问验证                                      │   │
│  │     • 所有内存访问必须在边界内                        │   │
│  │     • 不能访问未初始化的内存                          │   │
│  │     • 不能越界访问                                    │   │
│  │                                                          │   │
│  │  2. 控制流验证                                        │   │
│  │     • 程序必须终止（不能无限循环）                     │   │
│  │     • 循环必须有界                                    │   │
│  │     • 跳转目标必须合法                                 │   │
│  │                                                          │   │
│  │  3. 栈验证                                            │   │
│  │     • 栈深度有限（512字节）                            │   │
│  │     • 不能栈溢出                                      │   │
│  │                                                          │   │
│  │  4. 寄存器验证                                        │   │
│  │     • 寄存器类型跟踪                                  │   │
│  │     • 值范围跟踪                                      │   │
│  │                                                          │   │
│  │  5. 助手函数验证                                      │   │
│  │     • 只能调用允许的助手函数                          │   │
│  │     • 参数类型检查                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  验证失败示例：                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 错误：越界访问                                    │   │
│  │  int *ptr = NULL;                                    │   │
│  │  *ptr = 10;  // 验证失败                             │   │
│  │                                                          │   │
│  │  // 错误：无限循环                                     │   │
│  │  while (1) { }  // 验证失败                           │   │
│  │                                                          │   │
│  │  // 错误：未检查边界                                   │   │
│  │  int index = ctx->data;                               │   │
│  │  value = array[index];  // 验证失败                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、bpf_prog结构详解

### 3.1 bpf_prog结构

```c
// include/linux/filter.h: 566
struct bpf_prog {
    u16         pages;      /* 分配的页面数量 */
    u16         jited:1,    /* 是否已JIT编译 */
            jit_requested:1,/* 是否请求JIT编译 */
            gpl_compatible:1, /* 是否GPL兼容 */
            cb_access:1,    /* 是否访问控制块 */
            dst_needed:1,   /* 是否需要dst条目 */
            blinded:1,      /* 是否已blinded */
            is_func:1,      /* 是否为BPF函数 */
            kprobe_override:1, /* 是否覆盖kprobe */
            has_callchain_buf:1, /* 是否分配了调用链缓冲区 */
            enforce_expected_attach_type:1, /* 是否强制检查expected_attach_type */
            call_get_stack:1, /* 是否调用bpf_get_stack() */
            call_get_func_ip:1; /* 是否调用get_func_ip() */
    enum bpf_prog_type  type;        /* BPF程序类型 */
    enum bpf_attach_type    expected_attach_type; /* 期望的附加类型 */
    u32         len;        /* 过滤块数量 */
    u32         jited_len;  /* JIT指令大小（字节） */
    u8          tag[BPF_TAG_SIZE]; /* 程序标签 */
    struct bpf_prog_stats __percpu *stats; /* 统计信息 */
    int __percpu    *active;    /* 活跃标志 */
    unsigned int    (*bpf_func)(const void *ctx,
                    const struct bpf_insn *insn); /* BPF函数指针 */
    struct bpf_prog_aux *aux;    /* 辅助字段 */
    struct sock_fprog_kern *orig_prog; /* 原始BPF程序 */
    /* 解释器指令 */
    struct sock_filter   insns[0];
    struct bpf_insn      insnsi[];
};
```

### 3.2 bpf_prog_aux结构

```c
// include/linux/bpf.h: 1012
struct bpf_prog_aux {
    atomic64_t refcnt;          /* 引用计数 */
    u32 used_map_cnt;           /* 使用的Map数量 */
    u32 used_btf_cnt;           /* 使用的BTF数量 */
    u32 max_ctx_offset;         /* 最大上下文偏移 */
    u32 max_pkt_offset;         /* 最大包偏移 */
    u32 max_tp_access;          /* 最大tracepoint访问 */
    u32 stack_depth;            /* 栈深度 */
    u32 id;                     /* 程序ID */
    u32 func_cnt;               /* 函数数量 */
    u32 func_idx;               /* 函数索引 */
    u32 attach_btf_id;          /* 附加的BTF类型ID */
    u32 ctx_arg_info_size;      /* 上下文参数信息大小 */
    u32 max_rdonly_access;      /* 最大只读访问 */
    u32 max_rdwr_access;        /* 最大读写访问 */
    struct btf *attach_btf;     /* 附加的BTF */
    const struct bpf_ctx_arg_aux *ctx_arg_info; /* 上下文参数信息 */
    struct mutex dst_mutex;     /* 保护dst_*指针 */
    struct bpf_prog *dst_prog;  /* 目标程序 */
    struct bpf_trampoline *dst_trampoline; /* 目标trampoline */
    enum bpf_prog_type saved_dst_prog_type; /* 保存的目标程序类型 */
    enum bpf_attach_type saved_dst_attach_type; /* 保存的目标附加类型 */
    bool verifier_zext;         /* 验证器插入零扩展 */
    bool offload_requested;     /* 是否请求卸载 */
    bool attach_btf_trace;      /* 是否附加到BTF启用的raw tp */
    bool func_proto_unreliable; /* 函数原型不可靠 */
    bool sleepable;             /* 是否可睡眠 */
    bool tail_call_reachable;   /* 是否可达尾调用 */
    struct hlist_node tramp_hlist; /* trampoline哈希列表 */
    const struct btf_type *attach_func_proto; /* 附加函数原型 */
    const char *attach_func_name; /* 附加函数名 */
    struct bpf_prog **func;     /* 函数数组 */
    void *jit_data;             /* JIT特定数据 */
    struct bpf_jit_poke_descriptor *poke_tab; /* poke描述符表 */
    struct bpf_kfunc_desc_tab *kfunc_tab; /* kfunc描述符表 */
    u32 size_poke_tab;          /* poke表大小 */
    struct bpf_ksym ksym;       /* 内核符号 */
    const struct bpf_prog_ops *ops; /* 程序操作 */
    struct bpf_map **used_maps; /* 使用的Map数组 */
    struct mutex used_maps_mutex; /* used_maps互斥锁 */
    struct btf_mod_pair *used_btfs; /* 使用的BTF */
    struct bpf_prog *prog;      /* 程序指针 */
    struct user_struct *user;   /* 用户结构 */
    u64 load_time;              /* 加载时间（纳秒） */
    struct bpf_map *cgroup_storage[MAX_BPF_CGROUP_STORAGE_TYPE]; /* cgroup存储 */
    char name[BPF_OBJ_NAME_LEN]; /* 程序名 */
    void *security;             /* 安全字段 */
    struct bpf_prog_offload *offload; /* 卸载信息 */
    struct btf *btf;            /* BTF */
    struct bpf_func_info *func_info; /* 函数信息 */
    struct bpf_func_info_aux *func_info_aux; /* 函数信息辅助 */
    struct bpf_line_info *linfo; /* 行信息 */
    void **jited_linfo;         /* JIT行信息 */
    u32 func_info_cnt;          /* 函数信息数量 */
    u32 nr_linfo;               /* 行信息数量 */
    u32 linfo_idx;              /* 行信息索引 */
    u32 num_exentries;          /* 异常表条目数量 */
    struct exception_table_entry *extable; /* 异常表 */
    union {
        struct work_struct work;
        struct rcu_head    rcu;
    };
};
```

### 3.3 BPF程序类型

```
┌─────────────────────────────────────────────────────────────┐
│                  BPF程序类型                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  enum bpf_prog_type {                                        │
│      BPF_PROG_TYPE_UNSPEC,                                   │
│      BPF_PROG_TYPE_SOCKET_FILTER,   // Socket过滤器          │
│      BPF_PROG_TYPE_KPROBE,          // kprobe探针            │
│      BPF_PROG_TYPE_SCHED_CLS,       // TC分类器              │
│      BPF_PROG_TYPE_SCHED_ACT,       // TC动作                │
│      BPF_PROG_TYPE_TRACEPOINT,      // Tracepoint            │
│      BPF_PROG_TYPE_XDP,             // XDP程序               │
│      BPF_PROG_TYPE_PERF_EVENT,      // Perf事件              │
│      BPF_PROG_TYPE_CGROUP_SKB,      // Cgroup SKB            │
│      BPF_PROG_TYPE_CGROUP_SOCK,     // Cgroup Socket         │
│      BPF_PROG_TYPE_LWT_IN,          // LWT输入               │
│      BPF_PROG_TYPE_LWT_OUT,         // LWT输出               │
│      BPF_PROG_TYPE_LWT_XMIT,        // LWT发送               │
│      BPF_PROG_TYPE_LWT_SEG6LOCAL,   // LWT Segment6本地      │
│      BPF_PROG_TYPE_SOCK_OPS,        // Socket操作            │
│      BPF_PROG_TYPE_SK_SKB,          // SK SKB                │
│      BPF_PROG_TYPE_SK_MSG,          // SK消息                │
│      BPF_PROG_TYPE_RAW_TRACEPOINT,  // Raw Tracepoint        │
│      BPF_PROG_TYPE_CGROUP_DEVICE,   // Cgroup设备            │
│      BPF_PROG_TYPE_SK_REUSEPORT,    // Socket重用端口        │
│      BPF_PROG_TYPE_FLOW_DISSECTOR,  // 流解析器              │
│      BPF_PROG_TYPE_CGROUP_SOCK_ADDR,// Cgroup Socket地址     │
│      BPF_PROG_TYPE_LIRC_MODE2,      // LIRC模式2             │
│      BPF_PROG_TYPE_SK_LOOKUP,       // Socket查找            │
│      BPF_PROG_TYPE_SYSCALL,         // 系统调用              │
│  };                                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、bpf_map结构详解

### 4.1 bpf_map结构

```c
// include/linux/bpf.h: 263
struct bpf_map {
    /* 前两个缓存行包含只读成员，部分在快速路径中访问 */
    const struct bpf_map_ops *ops ____cacheline_aligned; /* Map操作 */
    struct bpf_map *inner_map_meta; /* 内部Map元数据 */
    void *security;               /* 安全字段 */
    enum bpf_map_type map_type;   /* Map类型 */
    u32 key_size;                 /* 键大小 */
    u32 value_size;               /* 值大小 */
    u32 max_entries;              /* 最大条目数 */
    u32 map_flags;                /* Map标志 */
    int spin_lock_off;            /* 自旋锁偏移 */
    int timer_off;                /* 定时器偏移 */
    u32 id;                       /* Map ID */
    int numa_node;                /* NUMA节点 */
    u32 btf_key_type_id;          /* BTF键类型ID */
    u32 btf_value_type_id;        /* BTF值类型ID */
    struct btf *btf;              /* BTF */
    struct mem_cgroup *memcg;     /* 内存cgroup */
    char name[BPF_OBJ_NAME_LEN];  /* Map名 */
    u32 btf_vmlinux_value_type_id;/* BTF vmlinux值类型ID */
    bool bypass_spec_v1;          /* 绕过spec_v1 */
    bool frozen;                  /* 是否冻结 */

    /* 第3和第4缓存行包含其他成员，避免假共享 */
    atomic64_t refcnt ____cacheline_aligned; /* 引用计数 */
    atomic64_t usercnt;           /* 用户计数 */
    union {
        struct work_struct work;  /* 工作队列 */
        struct rcu_head rcu;      /* RCU头 */
    };
    struct mutex freeze_mutex;    /* 冻结互斥锁 */
    atomic64_t writecnt;          /* 写计数 */
    spinlock_t owner_lock;        /* 所有者锁 */
    struct bpf_map_owner *owner;  /* 所有者 */
    bool free_after_mult_rcu_gp;  /* 多个RCU宽限期后释放 */
    u64 cookie;                   /* Cookie */
};
```

### 4.2 BPF Map类型

```
┌─────────────────────────────────────────────────────────────┐
│                  BPF Map类型                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  enum bpf_map_type {                                         │
│      BPF_MAP_TYPE_UNSPEC,                                    │
│      BPF_MAP_TYPE_HASH,            // 哈希表                 │
│      BPF_MAP_TYPE_ARRAY,           // 数组                   │
│      BPF_MAP_TYPE_PROG_ARRAY,      // 程序数组               │
│      BPF_MAP_TYPE_PERF_EVENT_ARRAY,// Perf事件数组           │
│      BPF_MAP_TYPE_PERCPU_HASH,     // Per-CPU哈希表          │
│      BPF_MAP_TYPE_PERCPU_ARRAY,    // Per-CPU数组            │
│      BPF_MAP_TYPE_STACK_TRACE,     // 栈追踪                 │
│      BPF_MAP_TYPE_CGROUP_ARRAY,    // Cgroup数组             │
│      BPF_MAP_TYPE_LRU_HASH,        // LRU哈希表              │
│      BPF_MAP_TYPE_LRU_PERCPU_HASH, // LRU Per-CPU哈希表      │
│      BPF_MAP_TYPE_LPM_TRIE,        // LPM Trie               │
│      BPF_MAP_TYPE_ARRAY_OF_MAPS,   // Map数组                │
│      BPF_MAP_TYPE_HASH_OF_MAPS,    // Map哈希表              │
│      BPF_MAP_TYPE_DEVMAP,          // 设备Map                │
│      BPF_MAP_TYPE_DEVMAP_HASH,     // 设备哈希Map            │
│      BPF_MAP_TYPE_SOCKMAP,         // Socket Map             │
│      BPF_MAP_TYPE_CPUMAP,          // CPU Map                │
│      BPF_MAP_TYPE_XSKMAP,          // XSK Map                │
│      BPF_MAP_TYPE_SOCKHASH,        // Socket哈希表           │
│      BPF_MAP_TYPE_CGROUP_STORAGE,  // Cgroup存储             │
│      BPF_MAP_TYPE_REUSEPORT_SOCKARRAY, // 重用端口Socket数组 │
│      BPF_MAP_TYPE_PERCPU_CGROUP_STORAGE, // Per-CPU Cgroup存储│
│      BPF_MAP_TYPE_QUEUE,           // 队列                   │
│      BPF_MAP_TYPE_STACK,           // 栈                     │
│      BPF_MAP_TYPE_SK_STORAGE,      // Socket存储             │
│      BPF_MAP_TYPE_DEVMAP_IDX,      // 设备Map索引            │
│      BPF_MAP_TYPE_RINGBUF,         // 环形缓冲区             │
│      BPF_MAP_TYPE_INODE_STORAGE,   // Inode存储              │
│      BPF_MAP_TYPE_TASK_STORAGE,    // 任务存储               │
│  };                                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Map操作

```
┌─────────────────────────────────────────────────────────────┐
│                    Map操作                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 查找元素                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  void *bpf_map_lookup_elem(struct bpf_map *map,      │   │
│  │                            void *key);               │   │
│  │  // 返回值：指向value的指针，未找到返回NULL           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 更新元素                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  int bpf_map_update_elem(struct bpf_map *map,        │   │
│  │                          void *key,                  │   │
│  │                          void *value,                │   │
│  │                          u64 flags);                 │   │
│  │  // flags: BPF_ANY, BPF_NOEXIST, BPF_EXIST           │   │
│  │  // 返回值：0成功，负数失败                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 删除元素                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  int bpf_map_delete_elem(struct bpf_map *map,        │   │
│  │                          void *key);                 │   │
│  │  // 返回值：0成功，负数失败                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 获取下一个键                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  int bpf_map_get_next_key(struct bpf_map *map,       │   │
│  │                           void *key,                 │   │
│  │                           void *next_key);           │   │
│  │  // 用于遍历Map                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. Per-CPU Map操作                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // Per-CPU Map的值是per-CPU的                        │   │
│  │  // 每个CPU有独立的副本                               │   │
│  │  // 避免锁竞争，提高性能                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Map使用示例

```c
// 定义Map
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key, u32);
    __type(value, u64);
    __uint(max_entries, 1024);
} my_map SEC(".maps");

// 在eBPF程序中使用Map
SEC("xdp")
int xdp_prog(struct xdp_md *ctx)
{
    u32 key = 123;
    u64 *value, init_val = 1;

    // 查找元素
    value = bpf_map_lookup_elem(&my_map, &key);
    if (value) {
        // 找到了，增加计数
        (*value)++;
    } else {
        // 未找到，创建新条目
        bpf_map_update_elem(&my_map, &key, &init_val, BPF_ANY);
    }

    return XDP_PASS;
}
```

---

## 五、eBPF挂载点

### 5.1 kprobe挂载点

```
┌─────────────────────────────────────────────────────────────┐
│                    kprobe挂载点                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 动态插桩内核函数                                   │   │
│  │  • 在函数入口或出口触发                               │   │
│  │  • 可以访问函数参数和返回值                           │   │
│  │  • 灵活性高，但开销较大                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  示例：追踪tcp_connect函数                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SEC("kprobe/tcp_connect")                            │   │
│  │  int BPF_KPROBE(trace_tcp_connect, struct sock *sk)  │   │
│  │  {                                                    │   │
│  │      // 访问sock结构                                  │   │
│  │      bpf_printk("tcp_connect called\n");             │   │
│  │      return 0;                                        │   │
│  │  }                                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  kretprobe：函数返回时触发                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SEC("kretprobe/tcp_connect")                         │   │
│  │  int BPF_KRETPROBE(trace_tcp_connect_ret, int ret)   │   │
│  │  {                                                    │   │
│  │      // 访问返回值                                    │   │
│  │      bpf_printk("tcp_connect returned %d\n", ret);   │   │
│  │      return 0;                                        │   │
│  │  }                                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 tracepoint挂载点

```
┌─────────────────────────────────────────────────────────────┐
│                  tracepoint挂载点                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 静态追踪点，由内核开发者定义                        │   │
│  │  • 性能比kprobe好                                     │   │
│  │  • 稳定，不受内核版本影响                             │   │
│  │  • 但需要内核支持                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  查看可用tracepoint：                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  $ cat /sys/kernel/debug/tracing/available_events    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  示例：追踪网络数据包                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SEC("tracepoint/net/netif_receive_skb")             │   │
│  │  int trace_netif_receive_skb(struct trace_event_raw_ │   │
│  │                               netif_receive_skb *ctx)│   │
│  │  {                                                    │   │
│  │      // 访问skb信息                                   │   │
│  │      bpf_printk("skb received\n");                   │   │
│  │      return 0;                                        │   │
│  │  }                                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 XDP挂载点

```
┌─────────────────────────────────────────────────────────────┐
│                    XDP挂载点                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 在网卡驱动层处理数据包                              │   │
│  │  • 最早的数据包处理点                                 │   │
│  │  • 性能极高（可达10Mpps）                             │   │
│  │  • 可用于DDoS防御、负载均衡                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  XDP返回值：                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  XDP_ABORTED：程序错误，丢弃包                         │   │
│  │  XDP_DROP：丢弃数据包                                 │   │
│  │  XDP_PASS：传递给协议栈                               │   │
│  │  XDP_TX：从同一接口发送                               │   │
│  │  XDP_REDIRECT：重定向到其他接口                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  挂载XDP程序：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 使用ip命令                                        │   │
│  │  $ ip link set dev eth0 xdp obj prog.o sec xdp       │   │
│  │                                                          │   │
│  │  // 卸载XDP程序                                        │   │
│  │  $ ip link set dev eth0 xdp off                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  XDP模式：                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. XDP_MODE_NATIVE（原生模式）                        │   │
│  │     • 在网卡驱动中运行                                │   │
│  │     • 性能最高                                        │   │
│  │     • 需要驱动支持                                    │   │
│  │                                                          │   │
│  │  2. XDP_MODE_SKB（SKB模式）                            │   │
│  │     • 在内核网络栈中运行                              │   │
│  │     • 性能较低                                        │   │
│  │     • 不需要驱动支持                                  │   │
│  │                                                          │   │
│  │  3. XDP_MODE_HW（硬件模式）                            │   │
│  │     • 在网卡硬件中运行                                │   │
│  │     • 性能最高                                        │   │
│  │     • 需要硬件支持                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 TC挂载点

```
┌─────────────────────────────────────────────────────────────┐
│                    TC挂载点                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 在TC（Traffic Control）层处理数据包                 │   │
│  │  • 比XDP晚，在skb分配后                               │   │
│  │  • 可以修改数据包                                     │   │
│  │  • 支持ingress和egress                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  TC返回值：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TC_ACT_OK（0）：继续处理                             │   │
│  │  TC_ACT_SHOT（-2）：丢弃                              │   │
│  │  TC_ACT_STOLEN（-4）：消费（不继续）                  │   │
│  │  TC_ACT_REDIRECT：重定向                              │   │
│  │  TC_ACT_PIPE：继续下一个过滤器                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  挂载TC程序：                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 添加qdisc                                         │   │
│  │  $ tc qdisc add dev eth0 clsact                       │   │
│  │                                                          │   │
│  │  // 添加ingress过滤器                                  │   │
│  │  $ tc filter add dev eth0 ingress bpf obj prog.o      │   │
│  │      sec tc direct-action                              │   │
│  │                                                          │   │
│  │  // 添加egress过滤器                                   │   │
│  │  $ tc filter add dev eth0 egress bpf obj prog.o       │   │
│  │      sec tc direct-action                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、XDP程序详解

### 6.1 XDP上下文结构

```c
// XDP上下文结构
struct xdp_md {
    __u32 data;        // 数据包起始位置
    __u32 data_end;    // 数据包结束位置
    __u32 data_meta;   // 元数据起始位置
    __u32 ingress_ifindex; // 入口接口索引
    __u32 rx_queue_index;  // RX队列索引
    __u32 egress_ifindex;  // 出口接口索引（XDP_REDIRECT）
};
```

### 6.2 XDP程序基本结构

```c
// 包含必要的头文件
#include <uapi/linux/bpf.h>
#include <linux/in.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <bpf/bpf_helpers.h>

// 定义Map
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key, u32);
    __type(value, long);
    __uint(max_entries, 256);
} rxcnt SEC(".maps");

// XDP程序
SEC("xdp")
int xdp_prog(struct xdp_md *ctx)
{
    // 获取数据包边界
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;

    // 解析以太网头
    struct ethhdr *eth = data;
    if (data + sizeof(*eth) > data_end)
        return XDP_DROP;

    // 解析IP头
    struct iphdr *iph = data + sizeof(*eth);
    if ((void *)iph + sizeof(*iph) > data_end)
        return XDP_DROP;

    // 处理逻辑...

    return XDP_PASS;
}

// 许可证声明
char _license[] SEC("license") = "GPL";
```

### 6.3 XDP助手函数

```
┌─────────────────────────────────────────────────────────────┐
│                  XDP助手函数                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 数据包操作                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 调整数据包头部                                    │   │
│  │  int bpf_xdp_adjust_head(struct xdp_md *xdp, int delta);│   │
│  │                                                          │   │
│  │  // 调整数据包尾部                                    │   │
│  │  int bpf_xdp_adjust_tail(struct xdp_md *xdp, int delta);│   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 重定向                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 重定向到其他接口                                   │   │
│  │  int bpf_redirect(u32 ifindex, u64 flags);            │   │
│  │                                                          │   │
│  │  // 使用Map重定向                                      │   │
│  │  int bpf_redirect_map(struct bpf_map *map, u32 key,   │   │
│  │                       u64 flags);                      │   │
│  │                                                          │   │
│  │  // 重定向到CPU                                       │   │
│  │  int bpf_redirect_cpu(u32 cpu, u64 flags);            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 性能事件输出                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 输出到perf事件缓冲区                               │   │
│  │  int bpf_perf_event_output(struct xdp_md *xdp,        │   │
│  │                            struct bpf_map *map,        │   │
│  │                            u64 flags,                  │   │
│  │                            void *data, u64 size);      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 校验和计算                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  // 计算校验和                                        │   │
│  │  __u32 bpf_csum_diff(__be32 *from, __u32 from_size,   │   │
│  │                      __be32 *to, __u32 to_size,        │   │
│  │                      __wsum seed);                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、XDP DDoS防御示例

### 7.1 DDoS防御策略

```
┌─────────────────────────────────────────────────────────────┐
│                  DDoS防御策略                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. IP黑名单                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 丢弃来自黑名单IP的数据包                            │   │
│  │  • 动态添加/删除黑名单条目                             │   │
│  │  • 性能高：O(1)查找                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 速率限制                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 限制每个IP的包速率                                 │   │
│  │  • 超过阈值则丢弃                                     │   │
│  │  • 防止泛洪攻击                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. SYN Flood防护                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 检测SYN包速率                                      │   │
│  │  • 超过阈值则丢弃SYN包                                │   │
│  │  • 保护TCP服务                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 协议过滤                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 只允许特定协议                                     │   │
│  │  • 丢弃其他协议包                                     │   │
│  │  • 减少攻击面                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 完整的XDP DDoS防御程序

```c
// xdp_ddos_defense.c
// SPDX-License-Identifier: GPL-2.0
#include <linux/bpf.h>
#include <linux/pkt_cls.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <linux/udp.h>
#include <linux/icmp.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

// 配置常量
#define MAX_BLACKLIST_ENTRIES 10000
#define MAX_RATELIMIT_ENTRIES 10000
#define RATE_LIMIT_WINDOW_NS 1000000000ULL  // 1秒窗口
#define RATE_LIMIT_THRESHOLD 1000           // 每秒1000包

// IP黑名单Map
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key, __u32);
    __type(value, __u8);
    __uint(max_entries, MAX_BLACKLIST_ENTRIES);
} blacklist SEC(".maps");

// 速率限制Map（存储每个IP的统计信息）
struct rate_limiter {
    __u64 last_seen;  // 上次看到的时间戳
    __u64 count;      // 包计数
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __type(key, __u32);
    __type(value, struct rate_limiter);
    __uint(max_entries, MAX_RATELIMIT_ENTRIES);
} ratelimit_map SEC(".maps");

// 统计Map
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __type(key, __u32);
    __type(value, __u64);
    __uint(max_entries, 5);
} stats SEC(".maps");

enum stat_types {
    STAT_TOTAL_PKTS,
    STAT_DROPPED_BLACKLIST,
    STAT_DROPPED_RATELIMIT,
    STAT_DROPPED_PROTOCOL,
    STAT_PASSED,
};

// 解析IPv4头
static __always_inline int parse_ipv4(struct xdp_md *ctx, __u32 *src_ip,
                                       __u8 *protocol)
{
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;
    struct ethhdr *eth = data;
    struct iphdr *iph;

    // 检查以太网头
    if ((void *)(eth + 1) > data_end)
        return -1;

    // 只处理IPv4
    if (eth->h_proto != bpf_htons(ETH_P_IP))
        return -1;

    iph = (void *)(eth + 1);
    if ((void *)(iph + 1) > data_end)
        return -1;

    *src_ip = iph->saddr;
    *protocol = iph->protocol;

    return 0;
}

// 检查黑名单
static __always_inline int check_blacklist(__u32 src_ip)
{
    __u8 *value = bpf_map_lookup_elem(&blacklist, &src_ip);
    if (value)
        return 1;  // 在黑名单中
    return 0;
}

// 检查速率限制
static __always_inline int check_ratelimit(__u32 src_ip)
{
    struct rate_limiter *rl;
    __u64 now = bpf_ktime_get_ns();
    __u64 *stat;

    rl = bpf_map_lookup_elem(&ratelimit_map, &src_ip);
    if (!rl) {
        // 新条目
        struct rate_limiter new_rl = {
            .last_seen = now,
            .count = 1,
        };
        bpf_map_update_elem(&ratelimit_map, &src_ip, &new_rl, BPF_ANY);
        return 0;
    }

    // 检查是否超过时间窗口
    if (now - rl->last_seen > RATE_LIMIT_WINDOW_NS) {
        // 重置计数
        rl->last_seen = now;
        rl->count = 1;
        return 0;
    }

    // 增加计数
    rl->count++;

    // 检查是否超过阈值
    if (rl->count > RATE_LIMIT_THRESHOLD)
        return 1;  // 超过速率限制

    return 0;
}

// 更新统计
static __always_inline void update_stats(__u32 type)
{
    __u64 *value = bpf_map_lookup_elem(&stats, &type);
    if (value)
        (*value)++;
}

SEC("xdp_ddos")
int xdp_ddos_prog(struct xdp_md *ctx)
{
    __u32 src_ip;
    __u8 protocol;

    // 更新总包数统计
    update_stats(STAT_TOTAL_PKTS);

    // 解析IP头
    if (parse_ipv4(ctx, &src_ip, &protocol) < 0)
        return XDP_PASS;

    // 1. 检查黑名单
    if (check_blacklist(src_ip)) {
        update_stats(STAT_DROPPED_BLACKLIST);
        return XDP_DROP;
    }

    // 2. 检查速率限制
    if (check_ratelimit(src_ip)) {
        update_stats(STAT_DROPPED_RATELIMIT);
        return XDP_DROP;
    }

    // 3. 协议过滤（示例：只允许TCP、UDP、ICMP）
    if (protocol != IPPROTO_TCP &&
        protocol != IPPROTO_UDP &&
        protocol != IPPROTO_ICMP) {
        update_stats(STAT_DROPPED_PROTOCOL);
        return XDP_DROP;
    }

    // 通过所有检查
    update_stats(STAT_PASSED);
    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
```

### 7.3 用户态控制程序

```c
// xdp_ddos_user.c
// SPDX-License-Identifier: GPL-2.0
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <getopt.h>
#include <arpa/inet.h>
#include <bpf/libbpf.h>
#include <bpf/bpf.h>

static int blacklist_map_fd;
static int stats_map_fd;

// 添加IP到黑名单
int add_to_blacklist(const char *ip_str)
{
    struct in_addr ip;
    __u32 key;
    __u8 value = 1;

    if (inet_pton(AF_INET, ip_str, &ip) != 1) {
        fprintf(stderr, "Invalid IP address: %s\n", ip_str);
        return -1;
    }

    key = ip.s_addr;
    if (bpf_map_update_elem(blacklist_map_fd, &key, &value, BPF_ANY) != 0) {
        fprintf(stderr, "Failed to add IP to blacklist: %s\n",
                strerror(errno));
        return -1;
    }

    printf("Added %s to blacklist\n", ip_str);
    return 0;
}

// 从黑名单删除IP
int remove_from_blacklist(const char *ip_str)
{
    struct in_addr ip;
    __u32 key;

    if (inet_pton(AF_INET, ip_str, &ip) != 1) {
        fprintf(stderr, "Invalid IP address: %s\n", ip_str);
        return -1;
    }

    key = ip.s_addr;
    if (bpf_map_delete_elem(blacklist_map_fd, &key) != 0) {
        fprintf(stderr, "Failed to remove IP from blacklist: %s\n",
                strerror(errno));
        return -1;
    }

    printf("Removed %s from blacklist\n", ip_str);
    return 0;
}

// 显示统计信息
void show_stats(void)
{
    __u64 stats[5];
    __u32 key;

    for (int i = 0; i < 5; i++) {
        key = i;
        if (bpf_map_lookup_elem(stats_map_fd, &key, &stats[i]) != 0) {
            stats[i] = 0;
        }
    }

    printf("\nXDP DDoS Defense Statistics:\n");
    printf("  Total packets:    %llu\n", stats[0]);
    printf("  Dropped (blacklist): %llu\n", stats[1]);
    printf("  Dropped (ratelimit): %llu\n", stats[2]);
    printf("  Dropped (protocol):  %llu\n", stats[3]);
    printf("  Passed:           %llu\n", stats[4]);
    printf("\n");
}

int main(int argc, char **argv)
{
    struct bpf_object *obj;
    struct bpf_program *prog;
    struct bpf_map *map;
    int prog_fd;
    char *interface = "eth0";
    int opt;

    // 解析命令行参数
    while ((opt = getopt(argc, argv, "i:a:r:s")) != -1) {
        switch (opt) {
        case 'i':
            interface = optarg;
            break;
        case 'a':
            // 添加到黑名单
            add_to_blacklist(optarg);
            return 0;
        case 'r':
            // 从黑名单删除
            remove_from_blacklist(optarg);
            return 0;
        case 's':
            // 显示统计
            show_stats();
            return 0;
        default:
            fprintf(stderr, "Usage: %s [-i interface] [-a ip] [-r ip] [-s]\n",
                    argv[0]);
            return 1;
        }
    }

    // 打开并加载BPF对象
    obj = bpf_object__open_file("xdp_ddos_defense.o", NULL);
    if (libbpf_get_error(obj)) {
        fprintf(stderr, "ERROR: opening BPF object\n");
        return 1;
    }

    if (bpf_object__load(obj)) {
        fprintf(stderr, "ERROR: loading BPF object\n");
        return 1;
    }

    // 查找程序和Map
    prog = bpf_object__find_program_by_name(obj, "xdp_ddos_prog");
    if (!prog) {
        fprintf(stderr, "ERROR: finding program\n");
        return 1;
    }
    prog_fd = bpf_program__fd(prog);

    map = bpf_object__find_map_by_name(obj, "blacklist");
    blacklist_map_fd = bpf_map__fd(map);

    map = bpf_object__find_map_by_name(obj, "stats");
    stats_map_fd = bpf_map__fd(map);

    // 挂载XDP程序
    if (bpf_set_link_xdp_fd(if_nametoindex(interface), prog_fd, 0) < 0) {
        fprintf(stderr, "ERROR: attaching XDP program\n");
        return 1;
    }

    printf("XDP DDoS defense program loaded on %s\n", interface);
    printf("Use -a <ip> to add IP to blacklist\n");
    printf("Use -r <ip> to remove IP from blacklist\n");
    printf("Use -s to show statistics\n");

    // 保持运行
    while (1) {
        sleep(1);
    }

    return 0;
}
```

### 7.4 编译和运行

```bash
# 编译XDP程序
$ clang -O2 -target bpf -c xdp_ddos_defense.c -o xdp_ddos_defense.o

# 编译用户态程序
$ gcc -o xdp_ddos_user xdp_ddos_user.c -lbpf -lelf

# 加载XDP程序到网卡
$ sudo ./xdp_ddos_user -i eth0

# 添加IP到黑名单
$ sudo ./xdp_ddos_user -a 192.168.1.100

# 查看统计信息
$ sudo ./xdp_ddos_user -s

# 从黑名单删除IP
$ sudo ./xdp_ddos_user -r 192.168.1.100
```

---

## 八、调试与问题排查

### 8.1 常用调试命令

```bash
# 1. 查看已加载的BPF程序
$ bpftool prog show

# 2. 查看已加载的BPF Map
$ bpftool map show

# 3. 查看XDP程序
$ ip link show eth0

# 4. 查看BPF程序详情
$ bpftool prog dump xlated id <prog_id>

# 5. 查看JIT编译后的代码
$ bpftool prog dump jited id <prog_id>

# 6. 查看Map内容
$ bpftool map dump id <map_id>

# 7. 更新Map元素
$ bpftool map update id <map_id> key <key> value <value>

# 8. 查看tracepoint
$ cat /sys/kernel/debug/tracing/available_events

# 9. 启用trace输出
$ echo 1 > /sys/kernel/debug/tracing/options/trace_printk

# 10. 查看trace输出
$ cat /sys/kernel/debug/tracing/trace_pipe
```

### 8.2 常见问题与解决方案

```
┌─────────────────────────────────────────────────────────────┐
│                  常见问题与解决方案                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  问题1：验证器失败                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：加载BPF程序时验证失败                          │   │
│  │  原因：                                              │   │
│  │    • 内存访问越界                                    │   │
│  │    • 未检查指针边界                                  │   │
│  │    • 无限循环                                        │   │
│  │  解决：                                              │   │
│  │    • 检查所有内存访问                                │   │
│  │    • 添加边界检查                                    │   │
│  │    • 确保循环有界                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题2：XDP程序不生效                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：加载成功但不处理数据包                         │   │
│  │  原因：                                              │   │
│  │    • 网卡不支持XDP                                   │   │
│  │    • 使用了错误的模式                                │   │
│  │    • 程序逻辑错误                                    │   │
│  │  解决：                                              │   │
│  │    • 检查网卡是否支持XDP                             │   │
│  │    • 使用正确的模式（native/skb）                    │   │
│  │    • 添加调试输出                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题3：性能问题                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：XDP程序性能低                                  │   │
│  │  原因：                                              │   │
│  │    • 未使用JIT编译                                   │   │
│  │    • Map操作效率低                                   │   │
│  │    • 程序逻辑复杂                                    │   │
│  │  解决：                                              │   │
│  │    • 启用JIT编译                                     │   │
│  │    • 使用Per-CPU Map                                 │   │
│  │    • 优化程序逻辑                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题4：Map内存不足                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  症状：Map更新失败                                    │   │
│  │  原因：                                              │   │
│  │    • Map已满                                         │   │
│  │    • 内存限制                                        │   │
│  │  解决：                                              │   │
│  │    • 增加max_entries                                 │   │
│  │    • 使用LRU Map自动淘汰                             │   │
│  │    • 增加内存限制                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 性能优化建议

```
┌─────────────────────────────────────────────────────────────┐
│                  eBPF性能优化                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 使用JIT编译                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • JIT编译为本地机器码                                │   │
│  │  • 性能比解释器高10倍以上                             │   │
│  │  • 默认启用                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 使用Per-CPU Map                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 避免锁竞争                                        │   │
│  │  • 提高并发性能                                      │   │
│  │  • 适用于统计、计数器                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 使用正确的Map类型                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Array：固定大小，O(1)访问                          │   │
│  │  • Hash：动态大小，O(1)平均访问                       │   │
│  │  • LRU Hash：自动淘汰                                │   │
│  │  • Per-CPU：避免锁竞争                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 优化程序逻辑                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 尽早丢弃数据包                                    │   │
│  │  • 减少不必要的计算                                  │   │
│  │  • 使用内联函数                                      │   │
│  │  • 减少Map查找次数                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. 使用XDP native模式                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 在网卡驱动中运行                                  │   │
│  │  • 性能最高                                          │   │
│  │  • 避免SKB分配开销                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 总结

### 核心知识点回顾

```
┌─────────────────────────────────────────────────────────────┐
│                    eBPF核心知识点                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. eBPF基础                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • eBPF是扩展的BPF，在内核态运行                      │   │
│  │  • 通过验证器确保程序安全                             │   │
│  │  • JIT编译为本地代码，性能高                          │   │
│  │  • 无需修改内核源码，灵活性强                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. bpf_prog和bpf_map                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • bpf_prog：eBPF程序结构                             │   │
│  │  • bpf_map：键值存储，用于数据共享                    │   │
│  │  • 多种Map类型：Hash、Array、Per-CPU等                │   │
│  │  • Map操作：lookup、update、delete                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 挂载点                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • kprobe：动态内核函数追踪                           │   │
│  │  • tracepoint：静态追踪点                             │   │
│  │  • XDP：高性能数据包处理                              │   │
│  │  • TC：流量控制                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. XDP程序                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 在网卡驱动层处理数据包                             │   │
│  │  • 性能极高（可达10Mpps）                             │   │
│  │  • 可用于DDoS防御、负载均衡                           │   │
│  │  • 支持DROP、PASS、TX、REDIRECT                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. DDoS防御                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • IP黑名单：丢弃黑名单IP的包                         │   │
│  │  • 速率限制：限制每个IP的包速率                       │   │
│  │  • 协议过滤：只允许特定协议                           │   │
│  │  • 性能高，可线速处理                                 │   │
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
│  □ 1. 能解释什么是eBPF，以及eBPF的优势                       │
│                                                             │
│  □ 2. 能解释eBPF验证器的作用和验证内容                       │
│                                                             │
│  □ 3. 能解释bpf_prog结构的关键字段                           │
│                                                             │
│  □ 4. 能解释bpf_map结构的关键字段                            │
│                                                             │
│  □ 5. 能解释不同BPF程序类型的用途                            │
│                                                             │
│  □ 6. 能解释不同BPF Map类型的特点                            │
│                                                             │
│  □ 7. 能解释kprobe、tracepoint、XDP、TC挂载点的区别          │
│                                                             │
│  □ 8. 能编写基本的XDP程序                                    │
│                                                             │
│  □ 9. 能使用Map进行数据交互                                  │
│                                                             │
│  □ 10. 能编写XDP DDoS防御程序                                │
│                                                             │
│  □ 11. 能使用bpftool进行调试                                 │
│                                                             │
│  □ 12. 能优化eBPF程序性能                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关键代码位置

```
┌─────────────────────────────────────────────────────────────┐
│                    关键代码位置                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  eBPF核心实现：                                              │
│  • kernel/bpf/                                              │
│    - verifier.c：验证器                                      │
│    - syscall.c：系统调用                                     │
│    - core.c：核心功能                                        │
│    - hashtab.c：哈希表Map                                    │
│    - arraymap.c：数组Map                                     │
│                                                             │
│  eBPF头文件：                                                │
│  • include/linux/bpf.h                                      │
│    - struct bpf_map：Map结构                                 │
│    - struct bpf_prog_aux：程序辅助结构                       │
│  • include/linux/filter.h                                   │
│    - struct bpf_prog：程序结构                               │
│  • include/uapi/linux/bpf.h                                 │
│    - 用户态接口                                              │
│                                                             │
│  XDP实现：                                                   │
│  • net/core/xdp.c                                           │
│    - XDP核心功能                                             │
│  • drivers/net/                                             │
│    - 各网卡驱动的XDP支持                                     │
│                                                             │
│  JIT编译器：                                                 │
│  • arch/x86/net/bpf_jit_comp.c                              │
│    - x86架构JIT编译器                                        │
│  • arch/arm64/net/bpf_jit_comp.c                            │
│    - ARM64架构JIT编译器                                      │
│                                                             │
│  示例程序：                                                  │
│  • samples/bpf/                                             │
│    - 各种eBPF示例程序                                        │
│  • tools/testing/selftests/bpf/                             │
│    - eBPF测试程序                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 进一步学习

```
┌─────────────────────────────────────────────────────────────┐
│                    进一步学习方向                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. BCC工具集                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Python接口，简化eBPF开发                           │   │
│  │  • 丰富的工具集：trace、opensnoop等                   │   │
│  │  • 适合快速开发和原型                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. libbpf库                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • C语言库，直接使用eBPF                              │   │
│  │  • 性能好，适合生产环境                               │   │
│  │  • CO-RE支持，可移植性好                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. bpftrace                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 高级追踪语言                                       │   │
│  │  • 单行命令，快速追踪                                 │   │
│  │  • 适合性能分析和调试                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. Cilium                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 基于eBPF的容器网络                                 │   │
│  │  • Kubernetes网络策略                                │   │
│  │  • 负载均衡、安全策略                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. 高级特性                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • BTF（BPF Type Format）                             │   │
│  │  • CO-RE（Compile Once - Run Everywhere）             │   │
│  │  • eBPF LSM（Linux Security Module）                  │   │
│  │  • eBPF tracing                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 参考资料

1. **eBPF官方文档**: https://ebpf.io/
2. **Linux内核文档**: Documentation/bpf/
3. **BCC工具集**: https://github.com/iovisor/bcc
4. **libbpf库**: https://github.com/libbpf/libbpf
5. **bpftrace**: https://github.com/iovisor/bpftrace
6. **Cilium文档**: https://docs.cilium.io/
7. **XDP教程**: https://github.com/xdp-project/xdp-tutorial

---

**文档版本**: v1.0  
**创建时间**: 2024年  
**适用内核版本**: Linux 5.15  
**作者**: AI Assistant

---

**说明**: 本文档详细讲解了Linux内核eBPF技术，从"什么是eBPF"开始，深入分析了bpf_prog结构、bpf_map交互机制、各种挂载点（kprobe/tracepoint/XDP/TC），并提供了完整的XDP DDoS防御示例。通过本文档，读者应该能够理解eBPF的核心机制，并能够编写实际的XDP程序进行DDoS防御。