# Linux 5.15 HugePage大页详解

## 目录
1. **`引言：为什么需要HugePage`**
2. **`内存寻址基础`**
3. **`HugePage概述`**
4. **`两种大页类型`**
5. **`HugeTLB实现机制`**
6. **`Transparent Huge Page实现`**
7. **`大页的配置与使用`**
8. **`实际应用场景`**
9. **`性能分析与调优`**

---

## 一、引言：为什么需要HugePage

### 1.1 传统4KB小页的问题

在Linux内存体系中，页是内存管理的最小基础单元，默认标准页大小仅4KB。在高并发业务、数据库、中间件等大内存场景下，进程占用的虚拟内存动辄数GB，会产生海量页表项：

```
┌─────────────────────────────────────────────────────────────┐
│                    传统4KB小页的问题                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  问题1：页表项数量爆炸                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  64GB内存 / 4KB页 = 16,777,216个页表项               │   │
│  │  每个页表项8字节，总占用 = 128MB                       │   │
│  │  多进程场景下，内存开销成倍增加                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题2：TLB命中率低                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TLB容量有限（通常64-1536条目）                       │   │
│  │  4KB页覆盖范围小，TLB易被填满                          │   │
│  │  TLB miss导致频繁访问内存中的页表                      │   │
│  │  每次TLB miss增加10-100个CPU周期的延迟                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题3：Page Fault频繁                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  页面数量多，缺页异常频繁                              │   │
│  │  每次缺页异常需要内核介入处理                          │   │
│  │  上下文切换开销大                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题4：内存碎片严重                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  频繁分配释放小页导致内存碎片                          │   │
│  │  难以分配连续的大块内存                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 HugePage的解决方案

```
┌─────────────────────────────────────────────────────────────┐
│                    HugePage的优势                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  使用2MB大页：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  64GB内存 / 2MB页 = 32,768个页表项                    │   │
│  │  页表项数量减少512倍！                                 │   │
│  │  页表占用仅256KB                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  使用1GB大页：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  64GB内存 / 1GB页 = 64个页表项                        │   │
│  │  页表项数量减少262144倍！                              │   │
│  │  页表占用仅512字节                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  TLB覆盖范围扩大：                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  4KB页 × 64条目 = 256KB覆盖范围                       │   │
│  │  2MB页 × 64条目 = 128MB覆盖范围                       │   │
│  │  覆盖范围扩大512倍！                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、内存寻址基础

### 2.1 三类核心地址

```
┌─────────────────────────────────────────────────────────────┐
│                    三类核心地址                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  虚拟地址（Virtual Address）：                               │
│    - 进程或内核"看到"的地址                                  │
│    - 每个进程拥有独立的虚拟地址空间                          │
│    - 32位：0x00000000 - 0xFFFFFFFF（4GB）                    │
│    - 64位：0x0 - 0xFFFFFFFFFFFFFF（256TB）                   │
│                                                             │
│  物理地址（Physical Address）：                              │
│    - 内存芯片实际的硬件地址                                  │
│    - 对应DRAM中的存储单元                                    │
│    - 由实际安装的内存大小决定                                │
│                                                             │
│  总线地址（Bus Address）：                                   │
│    - 外设（DMA、网卡）访问内存时看到的地址                   │
│    - x86架构下与物理地址一致                                 │
│    - ARM等架构需要IOMMU转换                                  │
│                                                             │
│  转换关系：                                                  │
│    虚拟地址 ──MMU──→ 物理地址                                │
│    物理地址 ──IOMMU──→ 总线地址                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 MMU与TLB

```
┌─────────────────────────────────────────────────────────────┐
│                    MMU与TLB工作流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CPU访问内存流程：                                           │
│                                                             │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐               │
│  │   CPU   │ ──→ │   MMU   │ ──→ │  内存   │               │
│  └─────────┘     └────┬────┘     └─────────┘               │
│                       │                                     │
│                       ▼                                     │
│                 ┌───────────┐                               │
│                 │    TLB    │                               │
│                 │ (高速缓存) │                               │
│                 └───────────┘                               │
│                                                             │
│  MMU功能：                                                   │
│    1. 虚拟地址 → 物理地址转换                                │
│    2. 内存访问权限检查                                       │
│    3. 触发页错误异常                                         │
│                                                             │
│  TLB功能：                                                   │
│    - 缓存近期使用的地址映射                                  │
│    - TLB命中：1-2个CPU周期                                   │
│    - TLB未命中：需要访问内存中的页表                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 多级页表

