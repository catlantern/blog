## 单向链表

单向链表是一种线性数据结构

## 基本概念

- 节点结构

  ：每个节点包含两个部分

  - 数据域：存储实际数据
  - 指针域：存储指向下一个节点的地址

- **单向性**：只能从头节点开始，沿着指针方向依次访问节点

## 主要特征

- **动态内存分配**：大小可以动态增长或缩小
- **非连续存储**：节点在内存中可以分散存储
- **顺序访问**：只能从头到尾依次访问，不能随机访问

## 基本操作

- **插入**：在指定位置插入新节点
- **删除**：删除指定节点
- **查找**：遍历链表查找特定元素
- **遍历**：从头节点开始访问所有节点

## 优缺点

**优点**：

- 插入删除操作效率高 O(1)
- 内存利用率高，按需分配

**缺点**：

- 查找效率低 O(n)
- 需要额外存储指针空间
- 不能反向遍历

单向链表常用于实现栈、队列等其他数据结构。

```
// 节点定义
typedef struct ListNode {
    int data;                    // 数据域
    struct ListNode* next;       // 指针域，指向下一个节点
} ListNode;

// 链表定义
typedef struct LinkedList {
    ListNode* head;              // 头指针
    int size;                    // 链表长度
} LinkedList;
```

![6](/blog/articles/images/6.png)



## 环形链表（循环链表）

## 基本概念

环形链表是在普通链表基础上，将尾节点的指针指向头节点（或特定节点），形成一个闭合环状结构的数据结构。

## 主要特征

- **首尾相连**：最后一个节点指向第一个节点，形成闭环
- **无明确边界**：没有NULL结尾，需要特殊终止条件
- **循环访问**：可以从任意节点开始遍历整个结构
- **多种类型**：包括环形单向链表和环形双向链表

## 环形链表的两种类型

### 1. 环形单向链表

```c
// 节点定义
typedef struct CircularSingleNode {
    int data;                           // 数据域
    struct CircularSingleNode* next;    // 只有一个后继指针
} CircularSingleNode;

// 链表定义
typedef struct CircularSingleList {
    CircularSingleNode* head;           // 头指针
    int size;                          // 链表长度
} CircularSingleList;
```

**特点**：
- 每个节点只有一个指针域（next）
- 所有节点形成一个单向环
- 只能向前遍历
- 尾节点的next指向头节点

### 2. 环形双向链表

```c
// 节点定义
typedef struct CircularDoubleNode {
    int data;                           // 数据域
    struct CircularDoubleNode* next;    // 后继指针
    struct CircularDoubleNode* prev;    // 前驱指针
} CircularDoubleNode;

// 链表定义
typedef struct CircularDoubleList {
    CircularDoubleNode* head;           // 头指针
    int size;                          // 链表长度
} CircularDoubleList;
```

**特点**：
- 每个节点有两个指针域（next和prev）
- 所有节点形成一个双向环
- 可以前向和后向遍历
- 头节点的prev指向尾节点，尾节点的next指向头节点



## 环形特征说明

两种环形链表都满足：
- **head->prev->next = head**（双向）或 **head->next->...->next = head**（单向）
- 任意节点都可以作为遍历起点
- 需要特殊处理终止条件避免无限循环

![7](/blog/articles/images/7.png)





## 链表的移动

### 1. **线性移动特性**
```
链表访问模式：A → B → C → D → NULL
              ↑
            只能依次访问，不能跳跃
```
- **顺序访问**：必须从头开始，逐个节点访问
- **不能随机访问**：无法直接访问第n个元素，必须从头遍历到该位置
- **时间复杂度**：访问第n个元素需要O(n)时间

### 2. **头指针的作用**
```c
// 头指针是链表的入口
ListNode* head;  // 指向链表第一个节点
```
- **唯一标识**：通过头指针可以访问整个链表
- **快速定位**：O(1)时间找到链表起点
- **管理枢纽**：插入、删除等操作的基准点

### 3. **尾元素的识别**
```
非环形链表：A → B → C → D → NULL
                        ↑
                      next = NULL，标识尾元素

环形链表：  A → B → C → D → A
                    ↑       ↓
                    ←←←←←←←←
           D的next指向A，形成环
```

### 4. **不同链表类型的遍历特点**

#### 单向链表
```c
// 只能向前遍历
void traverse(ListNode* head) {
    ListNode* current = head;
    while (current != NULL) {  // 遇到NULL停止
        printf("%d ", current->data);
        current = current->next;
    }
}
```

#### 环形链表
```c
// 需要特殊终止条件
void traverseCircular(ListNode* head) {
    if (head == NULL) return;
    ListNode* current = head;
    do {
        printf("%d ", current->data);
        current = current->next;
    } while (current != head);  // 回到起点停止
}
```

#### 双向链表
```c
// 支持双向遍历
// 向前遍历
void traverseForward(DListNode* head) {
    DListNode* current = head;
    while (current != NULL) {
        printf("%d ", current->data);
        current = current->next;
    }
}

// 向后遍历
void traverseBackward(DListNode* tail) {
    DListNode* current = tail;
    while (current != NULL) {
        printf("%d ", current->data);
        current = current->prev;
    }
}
```

## 实际应用场景理解

### 适合使用链表的情况：
1. **顺序遍历所有数据**
   ```c
   // 遍历所有学生成绩
   StudentNode* current = head;
   while (current != NULL) {
       printf("Score: %d\n", current->score);
       current = current->next;
   }
   ```

2. **频繁插入删除**
   ```c
   // 在中间插入节点 O(1)
   newNode->next = current->next;
   current->next = newNode;
   ```

### 不适合使用链表的情况：
```c
// 需要频繁随机访问（不适合链表）
int getStudentScore(int index) {
    // 链表需要O(n)时间找到第index个学生
    // 数组只需要O(1)时间
}
```

## 关键要点

1. **链表的本质**：顺序访问的数据结构
2. **头指针的重要性**：链表的唯一入口
3. **环形链表的特殊性**：需要特殊的遍历终止条件
4. **双向链表的优势**：支持双向遍历
5. **适用场景**：顺序处理、动态增删，不适合随机访问







##  Linux 独特的内核链表

