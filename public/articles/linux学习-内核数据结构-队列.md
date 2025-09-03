

## 队列

### 1. **队列的基本概念**
```c
// 队列是一种先进先出（FIFO - First In First Out）的数据结构

void queue_concept() {
    // 特点：
    // - 先进入的元素先被处理
    // - 类似于现实中的排队
    // - 一端插入（队尾），一端删除（队头）
    
    /*
     * 队列操作示例：
     * [1] ← [2] ← [3] ← [4] ← [5]
     *  ↑                    ↑
     * 队头                队尾
     * 
     * 出队：1, 2, 3, 4, 5（按顺序）
     */
}
```

---

##  队列的基本操作

### 1. **核心操作**
```c
// 队列的基本操作：

struct queue_operations {
    // 1. 入队（Enqueue）：在队尾添加元素
    void enqueue(element);
    
    // 2. 出队（Dequeue）：从队头移除元素
    element dequeue();
    
    // 3. 查看队头元素
    element front();
    
    // 4. 检查队列是否为空
    bool is_empty();
    
    // 5. 获取队列大小
    int size();
};
```

### 2. **数组实现的队列**
```c
// 简单的数组队列实现：

#define MAX_QUEUE_SIZE 100

struct array_queue {
    int data[MAX_QUEUE_SIZE];
    int front;  // 队头索引
    int rear;   // 队尾索引
    int count;  // 元素个数
};

// 初始化队列
void init_queue(struct array_queue *q) {
    q->front = 0;
    q->rear = -1;
    q->count = 0;
}

// 入队
int enqueue(struct array_queue *q, int value) {
    if (q->count >= MAX_QUEUE_SIZE) {
        return -1;  // 队列满
    }
    
    q->rear = (q->rear + 1) % MAX_QUEUE_SIZE;  // 循环队列
    q->data[q->rear] = value;
    q->count++;
    return 0;
}

// 出队
int dequeue(struct array_queue *q, int *value) {
    if (q->count <= 0) {
        return -1;  // 队列空
    }
    
    *value = q->data[q->front];
    q->front = (q->front + 1) % MAX_QUEUE_SIZE;
    q->count--;
    return 0;
}
```

### 3. **链表实现的队列**
```c
// 链表队列实现：

struct queue_node {
    int data;
    struct queue_node *next;
};

struct linked_queue {
    struct queue_node *front;  // 队头指针
    struct queue_node *rear;   // 队尾指针
    int count;
};

// 入队（在队尾添加）
void enqueue_linked(struct linked_queue *q, int value) {
    struct queue_node *new_node = malloc(sizeof(struct queue_node));
    new_node->data = value;
    new_node->next = NULL;
    
    if (q->rear == NULL) {
        // 队列为空
        q->front = q->rear = new_node;
    } else {
        q->rear->next = new_node;
        q->rear = new_node;
    }
    q->count++;
}

// 出队（从队头删除）
int dequeue_linked(struct linked_queue *q, int *value) {
    if (q->front == NULL) {
        return -1;  // 队列空
    }
    
    struct queue_node *temp = q->front;
    *value = temp->data;
    
    q->front = q->front->next;
    if (q->front == NULL) {
        q->rear = NULL;  // 队列变空
    }
    
    free(temp);
    q->count--;
    return 0;
}
```

---

##  队列的应用场景

### 1. **操作系统中的应用**
```c
// 1. 进程调度队列：
void process_scheduling() {
    /*
     * 就绪队列：等待CPU的进程按FIFO顺序排队
     * [Process A] → [Process B] → [Process C]
     */
}

// 2. 打印队列：
void print_queue() {
    /*
     * 打印任务按到达顺序排队
     * [Document 1] → [Document 2] → [Document 3]
     */
}

// 3. 中断处理：
void interrupt_handling() {
    /*
     * 中断请求按到达顺序处理
     */
}
```

### 2. **网络编程中的应用**
```c
// 网络数据包处理：

void network_packet_queue() {
    /*
     * 网络数据包接收队列：
     * [Packet 1] → [Packet 2] → [Packet 3] → ...
     * 
     * 发送缓冲队列：
     * [Data 1] → [Data 2] → [Data 3] → ...
     */
}
```

### 3. **广度优先搜索（BFS）**
```c
// BFS算法中的队列应用：

void bfs_algorithm() {
    /*
     * 图的广度优先搜索：
     * 
     *     A
     *    / \
     *   B   C
     *  /   / \
     * D   E   F
     * 
     * 遍历顺序：A → B → C → D → E → F
     * 使用队列存储待访问的节点
     */
}
```

---

##  Linux 内核中的队列

