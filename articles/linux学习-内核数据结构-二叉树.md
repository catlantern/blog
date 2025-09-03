##  二叉树基本概念

### 1. **树的基本定义**
```c
// 树的基本概念：

void tree_concept() {
    /*
     * 树的定义：
     * - 无环的连通有向图
     * - 每个节点有0个或多个出边（子节点）
     * - 每个节点有0个或1个入边（父节点）
     * - 有一个特殊的根节点（无父节点）
     * 
     * 二叉树：
     * - 每个节点最多有2个子节点
     * - 左子节点和右子节点
     */
}

// 树的基本术语：
void tree_terminology() {
    /*
     * 节点深度：从根到该节点的路径长度
     * 树的高度：最大节点深度
     * 叶子节点：没有子节点的节点
     * 内部节点：有子节点的节点
     * 子树：以某个节点为根的树
     */
}
```

---

![9](/blog/articles/images/9.png)

##  二叉搜索树（BST）

### 1. **BST 的性质**
```c
// 二叉搜索树的性质：

void bst_properties() {
    /*
     * BST 的有序性：
     * 1. 左子树所有节点值 < 根节点值
     * 2. 右子树所有节点值 > 根节点值
     * 3. 左右子树也都是 BST
     * 
     * 示例 BST：
     *       8
     *      / \
     *     3   10
     *    / \    \
     *   1   6    14
     *      / \   /
     *     4   7 13
     */
}

// BST 节点定义：
struct bst_node {
    int data;
    struct bst_node *left;
    struct bst_node *right;
};
```

### 2. **BST 基本操作**
```c
// BST 的基本操作实现：

// 查找操作
struct bst_node *bst_search(struct bst_node *root, int key) {
    if (root == NULL || root->data == key) {
        return root;
    }
    
    if (key < root->data) {
        return bst_search(root->left, key);
    } else {
        return bst_search(root->right, key);
    }
}

// 插入操作
struct bst_node *bst_insert(struct bst_node *root, int key) {
    if (root == NULL) {
        struct bst_node *new_node = malloc(sizeof(struct bst_node));
        new_node->data = key;
        new_node->left = new_node->right = NULL;
        return new_node;
    }
    
    if (key < root->data) {
        root->left = bst_insert(root->left, key);
    } else if (key > root->data) {
        root->right = bst_insert(root->right, key);
    }
    // 如果 key == root->data，不插入重复值
    
    return root;
}

// 中序遍历（有序输出）
void bst_inorder_traversal(struct bst_node *root) {
    if (root != NULL) {
        bst_inorder_traversal(root->left);
        printf("%d ", root->data);
        bst_inorder_traversal(root->right);
    }
}
```

### 3. **BST 性能分析**
```c
// BST 的性能特点：

void bst_performance() {
    /*
     * 理想情况（平衡树）：
     * - 查找：O(log n)
     * - 插入：O(log n)
     * - 删除：O(log n)
     * 
     * 最坏情况（退化为链表）：
     * - 查找：O(n)
     * - 插入：O(n)
     * - 删除：O(n)
     * 
     * 示例：插入 1,2,3,4,5,6,7
     * 1
     *  \
     *   2
     *    \
     *     3
     *      \
     *       4
     *        \
     *         5
     *          \
     *           6
     *            \
     *             7
     */
}
```

---

![10](/blog/articles/images/10.png)

##  6.4.2 自平衡二叉搜索树

### 1. **平衡树的概念**
```c
// 平衡树的定义：

void balanced_tree_concept() {
    /*
     * 平衡二叉树：
     * - 所有叶子节点深度差不超过1
     * - 保持树的高度为 O(log n)
     * 
     * 自平衡二叉搜索树：
     * - 在插入/删除时自动调整保持平衡
     * - 确保操作的 O(log n) 复杂度
     */
}

// 树的平衡因子：
int get_balance_factor(struct bst_node *node) {
    if (node == NULL) return 0;
    return get_height(node->left) - get_height(node->right);
}

int get_height(struct bst_node *node) {
    if (node == NULL) return 0;
    return 1 + max(get_height(node->left), get_height(node->right));
}
```

---

![11](/blog/public/articles/images/11.png)

##  红黑树详解

### 1. **红黑树的性质**
```c
// 红黑树的六个性质：

void rbtree_properties() {
    /*
     * 红黑树性质：
     * 1. 每个节点要么红色，要么黑色
     * 2. 根节点是黑色
     * 3. 所有叶子节点（NIL节点）是黑色
     * 4. 红色节点的子节点都是黑色（没有连续的红色节点）
     * 5. 从任一节点到其每个叶子的所有路径都包含相同数目的黑色节点
     * 
     * 结果：
     * - 最长路径 ≤ 2 × 最短路径
     * - 树的高度 ≤ 2log(n+1)
     */
}

// 红黑树节点定义（Linux 内核）：
struct rb_node {
    unsigned long  rb_parent_color;  // 父节点指针和颜色
    struct rb_node *rb_right;
    struct rb_node *rb_left;
} __attribute__((aligned(sizeof(long))));

struct rb_root {
    struct rb_node *rb_node;
};
```

