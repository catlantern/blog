## 设备类型

### 1. **设备分类**
```c
// Linux设备类型：

void device_types() {
    /*
     * 三种主要设备类型：
     * 
     * 1. 块设备 (Block Device)
     *    - 可寻址，以块为单位访问
     *    - 支持随机访问和重定位
     *    - 通过设备节点访问
     *    - 通常挂载为文件系统
     *    - 例子：硬盘、光盘、Flash存储
     * 
     * 2. 字符设备 (Character Device)
     *    - 不可寻址，流式访问
     *    - 按字符或字节顺序访问
     *    - 通过设备节点直接访问
     *    - 例子：键盘、鼠标、打印机
     * 
     * 3. 网络设备 (Network Device)
     *    - 提供网络访问
     *    - 通过套接字API访问
     *    - 不遵循"一切皆文件"原则
     *    - 例子：以太网卡、WiFi适配器
     */
}

// 特殊设备类型：
void special_device_types() {
    /*
     * 杂项设备 (Miscellaneous Device)：
     * 1. 简化的字符设备
     * 2. 通用基础架构折中
     * 3. 简化驱动开发
     * 
     * 伪设备 (Pseudo Device)：
     * 1. 虚拟设备
     * 2. 访问内核功能
     * 3. 例子：
     *    /dev/random - 随机数生成器
     *    /dev/null - 空设备
     *    /dev/zero - 零设备
     *    /dev/full - 满设备
     *    /dev/mem - 内存设备
     */
}
```

---

## 模块

### 1. **模块基本概念**
```c
// 模块机制：

void module_concept() {
    /*
     * 模块特点：
     * 1. 可装载内核模块 (Loadable Kernel Module, LKM)
     * 2. 动态加载和卸载
     * 3. 按需提供功能
     * 4. 减小基本内核镜像大小
     * 5. 便于调试和开发
     */
}

// 模块优势：
void module_advantages() {
    /*
     * 优势：
     * 1. 内核镜像尽可能小
     * 2. 可选功能按需加载
     * 3. 方便调试和测试
     * 4. 支持热插拔设备
     * 5. 灵活的系统配置
     */
}
```

### 2. **Hello World 模块详解**
```c
// 完整的Hello World模块：

#include <linux/init.h>
#include <linux/module.h>
#include <linux/kernel.h>

// 模块初始化函数
static int __init hello_init(void) {
    printk(KERN_ALERT "I bear a charmed life.\n");
    return 0;  // 成功返回0
}

// 模块退出函数
static void __exit hello_exit(void) {
    printk(KERN_ALERT "Out, out, brief candle!\n");
}

// 注册模块函数
module_init(hello_init);
module_exit(hello_exit);

// 模块信息
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Shakespeare");
MODULE_DESCRIPTION("A Hello, World Module");

// 函数特点说明：
void module_function_characteristics() {
    /*
     * init函数特点：
     * 1. 模块加载时调用
     * 2. 返回int类型
     * 3. 成功返回0，失败返回非0
     * 4. 通常标记为static
     * 5. 执行初始化工作
     * 
     * exit函数特点：
     * 1. 模块卸载时调用
     * 2. 返回void类型
     * 3. 通常标记为static
     * 4. 执行清理工作
     * 5. 静态编译时不包含
     */
}
```

### 3. **模块构建系统**
```c
// 内核外构建Makefile：

void external_build_makefile() {
    /*
     * 简单模块Makefile：
     * obj-m := hello.o
     * 
     * 多文件模块Makefile：
     * obj-m := hello.o
     * hello-objs := hello_main.o hello_utils.o
     * 
     * 构建命令：
     * make -C /lib/modules/$(shell uname -r)/build M=$(PWD) modules
     */
}

// 内核内构建：
void internal_build() {
    /*
     * 内核源码树中构建：
     * 1. 放置源文件到适当目录
     * 2. 修改对应目录的Makefile
     * 3. 添加配置选项到Kconfig
     * 4. 使用标准内核构建系统
     */
}

// Makefile示例：
void makefile_examples() {
    /*
     * drivers/char/Makefile添加：
     * obj-$(CONFIG_FISHING_POLE) += fishing/
     * 
     * drivers/char/fishing/Makefile：
     * obj-$(CONFIG_FISHING_POLE) += fishing.o
     * fishing-objs := fishing-main.o fishing-line.o
     * 
     * 编译标记：
     * EXTRA_CFLAGS += -DTTTANTUM_POLE
     */
}
```

