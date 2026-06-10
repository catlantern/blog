# Linux 5.15 虚拟内存与分页机制详解：从问题到解决方案

## 目标

读完本文，你要明白两件事：

1. **Linux 虚拟内存是怎么工作的**
2. **为什么要设计成这样**

---

# 一、先从最根本的问题开始：程序需要内存

程序运行需要内存来存储：

- 代码（指令）
- 数据（变量）
- 栈（函数调用）
- 堆（动态分配）

但直接使用物理内存有很多问题。

---

# 二、直接使用物理内存的问题

假设我们直接使用物理内存：

## 问题 1：地址冲突

```
程序 A 想使用地址 0x1000
程序 B 也想使用地址 0x1000

如果直接使用物理内存，它们会冲突！
```

## 问题 2：内存不足

```
物理内存只有 8GB
但程序 A 需要 10GB
怎么办？
```

## 问题 3：内存碎片

```
内存状态：
[已用 1MB][空闲 2MB][已用 1MB][空闲 2MB][已用 1MB]

程序需要 4MB 连续内存
虽然总空闲 4MB，但不连续，无法分配！
```

## 问题 4：安全问题

```
程序 A 可以访问程序 B 的内存
恶意程序可以读取或修改其他程序的数据
```

---

# 三、于是引入虚拟内存：给每个进程一个独立的地址空间

## 核心思想

> **每个进程都认为自己独占整个内存地址空间**

例如：

- 进程 A：地址 0x1000 → 物理页 X
- 进程 B：地址 0x1000 → 物理页 Y

虽然虚拟地址相同，但映射到不同的物理页！

## 好处

1. **地址隔离**：每个进程有独立的地址空间
2. **内存保护**：进程不能访问其他进程的内存
3. **内存扩展**：可以使用交换分区，突破物理内存限制
4. **灵活分配**：不需要连续的物理内存

---

# 四、虚拟地址到物理地址的转换：需要页表

## 基本概念

- **虚拟地址**：程序看到的地址
- **物理地址**：内存芯片上的实际地址
- **页表**：虚拟地址到物理地址的映射表

## 页面大小

Linux 默认使用 4KB 页面：

```
1 页 = 4096 字节 = 4KB

虚拟地址：
┌─────────────────┬─────────────────┐
│   页号           │    页内偏移      │
│   高位           │    低 12 位      │
└─────────────────┴─────────────────┘

页内偏移：0 - 4095
```

## 简单的页表

```
页表是一个数组：

页表[0] → 物理页 100
页表[1] → 物理页 200
页表[2] → 物理页 300
...

虚拟地址 0x1000：
- 页号 = 0x1000 / 4096 = 1
- 页内偏移 = 0x1000 % 4096 = 0
- 物理地址 = 页表[1] * 4096 + 0 = 200 * 4096 + 0 = 0xC8000
```

---

# 五、但单级页表有问题：太大了！

## 问题

假设 64 位系统，使用 48 位地址：

```
地址空间：2^48 = 256 TB
页面大小：4KB = 2^12
页面数量：2^48 / 2^12 = 2^36 = 64 G 个页面

如果每个页表项占 8 字节：
页表大小 = 64 G * 8 = 512 GB！

每个进程都需要 512 GB 的页表？不可能！
```

---

# 六、于是引入多级页表：按需分配

## 核心思想

> **不预先分配所有页表，只分配需要的部分**

## Linux 5.15 的四级页表

```
虚拟地址 (48位):
┌────────┬────────┬────────┬────────┬────────┐
│ PGD索引 │ PUD索引│ PMD索引│ PTE索引│ 页内偏移│
│ (9位)  │ (9位)  │ (9位)  │ (9位)  │ (12位) │
└────────┴────────┴────────┴────────┴────────┘

每一级页表：
- 大小：4KB（一页）
- 项数：512 项（2^9）
- 每项大小：8 字节

地址转换流程：
CR3 → PGD → PUD → PMD → PTE → 物理页面
```

## 为什么节省空间？

```
假设进程只使用 1GB 内存：

单级页表：
- 需要 64 G 个页表项
- 页表大小：512 GB

四级页表：
- 1 个 PGD（4KB）
- 1 个 PUD（4KB）
- 512 个 PMD（2MB）
- 512 个 PTE（2MB）
- 总共：约 4MB

节省了 99.999% 的空间！
```

## Linux 5.15 的实现

**定义位置**：**`include/linux/mm_types.h`**

```c
/*
 * struct mm_struct - 进程内存描述符
 * 
 * 每个进程都有一个 mm_struct
 * 它描述了进程的整个虚拟地址空间
 */
struct mm_struct {
    struct {
        struct vm_area_struct *mmap;  /* VMA 链表 */
        struct rb_root mm_rb;         /* VMA 红黑树 */
        
        unsigned long mmap_base;      /* mmap 区域基址 */
        unsigned long task_size;      /* 地址空间大小 */
        
        pgd_t *pgd;                   /* 页全局目录指针 */
        
        atomic_t mm_users;            /* 用户计数 */
        atomic_t mm_count;            /* 引用计数 */
        
        int map_count;                /* VMA 数量 */
        
        spinlock_t page_table_lock;   /* 页表锁 */
        struct rw_semaphore mmap_lock;/* mmap 锁 */
        
        unsigned long total_vm;       /* 总虚拟内存 */
        unsigned long locked_vm;      /* 锁定的内存 */
        
        /* ... 其他字段 ... */
    };
};
```

---

# 七、页表项：不只是地址映射

## 页表项包含的信息

```
页表项 (64位):
┌──────────────────────────────────────┬─────┐
│      物理页帧号 (PFN)                 │标志位│
│         (40-52位)                    │(12位)│
└──────────────────────────────────────┴─────┘

标志位说明：
┌────┬────────────────────────────────────┐
│ P  │ Present: 页是否存在                │
├────┼────────────────────────────────────┤
│ R/W│ Read/Write: 0=只读, 1=读写         │
├────┼────────────────────────────────────┤
│ U/S│ User/Supervisor: 0=内核, 1=用户    │
├────┼────────────────────────────────────┤
│ A  │ Accessed: 是否被访问               │
├────┼────────────────────────────────────┤
│ D  │ Dirty: 是否被修改                  │
├────┼────────────────────────────────────┤
│ PS │ Page Size: 是否是大页              │
├────┼────────────────────────────────────┤
│ G  │ Global: 全局页                     │
├────┼────────────────────────────────────┤
│ NX │ No Execute: 禁止执行               │
└────┴────────────────────────────────────┘
```

## 为什么需要这些标志位？

### 1. Present (P) 位

```
P=0：页不存在

用途：
- 请求调页：页面不在内存中，需要从磁盘加载
- 节省内存：未使用的页面不需要物理内存
```

### 2. Read/Write (R/W) 位

```
R/W=0：只读
R/W=1：可读写

用途：
- 写时复制：fork() 后页面标记为只读
- 代码段保护：程序的代码不应该被修改
```

### 3. User/Supervisor (U/S) 位

```
U/S=0：只有内核可以访问
U/S=1：用户和内核都可以访问

用途：
- 内核空间保护：用户程序不能访问内核内存
- 安全性：防止恶意程序攻击内核
```

### 4. No Execute (NX) 位

```
NX=0：可以执行
NX=1：禁止执行

用途：
- 防止代码注入攻击：数据区不应该被执行
- 安全性：栈和堆默认禁止执行
```

---

# 八、虚拟内存区域（VMA）：管理进程的地址空间

## 问题

一个进程的地址空间包含多个区域：

- 代码段
- 数据段
- 堆
- 栈
- 共享库
- mmap 映射

如何高效管理这些区域？

## 解决方案：VMA（Virtual Memory Area）

**定义位置**：**`include/linux/mm_types.h`**

```c
/*
 * struct vm_area_struct - 虚拟内存区域
 * 
 * 描述进程地址空间中的一个连续区域
 * 每个区域有自己的属性和操作
 */
struct vm_area_struct {
    unsigned long vm_start;        /* 起始地址 */
    unsigned long vm_end;          /* 结束地址（不包含） */
    
    /* 链接到进程的 VMA 链表 */
    struct vm_area_struct *vm_next, *vm_prev;
    
    /* 红黑树节点，用于快速查找 */
    struct rb_node vm_rb;
    
    /* 所属的 mm_struct */
    struct mm_struct *vm_mm;
    
    /* 页面保护属性 */
    pgprot_t vm_page_prot;
    
    /* 标志位 */
    unsigned long vm_flags;
    
    /* 操作函数 */
    const struct vm_operations_struct *vm_ops;
    
    /* 文件映射相关 */
    unsigned long vm_pgoff;        /* 文件偏移（页单位） */
    struct file *vm_file;          /* 映射的文件 */
    
    /* 私有数据 */
    void *vm_private_data;
};
```

## VMA 的组织

```
进程的 VMA 组织：

1. 链表：按地址排序
   mm->mmap → VMA1 → VMA2 → VMA3 → ...

2. 红黑树：快速查找
        VMA2
       /    \
    VMA1    VMA3

为什么需要两种结构？
- 链表：遍历所有 VMA
- 红黑树：快速查找特定地址的 VMA
```

## VMA 标志位

```c
/* VMA 标志位 */
#define VM_NONE         0x00000000  /* 无权限 */
#define VM_READ         0x00000001  /* 可读 */
#define VM_WRITE        0x00000002  /* 可写 */
#define VM_EXEC         0x00000004  /* 可执行 */
#define VM_SHARED       0x00000008  /* 共享映射 */

#define VM_MAYREAD      0x00000010  /* 可能可读 */
#define VM_MAYWRITE     0x00000020  /* 可能可写 */
#define VM_MAYEXEC      0x00000040  /* 可能可执行 */
#define VM_MAYSHARE     0x00000080  /* 可能共享 */

#define VM_GROWSDOWN    0x00000100  /* 向下增长（栈） */
#define VM_UFFD_MISSING 0x00000200  /* userfaultfd 缺页 */
#define VM_PFNMAP       0x00000400  /* 页帧号映射 */
#define VM_UFFD_WP      0x00001000  /* userfaultfd 写保护 */

#define VM_LOCKED       0x00002000  /* 锁定在内存中 */
#define VM_IO           0x00004000  /* IO 映射 */
#define VM_SEQ_READ     0x00008000  /* 顺序读 */
#define VM_RAND_READ    0x00010000  /* 随机读 */

#define VM_DONTCOPY     0x00020000  /* fork 时不复制 */
#define VM_DONTEXPAND   0x00040000  /* 不可扩展 */
#define VM_LOCKONFAULT  0x00080000  /* 错误时锁定 */
#define VM_ACCOUNT      0x00100000  /* 是否计入 committed_as */

#define VM_NORESERVE    0x00200000  /* 不预留交换空间 */
#define VM_HUGETLB      0x00400000  /* 大页映射 */
#define VM_SYNC         0x00800000  /* 同步写 */
#define VM_ARCH_1       0x01000000  /* 架构特定 */
#define VM_WIPEONFORK   0x02000000  /* fork 后清零 */
#define VM_DONTDUMP     0x04000000  /* 不包含在 core dump */
```

## 进程地址空间布局