### 1. **使用链表实现队列**
```c
// 在 Linux 内核中使用 list_head 实现队列：

#include <linux/list.h>

struct task_queue {
    struct list_head queue_head;
    spinlock_t lock;
};

struct task_item {
    int task_id;
    struct list_head list;
};

// 初始化队列
void init_task_queue(struct task_queue *tq) {
    INIT_LIST_HEAD(&tq->queue_head);
    spin_lock_init(&tq->lock);
}

// 入队（队尾）
void enqueue_task(struct task_queue *tq, struct task_item *item) {
    unsigned long flags;
    spin_lock_irqsave(&tq->lock, flags);
    list_add_tail(&item->list, &tq->queue_head);
    spin_unlock_irqrestore(&tq->lock, flags);
}

// 出队（队头）
struct task_item *dequeue_task(struct task_queue *tq) {
    struct task_item *item = NULL;
    unsigned long flags;
    
    spin_lock_irqsave(&tq->lock, flags);
    if (!list_empty(&tq->queue_head)) {
        item = list_entry(tq->queue_head.next, struct task_item, list);
        list_del(&item->list);
    }
    spin_unlock_irqrestore(&tq->lock, flags);
    
    return item;
}
```

### 2. **内核中的实际队列应用**
```c
// 内核中队列的实际应用：

void kernel_queue_examples() {
    // 1. 工作队列（workqueue）：
    struct work_struct my_work;
    // 任务按FIFO顺序执行
    
    // 2. 等待队列（wait queue）：
    wait_queue_head_t wait_queue;
    // 等待特定条件的进程排队
    
    // 3. 设备请求队列：
    struct request_queue *queue;
    // I/O请求按顺序处理
    
    // 4. 网络数据包队列：
    struct sk_buff_head skb_queue;
    // 网络数据包排队处理
}
```

---

##  特殊类型的队列

### 1. **双端队列（Deque）**
```c
// 双端队列：两端都可以插入和删除

struct deque {
    struct list_head items;
};

// 在前端插入
void deque_push_front(struct deque *dq, int value) {
    struct queue_node *node = malloc(sizeof(*node));
    node->data = value;
    // 插入到链表头部
    list_add(&node->list, &dq->items);
}

// 在后端插入
void deque_push_back(struct deque *dq, int value) {
    struct queue_node *node = malloc(sizeof(*node));
    node->data = value;
    // 插入到链表尾部
    list_add_tail(&node->list, &dq->items);
}
```

### 2. **优先队列**
```c
// 优先队列：按优先级出队

struct priority_queue {
    struct list_head items;
};

// 按优先级插入
void priority_enqueue(struct priority_queue *pq, int value, int priority) {
    struct priority_item *new_item = malloc(sizeof(*new_item));
    new_item->data = value;
    new_item->priority = priority;
    
    // 找到合适的位置插入（按优先级排序）
    struct list_head *pos;
    list_for_each(pos, &pq->items) {
        struct priority_item *item = list_entry(pos, struct priority_item, list);
        if (priority > item->priority) {
            list_add_tail(&new_item->list, pos);
            return;
        }
    }
    list_add_tail(&new_item->list, &pq->items);
}
```

---

##  队列的性能特点

### 1. **时间复杂度**
```c
// 队列操作的时间复杂度：

void queue_complexity() {
    /*
     * 数组实现（循环队列）：
     * - 入队：O(1)
     * - 出队：O(1)
     * - 空间：O(n)
     * 
     * 链表实现：
     * - 入队：O(1)
     * - 出队：O(1)
     * - 空间：O(n)
     * 
     * 优势：所有基本操作都是常数时间
     */
}
```

### 2. **空间复杂度**
```c
// 空间使用分析：

void space_analysis() {
    /*
     * 数组队列：
     * - 固定大小，可能浪费空间
     * - 需要预分配最大空间
     * 
     * 链表队列：
     * - 动态分配，按需使用
     * - 需要额外的指针空间
     * - 可能有内存碎片
     */
}
```

**队列的核心要点**：

### **基本特性**：
- **FIFO原则**：先进先出
- **两端操作**：队头删除，队尾插入
- **有序性**：保持元素的相对顺序

### **核心操作**：
1. **入队（Enqueue）**：O(1)
2. **出队（Dequeue）**：O(1)
3. **查看队头**：O(1)
4. **检查空队列**：O(1)

### **常见应用**：
- 操作系统调度
- 网络数据包处理
- 广度优先搜索
- 缓冲区管理
- 任务队列

### **实现方式**：
- **数组**：简单但大小固定
- **链表**：灵活但有额外开销
- **循环数组**：节省空间

