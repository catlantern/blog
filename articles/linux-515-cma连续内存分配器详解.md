# Linux 5.15 CMA（连续内存分配器）详解

## 目录
1. **`引言：为什么需要CMA`**
2. **`CMA核心概念`**
3. **`CMA数据结构`**
4. **`CMA初始化流程`**
5. **`CMA内存分配`**
6. **`CMA内存释放`**
7. **`页面迁移机制`**
8. **`CMA配置与使用`**
9. **`实际应用场景`**
10. **`常见问题与调优`**

---

## 一、引言：为什么需要CMA

### 1.1 一个真实的问题场景

在嵌入式系统和多媒体应用中，经常遇到这样的问题：

```
┌─────────────────────────────────────────────────────────────┐
│                    摄像头启动失败！                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  错误信息：                                                  │
│    [CAMERA] Failed to allocate 8MB contiguous buffer        │
│    [CAMERA] DMA buffer allocation failed                    │
│                                                             │
│  问题分析：                                                  │
│    - 系统有足够的空闲内存（> 1GB）                           │
│    - 但无法找到连续的8MB物理内存                             │
│    - 原因：内存碎片化严重                                     │
│                                                             │
│  内存状态：                                                  │
│    ┌───────────────────────────────────────────────────┐   │
│    │ 内存布局（碎片化）：                                │   │
│    │ [4KB][4KB][8KB][4KB][16KB][4KB][4KB][8KB]...       │   │
│    │                                                     │   │
│    │ 总空闲内存：1024 MB                                  │   │
│    │ 最大连续块：2 MB                                     │   │
│    │ 需要的连续块：8 MB                                   │   │
│    └───────────────────────────────────────────────────┘   │
│                                                             │
│  为什么需要连续内存？                                        │
│    - 硬件DMA控制器不支持scatter-gather                       │
│    - 摄像头、视频编解码器需要连续缓冲区                       │
│    - 某些设备没有IOMMU支持                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 内存碎片化问题

```
┌─────────────────────────────────────────────────────────────┐
│                    内存碎片化示意图                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  系统刚启动时（内存连续）：                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ████████████████████████████████████████████████    │   │
│  │ ↑                                                  │   │
│  │ 连续的空闲内存                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  运行一段时间后（内存碎片化）：                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ██░░██░░░░██░░██░░██░░░░██░░██░░░░██░░██░░██░░░░██ │   │
│  │ ↑  ↑  ↑   ↑  ↑  ↑   ↑  ↑  ↑   ↑  ↑  ↑  ↑   ↑  ↑  │   │
│  │ 已用 空闲 已用 空闲 ...（大量小碎片）                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题：                                                      │
│    - 总空闲内存充足                                          │
│    - 但无法分配大块连续内存                                   │
│    - 伙伴系统最高order有限制（通常4MB）                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 传统解决方案的问题

| 方案 | 描述 | 问题 |
|------|------|------|
| 静态预留 | 启动时预留固定内存 | 内存浪费，利用率低 |
| 伙伴系统 | 分配高order页面 | 碎片化后难以成功 |
| 内存规整 | 运行时整理内存 | 耗时，可能失败 |
| **CMA** | 动态预留+页面迁移 | **平衡利用率与连续性** |

### 1.4 CMA的核心价值

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA核心价值                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 保证连续内存供应                                         │
│     - 预留专用内存区域                                       │
│     - 设备需要时必定可用                                     │
│                                                             │
│  2. 提高内存利用率                                           │
│     - 空闲时可被伙伴系统使用                                 │
│     - 只存放可迁移页面                                       │
│                                                             │
│  3. 动态内存管理                                             │
│     - 需要时迁移走占用页面                                   │
│     - 释放后可再次被复用                                     │
│                                                             │
│  4. 对应用透明                                               │
│     - 设备驱动无需特殊处理                                   │
│     - 自动处理页面迁移                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、CMA核心概念

### 2.1 什么是CMA