```
Linux x86_64 进程地址空间：

用户空间（0x0000000000000000 - 0x00007FFFFFFFFFFF）：
┌─────────────────────────────────────────┐
│ 0x00007FFFFFFFFFFF                      │
│         ↑                               │
│         │ 栈（向下增长）                 │
│         ↓                               │
├─────────────────────────────────────────┤
│                                         │
│         （共享库、mmap 区域）            │
│                                         │
├─────────────────────────────────────────┤
│         ↑                               │
│         │ 堆（向上增长）                 │
│         ↓                               │
├─────────────────────────────────────────┤
│         BSS 段（未初始化数据）           │
├─────────────────────────────────────────┤
│         数据段（已初始化数据）           │
├─────────────────────────────────────────┤
│         代码段（只读）                   │
├─────────────────────────────────────────┤
│ 0x0000000000000000                      │
└─────────────────────────────────────────┘

内核空间（0xFFFF800000000000 - 0xFFFFFFFFFFFFFFFF）：
┌─────────────────────────────────────────┐
│         内核代码和数据                   │
│         内核映射区域                     │
│         ...                             │
└─────────────────────────────────────────┘
```

---

# 九、页错误：当访问的页面不在内存中

## 什么是页错误？

当 CPU 访问一个虚拟地址时，可能发生以下情况：

1. **页不存在**（P=0）：页面不在物理内存中
2. **权限错误**：访问了只读页面、用户访问了内核页面等

这些情况会触发**页错误异常**。

## 页错误处理流程

```
访问虚拟地址
    │
    ▼
CPU 检查页表
    │
    ├─→ 页存在且权限正确 → 正常访问
    │
    └─→ 页不存在或权限错误
            │
            ▼
        触发页错误异常（INT 14）
            │
            ▼
        内核处理页错误
            │
            ├─→ 合法访问
            │       │
            │       ├─→ 页不存在
            │       │       │
            │       │       ├─→ 匿名页：分配新页面
            │       │       ├─→ 文件页：从文件读取
            │       │       └─→ 交换页：从交换分区读取
            │       │
            │       └─→ 权限错误（写只读页）
            │               │
            │               └─→ 写时复制
            │
            └─→ 非法访问
                    │
                    └─→ 发送 SIGSEGV 信号（段错误）
```

## Linux 5.15 的实现

**定义位置**：**`mm/memory.c`**

```c
/*
 * handle_mm_fault - 处理页错误
 * 
 * 参数：
 *   vma - 虚拟内存区域
 *   address - 错误地址
 *   flags - 错误标志
 * 
 * 返回：
 *   0 - 成功
 *   非零 - 错误码
 */
vm_fault_t handle_mm_fault(struct vm_area_struct *vma,
                           unsigned long address, unsigned int flags)
{
    vm_fault_t ret;
    
    /* 更新统计信息 */
    __set_current_state(TASK_RUNNING);
    
    /* 检查内存控制器限制 */
    if (mem_cgroup_charge(vma->vm_mm, address, flags))
        return VM_FAULT_OOM;
    
    /* 调用实际的错误处理函数 */
    ret = __handle_mm_fault(vma, address, flags);
    
    return ret;
}

/*
 * __handle_mm_fault - 实际的页错误处理
 * 
 * 遍历页表层级，找到或创建页表项
 */
static vm_fault_t __handle_mm_fault(struct vm_area_struct *vma,
                                    unsigned long address, unsigned int flags)
{
    struct mm_struct *mm = vma->vm_mm;
    unsigned long pgd_addr = address & PGDIR_MASK;
    pgd_t *pgd;
    p4d_t *p4d;
    vm_fault_t ret;
    
    /* 获取 PGD */
    pgd = pgd_offset(mm, address);
    
    /* 获取或创建 P4D */
    p4d = p4d_alloc(mm, pgd, address);
    if (!p4d)
        return VM_FAULT_OOM;
    
    /* 获取或创建 PUD */
    vmf.pud = pud_alloc(mm, p4d, address);
    if (!vmf.pud)
        return VM_FAULT_OOM;
    
    /* 检查是否是大页（PUD 级别） */
    if (pud_none(*vmf.pud) &&
        hugepage_vma_check(vma, vm_flags, false, true)) {
        ret = create_huge_pud(&vmf);
        if (!(ret & VM_FAULT_FALLBACK))
            return ret;
    }
    
    /* 获取或创建 PMD */
    vmf.pmd = pmd_alloc(mm, vmf.pud, address);
    if (!vmf.pmd)
        return VM_FAULT_OOM;
    
    /* 检查是否是大页（PMD 级别） */
    if (pmd_none(*vmf.pmd) &&
        hugepage_vma_check(vma, vm_flags, true, true)) {
        ret = create_huge_pmd(&vmf);
        if (!(ret & VM_FAULT_FALLBACK))
            return ret;
    }
    
    /* 处理 PTE 级别的错误 */
    return handle_pte_fault(&vmf);
}

/*
 * handle_pte_fault - PTE 级别的页错误处理
 */
static vm_fault_t handle_pte_fault(struct vm_fault *vmf)
{
    /* 情况 1：PTE 不存在 */
    if (!vmf->pte) {
        if (vma_is_anonymous(vmf->vma))
            /* 匿名页：分配新页面 */
            return do_anonymous_page(vmf);
        else
            /* 文件映射：从文件读取 */
            return do_fault(vmf);
    }
    
    /* 情况 2：PTE 存在但页不在内存中 */
    if (!pte_present(*vmf->pte)) {
        if (pte_none(*vmf->pte))
            /* 页面从未分配 */
            return do_anonymous_page(vmf);
        else
            /* 页面被换出到交换分区 */
            return do_swap_page(vmf);
    }
    
    /* 情况 3：写保护错误 */
    if (vmf->flags & FAULT_FLAG_WRITE) {
        if (!pte_write(*vmf->pte))
            /* 写时复制 */
            return do_wp_page(vmf);
    }
    
    /* 情况 4：NUMA 平衡 */
    if (pte_protnone(vmf->orig_pte) && vma_is_accessible(vmf->vma))
        return do_numa_page(vmf);
    
    return 0;
}
```

---

# 十、写时复制（COW）：高效的进程创建

## 问题：fork() 需要复制整个地址空间

```
进程 A 有 1GB 内存
fork() 创建进程 B

如果立即复制所有内存：
- 需要 1GB 物理内存
- 复制需要时间
- 但 fork() 后通常立即 exec()，复制就浪费了！
```

## 解决方案：写时复制（Copy-on-Write）

### 核心思想

> **不立即复制，等真正需要写入时再复制**

### 实现步骤

```
fork() 系统调用：
    │
    ▼
1. 复制页表（不复制物理页面）
    │
    ▼
2. 将所有页面标记为只读
    │
    ▼
3. 增加物理页面的引用计数
    │
    ▼
父子进程共享物理页面（只读）
    │
    ├─→ 进程读取：正常执行
    │
    └─→ 进程写入：
            │
            ▼
        触发页错误（写保护错误）
            │
            ▼
        分配新物理页面
            │
            ▼
        复制内容
            │
            ▼
        更新页表项为可写
            │
            ▼
        进程继续写入
```

## Linux 5.15 的实现

**定义位置**：**`mm/memory.c`**

```c
/*
 * do_wp_page - 处理写保护错误
 * 
 * 实现写时复制
 */
static vm_fault_t do_wp_page(struct vm_fault *vmf)
{
    struct vm_area_struct *vma = vmf->vma;
    struct page *page = vmf->page;
    
    /* 情况 1：页面只有一个引用 */
    if (page_count(page) == 1) {
        /* 直接设置为可写 */
        pte_unshare(vmf);
        wp_page_reuse(vmf);
        return VM_FAULT_WRITE;
    }
    
    /* 情况 2：页面有多个引用，需要复制 */
    return wp_page_copy(vmf);
}

/*
 * wp_page_copy - 复制页面
 */
static vm_fault_t wp_page_copy(struct vm_fault *vmf)
{
    struct page *old_page = vmf->page;
    struct page *new_page;
    
    /* 分配新页面 */
    new_page = alloc_page_vma(GFP_HIGHUSER_MOVABLE, vmf->vma, vmf->address);
    if (!new_page)
        return VM_FAULT_OOM;
    
    /* 复制内容 */
    copy_user_page(new_page, old_page, vmf->address);
    
    /* 更新页表项 */
    pte_t entry = mk_pte(new_page, vmf->vma->vm_page_prot);
    entry = pte_mkdirty(entry);
    entry = pte_mkyoung(entry);
    entry = pte_mkwrite(entry);
    
    set_pte_at(vmf->vma->vm_mm, vmf->address, vmf->pte, entry);
    
    /* 减少旧页面的引用计数 */
    put_page(old_page);
    
    return VM_FAULT_WRITE;
}
```

## 写时复制的优势

```
假设进程有 1GB 内存，fork() 后：

立即复制：
- 时间：约 100ms
- 内存：需要额外的 1GB

写时复制：
- 时间：约 1ms（只复制页表）
- 内存：几乎不需要额外内存
- 只有写入的页面才会被复制

统计：fork() 后，通常只有 10-20% 的页面会被写入
所以写时复制节省了 80-90% 的时间和内存！
```

---

# 十一、请求调页：按需加载页面

## 问题：程序启动时需要加载所有代码吗？

```
一个程序有 100MB 代码
但启动时可能只需要 1MB

如果启动时加载所有代码：
- 启动慢
- 浪费内存
```

## 解决方案：请求调页（Demand Paging）

### 核心思想

> **只加载需要的页面，其他页面等需要时再加载**

### 实现步骤

```
程序启动：
    │
    ▼
只加载第一页代码
其他页面的 PTE 标记为 P=0
    │
    ▼
程序执行
    │
    ▼
访问某个函数（地址 0x5000）
    │
    ▼
页错误（P=0）
    │
    ▼
从可执行文件读取页面
    │
    ▼
更新页表项（P=1）
    │
    ▼
继续执行
```

## Linux 5.15 的实现

```c
/*
 * do_fault - 处理文件映射的页错误
 */
static vm_fault_t do_fault(struct vm_fault *vmf)
{
    struct vm_area_struct *vma = vmf->vma;
    struct file *file = vma->vm_file;
    
    /* 调用文件系统的 fault 方法 */
    return file->f_op->mmap(vma, vmf);
}

/*
 * filemap_fault - 文件映射的页错误处理
 */
vm_fault_t filemap_fault(struct vm_fault *vmf)
{
    struct file *file = vmf->vma->vm_file;
    struct address_space *mapping = file->f_mapping;
    pgoff_t offset = vmf->pgoff;
    
    /* 在页缓存中查找页面 */
    struct page *page = find_get_page(mapping, offset);
    
    if (!page) {
        /* 页面不在缓存中，从磁盘读取 */
        page = page_cache_alloc(mapping);
        if (!page)
            return VM_FAULT_OOM;
        
        /* 从文件读取数据 */
        int ret = mapping->a_ops->readpage(file, page);
        if (ret)
            return VM_FAULT_SIGBUS;
    }
    
    /* 更新页表项 */
    vmf->page = page;
    return VM_FAULT_LOCKED;
}
```

## 预读：提高性能

```
请求调页的问题：
每次只读取一页，频繁的磁盘 IO

解决方案：预读（Readahead）
读取一页时，顺便读取后续几页

例如：
访问页面 10
预读页面 11, 12, 13, 14, 15, 16

这样后续访问时，页面已经在内存中了！
```

---

# 十一-B、页缓存：文件数据的内存缓存

## 问题：每次读取文件都要访问磁盘吗？

```
读取一个 1GB 的文件：
- 第一次读取：从磁盘读取，需要 10 秒
- 第二次读取：还要从磁盘读取，又需要 10 秒？

这太慢了！
```

## 解决方案：页缓存（Page Cache）

### 核心思想

> **将文件数据缓存在内存中，避免重复的磁盘 IO**

### 页缓存的作用