### 1. **传统链表实现方式**
```c
// 传统的链表实现：

// 传统方式：链表节点包含数据
struct traditional_list_node {
    int data;                           // 数据
    struct traditional_list_node *next; // 指向下一个节点
    struct traditional_list_node *prev; // 指向前一个节点
};

// 或者在数据结构中嵌入链表指针：
struct fox_traditional {
    unsigned long tail_length;
    unsigned long weight;
    bool is_fantastic;
    struct fox_traditional *next;       // 链表指针
    struct fox_traditional *prev;
};
```

### 2. **Linux 内核链表的创新思想**
```c
// Linux 内核方式：将链表节点嵌入到数据结构中

// 1. 定义通用链表节点：
struct list_head {
    struct list_head *next;
    struct list_head *prev;
};

// 2. 在数据结构中嵌入链表节点：
struct fox {
    unsigned long tail_length;
    unsigned long weight;
    bool is_fantastic;
    struct list_head list;  // 嵌入的链表节点
};

// 这样做的好处：
// - 一个通用的 list_head 可以嵌入到任何数据结构中
// - 链表操作函数只需要处理 list_head
// - 不需要为每种数据结构重新实现链表操作
```

---

## Linux 内核链表的实现

### 1. **list_head 结构**
```c
// 内核中的链表节点定义：

// include/linux/types.h
struct list_head {
    struct list_head *next, *prev;
};

// 双向循环链表：
// - next 指向下一个节点
// - prev 指向前一个节点
// - 空链表时，头节点指向自己
```

### 2. **链表初始化**
```c
// 链表头节点的初始化：

// 静态初始化：
#define LIST_HEAD_INIT(name) { &(name), &(name) }

#define LIST_HEAD(name) \
    struct list_head name = LIST_HEAD_INIT(name)

// 使用示例：
LIST_HEAD(fox_list);  // 创建一个空链表头

// 动态初始化：
static inline void INIT_LIST_HEAD(struct list_head *list) {
    list->next = list;
    list->prev = list;
}

// 使用示例：
struct list_head my_list;
INIT_LIST_HEAD(&my_list);
```

### 3. **链表操作函数**
```c
// 基本链表操作：

// 1. 添加节点到链表头部：
static inline void list_add(struct list_head *new, struct list_head *head) {
    __list_add(new, head, head->next);
}

// 2. 添加节点到链表尾部：
static inline void list_add_tail(struct list_head *new, struct list_head *head) {
    __list_add(new, head->prev, head);
}

// 3. 删除节点：
static inline void list_del(struct list_head *entry) {
    __list_del(entry->prev, entry->next);
    entry->next = LIST_POISON1;
    entry->prev = LIST_POISON2;
}

// 4. 检查链表是否为空：
static inline int list_empty(const struct list_head *head) {
    return head->next == head;
}
```

---

## container_of 宏

### 1. **container_of 宏的实现**
```c
// container_of 宏：从成员指针获取容器结构体指针

// include/linux/kernel.h
#define container_of(ptr, type, member) ({                      \
    void *__mptr = (void *)(ptr);                              \
    ((type *)(__mptr - offsetof(type, member))); })

// offsetof 宏：获取成员在结构体中的偏移量
#define offsetof(TYPE, MEMBER) ((size_t) &((TYPE *)0)->MEMBER)

// 使用示例：
void container_of_example() {
    struct fox my_fox = {
        .tail_length = 30,
        .weight = 5,
        .is_fantastic = true
    };
    
    // 获取 list 成员的地址
    struct list_head *list_ptr = &my_fox.list;
    
    // 通过 container_of 获取整个 fox 结构体
    struct fox *fox_ptr = container_of(list_ptr, struct fox, list);
    
    // fox_ptr 现在指向 my_fox
}
```

### 2. **offsetof 宏的工作原理**
```c
// offsetof 宏的原理：

void offsetof_explanation() {
    // ((struct fox *)0)->list
    // 这里将地址0强制转换为 struct fox* 指针
    // 然后访问 list 成员
    // 由于基地址是0，所以得到的就是 list 成员的偏移量
    
    // 例如：
    // struct fox {
    //     unsigned long tail_length;  // offset 0
    //     unsigned long weight;       // offset 8 (64位系统)
    //     bool is_fantastic;          // offset 16
    //     struct list_head list;      // offset 24
    // };
    
    // offsetof(struct fox, list) = 24
}
```

### 3. **list_entry 宏**
```c
// list_entry 宏：链表操作的便利宏

// include/linux/list.h
#define list_entry(ptr, type, member) \
    container_of(ptr, type, member)

// 使用示例：
void list_entry_example() {
    struct list_head *current_list_ptr;
    
    // 遍历链表时使用：
    list_for_each(current_list_ptr, &fox_list) {
        // 通过 list_entry 获取包含该 list_head 的 fox 结构体
        struct fox *current_fox = list_entry(current_list_ptr, struct fox, list);
        
        // 现在可以访问 fox 的成员：
        printf("Fox tail length: %lu\n", current_fox->tail_length);
    }
}
```

---

##  实际使用示例

### 1. **完整的狐狸链表示例**
```c
#include <linux/list.h>
#include <linux/kernel.h>
#include <linux/slab.h>

// 狐狸数据结构
struct fox {
    unsigned long tail_length;
    unsigned long weight;
    bool is_fantastic;
    struct list_head list;  // 嵌入的链表节点
};

// 创建狐狸链表
LIST_HEAD(fox_list);

// 添加狐狸到链表
void add_fox(unsigned long tail, unsigned long wt, bool fantastic) {
    struct fox *new_fox = kmalloc(sizeof(struct fox), GFP_KERNEL);
    if (!new_fox)
        return;
    
    new_fox->tail_length = tail;
    new_fox->weight = wt;
    new_fox->is_fantastic = fantastic;
    
    // 初始化链表节点
    INIT_LIST_HEAD(&new_fox->list);
    
    // 添加到链表尾部
    list_add_tail(&new_fox->list, &fox_list);
}

// 遍历狐狸链表
void print_all_foxes() {
    struct list_head *pos;
    struct fox *fox_entry;
    
    // 方法1：使用 list_for_each
    list_for_each(pos, &fox_list) {
        fox_entry = list_entry(pos, struct fox, list);
        printk("Fox: tail=%lu, weight=%lu, fantastic=%s\n",
               fox_entry->tail_length,
               fox_entry->weight,
               fox_entry->is_fantastic ? "yes" : "no");
    }
    
    // 方法2：使用 list_for_each_entry（更简洁）
    list_for_each_entry(fox_entry, &fox_list, list) {
        printk("Fox: tail=%lu, weight=%lu, fantastic=%s\n",
               fox_entry->tail_length,
               fox_entry->weight,
               fox_entry->is_fantastic ? "yes" : "no");
    }
}

// 删除所有狐狸
void cleanup_foxes() {
    struct list_head *pos, *tmp;
    struct fox *fox_entry;
    
    // 安全删除链表中的所有节点
    list_for_each_safe(pos, tmp, &fox_list) {
        fox_entry = list_entry(pos, struct fox, list);
        list_del(pos);  // 从链表中删除
        kfree(fox_entry);  // 释放内存
    }
}
```

