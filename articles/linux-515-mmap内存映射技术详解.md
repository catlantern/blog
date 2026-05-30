# Linux 5.15 mmap（内存映射）技术详解

> 本文档从初学者角度深入剖析Linux内核mmap机制，涵盖原理、数据结构、内核实现、应用场景等各个方面。

---

## 目录

1. **`mmap概述`**
2. **`虚拟内存基础`**
3. **`mmap核心数据结构`**
4. **`mmap系统调用实现`**
5. **`虚拟内存区域管理`**
6. **`缺页异常处理`**
7. **`页表映射机制`**
8. **`映射模式详解`**
9. **`mmap与零拷贝`**
10. **`munmap实现`**
11. **`实际应用场景`**
12. **`性能分析与最佳实践`**
13. **`常见问题与调试`**

---

## 一、mmap概述

### 1.1 什么是mmap？

mmap（Memory Map，内存映射）是Linux内核提供的一种**将文件或设备直接映射到进程虚拟地址空间**的机制。通过mmap，进程可以像访问普通内存一样访问文件内容，无需频繁调用read/write系统调用。

```
┌─────────────────────────────────────────────────────────────┐
│                    mmap核心思想                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统文件I/O：                                               │
│  ┌─────────┐    read     ┌─────────┐    拷贝    ┌─────────┐ │
│  │  磁盘   │ ─────────> │ 内核缓冲 │ ─────────> │ 用户缓冲 │ │
│  └─────────┘            └─────────┘            └─────────┘ │
│                                                             │
│  mmap方式：                                                  │
│  ┌─────────┐    映射     ┌─────────────────────────────┐   │
│  │  磁盘   │ ─────────> │     进程虚拟地址空间          │   │
│  └─────────┘            │  （直接访问，无需拷贝）        │   │
│                         └─────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 mmap函数原型

```c
#include <sys/mman.h>

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
int munmap(void *addr, size_t length);
```

**参数详解**：

| 参数 | 说明 |
|------|------|
| `addr` | 建议映射起始地址，通常设为NULL（由内核自动选择） |
| `length` | 映射区域长度（字节），实际会按页大小向上取整 |
| `prot` | 内存保护标志：PROT_READ/PROT_WRITE/PROT_EXEC/PROT_NONE |
| `flags` | 映射类型：MAP_SHARED/MAP_PRIVATE/MAP_ANONYMOUS等 |
| `fd` | 文件描述符（匿名映射时设为-1） |
| `offset` | 文件偏移量，必须是页大小的整数倍 |

### 1.3 保护标志（prot）

```c
#define PROT_READ   0x1     /* 页可读 */
#define PROT_WRITE  0x2     /* 页可写 */
#define PROT_EXEC   0x4     /* 页可执行 */
#define PROT_NONE   0x0     /* 页不可访问 */
```

### 1.4 映射标志（flags）

```c
#define MAP_TYPE        0x0f    /* 映射类型掩码 */
#define MAP_SHARED      0x01    /* 共享映射：修改同步到文件 */
#define MAP_PRIVATE     0x02    /* 私有映射：写时复制 */
#define MAP_FIXED       0x10    /* 强制使用指定地址 */
#define MAP_ANONYMOUS   0x20    /* 匿名映射：不关联文件 */
#define MAP_POPULATE    0x008000  /* 预填充页表 */
#define MAP_HUGETLB     0x040000  /* 使用大页 */
```

---

## 二、虚拟内存基础

### 2.1 虚拟内存 vs 物理内存

```
┌─────────────────────────────────────────────────────────────┐
│                  虚拟内存与物理内存                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  物理内存（RAM）：                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 实际硬件存储，容量固定（如8GB、16GB）              │   │
│  │ • 所有进程共享                                        │   │
│  │ • 由内核统一管理                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  虚拟内存：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 每个进程独立的地址空间                              │   │
│  │ • 32位：4GB，64位：128TB或更大                        │   │
│  │ • 连续的虚拟地址，可能对应不连续的物理页              │   │
│  │ • 通过页表映射到物理内存                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  映射关系：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   虚拟地址 (VA)  ──────页表──────>  物理地址 (PA)    │   │
│  │                     MMU                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 进程地址空间布局

```
┌─────────────────────────────────────────────────────────────┐
│              Linux进程虚拟地址空间布局（64位）               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  高地址                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              内核空间（用户不可访问）                  │   │
│  │                    128TB                             │   │
│  └─────────────────────────────────────────────────────┘   │
│  ─────────────────────────────────────────────────────────  │
│  │                    用户空间                          │   │
│  │                                                     │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  栈（Stack）- 向下增长                        │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │                      ↓                            │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  ...                                         │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  mmap区域（内存映射区）- 向下增长             │   │   │
│  │  │  • 文件映射                                   │   │   │
│  │  │  • 共享内存                                   │   │   │
│  │  │  • 动态链接库                                 │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │                      ↓                            │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  堆（Heap）- 向上增长                         │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │                      ↑                            │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  BSS段（未初始化全局变量）                    │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  数据段（Data）- 已初始化全局变量             │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  代码段（Text）- 只读可执行                   │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│  低地址                                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 页表结构（四级页表）

```
┌─────────────────────────────────────────────────────────────┐
│                    四级页表结构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  虚拟地址分解（64位，48位有效地址）：                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PGD索引   │  P4D索引   │  PUD索引   │  PMD索引   │ PTE索引 │ 页内偏移 │
│  │   9位     │    9位    │    9位    │    9位    │   9位  │   12位  │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  查找流程：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  CR3寄存器 ──> PGD ──> P4D ──> PUD ──> PMD ──> PTE  │   │
│  │                                │                    │   │
│  │                                ↓                    │   │
│  │                           物理页帧                   │   │
│  │                                │                    │   │
│  │                                ↓                    │   │
│  │                           物理地址                   │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  每级页表项数：512（2^9）                                    │
│  页大小：4KB（2^12）                                        │
│  单个页表覆盖：2MB（512 * 4KB）                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、mmap核心数据结构

### 3.1 vm_area_struct（VMA）

VMA是Linux内核描述**独立虚拟内存区域**的核心数据结构：