```
第一次读取文件：
    │
    ▼
从磁盘读取数据
    │
    ▼
存入页缓存
    │
    ▼
返回给用户

第二次读取同一文件：
    │
    ▼
直接从页缓存读取
    │
    ▼
返回给用户（快得多！）
```

## 页缓存的核心数据结构

### 1. address_space：页缓存的管理者

**定义位置**：**`include/linux/fs.h`**

```c
/*
 * address_space - 页缓存的核心结构
 * 
 * 每个文件都有一个 address_space
 * 用于管理该文件的页缓存
 */
struct address_space {
    struct inode            *host;              /* 所属的 inode */
    struct xarray           i_pages;            /* 页缓存树（存储页面） */
    struct rw_semaphore     invalidate_lock;    /* 失效锁 */
    gfp_t                   gfp_mask;           /* 内存分配标志 */
    atomic_t                i_mmap_writable;    /* 可写映射计数 */
    struct rb_root_cached   i_mmap;             /* 私有和共享映射树 */
    struct rw_semaphore     i_mmap_rwsem;       /* 映射保护锁 */
    unsigned long           nrpages;            /* 页面总数 */
    pgoff_t                 writeback_index;    /* 回写起始位置 */
    const struct address_space_operations *a_ops; /* 操作函数 */
    unsigned long           flags;              /* 标志位 */
    errseq_t                wb_err;             /* 回写错误 */
    spinlock_t              private_lock;       /* 私有锁 */
    struct list_head        private_list;       /* 私有链表 */
    void                    *private_data;      /* 私有数据 */
};
```

**关键字段说明**：

| 字段 | 说明 |
|------|------|
| `host` | 指向所属的 inode（文件的元数据） |
| `i_pages` | xarray 结构，存储所有缓存的页面 |
| `nrpages` | 缓存的页面总数 |
| `a_ops` | 操作函数表（读、写、同步等） |

### 2. xarray：页缓存的组织方式

**为什么使用 xarray？**

```
传统数组的问题：
- 文件可能很大（几 GB 到几 TB）
- 但只缓存部分页面
- 使用数组会浪费大量空间

xarray 的优势：
- 稀疏存储：只存储存在的页面
- 快速查找：O(log n) 时间复杂度
- 高效遍历：支持范围查询
```

**xarray 的结构**：

```
文件偏移量（页索引）：
    0    1    2    3    4    5    6    7    8    9   10
  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
  │ P │   │ P │ P │   │   │ P │   │   │ P │   │
  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
    │       │   │           │           │
    │       │   │           │           └─ 页面 9
    │       │   │           └─ 页面 6
    │       │   └─ 页面 3
    │       └─ 页面 2
    └─ 页面 0

P = 已缓存的页面
空 = 未缓存的页面
```

### 3. address_space_operations：页缓存的操作函数

**定义位置**：**`include/linux/fs.h`**

```c
/*
 * address_space_operations - 页缓存的操作函数表
 * 
 * 不同文件系统可以实现不同的操作
 */
struct address_space_operations {
    /* 读取页面 */
    int (*readpage)(struct file *, struct page *);
    
    /* 读取多个页面 */
    int (*readpages)(struct file *filp, struct address_space *mapping,
                     struct list_head *pages, unsigned nr_pages);
    
    /* 写入页面 */
    int (*writepage)(struct page *page, struct writeback_control *wbc);
    
    /* 写入多个页面 */
    int (*writepages)(struct address_space *, struct writeback_control *);
    
    /* 脏页标记 */
    int (*set_page_dirty)(struct page *page);
    
    /* 准备写入 */
    int (*write_begin)(struct file *, struct address_space *mapping,
                       loff_t pos, unsigned len, unsigned flags,
                       struct page **pagep, void **fsdata);
    
    /* 完成写入 */
    int (*write_end)(struct file *, struct address_space *mapping,
                     loff_t pos, unsigned len, unsigned copied,
                     struct page *page, void *fsdata);
    
    /* 页错误处理 */
    vm_fault_t (*fault)(struct vm_fault *vmf);
    
    /* 映射页面 */
    vm_fault_t (*map_pages)(struct vm_fault *vmf,
                            pgoff_t start_pgoff, pgoff_t end_pgoff);
    
    /* 直接 IO */
    ssize_t (*direct_IO)(struct kiocb *, struct iov_iter *iter);
    
    /* 页面迁移 */
    int (*migratepage)(struct address_space *,
                       struct page *, struct page *, enum migrate_mode);
    
    /* 释放页面 */
    void (*freepage)(struct page *);
};
```

## 页缓存的工作流程

### 1. 读取文件数据

**流程图**：

```
用户读取文件
    │
    ▼
查找页缓存（find_get_page）
    │
    ├─→ 页面在缓存中
    │       │
    │       ├─→ 页面是最新的（Uptodate）
    │       │       │
    │       │       └─→ 直接返回数据
    │       │
    │       └─→ 页面不是最新的
    │               │
    │               └─→ 从磁盘读取数据（readpage）
    │
    └─→ 页面不在缓存中
            │
            ├─→ 分配新页面
            │
            ├─→ 加入页缓存
            │
            ├─→ 从磁盘读取数据（readpage）
            │
            └─→ 返回数据
```

**Linux 5.15 的实现**：

**定义位置**：**`mm/filemap.c`**

```c
/*
 * filemap_read - 从页缓存读取数据
 */
ssize_t filemap_read(struct kiocb *iocb, struct iov_iter *iter,
                     ssize_t already_read)
{
    struct file *filp = iocb->ki_filp;
    struct address_space *mapping = filp->f_mapping;
    struct file_ra_state *ra = &filp->f_ra;
    struct pagevec pvec;
    pgoff_t index = iocb->ki_pos >> PAGE_SHIFT;
    pgoff_t last_index;
    size_t copied = 0;
    
    /* 计算最后一页的索引 */
    last_index = DIV_ROUND_UP(iocb->ki_pos + iter->count, PAGE_SIZE);
    
    /* 初始化页面向量 */
    pagevec_init(&pvec);
    
    /* 循环读取页面 */
    while (index < last_index) {
        /* 获取页面 */
        int err = filemap_get_pages(iocb, iter, &pvec);
        if (err)
            return err;
        
        /* 复制数据到用户空间 */
        copied = copy_page_to_iter(page, offset, bytes, iter);
        
        /* 更新位置 */
        iocb->ki_pos += copied;
        index++;
    }
    
    return copied;
}

/*
 * filemap_get_pages - 获取页面
 */
static int filemap_get_pages(struct kiocb *iocb, struct iov_iter *iter,
                             struct pagevec *pvec)
{
    struct file *filp = iocb->ki_filp;
    struct address_space *mapping = filp->f_mapping;
    pgoff_t index = iocb->ki_pos >> PAGE_SHIFT;
    pgoff_t last_index;
    
    last_index = DIV_ROUND_UP(iocb->ki_pos + iter->count, PAGE_SIZE);
    
    /* 尝试从页缓存获取页面 */
    filemap_get_read_batch(mapping, index, last_index - 1, pvec);
    
    if (!pagevec_count(pvec)) {
        /* 页面不在缓存中，触发预读 */
        page_cache_sync_readahead(mapping, ra, filp, index,
                                  last_index - index);
        
        /* 再次尝试获取页面 */
        filemap_get_read_batch(mapping, index, last_index - 1, pvec);
    }
    
    if (!pagevec_count(pvec)) {
        /* 仍然没有页面，创建新页面 */
        return filemap_create_page(filp, mapping, index, pvec);
    }
    
    /* 检查页面是否最新 */
    struct page *page = pvec->pages[pagevec_count(pvec) - 1];
    if (!PageUptodate(page)) {
        /* 页面不是最新的，从磁盘读取 */
        return filemap_update_page(iocb, mapping, iter, page);
    }
    
    return 0;
}
```

### 2. 写入文件数据

**流程图**：

```
用户写入文件
    │
    ▼
查找页缓存
    │
    ├─→ 页面在缓存中
    │       │
    │       └─→ 标记为脏页（Dirty）
    │
    └─→ 页面不在缓存中
            │
            ├─→ 分配新页面
            │
            ├─→ 加入页缓存
            │
            └─→ 标记为脏页
    │
    ▼
返回成功（数据在内存中）
    │
    ▼
后台线程定期回写脏页到磁盘
```

**Linux 5.15 的实现**：

```c
/*
 * generic_perform_write - 执行写入操作
 */
ssize_t generic_perform_write(struct file *file,
                              struct iov_iter *i, loff_t *pos)
{
    struct address_space *mapping = file->f_mapping;
    const struct address_space_operations *a_ops = mapping->a_ops;
    long status = 0;
    ssize_t written = 0;
    
    do {
        struct page *page;
        unsigned long offset;
        unsigned long bytes;
        size_t copied;
        void *fsdata;
        
        offset = (*pos) & (PAGE_SIZE - 1);
        bytes = min_t(unsigned long, PAGE_SIZE - offset,
                      iov_iter_count(i));
        
        /* 准备写入 */
        status = a_ops->write_begin(file, mapping, *pos, bytes, 0,
                                    &page, &fsdata);
        if (unlikely(status < 0))
            break;
        
        /* 复制数据到页面 */
        copied = copy_page_from_iter(page, offset, bytes, i);
        
        /* 完成写入 */
        status = a_ops->write_end(file, mapping, *pos, bytes, copied,
                                  page, fsdata);
        if (unlikely(status < 0))
            break;
        
        /* 标记页面为脏 */
        if (copied > 0) {
            set_page_dirty(page);
            written += copied;
            *pos += copied;
        }
    } while (iov_iter_count(i));
    
    return written ? written : status;
}
```

### 3. 脏页回写

**为什么需要回写？**

```
写入文件时：
- 数据先写入页缓存
- 标记为脏页
- 立即返回成功

问题：
- 如果系统崩溃，脏页会丢失
- 需要定期将脏页写入磁盘

解决方案：
- 后台线程定期回写脏页
- 用户可以调用 fsync() 强制回写
```

**回写策略**：

```
1. 定期回写
   - 每 30 秒回写一次
   - 通过 /proc/sys/vm/dirty_writeback_centisecs 配置

2. 脏页比例回写
   - 脏页达到总内存的 10% 时开始回写
   - 通过 /proc/sys/vm/dirty_ratio 配置

3. 用户强制回写
   - fsync()：回写指定文件
   - sync()：回写所有脏页
```

## 页缓存的高级特性

### 1. 预读机制（Readahead）

**核心思想**：

> **预测程序会访问哪些页面，提前读取到页缓存中**

**预读算法**：

```
顺序读取检测：
- 如果连续读取页面 0, 1, 2, 3
- 判断为顺序读取
- 预读页面 4, 5, 6, 7, 8, 9, 10, 11

随机读取检测：
- 如果读取页面 0, 5, 10, 3
- 判断为随机读取
- 不预读

预读窗口：
- 初始预读：4 页
- 后续预读：逐渐增加（8, 16, 32 页）
- 最大预读：256 页（1MB）
```

**Linux 5.15 的实现**：

```c
/*
 * file_ra_state - 预读状态
 */
struct file_ra_state {
    pgoff_t start;              /* 预读起始位置 */
    unsigned int size;          /* 预读大小 */
    unsigned int async_size;    /* 异步预读大小 */
    unsigned int ra_pages;      /* 最大预读页数 */
    unsigned int mmap_miss;     /* mmap 缺失计数 */
    loff_t prev_pos;            /* 上次读取位置 */
};

/*
 * page_cache_sync_readahead - 同步预读
 */
void page_cache_sync_readahead(struct address_space *mapping,
                               struct file_ra_state *ra, struct file *filp,
                               pgoff_t index, unsigned long req_count)
{
    /* 检测顺序读取 */
    if (index == ra->prev_pos + 1) {
        /* 顺序读取：增加预读窗口 */
        ra->size = min(ra->size * 2, ra->ra_pages);
    } else {
        /* 随机读取：重置预读窗口 */
        ra->size = 4;  /* 初始预读 4 页 */
    }
    
    /* 执行预读 */
    __do_page_cache_readahead(mapping, filp, index, ra->size, 0);
    
    /* 更新状态 */
    ra->prev_pos = index;
}
```

