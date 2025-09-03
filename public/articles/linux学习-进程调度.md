## 什么是进程调度？

进程调度是操作系统内核的核心功能，负责决定：

- **哪个进程获得 CPU**
- **运行多长时间**
- **何时切换到其他进程**

##  多任务操作系统的本质

### 1. **单处理器 vs 多处理器**

```c
// 单处理器：时间片轮转，产生"并发"的幻觉
// [进程A][进程B][进程C][进程A][进程B][进程C]...

// 多处理器：真正的并行执行
// CPU0: [进程A]
// CPU1: [进程B]  
// CPU2: [进程C]
```

### 2. **进程状态转换**

```
新建 → 就绪 → 运行 → 阻塞 → 就绪 → 运行 → 终止
              ↗️      ↘️
           等待资源    等待调度
```

------

## 两种多任务模式

### 1. **非抢占式多任务（协作式）**

```c
// 早期 Windows 和 Mac OS 的方式
void process_A() {
    while(1) {
        do_some_work();
        yield();  // 主动让出 CPU
    }
}

void process_B() {
    while(1) {
        do_some_work();
        yield();  // 主动让出 CPU
    }
}

// 问题：如果某个进程忘记 yield()？
void bad_process() {
    while(1) {
        // 永远不调用 yield()
        // 整个系统都会被这个进程卡住！
    }
}
```

### 2. **抢占式多任务（现代方式）**

```c
c// Linux 和现代操作系统的方式
void process_A() {
    while(1) {
        do_some_work();
        // 不需要主动让出 CPU
        // 调度器会在时间片用完后强制切换
    }
}

void process_B() {
    while(1) {
        do_some_work();
        // 同样不需要主动让出 CPU
    }
}

// 调度器自动管理：
// 时间片用完 → 强制切换 → 公平分配 CPU 时间
```

------

## 时间片（Time Slice）

### 1. **什么是时间片？**

```c
// 时间片是分配给每个进程的 CPU 时间
// 例如：每个进程运行 10ms，然后切换

struct task_struct {
    unsigned long time_slice;  // 剩余时间片
    unsigned long priority;    // 进程优先级
};
```

### 2. **时间片的工作原理**

```c
// 系统时钟中断处理
void timer_interrupt() {
    current->time_slice--;  // 当前进程时间片减1
    
    if (current->time_slice <= 0) {
        // 时间片用完，需要调度
        schedule();  // 切换到其他进程
    }
}
```

### 3. **动态时间片**

```c
// Linux 使用动态时间片
void update_time_slice(struct task_struct *task) {
    // 根据进程优先级、历史行为等调整时间片
    if (is_interactive_task(task)) {
        // 交互式进程：较短但频繁的时间片
        task->time_slice = 10;  // 10ms
    } else {
        // 批处理进程：较长的时间片
        task->time_slice = 100; // 100ms
    }
}
```

------

##  调度程序的核心职责

### 1. **进程选择**

```c
// 调度器需要从就绪队列中选择下一个运行的进程
struct task_struct *pick_next_task() {
    // 根据调度策略选择最优进程
    // 考虑因素：
    // - 进程优先级
    - 进程类型（交互式 vs 批处理）
    - 已等待时间
    - 历史 CPU 使用情况
}
```

### 2. **上下文切换**

```c
// 保存当前进程状态，恢复下一个进程状态
void context_switch(struct task_struct *prev, struct task_struct *next) {
    // 保存 prev 进程的寄存器状态
    save_processor_state(prev);
    
    // 恢复 next 进程的寄存器状态
    restore_processor_state(next);
    
    // 切换内存映射（如果需要）
    switch_mm(prev, next);
}
```

------

##  实际例子说明

### 1. **系统中有 100 个进程**

```bash
bash# 查看系统进程
$ ps aux | wc -l
# 可能显示 100+ 个进程

# 但实际上只有少数几个是可运行的
$ ps aux | grep -v "sleep\|wait" | wc -l
# 可能只有 5-10 个可运行进程
```

### 2. **进程状态分类**

```c
// 进程状态示例：
struct task_struct {
    volatile long state;  // 进程状态
};

// 常见状态：
#define TASK_RUNNING    0    // 可运行或正在运行
#define TASK_INTERRUPTIBLE 1 // 可中断睡眠
#define TASK_UNINTERRUPTIBLE 2 // 不可中断睡眠  
#define TASK_STOPPED    4    // 停止
#define TASK_TRACED     8    // 被跟踪
#define TASK_ZOMBIE     16   // 僵尸状态
```

------

##  Linux 调度的优势

### 1. **公平性**

```c
// 每个进程都能获得合理的 CPU 时间
// 不会出现某个进程独占 CPU 的情况
```

### 2. **响应性**

```c
// 交互式进程（如 GUI 应用）能快速响应
// 批处理进程也不会饿死
```

### 3. **效率**

```c
// 减少不必要的上下文切换
// 优化缓存局部性
```

------

##  调度策略示例

### 1. **实时进程 vs 普通进程**

```c
// 实时进程：需要立即响应
// 普通进程：可以等待

int main() {
    // 设置实时调度策略
    struct sched_param param;
    param.sched_priority = 50;
    sched_setscheduler(0, SCHED_FIFO, &param);
    
    // 这个进程会获得更高的调度优先级
}
```

### 2. **交互式进程识别**

```c
// 调度器如何识别交互式进程？
// - 睡眠时间长，运行时间短
// - 频繁地等待用户输入
// - 对响应时间敏感

// 例如：文本编辑器
// 睡眠等待用户按键 → 运行处理按键 → 再睡眠
// 调度器会给这类进程更高的优先级
```

**进程调度的核心概念**：

1. **多任务**：让多个进程"同时"运行
2. **抢占式**：调度器强制切换进程
3. **时间片**：每个进程运行的固定时间
4. **公平性**：合理分配 CPU 资源
5. **响应性**：及时响应用户交互

**关键优势**：

- 防止恶意进程独占系统资源
- 提供公平的资源分配机制
- 支持现代应用程序的需求
- 优化系统整体性能

这就是为什么 Linux 采用抢占式多任务调度的原因——它提供了更好的系统稳定性和用户体验！





##  Linux 调度程序的演进历程

### 1. **Linux 1.0 - 2.4：简单调度器**
```c
// 早期 Linux 调度器的特点：
// - 简单直观，但性能有限
// - 时间复杂度：O(n) - 需要遍历所有进程
// - 不适合多处理器系统

// 伪代码示例：
struct task_struct *simple_schedule(void) {
    struct task_struct *best_task = NULL;
    int best_priority = INT_MAX;
    
    // 遍历所有进程 O(n)
    for_each_process(p) {
        if (p->state == TASK_RUNNING) {
            if (p->priority < best_priority) {
                best_priority = p->priority;
                best_task = p;
            }
        }
    }
    return best_task;
}
```

**问题**：
- 进程多时性能差
- 多处理器扩展性差
- 交互性不佳

---

## O(1) 调度程序（Linux 2.5 - 2.6.22）

### 1. **核心创新**
```c
// O(1) 调度器的特点：
// - 时间复杂度：O(1) - 常数时间选择进程
// - 使用 140 个优先级队列（位图）
// - 两个运行队列：活跃队列 + 过期队列

struct runqueue {
    unsigned long bitmap[140];  // 位图表示哪些优先级有进程
    struct list_head queues[140]; // 每个优先级一个队列
    struct list_head active[140]; // 活跃队列
    struct list_head expired[140]; // 过期队列
};
```

### 2. **工作原理**
```c
// 1. 使用位图快速找到最高优先级
int find_highest_priority(unsigned long *bitmap) {
    // O(1) 时间找到第一个置位的位
    return __ffs(bitmap[0]);
}

// 2. 双队列机制
void schedule() {
    // 从活跃队列中选择进程
    if (!active_queue_empty()) {
        // 选择活跃队列中的进程
        next = pick_from_active_queue();
    } else {
        // 活跃队列空了，切换到过期队列
        swap(active_queue, expired_queue);
        next = pick_from_active_queue();
    }
}

// 3. 时间片管理
void update_time_slice(struct task_struct *p) {
    if (p->time_slice-- <= 0) {
        // 时间片用完，移到过期队列
        move_to_expired_queue(p);
    }
}
```

### 3. **O(1) 调度器的优势**
```c
// ✅ 优势：
// - 常数时间选择进程
// - 多处理器性能好
// - 服务器负载表现优秀

// ❌ 问题：
// - 交互性差
// - 复杂的启发式算法
// - 桌面用户体验不佳
```

---

## 完全公平调度器 CFS（Linux 2.6.23+）

### 1. **设计理念的转变**
```c
// 从"时间片分配"转向"公平性保证"
// 核心思想：每个进程都应该获得公平的 CPU 时间

// 传统方式：给每个进程分配固定时间片
// CFS方式：让进程运行，直到不公平程度达到阈值

struct cfs_rq {
    struct rb_root tasks_timeline;  // 红黑树
    u64 min_vruntime;              // 最小虚拟运行时间
};
```