### 4. **模块管理**
```c
// 模块安装和依赖：

void module_installation() {
    /*
     * 模块安装：
     * make modules_install
     * 安装到/lib/modules/version/kernel/
     * 
     * 生成依赖关系：
     * depmod          # 生成所有依赖
     * depmod -A       # 仅生成新模块依赖
     * 依赖信息存储在modules.dep文件中
     */
}

// 模块加载卸载：
void module_loading_unloading() {
    /*
     * 简单加载：
     * insmod module.ko
     * 
     * 简单卸载：
     * rmmod module
     * 
     * 智能管理（推荐）：
     * modprobe module [parameters]    # 加载模块及依赖
     * modprobe -r modules             # 卸载模块及依赖
     */
}
```

### 5. **配置选项管理**
```c
// Kconfig配置选项：

void kconfig_management() {
    /*
     * Kconfig文件示例：
     * config FISHING_POLE
     *     tristate "Fish Master 3000 support"
     *     default n
     *     help
     *       If you say Y here, support for the Fish Master 3000...
     * 
     * 选项类型：
     * tristate - Y/M/N (模块支持)
     * bool - Y/N (仅内核支持)
     * 
     * 依赖关系：
     * depends on FISH_TANK
     * select BAIT
     * 
     * 条件编译：
     * bool "Deep Sea Mode" if OCEAN
     */
}
```

### 6. **模块参数**
```c
// 模块参数机制：

void module_parameters() {
    /*
     * 参数类型：
     * byte, short, ushort, int, uint, long, ulong, charp, bool, invbool
     * 
     * 基本参数定义：
     * static int allow_live_bait = 1;
     * module_param(allow_live_bait, bool, 0644);
     * 
     * 命名参数：
     * static unsigned int max_test = DEFAULT_MAX_LINE_TEST;
     * module_param_named(maximum_line_test, max_test, int, 0);
     * 
     * 字符串参数：
     * static char *name;
     * module_param(name, charp, 0);
     * 
     * 字符数组参数：
     * static char species[BUF_LEN];
     * module_param_string(species, species, BUF_LEN, 0);
     * 
     * 数组参数：
     * static int fish[MAX_FISH];
     * static int nr_fish;
     * module_param_array(fish, int, &nr_fish, 0444);
     * 
     * 参数描述：
     * MODULE_PARM_DESC(size, "The size in inches of the fishing pole.");
     */
}
```

### 7. **符号导出**
```c
// 符号导出机制：

void symbol_export() {
    /*
     * 导出符号：
     * EXPORT_SYMBOL(symbol_name);      // 所有模块可用
     * EXPORT_SYMBOL_GPL(symbol_name);  // 仅GPL模块可用
     * 
     * 使用示例：
     * int get_pirate_beard_color(struct pirate *p) {
     *     return p->beard.color;
     * }
     * EXPORT_SYMBOL(get_pirate_beard_color);
     * 
     * 模块许可证：
     * MODULE_LICENSE("GPL");  // 允许使用GPL-only符号
     */
}
```

---

## 设备模型

### 1. **统一设备模型**
```c
// 设备模型目标：

void device_model_goals() {
    /*
     * 设备模型优势：
     * 1. 代码重复最小化
     * 2. 统一的引用计数机制
     * 3. 设备枚举和状态观察
     * 4. 完整的设备树表示
     * 5. 设备与驱动的关联
     * 6. 设备类型分类
     * 7. 正确的电源管理顺序
     */
}

// 设备树结构：
void device_tree_structure() {
    /*
     * 树形结构特点：
     * 1. 表示设备拓扑关系
     * 2. 支持层次化管理
     * 3. 便于电源管理
     * 4. 正确的关闭顺序
     * 
     * 电源管理顺序示例：
     * USB鼠标 → USB控制器 → PCI总线
     * 从叶子节点向根节点关闭
     */
}
```

### 2. **设备模型核心概念**
```c
// 核心数据结构：

void core_data_structures() {
    /*
     * 主要组件：
     * 1. device - 设备对象
     * 2. driver - 驱动对象
     * 3. bus - 总线对象
     * 4. class - 设备类对象
     * 
     * 关系：
     * device ↔ driver (绑定关系)
     * device → bus (所属总线)
     * device → class (设备类别)
     */
}

// 设备生命周期：
void device_lifecycle() {
    /*
     * 生命周期管理：
     * 1. 设备注册
     * 2. 驱动匹配
     * 3. 设备使用
     * 4. 电源管理
     * 5. 设备注销
     */
}
```