### 2. 页缓存与内存映射

**内存映射（mmap）的优势**：

```
传统文件读取：
1. 从磁盘读取到页缓存
2. 从页缓存复制到用户缓冲区
3. 用户程序访问数据

内存映射：
1. 将文件直接映射到进程地址空间
2. 访问内存地址 = 访问文件数据
3. 省去一次复制！

性能提升：
- 减少一次内存复制
- 减少系统调用
- 适合大文件处理
```

**Linux 5.15 的实现**：

**定义位置**：**`mm/filemap.c`**

```c
/*
 * filemap_fault - 内存映射的页错误处理
 */
vm_fault_t filemap_fault(struct vm_fault *vmf)
{
    struct file *file = vmf->vma->vm_file;
    struct address_space *mapping = file->f_mapping;
    struct file_ra_state *ra = &file->f_ra;
    pgoff_t offset = vmf->pgoff;
    struct page *page;
    
    /* 在页缓存中查找页面 */
    page = find_get_page(mapping, offset);
    
    if (!page) {
        /* 页面不在缓存中 */
        
        /* 触发预读 */
        page_cache_sync_readahead(mapping, ra, file,
                                  offset, last_index - offset);
        
        /* 再次查找 */
        page = find_get_page(mapping, offset);
        if (!page) {
            /* 分配新页面并读取 */
            page = page_cache_alloc(mapping);
            mapping->a_ops->readpage(file, page);
        }
    }
    
    /* 检查页面是否最新 */
    if (!PageUptodate(page)) {
        /* 等待页面读取完成 */
        lock_page(page);
        if (!PageUptodate(page)) {
            unlock_page(page);
            put_page(page);
            return VM_FAULT_SIGBUS;
        }
        unlock_page(page);
    }
    
    /* 将页面映射到进程地址空间 */
    vmf->page = page;
    return VM_FAULT_LOCKED;
}

/*
 * filemap_map_pages - 批量映射页面
 * 
 * 优化：一次映射多个页面，减少页错误次数
 */
vm_fault_t filemap_map_pages(struct vm_fault *vmf,
                             pgoff_t start_pgoff, pgoff_t end_pgoff)
{
    struct vm_area_struct *vma = vmf->vma;
    struct file *file = vma->vm_file;
    struct address_space *mapping = file->f_mapping;
    pgoff_t last_pgoff = start_pgoff;
    XA_STATE(xas, &mapping->i_pages, start_pgoff);
    struct page *page;
    
    rcu_read_lock();
    
    /* 遍历页缓存 */
    xas_for_each(&xas, page, end_pgoff) {
        /* 跳过非最新页面 */
        if (!PageUptodate(page))
            continue;
        
        /* 映射页面到进程地址空间 */
        do_set_pte(vmf, page, addr);
        update_mmu_cache(vma, addr, vmf->pte);
    }
    
    rcu_read_unlock();
    
    return VM_FAULT_NOPAGE;
}
```

### 3. 页缓存统计信息

**查看页缓存状态**：

```bash
# 查看内存使用情况
cat /proc/meminfo

# 输出示例：
MemTotal:       16384000 kB
MemFree:         2000000 kB
Buffers:          500000 kB  # 缓冲区缓存
Cached:          8000000 kB  # 页缓存
SwapCached:        50000 kB  # 交换缓存
Active:          6000000 kB  # 活跃页面
Inactive:        4000000 kB  # 非活跃页面
```

**页缓存相关的内核参数**：

```bash
# 脏页比例（占总内存的百分比）
/proc/sys/vm/dirty_ratio = 20

# 开始后台回写的脏页比例
/proc/sys/vm/dirty_background_ratio = 10

# 回写间隔（百分之一秒）
/proc/sys/vm/dirty_writeback_centisecs = 500  # 5 秒

# 脏页过期时间（百分之一秒）
/proc/sys/vm/dirty_expire_centisecs = 3000  # 30 秒
```

## 页缓存与虚拟内存的关系

### 页缓存是虚拟内存的一部分

```
虚拟内存的组成：
┌─────────────────────────────────────┐
│        虚拟内存（Virtual Memory）      │
├─────────────────────────────────────┤
│  匿名页（Anonymous Pages）            │
│  - 进程的堆、栈                        │
│  - 通过 malloc() 分配                 │
│  - 可能被换出到交换分区                 │
├─────────────────────────────────────┤
│  文件页（File Pages）                 │
│  - 页缓存                             │
│  - 内存映射文件                        │
│  - 可以从文件重新读取                   │
└─────────────────────────────────────┘
```

### 页面回收策略

```
内存不足时，需要回收页面：

优先级：
1. 最少使用的文件页（页缓存）
   - 可以直接丢弃（干净页）
   - 或写入文件后丢弃（脏页）

2. 非活跃的匿名页
   - 换出到交换分区

为什么不优先换出匿名页？
- 匿名页没有后备存储，必须写入交换分区
- 文件页可以从文件重新读取，更快
- 页缓存通常更大，回收空间更多
```

### 页缓存的 LRU 链表

```
页缓存使用 LRU（最近最少使用）算法：

活跃文件页链表（Active File List）：
- 最近被访问的文件页
- 不容易被回收

非活跃文件页链表（Inactive File List）：
- 较长时间没被访问的文件页
- 容易被回收

页面访问时：
非活跃链表 → 活跃链表

内存不足时：
从非活跃链表尾部回收页面
```

**Linux 5.15 的实现**：

```c
/*
 * 页面回收的核心数据结构
 */
struct lruvec {
    struct list_head lists[NR_LRU_LISTS];
    /* 
     * LRU 链表：
     * LRU_INACTIVE_ANON - 非活跃匿名页
     * LRU_ACTIVE_ANON   - 活跃匿名页
     * LRU_INACTIVE_FILE - 非活跃文件页（页缓存）
     * LRU_ACTIVE_FILE   - 活跃文件页（页缓存）
     * LRU_UNEVICTABLE   - 不可换出页
     */
};

/*
 * mark_page_accessed - 标记页面被访问
 */
void mark_page_accessed(struct page *page)
{
    /* 从非活跃链表移到活跃链表 */
    if (!PageActive(page) && !PageUnevictable(page)) {
        SetPageActive(page);
        activate_page(page);
    }
}
```

## 页缓存的性能优化

### 1. 避免重复缓存

```
问题：
- 同一个文件被多个进程打开
- 是否会缓存多份？

解决方案：
- 页缓存与文件关联，不是与进程关联
- 所有进程共享同一份缓存
- 通过 address_space 统一管理
```

### 2. 零拷贝技术

```
传统文件传输：
磁盘 → 页缓存 → 用户缓冲区 → 内核缓冲区 → 网卡

零拷贝优化：
磁盘 → 页缓存 → 网卡

使用 sendfile() 系统调用：
- 直接从页缓存传输到网络
- 省去两次内存复制
- 大幅提升性能
```

### 3. 大页支持

```
问题：
- 传统页缓存使用 4KB 页面
- 大文件会产生大量页面
- 页表项多，TLB 缺失多

解决方案：
- 使用大页（2MB 或 1GB）
- 减少页面数量
- 减少 TLB 缺失

Linux 5.15 支持：
- Transparent Huge Pages (THP) for page cache
- 自动将小页合并为大页
```

## 页缓存的实际应用

### 1. 数据库系统

```
数据库通常有自己的缓存（如 MySQL 的 Buffer Pool）

问题：
- 数据库缓存 + 页缓存 = 双重缓存
- 浪费内存

解决方案：
- 使用 O_DIRECT 标志绕过页缓存
- 数据库自己管理缓存
- 更精确的控制
```

### 2. Web 服务器

```
Web 服务器大量读取静态文件

优势：
- 页缓存自动缓存热点文件
- 减少磁盘 IO
- 提高响应速度

优化：
- 使用 sendfile() 零拷贝传输
- 直接从页缓存到网络
```

### 3. 视频播放器

```
视频播放器读取大文件

优势：
- 顺序读取触发预读
- 页缓存缓存已播放部分
- 支持快退（向后跳转）

优化：
- 使用 mmap() 内存映射
- 直接访问页缓存
```

## 页缓存的问题与解决方案

### 1. 脏页丢失

```
问题：
- 系统崩溃时，脏页会丢失
- 用户以为写入成功，但数据丢失

解决方案：
- 关键数据使用 fsync() 强制回写
- 调整脏页回写策略
- 使用日志文件系统（如 ext4, xfs）
```

### 2. 页缓存污染

```
问题：
- 一次性读取大文件（如备份）
- 挤掉其他有用的缓存
- 系统性能下降

解决方案：
- 使用 posix_fadvise(POSIX_FADV_DONTNEED)
- 告诉内核这些页面不需要缓存
- 或使用 O_DIRECT 绕过页缓存
```

### 3. 内存压力

```
问题：
- 页缓存占用大量内存
- 影响进程内存分配

解决方案：
- 内核自动平衡页缓存和进程内存
- 内存不足时回收页缓存
- 可通过 /proc/sys/vm/swappiness 调整
```

## 页缓存的关键代码总结

### 1. 查找页面

```c
/* 在页缓存中查找页面 */
struct page *find_get_page(struct address_space *mapping, pgoff_t offset)
{
    return pagecache_get_page(mapping, offset, 0, 0);
}
```

### 2. 添加页面

```c
/* 添加页面到页缓存 */
int add_to_page_cache_lru(struct page *page, struct address_space *mapping,
                          pgoff_t offset, gfp_t gfp_mask)
{
    /* 设置页面属性 */
    page->mapping = mapping;
    page->index = offset;
    
    /* 添加到 xarray */
    xa_lock_irq(&mapping->i_pages);
    __add_to_page_cache(page, mapping, offset);
    xa_unlock_irq(&mapping->i_pages);
    
    /* 添加到 LRU 链表 */
    lru_cache_add(page);
    
    return 0;
}
```

### 3. 删除页面

```c
/* 从页缓存删除页面 */
void delete_from_page_cache(struct page *page)
{
    struct address_space *mapping = page_mapping(page);
    
    /* 从 xarray 删除 */
    xa_lock_irq(&mapping->i_pages);
    __delete_from_page_cache(page, NULL);
    xa_unlock_irq(&mapping->i_pages);
    
    /* 释放页面 */
    page_cache_free_page(mapping, page);
}
```

---

# 十一-C、伙伴系统：高效的物理页面分配

## 问题：如何管理物理内存的分配和释放？

```
物理内存：16GB
需要分配：
- 1 页（4KB）
- 8 页（32KB）
- 1024 页（4MB）

如何高效管理这些不同大小的分配？
```

## 解决方案：伙伴系统（Buddy System）

### 核心思想

> **将内存按 2 的幂次方分组，分配时分裂，释放时合并**

### 伙伴系统的原理

```
内存组织：
Order 0: 1 页（4KB）
Order 1: 2 页（8KB）
Order 2: 4 页（16KB）
Order 3: 8 页（32KB）
...
Order 10: 1024 页（4MB）

每个 order 维护一个空闲链表：
free_area[0] → [page] → [page] → [page] → ...
free_area[1] → [2 pages] → [2 pages] → ...
free_area[2] → [4 pages] → [4 pages] → ...
...
```