### 2. **虚拟运行时间（vruntime）**
```c
// 虚拟运行时间 = 实际运行时间 / 进程权重
// 权重根据优先级计算

struct sched_entity {
    u64 vruntime;        // 虚拟运行时间
    u64 sum_exec_runtime; // 实际运行时间总和
};

// 计算示例：
// 进程A（高优先级）权重 = 1024
// 进程B（低优先级）权重 = 512
// 
// 进程A运行10ms：vruntime = 10 * 1024 / 1024 = 10
// 进程B运行10ms：vruntime = 10 * 1024 / 512 = 20
// 
// CFS总是选择vruntime最小的进程
```

### 3. **红黑树实现**
```c
// 使用红黑树维护进程排序
struct rb_root tasks_timeline;

// 插入进程
void enqueue_entity(struct cfs_rq *cfs_rq, struct sched_entity *se) {
    // 以 vruntime 为键插入红黑树
    rb_link_node(&se->run_node, parent, link);
    rb_insert_color(&se->run_node, &cfs_rq->tasks_timeline);
}

// 选择下一个进程
struct sched_entity *pick_next_entity(struct cfs_rq *cfs_rq) {
    // 选择最左边的节点（vruntime 最小）
    struct rb_node *left = rb_first(&cfs_rq->tasks_timeline);
    return rb_entry(left, struct sched_entity, run_node);
}
```

### 4. **CFS 的优势**
```c
// ✅ 优势：
// - 真正的公平性
// - 优秀的交互性
// - 简洁的设计
// - 良好的可扩展性

// 🎯 实际效果：
// - 桌面响应更快
// - 服务器性能不降
// - 代码更易维护
```

---

##  调度算法对比

### 1. **性能特征对比**
```c
//                    O(1)调度器    CFS
// 时间复杂度         O(1)         O(log n)
// 公平性             中等         优秀
// 交互性             较差         优秀
// 实现复杂度         复杂         相对简单
// 多处理器扩展性     好           很好
```

### 2. **实际应用场景**
```c
// O(1) 调度器适合：
// - 大型服务器
// - 批处理任务
// - 对交互性要求不高的场景

// CFS 适合：
// - 桌面系统
// - 交互式应用
// - 混合负载环境
// - 所有现代 Linux 系统
```

##  CFS 的关键技术细节

### 1. **最小粒度时间**
```c
// 防止频繁切换的最小运行时间
unsigned int sysctl_sched_min_granularity = 1000000; // 1ms

// 如果进程运行时间太短，会延长运行时间
if (delta_exec < min_granularity) {
    // 保持运行，避免频繁切换
}
```

### 2. **唤醒抢占**
```c
// 新唤醒的进程可能抢占当前运行进程
void check_preempt_tick(struct cfs_rq *cfs_rq, struct sched_entity *curr) {
    struct sched_entity *se = pick_next_entity(cfs_rq);
    
    // 如果新进程比当前进程更"饿"
    if (entity_before(se, curr)) {
        // 触发抢占
        resched_curr(rq);
    }
}
```

### 3. **负载均衡**
```c
// 多处理器间的负载均衡
void load_balance(int this_cpu) {
    // 查找负载最重的 CPU
    int busiest = find_busiest_queue();
    
    // 迁移进程到当前 CPU
    move_tasks(this_cpu, busiest);
}
```

**Linux 调度器的发展轨迹**：

1. **简单调度器（1.0-2.4）**：
   - 简单但性能有限
   - O(n) 时间复杂度

2. **O(1) 调度器（2.5-2.6.22）**：
   - 革命性改进
   - 常数时间选择
   - 服务器性能优秀
   - 但交互性差

3. **CFS（2.6.23+）**：
   - 公平性为核心
   - 红黑树实现
   - 兼顾性能和交互性
   - 现代 Linux 的标准

**CFS 的核心价值**：
- **公平性**：每个进程获得应得的 CPU 时间
- **响应性**：交互式应用响应更快
- **简洁性**：设计优雅，易于理解和维护
- **通用性**：适合各种工作负载





## 两种基本进程类型

### 1. **I/O 消耗型进程**
```c
// 特征：频繁等待I/O操作完成
void io_intensive_process() {
    while(1) {
        // 1. 快速处理已有数据
        process_data();
        
        // 2. 等待新的I/O请求（长时间阻塞）
        data = read_from_keyboard();  // 可能等待几秒到几分钟
        
        // 3. 快速处理新数据
        handle_input(data);
        
        // 4. 回到等待状态
    }
}
```

**典型例子**：
- 文本编辑器（等待键盘输入）
- 网页浏览器（等待网络响应）
- 图形界面应用（等待鼠标点击）
- 数据库查询（等待磁盘I/O）

### 2. **处理器消耗型进程**
```c
// 特征：持续进行计算，很少等待
void cpu_intensive_process() {
    while(1) {
        // 长时间的纯计算工作
        for (int i = 0; i < 1000000; i++) {
            perform_calculation();
        }
        // 几乎不阻塞，持续占用CPU
    }
}
```

**典型例子**：
- 视频编码软件
- 科学计算程序
- 数据压缩工具
- 数学建模软件

---

## 进程行为模式对比

### 1. **时间使用模式**
```
I/O 消耗型进程：
[运行][等待][运行][等待][运行][等待]...
 ↑短   ↑长   ↑短   ↑长   ↑短   ↑长

处理器消耗型进程：
[运行][运行][运行][运行][运行][运行]...
 ↑长   ↑长   ↑长   ↑长   ↑长   ↑长
```

### 2. **资源需求差异**
```c
// I/O 消耗型进程的需求：
// - 快速响应（低延迟）
// - 不需要连续的CPU时间
// - 用户交互敏感

// 处理器消耗型进程的需求：
// - 大量连续的CPU时间
// - 可以容忍一定的延迟
// - 计算结果敏感
```

---

##  调度策略的平衡艺术

### 1. **响应时间 vs 吞吐量**
```c
// 调度器面临的权衡：

// 优化响应时间：
schedule() {
    // 优先调度刚唤醒的I/O进程
    if (recently_woken_io_process()) {
        return io_process;  // 快速响应用户输入
    }
}

// 优化吞吐量：
schedule() {
    // 优先调度CPU密集型进程
    if (cpu_intensive_process()) {
        return cpu_process;  // 减少上下文切换开销
    }
}
```

### 2. **实际的平衡策略**
```c
// 现代调度器的处理方式：
struct task_struct {
    unsigned long sleep_start;   // 开始睡眠的时间
    unsigned long sleep_avg;     // 平均睡眠时间
    int priority;               // 动态优先级
};

// 动态优先级调整：
void update_priority(struct task_struct *task) {
    if (task->sleep_avg > THRESHOLD) {
        // 经常睡眠 → I/O密集 → 提高优先级
        task->priority += BOOST;
    } else {
        // 很少睡眠 → CPU密集 → 降低优先级
        task->priority -= PENALTY;
    }
}
```

---

##  典型混合型进程

### 1. **X Window 服务器**
```c
// X服务器既是I/O密集又是CPU密集：
void x_server() {
    while(1) {
        // 处理图形渲染（CPU密集）
        render_graphics();
        
        // 等待用户输入（I/O密集）
        wait_for_mouse_keyboard();
        
        // 处理事件（CPU密集但很快）
        process_events();
        
        // 等待下一个事件（I/O密集）
    }
}
```

### 2. **Web 服务器**
```c
// Apache服务器的混合行为：
void web_server() {
    while(1) {
        // 等待网络连接（I/O密集）
        client = accept(socket);
        
        // 快速处理HTTP请求（CPU密集）
        parse_http_request(client);
        
        // 可能需要读取文件（I/O密集）
        file_data = read_file();
        
        // 处理数据生成响应（CPU密集）
        generate_response(file_data);
    }
}
```

---

## Unix/Linux 的设计理念

### 1. **交互性优先**
```c
// Unix系统的设计哲学：
// "响应速度比吞吐量更重要"

// 因为：
// - 用户能直接感受到响应速度
// - 吞吐量的损失用户不太容易察觉
// - 良好的交互体验提升用户满意度
```

### 2. **动态调度优化**
```c
// Linux CFS 的处理方式：
void cfs_schedule() {
    // 1. 识别交互式进程
    if (is_interactive(task)) {
        // 给予更高的调度权重
        increase_vruntime_weight(task);
    }
    
    // 2. 保证批处理进程
    else if (is_batch(task)) {
        // 给予较低的调度权重，但仍保证执行
        decrease_vruntime_weight(task);
    }
    
    // 3. 使用红黑树维护公平性
    select_next_entity();  // 选择最"饿"的进程
}
```

---

##  实际应用示例

### 1. **桌面系统场景**
```c
// 同时运行的进程：
// - 文本编辑器（I/O密集）- 需要快速响应按键
// - 浏览器（I/O密集）- 需要快速响应网页加载
// - 视频编码（CPU密集）- 可以在后台慢慢运行

// 调度器应该：
// 1. 优先响应编辑器和浏览器的用户操作
// 2. 在系统空闲时给视频编码更多CPU时间
// 3. 避免视频编码导致界面卡顿
```