---

## 实际应用示例

### 1. **完整模块示例**
```c
// 实用模块示例：

#include <linux/init.h>
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/proc_fs.h>
#include <linux/uaccess.h>

// 模块参数
static char *device_name = "mydevice";
static int debug_level = 0;

module_param(device_name, charp, 0644);
module_param(debug_level, int, 0644);
MODULE_PARM_DESC(device_name, "Device name");
MODULE_PARM_DESC(debug_level, "Debug level (0-3)");

// 模块信息
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Your Name");
MODULE_DESCRIPTION("A sample device driver module");

// 初始化函数
static int __init sample_init(void) {
    printk(KERN_INFO "Sample module loaded: %s, debug=%d\n", 
           device_name, debug_level);
    
    // 初始化设备
    // 注册设备
    // 分配资源
    
    return 0;
}

// 退出函数
static void __exit sample_exit(void) {
    printk(KERN_INFO "Sample module unloaded: %s\n", device_name);
    
    // 释放资源
    // 注销设备
}

module_init(sample_init);
module_exit(sample_exit);
```

### 2. **模块开发流程**
```c
// 开发流程：

void development_workflow() {
    /*
     * 1. 编写模块源代码
     * 2. 创建Makefile
     * 3. 编译模块
     *    make -C /lib/modules/$(uname -r)/build M=$(pwd) modules
     * 4. 加载模块
     *    sudo insmod module.ko
     * 5. 检查日志
     *    dmesg | tail
     * 6. 测试功能
     * 7. 卸载模块
     *    sudo rmmod module
     */
}

// 调试技巧：
void debugging_tips() {
    /*
     * 调试方法：
     * 1. 使用printk输出调试信息
     * 2. 查看内核日志：dmesg
     * 3. 检查模块状态：lsmod
     * 4. 查看设备信息：/proc/devices
     * 5. 使用调试工具：kgdb, ftrace
     */
}
```

**核心要点回顾**：

### **模块和设备核心要点**：
```c
void core_key_points() {
    /*
     * 核心要点：
     * 1. 三种设备类型：块设备、字符设备、网络设备
     * 2. 可装载内核模块机制
     * 3. 模块的初始化和退出函数
     * 4. 模块参数和配置选项
     * 5. 符号导出和模块间通信
     * 6. 统一设备模型
     * 7. 设备树和电源管理
     */
}
```

### **重要机制**：
```c
void important_mechanisms() {
    /*
     * 重要机制：
     * 1. 动态模块加载卸载
     * 2. 模块参数配置
     * 3. 符号导出和导入
     * 4. 设备驱动模型
     * 5. 设备树管理
     * 6. 电源管理顺序
     * 7. 引用计数机制
     */
}
```

### **开发实践**：
```c
void development_practices() {
    /*
     * 开发实践：
     * 1. 遵循模块开发规范
     * 2. 正确处理资源分配和释放
     * 3. 使用适当的错误处理
     * 4. 提供清晰的模块信息
     * 5. 支持模块参数配置
     * 6. 实现正确的初始化和清理
     * 7. 进行充分的测试和调试
     */
}
```





## kobject

### 1. **kobject 基本概念**
```c
// kobject 作用：

void kobject_concept() {
    /*
     * kobject 作用：
     * 1. 内核对象的基础类
     * 2. 提供引用计数机制
     * 3. 维护对象层次结构
     * 4. 支持 sysfs 文件系统
     * 5. 实现面向对象特性
     */
}

// kobject 结构体详解：

struct kobject_key_fields {
    const char *name;                    // 对象名称
    struct list_head entry;              // 链表节点
    struct kobject *parent;              // 父对象指针
    struct kset *kset;                   // 所属集合
    struct kobj_type *ktype;             // 对象类型
    struct sysfs_dirent *sd;             // sysfs 目录项
    struct kref kref;                    // 引用计数
    unsigned int state_initialized:1;    // 初始化状态
    unsigned int state_in_sysfs:1;       // sysfs 中状态
    unsigned int state_add_uevent_sent:1; // 添加事件发送
    unsigned int state_remove_uevent_sent:1; // 删除事件发送
    unsigned int uevent_suppress:1;      // 事件抑制
};
```