```c
struct vm_area_struct {
    unsigned long vm_start;      /* 区域起始虚拟地址 */
    unsigned long vm_end;        /* 区域结束虚拟地址（不包含） */
    
    struct vm_area_struct *vm_next, *vm_prev;  /* 链表指针 */
    struct rb_node vm_rb;        /* 红黑树节点 */
    unsigned long rb_subtree_gap; /* 子树最大空闲间隙 */
    
    struct mm_struct *vm_mm;     /* 所属的地址空间 */
    pgprot_t vm_page_prot;       /* 页保护属性 */
    unsigned long vm_flags;      /* VMA标志位 */
    
    struct {
        struct rb_node rb;
        unsigned long rb_subtree_last;
    } shared;                    /* 共享映射的区间树节点 */
    
    struct list_head anon_vma_chain;  /* 匿名VMA链表 */
    struct anon_vma *anon_vma;        /* 匿名VMA */
    
    const struct vm_operations_struct *vm_ops;  /* 操作函数表 */
    
    unsigned long vm_pgoff;      /* 文件偏移（页单位） */
    struct file *vm_file;        /* 映射的文件 */
    void *vm_private_data;       /* 私有数据 */
};
```

**VMA结构图解**：

```
┌─────────────────────────────────────────────────────────────┐
│                    VMA结构示意图                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  进程虚拟地址空间：                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  VMA1          VMA2          VMA3          VMA4     │   │
│  │  ┌────┐       ┌────┐       ┌────┐       ┌────┐     │   │
│  │  │代码│       │数据│       │堆  │       │mmap│     │   │
│  │  │段 │       │段 │       │    │       │区域│     │   │
│  │  └────┘       └────┘       └────┘       └────┘     │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  VMA组织方式：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  1. 链表：按地址排序，便于遍历                       │   │
│  │     VMA1 <-> VMA2 <-> VMA3 <-> VMA4                 │   │
│  │                                                     │   │
│  │  2. 红黑树：按地址排序，便于快速查找                  │   │
│  │           VMA2                                      │   │
│  │          /    \                                     │   │
│  │       VMA1    VMA3                                  │   │
│  │                \                                    │   │
│  │                VMA4                                 │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 mm_struct（进程地址空间描述符）

```c
struct mm_struct {
    struct vm_area_struct *mmap;    /* VMA链表头 */
    struct rb_root mm_rb;           /* VMA红黑树根 */
    u64 vmacache_seqnum;            /* VMA缓存序列号 */
    
    unsigned long (*get_unmapped_area)(struct file *filp,
            unsigned long addr, unsigned long len,
            unsigned long pgoff, unsigned long flags);
    
    unsigned long mmap_base;        /* mmap区域基地址 */
    unsigned long mmap_legacy_base; /* 传统mmap基地址 */
    unsigned long task_size;        /* 任务虚拟空间大小 */
    unsigned long highest_vm_end;   /* 最高VMA结束地址 */
    
    pgd_t *pgd;                     /* 页全局目录指针 */
    
    atomic_t mm_users;              /* 使用计数 */
    atomic_t mm_count;              /* 引用计数 */
    int map_count;                  /* VMA数量 */
    
    unsigned long total_vm;         /* 总页数 */
    unsigned long locked_vm;        /* 锁定页数 */
    unsigned long data_vm;          /* 数据段页数 */
    unsigned long exec_vm;          /* 代码段页数 */
    unsigned long stack_vm;         /* 栈页数 */
    
    spinlock_t page_table_lock;     /* 页表自旋锁 */
    struct rw_semaphore mmap_lock;  /* mmap读写信号量 */
};
```

### 3.3 vm_operations_struct（VMA操作函数表）

```c
struct vm_operations_struct {
    void (*open)(struct vm_area_struct *area);   /* VMA打开 */
    void (*close)(struct vm_area_struct *area);  /* VMA关闭 */
    
    int (*may_split)(struct vm_area_struct *area, unsigned long addr);
    int (*mremap)(struct vm_area_struct *area);
    int (*mprotect)(struct vm_area_struct *vma, unsigned long start,
            unsigned long end, unsigned long newflags);
    
    vm_fault_t (*fault)(struct vm_fault *vmf);   /* 缺页处理 */
    vm_fault_t (*huge_fault)(struct vm_fault *vmf, enum page_entry_size pe_size);
    vm_fault_t (*map_pages)(struct vm_fault *vmf, pgoff_t start_pgoff, pgoff_t end_pgoff);
    
    vm_fault_t (*page_mkwrite)(struct vm_fault *vmf);  /* 页写保护 */
    vm_fault_t (*pfn_mkwrite)(struct vm_fault *vmf);
    