### 2. **服务器场景**
```c
// 同时运行的进程：
// - Web服务器（混合型）- 需要快速响应请求
// - 数据库（I/O密集）- 需要快速响应查询
// - 数据分析（CPU密集）- 可以在低峰期运行

// 调度器应该：
// 1. 保证Web和数据库的响应性
// 2. 在系统负载低时执行数据分析
// 3. 动态调整各进程的优先级
```

## 

**调度策略的核心要点**：

1. **进程分类**：
   - I/O 消耗型：需要快速响应
   - 处理器消耗型：需要大量计算时间

2. **调度目标**：
   - 响应时间短（用户体验）
   - 吞吐量高（系统效率）

3. **平衡策略**：
   - 优先考虑交互式进程
   - 不忽视批处理进程
   - 动态调整优先级

4. **Unix/Linux 特色**：
   - 交互性优先于吞吐量
   - 智能识别进程类型
   - 公平性和响应性并重



##  优先级调度的基本概念

##  Linux 的两种优先级系统

### 1. **Nice 值（-20 到 +19）**
```c
// Nice值的特点：
// - 数值范围：-20 到 +19
// - 默认值：0
// - 值越小，优先级越高
// - 值越大，对其他进程越"友好"

struct task_struct {
    int nice;  // nice值
};
```

**Nice值的含义**：

```
Nice值    优先级    说明
-20       最高      系统关键进程
-10       高        重要应用
  0       默认      普通进程
+10       低        后台任务
+19       最低      最"友好"的进程
```

### 2. **实时优先级（1 到 99）**
```c
// 实时优先级的特点：
// - 数值范围：1 到 99
// - 值越大，优先级越高
// - 比所有普通进程优先级都高

struct task_struct {
    int rt_priority;  // 实时优先级
};
```

---

## 优先级层次结构

### 1. **完整的优先级范围**
```
实时优先级 (1-99)     ← 最高优先级
    ↓
普通进程 (nice -20到+19) ← 通过nice值区分
    ↓
空闲进程              ← 最低优先级
```

### 2. **实际的优先级计算**
```c
// Linux内核中的优先级计算：
// 实时进程：优先级 = MAX_RT_PRIO - rt_priority
// 普通进程：优先级 = MAX_RT_PRIO + nice + 20

#define MAX_RT_PRIO 100

// 例子：
// 实时进程 rt_priority=50 → 优先级 = 100-50 = 50
// 普通进程 nice=0 → 优先级 = 100+0+20 = 120
// 普通进程 nice=10 → 优先级 = 100+10+20 = 130
```

---

##  查看和设置优先级

### 1. **查看进程优先级**
```bash
# 查看所有进程的nice值
$ ps -el
# NI列显示nice值

# 查看实时优先级
$ ps -eo state,uid,pid,ppid,rtprio,time,comm
# RTPRIO列显示实时优先级，"-"表示非实时进程

# 查看特定进程
$ ps -p <PID> -o pid,ni,rtprio,comm
```

### 2. **设置进程优先级**
```bash
# 启动时设置nice值
$ nice -n 10 ./my_program    # 设置nice值为10
$ nice -10 ./my_program      # 设置nice值为-10（需要权限）

# 修改运行中进程的nice值
$ renice 5 -p <PID>          # 将进程PID的nice值改为5
$ renice -10 1234            # 将进程1234的nice值改为-10

# 设置实时优先级
$ chrt -f 50 ./my_program    # 设置实时优先级为50
$ chrt -r 30 ./my_program    # 设置轮转实时优先级为30
```

---

##  实际代码示例

### 1. **程序中设置优先级**
```c
#include <sys/resource.h>
#include <sched.h>

// 设置nice值
int set_nice_value(int pid, int nice_val) {
    return setpriority(PRIO_PROCESS, pid, nice_val);
}

// 获取nice值
int get_nice_value(int pid) {
    return getpriority(PRIO_PROCESS, pid);
}

// 设置实时优先级
int set_realtime_priority(int pid, int rt_prio) {
    struct sched_param param;
    param.sched_priority = rt_prio;
    return sched_setscheduler(pid, SCHED_FIFO, &param);
}

int main() {
    // 设置自己的nice值为-5（高优先级）
    set_nice_value(0, -5);
    
    // 设置实时优先级
    set_realtime_priority(0, 50);
    
    // 执行任务
    while(1) {
        // 高优先级任务
    }
}
```

### 2. **优先级对调度的影响**
```c
// 示例：不同优先级进程的竞争
void high_priority_process() {
    // nice = -10
    while(1) {
        do_important_work();
        // 由于高优先级，获得更多CPU时间
    }
}

void low_priority_process() {
    // nice = 10
    while(1) {
        do_background_work();
        // 由于低优先级，较少获得CPU时间
    }
}

void normal_process() {
    // nice = 0
    while(1) {
        do_normal_work();
        // 获得中等CPU时间
    }
}
```

---

## 优先级调度的实现

### 1. **完全公平调度器(CFS)中的优先级**
```c
// CFS使用虚拟运行时间考虑优先级
struct sched_entity {
    u64 vruntime;        // 虚拟运行时间
    u64 sum_exec_runtime; // 实际运行时间
};

// 虚拟运行时间计算：
// vruntime = 实际运行时间 × 1024 / 进程权重
// 权重根据nice值计算

// Nice值与权重的对应关系：
// nice -20 → 权重 88761
// nice 0   → 权重 1024  
// nice +19 → 权重 15
```

### 2. **优先级继承**
```c
// 处理优先级反转问题
void priority_inheritance() {
    // 当低优先级进程持有高优先级进程需要的资源时
    // 临时提升低优先级进程的优先级
    // 避免高优先级进程被阻塞
}
```

---

##  实际应用场景

### 1. **系统管理**
```bash
# 降低编译任务的优先级（后台运行）
$ nice -n 19 make -j4 &

# 提高关键服务的优先级
$ renice -10 $(pidof critical_service)

# 设置音频播放的实时优先级（避免卡顿）
$ chrt -f 90 vlc
```

### 2. **用户应用**
```c
// 音频播放器需要高优先级
void audio_player() {
    // 设置实时优先级
    struct sched_param param = {.sched_priority = 80};
    sched_setscheduler(0, SCHED_FIFO, &param);
    
    while(1) {
        // 实时音频处理，不能有延迟
        process_audio_frame();
    }
}

// 文件压缩可以低优先级
void file_compressor() {
    // 设置低优先级
    setpriority(PRIO_PROCESS, 0, 15);
    
    while(1) {
        // 后台压缩，可以慢慢运行
        compress_data();
    }
}
```

---

## 注意事项

### 1. **权限要求**
```bash
# 设置负nice值需要root权限
$ sudo nice -n -10 ./program

# 普通用户只能设置正nice值
$ nice -n 10 ./program  # OK
$ nice -n -5 ./program  # Permission denied
```

### 2. **实时优先级的风险**
```c
// 实时进程可能独占CPU，导致系统无响应
void dangerous_realtime_process() {
    // 实时优先级99
    struct sched_param param = {.sched_priority = 99};
    sched_setscheduler(0, SCHED_FIFO, &param);
    
    while(1) {
        // 永远不阻塞的循环
        // 会阻止所有其他进程运行！
    }
}
```

**Linux优先级系统的核心要点**：

1. **两种优先级**：
   - Nice值（-20到+19）：普通进程
   - 实时优先级（1到99）：实时进程

2. **优先级规则**：
   - Nice值：数值越小优先级越高
   - 实时优先级：数值越大优先级越高
   - 实时进程 > 普通进程

3. **使用场景**：
   - 系统关键任务：实时优先级
   - 用户交互应用：高nice优先级
   - 后台任务：低nice优先级

4. **管理工具**：
   - `nice`/`renice`：管理nice值
   - `chrt`：管理实时优先级
   - `ps`：查看优先级信息



##  传统时间片的概念

### 1. **什么是时间片？**
```c
// 时间片是分配给进程的固定CPU时间
// 例如：每个进程运行10ms，然后必须让出CPU

struct traditional_scheduler {
    int time_slice;  // 固定时间片，比如10ms
};

void timer_interrupt_handler() {
    current_process->time_slice--;
    if (current_process->time_slice <= 0) {
        schedule();  // 切换到下一个进程
    }
}
```

### 2. **时间片设置的挑战**
```c
// 时间片太长的问题：
// - 响应时间差（用户输入要等很久才能响应）
// - 交互性差

// 时间片太短的问题：
// - 频繁的上下文切换
// - 系统开销大
// - 缓存局部性差
```



##  CFS 调度器的革命性设计

### 1. **从时间片到比例分配**
```c
// CFS 不使用固定时间片，而是按比例分配CPU时间
// 核心思想：每个进程应该获得公平的CPU时间份额

struct cfs_rq {
    u64 min_vruntime;              // 最小虚拟运行时间
    struct rb_root tasks_timeline; // 红黑树维护进程排序
};

struct sched_entity {
    u64 vruntime;        // 虚拟运行时间
    u64 sum_exec_runtime; // 实际运行时间累计
};
```