**CMA（Contiguous Memory Allocator，连续内存分配器）** 是Linux内核提供的一种内存管理机制，专门用于解决大块连续物理内存分配问题。

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA工作原理                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  系统启动时：                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 物理内存：                                           │   │
│  │ [普通内存区域] [CMA预留区域] [普通内存区域]          │   │
│  │                  ↑                                   │   │
│  │            256MB连续内存                             │   │
│  │            标记为MIGRATE_CMA                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  设备未使用时（内存复用）：                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ CMA区域状态：                                        │   │
│  │ [可移动页][可移动页][可移动页][可移动页][可移动页]   │   │
│  │    ↑         ↑         ↑                            │   │
│  │  伙伴系统可以分配可移动页面                           │   │
│  │  提高内存利用率                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  设备需要内存时（页面迁移）：                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 步骤1：隔离CMA区域                                   │   │
│  │ [隔离页][隔离页][隔离页][隔离页][隔离页]             │   │
│  │                                                     │   │
│  │ 步骤2：迁移占用页面                                  │   │
│  │ [空闲][空闲][空闲][空闲][空闲]                       │   │
│  │   ↓      ↓      ↓      ↓      ↓                     │   │
│  │ 迁移到其他内存区域                                    │   │
│  │                                                     │   │
│  │ 步骤3：分配连续内存                                  │   │
│  │ [设备缓冲区 - 连续的256MB]                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 CMA的关键特性

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA关键特性                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 预留机制                                                 │
│     - 系统启动时预留连续物理内存                             │
│     - 通过memblock保留                                      │
│     - 可通过设备树或内核参数配置                             │
│                                                             │
│  2. 复用机制                                                 │
│     - 标记为MIGRATE_CMA迁移类型                             │
│     - 只允许分配可移动页面                                   │
│     - 伙伴系统可正常使用                                     │
│                                                             │
│  3. 迁移机制                                                 │
│     - 需要时迁移走占用页面                                   │
│     - 使用alloc_contig_range                                │
│     - 保证内存连续性                                         │
│                                                             │
│  4. 位图管理                                                 │
│     - 使用bitmap跟踪分配状态                                 │
│     - 每个bit可代表多个页面                                  │
│     - 快速查找空闲区域                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 CMA与伙伴系统的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA与伙伴系统                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  伙伴系统页面迁移类型：                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ MIGRATE_UNMOVABLE    - 不可移动页面                  │   │
│  │ MIGRATE_MOVABLE      - 可移动页面                    │   │
│  │ MIGRATE_RECLAIMABLE  - 可回收页面                    │   │
│  │ MIGRATE_CMA          - CMA区域页面 ← 特殊类型        │   │
│  │ MIGRATE_ISOLATE      - 隔离页面                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  CMA区域的特点：                                             │
│    - 初始类型为MIGRATE_CMA                                   │
│    - 只分配可移动页面（MIGRATE_MOVABLE）                     │
│    - 需要连续内存时改为MIGRATE_ISOLATE                       │
│    - 迁移完成后恢复MIGRATE_CMA                               │
│                                                             │
│  内存分配优先级：                                             │
│    1. 优先从普通区域分配                                      │
│    2. 如果需要可移动页面，可从CMA区域分配                     │
│    3. CMA分配优先满足连续内存需求                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、CMA数据结构

### 3.1 struct cma（CMA区域描述符）

定义在 **`mm/cma.h`**：

```c
/*
 * struct cma - CMA区域描述符
 * 
 * 描述一个CMA预留区域的所有信息
 */
struct cma {
    unsigned long   base_pfn;      /* CMA区域起始页帧号 */
    unsigned long   count;         /* CMA区域总页数 */
    unsigned long   *bitmap;       /* 分配状态位图 */
    unsigned int    order_per_bit; /* 每个bit代表的页面order */
    spinlock_t      lock;          /* 保护位图的自旋锁 */
    
#ifdef CONFIG_CMA_DEBUGFS
    struct hlist_head mem_head;    /* 调试：分配记录链表 */
    spinlock_t mem_head_lock;      /* 保护链表的锁 */
    struct debugfs_u32_array dfs_bitmap; /* 调试：位图显示 */
#endif
    
    char name[CMA_MAX_NAME];       /* CMA区域名称 */
    
#ifdef CONFIG_CMA_SYSFS
    atomic64_t nr_pages_succeeded; /* 成功分配的页数 */
    atomic64_t nr_pages_failed;    /* 失败分配的页数 */
    struct cma_kobject *cma_kobj;  /* sysfs对象 */
#endif
};
```

### 3.2 关键字段详解