```
┌─────────────────────────────────────────────────────────────┐
│                    x86_64四级页表结构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  虚拟地址结构（48位）：                                      │
│  ┌────────┬────────┬────────┬────────┬────────────┐        │
│  │ PGD(9) │ PUD(9) │ PMD(9) │ PTE(9) │  Offset(12)│        │
│  └────────┴────────┴────────┴────────┴────────────┘        │
│                                                             │
│  页表层级：                                                  │
│    PGD (Page Global Directory)    - 页全局目录              │
│    PUD (Page Upper Directory)     - 页上级目录              │
│    PMD (Page Middle Directory)    - 页中级目录              │
│    PTE (Page Table Entry)         - 页表项                  │
│                                                             │
│  地址转换流程：                                              │
│    PGD基址 + PGD索引 → PUD地址                              │
│    PUD地址 + PUD索引 → PMD地址                              │
│    PMD地址 + PMD索引 → PTE地址                              │
│    PTE地址 + PTE索引 → 物理页框号                           │
│    物理页框号 + Offset → 物理地址                           │
│                                                             │
│  大页的页表映射：                                            │
│    4KB页：遍历到PTE层级                                      │
│    2MB页：PMD直接指向物理页，跳过PTE                         │
│    1GB页：PUD直接指向物理页，跳过PMD和PTE                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、HugePage概述

### 3.1 什么是HugePage

HugePage（大页）是Linux系统中一种优化内存管理的技术，使用更大的页大小来管理内存：

| 页类型 | 页大小 | 适用场景 |
|--------|--------|----------|
| 标准页 | 4KB | 普通应用 |
| 大页 | 2MB | 数据库、虚拟化 |
| 巨页 | 1GB | 超大内存应用 |

### 3.2 大页的工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    大页工作原理                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  4KB小页映射：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  虚拟地址 → PGD → PUD → PMD → PTE → 物理页(4KB)      │   │
│  │                                                      │   │
│  │  一个PMD覆盖：512个PTE × 4KB = 2MB                    │   │
│  │  一个PUD覆盖：512个PMD × 2MB = 1GB                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2MB大页映射：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  虚拟地址 → PGD → PUD → PMD → 物理页(2MB)             │   │
│  │                                                      │   │
│  │  PMD的PSE位设置为1，表示这是大页                       │   │
│  │  跳过PTE层级，减少一次内存访问                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  1GB大页映射：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  虚拟地址 → PGD → PUD → 物理页(1GB)                   │   │
│  │                                                      │   │
│  │  PUD的PSE位设置为1，跳过PMD和PTE                       │   │
│  │  页表遍历减少两次内存访问                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 大页的核心优势

```
┌─────────────────────────────────────────────────────────────┐
│                    大页核心优势                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 减少页表项数量                                           │
│     - 页表占用内存大幅减少                                   │
│     - 更多内存可用于应用程序                                 │
│                                                             │
│  2. 提高TLB命中率                                           │
│     - TLB覆盖范围扩大512倍（2MB）或262144倍（1GB）           │
│     - 减少TLB miss导致的延迟                                 │
│                                                             │
│  3. 减少Page Fault                                          │
│     - 缺页异常次数大幅减少                                   │
│     - 减少内核介入开销                                       │
│                                                             │
│  4. 降低内存碎片                                            │
│     - 大块内存分配更连续                                     │
│     - 提高内存利用率                                         │
│                                                             │
│  5. 加快地址转换                                            │
│     - 页表遍历层级减少                                       │
│     - 内存访问次数减少                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、两种大页类型

### 4.1 HugeTLB vs Transparent Huge Page

```
┌─────────────────────────────────────────────────────────────┐
│                    两种大页类型对比                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HugeTLB（静态大页）：                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  特点：                                               │   │
│  │    - 需要预先分配和配置                               │   │
│  │    - 应用程序需要显式使用（mmap、shmget）             │   │
│  │    - 内存预留，不会被交换                             │   │
│  │    - 提供最稳定的性能保证                             │   │
│  │                                                      │   │
│  │  适用场景：                                           │   │
│  │    - 数据库（Oracle、MySQL）                          │   │
│  │    - 虚拟化（KVM、QEMU）                              │   │
│  │    - 对性能要求极高的应用                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Transparent Huge Page（透明大页）：                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  特点：                                               │   │
│  │    - 内核自动管理，对应用透明                         │   │
│  │    - 无需修改应用程序                                 │   │
│  │    - 可以被分裂和合并                                 │   │
│  │    - 可能被交换到磁盘                                 │   │
│  │                                                      │   │
│  │  适用场景：                                           │   │
│  │    - 一般应用程序                                     │   │
│  │    - 需要自动优化的场景                               │   │
│  │    - 对代码改动敏感的场景                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 详细对比

| 特性 | HugeTLB | Transparent Huge Page |
|------|---------|----------------------|
| 分配方式 | 预先静态分配 | 动态自动分配 |
| 应用感知 | 需要显式使用 | 完全透明 |
| 内存预留 | 是 | 否 |
| 可交换 | 否 | 是 |
| 配置复杂度 | 高 | 低 |
| 性能稳定性 | 最高 | 较高 |
| 内存灵活性 | 低 | 高 |

---

## 五、HugeTLB实现机制

### 5.1 核心数据结构

定义在 **`include/linux/hugetlb.h`**：

```c
/*
 * hstate - 描述一种大页大小的状态
 * 系统可以支持多种大页大小，每种大小对应一个hstate
 */
