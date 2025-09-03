##  映射（Map）

### 1. **映射的基本概念**
```c
// 映射是一种键值对（Key-Value）数据结构

void map_concept() {
    /*
     * 映射的核心思想：
     * - 每个键（Key）唯一对应一个值（Value）
     * - 通过键可以快速查找对应的值
     * - 类似于字典：单词 -> 定义
     * 
     * 示例：
     * "apple"  -> "苹果"
     * "banana" -> "香蕉"  
     * "cat"    -> "猫"
     */
}

// 映射的特点：
void map_characteristics() {
    /*
     * 1. 唯一性：每个键只能出现一次
     * 2. 关联性：键和值之间存在关联关系
     * 3. 查找性：通过键可以快速找到值
     * 4. 动态性：可以动态添加、删除、修改键值对
     */
}
```

---

## 映射的基本操作

### 1. **核心操作**
```c
// 映射的三个基本操作：

struct map_operations {
    // 1. 插入/更新：添加键值对或更新已有键的值
    void insert(key, value);
    
    // 2. 查找：根据键查找对应的值
    value = lookup(key);
    
    // 3. 删除：根据键删除键值对
    void remove(key);
};

// 实际使用示例：
void basic_map_usage() {
    /*
     * 电话簿映射示例：
     * 
     * 插入：
     * add("张三", "13800138000")
     * add("李四", "13900139000")
     * 
     * 查找：
     * lookup("张三") -> "13800138000"
     * 
     * 删除：
     * remove("李四")
     */
}
```

---

##  映射的实现方式

### 1. **数组实现**
```c
// 简单的数组映射（适用于整数键）：

#define MAX_KEYS 1000

struct array_map {
    int values[MAX_KEYS];
    bool occupied[MAX_KEYS];  // 标记键是否存在
};

// 插入
void array_map_insert(struct array_map *map, int key, int value) {
    if (key >= 0 && key < MAX_KEYS) {
        map->values[key] = value;
        map->occupied[key] = true;
    }
}

// 查找
int array_map_lookup(struct array_map *map, int key) {
    if (key >= 0 && key < MAX_KEYS && map->occupied[key]) {
        return map->values[key];
    }
    return -1;  // 键不存在
}

// 删除
void array_map_remove(struct array_map *map, int key) {
    if (key >= 0 && key < MAX_KEYS) {
        map->occupied[key] = false;
    }
}
```

### 2. **链表实现**
```c
// 链表映射实现：

struct map_node {
    char *key;
    int value;
    struct map_node *next;
};

struct linked_map {
    struct map_node *head;
};

// 插入/更新
void linked_map_insert(struct linked_map *map, const char *key, int value) {
    // 先查找是否已存在
    struct map_node *current = map->head;
    while (current) {
        if (strcmp(current->key, key) == 0) {
            current->value = value;  // 更新值
            return;
        }
        current = current->next;
    }
    
    // 不存在，创建新节点
    struct map_node *new_node = malloc(sizeof(struct map_node));
    new_node->key = strdup(key);
    new_node->value = value;
    new_node->next = map->head;
    map->head = new_node;
}

// 查找
int linked_map_lookup(struct linked_map *map, const char *key) {
    struct map_node *current = map->head;
    while (current) {
        if (strcmp(current->key, key) == 0) {
            return current->value;
        }
        current = current->next;
    }
    return -1;  // 未找到
}
```

### 3. **散列表实现**
```c
// 散列表映射实现：

#define HASH_TABLE_SIZE 101

struct hash_node {
    char *key;
    int value;
    struct hash_node *next;
};

struct hash_map {
    struct hash_node *buckets[HASH_TABLE_SIZE];
};

// 简单的散列函数
unsigned int hash(const char *key) {
    unsigned int hash_value = 0;
    while (*key) {
        hash_value = hash_value * 31 + *key;
        key++;
    }
    return hash_value % HASH_TABLE_SIZE;
}

// 插入/更新
void hash_map_insert(struct hash_map *map, const char *key, int value) {
    unsigned int index = hash(key);
    
    // 在链表中查找
    struct hash_node *current = map->buckets[index];
    while (current) {
        if (strcmp(current->key, key) == 0) {
            current->value = value;  // 更新
            return;
        }
        current = current->next;
    }
    
    // 不存在，创建新节点
    struct hash_node *new_node = malloc(sizeof(struct hash_node));
    new_node->key = strdup(key);
    new_node->value = value;
    new_node->next = map->buckets[index];
    map->buckets[index] = new_node;
}

// 查找
int hash_map_lookup(struct hash_map *map, const char *key) {
    unsigned int index = hash(key);
    struct hash_node *current = map->buckets[index];
    
    while (current) {
        if (strcmp(current->key, key) == 0) {
            return current->value;
        }
        current = current->next;
    }
    return -1;  // 未找到
}
```