### 2. **虚拟运行时间（vruntime）**
```c
// 虚拟运行时间 = 实际运行时间 × 权重系数 / 进程权重
// 权重根据优先级（nice值）计算

// 计算示例：
// 进程A：nice=0，权重=1024
// 进程B：nice=-10，权重=1398
// 进程C：nice=+10，权重=748

// 都运行10ms：
// 进程A的vruntime = 10 × 1024 / 1024 = 10
// 进程B的vruntime = 10 × 1024 / 1398 = 7.3  (高优先级，vruntime增长慢)
// 进程C的vruntime = 10 × 1024 / 748 = 13.7   (低优先级，vruntime增长快)
```

---

##  CFS 的工作原理

### 1. **红黑树维护公平性**
```c
// 使用红黑树按vruntime排序所有可运行进程
// 最左边的节点vruntime最小，最应该运行

void enqueue_entity(struct cfs_rq *cfs_rq, struct sched_entity *se) {
    // 插入红黑树，按vruntime排序
    rb_add(&se->run_node, &cfs_rq->tasks_timeline, entity_less);
}

struct sched_entity *pick_next_entity(struct cfs_rq *cfs_rq) {
    // 选择vruntime最小的进程（最左边节点）
    struct rb_node *left = rb_first(&cfs_rq->tasks_timeline);
    return rb_entry(left, struct sched_entity, run_node);
}
```

### 2. **动态抢占机制**
```c
// 当前进程运行时，其他进程可能变得更"饿"
void check_preempt_tick(struct cfs_rq *cfs_rq, struct sched_entity *curr) {
    struct sched_entity *se = pick_next_entity(cfs_rq);
    
    // 如果有进程比当前进程更饿（vruntime更小）
    if (entity_before(se, curr)) {
        // 触发抢占
        resched_curr(rq_of(cfs_rq));
    }
}
```

---

##  CFS 的优势

### 1. **动态自适应**
```c
// 不同负载下的表现：

// 系统只有1个进程：
// - 该进程获得100% CPU时间
// - 无需时间片限制

// 系统有10个相同优先级进程：
// - 每个进程获得约10% CPU时间
// - 自动平衡

// 系统有混合优先级进程：
// - 高优先级进程获得更多CPU时间
// - 低优先级进程获得较少CPU时间
// - 但都不会完全饿死
```

### 2. **最小粒度控制**
```c
// 防止过于频繁的切换
unsigned int sysctl_sched_min_granularity = 1000000; // 1ms

// 如果计算出的时间片小于最小粒度
if (target_latency < min_granularity) {
    // 调整为目标延迟
    target_latency = min_granularity;
}
```

---

##  实际示例说明

### 1. **交互式进程 vs 批处理进程**
```c
// 交互式进程（如文本编辑器）
void interactive_process() {
    while(1) {
        process_user_input();  // 运行很快
        wait_for_input();      // 长时间等待
    }
}

// 批处理进程（如视频编码）
void batch_process() {
    while(1) {
        encode_video_frame();  // 长时间运行
        // 很少等待
    }
}

// CFS的处理：
// 交互式进程经常睡眠 → vruntime小 → 优先调度
// 批处理进程持续运行 → vruntime增长快 → 让出CPU
```

### 2. **多进程场景**
```c
// 系统中有3个进程：
// A: nice=0 (普通进程)
// B: nice=-10 (高优先级)
// C: nice=+10 (低优先级)

// 理论CPU时间分配：
// 总权重 = 1024 + 1398 + 748 = 3170
// A获得: 1024/3170 ≈ 32.3%
// B获得: 1398/3170 ≈ 44.1%  
// C获得: 748/3170 ≈ 23.6%
```

---

##  CFS 与传统调度器对比

### 1. **传统O(1)调度器**
```c
// 固定时间片
// - 进程A: 10ms
// - 进程B: 10ms
// - 进程C: 10ms
// 问题：不能体现优先级差异
```

### 2. **CFS调度器**
```c
// 动态比例分配
// - 进程A: 32.3% CPU时间
// - 进程B: 44.1% CPU时间  
// - 进程C: 23.6% CPU时间
// 优势：自然体现优先级差异
```

##  关键技术细节

### 1. **最小抢占粒度**
```c
// 避免过于频繁的抢占
void update_curr(struct cfs_rq *cfs_rq) {
    unsigned long delta_exec;
    
    // 计算实际运行时间
    delta_exec = (unsigned long)(now - curr->exec_start);
    
    // 如果运行时间太短，不立即抢占
    if (delta_exec < sysctl_sched_min_granularity) {
        return;  // 继续运行
    }
    
    // 否则检查是否应该抢占
    check_preempt_tick(cfs_rq, curr);
}
```

### 2. **负载均衡**
```c
// 多处理器间的负载均衡
void load_balance(int this_cpu, struct rq *this_rq) {
    int busiest_cpu = find_busiest_queue();
    struct rq *busiest_rq = cpu_rq(busiest_cpu);
    
    // 迁移进程到负载较轻的CPU
    move_tasks(this_rq, busiest_rq);
}
```

**CFS 调度器的核心创新**：

1. **从时间片到比例分配**：
   - 不再使用固定时间片
   - 按优先级比例分配CPU时间

2. **虚拟运行时间**：
   - 体现进程的"饥饿"程度
   - 高优先级进程vruntime增长慢

3. **红黑树维护公平性**：
   - O(log n)时间复杂度
   - 自动维护进程排序

4. **动态自适应**：
   - 根据系统负载自动调整
   - 无需手动调优时间片

**关键优势**：
- **公平性**：每个进程获得应得的CPU时间
- **响应性**：交互式进程优先响应
- **自适应**：自动适应不同负载场景
- **简洁性**：设计优雅，易于理解和维护



##  Linux 调度器类

### 1. **调度器类的基本概念**
```c
// Linux 采用模块化的调度器设计
// 不同类型的进程使用不同的调度算法

struct sched_class {
    const struct sched_class *next;  // 指向下一个调度器类
    
    // 调度器类的核心函数指针
    void (*enqueue_task)(struct rq *rq, struct task_struct *p, int flags);
    void (*dequeue_task)(struct rq *rq, struct task_struct *p, int flags);
    void (*check_preempt_tick)(struct rq *rq, struct task_struct *p);
    struct task_struct *(*pick_next_task)(struct rq *rq);
    void (*put_prev_task)(struct rq *rq, struct task_struct *p);
};
```

### 2. **调度器类的层次结构**
```c
// Linux 调度器类的优先级顺序（从高到低）：
// 1. stop_sched_class     - 停止类（最高优先级）
// 2. dl_sched_class       - deadline实时类
// 3. rt_sched_class       - 实时类
// 4. fair_sched_class     - 完全公平类（CFS）
// 5. idle_sched_class     - 空闲类（最低优先级）

// 按优先级链接：
stop_sched_class.next = &dl_sched_class;
dl_sched_class.next = &rt_sched_class;
rt_sched_class.next = &fair_sched_class;
fair_sched_class.next = &idle_sched_class;
idle_sched_class.next = NULL;
```

---

##  调度器类的工作原理

### 1. **进程选择的层次化处理**
```c
// 调度器按优先级顺序选择进程
struct task_struct *pick_next_task(struct rq *rq) {
    const struct sched_class *class;
    struct task_struct *p;
    
    // 从最高优先级的调度器类开始检查
    for_each_class(class) {
        p = class->pick_next_task(rq);
        if (p) {
            return p;  // 找到可运行进程，立即返回
        }
    }
    // 如果都没找到，返回空闲进程
    return idle_task(rq);
}
```

### 2. **实际的调度流程**
```c
// 调度流程示例：
void schedule() {
    struct task_struct *next;
    
    // 1. 选择下一个要运行的进程
    next = pick_next_task(rq);
    
    // 2. 如果选择了不同的进程，进行上下文切换
    if (prev != next) {
        context_switch(rq, prev, next);
    }
}
```

---

##  实时调度器类

### 1. **实时调度器类**
```c
// 实时调度器类（SCHED_FIFO, SCHED_RR）
extern const struct sched_class rt_sched_class;

static const struct sched_class rt_sched_class = {
    .next = &fair_sched_class,
    .enqueue_task = enqueue_task_rt,
    .dequeue_task = dequeue_task_rt,
    .check_preempt_tick = check_preempt_tick_rt,
    .pick_next_task = pick_next_task_rt,
};
```

### 2. **实时进程的优先级处理**
```c
// 实时进程的选择逻辑
static struct task_struct *pick_next_task_rt(struct rq *rq) {
    struct task_struct *p;
    struct rt_rq *rt_rq = &rq->rt;
    
    // 如果有实时进程在运行
    if (!rt_rq->rt_nr_running)
        return NULL;
    
    // 选择最高实时优先级的进程
    p = pick_next_highest_task_rt(rt_rq);
    return p;
}
```

---

##  进程调度类的实际应用

### 1. **进程创建时的调度类分配**
```c
// 根据进程类型分配调度器类
void set_task_policy(struct task_struct *p, int policy) {
    switch (policy) {
        case SCHED_FIFO:
        case SCHED_RR:
            p->sched_class = &rt_sched_class;  // 实时调度类
            break;
        case SCHED_NORMAL:
            p->sched_class = &fair_sched_class; // CFS调度类
            break;
        case SCHED_IDLE:
            p->sched_class = &idle_sched_class; // 空闲调度类
            break;
        default:
            p->sched_class = &fair_sched_class; // 默认CFS
    }
}
```