### 2. **kobject 嵌入使用**
```c
// kobject 嵌入其他结构体：

struct cdev_example {
    struct kobject kobj;        // 嵌入的 kobject
    struct module *owner;       // 模块所有者
    const struct file_operations *ops;  // 文件操作
    struct list_head list;      // 链表节点
    dev_t dev;                  // 设备号
    unsigned int count;         // 设备数量
};

// 层次结构示例：
void hierarchy_example() {
    /*
     * 层次结构：
     * 设备 → 子系统 → 总线 → 系统
     * 
     * 通过 parent 指针建立关系
     * 通过 entry 链表维护同级关系
     */
}
```

---

##  ktype

### 1. **ktype 概念**
```c
// ktype 作用：

void ktype_concept() {
    /*
     * ktype 作用：
     * 1. 描述 kobject 类型特性
     * 2. 定义析构行为
     * 3. 管理 sysfs 操作
     * 4. 提供默认属性
     * 5. 实现类型共享
     */
}

// kobj_type 结构体：

struct kobj_type_key_fields {
    void (*release)(struct kobject *kobj);           // 析构函数
    const struct sysfs_ops *sysfs_ops;               // sysfs 操作
    struct attribute **default_attrs;                // 默认属性
    const struct kobj_ns_type_operations * (*child_ns_type)(struct kobject *kobj);
    const void *(*namespace)(struct kobject *kobj);
};
```

### 2. **release 函数**
```c
// release 函数实现：

void kobject_release_example(struct kobject *kobj) {
    /*
     * release 函数职责：
     * 1. 释放 kobject 占用内存
     * 2. 清理相关资源
     * 3. 执行对象特定清理
     * 4. 调用时机：引用计数为0时
     */
    
    // 示例：释放包含 kobject 的结构体
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    kfree(dev);
}

// sysfs 操作示例：
struct sysfs_ops my_sysfs_ops = {
    .show = my_attr_show,
    .store = my_attr_store,
};
```

---

##  kset

### 1. **kset 概念**
```c
// kset 作用：

void kset_concept() {
    /*
     * kset 作用：
     * 1. kobject 集合容器
     * 2. 组织相关对象
     * 3. 提供集合级操作
     * 4. 支持热插拔事件
     * 5. 在 sysfs 中表示为目录
     */
}

// kset 结构体：

struct kset_key_fields {
    struct list_head list;              // kobject 链表
    spinlock_t list_lock;               // 链表保护锁
    struct kobject kobj;                // 集合的 kobject
    struct kset_uevent_ops *uevent_ops; // 热插拔操作
};
```

### 2. **热插拔事件**
```c
// 热插拔操作结构体：

struct kset_uevent_ops {
    int (*filter)(struct kset *kset, struct kobject *kobj);
    const char *(*name)(struct kset *kset, struct kobject *kobj);
    int (*uevent)(struct kset *kset, struct kobject *kobj,
                  struct kobj_uevent_env *env);
};

// 事件处理示例：
int my_uevent_filter(struct kset *kset, struct kobject *kobj) {
    /* 决定是否发送事件 */
    return 1;  // 发送事件
}

const char *my_uevent_name(struct kset *kset, struct kobject *kobj) {
    /* 返回事件名称 */
    return "MY_DEVICE";
}
```

---

## 相互关系

### 1. **三者关系图解**
```c
// 关系总结：

void relationship_summary() {
    /*
     * 关系说明：
     * 
     * kobject - 基础对象
     *   ↓ 指向
     * ktype - 对象类型（描述特性）
     *   ↓ 属于
     * kset - 对象集合（组织容器）
     * 
     * 一个 ktype 可以被多个 kset 使用
     * 一个 kset 包含多个 kobject
     * 一个 kobject 属于一个 kset
     */
}

// 实际示例：
void practical_example() {
    /*
     * 实际场景：
     * 
     * ktype: 字符设备类型
     * kset: 所有字符设备集合 (/sys/class/char)
     * kobject: 具体的字符设备对象
     * 
     * /sys/class/char/
     *   ├── ttyS0/
     *   ├── ttyS1/
     *   └── console/
     */
}
```

---

## 管理和操作 kobject