    int (*access)(struct vm_area_struct *vma, unsigned long addr,
            void *buf, int len, int write);
    const char *(*name)(struct vm_area_struct *vma);
};
```

**关键操作函数**：

| 函数 | 说明 |
|------|------|
| `open` | VMA被创建或复制时调用 |
| `close` | VMA被销毁时调用 |
| `fault` | 缺页异常处理，核心函数 |
| `page_mkwrite` | 页从只读变为可写时调用 |
| `map_pages` | 批量映射页面 |

---

## 四、mmap系统调用实现

### 4.1 系统调用入口

mmap系统调用的入口在 **`mm/mmap.c`**：

```c
SYSCALL_DEFINE6(mmap_pgoff, unsigned long, addr, unsigned long, len,
        unsigned long, prot, unsigned long, flags,
        unsigned long, fd, unsigned long, pgoff)
{
    return ksys_mmap_pgoff(addr, len, prot, flags, fd, pgoff);
}
```

### 4.2 ksys_mmap_pgoff函数

```c
unsigned long ksys_mmap_pgoff(unsigned long addr, unsigned long len,
              unsigned long prot, unsigned long flags,
              unsigned long fd, unsigned long pgoff)
{
    struct file *file = NULL;
    unsigned long retval;

    if (!(flags & MAP_ANONYMOUS)) {
        audit_mmap_fd(fd, flags);
        file = fget(fd);
        if (!file)
            return -EBADF;
        if (is_file_hugepages(file)) {
            len = ALIGN(len, huge_page_size(hstate_file(file)));
        } else if (unlikely(flags & MAP_HUGETLB)) {
            retval = -EINVAL;
            goto out_fput;
        }
    } else if (flags & MAP_HUGETLB) {
        /* 大页匿名映射处理 */
        struct ucounts *ucounts = NULL;
        struct hstate *hs;

        hs = hstate_sizelog((flags >> MAP_HUGE_SHIFT) & MAP_HUGE_MASK);
        if (!hs)
            return -EINVAL;

        len = ALIGN(len, huge_page_size(hs));
        file = hugetlb_file_setup(HUGETLB_ANON_FILE, len,
                VM_NORESERVE, &ucounts, HUGETLB_ANONHUGE_INODE,
                (flags >> MAP_HUGE_SHIFT) & MAP_HUGE_MASK);
        if (IS_ERR(file))
            return PTR_ERR(file);
    }

    retval = vm_mmap_pgoff(file, addr, len, prot, flags, pgoff);
out_fput:
    if (file)
        fput(file);
    return retval;
}
```

### 4.3 vm_mmap_pgoff函数

```c
unsigned long vm_mmap_pgoff(struct file *file, unsigned long addr,
    unsigned long len, unsigned long prot,
    unsigned long flag, unsigned long pgoff)
{
    unsigned long ret;
    struct mm_struct *mm = current->mm;
    unsigned long populate;
    LIST_HEAD(uf);

    ret = security_mmap_file(file, prot, flag);
    if (!ret) {
        if (mmap_write_lock_killable(mm))
            return -EINTR;
        ret = do_mmap(file, addr, len, prot, flag, pgoff, &populate, &uf);
        mmap_write_unlock(mm);
        userfaultfd_unmap_complete(mm, &uf);
        if (populate)
            mm_populate(ret, populate);
    }
    return ret;
}
```

### 4.4 do_mmap核心实现

```c
unsigned long do_mmap(struct file *file, unsigned long addr,
            unsigned long len, unsigned long prot,
            unsigned long flags, unsigned long pgoff,
            unsigned long *populate, struct list_head *uf)
{
    struct mm_struct *mm = current->mm;
    vm_flags_t vm_flags;
    int pkey = 0;

    *populate = 0;

    if (!len)
        return -EINVAL;

    if ((prot & PROT_READ) && (current->personality & READ_IMPLIES_EXEC))
        if (!(file && path_noexec(&file->f_path)))
            prot |= PROT_EXEC;

    if (flags & MAP_FIXED_NOREPLACE)
        flags |= MAP_FIXED;

    if (!(flags & MAP_FIXED))
        addr = round_hint_to_min(addr);

    len = PAGE_ALIGN(len);
    if (!len)
        return -ENOMEM;

    if ((pgoff + (len >> PAGE_SHIFT)) < pgoff)
        return -EOVERFLOW;

    if (mm->map_count > sysctl_max_map_count)
        return -ENOMEM;

    addr = get_unmapped_area(file, addr, len, pgoff, flags);
    if (IS_ERR_VALUE(addr))
        return addr;

    /* 计算VM标志位 */
    vm_flags = calc_vm_prot_bits(prot, pkey) | calc_vm_flag_bits(file, flags) |
            mm->def_flags | VM_MAYREAD | VM_MAYWRITE | VM_MAYEXEC;

    if (flags & MAP_LOCKED)
        if (!can_do_mlock())
            return -EPERM;

    if (mlock_future_check(mm, vm_flags, len))
        return -EAGAIN;

    if (file) {
        struct inode *inode = file_inode(file);
        
        switch (flags & MAP_TYPE) {
        case MAP_SHARED:
            if (prot & PROT_WRITE) {
                if (!(file->f_mode & FMODE_WRITE))
                    return -EACCES;
            }
            vm_flags |= VM_SHARED | VM_MAYSHARE;
            break;

        case MAP_PRIVATE:
            if (!(file->f_mode & FMODE_READ))
                return -EACCES;
            break;

        default:
            return -EINVAL;
        }
    } else {
        switch (flags & MAP_TYPE) {
        case MAP_SHARED:
            pgoff = 0;
            vm_flags |= VM_SHARED | VM_MAYSHARE;
            break;
        case MAP_PRIVATE:
            pgoff = addr >> PAGE_SHIFT;
            break;
        default:
            return -EINVAL;
        }
    }

    return mmap_region(file, addr, len, vm_flags, pgoff, uf);
}
```

### 4.5 mmap_region函数

```c
static unsigned long __mmap_region(struct file *file, unsigned long addr,
        unsigned long len, vm_flags_t vm_flags, unsigned long pgoff,
        struct list_head *uf)
{
    struct mm_struct *mm = current->mm;
    struct vm_area_struct *vma, *prev, *merge;
    int error;
    struct rb_node **rb_link, *rb_parent;
    unsigned long charged = 0;

    /* 检查地址空间限制 */
    if (!may_expand_vm(mm, vm_flags, len >> PAGE_SHIFT)) {
        unsigned long nr_pages;
        nr_pages = count_vma_pages_range(mm, addr, addr + len);
        if (!may_expand_vm(mm, vm_flags, (len >> PAGE_SHIFT) - nr_pages))
            return -ENOMEM;
    }

    /* 清除旧映射 */
    if (munmap_vma_range(mm, addr, len, &prev, &rb_link, &rb_parent, uf))
        return -ENOMEM;

    /* 私有可写映射：检查内存可用性 */
    if (accountable_mapping(file, vm_flags)) {
        charged = len >> PAGE_SHIFT;
        if (security_vm_enough_memory_mm(mm, charged))
            return -ENOMEM;
        vm_flags |= VM_ACCOUNT;
    }

    /* 尝试合并已有VMA */
    vma = vma_merge(mm, prev, addr, addr + len, vm_flags,
            NULL, file, pgoff, NULL, NULL_VM_UFFD_CTX);
    if (vma)
        goto out;

    /* 分配新的VMA */
    vma = vm_area_alloc(mm);
    if (!vma) {
        error = -ENOMEM;
        goto unacct_error;
    }

    /* 初始化VMA */
    vma->vm_start = addr;
    vma->vm_end = addr + len;
    vma->vm_flags = vm_flags;
    vma->vm_page_prot = vm_get_page_prot(vm_flags);
    vma->vm_pgoff = pgoff;