### 分配过程

```
请求：分配 8KB（Order 1）

步骤：
1. 检查 free_area[1]
   - 如果有空闲块，直接分配
   - 如果没有，继续

2. 检查 free_area[2]（4 页）
   - 如果有空闲块，分裂成两个 2 页块
   - 一个分配，一个放入 free_area[1]
   - 如果没有，继续

3. 检查 free_area[3]（8 页）
   - 如果有空闲块，分裂成两个 4 页块
   - 一个放入 free_area[2]，另一个继续分裂
   - 如果没有，继续向上查找

示例：
初始状态：
free_area[2]: [page 0-3] → [page 4-7] → [page 8-11]

分配 8KB（Order 1）：
1. free_area[1] 为空
2. 从 free_area[2] 取出 [page 0-3]
3. 分裂成 [page 0-1] 和 [page 2-3]
4. 分配 [page 0-1]，[page 2-3] 放入 free_area[1]

结果：
free_area[1]: [page 2-3]
free_area[2]: [page 4-7] → [page 8-11]
```

### 释放过程

```
释放：释放 8KB（Order 1，page 0-1）

步骤：
1. 检查伙伴块（page 2-3）是否空闲
   - 如果空闲，合并成 4 页块（page 0-3）
   - 放入 free_area[2]
   - 继续检查是否可以合并

2. 检查伙伴块（page 4-7）是否空闲
   - 如果空闲，合并成 8 页块（page 0-7）
   - 放入 free_area[3]
   - 继续向上合并

示例：
释放前：
free_area[1]: [page 2-3]
free_area[2]: [page 4-7] → [page 8-11]

释放 page 0-1：
1. 伙伴块 page 2-3 在 free_area[1] 中
2. 合并成 page 0-3，放入 free_area[2]
3. 伙伴块 page 4-7 在 free_area[2] 中
4. 合并成 page 0-7，放入 free_area[3]

结果：
free_area[3]: [page 0-7]
free_area[2]: [page 8-11]
```

## Linux 5.15 的实现

### 核心数据结构

**定义位置**：**`include/linux/mmzone.h`**

```c
/*
 * free_area - 空闲区域描述符
 */
struct free_area {
    struct list_head free_list[MIGRATE_TYPES];  /* 空闲链表 */
    unsigned long nr_free;                       /* 空闲块数量 */
};

/*
 * 迁移类型
 */
enum migratetype {
    MIGRATE_UNMOVABLE,     /* 不可移动：内核内存 */
    MIGRATE_MOVABLE,       /* 可移动：用户内存 */
    MIGRATE_RECLAIMABLE,   /* 可回收：页缓存 */
    MIGRATE_PCPTYPES,      /* Per-CPU 页面类型数量 */
    MIGRATE_HIGHATOMIC,    /* 高原子性保留 */
#ifdef CONFIG_CMA
    MIGRATE_CMA,           /* 连续内存分配器 */
#endif
#ifdef CONFIG_MEMORY_ISOLATION
    MIGRATE_ISOLATE,       /* 隔离区域 */
#endif
    MIGRATE_TYPES
};

/*
 * zone - 内存区域
 */
struct zone {
    /* 伙伴系统 */
    struct free_area free_area[MAX_ORDER];
    
    /* 区域标志 */
    unsigned long flags;
    
    /* 统计信息 */
    atomic_long_t vm_stat[NR_VM_ZONE_STAT_ITEMS];
    
    /* Per-CPU 页面缓存 */
    struct per_cpu_pages __percpu *per_cpu_pageset;
    
    /* 其他字段... */
};

/*
 * MAX_ORDER - 最大分配阶数
 */
#define MAX_ORDER 11  /* 最大分配 2^10 = 1024 页 = 4MB */
```

### 分配函数

**定义位置**：**`mm/page_alloc.c`**

```c
/*
 * alloc_pages - 分配物理页面
 * 
 * @gfp_mask: 分配标志
 * @order: 分配阶数（2^order 页）
 * 
 * 返回：指向第一个页面的指针
 */
struct page *alloc_pages(gfp_t gfp_mask, unsigned int order)
{
    return __alloc_pages(gfp_mask, order, numa_node_id(), NULL);
}

/*
 * __alloc_pages - 实际的分配函数
 */
struct page *__alloc_pages(gfp_t gfp_mask, unsigned int order,
                           int preferred_nid, nodemask_t *nodemask)
{
    struct page *page;
    unsigned int alloc_flags = ALLOC_WMARK_LOW;
    gfp_t alloc_gfp;
    struct alloc_context ac = { };
    
    /* 准备分配上下文 */
    if (!prepare_alloc_pages(gfp_mask, order, preferred_nid, nodemask,
                             &ac, &alloc_gfp, &alloc_flags))
        return NULL;
    
    /* 快速路径：从 Per-CPU 缓存分配 */
    page = get_page_from_freelist(alloc_gfp, order, alloc_flags, &ac);
    if (likely(page))
        goto out;
    
    /* 慢速路径：唤醒 kswapd，尝试压缩等 */
    alloc_gfp = gfp_to_alloc_gfp(gfp_mask);
    page = __alloc_pages_slowpath(alloc_gfp, order, &ac);
    
out:
    return page;
}

/*
 * get_page_from_freelist - 从空闲链表获取页面
 */
static struct page *get_page_from_freelist(gfp_t gfp_mask, unsigned int order,
                                           int alloc_flags,
                                           const struct alloc_context *ac)
{
    struct zoneref *z;
    struct zone *zone;
    struct per_cpu_pages *pcp;
    struct list_head *list;
    
    /* 遍历所有允许的区域 */
    for_next_zone_zonelist_nodemask(zone, z, ac->zonelist, ac->high_zoneidx,
                                    ac->nodemask) {
        
        /* 如果 order == 0，尝试从 Per-CPU 缓存分配 */
        if (order == 0) {
            page = rmqueue_pcplist(ac->preferred_zoneref->zone, zone,
                                   gfp_mask, ac->migratetype);
            if (page)
                return page;
        }
        
        /* 从伙伴系统分配 */
        page = __rmqueue(zone, order, gfp_mask, alloc_flags,
                         ac->migratetype);
        if (page) {
            prep_new_page(page, order, gfp_mask, alloc_flags);
            return page;
        }
    }
    
    return NULL;
}

/*
 * __rmqueue - 从伙伴系统移除页面
 */
static __always_inline struct page *__rmqueue(struct zone *zone,
                                              unsigned int order,
                                              gfp_t gfp_flags,
                                              unsigned int alloc_flags,
                                              int migratetype)
{
    struct page *page;
    
    /* 尝试从当前 order 分配 */
    page = __rmqueue_smallest(zone, order, migratetype);
    
    if (unlikely(!page)) {
        /* 当前 order 没有空闲块，尝试从更大的 order 分裂 */
        page = __rmqueue_fallback(zone, order, gfp_flags, alloc_flags,
                                  migratetype);
    }
    
    return page;
}

/*
 * __rmqueue_smallest - 从最小合适的 order 分配
 */
static __always_inline struct page *__rmqueue_smallest(struct zone *zone,
                                                       unsigned int order,
                                                       int migratetype)
{
    unsigned int current_order;
    struct free_area *area;
    struct page *page;
    
    /* 从当前 order 开始向上查找 */
    for (current_order = order; current_order < MAX_ORDER; ++current_order) {
        area = &(zone->free_area[current_order]);
        
        /* 检查是否有空闲块 */
        page = get_page_from_free_area(area, migratetype);
        if (!page)
            continue;
        
        /* 从链表中移除 */
        del_page_from_free_list(page, zone, current_order);
        
        /* 分裂页面 */
        expand(zone, page, order, current_order, migratetype);
        
        return page;
    }
    
    return NULL;
}

/*
 * expand - 分裂大块为小块
 */
static inline void expand(struct zone *zone, struct page *page,
                          int low, int high, int migratetype)
{
    unsigned long size = 1 << high;
    
    /* 从高 order 分裂到低 order */
    while (high > low) {
        high--;
        size >>= 1;
        
        /* 将右半部分加入空闲链表 */
        add_to_free_list(page + size, zone, high, migratetype);
        
        /* 设置伙伴位 */
        set_buddy_order(page + size, high);
    }
}
```

### 释放函数

```c
/*
 * __free_pages - 释放物理页面
 */
void __free_pages(struct page *page, unsigned int order)
{
    /* 减少引用计数 */
    if (put_page_testzero(page))
        free_the_page(page, order);
}

/*
 * free_the_page - 实际的释放函数
 */
inline void free_the_page(struct page *page, unsigned int order)
{
    /* 如果 order == 0，放入 Per-CPU 缓存 */
    if (order == 0)
        free_unref_page(page);
    else
        __free_pages_ok(page, order, FPI_NONE);
}

/*
 * __free_pages_ok - 释放页面到伙伴系统
 */
static void __free_pages_ok(struct page *page, unsigned int order,
                            fpi_t fpi_flags)
{
    unsigned long flags;
    int migratetype;
    unsigned long pfn = page_to_pfn(page);
    
    /* 获取迁移类型 */
    migratetype = get_pfnblock_migratetype(page, pfn);
    
    /* 禁用中断 */
    local_irq_save(flags);
    
    /* 释放页面 */
    __free_one_page(page, pfn, zone, order, migratetype, fpi_flags);
    
    /* 恢复中断 */
    local_irq_restore(flags);
}

/*
 * __free_one_page - 释放一个页面块并尝试合并
 */
static inline void __free_one_page(struct page *page, unsigned long pfn,
                                   struct zone *zone, unsigned int order,
                                   int migratetype, fpi_t fpi_flags)
{
    unsigned long buddy_pfn;
    unsigned long combined_pfn;
    
    /* 尝试合并伙伴块 */
    while (order < MAX_ORDER - 1) {
        /* 计算伙伴块的 PFN */
        buddy_pfn = __find_buddy_pfn(pfn, order);
        
        /* 检查伙伴块是否可以合并 */
        if (!page_is_buddy(page, buddy_pfn, order, migratetype))
            break;
        
        /* 从空闲链表移除伙伴块 */
        del_page_from_free_list(buddy_page, zone, order);
        
        /* 合并 */
        combined_pfn = buddy_pfn & pfn;
        page = page + (combined_pfn - pfn);
        pfn = combined_pfn;
        order++;
    }
    
    /* 将合并后的块加入空闲链表 */
    add_to_free_list(page, zone, order, migratetype);
}

/*
 * __find_buddy_pfn - 计算伙伴块的页帧号
 */
static inline unsigned long __find_buddy_pfn(unsigned long page_pfn,
                                             unsigned int order)
{
    return page_pfn ^ (1 << order);
}
```

## 伙伴系统的优势

### 1. 快速分配

```
时间复杂度：O(log n)

最坏情况：
- 需要从最高 order 分裂
- 分裂次数：MAX_ORDER - order
- 例如：分配 4KB，最多分裂 10 次

平均情况：
- 通常在低 order 就能找到空闲块
- 分裂次数很少
```

### 2. 减少外部碎片

```
外部碎片：
- 小的空闲块分散在内存中
- 无法满足大的连续分配

伙伴系统的解决方案：
- 自动合并相邻空闲块
- 保证 2^n 大小的连续内存

示例：
释放 page 0-1 和 page 2-3
自动合并成 page 0-3
可以满足 16KB 的分配
```

### 3. 支持多种迁移类型

