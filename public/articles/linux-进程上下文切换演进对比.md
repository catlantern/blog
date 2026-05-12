# Linux 进程上下文切换演进对比

## 目录

1. **`概述`**
2. **`切换机制对比`**
3. **`数据结构对比`**
4. **`切换流程对比`**
5. **`内存管理切换对比`**
6. **`浮点状态切换对比`**
7. **`性能优化对比`**
8. **`多核支持对比`**
9. **`总结`**

---

## 1. 概述

### 1.1 Linux 0.11 上下文切换特点

| 特性 | 说明 |
|------|------|
| **切换机制** | 硬件 TSS 切换（ljmp 指令） |
| **寄存器保存** | TSS 结构体 |
| **页表切换** | CR3 在 TSS 中 |
| **浮点状态** | i387_struct 在 TSS 中 |
| **内核栈** | 每进程独立，通过 TSS 切换 |
| **多核支持** | 无 |

### 1.2 Linux 5.15 上下文切换特点

| 特性 | 说明 |
|------|------|
| **切换机制** | 软件切换（汇编 + C 函数） |
| **寄存器保存** | 内核栈 + thread_struct |
| **页表切换** | switch_mm_irqs_off() |
| **浮点状态** | 懒惰 FPU 切换 |
| **内核栈** | 每进程独立，通过栈指针切换 |
| **多核支持** | 完整 SMP 支持 |

---

## 2. 切换机制对比

### 2.1 Linux 0.11：硬件 TSS 切换

```
Linux 0.11 使用 x86 硬件任务切换机制：

+-------------------+
| switch_to(n) 宏   |
+-------------------+
         |
         v
+-------------------+
| ljmp TSS_n        |  <-- 硬件任务切换指令
+-------------------+
         |
         v
+-------------------+
| 硬件自动保存      |
| 所有寄存器到      |
| 当前进程 TSS      |
+-------------------+
         |
         v
+-------------------+
| 硬件自动加载      |
| 目标进程 TSS      |
| 中的寄存器        |
+-------------------+
         |
         v
+-------------------+
| CPU 开始执行      |
| 目标进程          |
+-------------------+

特点：
1. 使用 ljmp 指令跳转到目标 TSS
2. 硬件自动保存/恢复所有寄存器
3. 简单但效率较低
4. 每个 TSS 描述符存储在 GDT 中
```

**switch_to 宏实现**：
```c
#define switch_to(n) {\
struct {long a,b;} __tmp; \
__asm__("cmpl %%ecx,_current\n\t" \
    "je 1f\n\t" \
    "movw %%dx,%1\n\t" \
    "xchgl %%ecx,_current\n\t" \
    "ljmp %0\n\t" \          /* 关键：硬件任务切换 */
    "cmpl %%ecx,_last_task_used_math\n\t" \
    "jne 1f\n\t" \
    "clts\n" \
    "1:" \
    ::"m" (*&__tmp.a),"m" (*&__tmp.b), \
    "d" (_TSS(n)),"c" ((long) task[n])); \
}
```

### 2.2 Linux 5.15：软件切换

```
Linux 5.15 使用软件实现的任务切换：

+-------------------+
| context_switch()  |
+-------------------+
         |
         v
+-------------------+
| switch_mm()       |  <-- 切换地址空间
+-------------------+
         |
         v
+-------------------+
| switch_to() 宏    |
+-------------------+
         |
         v
+-------------------+
| __switch_to_asm() |  <-- 汇编保存/恢复寄存器
+-------------------+
         |
         v
+-------------------+
| __switch_to()     |  <-- C 函数处理其他状态
+-------------------+

特点：
1. 软件保存/恢复寄存器
2. 更灵活，可优化
3. 更高效
4. 支持更多架构特性
```

**switch_to 宏实现**：
```c
#define switch_to(prev, next, last)                  \
do {                                                 \
    ((last) = __switch_to_asm((prev), (next)));      \
} while (0)
```

**__switch_to_asm 汇编实现（x86_64）**：
```asm
SYM_FUNC_START(__switch_to_asm)
    /* 保存被调用者保存寄存器 */
    pushq   %rbp
    pushq   %rbx
    pushq   %r12
    pushq   %r13
    pushq   %r14
    pushq   %r15

    /* 切换栈指针 */
    movq    %rsp, TASK_threadsp(%rdi)    /* 保存 prev 栈指针 */
    movq    TASK_threadsp(%rsi), %rsp    /* 加载 next 栈指针 */

    /* 恢复被调用者保存寄存器 */
    popq    %r15
    popq    %r14
    popq    %r13
    popq    %r12
    popq    %rbx
    popq    %rbp

    jmp     __switch_to                   /* 跳转到 C 函数 */
SYM_FUNC_END(__switch_to_asm)
```