```
┌─────────────────────────────────────────────────────────────┐
│                    struct cma字段详解                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  base_pfn（起始页帧号）                                       │
│  ├── CMA区域在物理内存中的起始位置                            │
│  ├── 单位：页帧号（Page Frame Number）                       │
│  └── 示例：0x100000表示物理地址0x100000000                   │
│                                                             │
│  count（总页数）                                              │
│  ├── CMA区域包含的总页面数                                    │
│  ├── 单位：页面数（每个页面4KB）                              │
│  └── 示例：65536表示256MB（65536 * 4KB）                     │
│                                                             │
│  bitmap（分配状态位图）                                       │
│  ├── 跟踪每个区域的分配状态                                   │
│  ├── 0 = 空闲，1 = 已分配                                     │
│  └── 大小取决于count和order_per_bit                          │
│                                                             │
│  order_per_bit（位图粒度）                                    │
│  ├── 每个bit代表的页面数量 = 2^order_per_bit                 │
│  ├── 0 = 每bit代表1页                                        │
│  ├── 1 = 每bit代表2页                                        │
│  └── 更大的值减少位图大小                                     │
│                                                             │
│  lock（自旋锁）                                               │
│  ├── 保护bitmap的并发访问                                     │
│  ├── 分配/释放时需要加锁                                      │
│  └── 使用spin_lock_irqsave保护                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 位图管理

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA位图管理                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  示例：CMA区域256MB，order_per_bit = 0                       │
│                                                             │
│  物理内存布局：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Page0  Page1  Page2  Page3  Page4  Page5  ...       │   │
│  │  ↓      ↓      ↓      ↓      ↓      ↓               │   │
│  │ bit0   bit1   bit2   bit3   bit4   bit5   ...       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  位图状态示例：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ bitmap: 0 1 1 0 0 1 0 0 1 1 0 0 0 1 0 0 ...         │   │
│  │         ↑   ↑       ↑         ↑   ↑       ↑         │   │
│  │        空闲 已用   空闲      已用 空闲    已用        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  分配算法：                                                   │
│  1. 使用bitmap_find_next_zero_area_off查找连续空闲区域       │
│  2. 找到后设置对应bit为1                                      │
│  3. 调用alloc_contig_range分配连续内存                       │
│  4. 如果失败，清除bit并重试                                   │
│                                                             │
│  位图操作函数：                                               │
│  ├── cma_bitmap_aligned_mask：计算对齐掩码                   │
│  ├── cma_bitmap_aligned_offset：计算对齐偏移                 │
│  ├── cma_bitmap_pages_to_bits：页面数转bit数                 │
│  └── cma_clear_bitmap：清除位图                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 全局CMA管理

```c
/* 全局CMA区域数组 */
struct cma cma_areas[MAX_CMA_AREAS];
unsigned cma_area_count;

/* 总CMA页面数 */
unsigned long totalcma_pages;

/* CMA互斥锁，保护分配操作 */
static DEFINE_MUTEX(cma_mutex);
```

---

## 四、CMA初始化流程

### 4.1 初始化流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA初始化流程                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  系统启动                                                    │
│      │                                                       │
│      ▼                                                       │
│  start_kernel()                                             │
│      │                                                       │
│      ▼                                                       │
│  setup_arch()                                               │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ dma_contiguous_reserve()                            │   │
│  │ - 解析内核参数或设备树                               │   │
│  │ - 确定CMA区域大小和位置                             │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ cma_declare_contiguous_nid()                        │   │
│  │ - 通过memblock预留内存                              │   │
│  │ - 创建cma结构并初始化基本信息                        │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ core_initcall(cma_init_reserved_areas)              │   │
│  │ - 遍历所有CMA区域                                    │   │
│  │ - 激活每个CMA区域                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ cma_activate_area()                                 │   │
│  │ - 分配位图内存                                       │   │
│  │ - 验证所有页面在同一zone                             │   │
│  │ - 初始化页面为MIGRATE_CMA                            │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  CMA区域就绪，可以分配                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 通过设备树配置

```dts
/* 设备树中的CMA配置示例 */
reserved-memory {
    #address-cells = <2>;
    #size-cells = <2>;
    ranges;
    
    /* 默认CMA区域 */
    linux,cma {
        compatible = "shared-dma-pool";
        reusable;
        size = <0x0 0x10000000>;  /* 256MB */
        alignment = <0x0 0x1000000>; /* 16MB对齐 */
        linux,cma-default;
    };
    
    /* 自定义CMA区域（用于摄像头） */
    camera_cma: camera_cma@0 {
        compatible = "shared-dma-pool";
        reusable;
        size = <0x0 0x08000000>;  /* 128MB */
        alignment = <0x0 0x01000000>; /* 16MB对齐 */
    };
};
```

### 4.3 通过内核参数配置

```bash
# 内核启动参数
cma=256M                    # 全局CMA大小256MB
cma=128M@0x100000000        # 在指定地址预留128MB
cma=64M-128M                # 在64M-128M范围内预留

