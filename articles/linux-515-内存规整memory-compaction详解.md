# Linux 5.15 内存规整（Memory Compaction）详解

## 目录
1. **`引言：为什么需要内存规整`**
2. **`内存碎片问题详解`**
3. **`内存规整的核心概念`**
4. **`内存规整数据结构`**
5. **`内存规整的触发机制`**
6. **`compact_zone核心函数`**
7. **`页隔离与迁移机制`**
8. **`kcompactd内核线程`**
9. **`主动规整与被动规整`**
10. **`完整使用示例`**
11. **`常见问题与注意事项`**

---

## 一、引言：为什么需要内存规整

### 1.1 一个真实的问题场景

Linux系统长期运行后，经常会出现这样的诡异问题：

```
┌─────────────────────────────────────────────────────────────┐
│                    内存充足却分配失败                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  $ free -h                                                  │
│                total    used    free                        │
│  Mem:            16G      8G      8G                        │
│                                                             │
│  但是尝试分配2MB连续内存却失败！                            │
│                                                             │
│  原因：内存碎片化                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**为什么会出现这种情况？**

系统中有大量空闲内存，但这些空闲内存被分割成无数小块，无法合并成足够大的连续空间。这就是**外部碎片**问题。

### 1.2 内存规整的解决方案

**内存规整（Memory Compaction）** 是Linux内核解决外部碎片问题的核心机制：

```
┌─────────────────────────────────────────────────────────────┐
│                    内存规整的核心思想                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  规整前：                                                    │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐       │
│  │已用│空闲│已用│空闲│已用│空闲│已用│空闲│已用│空闲│       │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘       │
│         空闲内存分散，无法分配大块                           │
│                                                             │
│  规整后：                                                    │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐       │
│  │已用│已用│已用│已用│已用│空闲│空闲│空闲│空闲│空闲│       │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘       │
│                    空闲内存合并成大块                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 内存规整的应用场景

| 场景 | 说明 | 内存需求 |
|------|------|----------|
| 透明大页（THP） | 自动使用2MB大页 | 2MB连续内存 |
| hugetlbfs | 手动使用大页 | 多种大小 |
| CMA | 连续内存分配器 | 设备DMA需求 |
| 普通高阶分配 | order > 0的分配 | 连续物理页 |

### 1.4 内存规整的优势

```
┌─────────────────────────────────────────────────────────────┐
│                    内存规整 vs 其他方案                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  方案1：内存回收（kswapd）                                   │
│    - 只能释放内存，不能整理碎片                              │
│    - 可能回收太多内存                                        │
│                                                             │
│  方案2：内存规整（compaction）                               │
│    - 通过迁移页面整理碎片                                    │
│    - 不减少内存总量                                          │
│    - 产生连续空闲块                                          │
│                                                             │
│  方案3：OOM Killer                                          │
│    - 杀死进程释放内存                                        │
│    - 最后手段，代价最大                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、内存碎片问题详解

### 2.1 外部碎片

**定义**：内存中存在大量小的空闲块，但无法合并成足够大的连续空间。

```
┌─────────────────────────────────────────────────────────────┐
│                    外部碎片示意图                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  物理内存布局（每个格子代表一个页面）：                       │
│                                                             │
│  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐        │
│  │A │  │B │  │C │  │D │  │E │  │F │  │G │  │H │  │        │
│  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘        │
│     ↑     ↑     ↑     ↑     ↑     ↑     ↑     ↑            │
│    空闲   空闲   空闲   空闲   空闲   空闲   空闲   空闲       │
│                                                             │
│  总空闲：8页                                                 │
│  最大连续空闲：1页                                           │
│  无法分配2页连续内存！                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 外部碎片的产生原因

```c
// 示例：频繁分配释放导致碎片
void example_external_fragmentation(void)
{
    // 分配10个页面
    struct page *pages[10];
    for (int i = 0; i < 10; i++)
        pages[i] = alloc_page(GFP_KERNEL);
    
    // 释放奇数位置的页面
    for (int i = 1; i < 10; i += 2)
        __free_page(pages[i]);
    
    // 此时内存布局：
    // [已用][空闲][已用][空闲][已用][空闲]...
    // 虽然有5个空闲页，但无法分配2个连续页！
}
```

### 2.3 外部碎片的危害

| 危害 | 说明 | 影响 |
|------|------|------|
| 大页分配失败 | THP需要2MB连续内存 | 性能下降 |
| 高阶分配失败 | order > 0的分配 | 功能受限 |
| OOM风险 | 分配失败触发OOM | 进程被杀 |
| 性能下降 | 频繁规整开销 | 系统卡顿 |