### 2. **链表遍历宏**
```c
// 内核提供的便利遍历宏：

// 1. 基本遍历：
#define list_for_each(pos, head) \
    for (pos = (head)->next; pos != (head); pos = pos->next)

// 2. 安全遍历（允许在遍历时删除节点）：
#define list_for_each_safe(pos, n, head) \
    for (pos = (head)->next, n = pos->next; pos != (head); \
         pos = n, n = pos->next)

// 3. 直接获取结构体指针的遍历：
#define list_for_each_entry(pos, head, member) \
    for (pos = list_entry((head)->next, typeof(*pos), member); \
         &pos->member != (head); \
         pos = list_entry(pos->member.next, typeof(*pos), member))

// 4. 安全的结构体指针遍历：
#define list_for_each_entry_safe(pos, n, head, member) \
    for (pos = list_entry((head)->next, typeof(*pos), member), \
         n = list_entry(pos->member.next, typeof(*pos), member); \
         &pos->member != (head); \
         pos = n, n = list_entry(n->member.next, typeof(*n), member))
```

---

## 优势分析

### 1. **设计优势**
```c
// Linux 内核链表设计的优势：

void design_advantages() {
    // 1. 通用性：
    // 同一个 list_head 可以嵌入到任何结构体中
    struct task_struct { struct list_head tasks; /* ... */ };
    struct mm_struct { struct list_head mmlist; /* ... */ };
    struct fox { struct list_head list; /* ... */ };
    
    // 2. 类型安全：
    // 所有操作都通过 container_of 保证类型安全
    
    // 3. 高效性：
    // 不需要为每种类型重新实现链表操作
    
    // 4. 灵活性：
    // 一个结构体可以包含多个 list_head（多个链表）
    struct fox {
        struct list_head list_by_weight;    // 按重量排序
        struct list_head list_by_tail;      // 按尾巴长度排序
    };
}
```

### 2. **与其他实现的对比**
```c
// 传统实现 vs Linux 内核实现：

void comparison() {
    // 传统实现的问题：
    struct traditional_list {
        void *data;                         // 需要类型转换
        struct traditional_list *next;      // 只能存储一种类型
        struct traditional_list *prev;
    };
    
    // Linux 实现的优势：
    struct list_head {                  // 通用链表节点
        struct list_head *next;
        struct list_head *prev;         // 可以嵌入任何结构体
    };
    
    // 使用 container_of 可以安全地获取原始结构体
}
```

---

**Linux 内核链表的核心要点**：

### **设计思想**：
1. **嵌入式设计**：链表节点嵌入到数据结构中
2. **通用性**：一个 `list_head` 适用于所有数据结构
3. **类型安全**：通过 `container_of` 保证类型安全

### **核心组件**：
1. **`struct list_head`**：通用链表节点
2. **`container_of` 宏**：从成员获取容器结构体
3. **`list_entry` 宏**：链表操作的便利宏
4. **各种链表操作函数**：添加、删除、遍历等

### **使用模式**：
```c
// 1. 在数据结构中嵌入 list_head
struct my_data {
    int value;
    struct list_head list;
};

// 2. 初始化链表头
LIST_HEAD(my_list);

// 3. 添加节点
struct my_data *data = kmalloc(sizeof(*data), GFP_KERNEL);
INIT_LIST_HEAD(&data->list);
list_add(&data->list, &my_list);

// 4. 遍历链表
struct my_data *entry;
list_for_each_entry(entry, &my_list, list) {
    // 使用 entry->value
}
```





## 链表初始化

##  链表初始化的两种方式

### 1. **动态初始化（运行时）**
```c
// 动态分配内存并初始化链表节点：

void dynamic_initialization() {
    struct fox *red_fox;
    
    // 1. 分配内存
    red_fox = kmalloc(sizeof(*red_fox), GFP_KERNEL);
    if (!red_fox) {
        // 内存分配失败处理
        return -ENOMEM;
    }
    
    // 2. 初始化数据成员
    red_fox->tail_length = 40;
    red_fox->weight = 6;
    red_fox->is_fantastic = false;
    
    // 3. 初始化链表节点（关键步骤）
    INIT_LIST_HEAD(&red_fox->list);
    
    // INIT_LIST_HEAD 的实现：
    // static inline void INIT_LIST_HEAD(struct list_head *list) {
    //     list->next = list;  // 指向自己，形成空循环链表
    //     list->prev = list;
    // }
    
    // 初始化后的状态：
    // red_fox->list.next = &red_fox->list
    // red_fox->list.prev = &red_fox->list
}

// 实际的内核代码示例：
struct task_struct *create_task(void) {
    struct task_struct *task;
    
    task = kmem_cache_alloc(task_struct_cachep, GFP_KERNEL);
    if (!task)
        return NULL;
    
    // 初始化嵌入的链表节点
    INIT_LIST_HEAD(&task->tasks);
    INIT_LIST_HEAD(&task->children);
    
    return task;
}
```

### 2. **静态初始化（编译时）**
```c
// 静态定义结构体并初始化链表节点：

void static_initialization() {
    // 方式1：使用 LIST_HEAD_INIT 宏
    struct fox red_fox = {
        .tail_length = 40,
        .weight = 6,
        .is_fantastic = false,
        .list = LIST_HEAD_INIT(red_fox.list)  // 关键：初始化链表节点
    };
    
    // LIST_HEAD_INIT 宏的定义：
    // #define LIST_HEAD_INIT(name) { &(name), &(name) }
    
    // 展开后相当于：
    // .list = { &(red_fox.list), &(red_fox.list) }
    
    // 方式2：分步初始化
    struct fox blue_fox = {
        .tail_length = 35,
        .weight = 5,
        .is_fantastic = true
    };
    // 然后手动初始化链表节点
    INIT_LIST_HEAD(&blue_fox.list);
}

// 实际内核中的静态初始化示例：
// 定义一个全局链表头
static LIST_HEAD(device_list);  // 等价于 struct list_head device_list = { &device_list, &device_list };

// 静态定义的设备结构体
static struct device my_device = {
    .name = "my_device",
    .id = 0,
    .dev_list = LIST_HEAD_INIT(my_device.dev_list)
};
```