### 4. **二叉搜索树实现**
```c
// 二叉搜索树映射实现：

struct bst_node {
    char *key;
    int value;
    struct bst_node *left;
    struct bst_node *right;
};

struct bst_map {
    struct bst_node *root;
};

// 插入（递归）
struct bst_node *bst_insert(struct bst_node *node, const char *key, int value) {
    if (node == NULL) {
        struct bst_node *new_node = malloc(sizeof(struct bst_node));
        new_node->key = strdup(key);
        new_node->value = value;
        new_node->left = new_node->right = NULL;
        return new_node;
    }
    
    int cmp = strcmp(key, node->key);
    if (cmp < 0) {
        node->left = bst_insert(node->left, key, value);
    } else if (cmp > 0) {
        node->right = bst_insert(node->right, key, value);
    } else {
        node->value = value;  // 更新值
    }
    
    return node;
}

// 查找
int bst_lookup(struct bst_node *node, const char *key) {
    if (node == NULL) {
        return -1;
    }
    
    int cmp = strcmp(key, node->key);
    if (cmp < 0) {
        return bst_lookup(node->left, key);
    } else if (cmp > 0) {
        return bst_lookup(node->right, key);
    } else {
        return node->value;
    }
}
```

---

##  映射的应用场景

### 1. **日常应用**
```c
// 映射的常见应用：

void common_applications() {
    /*
     * 1. 数据库索引：
     *    主键 -> 记录位置
     * 
     * 2. 缓存系统：
     *    键 -> 缓存数据
     * 
     * 3. 配置管理：
     *    配置项名 -> 配置值
     * 
     * 4. 符号表：
     *    变量名 -> 内存地址
     * 
     * 5. 网络路由：
     *    IP地址 -> 路由信息
     * 
     * 6. 文件系统：
     *    文件名 -> inode号
     */
}
```

### 2. **编程语言中的映射**
```c
// 各语言中的映射实现：

void language_examples() {
    /*
     * C++: std::map, std::unordered_map
     * Java: HashMap, TreeMap
     * Python: dict
     * JavaScript: Object, Map
     * Go: map
     * 
     * 示例（Python）：
     * phone_book = {
     *     "张三": "13800138000",
     *     "李四": "13900139000"
     * }
     * 
     * print(phone_book["张三"])  # 查找
     * phone_book["王五"] = "13700137000"  # 插入
     * del phone_book["李四"]  # 删除
     */
}
```

---

##  映射的性能分析

### 1. **时间复杂度比较**
```c
// 不同实现方式的性能：

void performance_comparison() {
    /*
     *                  平均情况      最坏情况
     * 数组映射:        O(1) insert   O(1)      (仅适用于整数键)
     * 链表映射:        O(n)          O(n)
     * 散列表:          O(1)          O(n)      (理想情况)
     * 二叉搜索树:      O(log n)      O(n)      (平衡树为 O(log n))
     * 
     * 空间复杂度：
     * 数组映射:        O(最大键值)
     * 其他实现:        O(n)
     */
}
```

### 2. **选择建议**
```c
// 如何选择映射实现：

void implementation_choice() {
    /*
     * 选择标准：
     * 
     * 1. 键的类型：
     *    - 整数且范围小 → 数组
     *    - 任意类型 → 散列表或树
     * 
     * 2. 性能要求：
     *    - 需要 O(1) 查找 → 散列表
     *    - 需要有序遍历 → 二叉搜索树
     * 
     * 3. 内存使用：
     *    - 内存紧张 → 链表实现
     *    - 内存充足 → 散列表
     * 
     * 4. 数据分布：
     *    - 键分布均匀 → 散列表
     *    - 键可能冲突 → 树结构
     */
}
```

---

##  映射的高级特性