**关键认识**：
队列是计算机科学中最基础和重要的数据结构之一，理解其原理和应用对于系统编程和算法设计都至关重要！

![8](/blog/articles/images/8.png)



## Linux 内核中的 kfifo（内核 FIFO）队列机制。

##  kfifo 基本概念

### 1. **kfifo 的工作原理**
```c
// kfifo 的核心概念：

void kfifo_concept() {
    // kfifo 使用两个偏移量：
    // 1. 入口偏移（in）：下一次入队的位置
    // 2. 出口偏移（out）：下一次出队的位置
    
    /*
     * 环形缓冲区示例（大小为8）：
     * 
     * [0][1][2][3][4][5][6][7]  <- 索引
     * [ ][ ][A][B][C][ ][ ][ ]  <- 数据
     *      ↑     ↑
     *    out    in
     * 
     * - 出口偏移 out = 2
     * - 入口偏移 in = 5
     * - 队列中有 3 个元素 (A, B, C)
     * - 可用空间：5 个位置
     */
}

// 偏移量计算：
void offset_calculation() {
    // 队列长度 = in - out
    // 可用空间 = size - (in - out)
    // 由于是环形缓冲区，使用模运算：
    // 实际偏移 = 偏移量 % size
}
```

---

## 创建队列

### 1. **动态创建**
```c
// 动态分配 kfifo：

#include <linux/kfifo.h>

void dynamic_kfifo_creation() {
    struct kfifo fifo;
    int ret;
    
    // kfifo_alloc(struct kfifo *fifo, unsigned int size, gfp_t gfp_mask)
    // size: 队列大小（必须是2的幂）
    // gfp_mask: 内存分配标志
    
    ret = kfifo_alloc(&fifo, PAGE_SIZE, GFP_KERNEL);
    if (ret) {
        printk("Failed to allocate kfifo: %d\n", ret);
        return;
    }
    
    // 使用队列...
    
    // 释放队列
    kfifo_free(&fifo);
}

// 实际使用示例：
void kfifo_example() {
    struct kfifo my_queue;
    int ret;
    
    // 创建 4KB 的队列
    ret = kfifo_alloc(&my_queue, 4096, GFP_KERNEL);
    if (ret) {
        return ret;
    }
    
    // 队列现在可以使用了
    printk("kfifo created successfully, size: %u\n", kfifo_size(&my_queue));
}
```

### 2. **静态创建**
```c
// 静态定义 kfifo：

void static_kfifo_creation() {
    // DECLARE_KFIFO(name, size)
    // INIT_KFIFO(name)
    
    DECLARE_KFIFO(my_fifo, 1024);  // 声明大小为1024字节的队列
    INIT_KFIFO(my_fifo);           // 初始化队列
    
    // 使用队列...
    
    // 注意：静态队列需要手动释放缓冲区（如果使用 kfifo_init）
}

// 使用预分配缓冲区：
void preallocated_kfifo() {
    char buffer[1024];  // 预分配的缓冲区
    struct kfifo fifo;
    
    // kfifo_init(struct kfifo *fifo, void *buffer, unsigned int size)
    kfifo_init(&fifo, buffer, sizeof(buffer));
    
    // 使用队列...
    // 注意：不需要调用 kfifo_free，因为缓冲区是栈分配的
}
```

---

## 推入队列数据

### 1. **kfifo_in 函数**
```c
// 向队列推入数据：

unsigned int kfifo_in_example() {
    struct kfifo fifo;
    int data = 42;
    unsigned int bytes_pushed;
    
    // kfifo_in(struct kfifo *fifo, const void *from, unsigned int len)
    // 返回实际推入的字节数
    
    bytes_pushed = kfifo_in(&fifo, &data, sizeof(data));
    
    if (bytes_pushed == sizeof(data)) {
        printk("Successfully pushed %u bytes\n", bytes_pushed);
    } else {
        printk("Only pushed %u bytes (buffer full)\n", bytes_pushed);
    }
    
    return bytes_pushed;
}

// 批量推入数据：
void batch_push_example() {
    struct kfifo fifo;
    int numbers[10] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9};
    unsigned int pushed;
    
    // 一次性推入整个数组
    pushed = kfifo_in(&fifo, numbers, sizeof(numbers));
    printk("Pushed %u bytes\n", pushed);
}
```

---

## 摘取队列数据