---

## 三、内存规整的核心概念

### 3.1 页迁移（Page Migration）

**页迁移是内存规整的核心操作**：将一个物理页面的数据从一个位置移动到另一个位置。

```
┌─────────────────────────────────────────────────────────────┐
│                    页迁移过程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  步骤1：分配新页面                                          │
│         ┌─────────┐                                         │
│         │ 新页面  │ ← 从空闲区分配                          │
│         └─────────┘                                         │
│                                                             │
│  步骤2：复制数据                                            │
│         ┌─────────┐      复制      ┌─────────┐             │
│         │ 旧页面  │ ────────────► │ 新页面  │             │
│         │  数据   │               │  数据   │             │
│         └─────────┘               └─────────┘             │
│                                                             │
│  步骤3：更新页表                                            │
│         进程的页表项从指向旧页面改为指向新页面               │
│                                                             │
│  步骤4：释放旧页面                                          │
│         旧页面被释放，成为空闲页                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 可迁移的页面类型

并非所有页面都可以迁移：

| 页面类型 | 可迁移 | 说明 |
|----------|--------|------|
| 匿名页 | 是 | 进程的堆、栈数据 |
| 文件页 | 是 | 文件缓存页 |
| 共享内存页 | 是 | 进程间共享的内存 |
| 内核页 | 否 | 内核使用的页面 |
| 设备映射页 | 否 | 设备内存映射 |
| 不可移动页 | 否 | 标记为不可移动 |

### 3.3 迁移模式

定义在 `include/linux/migrate.h`：

```c
enum migrate_mode {
    MIGRATE_ASYNC,      // 异步迁移：不阻塞
    MIGRATE_SYNC_LIGHT, // 轻量同步：允许少量阻塞
    MIGRATE_SYNC,       // 完全同步：允许阻塞
};
```

**三种模式对比**：

| 模式 | 阻塞 | 性能 | 适用场景 |
|------|------|------|----------|
| MIGRATE_ASYNC | 不阻塞 | 最高 | 直接规整初始阶段 |
| MIGRATE_SYNC_LIGHT | 少量阻塞 | 中等 | 直接规整后续阶段 |
| MIGRATE_SYNC | 可阻塞 | 最低 | kcompactd、手动规整 |

### 3.4 规整优先级

定义在 **`include/linux/compaction.h`**：

```c
enum compact_priority {
    COMPACT_PRIO_SYNC_FULL,           // 完全同步（最高优先级）
    MIN_COMPACT_PRIORITY = COMPACT_PRIO_SYNC_FULL,
    COMPACT_PRIO_SYNC_LIGHT,          // 轻量同步
    MIN_COMPACT_COSTLY_PRIORITY = COMPACT_PRIO_SYNC_LIGHT,
    DEF_COMPACT_PRIORITY = COMPACT_PRIO_SYNC_LIGHT,
    COMPACT_PRIO_ASYNC,               // 异步
    INIT_COMPACT_PRIORITY = COMPACT_PRIO_ASYNC  // 初始优先级
};
```

---

## 四、内存规整数据结构

### 4.1 compact_control结构体

定义在 **`mm/internal.h`**：

```c
struct compact_control {
    struct list_head freepages;        // 空闲页链表（迁移目标）
    struct list_head migratepages;     // 待迁移页链表
    unsigned int nr_freepages;         // 隔离的空闲页数量
    unsigned int nr_migratepages;      // 待迁移页数量
    
    unsigned long free_pfn;            // 空闲扫描器当前位置
    unsigned long migrate_pfn;         // 迁移扫描器当前位置
    unsigned long fast_start_pfn;      // 快速扫描起始位置
    
    struct zone *zone;                 // 正在规整的zone
    
    unsigned long total_migrate_scanned;  // 总扫描迁移页数
    unsigned long total_free_scanned;     // 总扫描空闲页数
    
    unsigned short fast_search_fail;   // 快速搜索失败次数
    short search_order;                // 快速搜索的order
    
    const gfp_t gfp_mask;              // 分配标志
    int order;                         // 需要的order
    int migratetype;                   // 迁移类型
    
    const unsigned int alloc_flags;    // 分配标志
    const int highest_zoneidx;         // 最高zone索引
    
    enum migrate_mode mode;            // 迁移模式
    