### 1. **多值映射**
```c
// 一个键对应多个值：

struct multimap {
    char *key;
    struct list_head values;  // 值的链表
};

void multimap_example() {
    /*
     * 示例：学生选课系统
     * "张三" -> ["数学", "物理", "化学"]
     * "李四" -> ["数学", "英语"]
     */
}
```

### 2. **并发安全映射**
```c
// 线程安全的映射：

struct thread_safe_map {
    struct hash_map map;
    pthread_mutex_t lock;
};

void thread_safe_operations() {
    /*
     * 在操作前后加锁：
     * pthread_mutex_lock(&map->lock);
     * // 执行映射操作
     * pthread_mutex_unlock(&map->lock);
     */
}
```

**映射的核心要点**：

### **基本概念**：
- **键值对**：每个键唯一对应一个值
- **三大操作**：插入、查找、删除
- **唯一性**：键不能重复

### **实现方式**：
1. **数组**：简单但仅适用于整数键
2. **链表**：简单但查找效率低
3. **散列表**：高效但可能冲突
4. **二叉搜索树**：有序且稳定

### **性能特点**：
- **散列表**：平均 O(1) 查找
- **搜索树**：O(log n) 查找，支持有序遍历
- **选择依据**：根据具体需求选择实现方式

### **应用场景**：
- 数据库索引
- 缓存系统
- 配置管理
- 符号表
- 网络路由



IDR 是 Linux 内核专门设计的整数 ID 到指针映射数据结构，通过两步分配机制和基数树实现，在内核中广泛用于文件描述符、定时器等需要唯一标识符的场景！

##  Linux 内核 IDR 介绍

### 1. **IDR 的设计目标**
```c
// IDR 的特点和用途：

void idr_purpose() {
    /*
     * IDR (ID Radix) 的设计目标：
     * 1. 映射整数 ID 到指针
     * 2. 支持动态分配唯一 ID
     * 3. 高效的查找操作
     * 4. 内核环境优化
     * 
     * 实际应用：
     * - 文件描述符映射
     * - inotify watch 描述符
     * - POSIX 定时器 ID
     * - 设备号映射
     */
}

// 数据结构定义：
struct idr {
    struct radix_tree_root idr_rt;  // 基数树根节点
    unsigned int           idr_base; // 基础 ID 值
    unsigned int           idr_next; // 下一个可用 ID
};
```

---

## 初始化 IDR

### 1. **IDR 初始化**
```c
// IDR 的初始化：

#include <linux/idr.h>

void idr_initialization() {
    // 方法1：静态定义并初始化
    struct idr my_idr;
    idr_init(&my_idr);
    
    // 方法2：动态分配
    struct idr *dynamic_idr = kmalloc(sizeof(struct idr), GFP_KERNEL);
    if (dynamic_idr) {
        idr_init(dynamic_idr);
        // 使用...
        idr_destroy(dynamic_idr);
        kfree(dynamic_idr);
    }
}

// 实际使用示例：
struct file_descriptor_manager {
    struct idr fd_idr;      // 文件描述符映射
    struct mutex fd_lock;   // 保护 IDR 的锁
};

void init_fd_manager(struct file_descriptor_manager *mgr) {
    idr_init(&mgr->fd_idr);
    mutex_init(&mgr->fd_lock);
}
```

---

##  分配新的 UID

### 1. **两步分配机制**
```c
// IDR 分配新 ID 的两步过程：

void idr_allocation_process() {
    /*
     * 为什么需要两步分配？
     * 1. idr_pre_get() - 预分配内存（可能睡眠）
     * 2. idr_get_new() - 实际分配 ID（原子操作）
     * 
     * 这样设计的原因：
     * - 在无锁环境中安全分配
     * - 避免在原子上下文中分配内存
     * - 提高并发性能
     */
}

// 基本分配示例：
int basic_id_allocation(struct idr *idp, void *ptr) {
    int id;
    int ret;
    
    do {
        // 第一步：预分配内存
        if (!idr_pre_get(idp, GFP_KERNEL)) {
            return -ENOMEM;  // 内存分配失败
        }
        
        // 第二步：实际分配 ID
        ret = idr_get_new(idp, ptr, &id);
        
        // 如果返回 -EAGAIN，需要重新预分配
    } while (ret == -EAGAIN);
    
    if (ret) {
        return ret;  // 其他错误
    }
    
    return id;  // 返回分配的 ID
}
```