### 1. **kfifo_out 函数**
```c
// 从队列摘取数据：

unsigned int kfifo_out_example() {
    struct kfifo fifo;
    int data;
    unsigned int bytes_popped;
    
    // kfifo_out(struct kfifo *fifo, void *to, unsigned int len)
    // 返回实际摘取的字节数
    
    bytes_popped = kfifo_out(&fifo, &data, sizeof(data));
    
    if (bytes_popped == sizeof(data)) {
        printk("Successfully popped data: %d\n", data);
    } else {
        printk("Only popped %u bytes (queue empty)\n", bytes_popped);
    }
    
    return bytes_popped;
}

// 偷窥数据（不删除）：
unsigned int kfifo_out_peek_example() {
    struct kfifo fifo;
    int data;
    unsigned int bytes_peeked;
    
    // kfifo_out_peek(struct kfifo *fifo, void *to, unsigned int len, unsigned offset)
    // offset: 从队列中偏移的位置开始读取
    
    bytes_peeked = kfifo_out_peek(&fifo, &data, sizeof(data), 0);
    
    if (bytes_peeked == sizeof(data)) {
        printk("Peeked data: %d (still in queue)\n", data);
    }
    
    return bytes_peeked;
}
```

---

##  获取队列长度

### 1. **队列状态查询函数**
```c
// 查询队列状态：

void kfifo_status_queries() {
    struct kfifo fifo;
    
    // 获取队列总大小（字节）
    unsigned int total_size = kfifo_size(&fifo);
    printk("Total size: %u bytes\n", total_size);
    
    // 获取队列中已有的数据大小（字节）
    unsigned int used_size = kfifo_len(&fifo);
    printk("Used size: %u bytes\n", used_size);
    
    // 获取队列中可用空间（字节）
    unsigned int available = kfifo_avail(&fifo);
    printk("Available space: %u bytes\n", available);
    
    // 检查队列是否为空
    if (kfifo_is_empty(&fifo)) {
        printk("Queue is empty\n");
    }
    
    // 检查队列是否已满
    if (kfifo_is_full(&fifo)) {
        printk("Queue is full\n");
    }
}

// 实用的状态检查：
void practical_status_check() {
    struct kfifo *queue = get_my_queue();
    
    // 检查是否有足够的空间
    if (kfifo_avail(queue) >= sizeof(struct my_data)) {
        // 安全地推入数据
        struct my_data data = prepare_data();
        kfifo_in(queue, &data, sizeof(data));
    }
    
    // 检查是否有数据可读
    if (!kfifo_is_empty(queue)) {
        struct my_data data;
        if (kfifo_out(queue, &data, sizeof(data)) == sizeof(data)) {
            process_data(&data);
        }
    }
}
```

---

##  重置和撤销队列

### 1. **队列管理函数**
```c
// 队列重置和释放：

void kfifo_management() {
    struct kfifo fifo;
    
    // 动态分配队列
    if (kfifo_alloc(&fifo, 1024, GFP_KERNEL) != 0) {
        return -ENOMEM;
    }
    
    // 使用队列...
    use_queue(&fifo);
    
    // 重置队列（清空所有数据）
    kfifo_reset(&fifo);
    printk("Queue reset - now empty\n");
    
    // 队列仍然可用，但为空
    if (kfifo_is_empty(&fifo)) {
        printk("Queue is now empty after reset\n");
    }
    
    // 释放队列
    kfifo_free(&fifo);
}

// 重置 vs 释放的区别：
void reset_vs_free() {
    struct kfifo fifo;
    
    kfifo_alloc(&fifo, 1024, GFP_KERNEL);
    
    // kfifo_reset(): 清空数据，队列仍然可用
    kfifo_reset(&fifo);
    // 此时队列大小仍为1024，但数据为空
    
    // kfifo_free(): 释放内存，队列不可用
    kfifo_free(&fifo);
    // 此时队列完全释放，需要重新分配才能使用
}
```

---

## 完整使用示例