struct hstate {
    struct mutex resize_lock;           /* 调整大小锁 */
    int next_nid_to_alloc;              /* 下一个分配的NUMA节点 */
    int next_nid_to_free;               /* 下一个释放的NUMA节点 */
    unsigned int order;                 /* 大页的阶数（2^order个4KB页） */
    unsigned long mask;                 /* 大页掩码 */
    unsigned long max_huge_pages;       /* 最大大页数量 */
    unsigned long nr_huge_pages;        /* 当前大页总数 */
    unsigned long free_huge_pages;      /* 空闲大页数量 */
    unsigned long resv_huge_pages;      /* 预留大页数量 */
    unsigned long surplus_huge_pages;   /* 超额大页数量 */
    unsigned long nr_overcommit_huge_pages; /* 超额提交数量 */
    struct list_head hugepage_activelist;    /* 活跃大页链表 */
    struct list_head hugepage_freelists[MAX_NUMNODES]; /* 空闲链表 */
    unsigned int nr_huge_pages_node[MAX_NUMNODES];    /* 每节点数量 */
    unsigned int free_huge_pages_node[MAX_NUMNODES];  /* 每节点空闲 */
    unsigned int surplus_huge_pages_node[MAX_NUMNODES]; /* 每节点超额 */
    char name[HSTATE_NAME_LEN];         /* 大页名称 */
};

/*
 * 获取大页大小
 */
static inline unsigned long huge_page_size(struct hstate *h)
{
    return (unsigned long)PAGE_SIZE << h->order;
}

/*
 * 获取大页阶数
 */
static inline unsigned int huge_page_order(struct hstate *h)
{
    return h->order;
}

/*
 * 获取每个大页包含的4KB页数
 */
static inline unsigned int pages_per_huge_page(struct hstate *h)
{
    return 1 << h->order;
}
```

### 5.2 大页子池

```c
/*
 * hugepage_subpool - 大页子池
 * 用于限制特定应用或用户的大页使用量
 */
struct hugepage_subpool {
    spinlock_t lock;              /* 保护锁 */
    long count;                   /* 引用计数 */
    long max_hpages;              /* 最大大页数，-1表示无限制 */
    long used_hpages;             /* 已使用大页数 */
    struct hstate *hstate;        /* 所属的hstate */
    long min_hpages;              /* 最小大页数 */
    long rsv_hpages;              /* 预留大页数 */
};
```

### 5.3 预留映射

```c
/*
 * resv_map - 预留映射
 * 跟踪共享内存或文件映射的大页预留
 */
struct resv_map {
    struct kref refs;             /* 引用计数 */
    spinlock_t lock;              /* 保护锁 */
    struct list_head regions;     /* 区域链表 */
    long adds_in_progress;        /* 正在添加的数量 */
    struct list_head region_cache; /* 区域缓存 */
    long region_cache_count;      /* 缓存计数 */
};

/*
 * file_region - 文件区域
 * 表示一个预留区域
 */
struct file_region {
    struct list_head link;        /* 链表链接 */
    long from;                    /* 起始索引 */
    long to;                      /* 结束索引（不包含） */
};
```

### 5.4 大页分配

定义在 **`mm/hugetlb.c`**：

```c
/*
 * alloc_huge_page - 分配一个大页
 * @vma: 虚拟内存区域
 * @addr: 地址
 * @avoid_reserve: 是否避免使用预留
 */
struct page *alloc_huge_page(struct vm_area_struct *vma,
                             unsigned long addr, int avoid_reserve)
{
    struct hugepage_subpool *spool = subpool_vma(vma);
    struct hstate *h = hstate_vma(vma);
    struct page *page;
    long map_chg, map_commit;
    long gbl_chg;
    int ret, idx;
    struct hugetlb_cgroup *h_cg;
    bool deferred_reserve;

    /* 
     * 步骤1：检查预留
     * 检查是否有预留可用，如果没有需要从全局池分配
     */
    
    /* 步骤2：从空闲链表获取大页 */
    idx = hstate_index(h);
    hugetlb_fault_mutex_hash(h, mapping, idx);
    
    /* 从per-node空闲链表分配 */
    page = dequeue_huge_page(h, gfp_mask, nid, nodemask);
    
    /* 步骤3：如果没有空闲页，尝试分配新页 */
    if (!page) {
        page = alloc_fresh_huge_page(h, gfp_mask, nid, nodemask);
    }
    
    /* 步骤4：更新统计信息 */
    h->nr_huge_pages++;
    h->free_huge_pages--;
    
    return page;
}
```

### 5.5 大页初始化

```c
/*
 * hugetlb_init - HugeTLB子系统初始化
 */