    if (file) {
        vma->vm_file = get_file(file);
        error = mmap_file(file, vma);
        if (error)
            goto unmap_and_free_file_vma;

        addr = vma->vm_start;
        vm_flags = vma->vm_flags;
    } else if (vm_flags & VM_SHARED) {
        error = shmem_zero_setup(vma);
        if (error)
            goto free_vma;
    } else {
        vma_set_anonymous(vma);
    }

    /* 将VMA插入进程地址空间 */
    vma_link(mm, vma, prev, rb_link, rb_parent);

out:
    perf_event_mmap(vma);
    vm_stat_account(mm, vm_flags, len >> PAGE_SHIFT);

    return addr;
}
```

### 4.6 mmap实现流程图

```
┌─────────────────────────────────────────────────────────────┐
│                  mmap实现流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户调用 mmap()                                             │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SYSCALL_DEFINE6(mmap_pgoff)                          │   │
│  │ • 参数检查和转换                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ksys_mmap_pgoff()                                    │   │
│  │ • 获取文件对象（非匿名映射）                          │   │
│  │ • 处理大页映射                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ vm_mmap_pgoff()                                      │   │
│  │ • 安全检查                                           │   │
│  │ • 获取mmap锁                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ do_mmap()                                            │   │
│  │ • 参数验证                                           │   │
│  │ • 计算VM标志位                                       │   │
│  │ • 获取未映射区域                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ mmap_region()                                        │   │
│  │ • 分配VMA结构                                        │   │
│  │ • 初始化VMA                                          │   │
│  │ • 调用文件mmap方法                                   │   │
│  │ • 插入VMA到进程地址空间                              │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  返回映射地址                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、虚拟内存区域管理

### 5.1 VMA查找：find_vma

```c
struct vm_area_struct *find_vma(struct mm_struct *mm, unsigned long addr)
{
    struct rb_node *rb_node;
    struct vm_area_struct *vma;

    /* 检查缓存 */
    vma = vmacache_find(mm, addr);
    if (likely(vma))
        return vma;

    /* 红黑树查找 */
    rb_node = mm->mm_rb.rb_node;

    while (rb_node) {
        struct vm_area_struct *tmp;

        tmp = rb_entry(rb_node, struct vm_area_struct, vm_rb);

        if (tmp->vm_end > addr) {
            vma = tmp;
            if (tmp->vm_start <= addr)
                break;
            rb_node = rb_node->rb_left;
        } else
            rb_node = rb_node->rb_right;
    }

    if (vma)
        vmacache_update(addr, vma);
    return vma;
}
```

### 5.2 VMA合并：vma_merge

```c
struct vm_area_struct *vma_merge(struct mm_struct *mm,
            struct vm_area_struct *prev, unsigned long addr,
            unsigned long end, vm_flags_t vm_flags,
            struct anon_vma *anon_vma, struct file *file,
            pgoff_t pgoff, struct mempolicy *policy,
            struct vm_userfaultfd_ctx vm_userfaultfd_ctx)
{
    struct vm_area_struct *area, *next;
    int err;

    /* 检查是否可以与前一个VMA合并 */
    if (prev && prev->vm_end == addr &&
        can_vma_merge_before(prev, vm_flags, anon_vma, file, pgoff)) {
        /* 尝试与后一个VMA也合并 */
        if (next && next->vm_start == end &&
            can_vma_merge_after(next, vm_flags, anon_vma, file, pgoff)) {
            /* 合并三个VMA */
            err = __vma_adjust(prev, prev->vm_start, next->vm_end,
                      prev->vm_pgoff, NULL, prev);
            if (err)
                return NULL;
            /* 删除next VMA */
            remove_vma(next);
            return prev;
        }
        /* 只与前一个VMA合并 */
        err = __vma_adjust(prev, prev->vm_start, end,
                  prev->vm_pgoff, NULL, prev);
        if (err)
            return NULL;
        return prev;
    }

    /* 检查是否可以与后一个VMA合并 */
    if (next && next->vm_start == end &&
        can_vma_merge_after(next, vm_flags, anon_vma, file, pgoff)) {
        err = __vma_adjust(next, addr, next->vm_end,
                  next->vm_pgoff - ((end - addr) >> PAGE_SHIFT),
                  NULL, next);
        if (err)
            return NULL;
        return next;
    }

    return NULL;
}
```

### 5.3 VMA插入：vma_link

```c
static void vma_link(struct mm_struct *mm, struct vm_area_struct *vma,
            struct vm_area_struct *prev, struct rb_node **rb_link,
            struct rb_node *rb_parent)
{
    /* 链接到文件映射区间树 */
    if (vma->vm_file)
        vma_interval_tree_insert(vma, &vma->vm_file->f_mapping->i_mmap);

    /* 插入VMA链表和红黑树 */
    __vma_link_list(mm, vma, prev, rb_parent);
    __vma_link_rb(mm, vma, rb_link, rb_parent);

    /* 更新统计信息 */
    mm->map_count++;
}
```

---

## 六、缺页异常处理

### 6.1 缺页异常概述

当进程访问mmap映射区域但页面尚未加载到内存时，触发缺页异常：