# 查看当前CMA配置
cat /proc/meminfo | grep -i cma
# CmaTotal:       262144 kB
# CmaFree:        262144 kB
```

### 4.4 cma_activate_area函数

定义在 **`mm/cma.c`**：

```c
/*
 * cma_activate_area - 激活CMA区域
 * 
 * 在系统初始化后期调用，完成CMA区域的最终设置
 */
static void __init cma_activate_area(struct cma *cma)
{
    unsigned long base_pfn = cma->base_pfn, pfn;
    struct zone *zone;

    /* 分配位图内存 */
    cma->bitmap = bitmap_zalloc(cma_bitmap_maxno(cma), GFP_KERNEL);
    if (!cma->bitmap)
        goto out_error;

    /*
     * alloc_contig_range()要求所有页面在同一zone
     * 验证CMA区域满足此要求
     */
    WARN_ON_ONCE(!pfn_valid(base_pfn));
    zone = page_zone(pfn_to_page(base_pfn));
    
    for (pfn = base_pfn + 1; pfn < base_pfn + cma->count; pfn++) {
        WARN_ON_ONCE(!pfn_valid(pfn));
        if (page_zone(pfn_to_page(pfn)) != zone)
            goto not_in_zone;
    }

    /* 初始化所有pageblock为MIGRATE_CMA */
    for (pfn = base_pfn; pfn < base_pfn + cma->count;
         pfn += pageblock_nr_pages)
        init_cma_reserved_pageblock(pfn_to_page(pfn));

    spin_lock_init(&cma->lock);
    
    /* 初始化调试相关结构 */
#ifdef CONFIG_CMA_DEBUGFS
    INIT_HLIST_HEAD(&cma->mem_head);
    spin_lock_init(&cma->mem_head_lock);
#endif

    return;

not_in_zone:
    bitmap_free(cma->bitmap);
out_error:
    /* 激活失败，释放所有页面到伙伴系统 */
    for (pfn = base_pfn; pfn < base_pfn + cma->count; pfn++)
        free_reserved_page(pfn_to_page(pfn));
    totalcma_pages -= cma->count;
    cma->count = 0;
    pr_err("CMA area %s could not be activated\n", cma->name);
}
```

---

## 五、CMA内存分配

### 5.1 cma_alloc函数

定义在 **`mm/cma.c`**：

```c
/**
 * cma_alloc - 从CMA区域分配连续内存
 * @cma:      CMA区域
 * @count:    请求的页面数
 * @align:    对齐要求（order）
 * @no_warn:  是否禁止警告信息
 *
 * 返回：分配的页面指针，失败返回NULL
 */