static int __init hugetlb_init(void)
{
    int i;

    /* 检查硬件是否支持大页 */
    if (!hugepages_supported()) {
        pr_warn("HugeTLB: huge pages not supported\n");
        return 0;
    }

    /* 初始化默认大页大小 */
    for_each_hstate(h) {
        /* 预分配大页 */
        for (i = 0; i < h->max_huge_pages; ++i) {
            if (!alloc_fresh_huge_page(h, GFP_KERNEL))
                break;
        }
    }

    /* 初始化故障互斥表 */
    hugetlb_fault_mutex_table = kmalloc_array(num_fault_mutexes,
                                              sizeof(struct mutex),
                                              GFP_KERNEL);
    
    return 0;
}
subsys_initcall(hugetlb_init);
```

### 5.6 hugetlbfs文件系统

定义在 **`fs/hugetlbfs/inode.c`**：

```c
/*
 * hugetlbfs - 大页文件系统
 * 提供使用大页的接口
 * 
 * 挂载示例：
 *   mount -t hugetlbfs nodev /mnt/huge -o pagesize=2M,size=1G
 */
static const struct super_operations hugetlbfs_ops;
static const struct address_space_operations hugetlbfs_aops;
const struct file_operations hugetlbfs_file_operations;

/*
 * hugetlbfs文件系统超级块信息
 */
struct hugetlbfs_sb_info {
    struct hstate *hstate;        /* 大页状态 */
    struct hugepage_subpool *spool; /* 大页子池 */
    kuid_t uid;                   /* 用户ID */
    kgid_t gid;                   /* 组ID */
    umode_t mode;                 /* 权限模式 */
};

/*
 * 通过inode获取hstate
 */
static inline struct hstate *hstate_inode(struct inode *i)
{
    return HUGETLBFS_SB(i->i_sb)->hstate;
}
```

---

## 六、Transparent Huge Page实现

### 6.1 THP概述

定义在 **`include/linux/huge_mm.h`**：

```c
/*
 * THP配置标志
 */
enum transparent_hugepage_flag {
    TRANSPARENT_HUGEPAGE_NEVER_DAX,         /* DAX设备不支持 */
    TRANSPARENT_HUGEPAGE_FLAG,              /* 总是启用 */
    TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG,     /* 需要madvise请求 */
    TRANSPARENT_HUGEPAGE_DEFRAG_DIRECT_FLAG, /* 直接整理 */
    TRANSPARENT_HUGEPAGE_DEFRAG_KSWAPD_FLAG, /* kswapd整理 */
    TRANSPARENT_HUGEPAGE_DEFRAG_KSWAPD_OR_MADV_FLAG,
    TRANSPARENT_HUGEPAGE_DEFRAG_REQ_MADV_FLAG,
    TRANSPARENT_HUGEPAGE_DEFRAG_KHUGEPAGED_FLAG, /* khugepaged整理 */
    TRANSPARENT_HUGEPAGE_USE_ZERO_PAGE_FLAG, /* 使用零页 */
};

/*
 * 大页大小定义
 */
#define HPAGE_PMD_SHIFT PMD_SHIFT           /* 2MB */
#define HPAGE_PMD_SIZE  ((1UL) << HPAGE_PMD_SHIFT)
#define HPAGE_PMD_MASK  (~(HPAGE_PMD_SIZE - 1))

#define HPAGE_PUD_SHIFT PUD_SHIFT           /* 1GB */
#define HPAGE_PUD_SIZE  ((1UL) << HPAGE_PUD_SHIFT)
#define HPAGE_PUD_MASK  (~(HPAGE_PUD_SIZE - 1))

/*
 * 每个大页包含的4KB页数
 */
#define HPAGE_PMD_ORDER (HPAGE_PMD_SHIFT - PAGE_SHIFT)
#define HPAGE_PMD_NR (1 << HPAGE_PMD_ORDER)  /* 512 */
```

### 6.2 THP启用检查

```c
/*
 * __transparent_hugepage_enabled - 检查THP是否启用
 */