```
┌─────────────────────────────────────────────────────────────┐
│                    缺页异常流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  进程访问虚拟地址                                            │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ MMU查询页表                                          │   │
│  │ • 页表项无效或权限不匹配                              │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 触发缺页异常（Page Fault）                           │   │
│  │ • CPU保存现场                                        │   │
│  │ • 切换到内核态                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ do_user_addr_fault()                                 │   │
│  │ • 查找VMA                                            │   │
│  │ • 检查权限                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ handle_mm_fault()                                    │   │
│  │ • 分配页表项                                         │   │
│  │ • 调用VMA的fault方法                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 加载页面到内存                                       │   │
│  │ • 文件映射：从磁盘读取                               │   │
│  │ • 匿名映射：分配零页                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  恢复用户进程执行                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 x86缺页异常处理

```c
void do_user_addr_fault(struct pt_regs *regs,
            unsigned long error_code,
            unsigned long address)
{
    struct vm_area_struct *vma;
    struct task_struct *tsk;
    struct mm_struct *mm;
    vm_fault_t fault;
    unsigned int flags = FAULT_FLAG_DEFAULT;

    tsk = current;
    mm = tsk->mm;

    /* 查找包含该地址的VMA */
retry:
    vma = find_vma(mm, address);
    if (unlikely(!vma))
        goto bad_area;
    
    if (likely(vma->vm_start <= address))
        goto good_area;
    
    if (unlikely(!(vma->vm_flags & VM_GROWSDOWN)))
        goto bad_area;
    
    /* 扩展栈区域 */
    if (unlikely(expand_stack(vma, address)))
        goto bad_area;

good_area:
    /* 检查访问权限 */
    if (unlikely(access_error(error_code, vma)))
        goto bad_area;

    /* 设置缺页标志 */
    if (error_code & X86_PF_WRITE)
        flags |= FAULT_FLAG_WRITE;
    if (error_code & X86_PF_USER)
        flags |= FAULT_FLAG_USER;

    /* 处理缺页 */
    fault = handle_mm_fault(vma, address, flags, NULL);

    if (fault & VM_FAULT_RETRY)
        goto retry;

    return;

bad_area:
    /* 发送SIGSEGV信号 */
    bad_area_nosemaphore(regs, error_code, address);
}
```

### 6.3 handle_mm_fault函数

```c
vm_fault_t handle_mm_fault(struct vm_area_struct *vma, unsigned long address,
        unsigned int flags, struct pt_regs *regs)
{
    vm_fault_t ret;

    __set_current_state(TASK_RUNNING);

    /* 统计缺页次数 */
    count_vm_event(PGFAULT);
    count_memcg_event_mm(vma->vm_mm, PGFAULT);

    /* 检查是否需要COW */
    if (unlikely((flags & FAULT_FLAG_WRITE) && 
                 !(vma->vm_flags & VM_WRITE)))
        flags |= FAULT_FLAG_VMA_LOCK;

    /* 调用__handle_mm_fault */
    ret = __handle_mm_fault(vma, address, flags);

    return ret;
}
```

### 6.4 __handle_mm_fault函数

```c
static vm_fault_t __handle_mm_fault(struct vm_area_struct *vma,
        unsigned long address, unsigned int flags)
{
    struct vm_fault vmf = {
        .vma = vma,
        .address = address & PAGE_MASK,
        .flags = flags,
        .pgoff = linear_page_index(vma, address),
        .gfp_mask = __get_fault_gfp_mask(vma),
    };
    unsigned int dirty = flags & FAULT_FLAG_WRITE;
    struct mm_struct *mm = vma->vm_mm;
    pgd_t *pgd;
    p4d_t *p4d;
    vm_fault_t ret;

    /* 分配各级页表 */
    pgd = pgd_offset(mm, address);
    p4d = p4d_alloc(mm, pgd, address);
    if (!p4d)
        return VM_FAULT_OOM;

    vmf.pud = pud_alloc(mm, p4d, address);
    if (!vmf.pud)
        return VM_FAULT_OOM;

    vmf.pmd = pmd_alloc(mm, vmf.pud, address);
    if (!vmf.pmd)
        return VM_FAULT_OOM;

    /* 处理PTE级别缺页 */
    return handle_pte_fault(&vmf);
}
```

### 6.5 handle_pte_fault函数

```c
static vm_fault_t handle_pte_fault(struct vm_fault *vmf)
{
    pte_t entry;

    /* 获取PTE */
    vmf->pte = pte_offset_map(vmf->pmd, vmf->address);
    entry = *vmf->pte;

    /* PTE不存在 */
    if (pte_none(entry)) {
        if (vma_is_anonymous(vmf->vma))
            return do_anonymous_page(vmf);
        else
            return do_fault(vmf);
    }

    /* PTE存在但页面不在内存中（交换） */
    if (!pte_present(entry)) {
        if (pte_none(entry))
            return do_fault(vmf);
        return do_swap_page(vmf);
    }

    /* 写保护缺页 */
    if (vmf->flags & FAULT_FLAG_WRITE) {
        if (!pte_write(entry))
            return do_wp_page(vmf);
    }

    return 0;
}
```

---

## 七、页表映射机制

### 7.1 remap_pfn_range函数

`remap_pfn_range`是建立页表映射的核心函数：

```c
int remap_pfn_range(struct vm_area_struct *vma, unsigned long addr,
            unsigned long pfn, unsigned long size, pgprot_t prot)
{
    int err;

    /* 跟踪PFN映射 */
    err = track_pfn_remap(vma, &prot, pfn, addr, PAGE_ALIGN(size));
    if (err)
        return -EINVAL;

    /* 执行实际映射 */
    err = remap_pfn_range_notrack(vma, addr, pfn, size, prot);
    if (err)
        untrack_pfn(vma, pfn, PAGE_ALIGN(size));
    return err;
}
```

### 7.2 remap_pfn_range_notrack函数

```c
int remap_pfn_range_notrack(struct vm_area_struct *vma, unsigned long addr,
        unsigned long pfn, unsigned long size, pgprot_t prot)
{
    int error = remap_pfn_range_internal(vma, addr, pfn, size, prot);

    if (!error)
        return 0;

    /* 映射失败，清除已建立的映射 */
    zap_page_range_single(vma, addr, size, NULL);
    return error;
}
```

### 7.3 页表映射过程

```
┌─────────────────────────────────────────────────────────────┐
│                  页表映射建立过程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  输入：                                                     │
│  • vma: 目标VMA                                             │
│  • addr: 虚拟地址                                           │
│  • pfn: 物理页帧号                                          │
│  • size: 映射大小                                           │
│  • prot: 保护属性                                           │
│                                                             │
│  处理流程：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. 遍历每一页                                        │   │
│  │    for (addr; addr < end; addr += PAGE_SIZE)        │   │
│  │        pfn++                                         │   │
│  │                                                     │   │
│  │ 2. 获取或分配PTE                                     │   │
│  │    pte = pte_alloc_map(vma->vm_mm, pmd, addr)       │   │
│  │                                                     │   │
│  │ 3. 设置PTE条目                                       │   │
│  │    entry = pfn_pte(pfn, prot)                       │   │
│  │    set_pte_at(vma->vm_mm, addr, pte, entry)         │   │
│  │                                                     │   │
│  │ 4. 更新TLB                                           │   │
│  │    update_mmu_cache(vma, addr, pte)                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  结果：                                                     │
│  • 虚拟地址 -> 物理页 映射建立                              │
│  • 页表项包含物理地址和保护属性                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、映射模式详解