```
为什么需要迁移类型？

问题：
- 不可移动页面（内核）和可移动页面（用户）混合
- 无法整理出大块连续内存

解决方案：
- 按迁移类型分组
- 不可移动页面：内核数据结构
- 可移动页面：用户进程内存
- 可回收页面：页缓存

好处：
- 可以移动可移动页面
- 整理出大块连续内存
- 支持内存压缩
```

## Per-CPU 页面缓存

### 为什么需要 Per-CPU 缓存？

```
问题：
- 单页分配（order 0）非常频繁
- 每次都需要获取 zone->lock
- 多 CPU 系统锁竞争严重

解决方案：
- 每个 CPU 维护一个页面缓存
- 分配和释放不需要锁
- 大幅提高性能
```

### Linux 5.15 的实现

```c
/*
 * per_cpu_pages - Per-CPU 页面缓存
 */
struct per_cpu_pages {
    int count;          /* 页面数量 */
    int high;           /* 高水位：超过则归还给伙伴系统 */
    int batch;          /* 批量分配/释放的数量 */
    
    /* 不同迁移类型的链表 */
    struct list_head lists[MIGRATE_PCPTYPES];
};

/*
 * rmqueue_pcplist - 从 Per-CPU 缓存分配
 */
static struct page *rmqueue_pcplist(struct zone *preferred_zone,
                                    struct zone *zone, gfp_t gfp_flags,
                                    int migratetype)
{
    struct per_cpu_pages *pcp;
    struct list_head *list;
    struct page *page;
    
    /* 获取当前 CPU 的页面缓存 */
    pcp = this_cpu_ptr(zone->per_cpu_pageset);
    
    /* 获取对应迁移类型的链表 */
    list = &pcp->lists[migratetype];
    
    /* 如果链表为空，从伙伴系统补充 */
    if (list_empty(list)) {
        pcp->count += rmqueue_bulk(zone, 0, pcp->batch, list,
                                   migratetype, gfp_flags);
    }
    
    /* 从链表头部取出一页 */
    page = list_first_entry(list, struct page, lru);
    list_del(&page->lru);
    pcp->count--;
    
    return page;
}
```

---

# 十一-D、Slab 分配器：高效的小对象分配

## 问题：如何分配小对象？

```
内核需要频繁分配小对象：
- task_struct（进程描述符）：约 9KB
- inode（文件元数据）：约 1KB
- dentry（目录项）：约 200 字节
- sk_buff（网络缓冲区）：约 200 字节

如果使用伙伴系统：
- 最小分配 4KB
- 分配 200 字节对象，浪费 3.8KB
- 内部碎片严重！
```

## 解决方案：Slab 分配器

### 核心思想

> **从伙伴系统获取页面，切分成固定大小的对象，缓存起来重复使用**

### Slab 分配器的层次结构

```
┌─────────────────────────────────────────────┐
│         kmem_cache（对象缓存）                │
│    管理一种类型的对象（如 task_struct）        │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
┌───────┴───────┐ ┌─┴───────────┴───┐
│  CPU 0 缓存   │ │   CPU 1 缓存     │
│  (per-CPU)    │ │   (per-CPU)      │
└───────┬───────┘ └────────┬─────────┘
        │                  │
    ┌───┴───┐          ┌───┴───┐
    │ slab  │          │ slab  │
    │(部分满)│          │(部分满)│
    └───┬───┘          └───┬───┘
        │                  │
    ┌───┴───┐          ┌───┴───┐
    │ slab  │          │ slab  │
    │ (全满) │          │ (空闲) │
    └───────┘          └───────┘
        │                  │
    ┌───┴───┐          ┌───┴───┐
    │ Page  │          │ Page  │
    │(4KB)  │          │(4KB)  │
    └───────┘          └───────┘
```

### Slab 的三种状态

```
1. 空闲 slab（Empty）
   - 所有对象都空闲
   - 可以被回收

2. 部分满 slab（Partial）
   - 部分对象已分配
   - 部分对象空闲
   - 优先从中分配

3. 全满 slab（Full）
   - 所有对象已分配
   - 不能从中分配
```

## Linux 5.15 的实现

### 核心数据结构

**定义位置**：**`include/linux/slab.h`**

```c
/*
 * kmem_cache - 对象缓存
 */
struct kmem_cache {
    const char *name;              /* 缓存名称 */
    unsigned int object_size;      /* 对象大小 */
    unsigned int size;             /* 总大小（包括元数据） */
    unsigned int align;            /* 对齐 */
    
    /* Per-CPU 缓存 */
    struct kmem_cache_cpu __percpu *cpu_slab;
    
    /* 节点信息 */
    struct kmem_cache_node *node[MAX_NUMNODES];
    
    /* 构造函数 */
    void (*ctor)(void *);
    
    /* 标志位 */
    slab_flags_t flags;
    
    /* 其他字段... */
};

/*
 * kmem_cache_cpu - Per-CPU 缓存
 */
struct kmem_cache_cpu {
    void **freelist;       /* 空闲对象链表 */
    struct page *page;     /* 当前 slab */
    struct page *partial;  /* 部分满 slab 链表 */
};

/*
 * kmem_cache_node - 节点信息
 */
struct kmem_cache_node {
    spinlock_t list_lock;
    
    /* 部分满 slab 链表 */
    unsigned long nr_partial;
    struct list_head partial;
    
    /* 统计信息 */
    atomic_long_t nr_slabs;
    atomic_long_t total_objects;
};
```

### 创建缓存

```c
/*
 * kmem_cache_create - 创建对象缓存
 */
struct kmem_cache *kmem_cache_create(const char *name, unsigned int size,
                                     unsigned int align, slab_flags_t flags,
                                     void (*ctor)(void *))
{
    struct kmem_cache *s;
    
    /* 分配 kmem_cache 结构 */
    s = kmem_cache_zalloc(kmem_cache, GFP_KERNEL);
    if (!s)
        return NULL;
    
    /* 初始化字段 */
    s->name = name;
    s->object_size = size;
    s->size = ALIGN(size, align);
    s->align = align;
    s->flags = flags;
    s->ctor = ctor;
    
    /* 初始化 Per-CPU 缓存 */
    s->cpu_slab = alloc_percpu(struct kmem_cache_cpu);
    
    /* 初始化节点信息 */
    for_each_node_state(node, N_NORMAL_MEMORY) {
        s->node[node] = kmalloc_node(sizeof(struct kmem_cache_node),
                                     GFP_KERNEL, node);
        init_kmem_cache_node(s->node[node]);
    }
    
    return s;
}

/*
 * 使用示例：创建 task_struct 缓存
 */
struct kmem_cache *task_struct_cachep;

void __init fork_init(void)
{
    task_struct_cachep = kmem_cache_create("task_struct",
                                           sizeof(struct task_struct),
                                           ARCH_MIN_TASKALIGN,
                                           SLAB_PANIC | SLAB_ACCOUNT,
                                           NULL);
}
```

### 分配对象

```c
/*
 * kmem_cache_alloc - 从缓存分配对象
 */
void *kmem_cache_alloc(struct kmem_cache *s, gfp_t gfpflags)
{
    void *obj;
    
    /* 从 Per-CPU 缓存分配 */
    obj = slab_alloc(s, gfpflags, _RET_IP_);
    
    return obj;
}

/*
 * slab_alloc - 实际的分配函数
 */
static __always_inline void *slab_alloc(struct kmem_cache *s,
                                        gfp_t gfpflags, unsigned long addr)
{
    struct kmem_cache_cpu *c;
    void *obj;
    
    /* 获取当前 CPU 的缓存 */
    c = raw_cpu_ptr(s->cpu_slab);
    
    /* 快速路径：从 freelist 分配 */
    obj = c->freelist;
    if (obj) {
        c->freelist = get_freepointer(s, obj);
        return obj;
    }
    
    /* 慢速路径：从 partial 链表或新 slab 分配 */
    return __slab_alloc(s, gfpflags, addr, c);
}

/*
 * __slab_alloc - 慢速分配路径
 */
static void *__slab_alloc(struct kmem_cache *s, gfp_t gfpflags,
                          unsigned long addr, struct kmem_cache_cpu *c)
{
    void *obj;
    struct page *page;
    
    /* 检查 partial 链表 */
    page = c->partial;
    if (page) {
        /* 从 partial slab 分配 */
        c->page = page;
        c->partial = page->next;
        goto load_freelist;
    }
    
    /* 分配新 slab */
    page = new_slab(s, gfpflags, node);
    if (!page)
        return NULL;
    
    c->page = page;
    
load_freelist:
    /* 从 slab 加载 freelist */
    c->freelist = page->freelist;
    obj = c->freelist;
    c->freelist = get_freepointer(s, obj);
    
    return obj;
}

/*
 * new_slab - 分配新 slab
 */
static struct page *new_slab(struct kmem_cache *s, gfp_t flags, int node)
{
    struct page *page;
    void *start;
    void *p;
    int order;
    
    /* 计算需要的页面数 */
    order = get_order(s->size * oo_objects(s->oo));
    
    /* 从伙伴系统分配页面 */
    page = alloc_pages(flags, order);
    if (!page)
        return NULL;
    
    /* 初始化 slab */
    start = page_address(page);
    page->freelist = start;
    page->objects = oo_objects(s->oo);
    
    /* 初始化对象 */
    for (p = start; p < start + s->size * page->objects; p += s->size) {
        /* 设置空闲指针 */
        set_freepointer(s, p, p + s->size);
        
        /* 调用构造函数 */
        if (s->ctor)
            s->ctor(p);
    }
    
    return page;
}
```

### 释放对象

```c
/*
 * kmem_cache_free - 释放对象到缓存
 */
void kmem_cache_free(struct kmem_cache *s, void *x)
{
    slab_free(s, x, _RET_IP_);
}

/*
 * slab_free - 实际的释放函数
 */
static __always_inline void slab_free(struct kmem_cache *s, void *x,
                                      unsigned long addr)
{
    struct kmem_cache_cpu *c;
    
    /* 获取当前 CPU 的缓存 */
    c = raw_cpu_ptr(s->cpu_slab);
    
    /* 快速路径：放入 freelist */
    if (likely(page == c->page)) {
        set_freepointer(s, x, c->freelist);
        c->freelist = x;
        return;
    }
    
    /* 慢速路径 */
    __slab_free(s, page, x, addr);
}

/*
 * __slab_free - 慢速释放路径
 */
static void __slab_free(struct kmem_cache *s, struct page *page,
                        void *x, unsigned long addr)
{
    /* 将对象加入 freelist */
    page->freelist = x;
    set_freepointer(s, x, page->freelist);
    page->inuse--;
    
    /* 如果 slab 变空，考虑释放 */
    if (page->inuse == 0) {
        /* 从 partial 链表移除 */
        list_del(&page->lru);
        
        /* 释放 slab */
        discard_slab(s, page);
    }
}
```

## Slab 分配器的优势

### 1. 减少内部碎片

```
伙伴系统：
- 最小分配 4KB
- 分配 200 字节对象，浪费 3.8KB
- 内部碎片：95%

Slab 分配器：
- 从 slab 分配 200 字节对象
- 一个 4KB 页面可以存放 20 个对象
- 内部碎片：0%（如果对齐）
```

### 2. 对象缓存

```
问题：
- 频繁分配和释放对象
- 每次都需要初始化

解决方案：
- 对象释放后不立即回收
- 保留在缓存中
- 下次分配直接使用

优势：
- 减少初始化开销
- 提高分配速度
- 减少内存分配次数
```

### 3. Per-CPU 缓存