static inline bool __transparent_hugepage_enabled(struct vm_area_struct *vma)
{
    /* 硬件/固件标记不支持 */
    if (transparent_hugepage_flags & (1 << TRANSPARENT_HUGEPAGE_NEVER_DAX))
        return false;

    /* 通过madvise显式禁用 */
    if ((vma->vm_flags & VM_NOHUGEPAGE) ||
        test_bit(MMF_DISABLE_THP, &vma->vm_mm->flags))
        return false;

    /* 临时栈不使用THP */
    if (vma_is_temporary_stack(vma))
        return false;

    /* 总是启用模式 */
    if (transparent_hugepage_flags & (1 << TRANSPARENT_HUGEPAGE_FLAG))
        return true;

    /* DAX设备 */
    if (vma_is_dax(vma))
        return true;

    /* madvise请求模式 */
    if (transparent_hugepage_flags & (1 << TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG))
        return !!(vma->vm_flags & VM_HUGEPAGE);

    return false;
}
```

### 6.3 khugepaged守护进程

定义在 **`include/linux/khugepaged.h`**：

```c
/*
 * khugepaged - 透明大页合并守护进程
 * 
 * 功能：
 *   - 定期扫描进程的内存区域
 *   - 将连续的小页合并成大页
 *   - 减少内存碎片，提高大页利用率
 */

/* 检查khugepaged是否启用 */
#define khugepaged_enabled() \
    (transparent_hugepage_flags & \
     ((1 << TRANSPARENT_HUGEPAGE_FLAG) | \
      (1 << TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG)))

/* 总是模式 */
#define khugepaged_always() \
    (transparent_hugepage_flags & (1 << TRANSPARENT_HUGEPAGE_FLAG))

/* madvise请求模式 */
#define khugepaged_req_madv() \
    (transparent_hugepage_flags & (1 << TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG))

/*
 * 进程进入khugepaged管理
 */
static inline int khugepaged_enter(struct vm_area_struct *vma,
                                    unsigned long vm_flags)
{
    if (!test_bit(MMF_VM_HUGEPAGE, &vma->vm_mm->flags))
        if ((khugepaged_always() ||
             (khugepaged_req_madv() && (vm_flags & VM_HUGEPAGE))) &&
            !(vm_flags & VM_NOHUGEPAGE))
            if (__khugepaged_enter(vma->vm_mm))
                return -ENOMEM;
    return 0;
}
```

### 6.4 THP页面处理

```c
/*
 * do_huge_pmd_anonymous_page - 处理匿名大页缺页
 */
vm_fault_t do_huge_pmd_anonymous_page(struct vm_fault *vmf);

/*
 * do_huge_pmd_wp_page - 处理大页写时复制
 */
vm_fault_t do_huge_pmd_wp_page(struct vm_fault *vmf);

/*
 * split_huge_page - 分裂大页为小页
 */
int split_huge_page(struct page *page);

/*
 * split_huge_pmd - 分裂PMD大页
 */
#define split_huge_pmd(__vma, __pmd, __address) \
    do { \
        pmd_t *____pmd = (__pmd); \
        if (is_swap_pmd(*____pmd) || pmd_trans_huge(*____pmd) || \
            pmd_devmap(*____pmd)) \
            __split_huge_pmd(__vma, __pmd, __address, false, NULL); \
    } while (0)

/*
 * thp_order - 获取大页阶数
 */
static inline unsigned int thp_order(struct page *page)
{
    VM_BUG_ON_PGFLAGS(PageTail(page), page);
    if (PageHead(page))
        return HPAGE_PMD_ORDER;
    return 0;
}

/*
 * thp_nr_pages - 获取大页包含的页数
 */
static inline int thp_nr_pages(struct page *page)
{
    VM_BUG_ON_PGFLAGS(PageTail(page), page);
    if (PageHead(page))
        return HPAGE_PMD_NR;
    return 1;
}
```

### 6.5 THP初始化

```c
/*
 * setup_transparent_hugepage - 内核启动参数解析
 * 
 * 参数：
 *   transparent_hugepage=always  总是使用THP
 *   transparent_hugepage=madvise 需要madvise请求
 *   transparent_hugepage=never   从不使用THP
 */