### 2. **指定起始 ID 的分配**
```c
// 从指定 ID 开始分配：

int allocate_id_above(struct idr *idp, void *ptr, int starting_id) {
    int id;
    int ret;
    
    do {
        if (!idr_pre_get(idp, GFP_KERNEL)) {
            return -ENOMEM;
        }
        
        // idr_get_new_above() 确保分配的 ID >= starting_id
        ret = idr_get_new_above(idp, ptr, starting_id, &id);
    } while (ret == -EAGAIN);
    
    if (ret) {
        return ret;
    }
    
    return id;
}

// 实际应用示例：
void unique_id_allocation() {
    struct idr my_idr;
    static int next_unique_id = 1;
    void *data = create_data();
    
    idr_init(&my_idr);
    
    // 确保 ID 的唯一性
    int id = allocate_id_above(&my_idr, data, next_unique_id);
    if (id >= 0) {
        next_unique_id = id + 1;  // 更新下一个 ID
        printk("Allocated unique ID: %d\n", id);
    }
}
```

---

## 查找 UID

### 1. **IDR 查找操作**
```c
// 查找已分配的 ID：

void *idr_find_example(struct idr *idp, int id) {
    // idr_find(struct idr *idp, int id)
    // 成功：返回关联的指针
    // 失败：返回 NULL
    
    void *ptr = idr_find(idp, id);
    if (!ptr) {
        printk("ID %d not found\n", id);
        return ERR_PTR(-ENOENT);
    }
    
    return ptr;
}

// 安全的查找示例：
struct my_data *safe_lookup(struct idr *idp, int id) {
    struct my_data *data;
    
    data = idr_find(idp, id);
    if (!data) {
        return ERR_PTR(-ENOENT);  // ID 不存在
    }
    
    // 注意：如果原始指针就是 NULL，这里无法区分
    // 所以不要将 NULL 映射到 ID
    
    return data;
}

// 实际应用示例：
struct file *get_file_by_fd(struct file_descriptor_manager *mgr, int fd) {
    struct file *file;
    
    mutex_lock(&mgr->fd_lock);
    file = idr_find(&mgr->fd_idr, fd);
    mutex_unlock(&mgr->fd_lock);
    
    if (!file) {
        return ERR_PTR(-EBADF);  // 无效的文件描述符
    }
    
    return file;
}
```

---

## 删除 UID

### 1. **IDR 删除操作**
```c
// 从 IDR 中删除 ID：

void idr_remove_example(struct idr *idp, int id) {
    // idr_remove(struct idr *idp, int id)
    // 删除指定 ID 及其关联的指针
    
    idr_remove(idp, id);
    
    // 注意：
    // - 不返回错误码
    // - 即使 ID 不存在也不会报错
    // - 只是简单地从树中删除
}

// 安全的删除示例：
int safe_remove(struct idr *idp, int id) {
    // 先查找确认存在
    void *ptr = idr_find(idp, id);
    if (!ptr) {
        return -ENOENT;  // ID 不存在
    }
    
    // 删除
    idr_remove(idp, id);
    
    // 释放关联的数据（如果需要）
    kfree(ptr);
    
    return 0;
}

// 实际应用示例：
int close_file_descriptor(struct file_descriptor_manager *mgr, int fd) {
    struct file *file;
    int ret = 0;
    
    mutex_lock(&mgr->fd_lock);
    
    file = idr_find(&mgr->fd_idr, fd);
    if (!file) {
        ret = -EBADF;
        goto out;
    }
    
    // 从 IDR 中删除
    idr_remove(&mgr->fd_idr, fd);
    
    // 释放文件资源
    release_file(file);
    
out:
    mutex_unlock(&mgr->fd_lock);
    return ret;
}
```

---

##  撤销 IDR

### 1. **IDR 清理操作**
```c
// IDR 的清理：

void idr_cleanup() {
    struct idr my_idr;
    
    idr_init(&my_idr);
    
    // 使用 IDR...
    use_idr(&my_idr);
    
    // 清理所有 ID（可选）
    idr_remove_all(&my_idr);
    
    // 销毁 IDR
    idr_destroy(&my_idr);
}

// idr_remove_all() vs idr_destroy()：
void cleanup_difference() {
    struct idr idr;
    void *data1, *data2;
    
    idr_init(&idr);
    
    // 分配一些 ID
    idr_get_new(&idr, data1, &some_id1);
    idr_get_new(&idr, data2, &some_id2);
    
    // idr_remove_all(): 删除所有 ID 映射，但不释放 IDR 结构
    idr_remove_all(&idr);
    // 此时 IDR 结构仍然存在，可以继续使用
    
    // idr_destroy(): 释放 IDR 内部结构
    idr_destroy(&idr);
    // 此时 IDR 完全释放，需要重新初始化才能使用
}
```