### 2. **系统调用设置调度策略**
```c
// 用户空间设置调度策略
#include <sched.h>

int main() {
    struct sched_param param;
    
    // 设置实时调度策略
    param.sched_priority = 50;
    sched_setscheduler(0, SCHED_FIFO, &param);
    // 进程的sched_class变为&rt_sched_class
    
    // 设置普通调度策略
    param.sched_priority = 0;
    sched_setscheduler(0, SCHED_NORMAL, &param);
    // 进程的sched_class变为&fair_sched_class
    
    return 0;
}
```

---

## 调度器类的优势

### 1. **模块化设计的好处**
```c
// ✅ 优势：
// - 可扩展性强：可以添加新的调度器类
// - 维护性好：各调度器类独立实现
// - 灵活性高：不同类型进程使用不同算法
// - 兼容性好：支持多种调度策略

// 🔧 扩展示例：
// 可以添加新的调度器类：
// - deadline_sched_class（截止时间调度）
// - batch_sched_class（批处理调度）
// - ...
```

### 2. **性能优化**
```c
// 通过调度器类实现性能优化：
// 1. 实时进程优先调度（保证响应性）
// 2. 普通进程公平调度（保证公平性）
// 3. 空闲进程最后调度（保证系统稳定）
```

---

##  内核实现细节

### 1. **相关文件结构**
```bash
# Linux 调度器相关文件：
kernel/sched/
├── core.c          # 调度器核心代码
├── fair.c          # CFS 调度器实现
├── rt.c            # 实时调度器实现
├── deadline.c      # deadline调度器实现
├── idle.c          # 空闲调度器实现
└── sched.h         # 调度器头文件
```

### 2. **数据结构关系**
```c
// 进程与调度器类的关系：
struct task_struct {
    const struct sched_class *sched_class;  // 指向调度器类
    struct sched_entity se;                 // 调度实体
    struct sched_rt_entity rt;              // 实时调度实体
    // ...
};

// 运行队列包含各类调度器的运行队列：
struct rq {
    struct cfs_rq cfs;    // CFS运行队列
    struct rt_rq rt;      // 实时运行队列
    struct dl_rq dl;      // deadline运行队列
    // ...
};
```

**Linux 调度器类的核心特点**：

1. **模块化架构**：
   - 不同类型进程使用不同调度算法
   - 调度器类可以动态添加和替换
2. **层次化优先级**：
   - stop > deadline > realtime > fair > idle
   - 高优先级调度器类优先选择进程
3. **CFS 作为默认调度器**：
   - 处理普通进程（SCHED_NORMAL）
   - 实现完全公平的CPU时间分配
4. **灵活的策略支持**：
   - 实时调度（SCHED_FIFO, SCHED_RR）
   - 普通调度（SCHED_NORMAL）
   - 空闲调度（SCHED_IDLE）



## 上下文切换

### 1. **什么是上下文切换？**
```c
// 上下文切换：保存当前进程的状态，恢复下一个进程的状态

// 进程A运行 → 进程B运行 的过程：
// 1. 保存进程A的所有状态
// 2. 恢复进程B的所有状态
// 3. 开始执行进程B

struct process_context {
    struct cpu_context cpu_state;    // CPU寄存器状态
    struct mm_struct *memory_map;    // 内存映射
    struct task_struct *task_info;   // 进程控制信息
};
```

### 2. **为什么需要上下文切换？**
```c
// 多任务操作系统的核心需求：
void multitasking_requirement() {
    // 用户同时运行多个程序：
    // - 文本编辑器
    // - 浏览器
    // - 音乐播放器
    
    // 操作系统需要：
    // - 在这些程序间快速切换
    // - 让用户感觉所有程序都在同时运行
    // - 合理分配CPU时间
}
```

---

##  上下文切换的完整流程

### 1. **调度器选择新进程**
```c
// 调度流程：
void schedule() {
    struct task_struct *prev = current;  // 当前进程
    struct task_struct *next;            // 下一个进程
    
    // 1. 选择下一个要运行的进程
    next = pick_next_task(rq);
    
    // 2. 如果选择了不同进程，进行上下文切换
    if (prev != next) {
        context_switch(rq, prev, next);  // 关键函数！
    }
}
```

### 2. **context_switch() 函数详解**
```c
// kernel/sched.c 中的核心函数
static inline void context_switch(struct rq *rq, 
                                struct task_struct *prev,
                                struct task_struct *next) {
    struct mm_struct *mm, *oldmm;
    
    // 1. 切换内存管理上下文
    switch_mm(prev, next);
    
    // 2. 切换处理器状态
    switch_to(prev, next, prev);
    
    // 3. 更新进程信息
    barrier();
}
```

---

## 内存管理上下文切换

### 1. **switch_mm() 函数**
```c
// <asm/mmu_context.h> 中的函数
void switch_mm(struct task_struct *prev, struct task_struct *next) {
    struct mm_struct *mm = next->mm;
    
    // 如果是内核线程，不需要切换内存映射
    if (unlikely(!mm)) {
        next->active_mm = prev->active_mm;
        atomic_inc(&prev->active_mm->mm_count);
        enter_lazy_tlb(prev->active_mm, next);
    } else {
        // 切换到新进程的内存映射
        switch_mm_irqs_off(prev->active_mm, mm);
        
        // 更新活跃内存映射
        next->active_mm = mm;
    }
}
```

### 2. **内存映射切换的细节**
```c
// 虚拟内存映射切换涉及的内容：
struct mm_struct {
    pgd_t *pgd;                    // 页全局目录
    atomic_t mm_users;             // 用户计数
    atomic_t mm_count;             // 引用计数
    int map_count;                 // 内存区域数量
    struct vm_area_struct *mmap;   // 虚拟内存区域链表
};

void memory_mapping_switch_details() {
    // 1. 切换页表
    // 2. 切换TLB（Translation Lookaside Buffer）
    // 3. 更新内存保护机制
    // 4. 处理共享内存区域
}
```

---

## 处理器状态切换

### 1. **switch_to() 函数**
```c
// <asm/system.h> 中的体系结构相关函数
// 以x86为例：

#define switch_to(prev, next, last)                    \
do {                                                   \
    /* 保存当前进程的寄存器状态 */                     \
    pushl %ebp;                                       \
    pushl %esi;                                       \
    pushl %edi;                                       \
                                                      \
    /* 保存当前栈指针到prev->thread.sp */             \
    movl %esp, PCB(prev)->thread.sp;                  \
                                                      \
    /* 从next->thread.sp恢复栈指针 */                 \
    movl PCB(next)->thread.sp, %esp;                  \
                                                      \
    /* 恢复新进程的寄存器状态 */                       \
    popl %edi;                                        \
    popl %esi;                                        \
    popl %ebp;                                        \
                                                      \
    /* 跳转到新进程的执行点 */                         \
    jmp *PCB(next)->thread.ip;                        \
} while (0)
```

### 2. **需要保存的处理器状态**
```c
// 进程控制块中保存的CPU状态：
struct thread_struct {
    unsigned long esp0;        // 内核栈指针
    unsigned long esp;         // 用户栈指针
    unsigned long eip;         // 指令指针
    unsigned long eflags;      // 标志寄存器
    unsigned long eax, ebx, ecx, edx;  // 通用寄存器
    unsigned long esi, edi, ebp;       // 索引寄存器
    unsigned long cs, ds, es, fs, gs;  // 段寄存器
    unsigned long cr2, trap_no, error_code;  // 异常信息
};

void cpu_state_preservation() {
    // 保存的内容：
    // 1. 所有通用寄存器
    // 2. 程序计数器（EIP/RIP）
    // 3. 栈指针（ESP/RSP）
    // 4. 标志寄存器
    // 5. 段寄存器
    // 6. 浮点寄存器状态
    // 7. SIMD寄存器状态
}
```

---





## 抢占机制

### 1. **什么是抢占？**
```c
// 抢占：强制中断当前进程，切换到更高优先级进程

void preemptive_scheduling() {
    // 场景：高优先级进程变为可运行状态
    
    // 低优先级进程正在运行：
    while(1) {
        do_background_work();  // 运行中...
        
        // 高优先级进程唤醒（比如用户按键）
        // 系统检测到需要抢占
        if (need_resched()) {
            schedule();  // 立即切换
        }
    }
}
```

### 2. **抢占的触发条件**
```c
// 抢占触发的常见情况：

// 1. 时钟中断
void timer_interrupt_handler() {
    update_process_times();
    if (current->need_resched) {
        preempt_schedule();  // 可能触发抢占
    }
}

// 2. 进程唤醒
void wake_up_process(struct task_struct *p) {
    try_to_wake_up(p);
    if (p->prio < current->prio) {
        // 更高优先级进程唤醒
        preempt_schedule();  // 触发抢占
    }
}

// 3. 系统调用返回
void syscall_return() {
    if (need_resched()) {
        schedule();  // 检查是否需要调度
    }
}
```

---

## 上下文切换的性能影响