### 2. **红黑树的平衡保证**
```c
// 红黑树平衡性分析：

void rbtree_balance_analysis() {
    /*
     * 为什么红黑树是半平衡的？
     * 
     * 关键性质5：所有路径的黑色节点数相同
     * 
     * 最短路径：全是黑色节点
     * 最长路径：红黑交替的路径
     * 
     * 因此：最长路径 ≤ 2 × 最短路径
     * 
     * 举例：
     * 最短路径：B-B-B (3个黑色)
     * 最长路径：B-R-B-R-B (3个黑色，5个节点)
     */
}
```

---

##  Linux 内核 rbtree

### 1. **rbtree 初始化**
```c
// rbtree 的初始化：

#include <linux/rbtree.h>

void rbtree_initialization() {
    // 方法1：静态初始化
    struct rb_root my_tree = RB_ROOT;
    
    // 方法2：动态初始化
    struct rb_root dynamic_tree;
    dynamic_tree.rb_node = NULL;
    
    // 检查树是否为空
    if (RB_EMPTY_ROOT(&my_tree)) {
        printk("Tree is empty\n");
    }
}

// 实际使用示例：
struct process_tree {
    struct rb_root process_root;
};

void init_process_tree(struct process_tree *tree) {
    tree->process_root = RB_ROOT;
}
```

### 2. **rbtree 节点操作**
```c
// rbtree 节点定义：

struct my_data {
    int key;
    char name[32];
    struct rb_node node;  // 嵌入的 rb_node
};

// 获取包含 rb_node 的结构体：
#define rb_entry(ptr, type, member) container_of(ptr, type, member)

// 插入节点：
void rbtree_insert_example() {
    struct rb_root *root = &my_tree;
    struct my_data *new_data = kmalloc(sizeof(*new_data), GFP_KERNEL);
    new_data->key = 42;
    strcpy(new_data->name, "test");
    
    struct rb_node **new = &(root->rb_node);
    struct rb_node *parent = NULL;
    
    // 查找插入位置
    while (*new) {
        struct my_data *this = rb_entry(*new, struct my_data, node);
        parent = *new;
        
        if (new_data->key < this->key) {
            new = &((*new)->rb_left);
        } else if (new_data->key > this->key) {
            new = &((*new)->rb_right);
        } else {
            // 键已存在
            kfree(new_data);
            return;
        }
    }
    
    // 插入新节点
    rb_link_node(&new_data->node, parent, new);
    rb_insert_color(&new_data->node, root);
}
```

---

## 代码详解

### 1. **页缓存搜索示例**
```c
// 页缓存搜索函数详解：

struct page *rb_search_page_cache(struct inode *inode, unsigned long offset) {
    // 获取 inode 的 rbtree 根节点
    struct rb_node *n = inode->i_rb_page_cache.rb_node;
    
    // 遍历树查找匹配的 offset
    while (n) {
        // 通过 rb_entry 获取包含 rb_node 的 page 结构
        struct page *page = rb_entry(n, struct page, rb_page_cache);
        
        if (offset < page->offset) {
            // 目标在左子树
            n = n->rb_left;
        } else if (offset > page->offset) {
            // 目标在右子树
            n = n->rb_right;
        } else {
            // 找到匹配的页
            return page;
        }
    }
    
    // 未找到
    return NULL;
}

// 搜索过程分析：
void search_process_analysis() {
    /*
     * 搜索过程：
     * 1. 从根节点开始
     * 2. 比较 offset 与当前节点 offset
     * 3. 根据比较结果决定向左或向右移动
     * 4. 找到匹配节点或到达叶子节点
     * 
     * 时间复杂度：O(log n)
     */
}
```