static int __init setup_transparent_hugepage(char *str)
{
    int ret = 0;
    if (!str)
        goto out;
    if (!strcmp(str, "always")) {
        set_bit(TRANSPARENT_HUGEPAGE_FLAG, &transparent_hugepage_flags);
        clear_bit(TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG,
                  &transparent_hugepage_flags);
        ret = 1;
    } else if (!strcmp(str, "madvise")) {
        clear_bit(TRANSPARENT_HUGEPAGE_FLAG, &transparent_hugepage_flags);
        set_bit(TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG,
                &transparent_hugepage_flags);
        ret = 1;
    } else if (!strcmp(str, "never")) {
        clear_bit(TRANSPARENT_HUGEPAGE_FLAG, &transparent_hugepage_flags);
        clear_bit(TRANSPARENT_HUGEPAGE_REQ_MADV_FLAG,
                  &transparent_hugepage_flags);
        ret = 1;
    }
out:
    if (!ret)
        pr_warn("transparent_hugepage: bad option '%s'\n", str);
    return ret;
}
early_param("transparent_hugepage", setup_transparent_hugepage);
```

---

## 七、大页的配置与使用

### 7.1 HugeTLB配置

```bash
# 查看当前大页配置
cat /proc/meminfo | grep Huge

# 输出示例：
# HugePages_Total:    1024    # 总大页数
# HugePages_Free:      512    # 空闲大页数
# HugePages_Rsvd:      256    # 预留大页数
# HugePages_Surp:        0    # 超额大页数
# Hugepagesize:       2048    # 大页大小（KB）

# 设置大页数量（需要root权限）
echo 1024 > /proc/sys/vm/nr_hugepages

# 或使用sysctl
sysctl -w vm.nr_hugepages=1024

# 永久配置（写入/etc/sysctl.conf）
vm.nr_hugepages = 1024

# 查看NUMA节点的大页分布
cat /sys/devices/system/node/node*/meminfo | grep Huge

# 设置特定NUMA节点的大页数量
echo 512 > /sys/devices/system/node/node0/hugepages/hugepages-2048kB/nr_hugepages
echo 512 > /sys/devices/system/node/node1/hugepages/hugepages-2048kB/nr_hugepages
```

### 7.2 多种大页大小配置

```bash
# 查看支持的大页大小
cat /proc/meminfo | grep hugepages

# 输出示例：
# hugepages-2048kB:    1024
# hugepages-1048576kB:    4

# 设置1GB大页
echo 4 > /sys/kernel/mm/hugepages/hugepages-1048576kB/nr_hugepages

# 内核启动参数配置
# 在/boot/grub/grub.cfg或/etc/default/grub中添加：
GRUB_CMDLINE_LINUX="hugepagesz=2M hugepages=1024 hugepagesz=1G hugepages=4"
```

### 7.3 hugetlbfs挂载

```bash
# 创建挂载点
mkdir -p /mnt/huge

# 挂载hugetlbfs（默认2MB大页）
mount -t hugetlbfs nodev /mnt/huge

# 挂载指定大小和页数
mount -t hugetlbfs nodev /mnt/huge -o pagesize=2M,size=2G

# 挂载选项说明：
# pagesize=2M    - 大页大小
# size=2G        - 最大使用量
# min_size=1G    - 最小使用量
# mode=0770      - 权限
# uid=1000       - 用户ID
# gid=1000       - 组ID

# 永久挂载（/etc/fstab）
nodev /mnt/huge hugetlbfs pagesize=2M,size=2G,mode=0770 0 0
```

### 7.4 THP配置

```bash
# 查看THP配置
cat /sys/kernel/mm/transparent_hugepage/enabled

# 输出示例：
# always [madvise] never

# 设置THP模式
echo always > /sys/kernel/mm/transparent_hugepage/enabled
echo madvise > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/enabled

# 查看碎片整理配置
cat /sys/kernel/mm/transparent_hugepage/defrag

# 设置碎片整理模式
echo defer > /sys/kernel/mm/transparent_hugepage/defrag

# 查看khugepaged配置
cat /sys/kernel/mm/transparent_hugepage/khugepaged/defrag
cat /sys/kernel/mm/transparent_hugepage/khugepaged/pages_to_scan
cat /sys/kernel/mm/transparent_hugepage/khugepaged/scan_sleep_millisecs

# 内核启动参数
GRUB_CMDLINE_LINUX="transparent_hugepage=always"
```

### 7.5 应用程序使用大页

#### 使用HugeTLB（mmap方式）

```c
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>

#define HP_SIZE (2 * 1024 * 1024)  /* 2MB */

void *allocate_hugepage(size_t size)
{
    int fd;
    void *addr;

    /* 方法1：通过hugetlbfs文件 */
    fd = open("/mnt/huge/myfile", O_CREAT | O_RDWR, 0666);
    if (fd < 0)
        return NULL;

    addr = mmap(NULL, size, PROT_READ | PROT_WRITE,
                MAP_SHARED, fd, 0);
    close(fd);

    if (addr == MAP_FAILED)
        return NULL;

    return addr;
}