### 1. **切换开销分析**
```c
// 上下文切换的典型开销（x86_64）：
void context_switch_cost() {
    // 1. 保存CPU状态：~1000 cycles
    // 2. 切换内存映射：~2000 cycles  
    // 3. 恢复CPU状态：~1000 cycles
    // 4. TLB刷新：~5000 cycles（如果需要）
    // 总计：~9000 cycles ≈ 3-5 microseconds
    
    // 频繁切换的影响：
    // - CPU时间浪费在切换上
    // - 缓存局部性破坏
    // - TLB命中率下降
}
```

### 2. **优化策略**
```c
// 减少上下文切换开销的策略：

// 1. 延迟切换
void lazy_switching() {
    // 如果进程使用相同地址空间，不切换MMU
    if (prev->mm == next->mm) {
        // 跳过switch_mm()
    }
}

// 2. TLB优化
void tlb_optimization() {
    // 使用PCID（Process Context ID）减少TLB刷新
    // 在支持的CPU上启用
}

// 3. 缓存友好的调度
void cache_friendly_scheduling() {
    // 尽量让同一CPU上的进程继续运行
    // 减少缓存失效
}
```

---

## 实际代码示例

### 1. **完整的上下文切换过程**
```c
// 简化的上下文切换实现：
void simplified_context_switch(struct task_struct *prev, 
                              struct task_struct *next) {
    // 1. 保存当前进程状态
    save_processor_state(prev);
    
    // 2. 切换内存映射
    if (prev->mm != next->mm) {
        switch_mm(prev->mm, next->mm);
    }
    
    // 3. 切换处理器状态
    switch_cpu_state(prev, next);
    
    // 4. 更新当前进程指针
    current = next;
    
    // 5. 恢复新进程状态
    restore_processor_state(next);
}
```

### 2. **抢占检查**
```c
// 抢占检查的实现：
void check_preemption() {
    // 检查是否需要重新调度
    if (current->need_resched) {
        // 清除抢占标志
        clear_thread_flag(TIF_NEED_RESCHED);
        
        // 执行调度
        schedule()
    }
}
```

**上下文切换的核心要点**：

1. **两个主要任务**：
   - **switch_mm()**：切换内存管理上下文
   - **switch_to()**：切换处理器状态

2. **保存的内容**：
   - 所有CPU寄存器状态
   - 内存映射信息
   - 栈指针和程序计数器

3. **触发时机**：
   - 时间片用完
   - 更高优先级进程唤醒
   - 系统调用返回
   - I/O操作完成

4. **性能考虑**：
   - 切换开销约3-5微秒
   - 频繁切换影响系统性能
   - 需要各种优化策略

![3](/blog/articles/images/3.png)



##  need_resched 标志的作用

### 1. **为什么需要 need_resched 标志？**
```c
// 问题：如果没有内核干预，用户进程可能永远不主动调度
void problematic_process() {
    while(1) {
        // 用户程序可能永远不调用schedule()
        do_infinite_work();
        // 永远不主动让出CPU
    }
}

// 解决方案：内核强制调度机制
void kernel_solution() {
    // 内核设置need_resched标志
    set_tsk_need_resched(current);
    
    // 在适当时机检查并执行调度
    if (need_resched()) {
        schedule();
    }
}
```

### 2. **need_resched 标志的核心作用**
```c
// need_resched标志告诉内核：
// "当前进程应该尽快让出CPU，有其他进程需要运行"

struct task_struct {
    // 在thread_info中（2.6+内核）
    struct thread_info *thread_info;
    // ...
};

struct thread_info {
    unsigned long flags;  // 包含TIF_NEED_RESCHED标志位
    // ...
};
```

---

## need_resched 标志的设置时机

### 1. **时钟中断触发**
```c
// 时钟中断处理程序
void timer_interrupt_handler() {
    // 1. 更新进程时间统计
    update_process_times();
    
    // 2. 调度器时钟滴答
    scheduler_tick();
    
    // 3. 检查是否需要重新调度
    if (need_resched()) {
        preempt_schedule();  // 执行调度
    }
}

// scheduler_tick() 函数
void scheduler_tick() {
    struct task_struct *p = current;
    
    // 更新进程的时间片
    update_process_times(p);
    
    // 如果时间片用完
    if (p->time_slice <= 0) {
        // 设置需要重新调度标志
        set_tsk_need_resched(p);
        
        // 重新计算时间片
        p->time_slice = calculate_new_time_slice(p);
    }
}
```

### 2. **高优先级进程唤醒**
```c
// 进程唤醒时的检查
void try_to_wake_up(struct task_struct *p) {
    // 唤醒进程的正常流程
    activate_task(p);
    
    // 检查是否需要抢占当前进程
    if (p->prio < current->prio) {
        // 唤醒的进程优先级更高
        if (current->policy != SCHED_FIFO) {
            // 设置当前进程需要重新调度
            set_tsk_need_resched(current);
        }
    }
}
```

### 3. **系统调用返回用户空间**
```c
// 系统调用返回时的检查
void syscall_exit_to_user() {
    // 检查是否需要重新调度
    if (need_resched()) {
        schedule();
    }
    
    // 返回用户空间
    return_to_user_space();
}
```

---

##  need_resched 相关函数详解

### 1. **设置标志**
```c
// 设置指定进程的need_resched标志
void set_tsk_need_resched(struct task_struct *tsk) {
    // 在thread_info的flags中设置TIF_NEED_RESCHED位
    set_ti_thread_flag(task_thread_info(tsk), TIF_NEED_RESCHED);
}

// 内部实现（简化版）
static inline void set_ti_thread_flag(struct thread_info *ti, int flag) {
    set_bit(flag, &ti->flags);
}
```

### 2. **清除标志**
```c
// 清除指定进程的need_resched标志
void clear_tsk_need_resched(struct task_struct *tsk) {
    // 在thread_info的flags中清除TIF_NEED_RESCHED位
    clear_ti_thread_flag(task_thread_info(tsk), TIF_NEED_RESCHED);
}

// 内部实现（简化版）
static inline void clear_ti_thread_flag(struct thread_info *ti, int flag) {
    clear_bit(flag, &ti->flags);
}
```

### 3. **检查标志**
```c
// 检查need_resched标志
int need_resched(void) {
    // 检查当前进程的thread_info中是否设置了TIF_NEED_RESCHED
    return test_thread_flag(TIF_NEED_RESCHED);
}

// 内部实现
static inline int test_thread_flag(int flag) {
    struct thread_info *ti = current_thread_info();
    return test_bit(flag, &ti->flags);
}
```

---

## 数据结构演进

### 1. **历史演进过程**
```c
// 2.2版本以前：全局变量
static int need_resched_flag;  // 全局变量，访问慢

// 2.2-2.4版本：task_struct成员
struct task_struct {
    int need_resched;  // 每个进程一个标志
};

// 2.6+版本：thread_info中的标志位
struct thread_info {
    unsigned long flags;  // 包含多个标志位
    // TIF_NEED_RESCHED是其中一位
};
```

### 2. **为什么移到thread_info？**
```c
// 性能优化考虑：

// 1. 快速访问current宏
#define current (current_thread_info()->task)

// 2. thread_info通常在CPU缓存中
struct thread_info *current_thread_info(void) {
    // x86架构实现：
    return (struct thread_info *)(current_stack_pointer & ~(THREAD_SIZE - 1));
}

// 3. 位操作比整数操作更高效
// 4. 减少内存占用（多个标志位共享一个long变量）
```

---

##  实际调度触发场景

### 1. **中断返回时的调度**
```c
// 中断处理完成后的检查
void irq_exit() {
    // 检查是否需要调度
    if (need_resched()) {
        preempt_schedule_irq();
    }
}

// 用户空间返回时的检查
void exit_to_usermode_loop() {
    while (need_resched()) {
        preempt_schedule();
    }
}
```

### 2. **抢占式调度**
```c
// 抢占式调度的实现
void preempt_schedule() {
    // 禁用抢占
    preempt_disable();
    
    // 检查是否真的需要调度
    if (need_resched()) {
        schedule();
    }
    
    // 重新启用抢占
    preempt_enable();
}
```

---

##  实际应用示例

### 1. **长时间运行的内核函数**
```c
// 内核中可能长时间运行的函数
void long_running_kernel_function() {
    for (int i = 0; i < 1000000; i++) {
        do_some_work();
        
        // 定期检查是否需要调度
        if (i % 1000 == 0) {
            if (need_resched()) {
                schedule();
            }
        }
    }
}
```

### 2. **驱动程序中的应用**
```c
// 设备驱动中的长时间操作
void device_driver_work() {
    // 开始长时间操作
    while (device_busy()) {
        wait_for_device();
        
        // 检查是否需要调度
        if (need_resched()) {
            schedule();
        }
    }
}
```

**need_resched 标志的核心要点**：

1. **三个主要设置时机**：
   - **时钟中断**：时间片用完
   - **进程唤醒**：高优先级进程唤醒
   - **系统调用返回**：返回用户空间前

2. **三个核心函数**：
   - `set_tsk_need_resched()`：设置标志
   - `clear_tsk_need_resched()`：清除标志
   - `need_resched()`：检查标志