    bool ignore_skip_hint;             // 忽略跳过提示
    bool no_set_skip_hint;             // 不设置跳过提示
    bool ignore_block_suitable;        // 忽略块适合性
    bool direct_compaction;            // 是否直接规整
    bool proactive_compaction;         // 是否主动规整
    bool whole_zone;                   // 是否扫描整个zone
    bool contended;                    // 是否有锁竞争
    bool rescan;                       // 是否重新扫描
    bool alloc_contig;                 // 是否连续分配
};
```

### 4.2 关键字段详解

| 字段 | 说明 |
|------|------|
| freepages | 存储找到的空闲页，作为迁移目标 |
| migratepages | 存储需要迁移的页面 |
| free_pfn | 空闲扫描器从zone末尾向前扫描 |
| migrate_pfn | 迁移扫描器从zone开头向后扫描 |
| order | 需要分配的内存块大小（2^order页） |
| mode | 迁移模式（异步/同步） |

### 4.3 扫描器工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    双扫描器工作原理                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Zone内存区域：                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┐     │   │
│  │  │    │    │    │    │    │    │    │    │    │     │   │
│  │  └────┴────┴────┴────┴────┴────┴────┴────┴────┘     │   │
│  │  ↑                                              ↑    │   │
│  │  │                                              │    │   │
│  │  migrate_pfn                              free_pfn   │   │
│  │  （迁移扫描器）                          （空闲扫描器）│   │
│  │        │                                    ↑        │   │
│  │        │─────────向右移动───────────────────│        │   │
│  │        │←────────向左移动───────────────────│        │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  当两个扫描器相遇时，规整结束                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 规整结果枚举

定义在 **`include/linux/compaction.h`**：

```c
enum compact_result {
    COMPACT_NOT_SUITABLE_ZONE,   // zone不适合规整
    COMPACT_SKIPPED,             // 跳过规整
    COMPACT_DEFERRED,            // 规整被推迟
    COMPACT_NO_SUITABLE_PAGE,    // 没有合适的页面
    COMPACT_CONTINUE,            // 继续规整
    COMPACT_COMPLETE,            // 规整完成
    COMPACT_PARTIAL_SKIPPED,     // 部分跳过
    COMPACT_CONTENDED,           // 锁竞争
    COMPACT_SUCCESS,             // 规整成功
};
```

---

## 五、内存规整的触发机制

### 5.1 触发机制概览

```
┌─────────────────────────────────────────────────────────────┐
│                    内存规整触发机制                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 直接规整（Direct Compaction）                           │
│     - 内存分配失败时同步触发                                 │
│     - 在分配路径中执行                                       │
│     - 阻塞当前进程                                          │
│                                                             │
│  2. 被动规整（Background Compaction）                       │
│     - 由kcompactd内核线程执行                               │
│     - 内存压力较大时触发                                     │
│     - 不阻塞分配进程                                         │
│                                                             │
│  3. 主动规整（Proactive Compaction）                        │
│     - kcompactd定期检查碎片程度                             │
│     - 碎片超过阈值时自动规整                                 │
│     - 预防性规整                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 直接规整触发路径

```
内存分配请求
        │
        ▼
get_page_from_freelist()  ─────成功────► 返回页面
        │
       失败
        │
        ▼
__alloc_pages_slowpath()  // 慢速分配路径
        │
        ├─► 唤醒kswapd进行内存回收
        │
        ├─► 再次尝试分配
        │       │
        │      失败
        │       │
        │       ▼
        └─► __alloc_pages_direct_compact()  // 直接规整
                │
                ├─► 尝试异步规整
                │       │
                │      失败
                │       │
                │       ▼
                ├─► 尝试同步轻量规整
                │       │
                │      失败
                │       │
                │       ▼
                └─► 尝试完全同步规整
```

### 5.3 直接规整代码路径

```c
// 简化的分配流程
struct page *alloc_pages(gfp_t gfp_mask, unsigned int order)
{
    struct page *page;
    
    // 快速路径：从空闲链表分配
    page = get_page_from_freelist(gfp_mask, order, ...);
    if (page)
        return page;
    
    // 慢速路径
    page = __alloc_pages_slowpath(gfp_mask, order, ...);
    return page;
}

// 慢速路径中的直接规整
static struct page *__alloc_pages_slowpath(...)
{
    // ... 尝试各种方法 ...
    
    // 直接规整
    page = __alloc_pages_direct_compact(gfp_mask, order, ...,
                                        INIT_COMPACT_PRIORITY, ...);
    if (page)
        return page;
    
    // 提高优先级重试
    // ...
}
```

### 5.4 规整推迟机制

当规整多次失败时，内核会推迟后续规整：