struct page *cma_alloc(struct cma *cma, unsigned long count,
                       unsigned int align, bool no_warn)
{
    unsigned long mask, offset;
    unsigned long pfn = -1;
    unsigned long start = 0;
    unsigned long bitmap_maxno, bitmap_no, bitmap_count;
    struct page *page = NULL;
    int ret = -ENOMEM;

    /* 参数检查 */
    if (!cma || !cma->count || !cma->bitmap)
        goto out;

    if (!count)
        goto out;

    trace_cma_alloc_start(cma->name, count, align);

    /* 计算位图相关参数 */
    mask = cma_bitmap_aligned_mask(cma, align);
    offset = cma_bitmap_aligned_offset(cma, align);
    bitmap_maxno = cma_bitmap_maxno(cma);
    bitmap_count = cma_bitmap_pages_to_bits(cma, count);

    if (bitmap_count > bitmap_maxno)
        goto out;

    /* 循环尝试分配 */
    for (;;) {
        spin_lock_irq(&cma->lock);
        
        /* 在位图中查找连续空闲区域 */
        bitmap_no = bitmap_find_next_zero_area_off(cma->bitmap,
                bitmap_maxno, start, bitmap_count, mask, offset);
        
        if (bitmap_no >= bitmap_maxno) {
            spin_unlock_irq(&cma->lock);
            break;  /* 没有足够的空间 */
        }
        
        /* 标记为已占用 */
        bitmap_set(cma->bitmap, bitmap_no, bitmap_count);
        spin_unlock_irq(&cma->lock);

        /* 计算物理页帧号 */
        pfn = cma->base_pfn + (bitmap_no << cma->order_per_bit);
        
        /* 尝试分配连续内存（可能触发页面迁移） */
        mutex_lock(&cma_mutex);
        ret = alloc_contig_range(pfn, pfn + count, MIGRATE_CMA,
                     GFP_KERNEL | (no_warn ? __GFP_NOWARN : 0));
        mutex_unlock(&cma_mutex);
        
        if (ret == 0) {
            page = pfn_to_page(pfn);
            break;  /* 分配成功 */
        }

        /* 分配失败，清除位图 */
        cma_clear_bitmap(cma, pfn, count);
        
        if (ret != -EBUSY)
            break;  /* 非忙碌错误，退出 */

        /* 区域忙碌，尝试下一个位置 */
        pr_debug("%s(): memory range at %p is busy, retrying\n",
                 __func__, pfn_to_page(pfn));
        start = bitmap_no + mask + 1;
    }

    trace_cma_alloc_finish(cma->name, pfn, page, count, align);

    /* 统计 */
    if (page) {
        count_vm_event(CMA_ALLOC_SUCCESS);
        cma_sysfs_account_success_pages(cma, count);
    } else {
        count_vm_event(CMA_ALLOC_FAIL);
        if (cma)
            cma_sysfs_account_fail_pages(cma, count);
    }

    return page;
}
```

### 5.2 分配流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA分配流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  cma_alloc(cma, count, align)                               │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. 计算位图参数                                      │   │
│  │    - mask = 对齐掩码                                 │   │
│  │    - bitmap_count = 需要的bit数                      │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. 在位图中查找连续空闲区域                          │   │
│  │    bitmap_find_next_zero_area_off()                  │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. 标记位图为已占用                                  │   │
│  │    bitmap_set(bitmap, bitmap_no, bitmap_count)       │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 4. 调用alloc_contig_range分配连续内存                │   │
│  │    - 隔离页面（MIGRATE_ISOLATE）                     │   │
│  │    - 迁移已占用页面                                  │   │
│  │    - 分配连续内存                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ├── 成功 ──► 返回page指针                              │
│      │                                                       │
│      └── 失败 ──► 清除位图，重试                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 alloc_contig_range函数

```c
/*
 * alloc_contig_range - 分配连续内存范围
 * 
 * 这是CMA分配的核心函数，负责：
 * 1. 隔离目标页面范围
 * 2. 迁移已占用的页面
 * 3. 确保内存连续
 */
int alloc_contig_range(unsigned long start, unsigned long end,
                       unsigned migratetype, gfp_t gfp_mask)
{
    int ret;
    
    /* 1. 隔离页面范围 */
    ret = start_isolate_page_range(start, end, migratetype, 0);
    if (ret)
        return ret;
    
    /* 2. 迁移已占用的页面 */
    ret = __alloc_contig_migrate_range(&cc, start, end);
    if (ret)
        goto done;
    
    /* 3. 从伙伴系统分配 */
    ret = __alloc_contig_alloc_range(&cc, start, end);
    
done:
    /* 4. 取消隔离 */
    undo_isolate_page_range(start, end, migratetype);
    return ret;
}
```

---

## 六、CMA内存释放

### 6.1 cma_release函数

定义在 **`mm/cma.c`**：

```c
/**
 * cma_release - 释放CMA内存
 * @cma:   CMA区域
 * @pages: 要释放的页面
 * @count: 页面数量
 *
 * 返回：true表示成功，false表示页面不属于该CMA区域
 */