```
问题：
- 多 CPU 系统锁竞争严重
- 频繁访问共享数据结构

解决方案：
- 每个 CPU 维护自己的缓存
- 分配和释放不需要锁
- 性能大幅提升

示例：
CPU 0 分配对象：从 CPU 0 的缓存分配，无锁
CPU 1 分配对象：从 CPU 1 的缓存分配，无锁
```

## 常用的 Slab 缓存

### 1. 内核通用缓存

```c
/* kmalloc 使用的缓存 */
struct kmem_cache *kmalloc_caches[KMALLOC_SHIFT_HIGH + 1];

/* 不同大小的 kmalloc 缓存 */
kmalloc-8      /* 8 字节 */
kmalloc-16     /* 16 字节 */
kmalloc-32     /* 32 字节 */
kmalloc-64     /* 64 字节 */
kmalloc-128    /* 128 字节 */
kmalloc-256    /* 256 字节 */
kmalloc-512    /* 512 字节 */
kmalloc-1024   /* 1KB */
kmalloc-2048   /* 2KB */
kmalloc-4096   /* 4KB */
kmalloc-8192   /* 8KB */
```

### 2. 专用缓存

```c
/* 进程描述符 */
struct kmem_cache *task_struct_cachep;

/* 文件元数据 */
struct kmem_cache *inode_cachep;

/* 目录项 */
struct kmem_cache *dentry_cache;

/* 网络缓冲区 */
struct kmem_cache *skbuff_head_cache;

/* 页表 */
struct kmem_cache *pgd_cache;
```

## Slab 分配器的变种

### 1. SLAB（传统实现）

```
特点：
- 最早的 slab 实现
- 复杂但功能完善
- 支持对象着色（减少缓存冲突）

缺点：
- 代码复杂
- 内存开销大
```

### 2. SLUB（Linux 5.15 默认）

```
特点：
- 简化的实现
- 内存开销小
- 更好的 NUMA 支持
- 更好的调试支持

优势：
- 代码简洁
- 性能更好
- Linux 5.15 的默认选择
```

### 3. SLOB（嵌入式系统）

```
特点：
- 极简实现
- 代码量小
- 适合内存受限的系统

缺点：
- 性能较差
- 不适合大内存系统
```

---

# 十一-E、NUMA：非统一内存访问架构

## 问题：多处理器系统的内存访问不均匀

```
传统 SMP 系统（对称多处理器）：
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│ CPU │ │ CPU │ │ CPU │ │ CPU │
└──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘
   │       │       │       │
   └───────┴───────┴───────┘
              │
        ┌─────┴─────┐
        │   内存    │
        └───────────┘

问题：
- 所有 CPU 共享一个内存控制器
- 内存访问延迟相同
- 内存控制器成为瓶颈
```

## 解决方案：NUMA 架构

### 核心思想

> **每个 CPU 节点有自己的本地内存，访问本地内存快，访问远程内存慢**

### NUMA 系统结构

```
NUMA 系统示例：

节点 0（Node 0）：
┌─────────────────────┐
│  CPU 0  CPU 1       │
│  CPU 2  CPU 3       │
├─────────────────────┤
│  本地内存 0-32GB    │
└─────────────────────┘
         │
         │ 互联网络（QPI/HyperTransport）
         │
节点 1（Node 1）：
┌─────────────────────┐
│  CPU 4  CPU 5       │
│  CPU 6  CPU 7       │
├─────────────────────┤
│  本地内存 32-64GB   │
└─────────────────────┘

访问延迟：
- CPU 0 访问节点 0 内存：100ns（本地访问）
- CPU 0 访问节点 1 内存：200ns（远程访问）
- 远程访问比本地访问慢 2 倍！
```

## Linux 5.15 的 NUMA 实现

### 核心数据结构

**定义位置**：**`include/linux/mmzone.h`**

```c
/*
 * pglist_data - 内存节点描述符
 */
typedef struct pglist_data {
    /* 内存区域 */
    struct zone node_zones[MAX_NR_ZONES];
    
    /* 区域列表 */
    struct zonelist node_zonelists[MAX_ZONELISTS];
    
    /* 区域数量 */
    int nr_zones;
    
    /* 起始页帧号 */
    unsigned long node_start_pfn;
    
    /* 总页数 */
    unsigned long node_present_pages;
    
    /* 跨越页数（包括空洞） */
    unsigned long node_spanned_pages;
    
    /* 节点 ID */
    int node_id;
    
    /* kswapd 等待队列 */
    wait_queue_head_t kswapd_wait;
    
    /* kswapd 进程 */
    struct task_struct *kswapd;
    
    /* 保留页数 */
    unsigned long totalreserve_pages;
    
    /* LRU 向量 */
    struct lruvec __lruvec;
    
    /* 节点标志 */
    unsigned long flags;
    
    /* LRU 锁 */
    spinlock_t lru_lock;
} pg_data_t;

/*
 * 全局节点数组
 */
struct pglist_data *node_data[MAX_NUMNODES];
```

### 内存区域（Zone）

```
每个节点包含多个内存区域：

节点 0：
┌─────────────────────────────────┐
│  ZONE_DMA (0-16MB)              │  DMA 区域
│  - 用于 ISA 设备                │
├─────────────────────────────────┤
│  ZONE_DMA32 (16MB-4GB)          │  DMA32 区域
│  - 用于 32 位 DMA 设备          │
├─────────────────────────────────┤
│  ZONE_NORMAL (4GB-64GB)         │  普通区域
│  - 大部分内存                   │
├─────────────────────────────────┤
│  ZONE_MOVABLE                   │  可移动区域
│  - 用于内存热插拔               │
└─────────────────────────────────┘

为什么需要区域？
- 硬件限制：某些设备只能访问特定地址范围
- 内存热插拔：需要连续的可移动内存
```

### NUMA 内存分配策略

```c
/*
 * 内存策略类型
 */
enum {
    MPOL_DEFAULT,     /* 默认：从本地节点分配 */
    MPOL_PREFERRED,   /* 首选：优先从指定节点分配 */
    MPOL_BIND,        /* 绑定：只能从指定节点分配 */
    MPOL_INTERLEAVE,  /* 交错：在多个节点间轮流分配 */
    MPOL_LOCAL,       /* 本地：从当前 CPU 所在节点分配 */
    MPOL_MAX
};

/*
 * 设置内存策略
 */
long sys_set_mempolicy(int mode, const unsigned long __user *nmask,
                       unsigned long maxnode)
{
    struct mempolicy *new;
    
    /* 创建新的内存策略 */
    new = mpol_new(mode, nmask, maxnode);
    if (IS_ERR(new))
        return PTR_ERR(new);
    
    /* 设置到当前进程 */
    old = current->mempolicy;
    current->mempolicy = new;
    
    /* 释放旧策略 */
    mpol_put(old);
    
    return 0;
}

/*
 * 使用示例
 */
void example_numa_policy(void)
{
    /* 设置首选节点为节点 1 */
    unsigned long nodemask = 0x02;  /* 节点 1 */
    set_mempolicy(MPOL_PREFERRED, &nodemask, 2);
    
    /* 从节点 1 分配内存 */
    void *p = malloc(1024 * 1024);  /* 1MB */
    
    /* 恢复默认策略 */
    set_mempolicy(MPOL_DEFAULT, NULL, 0);
}
```

### NUMA 页面迁移

```
问题：
- 进程在 CPU 0 运行，内存分配在节点 0
- 进程迁移到 CPU 4（节点 1）
- 访问节点 0 的内存变慢

解决方案：NUMA 平衡
- 检测进程访问的内存位置
- 将页面迁移到进程运行的节点
- 减少远程访问
```

**Linux 5.15 的实现**：

```c
/*
 * do_numa_page - NUMA 页错误处理
 */
static vm_fault_t do_numa_page(struct vm_fault *vmf)
{
    struct page *page = vmf->page;
    int last_cpupid = page_cpupid_last(page);
    int target_nid;
    
    /* 检查是否需要迁移 */
    target_nid = mpol_misplaced(page, vmf->vma, vmf->address);
    
    if (target_nid != NUMA_NO_NODE) {
        /* 迁移页面到目标节点 */
        if (migrate_misplaced_page(page, target_nid)) {
            page_nid = target_nid;
        }
    }
    
    /* 更新页表项 */
    pte_t pte = pte_modify(vmf->orig_pte, vmf->vma->vm_page_prot);
    set_pte_at(vmf->vma->vm_mm, vmf->address, vmf->pte, pte);
    
    return 0;
}

/*
 * migrate_misplaced_page - 迁移页面
 */
int migrate_misplaced_page(struct page *page, int node)
{
    struct page *newpage;
    
    /* 在目标节点分配新页面 */
    newpage = alloc_pages_node(node, GFP_HIGHUSER_MOVABLE, 0);
    if (!newpage)
        return -ENOMEM;
    
    /* 复制页面内容 */
    copy_highpage(newpage, page);
    
    /* 更新页表 */
    migrate_page_copy(newpage, page);
    
    /* 释放旧页面 */
    put_page(page);
    
    return 0;
}
```

## NUMA 系统的优化策略

### 1. 内存本地化

```
策略：
- 优先从本地节点分配内存
- 减少远程访问

实现：
- MPOL_LOCAL 策略
- 自动 NUMA 平衡

效果：
- 减少内存访问延迟
- 提高性能
```

### 2. 内存交错

```
策略：
- 在多个节点间轮流分配内存
- 分散内存带宽压力

实现：
- MPOL_INTERLEAVE 策略

适用场景：
- 大型数据库
- 科学计算
- 内存带宽受限的应用

效果：
- 提高内存带宽利用率
- 避免单个节点过载
```

### 3. CPU 亲和性

```
策略：
- 将进程绑定到特定 CPU
- 确保进程在本地节点分配内存

实现：
- sched_setaffinity() 系统调用
- numactl 命令

示例：
# 将进程绑定到节点 0 的 CPU
numactl --cpunodebind=0 --membind=0 ./program

效果：
- 减少远程内存访问
- 提高缓存命中率
```

## NUMA 系统的监控

### 1. 查看节点信息

```bash
# 查看节点拓扑
numactl --hardware

# 输出示例：
available: 2 nodes (0-1)
node 0 cpus: 0 1 2 3
node 0 size: 32768 MB
node 0 free: 16000 MB
node 1 cpus: 4 5 6 7
node 1 size: 32768 MB
node 1 free: 15000 MB
node distances:
node   0   1 
  0:  10  20 
  1:  20  10 

# 距离解释：
# 10 = 本地访问
# 20 = 远程访问
```

### 2. 查看内存分配统计

```bash
# 查看每个节点的内存统计
cat /sys/devices/system/node/node*/meminfo

# 输出示例：
Node 0 MemTotal:       32768000 kB
Node 0 MemFree:        16000000 kB
Node 0 MemUsed:        16768000 kB
Node 0 Active:          8000000 kB
Node 0 Inactive:        6000000 kB

Node 1 MemTotal:       32768000 kB
Node 1 MemFree:        15000000 kB
Node 1 MemUsed:        17768000 kB
Node 1 Active:          9000000 kB
Node 1 Inactive:        5000000 kB
```

### 3. 查看 NUMA 统计

```bash
# 查看 NUMA 命中/未命中统计
cat /sys/devices/system/node/node*/numastat

# 输出示例：
Node 0:
numa_hit        1000000    # 在本节点分配
numa_miss        100000    # 在其他节点分配
numa_foreign     100000    # 本应在本节点，实际在其他节点
interleave_hit   50000     # 交错分配命中
local_node       900000    # 本地节点分配
other_node       200000    # 其他节点分配
```

## NUMA 系统的最佳实践