---

## 链表初始化的细节

### 1. **INIT_LIST_HEAD 宏详解**
```c
// INIT_LIST_HEAD 的详细实现：

static inline void INIT_LIST_HEAD(struct list_head *list) {
    list->next = list;  // 指向自己
    list->prev = list;  // 指向自己
}

// 空链表的状态：
// head -> next ──┐
// head -> prev ──┘
// 形成一个只有一个节点的循环链表

void init_list_head_example() {
    struct list_head my_list;
    
    INIT_LIST_HEAD(&my_list);
    
    // 初始化后：
    // my_list.next == &my_list  (指向自己)
    // my_list.prev == &my_list  (指向自己)
    
    // 检查链表是否为空：
    if (list_empty(&my_list)) {
        printk("List is empty\n");
    }
}
```

### 2. **LIST_HEAD_INIT 宏详解**
```c
// LIST_HEAD_INIT 宏的实现：

#define LIST_HEAD_INIT(name) { &(name), &(name) }

// 使用示例：
struct list_head my_list = LIST_HEAD_INIT(my_list);

// 展开后相当于：
struct list_head my_list = { &my_list, &my_list };

void list_head_init_example() {
    // 这两种初始化方式是等价的：
    
    // 方式1：静态初始化
    struct list_head list1 = LIST_HEAD_INIT(list1);
    
    // 方式2：动态初始化
    struct list_head list2;
    INIT_LIST_HEAD(&list2);
    
    // 两种方式初始化后的状态完全相同
}
```

### 3. **LIST_HEAD 宏**
```c
// 最简单的静态链表定义方式：

#define LIST_HEAD(name) \
    struct list_head name = LIST_HEAD_INIT(name)

// 使用示例：
LIST_HEAD(fox_list);  // 定义并初始化一个空链表头

// 等价于：
// struct list_head fox_list = { &fox_list, &fox_list };

void list_head_macro_example() {
    // 定义多个链表：
    LIST_HEAD(cat_list);
    LIST_HEAD(dog_list);
    LIST_HEAD(bird_list);
    
    // 这些都是空的循环链表，可以用来作为链表头
}
```

---

##  实际使用场景

### 1. **动态创建链表节点**
```c
// 动态创建和管理链表节点：

struct fox_list_manager {
    struct list_head foxes;  // 链表头
    int count;
};

void fox_list_manager_init(struct fox_list_manager *mgr) {
    INIT_LIST_HEAD(&mgr->foxes);
    mgr->count = 0;
}

int add_fox(struct fox_list_manager *mgr, 
            unsigned long tail_length, 
            unsigned long weight, 
            bool is_fantastic) {
    struct fox *new_fox;
    
    // 1. 分配内存
    new_fox = kmalloc(sizeof(*new_fox), GFP_KERNEL);
    if (!new_fox)
        return -ENOMEM;
    
    // 2. 初始化数据
    new_fox->tail_length = tail_length;
    new_fox->weight = weight;
    new_fox->is_fantastic = is_fantastic;
    
    // 3. 初始化链表节点
    INIT_LIST_HEAD(&new_fox->list);
    
    // 4. 添加到链表
    list_add_tail(&new_fox->list, &mgr->foxes);
    mgr->count++;
    
    return 0;
}
```

### 2. **静态定义链表头**
```c
// 全局链表头的定义：

// 定义全局狐狸链表
static LIST_HEAD(global_fox_list);

// 模块初始化时使用
static int __init fox_module_init(void) {
    // 链表头已经通过 LIST_HEAD 宏初始化
    // 可以直接使用
    
    struct fox *first_fox;
    
    first_fox = kmalloc(sizeof(*first_fox), GFP_KERNEL);
    if (first_fox) {
        first_fox->tail_length = 40;
        first_fox->weight = 6;
        first_fox->is_fantastic = true;
        INIT_LIST_HEAD(&first_fox->list);
        list_add(&first_fox->list, &global_fox_list);
    }
    
    return 0;
}
```

### 3. **复合结构体中的链表**
```c
// 复杂结构体中的多个链表：

struct animal {
    char name[32];
    enum { CAT, DOG, FOX } type;
    unsigned long weight;
    
    // 可以包含多个链表节点
    struct list_head by_type;    // 按类型分组
    struct list_head by_weight;  // 按重量排序
    struct list_head all_animals; // 所有动物链表
};

void complex_structure_example() {
    struct animal *my_fox = kmalloc(sizeof(*my_fox), GFP_KERNEL);
    
    strcpy(my_fox->name, "Red Fox");
    my_fox->type = FOX;
    my_fox->weight = 6;
    
    // 初始化所有链表节点
    INIT_LIST_HEAD(&my_fox->by_type);
    INIT_LIST_HEAD(&my_fox->by_weight);
    INIT_LIST_HEAD(&my_fox->all_animals);
    
    // 可以将同一个对象添加到不同的链表中
}
```

---

##  常见错误和注意事项

### 1. **忘记初始化链表节点**
```c
// 错误示例：
void wrong_initialization() {
    struct fox *red_fox;
    
    red_fox = kmalloc(sizeof(*red_fox), GFP_KERNEL);
    red_fox->tail_length = 40;
    red_fox->weight = 6;
    red_fox->is_fantastic = false;
    
    // 错误：忘记初始化链表节点！
    // list_add(&red_fox->list, &some_list);  // 这会导致问题
    
    // 正确做法：
    INIT_LIST_HEAD(&red_fox->list);  // 必须初始化
    list_add(&red_fox->list, &some_list);
}
```

### 2. **静态初始化的正确语法**
```c
// 正确的静态初始化：
struct fox red_fox = {
    .tail_length = 40,
    .weight = 6,
    .is_fantastic = false,
    .list = LIST_HEAD_INIT(red_fox.list)  // 注意：使用变量名
};

// 错误示例：
struct fox wrong_fox = {
    .tail_length = 40,
    .weight = 6,
    .list = LIST_HEAD_INIT(wrong_fox.list)  // 如果写错名字会编译错误
};
```

**链表定义和初始化的核心要点**：