/* 方法2：使用MAP_HUGETLB标志 */
void *allocate_hugepage_anon(size_t size)
{
    void *addr;

    addr = mmap(NULL, size, PROT_READ | PROT_WRITE,
                MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB,
                -1, 0);

    if (addr == MAP_FAILED)
        return NULL;

    return addr;
}
```

#### 使用HugeTLB（共享内存方式）

```c
#include <sys/shm.h>
#include <sys/ipc.h>

#define SHM_HUGETLB 04000   /* 使用大页 */
#define SHM_HUGE_2MB (21 << 26)  /* 2MB大页 */

void *allocate_shm_hugepage(size_t size)
{
    int shmid;
    void *addr;

    /* 创建共享内存，使用大页 */
    shmid = shmget(IPC_PRIVATE, size,
                   IPC_CREAT | SHM_HUGETLB | SHM_HUGE_2MB | 0600);
    if (shmid < 0)
        return NULL;

    /* 附加共享内存 */
    addr = shmat(shmid, NULL, 0);
    if (addr == (void *)-1) {
        shmctl(shmid, IPC_RMID, NULL);
        return NULL;
    }

    return addr;
}
```

#### 使用THP（madvise方式）

```c
#include <sys/mman.h>
#include <malloc.h>

void enable_thp(void *addr, size_t size)
{
    /* 建议内核使用大页 */
    madvise(addr, size, MADV_HUGEPAGE);
}

void disable_thp(void *addr, size_t size)
{
    /* 禁止使用大页 */
    madvise(addr, size, MADV_NOHUGEPAGE);
}

/* 使用示例 */
void example_thp_usage(void)
{
    size_t size = 100 * 1024 * 1024;  /* 100MB */
    void *addr;

    /* 分配内存 */
    addr = mmap(NULL, size, PROT_READ | PROT_WRITE,
                MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);

    /* 启用THP */
    enable_thp(addr, size);

    /* 使用内存... */

    /* 释放 */
    munmap(addr, size);
}
```

---

## 八、实际应用场景

### 8.1 数据库应用

```
┌─────────────────────────────────────────────────────────────┐
│                    数据库使用大页                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Oracle数据库：                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # 计算需要的大页数量                                 │   │
│  │  # SGA大小 = 内存目标 + 内存最大值                    │   │
│  │  HugePages = SGA / Hugepagesize + 1                  │   │
│  │                                                      │   │
│  │  # 配置                                              │   │
│  │  vm.nr_hugepages = 2048                              │   │
│  │                                                      │   │
│  │  # Oracle参数                                        │   │
│  │  USE_LARGE_PAGES = ONLY                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  MySQL数据库：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # my.cnf配置                                        │   │
│  │  [mysqld]                                            │   │
│  │  large-pages                                         │   │
│  │  innodb_buffer_pool_size = 8G                        │   │
│  │                                                      │   │
│  │  # 系统配置                                          │   │
│  │  vm.nr_hugepages = 4096                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  PostgreSQL：                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # postgresql.conf                                   │   │
│  │  huge_pages = on                                     │   │
│  │  shared_buffers = 4GB                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 虚拟化应用

```
┌─────────────────────────────────────────────────────────────┐
│                    虚拟化使用大页                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  KVM/QEMU：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # 启动虚拟机时指定大页                               │   │
│  │  qemu-system-x86_64 -m 4G \                          │   │
│  │      -mem-path /mnt/huge \                           │   │
│  │      -mem-prealloc \                                 │   │
│  │      ...                                             │   │
│  │                                                      │   │
│  │  # 或使用libvirt配置                                 │   │
│  │  <memoryBacking>                                     │   │
│  │    <hugepages>                                       │   │
│  │      <page size='2' unit='MiB' nodeset='0'/>         │   │
│  │    </hugepages>                                      │   │
│  │  </memoryBacking>                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  优势：                                                      │
│    - 减少虚拟机内存虚拟化开销                                │
│    - 提高虚拟机内存访问性能                                  │
│    - 降低TLB miss率                                         │
│    - 减少宿主机内核内存占用                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 大数据应用

```
┌─────────────────────────────────────────────────────────────┐
│                    大数据使用大页                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Spark：                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # spark-env.sh                                      │   │
│  │  export SPARK_DRIVER_MEMORY=8g                       │   │
│  │  export SPARK_EXECUTOR_MEMORY=16g                    │   │
│  │                                                      │   │
│  │  # 启用THP                                           │   │
│  │  echo always > /sys/kernel/mm/transparent_hugepage/enabled │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Redis：                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  # redis.conf                                        │   │
│  │  # 使用THP可以提高大内存实例的性能                    │   │
│  │  # 但需要注意延迟问题                                │   │
│  │                                                      │   │
│  │  # 建议使用madvise模式                               │   │
│  │  echo madvise > /sys/kernel/mm/transparent_hugepage/enabled │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、性能分析与调优