```c
// 定义在 mm/compaction.c
#define COMPACT_MAX_DEFER_SHIFT 6  // 最多推迟64次

static void defer_compaction(struct zone *zone, int order)
{
    zone->compact_considered = 0;
    zone->compact_defer_shift++;
    
    if (order < zone->compact_order_failed)
        zone->compact_order_failed = order;
    
    // 限制最大推迟次数
    if (zone->compact_defer_shift > COMPACT_MAX_DEFER_SHIFT)
        zone->compact_defer_shift = COMPACT_MAX_DEFER_SHIFT;
}
```

---

## 六、compact_zone核心函数

### 6.1 compact_zone函数

定义在 **`mm/compaction.c`**：

```c
static enum compact_result
compact_zone(struct compact_control *cc, struct capture_control *capc)
{
    enum compact_result ret;
    unsigned long start_pfn = cc->zone->zone_start_pfn;
    unsigned long end_pfn = zone_end_pfn(cc->zone);
    const bool sync = cc->mode != MIGRATE_ASYNC;
    
    // 初始化计数器
    cc->total_migrate_scanned = 0;
    cc->total_free_scanned = 0;
    cc->nr_migratepages = 0;
    cc->nr_freepages = 0;
    INIT_LIST_HEAD(&cc->freepages);
    INIT_LIST_HEAD(&cc->migratepages);
    
    // 检查是否需要规整
    ret = compaction_suitable(cc->zone, cc->order, ...);
    if (ret == COMPACT_SUCCESS || ret == COMPACT_SKIPPED)
        return ret;
    
    // 设置扫描器起始位置
    if (cc->whole_zone) {
        cc->migrate_pfn = start_pfn;
        cc->free_pfn = pageblock_start_pfn(end_pfn - 1);
    } else {
        // 使用缓存的位置
        cc->migrate_pfn = cc->zone->compact_cached_migrate_pfn[sync];
        cc->free_pfn = cc->zone->compact_cached_free_pfn;
    }
    
    // 排空LRU缓存
    lru_add_drain();
    
    // 主循环：直到规整完成
    while ((ret = compact_finished(cc)) == COMPACT_CONTINUE) {
        int err;
        
        // 隔离待迁移页面
        switch (isolate_migratepages(cc)) {
        case ISOLATE_ABORT:
            ret = COMPACT_CONTENDED;
            goto out;
        case ISOLATE_NONE:
            // 没有隔离到页面
            continue;
        case ISOLATE_SUCCESS:
            // 成功隔离页面
            break;
        }
        
        // 迁移页面
        err = migrate_pages(&cc->migratepages, compaction_alloc,
                           compaction_free, (unsigned long)cc,
                           cc->mode, MR_COMPACTION, NULL);
        
        if (err) {
            putback_movable_pages(&cc->migratepages);
            // 处理迁移失败...
        }
    }
    
out:
    // 释放空闲页链表
    if (cc->nr_freepages > 0)
        release_freepages(&cc->freepages);
    
    return ret;
}
```

### 6.2 compact_zone流程图

```
compact_zone()
        │
        ├─► 初始化计数器和链表
        │
        ├─► 检查是否需要规整（compaction_suitable）
        │       │
        │       ├─► COMPACT_SUCCESS → 返回
        │       └─► COMPACT_SKIPPED → 返回
        │
        ├─► 设置扫描器起始位置
        │
        ├─► lru_add_drain()  // 排空LRU缓存
        │
        └─► while (compact_finished() == COMPACT_CONTINUE)
                │
                ├─► isolate_migratepages()  // 隔离待迁移页
                │       │
                │       ├─► ISOLATE_ABORT → 退出
                │       ├─► ISOLATE_NONE → 继续
                │       └─► ISOLATE_SUCCESS → 继续
                │
                ├─► migrate_pages()  // 迁移页面
                │       │
                │       ├─► 成功 → 继续
                │       └─► 失败 → 回退页面
                │
                └─► 检查是否满足分配需求
```

### 6.3 compaction_suitable函数

检查是否需要进行规整：

```c
enum compact_result compaction_suitable(struct zone *zone, int order,
                                         unsigned int alloc_flags,
                                         int highest_zoneidx)
{
    unsigned long watermark;
    
    // 计算水位线
    watermark = wmark_pages(zone, alloc_flags & ALLOC_WMARK_MASK);
    
    // 如果空闲内存低于水位线，跳过规整
    if (!zone_watermark_ok(zone, 0, watermark, highest_zoneidx, 0))
        return COMPACT_SKIPPED;
    
    // 如果已经有足够大的空闲块，不需要规整
    if (order == 0)
        return COMPACT_SUCCESS;
    
    // 检查碎片指数
    if (fragmentation_index(zone, order) <= sysctl_extfrag_threshold)
        return COMPACT_SUCCESS;
    
    return COMPACT_CONTINUE;
}
```