### **定义方式**：
1. **嵌入式设计**：在数据结构中嵌入 `struct list_head`
2. **通用性**：同一个 `list_head` 可以嵌入到任何结构体中

### **初始化方式**：
1. **动态初始化**：运行时使用 `INIT_LIST_HEAD(&struct->list)`
2. **静态初始化**：编译时使用 `LIST_HEAD_INIT(name)` 或 `LIST_HEAD(name)`

### **使用模式**：
```c
// 动态创建：
struct fox *fox = kmalloc(sizeof(*fox), GFP_KERNEL);
fox->tail_length = 40;
INIT_LIST_HEAD(&fox->list);

// 静态定义：
struct fox red_fox = {
    .tail_length = 40,
    .list = LIST_HEAD_INIT(red_fox.list)
};

// 全局链表头：
LIST_HEAD(fox_list);
```







## 链表操作详解

### 1. **添加节点操作**
```c
// 1. 在链表头部添加节点：

void list_add_example() {
    // list_add(struct list_head *new, struct list_head *head)
    // 在 head 节点后面插入 new 节点
    
    LIST_HEAD(my_list);
    struct fox fox1, fox2;
    
    // 初始化节点
    INIT_LIST_HEAD(&fox1.list);
    INIT_LIST_HEAD(&fox2.list);
    
    // 添加第一个节点
    list_add(&fox1.list, &my_list);
    // 链表状态：my_list -> fox1 -> my_list
    
    // 添加第二个节点（在头部）
    list_add(&fox2.list, &my_list);
    // 链表状态：my_list -> fox2 -> fox1 -> my_list
    
    // 这种方式实现的是栈（LIFO）
}

// 2. 在链表尾部添加节点：

void list_add_tail_example() {
    // list_add_tail(struct list_head *new, struct list_head *head)
    // 在 head 节点前面插入 new 节点
    
    LIST_HEAD(my_list);
    struct fox fox1, fox2;
    
    INIT_LIST_HEAD(&fox1.list);
    INIT_LIST_HEAD(&fox2.list);
    
    // 添加第一个节点
    list_add_tail(&fox1.list, &my_list);
    // 链表状态：my_list -> fox1 -> my_list
    
    // 添加第二个节点（在尾部）
    list_add_tail(&fox2.list, &my_list);
    // 链表状态：my_list -> fox1 -> fox2 -> my_list
    
    // 这种方式实现的是队列（FIFO）
}
```

### 2. **删除节点操作**
```c
// 删除节点：

void list_del_example() {
    // list_del(struct list_head *entry)
    // 从链表中删除指定节点
    
    LIST_HEAD(fox_list);
    struct fox fox1, fox2, fox3;
    
    // 添加节点
    list_add_tail(&fox1.list, &fox_list);
    list_add_tail(&fox2.list, &fox_list);
    list_add_tail(&fox3.list, &fox_list);
    
    // 链表状态：fox_list -> fox1 -> fox2 -> fox3 -> fox_list
    
    // 删除中间节点
    list_del(&fox2.list);
    // 链表状态：fox_list -> fox1 -> fox3 -> fox_list
    
    // 注意：list_del 只是从链表中移除节点
    // 不会释放 fox2 占用的内存
    // 需要手动调用 kfree(&fox2)
}

// 删除并重新初始化：

void list_del_init_example() {
    // list_del_init(struct list_head *entry)
    // 删除节点并重新初始化，使其可以重新使用
    
    struct fox fox;
    INIT_LIST_HEAD(&fox.list);
    
    LIST_HEAD(my_list);
    list_add(&fox.list, &my_list);
    
    // 删除节点
    list_del_init(&fox.list);
    
    // 现在 fox.list 又变为空链表状态
    // 可以重新添加到其他链表中
    LIST_HEAD(another_list);
    list_add(&fox.list, &another_list);  // 可以重新使用
}
```

### 3. **移动和合并操作**
```c
// 移动节点：

void list_move_example() {
    // list_move(struct list_head *list, struct list_head *head)
    // 将 list 节点从原链表移到新链表的 head 后面
    
    LIST_HEAD(list1);
    LIST_HEAD(list2);
    
    struct fox fox1, fox2;
    INIT_LIST_HEAD(&fox1.list);
    INIT_LIST_HEAD(&fox2.list);
    
    // 添加到第一个链表
    list_add_tail(&fox1.list, &list1);
    list_add_tail(&fox2.list, &list1);
    
    // 现在：list1 -> fox1 -> fox2 -> list1
    //       list2 -> list2 (空)
    
    // 将 fox1 移动到第二个链表
    list_move(&fox1.list, &list2);
    
    // 现在：list1 -> fox2 -> list1
    //       list2 -> fox1 -> list2
}

// 移动到尾部：

void list_move_tail_example() {
    // list_move_tail(struct list_head *list, struct list_head *head)
    // 将 list 节点移到新链表的 head 前面（尾部）
    
    LIST_HEAD(list1);
    LIST_HEAD(list2);
    
    struct fox fox1, fox2, fox3;
    INIT_LIST_HEAD(&fox1.list);
    INIT_LIST_HEAD(&fox2.list);
    INIT_LIST_HEAD(&fox3.list);
    
    list_add_tail(&fox1.list, &list1);
    list_add_tail(&fox2.list, &list1);
    list_add_tail(&fox3.list, &list2);
    
    // 移动 fox1 到 list2 尾部
    list_move_tail(&fox1.list, &list2);
    
    // 现在：list1 -> fox2 -> list1
    //       list2 -> fox3 -> fox1 -> list2
}
```