### 1. 数据库服务器

```bash
# 将数据库绑定到特定节点
numactl --cpunodebind=0 --membind=0 mysqld

# 或者使用交错分配提高带宽
numactl --interleave=all mysqld
```

### 2. Web 服务器

```bash
# 每个 worker 进程绑定到不同节点
for i in 0 1; do
    numactl --cpunodebind=$i --membind=$i nginx-worker &
done
```

### 3. 虚拟机

```bash
# 将虚拟机绑定到特定节点
virsh numatune vm1 --nodeset 0

# 或者使用交错分配
virsh numatune vm1 --mode interleave
```

---

# 十二、交换：突破物理内存限制

## 问题：物理内存不够用

```
物理内存：8GB
进程 A 需要：5GB
进程 B 需要：5GB

总共需要 10GB，但只有 8GB！
```

## 解决方案：交换（Swap）

### 核心思想

> **将不常用的页面换出到磁盘，腾出物理内存**

### 实现步骤

```
内存不足：
    │
    ▼
选择一个不常用的页面
    │
    ▼
将页面写入交换分区
    │
    ▼
更新页表项：P=0，记录交换位置
    │
    ▼
释放物理页面
    │
    ▼
其他进程可以使用这个物理页面
    │
    ▼
原进程访问该页面：
    │
    ▼
页错误（P=0）
    │
    ▼
从交换分区读取页面
    │
    ▼
更新页表项：P=1
    │
    ▼
继续执行
```

## 页面置换算法

### LRU（最近最少使用）

```
核心思想：
最近被访问的页面，将来也容易被访问
很久没访问的页面，将来也不太会被访问

实现：
维护两个链表：
- 活跃链表：最近被访问的页面
- 非活跃链表：较长时间没被访问的页面

页面访问时：
- 从非活跃链表移到活跃链表

需要换出时：
- 从非活跃链表尾部选择页面
```

## Linux 5.15 的实现

```c
/*
 * 页面回收的核心数据结构
 */
struct lruvec {
    struct list_head lists[NR_LRU_LISTS];
    /* 
     * LRU 链表：
     * LRU_INACTIVE_ANON - 非活跃匿名页
     * LRU_ACTIVE_ANON   - 活跃匿名页
     * LRU_INACTIVE_FILE - 非活跃文件页
     * LRU_ACTIVE_FILE   - 活跃文件页
     * LRU_UNEVICTABLE   - 不可换出页
     */
};

/*
 * shrink_page_list - 回收页面
 */
unsigned int shrink_page_list(struct list_head *page_list,
                              struct pglist_data *pgdat,
                              struct scan_control *sc)
{
    LIST_HEAD(ret_pages);
    LIST_HEAD(free_pages);
    int nr_reclaimed = 0;
    
    while (!list_empty(page_list)) {
        struct page *page = lru_to_page(page_list);
        
        /* 锁定页面 */
        if (!trylock_page(page))
            goto keep;
        
        /* 检查是否可以回收 */
        if (page_mapped(page)) {
            /* 解除映射 */
            try_to_unmap(page, TTU_BATCH_FLUSH);
        }
        
        if (PageDirty(page)) {
            /* 脏页：写入磁盘 */
            pageout(page, mapping);
        }
        
        if (PageAnon(page)) {
            /* 匿名页：换出到交换分区 */
            if (!add_to_swap(page))
                goto keep_locked;
        }
        
        /* 释放页面 */
        __clear_page_locked(page);
        list_add(&page->lru, &free_pages);
        nr_reclaimed++;
        continue;
        
keep_locked:
        unlock_page(page);
keep:
        list_add(&page->lru, &ret_pages);
    }
    
    /* 释放空闲页面 */
    free_unref_page_list(&free_pages);
    
    list_splice(&ret_pages, page_list);
    
    return nr_reclaimed;
}
```

---

# 十三、大页：减少 TLB 缺失

## 问题：TLB 容量有限

```
TLB（Translation Lookaside Buffer）：
- 页表项的缓存
- 加速地址转换
- 容量有限（通常 64-1536 项）

假设 TLB 有 64 项：
- 使用 4KB 页面：覆盖 64 * 4KB = 256KB
- 使用 2MB 页面：覆盖 64 * 2MB = 128MB

大页的优势：
- 减少 TLB 缺失
- 减少页表层级
- 提高性能
```

## Linux 5.15 的大页支持

### 1. HugeTLB Pages（静态大页）

```bash
# 预分配 1000 个 2MB 大页
echo 1000 > /proc/sys/vm/nr_hugepages

# 挂载 hugetlbfs
mount -t hugetlbfs nodev /mnt/huge

# 使用大页
mmap(NULL, 2*1024*1024, PROT_READ|PROT_WRITE,
     MAP_PRIVATE|MAP_HUGETLB, -1, 0);
```

### 2. Transparent Huge Pages（透明大页）

```c
/*
 * 透明大页：自动合并小页为大页
 * 对应用透明
 */

/* 检查是否可以使用大页 */
bool hugepage_vma_check(struct vm_area_struct *vma,
                        unsigned long vm_flags,
                        bool smaps, bool in_pf)
{
    if ((vm_flags & VM_NOHUGEPAGE) ||
        test_bit(MMF_DISABLE_THP, &vma->vm_mm->flags))
        return false;
    
    if (shmem_file(vma->vm_file))
        return shmem_huge_enabled(vma);
    
    if (!vma_is_anonymous(vma))
        return false;
    
    return true;
}

/* 创建大页 */
vm_fault_t create_huge_pmd(struct vm_fault *vmf)
{
    if (vma_is_anonymous(vmf->vma))
        return do_huge_pmd_anonymous_page(vmf);
    else
        return wp_huge_pmd(vmf);
}
```

---

# 十四、NUMA：多节点内存访问

## 问题：多处理器系统的内存访问不均匀

```
传统 SMP 系统：
所有 CPU 共享同一个内存控制器
内存访问延迟相同

NUMA（Non-Uniform Memory Access）系统：
每个 CPU 节点有自己的本地内存
访问本地内存快，访问远程内存慢

例如：
节点 0：CPU 0-3，内存 0-32GB
节点 1：CPU 4-7，内存 32-64GB

CPU 0 访问节点 0 的内存：延迟 100ns
CPU 0 访问节点 1 的内存：延迟 200ns
```

## Linux 5.15 的 NUMA 支持

```c
/*
 * 内存节点
 */
typedef struct pglist_data {
    struct zone node_zones[MAX_NR_ZONES];  /* 内存区域 */
    struct zonelist node_zonelists[MAX_ZONELISTS];
    int nr_zones;
    
    unsigned long node_start_pfn;          /* 起始页帧号 */
    unsigned long node_present_pages;      /* 总页数 */
    unsigned long node_spanned_pages;      /* 跨越页数 */
    int node_id;                           /* 节点 ID */
    
    wait_queue_head_t kswapd_wait;
    struct task_struct *kswapd;            /* kswapd 进程 */
    
    unsigned long totalreserve_pages;
    
    struct lruvec __lruvec;                /* LRU 向量 */
    unsigned long flags;
    
    spinlock_t lru_lock;
} pg_data_t;

/*
 * NUMA 平衡：将页面迁移到访问它的 CPU 所在的节点
 */
static vm_fault_t do_numa_page(struct vm_fault *vmf)
{
    struct page *page = vmf->page;
    int last_cpupid = page_cpupid_last(page);
    int target_nid;
    
    /* 检查是否需要迁移 */
    target_nid = mpol_misplaced(page, vmf->vma, vmf->address);
    
    if (target_nid != NUMA_NO_NODE) {
        /* 迁移页面到目标节点 */
        if (migrate_misplaced_page(page, target_nid)) {
            page_nid = target_nid;
        }
    }
    
    /* 更新页表项 */
    pte_t pte = pte_modify(vmf->orig_pte, vmf->vma->vm_page_prot);
    set_pte_at(vmf->vma->vm_mm, vmf->address, vmf->pte, pte);
    
    return 0;
}
```

---

# 十五、内存控制器：限制进程的内存使用

## 问题：一个进程可能占用所有内存

```
系统有 8GB 内存
进程 A 可能占用 8GB
其他进程就没有内存了

在容器环境中，需要限制容器的内存使用
```

## 解决方案：cgroups 内存控制器

```c
/*
 * 内存控制器
 */
struct mem_cgroup {
    struct page_counter memory;    /* 内存计数器 */
    struct page_counter swap;      /* 交换计数器 */
    struct page_counter kmem;      /* 内核内存计数器 */
    
    unsigned long low;             /* 低水位 */
    unsigned long high;            /* 高水位 */
    unsigned long max;             /* 最大限制 */
    
    /* OOM 控制 */
    bool oom_kill_disable;
    int oom_priority;
    int under_oom;
    
    /* 统计信息 */
    unsigned long stat[MEMCG_NR_STAT];
};

/*
 * 页面计数器
 */
struct page_counter {
    atomic_long_t count;           /* 当前计数 */
    unsigned long limit;           /* 限制 */
    unsigned long low;             /* 低水位 */
    unsigned long high;            /* 高水位 */
    unsigned long max;             /* 最大值 */
    
    struct page_counter *parent;   /* 父计数器 */
};
```

## 使用示例

```bash
# 创建内存控制器组
mkdir /sys/fs/cgroup/memory/mygroup

# 设置内存限制为 1GB
echo 1G > /sys/fs/cgroup/memory/mygroup/memory.limit_in_bytes

# 将进程加入组
echo $PID > /sys/fs/cgroup/memory/mygroup/tasks
```

---

# 十六、总结：Linux 虚拟内存的完整逻辑链

你可以把它背成下面这条链：

### 1. 程序需要内存

但直接使用物理内存有地址冲突、内存不足、碎片、安全问题。

### 2. 于是引入虚拟内存

给每个进程一个独立的地址空间。

### 3. 虚拟地址需要转换为物理地址

使用页表进行映射。

### 4. 单级页表太大

引入多级页表，按需分配。

### 5. 页表项不只是地址

还包含权限、状态等标志位。

### 6. 进程地址空间需要管理

使用 VMA 描述不同的区域。

### 7. 访问不存在的页面会触发页错误

内核处理页错误，加载或分配页面。

### 8. fork() 不立即复制内存

使用写时复制，提高效率。

### 9. 程序启动不加载所有代码

使用请求调页，按需加载。

### 10. 物理内存不够用

使用交换，将不常用页面换出到磁盘。

### 11. TLB 容量有限

使用大页，减少 TLB 缺失。

### 12. 多处理器系统内存访问不均匀

使用 NUMA 支持，优化内存访问。

### 13. 需要限制进程内存使用

使用内存控制器，实现资源隔离。

---

# 十七、一句话总结 Linux 虚拟内存

> **Linux 虚拟内存的核心思想是：给每个进程一个独立的、连续的地址空间，通过页表映射到不连续的物理内存，按需分配和加载页面，使用写时复制和交换等机制提高效率和扩展性。**

---

## 参考资料

### 源码文件

- **`mm/memory.c`** - 内存管理核心
- **`mm/mmap.c`** - 内存映射
- **`mm/page_alloc.c`** - 页面分配
- **`mm/vmscan.c`** - 页面回收
- **`include/linux/mm_types.h`** - 内存管理类型

### 文档

- Documentation/admin-guide/mm/index.rst
- Documentation/admin-guide/mm/hugetlbpage.rst
- Documentation/admin-guide/mm/numa_memory_policy.rst

---

**文档版本**: 1.0  
**创建日期**: 2026-05-07  
**基于内核版本**: Linux 5.15.204