### 8.1 MAP_SHARED（共享映射）

```
┌─────────────────────────────────────────────────────────────┐
│                  MAP_SHARED共享映射                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 多进程共享同一物理页                               │   │
│  │ • 修改立即对其他进程可见                             │   │
│  │ • 修改会同步到磁盘文件                               │   │
│  │ • VM_SHARED标志被设置                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  数据流：                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  进程A              物理页              进程B        │   │
│  │  ┌────┐            ┌────┐            ┌────┐        │   │
│  │  │VMA │◄──────────│数据│──────────►│VMA │        │   │
│  │  └────┘            └────┘            └────┘        │   │
│  │    │                 │                 │           │   │
│  │    │                 ↓                 │           │   │
│  │    │              ┌────┐               │           │   │
│  │    │              │磁盘│               │           │   │
│  │    │              │文件│               │           │   │
│  │    │              └────┘               │           │   │
│  │    │                 ↑                 │           │   │
│  │    └─────────────────┴─────────────────┘           │   │
│  │              脏页回写                               │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  应用场景：                                                  │
│  • 进程间共享内存通信                                        │
│  • 共享库加载                                                │
│  • 数据库共享缓存                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 MAP_PRIVATE（私有映射）

```
┌─────────────────────────────────────────────────────────────┐
│                  MAP_PRIVATE私有映射                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 采用写时复制（COW）机制                            │   │
│  │ • 读操作共享物理页                                   │   │
│  │ • 写操作复制私有页                                   │   │
│  │ • 修改不影响原文件和其他进程                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  COW流程：                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  初始状态（共享读取）：                              │   │
│  │  进程A              物理页              进程B        │   │
│  │  ┌────┐            ┌────┐            ┌────┐        │   │
│  │  │VMA │◄──────────│数据│──────────►│VMA │        │   │
│  │  └────┘            └────┘            └────┘        │   │
│  │                                                     │   │
│  │  进程A写入时（触发COW）：                            │   │
│  │  ┌────┐            ┌────┐            ┌────┐        │   │
│  │  │VMA │◄──────────│新页│             │VMA │        │   │
│  │  └────┘            └────┘            └────┘        │   │
│  │                         │                 │         │   │
│  │                         │                 │         │   │
│  │                      ┌────┐◄─────────────┘         │   │
│  │                      │原页│                         │   │
│  │                      └────┘                         │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  应用场景：                                                  │
│  • 加载可执行文件                                            │
│  • 动态链接库加载                                            │
│  • fork后的进程内存                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 MAP_ANONYMOUS（匿名映射）

```
┌─────────────────────────────────────────────────────────────┐
│                  MAP_ANONYMOUS匿名映射                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  特点：                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 不关联任何文件                                     │   │
│  │ • fd参数设为-1                                       │   │
│  │ • 页面初始化为零                                     │   │
│  │ • 常用于大块内存分配                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  类型：                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  私有匿名映射（MAP_PRIVATE | MAP_ANONYMOUS）：       │   │
│  │  • 进程私有内存                                      │   │
│  │  • glibc大块内存分配使用                             │   │
│  │  • 类似malloc但更底层                                │   │
│  │                                                     │   │
│  │  共享匿名映射（MAP_SHARED | MAP_ANONYMOUS）：        │   │
│  │  • 父子进程共享内存                                  │   │
│  │  • 不需要文件系统支持                                │   │
│  │  • 进程间通信                                        │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  示例代码：                                                  │
│  void *mem = mmap(NULL, size, PROT_READ | PROT_WRITE,      │
│                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、mmap与零拷贝

### 9.1 传统I/O vs mmap I/O

```
┌─────────────────────────────────────────────────────────────┐
│              传统I/O vs mmap I/O对比                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统read/write：                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  磁盘 ──DMA──> 内核缓冲 ──CPU──> 用户缓冲           │   │
│  │        拷贝1          拷贝2                         │   │
│  │                                                     │   │
│  │  用户缓冲 ──CPU──> 内核缓冲 ──DMA──> 磁盘           │   │
│  │        拷贝3          拷贝4                         │   │
│  │                                                     │   │
│  │  总计：2次CPU拷贝 + 2次DMA拷贝 + 4次上下文切换       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  mmap方式：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  磁盘 ──DMA──> 内核页缓存 <──映射──> 用户空间       │   │
│  │        拷贝1          直接访问                       │   │
│  │                                                     │   │
│  │  总计：1次DMA拷贝 + 2次上下文切换（mmap+munmap）     │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  性能对比：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 方式        │ CPU拷贝 │ 上下文切换 │ 适用场景       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ read+write │   2次   │    4次     │ 通用           │   │
│  │ mmap       │   0次   │    2次     │ 大文件随机访问 │   │
│  │ sendfile   │   0次   │    2次     │ 文件传输       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 mmap + write零拷贝

```c
/* mmap配合write实现零拷贝文件传输 */
void transfer_file(int src_fd, int dst_fd, size_t size)
{
    char *mapped = mmap(NULL, size, PROT_READ, MAP_PRIVATE, src_fd, 0);
    if (mapped == MAP_FAILED) {
        perror("mmap");
        return;
    }
    
    /* 直接从映射内存写入目标文件 */
    write(dst_fd, mapped, size);
    
    munmap(mapped, size);
}
```

**流程分析**：