---

## 七、页隔离与迁移机制

### 7.1 隔离空闲页

`isolate_freepages_block` 函数从指定块中隔离空闲页：

```c
static unsigned long isolate_freepages_block(struct compact_control *cc,
                                              unsigned long *start_pfn,
                                              unsigned long end_pfn,
                                              struct list_head *freelist,
                                              unsigned int stride,
                                              bool strict)
{
    int nr_scanned = 0, total_isolated = 0;
    unsigned long blockpfn = *start_pfn;
    
    for (; blockpfn < end_pfn; blockpfn += stride) {
        struct page *page = pfn_to_page(blockpfn);
        
        nr_scanned++;
        
        // 跳过复合页（大页）
        if (PageCompound(page)) {
            unsigned int order = compound_order(page);
            blockpfn += (1UL << order) - 1;
            continue;
        }
        
        // 检查是否是空闲页（在buddy系统中）
        if (!PageBuddy(page))
            continue;
        
        // 获取页面order
        order = buddy_order(page);
        
        // 隔离页面
        if (isolate_freepage(page, order, freelist)) {
            total_isolated += 1 << order;
            blockpfn += (1UL << order) - 1;
        }
    }
    
    return total_isolated;
}
```

### 7.2 隔离迁移页

`isolate_migratepages_block` 函数从指定块中隔离可迁移页：

```c
static isolate_migrate_t isolate_migratepages_block(struct compact_control *cc,
                                                     unsigned long low_pfn,
                                                     unsigned long end_pfn,
                                                     isolate_mode_t mode)
{
    struct zone *zone = cc->zone;
    unsigned long pfn = low_pfn;
    
    for (; pfn < end_pfn; pfn++) {
        struct page *page = pfn_to_page(pfn);
        
        // 跳过空闲页
        if (PageBuddy(page))
            continue;
        
        // 跳过复合页
        if (PageCompound(page)) {
            pfn += compound_order(page) - 1;
            continue;
        }
        
        // 检查页面是否可迁移
        if (!PageLRU(page))
            continue;
        
        // 尝试隔离页面
        if (!isolate_lru_page(page)) {
            list_add_tail(&page->lru, &cc->migratepages);
            cc->nr_migratepages++;
        }
    }
    
    return ISOLATE_SUCCESS;
}
```

### 7.3 页面迁移

`migrate_pages` 函数执行实际的页面迁移：

```c
int migrate_pages(struct list_head *from, new_page_t get_new_page,
                   free_page_t put_new_page, unsigned long private,
                   enum migrate_mode mode, int reason,
                   struct list_head *ret)
{
    struct page *page, *page2;
    int swap = 0;
    int rc, rc2;
    
    // 遍历待迁移页面列表
    list_for_each_entry_safe(page, page2, from, lru) {
        // 获取新页面
        struct page *newpage = get_new_page(page, private);
        if (!newpage) {
            rc = -ENOMEM;
            goto out;
        }
        
        // 执行迁移
        rc = __migrate_page(page, newpage, mode);
        
        if (rc) {
            // 迁移失败，放回原处
            if (rc != -EAGAIN)
                list_add_tail(&page->lru, ret);
        } else {
            // 迁移成功
            list_del(&page->lru);
        }
    }
    
out:
    return rc;
}
```

### 7.4 迁移过程详解