### 2.3 切换机制对比表

| 方面 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **切换方式** | 硬件 TSS 切换 | 软件栈切换 |
| **切换指令** | ljmp | mov + jmp |
| **寄存器保存** | 硬件自动 | 软件手动 |
| **灵活性** | 低 | 高 |
| **效率** | 较低 | 较高 |
| **可优化性** | 低 | 高 |

---

## 3. 数据结构对比

### 3.1 Linux 0.11：TSS 结构

```c
struct tss_struct {
    long back_link;     /* 前一个任务的 TSS 选择子 */
    long esp0;          /* 内核栈指针 */
    long ss0;           /* 内核栈段选择子 */
    long esp1;          /* 任务门使用 */
    long ss1;
    long esp2;
    long ss2;
    long cr3;           /* 页目录基址 */
    long eip;           /* 指令指针 */
    long eflags;        /* 标志寄存器 */
    long eax, ecx, edx, ebx;  /* 通用寄存器 */
    long esp;           /* 栈指针 */
    long ebp;           /* 帧指针 */
    long esi, edi;      /* 索引寄存器 */
    long es;            /* 段寄存器 */
    long cs;
    long ss;
    long ds;
    long fs;
    long gs;
    long ldt;           /* LDT 选择子 */
    long trace_bitmap;  /* 调试跟踪位图 */
    struct i387_struct i387;  /* 浮点寄存器状态 */
};

struct task_struct {
    long state;
    long counter;
    long priority;
    ...
    struct tss_struct tss;      /* 任务状态段 */
    struct desc_struct ldt[3];  /* 局部描述符表 */
};
```

### 3.2 Linux 5.15：thread_struct 结构

```c
struct thread_struct {
    struct desc_struct tls_array[3];
    unsigned long sp0;          /* 内核栈指针 */
    unsigned long sp;           /* 用户栈指针 */
    
#ifdef CONFIG_X86_32
    unsigned long sysenter_cs;
#else
    unsigned short es;
    unsigned short ds;
    unsigned short fsindex;
    unsigned short gsindex;
#endif

#ifdef CONFIG_X86_64
    unsigned long fsbase;
    unsigned long gsbase;
#else
    unsigned long fs;
    unsigned long gs;
#endif

    unsigned long debugreg0;
    unsigned long debugreg1;
    unsigned long debugreg2;
    unsigned long debugreg3;
    unsigned long debugreg6;
    unsigned long debugreg7;

    unsigned long cr2;          /* 页错误地址 */
    unsigned long trap_nr;
    unsigned long error_code;

    unsigned long *io_bitmap_ptr;
    unsigned long iopl;
    unsigned io_bitmap_max;

    mm_segment_t addr_limit;

    unsigned int sig_on_uaccess_err:1;
    unsigned int uaccess_err:1;

    unsigned int status;

    struct fpu fpu;             /* 浮点状态 */
};

struct task_struct {
    unsigned int __state;
    void *stack;                /* 内核栈 */
    
    struct mm_struct *mm;       /* 用户地址空间 */
    struct mm_struct *active_mm; /* 活跃地址空间 */
    
    int on_cpu;
    unsigned int cpu;
    
    int prio;
    int static_prio;
    int normal_prio;
    
    const struct sched_class *sched_class;
    struct sched_entity se;
    
    struct thread_struct thread; /* 线程相关状态 */
    ...
};
```

### 3.3 数据结构对比

| 方面 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **寄存器存储** | TSS 结构体 | 内核栈 + thread_struct |
| **页表存储** | TSS.cr3 | mm_struct.pgd |
| **浮点状态** | TSS.i387 | thread_struct.fpu |
| **内核栈** | TSS.esp0 | task_struct.stack |
| **LDT** | task_struct.ldt | thread_struct.tls_array |
| **调试寄存器** | 无 | thread_struct.debugreg* |

---

## 4. 切换流程对比

### 4.1 Linux 0.11 切换流程