bool cma_release(struct cma *cma, const struct page *pages,
                 unsigned long count)
{
    unsigned long pfn;

    if (!cma || !pages)
        return false;

    pr_debug("%s(page %p, count %lu)\n", __func__, (void *)pages, count);

    pfn = page_to_pfn(pages);

    /* 验证页面属于该CMA区域 */
    if (pfn < cma->base_pfn || pfn >= cma->base_pfn + cma->count)
        return false;

    VM_BUG_ON(pfn + count > cma->base_pfn + cma->count);

    /* 释放连续内存范围 */
    free_contig_range(pfn, count);
    
    /* 清除位图标记 */
    cma_clear_bitmap(cma, pfn, count);
    
    trace_cma_release(cma->name, pfn, pages, count);

    return true;
}
```

### 6.2 释放流程

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA释放流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  cma_release(cma, pages, count)                             │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. 验证页面属于该CMA区域                             │   │
│  │    pfn >= base_pfn && pfn < base_pfn + count        │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. 调用free_contig_range释放连续内存                 │   │
│  │    - 将页面返回给伙伴系统                            │   │
│  │    - 页面标记为MIGRATE_CMA                           │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. 清除位图标记                                      │   │
│  │    bitmap_clear(bitmap, bitmap_no, bitmap_count)     │   │
│  └─────────────────────────────────────────────────────┘   │
│      │                                                       │
│      ▼                                                       │
│  页面可被伙伴系统再次使用                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、页面迁移机制

### 7.1 为什么需要页面迁移

```
┌─────────────────────────────────────────────────────────────┐
│                    页面迁移的必要性                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  场景：设备需要8MB连续内存，但CMA区域被占用                    │
│                                                             │
│  CMA区域状态：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [已用][已用][空闲][已用][已用][空闲][已用][已用]     │   │
│  │   ↓     ↓           ↓     ↓           ↓     ↓       │   │
│  │  页面A 页面B       页面C 页面D       页面E 页面F     │   │
│  │                                                     │   │
│  │ 问题：没有连续的8MB空闲区域                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  解决方案：迁移已占用页面                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 步骤1：将页面A-F迁移到其他内存区域                    │   │
│  │                                                     │   │
│  │ [迁移][迁移][空闲][迁移][迁移][空闲][迁移][迁移]     │   │
│  │   ↓     ↓           ↓     ↓           ↓     ↓       │   │
│  │  新位置A 新位置B    新位置C 新位置D   新位置E 新位置F │   │
│  │                                                     │   │
│  │ 步骤2：CMA区域变为连续空闲                           │   │
│  │                                                     │   │
│  │ [空闲][空闲][空闲][空闲][空闲][空闲][空闲][空闲]     │   │
│  │                                                     │   │
│  │ 步骤3：分配给设备                                    │   │
│  │                                                     │   │
│  │ [设备缓冲区 - 连续的8MB]                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 页面迁移类型

```
┌─────────────────────────────────────────────────────────────┐
│                    可迁移的页面类型                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  可迁移页面（可以移动）：                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 类型              │ 说明                            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 匿名页面          │ 进程的堆、栈内存                │   │
│  │ 文件映射页面      │ mmap映射的文件页面              │   │
│  │ tmpfs页面         │ 共享内存、tmpfs文件             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  不可迁移页面（不能移动）：                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 类型              │ 原因                            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 内核代码/数据     │ 物理地址固定                    │   │
│  │ 设备MMIO映射      │ 与硬件交互                      │   │
│  │ 锁定的页面        │ 用户mlock锁定                   │   │
│  │ DMA缓冲区         │ 设备正在使用                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  CMA区域只允许存放可迁移页面！                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 迁移流程

```c
/*
 * 页面迁移的核心流程
 */