### 1. **完整的 kfifo 使用示例**
```c
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/kfifo.h>

// 完整的 kfifo 使用示例：

static struct kfifo my_fifo;

static int __init kfifo_example_init(void) {
    int ret;
    unsigned int i;
    
    // 1. 创建队列
    ret = kfifo_alloc(&my_fifo, 8192, GFP_KERNEL);  // 8KB 队列
    if (ret) {
        printk(KERN_ERR "Failed to allocate kfifo\n");
        return ret;
    }
    
    printk(KERN_INFO "kfifo allocated, size: %u\n", kfifo_size(&my_fifo));
    
    // 2. 推入数据
    printk(KERN_INFO "Pushing integers 0-31...\n");
    for (i = 0; i < 32; i++) {
        unsigned int pushed = kfifo_in(&my_fifo, &i, sizeof(i));
        if (pushed != sizeof(i)) {
            printk(KERN_WARNING "Failed to push %u, only %u bytes\n", i, pushed);
            break;
        }
    }
    
    printk(KERN_INFO "Pushed %u integers, queue length: %u\n", 
           i, kfifo_len(&my_fifo));
    
    // 3. 偷窥第一个元素
    unsigned int first_val;
    int peek_result = kfifo_out_peek(&my_fifo, &first_val, sizeof(first_val), 0);
    if (peek_result == sizeof(first_val)) {
        printk(KERN_INFO "First element (peek): %u\n", first_val);
    }
    
    // 4. 摘取并打印所有元素
    printk(KERN_INFO "Popping all elements:\n");
    while (!kfifo_is_empty(&my_fifo)) {
        unsigned int val;
        int pop_result = kfifo_out(&my_fifo, &val, sizeof(val));
        
        if (pop_result == sizeof(val)) {
            printk(KERN_INFO "Popped: %u\n", val);
        } else {
            printk(KERN_ERR "Failed to pop data\n");
            break;
        }
    }
    
    printk(KERN_INFO "Queue is now empty: %s\n", 
           kfifo_is_empty(&my_fifo) ? "yes" : "no");
    
    return 0;
}

static void __exit kfifo_example_exit(void) {
    // 5. 释放队列
    kfifo_free(&my_fifo);
    printk(KERN_INFO "kfifo freed\n");
}

module_init(kfifo_example_init);
module_exit(kfifo_example_exit);
MODULE_LICENSE("GPL");
```

### 2. **实际应用场景**
```c
// 实际应用示例：日志缓冲队列

struct log_entry {
    unsigned long timestamp;
    int level;
    char message[256];
};

static struct kfifo log_buffer;

// 添加日志条目
void add_log_entry(int level, const char *msg) {
    struct log_entry entry;
    
    entry.timestamp = jiffies;
    entry.level = level;
    strncpy(entry.message, msg, sizeof(entry.message) - 1);
    entry.message[sizeof(entry.message) - 1] = '\0';
    
    // 如果队列满了，丢弃最旧的日志
    if (kfifo_is_full(&log_buffer)) {
        struct log_entry discarded;
        kfifo_out(&log_buffer, &discarded, sizeof(discarded));
    }
    
    kfifo_in(&log_buffer, &entry, sizeof(entry));
}

// 读取日志条目
int read_log_entry(struct log_entry *entry) {
    if (kfifo_is_empty(&log_buffer)) {
        return -ENOENT;  // 队列为空
    }
    
    return kfifo_out(&log_buffer, entry, sizeof(*entry)) == sizeof(*entry) ? 0 : -EIO;
}
```

---

##  kfifo 的优势和特点

### 1. **性能优势**
```c
// kfifo 的性能特点：

void kfifo_advantages() {
    /*
     * 1. 无锁设计：使用原子操作，支持并发访问
     * 2. 高效实现：基于环形缓冲区，O(1) 操作
     * 3. 内存友好：大小为2的幂，便于优化
     * 4. 简单接口：易于使用和集成
     * 5. 内核优化：针对内核环境优化
     */
}

// 并发安全示例：
void concurrent_usage() {
    struct kfifo shared_fifo;
    
    // 多个生产者可以并发推入数据
    // 多个消费者可以并发摘取数据
    // kfifo 保证线程安全（在一定条件下）
}
```

### 2. **使用限制**
```c
// kfifo 的限制：

void kfifo_limitations() {
    /*
     * 1. 大小必须是2的幂
     * 2. 不支持随机访问
     * 3. 固定大小（除非重新分配）
     * 4. 字节流操作（不是类型安全的）
     */
}
```

**kfifo 的核心要点**：

### **创建方式**：
1. **动态创建**：`kfifo_alloc()` + `kfifo_free()`
2. **静态创建**：`DECLARE_KFIFO()` + `INIT_KFIFO()`
3. **预分配**：`kfifo_init()`（手动管理内存）

### **核心操作**：
1. **入队**：`kfifo_in()` - 推入数据
2. **出队**：`kfifo_out()` - 摘取数据
3. **偷窥**：`kfifo_out_peek()` - 查看不删除

### **状态查询**：
- `kfifo_size()` - 总大小
- `kfifo_len()` - 已用大小
- `kfifo_avail()` - 可用空间
- `kfifo_is_empty()` - 是否为空
- `kfifo_is_full()` - 是否已满

### **管理操作**：
- `kfifo_reset()` - 重置队列
- `kfifo_free()` - 释放队列

**关键认识**：
kfifo 是 Linux 内核提供的高效、线程安全的 FIFO 队列实现，特别适合在内核环境中进行数据缓冲和异步处理，是内核开发中的重要工具！