```
Linux 0.11 切换流程：

schedule()
    |
    v
switch_to(next)
    |
    v
+-------------------+
| ljmp TSS_next     |  <-- 硬件任务切换
+-------------------+
    |
    | 硬件自动执行：
    v
+-------------------+
| 保存当前寄存器    |
| 到当前 TSS        |
+-------------------+
    |
    v
+-------------------+
| 加载目标 TSS      |
| 中的寄存器        |
+-------------------+
    |
    v
+-------------------+
| 加载 CR3（页表）  |
+-------------------+
    |
    v
+-------------------+
| 跳转到目标 EIP    |
+-------------------+
    |
    v
目标进程开始执行
```

### 4.2 Linux 5.15 切换流程

```
Linux 5.15 切换流程：

__schedule()
    |
    v
+-------------------+
| pick_next_task()  |  <-- 选择下一个进程
+-------------------+
    |
    v
context_switch()
    |
    +------------------+------------------+
    |                  |                  |
    v                  v                  v
+--------+      +------------+     +------------+
| 内核线程|      | 用户进程   |     | 用户进程   |
| → 内核 |      | → 用户     |     | → 用户     |
+--------+      +------------+     +------------+
    |                  |                  |
    v                  v                  v
enter_lazy_tlb   switch_mm()       switch_mm()
    |                  |                  |
    +------------------+------------------+
                       |
                       v
              +-------------------+
              | switch_to()       |
              +-------------------+
                       |
                       v
              +-------------------+
              | __switch_to_asm() |
              | 保存寄存器到栈    |
              | 切换栈指针        |
              +-------------------+
                       |
                       v
              +-------------------+
              | __switch_to()     |
              | 切换 FPU          |
              | 切换 TLS          |
              | 切换段寄存器      |
              +-------------------+
                       |
                       v
              目标进程开始执行
```

### 4.3 context_switch 函数

```c
static __always_inline struct rq *
context_switch(struct rq *rq, struct task_struct *prev,
               struct task_struct *next, struct rq_flags *rf)
{
    prepare_task_switch(rq, prev, next);

    arch_start_context_switch(prev);

    /*
     * kernel -> kernel   lazy + transfer active
     *   user -> kernel   lazy + mmgrab() active
     * kernel ->   user   switch + mmdrop() active
     *   user ->   user   switch
     */
    if (!next->mm) {                        /* 切换到内核线程 */
        enter_lazy_tlb(prev->active_mm, next);

        next->active_mm = prev->active_mm;
        if (prev->mm)                       /* 从用户进程切换 */
            mmgrab(prev->active_mm);
        else
            prev->active_mm = NULL;
    } else {                                /* 切换到用户进程 */
        membarrier_switch_mm(rq, prev->active_mm, next->mm);
        switch_mm_irqs_off(prev->active_mm, next->mm, next);

        if (!prev->mm) {                    /* 从内核线程切换 */
            rq->prev_mm = prev->active_mm;
            prev->active_mm = NULL;
        }
    }

    rq->clock_update_flags &= ~(RQCF_ACT_SKIP|RQCF_REQ_SKIP);

    prepare_lock_switch(rq, next, rf);

    /* 切换寄存器状态和栈 */
    switch_to(prev, next, prev);
    barrier();

    return finish_task_switch(prev);
}
```

---

## 5. 内存管理切换对比

### 5.1 Linux 0.11 页表切换

```
Linux 0.11 页表切换：

TSS 结构中存储 CR3：
+-------------------+
| TSS.cr3           |  <-- 页目录基址
+-------------------+
         |
         | ljmp 切换时
         v
+-------------------+
| 硬件自动加载 CR3  |
+-------------------+
         |
         v
+-------------------+
| 新的页表生效      |
+-------------------+

特点：
1. 页表基址存储在 TSS 中
2. 切换时硬件自动加载 CR3
3. 每个进程有独立的页表
4. 无 lazy TLB 优化
```

### 5.2 Linux 5.15 页表切换