### 1. **kobject 初始化**
```c
// kobject 初始化方法：

void kobject_initialization() {
    /*
     * 初始化方法：
     * 1. kobject_init() - 手动初始化
     * 2. kobject_create() - 自动创建
     * 3. kobject_create_and_add() - 创建并添加到 sysfs
     */
}

// 手动初始化示例：
struct kobject *manual_init_example(void) {
    struct kobject *kobj;
    
    kobj = kmalloc(sizeof(*kobj), GFP_KERNEL);
    if (!kobj)
        return ERR_PTR(-ENOMEM);
    
    memset(kobj, 0, sizeof(*kobj));
    kobj->kset = my_kset;
    
    kobject_init(kobj, my_ktype);
    return kobj;
}

// 自动创建示例：
struct kobject *auto_create_example(void) {
    struct kobject *kobj;
    
    kobj = kobject_create();
    if (!kobj)
        return ERR_PTR(-ENOMEM);
    
    kobj->kset = my_kset;
    return kobj;
}
```

### 2. **kobject 添加到 sysfs**
```c
// 添加到 sysfs：

int kobject_add_example(void) {
    struct kobject *kobj;
    int error;
    
    kobj = kobject_create();
    if (IS_ERR(kobj))
        return PTR_ERR(kobj);
    
    error = kobject_add(kobj, parent_kobj, "my_device");
    if (error) {
        kobject_put(kobj);
        return error;
    }
    
    return 0;
}
```

---

##  引用计数

### 1. **引用计数机制**
```c
// 引用计数操作：

void reference_counting_operations() {
    /*
     * 引用计数操作：
     * 1. kobject_get() - 增加引用
     * 2. kobject_put() - 减少引用
     * 3. 当计数为0时调用release函数
     */
}

// 基本操作示例：
void reference_counting_example(void) {
    struct kobject *kobj;
    
    // 获取引用
    kobj = kobject_get(my_kobject);
    if (!kobj) {
        /* 对象已被销毁 */
        return;
    }
    
    // 使用对象
    // ...
    
    // 释放引用
    kobject_put(kobj);
}
```

### 2. **kref 机制**
```c
// kref 结构体：

struct kref {
    atomic_t refcount;  // 原子引用计数
};

// kref 操作函数：

void kref_operations() {
    /*
     * kref 操作：
     * 1. kref_init() - 初始化引用计数
     * 2. kref_get() - 增加引用
     * 3. kref_put() - 减少引用并可能调用释放函数
     */
}

// kref 使用示例：
struct my_data {
    struct kref refcount;
    // 其他数据成员
};

void my_data_release(struct kref *kref) {
    struct my_data *data = container_of(kref, struct my_data, refcount);
    kfree(data);
}

struct my_data *my_data_get(struct my_data *data) {
    kref_get(&data->refcount);
    return data;
}

void my_data_put(struct my_data *data) {
    kref_put(&data->refcount, my_data_release);
}
```

---

## 实际应用示例

### 1. **完整设备示例**
```c
// 完整的设备 kobject 示例：

struct my_device {
    struct kobject kobj;
    int device_id;
    char name[32];
};

// 设备类型定义：
static void my_device_release(struct kobject *kobj) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    printk(KERN_INFO "Releasing device %s\n", dev->name);
    kfree(dev);
}

static ssize_t device_id_show(struct kobject *kobj, 
                             struct kobj_attribute *attr, char *buf) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    return sprintf(buf, "%d\n", dev->device_id);
}

static struct kobj_attribute device_id_attr = __ATTR_RO(device_id);

static struct attribute *my_device_attrs[] = {
    &device_id_attr.attr,
    NULL,
};

static struct kobj_type my_device_ktype = {
    .release = my_device_release,
    .sysfs_ops = &kobj_sysfs_ops,
    .default_attrs = my_device_attrs,
};

// 创建设备：
struct my_device *create_my_device(const char *name, int id) {
    struct my_device *dev;
    
    dev = kzalloc(sizeof(*dev), GFP_KERNEL);
    if (!dev)
        return ERR_PTR(-ENOMEM);
    
    dev->device_id = id;
    strlcpy(dev->name, name, sizeof(dev->name));
    
    kobject_init(&dev->kobj, &my_device_ktype);
    
    return dev;
}
```

### 2. **sysfs 属性操作**
```c
// sysfs 属性读写：

static ssize_t name_show(struct kobject *kobj, 
                        struct kobj_attribute *attr, char *buf) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    return sprintf(buf, "%s\n", dev->name);
}

static ssize_t name_store(struct kobject *kobj,
                         struct kobj_attribute *attr,
                         const char *buf, size_t count) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    
    if (count >= sizeof(dev->name))
        return -EINVAL;
    
    strncpy(dev->name, buf, count);
    if (dev->name[count-1] == '\n')
        dev->name[count-1] = '\0';
    
    return count;
}

static struct kobj_attribute name_attr = __ATTR_RW(name);
```