```
┌─────────────────────────────────────────────────────────────┐
│                    单个页面迁移过程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 锁定旧页面                                              │
│     lock_page(page)                                         │
│                                                             │
│  2. 分配新页面                                              │
│     newpage = alloc_page(GFP_KERNEL)                        │
│                                                             │
│  3. 复制内容                                                │
│     copy_highpage(newpage, page)                            │
│                                                             │
│  4. 更新页表                                                │
│     for each pte mapping page:                              │
│         pte = pte_offset_map(...)                           │
│         set_pte(pte, pfn_pte(newpage))                      │
│                                                             │
│  5. 刷新TLB                                                 │
│     flush_tlb_page(...)                                     │
│                                                             │
│  6. 释放旧页面                                              │
│     put_page(page)                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、kcompactd内核线程

### 8.1 kcompactd概述

`kcompactd` 是每个NUMA节点一个的内核线程，负责后台内存规整：

```c
// 每个节点的kcompactd
struct pglist_data {
    // ...
    struct task_struct *kcompactd;      // kcompactd线程
    wait_queue_head_t kcompactd_wait;   // 等待队列
    int kcompactd_max_order;            // 最大order
    enum zone_type kcompactd_highest_zoneidx;  // 最高zone索引
};
```

### 8.2 kcompactd主循环

定义在 **`mm/compaction.c`**：

```c
static int kcompactd(void *p)
{
    pg_data_t *pgdat = (pg_data_t *)p;
    unsigned long timeout;
    
    // 设置线程优先级
    set_user_nice(current, MIN_NICE);
    
    // 初始化
    pgdat->kcompactd_max_order = 0;
    pgdat->kcompactd_highest_zoneidx = pgdat->nr_zones - 1;
    
    while (!kthread_should_stop()) {
        unsigned long start = jiffies;
        
        // 等待被唤醒或超时
        timeout = start + msecs_to_jiffies(HPAGE_FRAG_CHECK_INTERVAL_MSEC);
        
        wait_event_freezable_timeout(pgdat->kcompactd_wait,
            kcompactd_work_requested(pgdat), timeout);
        
        // 执行规整工作
        kcompactd_do_work(pgdat);
        
        // 主动规整检查
        if (proactive_compaction_node(pgdat))
            proactive_compaction(pgdat);
    }
    
    return 0;
}
```

### 8.3 kcompactd_do_work函数

```c
static void kcompactd_do_work(pg_data_t *pgdat)
{
    struct compact_control cc = {
        .order = pgdat->kcompactd_max_order,
        .search_order = pgdat->kcompactd_max_order,
        .highest_zoneidx = pgdat->kcompactd_highest_zoneidx,
        .mode = MIGRATE_SYNC_LIGHT,
        .direct_compaction = false,
        .proactive_compaction = false,
    };
    
    // 遍历所有zone
    for (zoneid = 0; zoneid <= cc.highest_zoneidx; zoneid++) {
        struct zone *zone = &pgdat->node_zones[zoneid];
        
        if (!populated_zone(zone))
            continue;
        
        // 检查是否需要规整
        if (compaction_suitable(zone, cc.order, 0, zoneid) 
            != COMPACT_CONTINUE)
            continue;
        
        // 执行规整
        cc.zone = zone;
        compact_zone(&cc, NULL);
    }
}
```

### 8.4 唤醒kcompactd

```c
void wakeup_kcompactd(pg_data_t *pgdat, int order, int highest_zoneidx)
{
    // 更新请求参数
    if (pgdat->kcompactd_max_order < order)
        pgdat->kcompactd_max_order = order;
    
    if (pgdat->kcompactd_highest_zoneidx > highest_zoneidx)
        pgdat->kcompactd_highest_zoneidx = highest_zoneidx;
    
    // 检查是否有等待者
    if (!wq_has_sleeper(&pgdat->kcompactd_wait))
        return;
    
    // 检查是否需要工作
    if (!kcompactd_node_suitable(pgdat))
        return;
    
    // 唤醒线程
    wake_up_interruptible(&pgdat->kcompactd_wait);
}
```

### 8.5 kcompactd工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    kcompactd工作流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  初始化                                                      │
│     │                                                        │
│     ▼                                                        │
│  while (!kthread_should_stop())                             │
│     │                                                        │
│     ├─► wait_event_freezable_timeout()  // 等待唤醒或超时   │
│     │                                                        │
│     ├─► kcompactd_do_work()             // 执行规整         │
│     │       │                                                │
│     │       ├─► 遍历所有zone                                │
│     │       │                                                │
│     │       └─► compact_zone()           // 规整zone       │
│     │                                                        │
│     └─► proactive_compaction()          // 主动规整检查    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、主动规整与被动规整

### 9.1 主动规整（Proactive Compaction）

**目的**：在碎片化严重之前预先规整，避免分配时才规整的开销。

```c
// 主动规整的触发条件
static bool proactive_compaction_node(pg_data_t *pgdat)
{
    int zoneid;
    unsigned long score, threshold;
    
    threshold = sysctl_compaction_proactiveness;  // 用户可配置
    
    for (zoneid = 0; zoneid < pgdat->nr_zones; zoneid++) {
        struct zone *zone = &pgdat->node_zones[zoneid];
        
        // 计算碎片分数
        score = fragmentation_index(zone, COMPACTION_HPAGE_ORDER);
        
        // 如果碎片分数超过阈值，需要主动规整
        if (score > threshold)
            return true;
    }
    
    return false;
}
```

### 9.2 碎片指数计算

```c
int fragmentation_index(struct zone *zone, unsigned int order)
{
    unsigned long total, free, fragments;
    
    // 总页面数
    total = zone->present_pages;
    
    // 空闲页面数
    free = zone_page_state(zone, NR_FREE_PAGES);
    
    // 无法满足order阶分配的碎片
    fragments = extfrag_for_order(zone, order);
    
    // 计算碎片指数（0-1000）
    return (fragments * 1000) / total;
}
```

### 9.3 sysctl参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| vm.compaction_proactiveness | 20 | 主动规整阈值（0-100） |
| vm.extfrag_threshold | 500 | 外部碎片阈值 |
| vm.compact_unevictable_allowed | 1 | 是否允许规整不可驱逐页 |

### 9.4 主动规整 vs 被动规整

| 特性 | 主动规整 | 被动规整 |
|------|----------|----------|
| 触发时机 | 定期检查 | 内存压力大时 |
| 执行者 | kcompactd | kcompactd |
| 目的 | 预防碎片 | 应对内存压力 |
| 开销 | 分散 | 集中 |
| 效果 | 渐进改善 | 快速改善 |

---

## 十、完整使用示例

### 10.1 示例1：手动触发规整

```c
#include <linux/mm.h>
#include <linux/compaction.h>