```
┌─────────────────────────────────────────────────────────────┐
│                mmap + write数据流                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. mmap()系统调用                                          │
│     用户态 ──> 内核态                                       │
│     建立映射，返回虚拟地址                                   │
│                                                             │
│  2. 访问映射区域（触发缺页）                                 │
│     DMA: 磁盘 ──> 内核页缓存                                │
│     用户直接访问页缓存                                       │
│                                                             │
│  3. write()系统调用                                         │
│     用户态 ──> 内核态                                       │
│     CPU: 页缓存 ──> socket缓冲                              │
│     DMA: socket缓冲 ──> 网卡                                │
│                                                             │
│  4. munmap()系统调用                                        │
│     用户态 ──> 内核态                                       │
│     解除映射                                                │
│                                                             │
│  总计：4次上下文切换，3次数据拷贝（2次DMA + 1次CPU）         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 十、munmap实现

### 10.1 munmap系统调用

```c
SYSCALL_DEFINE2(munmap, unsigned long, addr, size_t, len)
{
    addr = untagged_addr(addr);
    profile_munmap(addr);
    return __vm_munmap(addr, len, true);
}
```

### 10.2 __vm_munmap函数

```c
int __vm_munmap(unsigned long start, size_t len, bool do_unlock)
{
    struct mm_struct *mm = current->mm;
    LIST_HEAD(uf);
    int ret;

    len = PAGE_ALIGN(len);
    if (!len)
        return -EINVAL;

    if (mmap_write_lock_killable(mm))
        return -EINTR;

    ret = do_munmap(mm, start, len, &uf);
    
    if (do_unlock)
        mmap_write_unlock(mm);

    userfaultfd_unmap_complete(mm, &uf);
    return ret;
}
```

### 10.3 do_munmap核心实现

```c
int do_munmap(struct mm_struct *mm, unsigned long start, size_t len,
          struct list_head *uf)
{
    return __do_munmap(mm, start, len, uf, false);
}

int __do_munmap(struct mm_struct *mm, unsigned long start, size_t len,
            struct list_head *uf, bool downgrade)
{
    unsigned long end;
    struct vm_area_struct *vma, *prev, *last;

    /* 对齐检查 */
    if ((offset_in_page(start)) || start > TASK_SIZE || len > TASK_SIZE - start)
        return -EINVAL;

    len = PAGE_ALIGN(len);
    end = start + len;
    if (end < start)
        return -EINVAL;

    /* 查找受影响的VMA */
    vma = find_vma(mm, start);
    if (!vma)
        return 0;
    
    prev = vma->vm_prev;
    
    /* 检查是否需要分割VMA */
    if (start > vma->vm_start) {
        if (split_vma(mm, vma, start, 1))
            return -ENOMEM;
        prev = vma;
    }

    last = find_vma(mm, end);
    if (last && end > last->vm_start) {
        if (split_vma(mm, last, end, 0))
            return -ENOMEM;
    }

    /* 解除映射 */
    unmap_vmas(&tlb, vma, start, end);

    /* 释放VMA */
    remove_vma_list(mm, vma);

    return 0;
}
```

### 10.4 munmap流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    munmap流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户调用 munmap(addr, len)                                  │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 参数验证                                             │   │
│  │ • 地址对齐检查                                       │   │
│  │ • 范围有效性检查                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 查找受影响的VMA                                      │   │
│  │ • find_vma(start)                                    │   │
│  │ • find_vma(end)                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 分割VMA（如需要）                                    │   │
│  │ • start > vma->vm_start: 分割前部                    │   │
│  │ • end < vma->vm_end: 分割后部                        │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 解除页表映射                                         │   │
│  │ • unmap_vmas()                                       │   │
│  │ • 清除TLB                                            │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 释放VMA结构                                          │   │
│  │ • remove_vma_list()                                  │   │
│  │ • 更新统计信息                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ↓                                                     │
│  返回成功                                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 十一、实际应用场景

### 11.1 大文件处理

```c
/* 使用mmap处理大文件 */
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>

void process_large_file(const char *filename)
{
    int fd = open(filename, O_RDONLY);
    if (fd == -1) return;
    
    struct stat sb;
    fstat(fd, &sb);
    
    /* 映射整个文件 */
    char *mapped = mmap(NULL, sb.st_size, PROT_READ, 
                        MAP_PRIVATE, fd, 0);
    if (mapped == MAP_FAILED) {
        close(fd);
        return;
    }
    
    /* 直接操作映射内存 */
    for (off_t i = 0; i < sb.st_size; i++) {
        /* 处理每个字节 */
        process_byte(mapped[i]);
    }
    
    munmap(mapped, sb.st_size);
    close(fd);
}
```

### 11.2 进程间共享内存

```c
/* 使用mmap实现进程间共享内存 */
#include <sys/mman.h>
#include <fcntl.h>

/* 创建共享内存 */
int create_shared_memory(const char *name, size_t size)
{
    int fd = shm_open(name, O_CREAT | O_RDWR, 0666);
    if (fd == -1) return -1;
    
    ftruncate(fd, size);
    return fd;
}

/* 使用共享内存 */
void use_shared_memory(const char *name)
{
    int fd = shm_open(name, O_RDWR, 0);
    if (fd == -1) return;
    
    void *shared = mmap(NULL, 4096, PROT_READ | PROT_WRITE,
                        MAP_SHARED, fd, 0);
    if (shared == MAP_FAILED) {
        close(fd);
        return;
    }
    
    /* 读写共享内存 */
    int *data = (int *)shared;
    *data = 123;  /* 其他进程可见 */
    
    munmap(shared, 4096);
    close(fd);
}
```

### 11.3 数据库内存映射

```
┌─────────────────────────────────────────────────────────────┐
│                  数据库mmap应用                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MySQL InnoDB：                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 表空间文件使用mmap映射                             │   │
│  │ • 索引页直接在内存中操作                             │   │
│  │ • 减少数据拷贝开销                                   │   │
│  │ • 提高查询性能                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  SQLite：                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 数据库文件mmap映射                                 │   │
│  │ • 支持WAL模式下的共享映射                            │   │
│  │ • 减少系统调用次数                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  LMDB（Lightning Memory-Mapped Database）：                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 完全基于mmap设计                                   │   │
│  │ • B+树直接在mmap区域操作                             │   │
│  │ • 无锁读取，极高读取性能                             │   │
│  │ • 适合读多写少场景                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.4 加载可执行文件