### 2. **页缓存插入示例**
```c
// 页缓存插入函数详解：

struct page *rb_insert_page_cache(struct inode *inode,
                                  unsigned long offset,
                                  struct rb_node *node) {
    // 获取根节点的地址指针
    struct rb_node **p = &inode->i_rb_page_cache.rb_node;
    struct rb_node *parent = NULL;
    struct page *page;
    
    // 查找插入位置
    while (*p) {
        parent = *p;
        page = rb_entry(parent, struct page, rb_page_cache);
        
        if (offset < page->offset) {
            p = &(*p)->rb_left;
        } else if (offset > page->offset) {
            p = &(*p)->rb_right;
        } else {
            // offset 已存在，返回已存在的页
            return page;
        }
    }
    
    // 找到插入位置，链接节点
    rb_link_node(node, parent, p);
    
    // 执行颜色调整和旋转操作以保持红黑树性质
    rb_insert_color(node, &inode->i_rb_page_cache);
    
    return NULL;  // 成功插入
}

// 插入过程分析：
void insert_process_analysis() {
    /*
     * 插入过程：
     * 1. 查找插入位置（类似搜索）
     * 2. 使用 rb_link_node 链接新节点
     * 3. 使用 rb_insert_color 调整树结构
     * 
     * rb_insert_color 的作用：
     * - 检查是否违反红黑树性质
     * - 执行必要的旋转和重新着色
     * - 恢复红黑树性质
     */
}
```

---

## rbtree 辅助函数

### 1. **常用辅助函数**
```c
// rbtree 提供的辅助函数：

void rbtree_helper_functions() {
    /*
     * 主要辅助函数：
     * 
     * rb_link_node() - 链接节点到指定位置
     * rb_insert_color() - 插入后调整颜色
     * rb_erase() - 删除节点
     * rb_next() - 获取中序后继
     * rb_prev() - 获取中序前驱
     * rb_first() - 获取最小节点
     * rb_last() - 获取最大节点
     */
}

// 遍历 rbtree：
void rbtree_traversal() {
    struct rb_node *node;
    
    // 正向遍历（升序）
    for (node = rb_first(&my_tree); node; node = rb_next(node)) {
        struct my_data *data = rb_entry(node, struct my_data, node);
        printk("Key: %d, Name: %s\n", data->key, data->name);
    }
    
    // 反向遍历（降序）
    for (node = rb_last(&my_tree); node; node = rb_prev(node)) {
        struct my_data *data = rb_entry(node, struct my_data, node);
        printk("Key: %d, Name: %s\n", data->key, data->name);
    }
}

// 删除节点：
void rbtree_delete() {
    struct my_data *data_to_delete = find_data_to_delete();
    
    if (data_to_delete) {
        rb_erase(&data_to_delete->node, &my_tree);
        kfree(data_to_delete);
    }
}
```

---

##  实际应用示例

### 1. **进程调度器中的使用**
```c
// 进程调度器中的 rbtree 应用：

struct task_struct {
    struct rb_node sleep_runnable;  // 用于调度队列
    unsigned long deadline;         // 截止时间
    // 其他成员...
};

// 基于截止时间的调度：
void deadline_scheduling_example() {
    struct rb_root deadline_tree = RB_ROOT;
    
    // 插入进程到调度树
    struct rb_node **p = &deadline_tree.rb_node;
    struct rb_node *parent = NULL;
    
    while (*p) {
        struct task_struct *task = rb_entry(*p, struct task_struct, sleep_runnable);
        parent = *p;
        
        if (new_task->deadline < task->deadline) {
            p = &(*p)->rb_left;
        } else {
            p = &(*p)->rb_right;
        }
    }
    
    rb_link_node(&new_task->sleep_runnable, parent, p);
    rb_insert_color(&new_task->sleep_runnable, &deadline_tree);
    
    // 选择最早截止的进程
    struct rb_node *first = rb_first(&deadline_tree);
    if (first) {
        struct task_struct *next_task = rb_entry(first, struct task_struct, sleep_runnable);
        schedule_task(next_task);
    }
}
```

**rbtree 的核心要点**：

### **基本概念**：
- **红黑树性质**：6条规则保证半平衡
- **时间复杂度**：所有操作 O(log n)
- **空间复杂度**：O(n)

### **核心操作**：
1. **搜索**：`rb_search_page_cache()` 模式
2. **插入**：查找 + 链接 + 调整颜色
3. **删除**：`rb_erase()` + 重新平衡
4. **遍历**：`rb_first()`/`rb_next()` 或 `rb_last()`/`rb_prev()`

### **使用模式**：
```c
// 标准插入模式：
struct rb_node **new = &(root->rb_node);
struct rb_node *parent = NULL;

while (*new) {
    // 比较逻辑
    parent = *new;
    if (key < this->key)
        new = &(*new)->rb_left;
    else if (key > this->key)
        new = &(*new)->rb_right;
    else
        return;  // 已存在
}

rb_link_node(&data->node, parent, new);
rb_insert_color(&data->node, root);
```

### **关键函数**：
- `RB_ROOT` - 初始化根节点
- `rb_entry()` - 获取包含结构体
- `rb_link_node()` - 链接节点
- `rb_insert_color()` - 插入后调整
- `rb_erase()` - 删除节点