3. **数据结构演进**：
   - 全局变量 → task_struct成员 → thread_info标志位
   - 目的是提高访问速度和减少内存占用

4. **检查时机**：
   - 中断返回时
   - 系统调用返回时
   - 用户空间入口







## 用户抢占（User Preemption）

### 1. **用户抢占的触发条件**
```c
// 用户抢占发生的两个时机：

void user_preemption_scenarios() {
    // 场景1：系统调用返回用户空间
    syscall_handler() {
        // 执行系统调用
        do_syscall_work();
        
        // 返回用户空间前检查
        if (need_resched()) {
            schedule();  // 发生用户抢占
        }
        return_to_user_space();
    }
    
    // 场景2：中断处理程序返回用户空间
    interrupt_handler() {
        // 处理中断
        handle_interrupt();
        
        // 返回用户空间前检查
        if (need_resched()) {
            schedule();  // 发生用户抢占
        }
        return_to_user_space();
    }
}
```

### 2. **用户抢占的工作流程**
```c
// 简化的用户抢占流程：
void user_preemption_flow() {
    // 1. 内核检测到需要调度
    if (need_resched()) {
        // 2. 保存当前进程状态
        save_current_process_state();
        
        // 3. 选择下一个进程
        struct task_struct *next = pick_next_task();
        
        // 4. 执行上下文切换
        context_switch(current, next);
        
        // 5. 恢复新进程并返回用户空间
        restore_next_process_state();
    }
}
```

---

##  内核抢占（Kernel Preemption）

### 1. **内核抢占的核心概念**
```c
// 传统内核 vs 支持抢占的内核：

// 传统内核（不可抢占）：
void traditional_kernel() {
    acquire_lock();  // 获取锁
    while(1) {
        do_critical_work();  // 长时间运行
        // 无法被抢占！
    }
    release_lock();
}

// 现代Linux内核（可抢占）：
void preemptible_kernel() {
    preempt_disable();  // 禁用抢占
    acquire_lock();
    
    do_critical_work();  // 关键区域
    
    release_lock();
    preempt_enable();   // 重新启用抢占
    
    // 在这里可能发生抢占
    do_other_work();    // 可被抢占的区域
}
```

### 2. **preempt_count 计数器**
```c
// preempt_count 的作用：跟踪抢占禁用的嵌套层级

struct thread_info {
    unsigned long flags;        // 包含TIF_NEED_RESCHED等标志
    int preempt_count;          // 抢占计数器
    // ...
};

// 抢占计数器的使用：
void preempt_count_mechanism() {
    // 初始值：0（可抢占）
    preempt_count() == 0;  // 可以被抢占
    
    // 禁用抢占：
    preempt_disable();     // preempt_count = 1
    acquire_lock();        // preempt_count = 2 (假设)
    
    // 此时即使need_resched被设置，也不会抢占
    if (need_resched() && preempt_count() == 0) {
        schedule();  // 不会执行到这里
    }
    
    // 释放锁：
    release_lock();        // preempt_count = 1
    preempt_enable();      // preempt_count = 0
    
    // 现在可以被抢占了
    if (need_resched() && preempt_count() == 0) {
        schedule();  // 可能会执行到这里
    }
}
```

---

##  抢占安全性检查

### 1. **抢占安全的判断条件**
```c
// 抢占安全的两个条件：
// 1. need_resched 标志被设置
// 2. preempt_count 计数器为 0

void preemption_safety_check() {
    // 检查是否可以抢占
    if (need_resched()) {
        if (preempt_count() == 0) {
            // 安全：可以抢占
            schedule();
        } else {
            // 不安全：持有锁，不能抢占
            // 标记需要调度，稍后处理
            set_pending_reschedule();
        }
    }
}
```

### 2. **锁机制与抢占**
```c
// 各种锁对抢占的影响：

// 1. 自旋锁
void spinlock_example() {
    spin_lock(&my_lock);        // preempt_count++
    // 临界区：不可抢占
    critical_section_work();
    spin_unlock(&my_lock);      // preempt_count--
    // 现在可以被抢占
}

// 2. 互斥锁
void mutex_example() {
    mutex_lock(&my_mutex);      // 可能睡眠，抢占被禁用
    // 临界区：不可抢占
    critical_work();
    mutex_unlock(&my_mutex);    // 恢复抢占
    // 可能在这里发生抢占
}

// 3. 禁用抢占
void preempt_control_example() {
    preempt_disable();          // preempt_count++
    // 不可抢占区域
    non_preemptible_work();
    preempt_enable();           // preempt_count--
    // 可以被抢占
}
```

---

##  内核抢占的触发时机

### 1. **中断处理程序结束时**
```c
// 中断处理程序的抢占检查：
void irq_handler_exit() {
    // 中断处理完成
    handle_irq();
    
    // 检查是否可以抢占
    if (need_resched()) {
        if (preempt_count() == 0) {
            preempt_schedule_irq();  // 中断上下文中的调度
        }
    }
}

// 中断上下文调度的特殊处理：
void preempt_schedule_irq() {
    // 确保在中断上下文中
    BUG_ON(!in_interrupt());
    
    // 保存中断上下文
    save_irq_context();
    
    // 执行调度
    schedule();
    
    // 恢复中断上下文
    restore_irq_context();
}
```

### 2. **显式调度调用**
```c
// 内核代码中的显式调度：
void kernel_function_with_schedule() {
    // 执行一些工作
    do_work();
    
    // 显式检查是否可以安全调度
    if (preemptible()) {  // preempt_count() == 0
        cond_resched();   // 有条件地调度
    }
    
    // 或者直接调度
    schedule();  // 需要确保是安全的
}
```

##  抢占机制的实现细节

### 1. **preempt_count 的管理**
```c
// preempt_count 的操作函数：

// 禁用抢占
#define preempt_disable() \
do { \
    inc_preempt_count(); \
    barrier(); \
} while (0)

// 启用抢占
#define preempt_enable() \
do { \
    barrier(); \
    dec_preempt_count(); \
    preempt_check_resched(); \
} while (0)

// 检查抢占
static inline void preempt_check_resched(void) {
    if (unlikely(test_thread_flag(TIF_NEED_RESCHED))) {
        preempt_schedule();  // 执行调度
    }
}
```

### 2. **抢占计数器的嵌套**
```c
// 抢占计数器支持嵌套：

void nested_preemption_control() {
    preempt_disable();          // preempt_count = 1
    printk("Level 1\n");
    
    preempt_disable();          // preempt_count = 2
    printk("Level 2\n");
    
    // 这里不能被抢占
    critical_work();
    
    preempt_enable();           // preempt_count = 1
    printk("Back to Level 1\n");
    
    preempt_enable();           // preempt_count = 0
    printk("Preemption enabled\n");
    
    // 现在可以被抢占了
}
```

---

##  实际应用示例

### 1. **内核模块中的抢占控制**
```c
// 内核模块中正确使用抢占控制：
static void my_kernel_module_function(void) {
    // 需要保证原子性的操作
    preempt_disable();
    
    atomic_operation();
    update_shared_data();
    
    preempt_enable();  // 可能在这里发生抢占
    
    // 不需要原子性的操作
    regular_work();
}
```

### 2. **驱动程序中的抢占处理**
```c
// 设备驱动中的抢占处理：
static irqreturn_t my_device_interrupt(int irq, void *dev_id) {
    struct my_device *dev = dev_id;
    
    // 中断处理
    handle_device_interrupt(dev);
    
    // 中断返回前可能触发抢占
    return IRQ_HANDLED;
}

static int my_device_read(struct file *file, char __user *buf, size_t count, loff_t *ppos) {
    // 系统调用中可能被抢占
    if (need_resched()) {
        cond_resched();  // 有条件地让出CPU
    }
    
    return do_actual_read(buf, count);
}
```

## 

**用户抢占 vs 内核抢占**：

### **用户抢占**：
- **触发时机**：系统调用返回、中断返回用户空间时
- **检查点**：固定的返回路径
- **安全性**：总是安全的（用户空间可以被抢占）

### **内核抢占**：
- **触发时机**：任何安全的内核代码点
- **检查点**：中断返回、显式调度调用
- **安全性**：通过 `preempt_count` 确保安全

**关键机制**：

1. **need_resched 标志**：表示需要调度
2. **preempt_count 计数器**：确保抢占安全
3. **锁机制**：自动禁用抢占
4. **显式控制**：`preempt_disable()/preempt_enable()`



## 🎯 Linux 实时调度策略

### 1. **三种调度策略**
```c
// Linux 提供的三种调度策略：

enum {
    SCHED_NORMAL = 0,    // 普通调度（CFS）
    SCHED_FIFO   = 1,    // 实时先入先出调度
    SCHED_RR     = 2,    // 实时轮转调度
    SCHED_BATCH  = 3,    // 批处理调度
    SCHED_IDLE   = 5     // 空闲调度
};

// 实时调度策略：SCHED_FIFO 和 SCHED_RR
// 普通调度策略：SCHED_NORMAL
```

### 2. **调度器类框架**
```c
// 实时调度器类：
extern const struct sched_class rt_sched_class;

// 调度器类优先级顺序：
// stop_sched_class > dl_sched_class > rt_sched_class > fair_sched_class > idle_sched_class

// 实现实时调度的核心文件：
// kernel/sched_rt.c
```