### 4. **检查和合并操作**
```c
// 检查链表是否为空：

void list_empty_example() {
    LIST_HEAD(my_list);
    
    // 空链表检查
    if (list_empty(&my_list)) {
        printk("List is empty\n");
    }
    
    struct fox fox;
    INIT_LIST_HEAD(&fox.list);
    list_add(&fox.list, &my_list);
    
    // 非空链表检查
    if (!list_empty(&my_list)) {
        printk("List is not empty\n");
    }
}

// 合并链表：

void list_splice_example() {
    // list_splice(struct list_head *list, struct list_head *head)
    // 将 list 链表合并到 head 链表后面
    
    LIST_HEAD(list1);
    LIST_HEAD(list2);
    
    struct fox fox1, fox2, fox3, fox4;
    INIT_LIST_HEAD(&fox1.list);
    INIT_LIST_HEAD(&fox2.list);
    INIT_LIST_HEAD(&fox3.list);
    INIT_LIST_HEAD(&fox4.list);
    
    // 构建第一个链表
    list_add_tail(&fox1.list, &list1);
    list_add_tail(&fox2.list, &list1);
    
    // 构建第二个链表
    list_add_tail(&fox3.list, &list2);
    list_add_tail(&fox4.list, &list2);
    
    // 合并链表
    list_splice(&list2, &list1);
    
    // 现在：list1 -> fox1 -> fox2 -> fox3 -> fox4 -> list1
    //       list2 变为空链表
}

// 合并并重新初始化：

void list_splice_init_example() {
    // list_splice_init(struct list_head *list, struct list_head *head)
    // 合并链表并重新初始化原链表
    
    LIST_HEAD(list1);
    LIST_HEAD(list2);
    
    struct fox fox1, fox2;
    INIT_LIST_HEAD(&fox1.list);
    INIT_LIST_HEAD(&fox2.list);
    
    list_add_tail(&fox1.list, &list2);
    list_add_tail(&fox2.list, &list2);
    
    list_splice_init(&list2, &list1);
    
    // list2 现在是空链表，可以重新使用
    if (list_empty(&list2)) {
        printk("list2 is now empty and can be reused\n");
    }
}
```

---







##  内部函数和性能优化

### 1. **内部函数的使用**
```c
// 内部函数（带双下划线）：

void internal_functions() {
    // 外部函数：
    // list_del(struct list_head *entry)
    
    // 内部函数：
    // __list_del(struct list_head *prev, struct list_head *next)
    
    // 外部函数的实现：
    static inline void list_del(struct list_head *entry) {
        __list_del(entry->prev, entry->next);
        entry->next = LIST_POISON1;  // 调试用
        entry->prev = LIST_POISON2;
    }
    
    static inline void __list_del(struct list_head *prev, struct list_head *next) {
        next->prev = prev;
        prev->next = next;
    }
}

// 性能优化示例：

void performance_optimization() {
    struct list_head *prev, *next;
    struct list_head *target_node;
    
    // 如果你已经获取了 prev 和 next 指针
    prev = target_node->prev;
    next = target_node->next;
    
    // 直接调用内部函数，避免重复提领
    __list_del(prev, next);
    
    // 而不是：
    // list_del(target_node);  // 会重新提领 prev 和 next
}
```

### 2. **O(1) 时间复杂度**
```c
// 为什么链表操作是 O(1)？

void o1_complexity_explanation() {
    // 1. 添加节点：只需要修改几个指针
    //    - 新节点的 prev 和 next
    //    - 原来相邻节点的指针
    //    - 时间复杂度：O(1)
    
    // 2. 删除节点：只需要修改前后节点的指针
    //    - 不需要遍历链表
    //    - 时间复杂度：O(1)
    
    // 3. 移动节点：删除 + 添加
    //    - 时间复杂度：O(1) + O(1) = O(1)
    
    // 4. 合并链表：修改几个指针连接点
    //    - 时间复杂度：O(1)
    
    // 注意：遍历链表是 O(n)，但单次操作是 O(1)
}
```

---

##  实际应用示例

### 1. **完整的工作示例**
```c
#include <linux/list.h>
#include <linux/kernel.h>
#include <linux/slab.h>

struct fox {
    unsigned long tail_length;
    unsigned long weight;
    bool is_fantastic;
    struct list_head list;
};

// 管理狐狸的结构体
struct fox_manager {
    struct list_head fox_list;
    int count;
};

// 初始化管理器
void fox_manager_init(struct fox_manager *mgr) {
    INIT_LIST_HEAD(&mgr->fox_list);
    mgr->count = 0;
}

// 添加狐狸
int add_fox(struct fox_manager *mgr, unsigned long tail, unsigned long weight, bool fantastic) {
    struct fox *new_fox = kmalloc(sizeof(*new_fox), GFP_KERNEL);
    if (!new_fox)
        return -ENOMEM;
    
    new_fox->tail_length = tail;
    new_fox->weight = weight;
    new_fox->is_fantastic = fantastic;
    INIT_LIST_HEAD(&new_fox->list);
    
    list_add_tail(&new_fox->list, &mgr->fox_list);
    mgr->count++;
    
    return 0;
}

// 查找特定重量的狐狸
struct fox *find_fox_by_weight(struct fox_manager *mgr, unsigned long target_weight) {
    struct fox *fox_entry;
    
    list_for_each_entry(fox_entry, &mgr->fox_list, list) {
        if (fox_entry->weight == target_weight) {
            return fox_entry;
        }
    }
    return NULL;
}

// 删除所有狐狸
void cleanup_foxes(struct fox_manager *mgr) {
    struct list_head *pos, *tmp;
    struct fox *fox_entry;
    
    list_for_each_safe(pos, tmp, &mgr->fox_list) {
        fox_entry = list_entry(pos, struct fox, list);
        list_del(pos);
        kfree(fox_entry);
    }
    mgr->count = 0;
}
```

### 2. **内核中的实际应用**
```c
// 内核中链表的实际应用示例：

// 1. 进程管理：
struct task_struct {
    struct list_head tasks;      // 所有进程链表
    struct list_head children;   // 子进程链表
    struct list_head sibling;    // 兄弟进程链表
};

// 2. 内存管理：
struct mm_struct {
    struct list_head mmlist;     // 内存描述符链表
};

// 3. 设备驱动：
struct device {
    struct list_head dev_list;   // 设备链表
};
```

### **核心操作**：
1. **添加**：`list_add()`（头部）、`list_add_tail()`（尾部）
2. **删除**：`list_del()`、`list_del_init()`
3. **移动**：`list_move()`、`list_move_tail()`
4. **合并**：`list_splice()`、`list_splice_init()`
5. **检查**：`list_empty()`

### **性能特点**：
- **O(1) 复杂度**：所有操作都是常数时间
- **内部函数**：`__list_*` 函数用于性能优化
- **内存安全**：操作不涉及内存释放



##  遍历链表

### 1. **遍历的基本概念**
```c
// 遍历的本质：
// 从链表头开始，沿着 next 指针访问每个节点
// 直到回到链表头（循环链表）

void traversal_concept() {
    // 链表结构：
    // head -> node1 -> node2 -> node3 -> head
    //         ↑                              ↓
    //         ←----------------------------←
    
    // 遍历过程：
    // 1. 从 head->next 开始
    // 2. 访问当前节点
    // 3. 移动到 current->next
    // 4. 重复直到回到 head
}
```