static int __alloc_contig_migrate_range(struct compact_control *cc,
                                        unsigned long start,
                                        unsigned long end)
{
    unsigned long pfn;
    
    /* 遍历需要迁移的页面 */
    for (pfn = start; pfn < end; pfn++) {
        struct page *page = pfn_to_page(pfn);
        
        /* 跳过空闲页面 */
        if (PageBuddy(page))
            continue;
        
        /* 隔离页面 */
        if (!isolate_page(page, cc))
            continue;
        
        /* 迁移页面 */
        migrate_pages(&cc->migratepages, 
                      compaction_alloc,
                      compaction_free,
                      (unsigned long)cc,
                      cc->mode,
                      MR_CONTIG_RANGE);
    }
    
    return 0;
}
```

---

## 八、CMA配置与使用

### 8.1 内核配置选项

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA内核配置                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CONFIG_CMA                                                 │
│  ├── 启用CMA支持                                             │
│  └── 默认在大多数架构上启用                                   │
│                                                             │
│  CONFIG_CMA_SIZE_MBYTES                                      │
│  ├── 默认CMA区域大小（MB）                                    │
│  └── 示例：CONFIG_CMA_SIZE_MBYTES=256                        │
│                                                             │
│  CONFIG_CMA_SIZE_SEL_MIN                                     │
│  ├── 选择最小CMA大小                                         │
│  └── 用于内存受限系统                                        │
│                                                             │
│  CONFIG_CMA_DEBUG                                            │
│  ├── 启用CMA调试支持                                         │
│  └── 输出详细的调试信息                                      │
│                                                             │
│  CONFIG_CMA_DEBUGFS                                          │
│  ├── 在debugfs中提供CMA信息                                  │
│  └── 可查看位图和分配状态                                    │
│                                                             │
│  CONFIG_CMA_SYSFS                                            │
│  ├── 在sysfs中提供CMA统计                                    │
│  └── 可查看分配成功/失败次数                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 设备驱动使用CMA

```c
#include <linux/cma.h>
#include <linux/dma-mapping.h>

/*
 * 方法1：使用DMA API（推荐）
 */
void example_dma_alloc(struct device *dev)
{
    dma_addr_t dma_handle;
    void *virt_addr;
    size_t size = 8 * 1024 * 1024;  /* 8MB */
    
    /* 分配连续DMA缓冲区 */
    virt_addr = dma_alloc_coherent(dev, size, &dma_handle, GFP_KERNEL);
    if (!virt_addr) {
        dev_err(dev, "Failed to allocate DMA buffer\n");
        return;
    }
    
    /* 使用缓冲区 */
    /* ... */
    
    /* 释放缓冲区 */
    dma_free_coherent(dev, size, virt_addr, dma_handle);
}

/*
 * 方法2：直接使用CMA API
 */
void example_cma_alloc(void)
{
    struct cma *cma = cma_get_area("linux,cma");
    struct page *pages;
    unsigned long count = 2048;  /* 8MB = 2048 pages */
    
    /* 从CMA区域分配 */
    pages = cma_alloc(cma, count, 0, false);
    if (!pages) {
        pr_err("CMA allocation failed\n");
        return;
    }
    
    /* 使用页面 */
    void *addr = page_address(pages);
    /* ... */
    
    /* 释放 */
    cma_release(cma, pages, count);
}
```

### 8.3 查看CMA状态

```bash
# 查看CMA内存信息
cat /proc/meminfo | grep -i cma
# CmaTotal:       262144 kB
# CmaFree:        262144 kB

# 查看CMA统计信息（需要CONFIG_CMA_SYSFS）
ls /sys/kernel/mm/cma/
# linux,cma

cat /sys/kernel/mm/cma/linux,cma/free_pages
cat /sys/kernel/mm/cma/linux,cma/total_pages
cat /sys/kernel/mm/cma/linux,cma/alloc_pages_fail
cat /sys/kernel/mm/cma/linux,cma/alloc_pages_success