---

## SCHED_FIFO 调度策略

### 1. **FIFO 调度的特点**
```c
// SCHED_FIFO：先入先出调度

struct fifo_process {
    int rt_priority;    // 实时优先级 (0-99)
    // 没有时间片概念
};

void sched_fifo_behavior() {
    // SCHED_FIFO 进程的特点：
    // 1. 没有时间片限制
    // 2. 除非主动让出CPU，否则一直运行
    // 3. 只有更高优先级的实时进程才能抢占
    // 4. 相同优先级的进程不会自动切换
}
```

### 2. **FIFO 调度的工作流程**
```c
// SCHED_FIFO 调度示例：

void fifo_scheduling_example() {
    // 进程A: SCHED_FIFO, 优先级50
    // 进程B: SCHED_FIFO, 优先级50
    // 进程C: SCHED_FIFO, 优先级60
    // 进程D: SCHED_NORMAL
    
    // 调度顺序：
    // 1. 进程C运行（优先级最高）
    // 2. 进程C主动让出CPU或被更高优先级抢占
    // 3. 进程A和B按到达顺序运行（相同优先级）
    // 4. SCHED_NORMAL进程最后运行
}

// FIFO 进程的运行方式：
void fifo_process_run() {
    while(1) {
        do_realtime_work();
        
        // 可能的让出CPU方式：
        if (need_to_yield()) {
            sched_yield();  // 主动让出CPU
        }
        
        // 或者等待事件：
        wait_for_event();
        
        // 或者被更高优先级进程抢占
    }
}
```

---

##  SCHED_RR 调度策略

### 1. **RR 调度的特点**
```c
// SCHED_RR：轮转调度（带时间片的FIFO）

struct rr_process {
    int rt_priority;    // 实时优先级 (0-99)
    int time_slice;     // 时间片（通常100ms）
};

void sched_rr_behavior() {
    // SCHED_RR 进程的特点：
    // 1. 有时间片限制
    // 2. 时间片用完后切换到同优先级的其他进程
    // 3. 相同优先级的进程轮流执行
    // 4. 只有更高优先级的实时进程才能抢占
}
```

### 2. **RR 调度的工作流程**
```c
// SCHED_RR 调度示例：

void rr_scheduling_example() {
    // 进程A: SCHED_RR, 优先级50, 时间片100ms
    // 进程B: SCHED_RR, 优先级50, 时间片100ms
    // 进程C: SCHED_RR, 优先级60, 时间片100ms
    
    // 调度顺序：
    // 1. 进程C运行100ms
    // 2. 进程C被抢占或时间片用完
    // 3. 进程A运行100ms
    // 4. 进程A时间片用完，切换到进程B
    // 5. 进程B运行100ms
    // 6. 继续轮转...
}

// RR 进程的时间片管理：
void rr_time_slice_management() {
    struct task_struct *p = current;
    
    if (p->policy == SCHED_RR) {
        p->time_slice--;
        
        if (p->time_slice <= 0) {
            // 时间片用完，重新调度
            requeue_task_rt(p);
            p->time_slice = TIMESLICE;  // 重置时间片
            schedule();
        }
    }
}
```

---

## 实时调度的优先级系统

### 1. **优先级范围**
```c
// 实时优先级范围：
#define MAX_RT_PRIO     100
#define MAX_PRIO        140

// 实时优先级：0-99
// 普通优先级：100-139 (对应nice值-20到+19)

void priority_mapping() {
    // 实时优先级 0-99：最高优先级
    // 普通优先级 100-139：较低优先级
    
    // nice值到实时优先级的映射：
    // nice -20 → 优先级 100
    // nice -10 → 优先级 110
    // nice   0 → 优先级 120
    // nice +19 → 优先级 139
}
```

### 2. **优先级比较**
```c
// 优先级比较函数：
static inline int task_priority(struct task_struct *p) {
    if (p->policy == SCHED_FIFO || p->policy == SCHED_RR) {
        return p->rt_priority;          // 0-99，数值越小优先级越高
    } else {
        return p->prio;                 // 100-139，数值越小优先级越高
    }
}

void priority_comparison() {
    // 优先级比较：
    // SCHED_FIFO (rt_priority=10) > SCHED_RR (rt_priority=20)
    // SCHED_FIFO (rt_priority=50) > SCHED_NORMAL (prio=120)
    // SCHED_RR (rt_priority=99) > SCHED_NORMAL (prio=139)
}
```

---

##  实时调度的实现细节

### 1. **实时运行队列**
```c
// 实时调度器的运行队列：
struct rt_rq {
    struct rt_prio_array active;    // 活跃进程数组
    unsigned long rt_nr_running;    // 运行中的实时进程数
    int highest_prio;               // 最高优先级
};

// 按优先级组织的进程数组：
struct rt_prio_array {
    unsigned long bitmap[RT_MAX_PRIO];  // 位图
    struct list_head queue[RT_MAX_PRIO]; // 每个优先级的队列
};
```

### 2. **进程选择算法**
```c
// 实时调度器选择进程：
static struct task_struct *pick_next_task_rt(struct rq *rq) {
    struct rt_rq *rt_rq = &rq->rt;
    struct task_struct *p;
    int idx;
    
    // 找到最高优先级的可运行进程
    idx = sched_find_first_bit(rt_rq->active.bitmap);
    
    if (idx < MAX_RT_PRIO) {
        // 从对应优先级队列中选择进程
        p = list_first_entry(&rt_rq->active.queue[idx], 
                           struct task_struct, run_list);
        return p;
    }
    
    return NULL;
}
```



##  软实时 vs 硬实时

### 1. **软实时特性**
```c
// Linux 的软实时特性：

void soft_realtime_characteristics() {
    // 软实时的含义：
    // - 内核尽力保证实时任务按时执行
    // - 不保证严格的时限要求
    // - 适合大多数实时应用
    
    // 优势：
    // - 响应时间短
    // - 可预测性好
    // - 与普通任务共存
    
    // 局限：
    // - 不能保证硬实时要求
    // - 可能被系统负载影响
}
```

### 2. **硬实时的挑战**
```c
// 硬实时的要求：
void hard_realtime_requirements() {
    // 硬实时系统必须：
    // - 保证确定的最大响应时间
    // - 100%的可靠性
    // - 不允许任何超时
    
    // Linux 的挑战：
    // - 内存管理的不确定性
    // - 中断处理的延迟
    // - 锁竞争
    // - 垃圾回收等系统活动
}
```

---

##  实际应用示例

### 1. **设置实时调度策略**
```c
// 用户空间设置实时调度：

#include <sched.h>
#include <sys/resource.h>

void set_realtime_scheduling() {
    struct sched_param param;
    int policy;
    
    // 设置 SCHED_FIFO 策略
    policy = SCHED_FIFO;
    param.sched_priority = 50;  // 实时优先级
    
    if (sched_setscheduler(0, policy, &param) == -1) {
        perror("sched_setscheduler");
    }
    
    // 设置进程为实时进程
    if (mlockall(MCL_CURRENT | MCL_FUTURE) == -1) {
        perror("mlockall");
    }
}

void realtime_process_example() {
    set_realtime_scheduling();
    
    while(1) {
        // 实时任务
        do_critical_work();
        
        // 定期让出CPU给同优先级进程
        if (should_yield()) {
            sched_yield();
        }
    }
}
```

### 2. **实时进程的抢占行为**
```c
// 实时进程抢占示例：

void realtime_preemption_example() {
    // 场景：普通进程正在运行
    normal_process_running();
    
    // 高优先级实时进程变为可运行
    wake_up_realtime_process(priority_10);
    
    // 调度器立即切换到实时进程
    // 普通进程被抢占
    
    // 实时进程运行直到：
    // 1. 主动让出CPU
    // 2. 被更高优先级进程抢占
    // 3. 时间片用完（RR策略）
}
```

**Linux 实时调度的核心要点**：

### **两种实时策略**：
1. **SCHED_FIFO**：
   - 无时间片限制
   - 除非主动让出，否则一直运行
   - 相同优先级进程不会自动切换

2. **SCHED_RR**：
   - 有时间片限制（通常100ms）
   - 时间片用完后同优先级进程轮转
   - 相同优先级进程公平调度

### **优先级系统**：
- **实时优先级**：0-99（数值越小优先级越高）
- **普通优先级**：100-139（对应nice值-20到+19）
- **抢占规则**：高优先级抢占低优先级

### **软实时特性**：
- **尽力而为**：内核尽力保证实时性
- **不保证硬实时**：不能保证严格的时限
- **适合场景**：多媒体、游戏、工业控制等

### **使用注意事项**：
```c
// 实时进程使用建议：
void realtime_best_practices() {
    // 1. 设置适当的优先级（不要过高）
    // 2. 定期让出CPU
    // 3. 锁定内存避免页错误
    // 4. 避免系统调用
    // 5. 处理中断时要快速
}
```

**关键认识**：
Linux 的实时调度策略为需要确定性响应时间的应用提供了强大的支持，虽然不是硬实时系统，但在大多数实时应用场景中都能满足需求！