---

##  1. 基本遍历方法

### 1. **list_for_each 宏**
```c
// 最基础的遍历方法：

void basic_traversal() {
    // list_for_each(pos, head)
    // pos: 临时的 list_head 指针
    // head: 链表头节点
    
    LIST_HEAD(fox_list);
    // ... 添加一些 fox 节点 ...
    
    struct list_head *p;  // 临时指针
    
    list_for_each(p, &fox_list) {
        // p 指向当前的 list_head 节点
        // 但这通常不是我们想要的
        
        // 需要使用 list_entry 获取包含该 list_head 的结构体
        struct fox *current_fox = list_entry(p, struct fox, list);
        
        // 现在可以访问 fox 的数据成员
        printk("Fox tail: %lu, weight: %lu\n", 
               current_fox->tail_length, 
               current_fox->weight);
    }
}

// list_for_each 的实现原理：
#define list_for_each(pos, head) \
    for (pos = (head)->next; pos != (head); pos = pos->next)
```

### 2. **结合 list_entry 使用**
```c
// list_entry 的使用：

void list_entry_usage() {
    struct list_head *current_list_ptr;
    struct fox *current_fox;
    
    list_for_each(current_list_ptr, &fox_list) {
        // 通过 container_of 获取包含该 list_head 的 fox 结构体
        current_fox = list_entry(current_list_ptr, struct fox, list);
        
        // 使用 fox 数据
        if (current_fox->is_fantastic) {
            printk("Found fantastic fox!\n");
        }
    }
}
```

---

##  2. 推荐的遍历方法

### 1. **list_for_each_entry 宏**
```c
// 更优雅的遍历方式：

void recommended_traversal() {
    // list_for_each_entry(pos, head, member)
    // pos: 指向包含 list_head 的结构体的指针
    // head: 链表头节点
    // member: 结构体中 list_head 成员的名称
    
    struct fox *current_fox;
    
    list_for_each_entry(current_fox, &fox_list, list) {
        // current_fox 直接指向 fox 结构体
        // 无需手动调用 list_entry
        
        printk("Fox: tail=%lu, weight=%lu\n",
               current_fox->tail_length,
               current_fox->weight);
    }
}

// list_for_each_entry 的实现原理：
#define list_for_each_entry(pos, head, member) \
    for (pos = list_entry((head)->next, typeof(*pos), member); \
         &pos->member != (head); \
         pos = list_entry(pos->member.next, typeof(*pos), member))
```

### 2. **实际内核代码示例**
```c
// 来自 inotify 的实际示例：

static struct inotify_watch *inode_find_handle(struct inode *inode,
                                               struct inotify_handle *ih) {
    struct inotify_watch *watch;
    
    // 遍历 inode->inotify_watches 链表
    list_for_each_entry(watch, &inode->inotify_watches, i_list) {
        if (watch->ih == ih) {
            return watch;  // 找到匹配的 watch
        }
    }
    
    return NULL;  // 未找到
}

// 数据结构：
struct inotify_watch {
    struct list_head i_list;  // 嵌入的链表节点
    struct inotify_handle *ih;
    // 其他成员...
};
```

---

## 3. 反向遍历

### 1. **list_for_each_entry_reverse**
```c
// 反向遍历链表：

void reverse_traversal() {
    // list_for_each_entry_reverse(pos, head, member)
    // 沿着 prev 指针向后遍历
    
    struct fox *current_fox;
    
    list_for_each_entry_reverse(current_fox, &fox_list, list) {
        // 从链表尾部开始向前遍历
        printk("Reverse: Fox tail=%lu\n", current_fox->tail_length);
    }
}

// 使用场景：
void reverse_traversal_use_cases() {
    // 1. 性能优化：如果目标节点可能在链表尾部附近
    // 2. 栈操作：实现 LIFO（后进先出）
    // 3. 特定顺序需求
    
    // 例如：删除最近添加的节点（栈）
    struct fox *latest_fox;
    if (!list_empty(&fox_list)) {
        latest_fox = list_entry(fox_list.prev, struct fox, list);
        list_del(&latest_fox->list);
        kfree(latest_fox);
    }
}
```

---

##  4. 遍历同时删除的安全方法

### 1. **问题演示**
```c
// 错误的删除方式：

void wrong_deletion_while_traversing() {
    struct fox *current_fox;
    
    // 错误：在遍历中直接删除节点
    list_for_each_entry(current_fox, &fox_list, list) {
        if (current_fox->weight > 10) {
            list_del(&current_fox->list);  // 危险！
            kfree(current_fox);            // 下次循环时 current_fox 已无效
        }
    }
    // 这会导致使用已释放内存的错误
}
```

### 2. **安全的删除方法**
```c
// list_for_each_entry_safe 宏：

void safe_deletion_while_traversing() {
    // list_for_each_entry_safe(pos, n, head, member)
    // pos: 当前节点指针
    // n: 下一个节点的临时指针（next）
    // head: 链表头
    // member: list_head 成员名
    
    struct fox *current_fox, *next_fox;
    
    list_for_each_entry_safe(current_fox, next_fox, &fox_list, list) {
        if (current_fox->weight > 10) {
            list_del(&current_fox->list);  // 安全删除
            kfree(current_fox);
            // next_fox 仍然有效，可以继续遍历
        }
    }
}

// 实现原理：
#define list_for_each_entry_safe(pos, n, head, member) \
    for (pos = list_entry((head)->next, typeof(*pos), member), \
         n = list_entry(pos->member.next, typeof(*pos), member); \
         &pos->member != (head); \
         pos = n, n = list_entry(n->member.next, typeof(*n), member))
```

### 3. **实际内核示例**
```c
// 来自 inotify 的实际删除示例：

void inotify_inode_is_dead(struct inode *inode) {
    struct inotify_watch *watch, *next;
    
    mutex_lock(&inode->inotify_mutex);
    
    // 安全地遍历并删除所有 watch
    list_for_each_entry_safe(watch, next, &inode->inotify_watches, i_list) {
        struct inotify_handle *ih = watch->ih;
        mutex_lock(&ih->mutex);
        inotify_remove_watch_locked(ih, watch);  // 删除 watch
        mutex_unlock(&ih->mutex);
    }
    
    mutex_unlock(&inode->inotify_mutex);
}
```