// 手动触发指定zone的规整
void manual_compact_zone(struct zone *zone)
{
    struct compact_control cc = {
        .zone = zone,
        .order = 9,              // 规整目标：512页（2MB）
        .mode = MIGRATE_SYNC,    // 同步模式
        .direct_compaction = false,
        .whole_zone = true,      // 扫描整个zone
    };
    
    enum compact_result ret;
    
    ret = compact_zone(&cc, NULL);
    
    switch (ret) {
    case COMPACT_SUCCESS:
        printk("规整成功\n");
        break;
    case COMPACT_COMPLETE:
        printk("规整完成，但未满足需求\n");
        break;
    case COMPACT_SKIPPED:
        printk("跳过规整\n");
        break;
    default:
        printk("规整结果：%d\n", ret);
    }
}
```

### 10.2 示例2：检查碎片程度

```c
#include <linux/compaction.h>

// 检查zone的碎片程度
void check_fragmentation(struct zone *zone)
{
    int frag_index;
    unsigned int order;
    
    for (order = 0; order < MAX_ORDER; order++) {
        frag_index = fragmentation_index(zone, order);
        
        printk("Zone %s, order %d: 碎片指数 = %d\n",
               zone->name, order, frag_index);
        
        // 碎片指数范围：0-1000
        // 0 = 无碎片
        // 1000 = 完全碎片化
    }
}
```

### 10.3 示例3：监控规整统计

```c
#include <linux/vmstat.h>

// 打印规整统计信息
void print_compaction_stats(void)
{
    unsigned long compact_stall;
    unsigned long compact_fail;
    unsigned long compact_success;
    
    // 获取规整统计
    compact_stall = global_node_page_state(COMPACTSTALL);
    compact_fail = global_node_page_state(COMPACTFAIL);
    compact_success = global_node_page_state(COMPACTSUCCESS);
    
    printk("规整统计:\n");
    printk("  触发次数: %lu\n", compact_stall);
    printk("  失败次数: %lu\n", compact_fail);
    printk("  成功次数: %lu\n", compact_success);
    
    if (compact_stall > 0) {
        printk("  成功率: %lu%%\n", 
               compact_success * 100 / compact_stall);
    }
}
```

### 10.4 示例4：透明大页相关规整

```c
#include <linux/huge_mm.h>

// 为透明大页分配做准备
void prepare_for_thp(struct zone *zone)
{
    struct compact_control cc = {
        .zone = zone,
        .order = HPAGE_PMD_ORDER - PAGE_SHIFT,  // 2MB大页
        .mode = MIGRATE_SYNC_LIGHT,
        .direct_compaction = true,
    };
    
    // 检查是否需要规整
    if (compaction_suitable(zone, cc.order, 0, 0) == COMPACT_CONTINUE) {
        // 执行规整
        compact_zone(&cc, NULL);
    }
}
```

### 10.5 示例5：通过sysctl配置规整

```bash
# 查看当前规整配置
cat /proc/sys/vm/compaction_proactiveness
cat /proc/sys/vm/extfrag_threshold

# 设置主动规整阈值（更积极）
echo 50 > /proc/sys/vm/compaction_proactiveness

# 设置外部碎片阈值
echo 300 > /proc/sys/vm/extfrag_threshold