```
Linux 5.15 页表切换：

mm_struct 结构：
+-------------------+
| mm_struct         |
| - pgd             |  <-- 页目录基址
| - mm_users        |  <-- 用户计数
| - mm_count        |  <-- 引用计数
+-------------------+

切换逻辑：
+-------------------+
| next->mm != NULL? |
+-------------------+
         |
    +----+----+
    | 是      | 否
    v         v
+--------+  +-------------------+
| 用户   |  | 内核线程          |
| 进程   |  |                   |
+--------+  +-------------------+
    |               |
    v               v
+--------+  +-------------------+
|switch_mm| |enter_lazy_tlb     |
| 切换页表| | 借用 prev 的 mm   |
+--------+  +-------------------+

特点：
1. 页表基址存储在 mm_struct 中
2. 软件控制切换时机
3. 内核线程可借用 mm
4. 支持 lazy TLB 优化
```

### 5.3 switch_mm 实现

```c
static inline void switch_mm(struct mm_struct *prev, 
                             struct mm_struct *next,
                             struct task_struct *tsk)
{
    unsigned cpu = smp_processor_id();

    if (likely(prev != next)) {
        /* 检查是否需要刷新 TLB */
        if (IS_ENABLED(CONFIG_VMAP_STACK)) {
            /* ... */
        }

        /* 加载新的页表 */
        load_mm_cr4(next);
        switch_ldt(prev, next);
        
        /* 设置 CR3 */
        write_cr3(__sme_pa(next->pgd) | 
                  (next->context.pcid & ~PCID_INV));

        /* 更新活跃 mm */
        this_cpu_write(cpu_tlbstate.active_mm, next);
        
        /* 更新 CPU 掩码 */
        cpumask_set_cpu(cpu, mm_cpumask(next));
    }
}
```

---

## 6. 浮点状态切换对比

### 6.1 Linux 0.11 浮点切换

```
Linux 0.11 浮点切换：

TSS 结构中存储浮点状态：
+-------------------+
| TSS.i387          |  <-- i387_struct
+-------------------+
         |
         | 每次切换
         v
+-------------------+
| 硬件保存/恢复     |
| 所有浮点寄存器    |
+-------------------+

特点：
1. 浮点状态存储在 TSS 中
2. 每次切换都保存/恢复
3. 无优化，开销大
4. 使用 clts 指令清除 TS 标志
```

### 6.2 Linux 5.15 懒惰 FPU 切换

```
Linux 5.15 懒惰 FPU 切换：

切换策略：
+-------------------+
| 进程 A 使用 FPU?  |
+-------------------+
         |
    +----+----+
    | 是      | 否
    v         v
+--------+  +--------+
| 保存   |  | 不保存 |
| FPU 状态|  |        |
+--------+  +--------+
    |
    v
+-------------------+
| 设置 TS 标志      |
+-------------------+
         |
         v
+-------------------+
| 切换到进程 B      |
+-------------------+
         |
         v
+-------------------+
| 进程 B 使用 FPU?  |
+-------------------+
         |
    +----+----+
    | 是      | 否
    v         v
+--------+  +--------+
| #NM 异常|  | 不恢复 |
| 恢复状态|  |        |
+--------+  +--------+

特点：
1. 懒惰切换：只在需要时保存/恢复
2. 大幅减少切换开销
3. FPU 状态存储在 thread_struct.fpu
4. 使用 XSAVE/XRSTOR 指令
```

### 6.3 FPU 切换代码

```c
/* 切换前准备 */
if (!test_thread_flag(TIF_NEED_FPU_LOAD))
    switch_fpu_prepare(prev_fpu, cpu);

/* 切换后完成 */
switch_fpu_finish(next_fpu);

/* switch_fpu_prepare */
void switch_fpu_prepare(struct fpu *old_fpu, int cpu)
{
    if (static_cpu_has(X86_FEATURE_FPU) &&
        !(current->flags & PF_KTHREAD)) {
        /* 保存 FPU 状态 */
        copy_fpregs_to_fpstate(old_fpu);
        /* 设置 TS 标志 */
        __cpu_invalidate_fpregs_state();
    }
}
```

---

## 7. 性能优化对比

### 7.1 Linux 0.11 性能特点

```
Linux 0.11 性能特点：

优点：
+-------------------+
| 实现简单          |
+-------------------+
         |
         v
+-------------------+
| 代码量少          |
+-------------------+
         |
         v
+-------------------+
| 易于理解          |
+-------------------+

缺点：
+-------------------+
| 硬件切换开销大    |
+-------------------+
         |
         v
+-------------------+
| 无懒惰 FPU 切换   |
+-------------------+
         |
         v
+-------------------+
| 无 lazy TLB       |
+-------------------+
         |
         v
+-------------------+
| 无多核优化        |
+-------------------+
```