**核心要点回顾**：

### **kobject 体系核心要点**：
```c
void core_key_points() {
    /*
     * 核心要点：
     * 1. kobject - 基础对象，提供引用计数和层次结构
     * 2. ktype - 对象类型，定义共同特性和行为
     * 3. kset - 对象集合，组织相关对象
     * 4. 三者协作实现内核对象管理
     * 5. 支持 sysfs 文件系统导出
     */
}
```

### **重要机制**：
```c
void important_mechanisms() {
    /*
     * 重要机制：
     * 1. 引用计数保证对象生命周期安全
     * 2. 层次结构表示对象关系
     * 3. sysfs 导出内核对象信息
     * 4. 热插拔事件通知用户空间
     * 5. 统一的对象管理接口
     */
}
```

### **设计模式**：
```c
void design_patterns() {
    /*
     * 设计模式：
     * 1. 嵌入式对象设计
     * 2. 面向对象的继承模拟
     * 3. 工厂模式创建对象
     * 4. 观察者模式事件通知
     * 5. 资源管理的 RAII 模式
     */
}
```



## sysfs 基本概念

### 1. **sysfs 概述**
```c
// sysfs 基本概念：

void sysfs_concept() {
    /*
     * sysfs 特点：
     * 1. 内存中的虚拟文件系统
     * 2. 提供 kobject 层次结构视图
     * 3. 用户空间访问内核数据
     * 4. 设备拓扑结构展示
     * 5. 挂载在 /sys 目录下
     */
}

// sysfs 历史演进：
void sysfs_history() {
    /*
     * 发展历程：
     * 1. 最初称为 driverfs
     * 2. 早于 kobject 出现
     * 3. 为设备模型而设计
     * 4. 后来促进 kobject 发展
     * 5. 成为标准内核组件
     */
}

// sysfs 目录结构：
void sysfs_directory_structure() {
    /*
     * 主要目录：
     * /sys/block/     - 块设备
     * /sys/bus/       - 总线
     * /sys/class/     - 设备类
     * /sys/dev/       - 设备节点
     * /sys/devices/   - 设备拓扑
     * /sys/firmware/  - 固件信息
     * /sys/fs/        - 文件系统
     * /sys/kernel/    - 内核信息
     * /sys/module/    - 模块信息
     * /sys/power/     - 电源管理
     */
}
```

### 2. **sysfs 与 kobject 关系**
```c
// kobject 到 sysfs 映射：

void kobject_to_sysfs_mapping() {
    /*
     * 映射机制：
     * 1. kobject → 目录项 (dentry)
     * 2. kobject 层次 → 目录层次
     * 3. kobject 属性 → 文件
     * 4. kset → 目录
     * 5. 引用计数保证安全性
     */
}

// 实际映射示例：
void mapping_example() {
    /*
     * 示例：
     * kobject: /sys/devices/pci0000:00/0000:00:1f.2/
     * 对应设备: PCI 控制器
     * 属性文件: vendor, device, class, etc.
     */
}
```

---

## sysfs 中添加和删除 kobject

### 1. **kobject 管理**
```c
// kobject 添加到 sysfs：

void kobject_addition() {
    /*
     * 添加方法：
     * 1. kobject_add() - 手动添加
     * 2. kobject_create_and_add() - 创建并添加
     * 3. 位置由父对象决定
     * 4. 名称由参数指定
     */
}

// kobject_add() 函数：
int kobject_add_example(struct kobject *kobj, struct kobject *parent) {
    /*
     * 参数说明：
     * kobj - 要添加的 kobject
     * parent - 父对象（决定位置）
     * fmt - 目录名称格式化字符串
     */
    
    return kobject_add(kobj, parent, "my_device");
}

// kobject_create_and_add() 函数：
struct kobject *create_and_add_example(struct kobject *parent) {
    return kobject_create_and_add("my_device", parent);
}

// kobject 删除：
void kobject_deletion() {
    /*
     * 删除方法：
     * kobject_del() - 从 sysfs 删除
     * 引用计数自动处理
     * 相关资源清理
     */
}
```

---

##  向 sysfs 中添加文件