### 4. **反向安全删除**
```c
// list_for_each_entry_safe_reverse：

void reverse_safe_deletion() {
    struct fox *current_fox, *next_fox;
    
    // 反向安全遍历删除
    list_for_each_entry_safe_reverse(current_fox, next_fox, &fox_list, list) {
        if (current_fox->is_fantastic) {
            list_del(&current_fox->list);
            kfree(current_fox);
        }
    }
}
```

---

##  5. 并发安全考虑

### 1. **锁的重要性**
```c
// 并发访问的锁保护：

void concurrent_safe_traversal() {
    struct fox *current_fox;
    
    // 在多线程环境中需要加锁
    spin_lock(&fox_list_lock);  // 假设有锁
    
    list_for_each_entry(current_fox, &fox_list, list) {
        // 访问数据
        process_fox(current_fox);
    }
    
    spin_unlock(&fox_list_lock);
}

// 删除时的锁保护：
void concurrent_safe_deletion() {
    struct fox *current_fox, *next_fox;
    
    spin_lock(&fox_list_lock);
    
    list_for_each_entry_safe(current_fox, next_fox, &fox_list, list) {
        if (should_delete(current_fox)) {
            list_del(&current_fox->list);
            kfree(current_fox);
        }
    }
    
    spin_unlock(&fox_list_lock);
}
```

---

## 其他有用的遍历宏

### 1. **条件遍历**
```c
// 带条件的遍历：

void conditional_traversal() {
    struct fox *current_fox;
    
    // 从指定位置开始遍历
    list_for_each_entry_from(current_fox, &fox_list, list) {
        // 从 current_fox 开始遍历到链表末尾
        process_fox(current_fox);
    }
    
    // 遍历直到指定条件
    list_for_each_entry_continue(current_fox, &fox_list, list) {
        // 从当前位置继续遍历
        if (current_fox->weight > 20)
            break;
        process_fox(current_fox);
    }
}
```

### 2. **基础遍历宏总结**
```c
// 各种遍历宏的对比：

void traversal_macro_summary() {
    struct list_head *pos;
    struct fox *fox_entry, *n;
    
    // 1. 基础遍历
    list_for_each(pos, &fox_list) {
        fox_entry = list_entry(pos, struct fox, list);
    }
    
    // 2. 推荐遍历
    list_for_each_entry(fox_entry, &fox_list, list) {
        // 直接获取结构体指针
    }
    
    // 3. 反向遍历
    list_for_each_entry_reverse(fox_entry, &fox_list, list) {
        // 反向遍历
    }
    
    // 4. 安全遍历（可删除）
    list_for_each_entry_safe(fox_entry, n, &fox_list, list) {
        // 可以安全删除 fox_entry
    }
    
    // 5. 反向安全遍历
    list_for_each_entry_safe_reverse(fox_entry, n, &fox_list, list) {
        // 反向且可安全删除
    }
}
```

---

## 完整示例程序

### 1. **狐狸管理系统的完整实现**
```c
#include <linux/list.h>
#include <linux/kernel.h>
#include <linux/slab.h>

struct fox {
    unsigned long tail_length;
    unsigned long weight;
    bool is_fantastic;
    struct list_head list;
};

// 全局狐狸链表
static LIST_HEAD(global_fox_list);
static DEFINE_SPINLOCK(fox_list_lock);

// 添加狐狸
int add_fox(unsigned long tail, unsigned long weight, bool fantastic) {
    struct fox *new_fox = kmalloc(sizeof(*new_fox), GFP_KERNEL);
    if (!new_fox)
        return -ENOMEM;
    
    new_fox->tail_length = tail;
    new_fox->weight = weight;
    new_fox->is_fantastic = fantastic;
    INIT_LIST_HEAD(&new_fox->list);
    
    spin_lock(&fox_list_lock);
    list_add_tail(&new_fox->list, &global_fox_list);
    spin_unlock(&fox_list_lock);
    
    return 0;
}

// 打印所有狐狸
void print_all_foxes(void) {
    struct fox *current_fox;
    
    spin_lock(&fox_list_lock);
    list_for_each_entry(current_fox, &global_fox_list, list) {
        printk("Fox: tail=%lu, weight=%lu, fantastic=%s\n",
               current_fox->tail_length,
               current_fox->weight,
               current_fox->is_fantastic ? "yes" : "no");
    }
    spin_unlock(&fox_list_lock);
}

// 删除重狐狸
void remove_heavy_foxes(unsigned long max_weight) {
    struct fox *current_fox, *next_fox;
    
    spin_lock(&fox_list_lock);
    list_for_each_entry_safe(current_fox, next_fox, &global_fox_list, list) {
        if (current_fox->weight > max_weight) {
            printk("Removing heavy fox: weight=%lu\n", current_fox->weight);
            list_del(&current_fox->list);
            kfree(current_fox);
        }
    }
    spin_unlock(&fox_list_lock);
}

// 清理所有狐狸
void cleanup_all_foxes(void) {
    struct fox *current_fox, *next_fox;
    
    spin_lock(&fox_list_lock);
    list_for_each_entry_safe(current_fox, next_fox, &global_fox_list, list) {
        list_del(&current_fox->list);
        kfree(current_fox);
    }
    spin_unlock(&fox_list_lock);
}
```

**链表遍历的核心要点**：

### **遍历方法**：
1. **基础遍历**：`list_for_each()` + `list_entry()`
2. **推荐遍历**：`list_for_each_entry()`
3. **反向遍历**：`list_for_each_entry_reverse()`
4. **安全遍历**：`list_for_each_entry_safe()`
5. **反向安全**：`list_for_each_entry_safe_reverse()`

### **复杂度**：
- **遍历操作**：O(n) - 需要访问每个节点
- **单次操作**：O(1) - 每次指针移动是常数时间

### **安全注意事项**：
1. **删除时使用安全版本**：避免使用已释放内存
2. **并发访问需要加锁**：防止竞态条件
3. **正确使用宏参数**：注意参数顺序和类型

### **最佳实践**：
```c
// 推荐的遍历模式：
struct my_struct *pos, *n;

// 遍历：
list_for_each_entry(pos, &my_list, list_member) {
    // 处理 pos
}

// 安全遍历（可删除）：
list_for_each_entry_safe(pos, n, &my_list, list_member) {
    if (should_delete(pos)) {
        list_del(&pos->list);
        kfree(pos);
    }
}
```