### 7.2 Linux 5.15 性能优化

```
Linux 5.15 性能优化：

1. 软件切换
+-------------------+
| 只保存必要寄存器  |
+-------------------+
         |
         v
+-------------------+
| 减少内存访问      |
+-------------------+

2. 懒惰 FPU 切换
+-------------------+
| 只在使用时切换    |
+-------------------+
         |
         v
+-------------------+
| 大幅减少开销      |
+-------------------+

3. Lazy TLB
+-------------------+
| 内核线程借用 mm   |
+-------------------+
         |
         v
+-------------------+
| 减少 TLB 刷新     |
+-------------------+

4. RCU 优化
+-------------------+
| rcu_note_context_switch |
+-------------------+
         |
         v
+-------------------+
| 减少 RCU 开销     |
+-------------------+

5. 多核优化
+-------------------+
| per-CPU 变量      |
+-------------------+
         |
         v
+-------------------+
| 减少缓存竞争      |
+-------------------+
```

### 7.3 切换开销对比

| 开销项 | Linux 0.11 | Linux 5.15 |
|--------|------------|------------|
| **寄存器保存/恢复** | 硬件自动（慢） | 软件手动（快） |
| **页表切换** | 每次切换 | 按需切换 |
| **FPU 切换** | 每次切换 | 懒惰切换 |
| **TLB 刷新** | 每次切换 | Lazy TLB |
| **内存访问** | 多次 | 最小化 |

---

## 8. 多核支持对比

### 8.1 Linux 0.11 多核支持

```
Linux 0.11：无多核支持

+-------------------+
| 单处理器系统      |
+-------------------+
         |
         v
+-------------------+
| 无 CPU 亲和性     |
+-------------------+
         |
         v
+-------------------+
| 无负载均衡        |
+-------------------+
         |
         v
+-------------------+
| 无 per-CPU 变量   |
+-------------------+
```

### 8.2 Linux 5.15 多核支持

```
Linux 5.15：完整多核支持

+-------------------+
| SMP 支持          |
+-------------------+
         |
         v
+-------------------+
| CPU 亲和性        |
| cpus_ptr          |
+-------------------+
         |
         v
+-------------------+
| 负载均衡          |
| load_balance()    |
+-------------------+
         |
         v
+-------------------+
| per-CPU 变量      |
| this_cpu_*        |
+-------------------+
         |
         v
+-------------------+
| 迁移支持          |
| migration_thread  |
+-------------------+
```

### 8.3 多核相关字段

```c
struct task_struct {
#ifdef CONFIG_SMP
    int on_cpu;                    /* 当前运行的 CPU */
    unsigned int cpu;              /* 亲和 CPU */
    
    struct __call_single_node wake_entry;
    
    unsigned int wakee_flips;
    unsigned long wakee_flip_decay_ts;
    struct task_struct *last_wakee;
    
    int recent_used_cpu;
    int wake_cpu;
#endif
    int on_rq;                     /* 在运行队列中 */
    
    const cpumask_t *cpus_ptr;     /* 允许的 CPU 掩码 */
    cpumask_t cpus_mask;
};
```

---

## 9. 总结

### 9.1 主要演进

| 方面 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **切换机制** | 硬件 TSS | 软件栈切换 |
| **寄存器保存** | TSS 结构 | 内核栈 |
| **页表切换** | 硬件自动 | 软件控制 |
| **FPU 切换** | 每次切换 | 懒惰切换 |
| **TLB 优化** | 无 | Lazy TLB |
| **多核支持** | 无 | 完整 SMP |
| **性能** | 基础 | 高度优化 |

### 9.2 关键改进

1. **软件切换替代硬件切换**
   - 更灵活的控制
   - 更好的性能
   - 更易于优化

2. **懒惰 FPU 切换**
   - 只在需要时切换
   - 大幅减少开销
   - 支持现代 FPU 指令

3. **Lazy TLB**
   - 内核线程借用 mm
   - 减少 TLB 刷新
   - 提高缓存效率

4. **多核支持**
   - CPU 亲和性
   - 负载均衡
   - per-CPU 变量

### 9.3 设计哲学

**Linux 0.11**：
- 利用硬件特性
- 实现简单
- 教学目的

**Linux 5.15**：
- 软件控制
- 性能优化
- 可扩展性
- 多核支持