### 9.1 性能监控

```bash
# 查看大页使用情况
cat /proc/meminfo | grep -i huge

# 查看进程的大页使用
cat /proc/<pid>/smaps | grep -i huge

# 查看THP统计
cat /sys/kernel/mm/transparent_hugepage/stats/*

# 输出示例：
# thp_fault_alloc      : 12345    # 缺页时分配的大页数
# thp_fault_fallback   : 123      # 缺页时回退到小页数
# thp_collapse_alloc   : 5678     # 合并分配的大页数
# thp_collapse_alloc_failed : 45  # 合并分配失败数
# thp_split            : 234      # 分裂的大页数
# thp_zero_page_alloc  : 12       # 零页分配数

# 使用perf分析TLB miss
perf stat -e dTLB-load-misses,dTLB-store-misses ./your_program

# 使用bpftool跟踪大页事件
bpftool prog tracelog
```

### 9.2 性能调优建议

```
┌─────────────────────────────────────────────────────────────┐
│                    性能调优建议                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HugeTLB调优：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 根据应用需求精确计算大页数量                       │   │
│  │     避免浪费或不足                                   │   │
│  │                                                      │   │
│  │  2. NUMA系统上均匀分布大页                           │   │
│  │     提高本地访问比例                                 │   │
│  │                                                      │   │
│  │  3. 预留足够的大页                                   │   │
│  │     避免运行时分配失败                               │   │
│  │                                                      │   │
│  │  4. 监控大页使用率                                   │   │
│  │     及时调整配置                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  THP调优：                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 选择合适的启用模式                               │   │
│  │     - always：适合大内存应用                         │   │
│  │     - madvise：适合混合场景                          │   │
│  │     - never：适合延迟敏感应用                        │   │
│  │                                                      │   │
│  │  2. 调整碎片整理策略                                 │   │
│  │     - defer：延迟整理，减少延迟                       │   │
│  │     - defer+madvise：平衡性能和延迟                   │   │
│  │                                                      │   │
│  │  3. 调整khugepaged参数                               │   │
│  │     - pages_to_scan：每次扫描页数                    │   │
│  │     - scan_sleep_millisecs：扫描间隔                 │   │
│  │                                                      │   │
│  │  4. 监控分裂和合并统计                               │   │
│  │     识别性能问题                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 常见问题排查

```bash
# 问题1：大页分配失败
dmesg | grep -i "huge"
# 检查是否有足够的连续内存
cat /proc/buddyinfo

# 问题2：THP导致延迟
# 检查是否有大量分裂
cat /sys/kernel/mm/transparent_hugepage/stats/thp_split
# 考虑使用madvise模式

# 问题3：内存使用异常
# 检查进程的内存映射
pmap -x <pid>
cat /proc/<pid>/maps

# 问题4：NUMA不均衡
# 检查各节点大页使用
numactl --hardware
cat /sys/devices/system/node/node*/meminfo
```

---

## 十、总结

### 10.1 核心要点

| 概念 | 说明 |
|------|------|
| HugePage | 使用大于4KB的页管理内存 |
| HugeTLB | 静态预分配大页，需要显式使用 |
| THP | 动态透明大页，内核自动管理 |
| hstate | 描述一种大页大小的状态 |
| khugepaged | THP合并守护进程 |

### 10.2 API速查表

| API | 作用 | 使用场景 |
|-----|------|----------|
| mmap(MAP_HUGETLB) | 匿名大页映射 | HugeTLB使用 |
| shmget(SHM_HUGETLB) | 共享内存大页 | 进程间共享 |
| madvise(MADV_HUGEPAGE) | 启用THP | THP优化 |
| madvise(MADV_NOHUGEPAGE) | 禁用THP | 延迟敏感 |

### 10.3 配置文件

| 文件 | 说明 |
|------|------|
| /proc/sys/vm/nr_hugepages | HugeTLB数量 |
| /sys/kernel/mm/transparent_hugepage/enabled | THP启用模式 |
| /proc/meminfo | 大页使用统计 |

### 10.4 进一步学习

- **`include/linux/hugetlb.h`** - HugeTLB头文件
- **`mm/hugetlb.c`** - HugeTLB实现
- **`include/linux/huge_mm.h`** - THP头文件
- **`mm/huge_memory.c`** - THP实现
- **`mm/khugepaged.c`** - khugepaged实现
- Documentation/admin-guide/mm/hugetlbpage.rst - HugeTLB文档
- Documentation/admin-guide/mm/transhuge.rst - THP文档

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了HugePage大页机制的原理、实现、配置与使用。理解大页机制是进行Linux内存性能优化的关键基础。*