### 1. **默认属性**
```c
// attribute 结构体：

struct attribute_key_fields {
    const char *name;        // 属性名称
    struct module *owner;    // 所属模块
    mode_t mode;            // 文件权限
};

// sysfs_ops 结构体：
struct sysfs_ops_key_functions {
    ssize_t (*show)(struct kobject *kobj, struct attribute *attr, char *buf);
    ssize_t (*store)(struct kobject *kobj, struct attribute *attr, 
                     const char *buf, size_t count);
};

// 默认属性示例：
struct attribute *my_default_attrs[] = {
    &dev_attr_vendor.attr,
    &dev_attr_device.attr,
    NULL,
};

struct kobj_type my_ktype = {
    .release = my_release,
    .sysfs_ops = &my_sysfs_ops,
    .default_attrs = my_default_attrs,
};
```

### 2. **属性读写操作**
```c
// show 函数实现：
ssize_t vendor_show(struct kobject *kobj, struct attribute *attr, char *buf) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    return sprintf(buf, "0x%04x\n", dev->vendor_id);
}

// store 函数实现：
ssize_t vendor_store(struct kobject *kobj, struct attribute *attr,
                     const char *buf, size_t count) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    unsigned int value;
    
    if (sscanf(buf, "%x", &value) != 1)
        return -EINVAL;
    
    dev->vendor_id = value;
    return count;
}

// 属性宏定义：
static struct kobj_attribute vendor_attr = __ATTR_RW(vendor);
static struct kobj_attribute device_attr = __ATTR_RO(device);
```

### 3. **动态属性管理**
```c
// 创建新属性：

int create_new_attribute_example(struct kobject *kobj) {
    struct attribute *new_attr;
    
    new_attr = kzalloc(sizeof(*new_attr), GFP_KERNEL);
    if (!new_attr)
        return -ENOMEM;
    
    new_attr->name = "new_attribute";
    new_attr->mode = 0644;
    
    return sysfs_create_file(kobj, new_attr);
}

// 创建符号链接：
int create_symlink_example(struct kobject *kobj, struct kobject *target) {
    return sysfs_create_link(kobj, target, "target_link");
}

// 删除属性：
void remove_attribute_example(struct kobject *kobj, struct attribute *attr) {
    sysfs_remove_file(kobj, attr);
    kfree(attr);
}

// 删除符号链接：
void remove_symlink_example(struct kobject *kobj) {
    sysfs_remove_link(kobj, "target_link");
}
```

### 4. **sysfs 约定**
```c
// sysfs 设计约定：

void sysfs_conventions() {
    /*
     * 设计约定：
     * 1. 每个文件导出单一值
     * 2. 文本格式，映射简单 C 类型
     * 3. 清晰的层次组织
     * 4. 正确的父子关系
     * 5. 保持 ABI 兼容性
     */
}

// 良好实践示例：
void good_practices() {
    /*
     * 良好实践：
     * 1. 使用标准权限模式
     * 2. 提供有意义的属性名
     * 3. 实现正确的错误处理
     * 4. 保证数据一致性
     * 5. 遵循命名规范
     */
}
```

---

## 内核事件层

### 1. **uevent 机制**
```c
// 内核事件概念：

void uevent_concept() {
    /*
     * uevent 特点：
     * 1. 内核到用户空间通知
     * 2. 基于 kobject 机制
     * 3. 通过 netlink 传输
     * 4. 支持热插拔事件
     * 5. 与 D-BUS 集成
     */
}

// 事件动作类型：
enum kobject_action_types {
    KOBJ_ADD,      // 添加设备
    KOBJ_REMOVE,   // 删除设备
    KOBJ_CHANGE,   // 设备改变
    KOBJ_MOUNT,    // 挂载设备
    KOBJ_UNMOUNT,  // 卸载设备
    KOBJ_MOVE,     // 移动设备
    KOBJ_ONLINE,   // 设备上线
    KOBJ_OFFLINE,  // 设备下线
};
```

### 2. **事件发送机制**
```c
// kobject_uevent() 函数：

int send_uevent_example(struct kobject *kobj) {
    /*
     * 发送事件：
     * 1. 指定 kobject
     * 2. 指定动作类型
     * 3. 通过 netlink 发送
     * 4. 包含 sysfs 路径
     */
    
    return kobject_uevent(kobj, KOBJ_ADD);
}

// uevent 操作结构体：
struct kset_uevent_ops {
    int (*filter)(struct kset *kset, struct kobject *kobj);
    const char *(*name)(struct kset *kset, struct kobject *kobj);
    int (*uevent)(struct kset *kset, struct kobject *kobj,
                  struct kobj_uevent_env *env);
};

// 环境变量添加：
int add_uevent_var_example(struct kobj_uevent_env *env, const char *format, ...) {
    /*
     * 添加环境变量：
     * 1. 为事件添加额外信息
     * 2. 用户空间可读取
     * 3. 格式化字符串支持
     */
    
    return add_uevent_var(env, "MY_VAR=%s", "value");
}
```