# 查看CMA调试信息（需要CONFIG_CMA_DEBUGFS）
cat /sys/kernel/debug/cma/linux,cma/bitmap
cat /sys/kernel/debug/cma/linux,cma/count
cat /sys/kernel/debug/cma/linux,cma/used
```

---

## 九、实际应用场景

### 9.1 常见应用场景

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA应用场景                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 多媒体设备                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 设备          │ 内存需求           │ 原因            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 摄像头        │ 帧缓冲区（8-64MB） │ DMA传输         │   │
│  │ 视频编解码    │ 参考帧（16-256MB） │ 硬件编解码      │   │
│  │ 音频处理      │ 音频缓冲区        │ DSP处理         │   │
│  │ GPU           │ 显存              │ 无IOMMU         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 网络设备                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 设备          │ 内存需求           │ 原因            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 网络卡        │ 收发缓冲区        │ 零拷贝          │   │
│  │ WiFi          │ DMA描述符         │ 硬件要求        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 存储设备                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 设备          │ 内存需求           │ 原因            │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ SSD控制器     │ 传输缓冲区        │ DMA引擎         │   │
│  │ eMMC          │ 命令队列          │ 硬件限制        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 ARM平台示例

```dts
/* ARM平台典型的CMA配置 */
/ {
    reserved-memory {
        #address-cells = <2>;
        #size-cells = <2>;
        ranges;
        
        /* 全局CMA区域 */
        linux,cma {
            compatible = "shared-dma-pool";
            reusable;
            size = <0x0 0x10000000>;  /* 256MB */
            linux,cma-default;
        };
        
        /* 摄像头专用CMA */
        camera_reserved: camera_reserved {
            compatible = "shared-dma-pool";
            no-map;
            size = <0x0 0x08000000>;  /* 128MB */
        };
        
        /* 视频编解码专用CMA */
        vpu_reserved: vpu_reserved {
            compatible = "shared-dma-pool";
            no-map;
            size = <0x0 0x10000000>;  /* 256MB */
        };
    };
    
    /* 摄像头设备 */
    camera: camera@0 {
        compatible = "vendor,camera";
        memory-region = <&camera_reserved>;
    };
    
    /* VPU设备 */
    vpu: vpu@0 {
        compatible = "vendor,vpu";
        memory-region = <&vpu_reserved>;
    };
};
```

---

## 十、常见问题与调优

### 10.1 常见问题

```
┌─────────────────────────────────────────────────────────────┐
│                    CMA常见问题                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  问题1：CMA分配失败                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 现象：cma_alloc返回NULL                              │   │
│  │ 原因：                                               │   │
│  │   - CMA区域太小                                      │   │
│  │   - 页面迁移失败                                     │   │
│  │   - 存在不可迁移页面                                 │   │
│  │ 解决：                                               │   │
│  │   - 增大CMA区域                                      │   │
│  │   - 检查是否有mlock页面                              │   │
│  │   - 查看迁移失败原因                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题2：CMA利用率低                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 现象：CmaFree一直很高                                 │   │
│  │ 原因：                                               │   │
│  │   - 设备不使用                                       │   │
│  │   - 没有配置reusable                                 │   │
│  │ 解决：                                               │   │
│  │   - 确保配置了reusable属性                           │   │
│  │   - 减小CMA区域大小                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题3：页面迁移耗时                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 现象：设备启动延迟                                   │   │
│  │ 原因：                                               │   │
│  │   - 需要迁移大量页面                                 │   │
│  │   - 内存碎片化严重                                   │   │
│  │ 解决：                                               │   │
│  │   - 预热CMA区域                                      │   │
│  │   - 减少CMA区域的普通分配                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 调优建议

| 场景 | 建议 | 说明 |
|------|------|------|
| 嵌入式设备 | CMA大小 = 最大设备需求 + 20% | 预留足够空间 |
| 服务器 | 使用IOMMU替代CMA | 更灵活的DMA |
| 内存受限 | 减小CMA，增大swap | 平衡内存使用 |
| 多媒体应用 | 为每个设备单独配置CMA | 避免竞争 |

### 10.3 调试技巧

```bash
# 启用CMA调试
echo 1 > /sys/module/cma/parameters/cma_debug

# 查看CMA分配失败统计
cat /sys/kernel/mm/cma/linux,cma/alloc_pages_fail

# 查看当前CMA使用情况
cat /proc/meminfo | grep Cma

# 跟踪CMA事件（需要ftrace）
echo 1 > /sys/kernel/debug/tracing/events/cma/enable
cat /sys/kernel/debug/tracing/trace

# 查看页面迁移统计
cat /proc/vmstat | grep migrate
```

---

## 总结

CMA（连续内存分配器）是Linux内核解决大块连续物理内存分配问题的关键机制：

1. **核心价值**：平衡内存利用率与连续内存需求
2. **工作原理**：预留内存 + 页面迁移 + 动态复用
3. **数据结构**：struct cma描述CMA区域，bitmap管理分配状态
4. **关键函数**：cma_alloc分配、cma_release释放
5. **页面迁移**：将可移动页面迁移出CMA区域，腾出连续空间

**关键要点**：
- CMA区域在系统启动时预留
- 空闲时可被伙伴系统用于分配可移动页面
- 需要连续内存时通过页面迁移腾出空间
- 只允许存放可迁移页面
- 通过设备树或内核参数配置

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了CMA的原理、实现和使用方法。理解CMA对于嵌入式系统开发和多媒体应用开发至关重要。*