# 允许规整不可驱逐页
echo 1 > /proc/sys/vm/compact_unevictable_allowed
```

---

## 十一、常见问题与注意事项

### 11.1 规整开销

```
┌─────────────────────────────────────────────────────────────┐
│                    规整开销分析                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CPU开销：                                                   │
│    - 页面隔离：遍历pageblock                                 │
│    - 数据复制：逐字节拷贝                                    │
│    - 页表更新：遍历所有映射                                  │
│    - TLB刷新：影响其他进程                                   │
│                                                             │
│  内存开销：                                                  │
│    - 临时分配新页面                                          │
│    - 锁定页面防止并发访问                                    │
│                                                             │
│  时间开销：                                                  │
│    - 异步规整：较短                                          │
│    - 同步规整：可能较长                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 规整失败的常见原因

| 原因 | 说明 | 解决方法 |
|------|------|----------|
| 页面被锁定 | 页面正在被使用 | 等待或重试 |
| 不可迁移页 | 内核页等 | 无法解决 |
| 内存不足 | 无空闲页作为目标 | 先回收内存 |
| 锁竞争 | 高并发场景 | 降低规整频率 |

### 11.3 规整与THP的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    THP与规整的关系                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  THP分配流程：                                               │
│                                                             │
│  1. 尝试分配2MB连续内存                                      │
│     │                                                        │
│     ▼                                                        │
│  2. 如果失败，触发直接规整                                   │
│     │                                                        │
│     ▼                                                        │
│  3. 规整后再次尝试分配                                       │
│     │                                                        │
│     ├─► 成功 → 使用大页                                     │
│     │                                                        │
│     └─► 失败 → 回退到4KB页                                  │
│                                                             │
│  建议：                                                      │
│    - 启用透明大页：echo always > /sys/kernel/mm/...         │
│    - 配置主动规整阈值                                        │
│    - 监控THP分配成功率                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.4 性能调优建议

```bash
# 1. 查看规整统计
cat /proc/vmstat | grep compact

# 2. 查看THP统计
cat /sys/kernel/mm/transparent_hugepage/thp_collapse_alloc_failed

# 3. 调整主动规整
# 更积极的主动规整（适合THP场景）
echo 60 > /proc/sys/vm/compaction_proactiveness

# 4. 调整碎片阈值
# 更低的阈值，更早触发规整
echo 200 > /proc/sys/vm/extfrag_threshold

# 5. 查看每个zone的碎片情况
cat /proc/buddyinfo
cat /proc/extfrag_index
```

### 11.5 调试技巧

```c
// 使用tracepoint跟踪规整
// 启用规整tracepoint
echo 1 > /sys/kernel/debug/tracing/events/compaction/enable

// 查看trace输出
cat /sys/kernel/debug/tracing/trace

// 典型输出：
// kcompactd_wake: node=0 order=9
// compact_begin: zone=Normal migrate_pfn=0x100 free_pfn=0x80000
// compact_migratepages: nr_migratepages=128 err=0
// compact_end: ret=COMPACT_SUCCESS
```

---

## 十二、总结

### 12.1 内存规整核心API速查表

| API | 功能 | 说明 |
|-----|------|------|
| compact_zone | 规整指定zone | 核心函数 |
| compaction_suitable | 检查是否需要规整 | 返回是否需要 |
| isolate_migratepages | 隔离待迁移页 | 扫描并隔离 |
| isolate_freepages | 隔离空闲页 | 扫描并隔离 |
| migrate_pages | 迁移页面 | 执行迁移 |
| wakeup_kcompactd | 唤醒kcompactd | 后台规整 |

### 12.2 设计要点总结

1. **双扫描器设计**：迁移扫描器和空闲扫描器相向移动
2. **页迁移机制**：通过复制数据实现页面移动
3. **多种触发方式**：直接规整、被动规整、主动规整
4. **优先级控制**：异步→同步轻量→完全同步
5. **推迟机制**：避免频繁规整失败

### 12.3 适用场景

- 透明大页（THP）分配
- hugetlbfs大页分配
- CMA连续内存分配
- 高阶内存分配

### 12.4 进一步学习

- **`include/linux/compaction.h`** - 规整头文件
- **`mm/compaction.c`** - 规整实现
- **`mm/migrate.c`** - 页迁移实现
- **`mm/page_alloc.c`** - 页面分配

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了内存规整的原理、实现和使用方法。内存规整是Linux内核解决外部碎片问题的核心机制，理解它是掌握Linux内存管理的关键。*