### 3. **用户空间处理**
```c
// 用户空间事件处理：

void userspace_handling() {
    /*
     * 处理方式：
     * 1. netlink 套接字监听
     * 2. udev 守护进程处理
     * 3. D-BUS 集成
     * 4. 自定义事件处理器
     */
}

// udev 规则示例：
void udev_rules_example() {
    /*
     * udev 规则：
     * ACTION=="add", SUBSYSTEM=="block", RUN+="/usr/local/bin/script.sh"
     * KERNEL=="sda", ATTR{queue/scheduler}="deadline"
     */
}
```

---

## 实际应用示例

### 1. **完整设备示例**
```c
// 完整的 sysfs 设备示例：

struct my_device {
    struct kobject kobj;
    unsigned int vendor_id;
    unsigned int device_id;
    char name[32];
};

// 属性实现：
static ssize_t vendor_show(struct kobject *kobj, struct kobj_attribute *attr, char *buf) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    return sprintf(buf, "0x%04x\n", dev->vendor_id);
}

static ssize_t device_show(struct kobject *kobj, struct kobj_attribute *attr, char *buf) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    return sprintf(buf, "0x%04x\n", dev->device_id);
}

static ssize_t name_show(struct kobject *kobj, struct kobj_attribute *attr, char *buf) {
    struct my_device *dev = container_of(kobj, struct my_device, kobj);
    return sprintf(buf, "%s\n", dev->name);
}

// 属性定义：
static struct kobj_attribute vendor_attr = __ATTR_RO(vendor);
static struct kobj_attribute device_attr = __ATTR_RO(device);
static struct kobj_attribute name_attr = __ATTR_RO(name);

// 默认属性数组：
static struct attribute *my_device_attrs[] = {
    &vendor_attr.attr,
    &device_attr.attr,
    &name_attr.attr,
    NULL,
};

// sysfs 操作：
static struct kobj_type my_device_ktype = {
    .release = my_device_release,
    .sysfs_ops = &kobj_sysfs_ops,
    .default_attrs = my_device_attrs,
};

// 设备创建：
struct my_device *create_my_device(const char *name, struct kobject *parent) {
    struct my_device *dev;
    int error;
    
    dev = kzalloc(sizeof(*dev), GFP_KERNEL);
    if (!dev)
        return ERR_PTR(-ENOMEM);
    
    dev->vendor_id = 0x1234;
    dev->device_id = 0x5678;
    strlcpy(dev->name, name, sizeof(dev->name));
    
    error = kobject_init_and_add(&dev->kobj, &my_device_ktype, parent, "%s", name);
    if (error) {
        kfree(dev);
        return ERR_PTR(error);
    }
    
    kobject_uevent(&dev->kobj, KOBJ_ADD);
    return dev;
}
```

### 2. **sysfs 交互示例**
```c
// 用户空间交互示例：

void userspace_interaction() {
    /*
     * 查看设备信息：
     * cat /sys/devices/my_device/vendor
     * cat /sys/devices/my_device/device
     * cat /sys/devices/my_device/name
     * 
     * 监控事件：
     * udevadm monitor --kernel
     * 
     * 规则应用：
     * udevadm control --reload-rules
     */
}
```

**核心要点回顾**：

### **sysfs 核心要点**：
```c
void sysfs_key_points() {
    /*
     * 核心要点：
     * 1. 虚拟文件系统，内存中存在
     * 2. kobject 层次结构映射
     * 3. 用户空间访问内核数据
     * 4. 设备拓扑结构展示
     * 5. 支持属性读写操作
     */
}
```

### **重要机制**：
```c
void important_mechanisms() {
    /*
     * 重要机制：
     * 1. kobject 到目录项映射
     * 2. 属性到文件映射
     * 3. 引用计数保证安全
     * 4. uevent 事件通知
     * 5. netlink 传输机制
     */
}
```

### **设计原则**：
```c
void design_principles() {
    /*
     * 设计原则：
     * 1. 单一职责原则
     * 2. 层次化组织
     * 3. ABI 兼容性
     * 4. 用户友好接口
     * 5. 系统集成能力
     */
}
```