```
┌─────────────────────────────────────────────────────────────┐
│                  ELF文件加载过程                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 打开ELF文件                                             │
│     fd = open(executable, O_RDONLY)                         │
│                                                             │
│  2. 映射ELF头                                               │
│     header = mmap(..., sizeof(Elf64_Ehdr), PROT_READ, ...)  │
│                                                             │
│  3. 解析程序头表                                             │
│     for each PT_LOAD segment:                               │
│         映射代码段/数据段                                    │
│                                                             │
│  4. 映射代码段（MAP_PRIVATE | PROT_EXEC）                   │
│     mmap(code_addr, code_size, PROT_READ | PROT_EXEC,       │
│          MAP_PRIVATE | MAP_FIXED, fd, code_offset)          │
│                                                             │
│  5. 映射数据段（MAP_PRIVATE | PROT_WRITE）                  │
│     mmap(data_addr, data_size, PROT_READ | PROT_WRITE,      │
│          MAP_PRIVATE | MAP_FIXED, fd, data_offset)          │
│                                                             │
│  6. 动态链接库加载                                           │
│     同样使用mmap映射.so文件                                 │
│     多进程共享代码段（节省内存）                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 十二、性能分析与最佳实践

### 12.1 性能优势

```
┌─────────────────────────────────────────────────────────────┐
│                  mmap性能优势                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 减少数据拷贝                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 传统read：磁盘→内核→用户（2次拷贝）                │   │
│  │ • mmap：磁盘→内核页缓存（1次拷贝）                   │   │
│  │ • 用户直接访问页缓存                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 减少系统调用                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 传统read/write：每次操作都需系统调用               │   │
│  │ • mmap：仅映射时需系统调用                           │   │
│  │ • 后续访问无需系统调用                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 延迟加载                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 仅在访问时才加载页面                               │   │
│  │ • 避免一次性加载大文件                               │   │
│  │ • 节省内存和I/O                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 页缓存共享                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 多进程映射同一文件共享页缓存                       │   │
│  │ • 减少物理内存占用                                   │   │
│  │ • 提高缓存命中率                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 性能劣势

```
┌─────────────────────────────────────────────────────────────┐
│                  mmap性能劣势                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 小文件开销大                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • mmap建立映射有固定开销                             │   │
│  │ • 小于16KB文件不如read快                             │   │
│  │ • 需要VMA结构、页表操作                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 随机写性能差                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 大量随机写导致脏页回写                             │   │
│  │ • 脏页回写由内核控制，不可预测                       │   │
│  │ • 可能不如buffered write                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 地址空间限制                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 需要连续虚拟地址空间                               │   │
│  │ • 32位系统受限于4GB地址空间                          │   │
│  │ • 大文件需要分段映射                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 变长文件不适用                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 映射时需指定大小                                   │   │
│  │ • 文件增长需要重新映射                               │   │
│  │ • 不适合频繁变化的文件                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 12.3 最佳实践

| 场景 | 推荐方式 | 原因 |
|------|----------|------|
| 大文件顺序读 | mmap | 减少拷贝，利用页缓存 |
| 大文件随机读 | mmap | 避免频繁seek |
| 小文件读写 | read/write | mmap开销大 |
| 频繁随机写 | write+fsync | 控制刷盘时机 |
| 进程间共享 | mmap+MAP_SHARED | 共享物理页 |
| 加载可执行文件 | mmap+MAP_PRIVATE | COW节省内存 |
| 变长文件 | read/write | 避免重新映射 |

---

## 十三、常见问题与调试

### 13.1 常见错误

```
┌─────────────────────────────────────────────────────────────┐
│                  mmap常见错误                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. EINVAL（无效参数）                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • offset不是页大小的整数倍                           │   │
│  │ • length为0                                          │   │
│  │ • flags参数无效                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. ENOMEM（内存不足）                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 虚拟地址空间不足                                   │   │
│  │ • 超过进程内存限制                                   │   │
│  │ • 内核内存不足                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. EACCES（权限拒绝）                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • PROT_WRITE但文件只读                               │   │
│  │ • 私有映射但文件不可读                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. EBADF（无效文件描述符）                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • fd不是有效的文件描述符                             │   │
│  │ • 非匿名映射时fd无效                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.2 调试工具

```bash
# 查看进程内存映射
pmap -x <pid>

# 查看进程内存映射详情
cat /proc/<pid>/maps

# 查看进程内存统计
cat /proc/<pid>/status | grep -i vm

# 使用strace跟踪mmap调用
strace -e mmap,munmap ./program

# 使用perf分析缺页
perf stat -e page-faults ./program

# 查看共享内存
ipcs -m
```

### 13.3 程序崩溃时mmap的行为

```
┌─────────────────────────────────────────────────────────────┐
│              程序崩溃时mmap映射文件的行为                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MAP_SHARED映射：                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 已修改的脏页可能丢失                               │   │
│  │ • 内核会尝试回写脏页                                 │   │
│  │ • 不保证数据完整性                                   │   │
│  │ • 建议使用msync定期同步                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  MAP_PRIVATE映射：                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 修改不会写入原文件                                 │   │
│  │ • 崩溃不影响原文件                                   │   │
│  │ • 私有修改随进程终止而丢失                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  建议措施：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 关键数据使用msync同步                              │   │
│  │ • 考虑使用write+fsync替代                            │   │
│  │ • 实现崩溃恢复机制                                   │   │
│  │ • 使用信号处理程序同步数据                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 总结

mmap是Linux内核中连接用户空间与内核空间、打通内存与外设的核心机制：

**核心价值**：
1. **减少数据拷贝**：从传统I/O的2次减少到1次
2. **减少系统调用**：仅映射时需要，后续访问无需系统调用
3. **延迟加载**：按需加载页面，节省内存
4. **进程间共享**：多进程共享物理页，高效IPC

**关键技术**：
- **VMA（vm_area_struct）**：描述虚拟内存区域
- **mm_struct**：描述进程地址空间
- **缺页异常**：延迟加载的核心机制
- **COW（写时复制）**：MAP_PRIVATE的核心优化
- **页表映射**：虚拟地址到物理地址的桥梁

**适用场景**：
- 大文件随机访问
- 进程间共享内存
- 加载可执行文件和动态库
- 数据库内存映射

**注意事项**：
- 小文件不如传统I/O高效
- 随机写可能导致性能下降
- 32位系统地址空间受限
- 变长文件不适合mmap

---

*本文基于Linux 5.15内核源码分析，从初学者角度详细介绍了mmap技术的原理、数据结构、内核实现和应用场景。mmap是理解现代操作系统内存管理的关键技术，掌握它对于构建高性能应用至关重要。*