---

## 完整使用示例

### 1. **文件描述符管理器**
```c
#include <linux/idr.h>
#include <linux/mutex.h>
#include <linux/slab.h>

struct file_descriptor_manager {
    struct idr fd_idr;
    struct mutex fd_lock;
    int next_fd;
};

// 初始化
int fd_manager_init(struct file_descriptor_manager *mgr) {
    idr_init(&mgr->fd_idr);
    mutex_init(&mgr->fd_lock);
    mgr->next_fd = 0;
    return 0;
}

// 分配文件描述符
int allocate_fd(struct file_descriptor_manager *mgr, struct file *file) {
    int fd;
    int ret;
    
    mutex_lock(&mgr->fd_lock);
    
    do {
        if (!idr_pre_get(&mgr->fd_idr, GFP_KERNEL)) {
            ret = -ENOMEM;
            break;
        }
        
        ret = idr_get_new_above(&mgr->fd_idr, file, mgr->next_fd, &fd);
    } while (ret == -EAGAIN);
    
    if (ret == 0) {
        mgr->next_fd = fd + 1;
    }
    
    mutex_unlock(&mgr->fd_lock);
    return ret ? ret : fd;
}

// 查找文件
struct file *get_file(struct file_descriptor_manager *mgr, int fd) {
    struct file *file;
    
    mutex_lock(&mgr->fd_lock);
    file = idr_find(&mgr->fd_idr, fd);
    mutex_unlock(&mgr->fd_lock);
    
    return file;
}

// 关闭文件描述符
int close_fd(struct file_descriptor_manager *mgr, int fd) {
    struct file *file;
    int ret = 0;
    
    mutex_lock(&mgr->fd_lock);
    
    file = idr_find(&mgr->fd_idr, fd);
    if (!file) {
        ret = -EBADF;
        goto out;
    }
    
    idr_remove(&mgr->fd_idr, fd);
    // 释放 file 资源...
    
out:
    mutex_unlock(&mgr->fd_lock);
    return ret;
}

// 清理
void fd_manager_cleanup(struct file_descriptor_manager *mgr) {
    idr_remove_all(&mgr->fd_idr);
    idr_destroy(&mgr->fd_idr);
}
```

---

##  IDR 的性能特点

### 1. **时间和空间复杂度**
```c
// IDR 的性能分析：

void idr_performance() {
    /*
     * 时间复杂度：
     * - 分配 ID: O(log n) 平均，O(n) 最坏
     * - 查找 ID: O(log n) 平均，O(n) 最坏
     * - 删除 ID: O(log n) 平均，O(n) 最坏
     * 
     * 空间复杂度：
     * - O(n) 存储 n 个 ID
     * - 内部使用基数树，空间效率高
     * 
     * 优势：
     * - 动态大小调整
     * - 支持稀疏 ID 分配
     * - 内核环境优化
     * - 线程安全（配合锁使用）
     */
}
```

**IDR 的核心要点**：

### **初始化**：
- `idr_init()` - 初始化 IDR 结构
- 支持静态和动态分配

### **分配 ID**：
- `idr_pre_get()` + `idr_get_new()` - 两步分配
- `idr_get_new_above()` - 指定起始 ID 分配

### **操作**：
- `idr_find()` - 查找 ID
- `idr_remove()` - 删除 ID
- `idr_remove_all()` - 删除所有 ID
- `idr_destroy()` - 销毁 IDR

### **使用模式**：
```c
// 标准使用模式：
int id;
do {
    if (!idr_pre_get(&idr, GFP_KERNEL))
        return -ENOMEM;
} while (idr_get_new(&idr, ptr, &id) == -EAGAIN);

// 查找：
void *ptr = idr_find(&idr, id);

// 删除：
idr_remove(&idr, id);

// 清理：
idr_remove_all(&idr);
idr_destroy(&idr);
```

