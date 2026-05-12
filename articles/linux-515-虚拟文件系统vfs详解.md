# Linux 5.15 虚拟文件系统（VFS）详解

## 目录

1. **`问题：为什么需要虚拟文件系统？`**
2. **`解决方案：VFS 抽象层`**
3. **`核心数据结构`**
4. **`超级块：文件系统的元数据`**
5. **`inode：文件的元数据`**
6. **`dentry：目录项缓存`**
7. **`file：打开的文件对象`**
8. **`文件系统注册与挂载`**
9. **`文件打开流程`**
10. **`文件读写流程`**
11. **`目录操作`**
12. **`缓存机制详解`**
13. **`VFS 的设计哲学`**

---

## 1. 问题：为什么需要虚拟文件系统？

### 1.1 多种文件系统的困境

```
想象一下，如果没有 VFS：

应用程序：
+-------------------+
| 打开 ext4 文件    |  --> 调用 ext4_open()
+-------------------+
         |
         v
+-------------------+
| 打开 NTFS 文件    |  --> 调用 ntfs_open()  ???
+-------------------+
         |
         v
+-------------------+
| 打开 NFS 文件     |  --> 调用 nfs_open()   ???
+-------------------+

问题：
1. 应用程序需要知道每种文件系统的 API
2. 无法在不同文件系统间移动文件
3. 每增加一种文件系统，所有应用都要修改
```

### 1.2 理想的解决方案

```
理想情况：

应用程序：
+-------------------+
| open("/path/file")|  <-- 统一的接口
+-------------------+
         |
         v
+-------------------+
|   VFS 抽象层      |  <-- 统一处理
+-------------------+
         |
    +----+----+----+
    |    |    |    |
    v    v    v    v
+-----++-----++-----+
| ext4|| NTFS|| NFS |
+-----++-----++-----+

好处：
1. 应用程序只需要一套 API
2. 文件系统实现者只需要实现 VFS 接口
3. 可以在不同文件系统间移动文件
```

---

## 2. 解决方案：VFS 抽象层

### 2.1 VFS 的核心思想

> **提供统一的文件系统接口，隐藏底层文件系统的差异**

### 2.2 VFS 的设计目标

```
设计目标：
+-------------------+
| 1. 统一接口       |  --> open, read, write, close
+-------------------+
         |
         v
+-------------------+
| 2. 抽象数据结构   |  --> superblock, inode, dentry, file
+-------------------+
         |
         v
+-------------------+
| 3. 可扩展性       |  --> 易于添加新文件系统
+-------------------+
         |
         v
+-------------------+
| 4. 性能优化       |  --> 缓存机制
+-------------------+
```

### 2.3 VFS 架构图

```
+===========================================================================+
|                           用户空间                                         |
+===========================================================================+
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | 应用程序          |   | 库函数            |   | Shell 命令        |   |
|   | open(), read()    |   | fopen(), fread()  |   | cat, ls, cp       |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
+===========================================================================+
                                    |
                                    | 系统调用
                                    v
+===========================================================================+
|                           VFS 层                                          |
+===========================================================================+
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | superblock        |   | inode            |   | dentry            |   |
|   | 文件系统元数据    |   | 文件元数据       |   | 目录项缓存        |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | file              |   | address_space    |   | mount             |   |
|   | 打开的文件        |   | 页缓存管理       |   | 挂载信息          |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
+===========================================================================+
                                    |
                                    | 文件系统操作
                                    v
+===========================================================================+
|                           文件系统实现                                     |
+===========================================================================+
|                                                                           |
|   +---------+   +---------+   +---------+   +---------+   +---------+    |
|   |  ext4   |   |  xfs    |   |  btrfs  |   |  nfs    |   |  tmpfs  |    |
|   +---------+   +---------+   +---------+   +---------+   +---------+    |
|                                                                           |
+===========================================================================+
                                    |
                                    | 块设备操作
                                    v
+===========================================================================+
|                           块设备层                                         |
+===========================================================================+
|                                                                           |
|   +-------------------+   +-------------------+   +-------------------+   |
|   | 块设备驱动        |   | I/O 调度器       |   | 存储设备          |   |
|   | SCSI, NVMe        |   | mq-deadline      |   | SSD, HDD          |   |
|   +-------------------+   +-------------------+   +-------------------+   |
|                                                                           |
+===========================================================================+
```

---

## 3. 核心数据结构

### 3.1 四大核心对象

```
VFS 四大核心对象：
+-------------------+     +-------------------+
|   superblock      |     |   inode           |
|   超级块          |     |   索引节点        |
|                   |     |                   |
| 文件系统元数据    |     | 文件元数据        |
| 块大小、inode数   |     | 权限、大小、时间  |
+-------------------+     +-------------------+
         |                         |
         | s_root                  | i_dentry
         v                         v
+-------------------+     +-------------------+
|   dentry          |<--->|   file            |
|   目录项          |     |   文件对象        |
|                   |     |                   |
| 文件名到inode映射 |     | 打开的文件实例    |
| 路径解析缓存      |     | 读写位置、模式    |
+-------------------+     +-------------------+
```

### 3.2 对象关系图

```
进程打开文件 /home/user/test.txt 的对象关系：

进程描述符 (task_struct)
         |
         | files_struct
         v
    +---------+
    | fd 数组 |
    | fd[0]   | --> stdin
    | fd[1]   | --> stdout
    | fd[2]   | --> stderr
    | fd[3]   |------------------------+
    +---------+                        |
                                       v
                               +---------------+
                               | file          |
                               | f_pos = 100   |
                               | f_mode = READ |
                               +-------+-------+
                                       |
                                       | f_path.dentry
                                       v
                               +---------------+
                               | dentry        |
                               | name = test.txt
                               +-------+-------+
                                       |
                                       | d_inode
                                       v
                               +---------------+
                               | inode         |
                               | i_ino = 12345 |
                               | i_size = 1024 |
                               | i_mode = 0644 |
                               +-------+-------+
                                       |
                                       | i_sb
                                       v
                               +---------------+
                               | super_block   |
                               | s_dev = sda1  |
                               | s_type = ext4 |
                               +---------------+
```

---

## 4. 超级块：文件系统的元数据

### 4.1 什么是超级块？

> **超级块存储文件系统的整体信息，是文件系统的"身份证"**

### 4.2 超级块的作用

```
超级块存储的信息：
+-------------------+
| 1. 文件系统类型   |  --> ext4, xfs, btrfs...
+-------------------+
         |
         v
+-------------------+
| 2. 块大小         |  --> 1KB, 4KB, 64KB...
+-------------------+
         |
         v
+-------------------+
| 3. 总块数         |  --> 文件系统大小
+-------------------+
         |
         v
+-------------------+
| 4. 总 inode 数    |  --> 最大文件数
+-------------------+
         |
         v
+-------------------+
| 5. 空闲块数       |  --> 剩余空间
+-------------------+
         |
         v
+-------------------+
| 6. 空闲 inode 数  |  --> 可创建文件数
+-------------------+
         |
         v
+-------------------+
| 7. 根目录         |  --> 文件系统入口
+-------------------+
```

### 4.3 Linux 5.15 超级块结构

**定义位置**：**`include/linux/fs.h`**

```c
struct super_block {
    struct list_head s_list;         /* 所有超级块链表 */
    dev_t s_dev;                     /* 设备标识符 */
    unsigned char s_blocksize_bits;  /* 块大小位数 */
    unsigned long s_blocksize;       /* 块大小（字节） */
    loff_t s_maxbytes;               /* 文件最大大小 */
    
    struct file_system_type *s_type; /* 文件系统类型 */
    const struct super_operations *s_op; /* 超级块操作 */
    
    unsigned long s_flags;           /* 挂载标志 */
    unsigned long s_magic;           /* 魔数 */
    
    struct dentry *s_root;           /* 根目录 dentry */
    struct rw_semaphore s_umount;    /* 卸载信号量 */
    int s_count;                     /* 引用计数 */
    atomic_t s_active;               /* 活跃引用 */
    
    const struct xattr_handler **s_xattr; /* 扩展属性处理 */
    
    struct hlist_bl_head s_roots;    /* 备用根目录 */
    struct list_head s_mounts;       /* 挂载点链表 */
    struct block_device *s_bdev;     /* 块设备 */
    struct backing_dev_info *s_bdi;  /* 后备设备信息 */
    
    struct hlist_node s_instances;   /* 实例链表 */
    unsigned int s_quota_types;      /* 支持的配额类型 */
    struct quota_info s_dquot;       /* 配额信息 */
    
    struct sb_writers s_writers;     /* 写者信息（冻结） */
    
    void *s_fs_info;                 /* 文件系统私有信息 */
    u32 s_time_gran;                 /* 时间粒度（纳秒） */
    time64_t s_time_min;             /* 最小时间 */
    time64_t s_time_max;             /* 最大时间 */
    
    char s_id[32];                   /* 文本名称 */
    uuid_t s_uuid;                   /* UUID */
    
    unsigned int s_max_links;        /* 最大链接数 */
    fmode_t s_mode;                  /* 挂载权限 */
    
    struct mutex s_vfs_rename_mutex; /* 重命名互斥锁 */
    const char *s_subtype;           /* 子类型 */
    const struct dentry_operations *s_d_op; /* 默认 dentry 操作 */
    
    struct shrinker s_shrink;        /* 收缩器 */
    atomic_long_t s_remove_count;    /* 删除计数 */
    atomic_long_t s_fsnotify_connectors; /* fsnotify 连接器 */
    int s_readonly_remount;          /* 只读重挂载 */
    errseq_t s_wb_err;               /* 回写错误 */
    
    struct workqueue_struct *s_dio_done_wq; /* 直接 I/O 工作队列 */
    struct hlist_head s_pins;        /* pin 链表 */
    
    struct user_namespace *s_user_ns; /* 用户命名空间 */
    
    struct list_lru s_dentry_lru;    /* dentry LRU */
    struct list_lru s_inode_lru;     /* inode LRU */
    
    struct rcu_head rcu;             /* RCU 头 */
    struct work_struct destroy_work; /* 销毁工作 */
    
    struct mutex s_sync_lock;        /* 同步锁 */
    int s_stack_depth;               /* 栈深度 */
    
    spinlock_t s_inode_list_lock;    /* inode 列表锁 */
    struct list_head s_inodes;       /* 所有 inode */
    
    spinlock_t s_inode_wblist_lock;  /* 回写列表锁 */
    struct list_head s_inodes_wb;    /* 回写 inode */
};
```

### 4.4 超级块操作

```c
struct super_operations {
    /* 分配和释放 inode */
    struct inode *(*alloc_inode)(struct super_block *sb);
    void (*destroy_inode)(struct inode *);
    void (*free_inode)(struct inode *);
    
    /* 标记 inode 为脏 */
    void (*dirty_inode)(struct inode *, int flags);
    
    /* 写入 inode */
    int (*write_inode)(struct inode *, struct writeback_control *wbc);
    
    /* 删除 inode */
    int (*drop_inode)(struct inode *);
    void (*evict_inode)(struct inode *);
    
    /* 释放超级块 */
    void (*put_super)(struct super_block *);
    
    /* 同步文件系统 */
    int (*sync_fs)(struct super_block *sb, int wait);
    
    /* 冻结和解冻 */
    int (*freeze_super)(struct super_block *);
    int (*freeze_fs)(struct super_block *);
    int (*thaw_super)(struct super_block *);
    int (*unfreeze_fs)(struct super_block *);
    
    /* 文件系统统计 */
    int (*statfs)(struct dentry *, struct kstatfs *);
    
    /* 重新挂载 */
    int (*remount_fs)(struct super_block *, int *, char *);
    
    /* 开始卸载 */
    void (*umount_begin)(struct super_block *);
    
    /* 显示选项 */
    int (*show_options)(struct seq_file *, struct dentry *);
    int (*show_devname)(struct seq_file *, struct dentry *);
    int (*show_path)(struct seq_file *, struct dentry *);
    int (*show_stats)(struct seq_file *, struct dentry *);
    
    /* 配额操作 */
    ssize_t (*quota_read)(struct super_block *, int, char *, size_t, loff_t);
    ssize_t (*quota_write)(struct super_block *, int, const char *, size_t, loff_t);
    struct dquot **(*get_dquots)(struct inode *);
    
    /* 缓存收缩 */
    long (*nr_cached_objects)(struct super_block *, struct shrink_control *);
    long (*free_cached_objects)(struct super_block *, struct shrink_control *);
};
```

### 4.5 超级块操作示例

```c
static struct inode *ext4_alloc_inode(struct super_block *sb)
{
    struct ext4_inode_info *ei;
    
    ei = kmem_cache_alloc(ext4_inode_cachep, GFP_NOFS);
    if (!ei)
        return NULL;
    
    ei->i_block_group = 0;
    INIT_LIST_HEAD(&ei->i_orphan);
    init_rwsem(&ei->i_data_sem);
    
    return &ei->vfs_inode;
}

static void ext4_destroy_inode(struct inode *inode)
{
    if (!list_empty(&(EXT4_I(inode)->i_orphan))) {
        ext4_msg(inode->i_sb, KERN_ERR,
                 "Inode %lu (%p): orphan list check failed!",
                 inode->i_ino, EXT4_I(inode));
        dump_stack();
    }
    kmem_cache_free(ext4_inode_cachep, EXT4_I(inode));
}

static const struct super_operations ext4_sops = {
    .alloc_inode    = ext4_alloc_inode,
    .free_inode     = ext4_free_in_core_inode,
    .destroy_inode  = ext4_destroy_inode,
    .write_inode    = ext4_write_inode,
    .dirty_inode    = ext4_dirty_inode,
    .drop_inode     = ext4_drop_inode,
    .evict_inode    = ext4_evict_inode,
    .put_super      = ext4_put_super,
    .sync_fs        = ext4_sync_fs,
    .freeze_fs      = ext4_freeze,
    .unfreeze_fs    = ext4_unfreeze,
    .statfs         = ext4_statfs,
    .remount_fs     = ext4_remount,
    .show_options   = ext4_show_options,
};
```

---

## 5. inode：文件的元数据

### 5.1 什么是 inode？

> **inode 存储文件的元数据，是文件的"身份证"**

### 5.2 inode 存储的信息

```
inode 存储的信息：
+-------------------+
| 1. 文件类型       |  --> 普通文件、目录、设备...
+-------------------+
         |
         v
+-------------------+
| 2. 权限           |  --> rwxrwxrwx
+-------------------+
         |
         v
+-------------------+
| 3. 所有者         |  --> UID, GID
+-------------------+
         |
         v
+-------------------+
| 4. 文件大小       |  --> 字节数
+-------------------+
         |
         v
+-------------------+
| 5. 时间戳         |  --> atime, mtime, ctime
+-------------------+
         |
         v
+-------------------+
| 6. 链接数         |  --> 硬链接计数
+-------------------+
         |
         v
+-------------------+
| 7. 数据块指针     |  --> 文件内容位置
+-------------------+
         |
         v
+-------------------+
| 8. inode 号       |  --> 唯一标识
+-------------------+
```

### 5.3 inode 与文件名的关系

```
重要概念：inode 与文件名分离

目录结构：
+-------------------+
| 目录项 (dentry)   |
| name = "test.txt" |
| ino = 12345       |----+
+-------------------+    |
                         v
                 +---------------+
                 | inode 12345   |
                 | i_mode = 0644 |
                 | i_size = 1024 |
                 | i_nlink = 1   |
                 +---------------+

硬链接：
+-------------------+     +-------------------+
| dentry 1          |     | dentry 2          |
| name = "test.txt" |     | name = "link.txt" |
| ino = 12345       |     | ino = 12345       |
+-------------------+     +-------------------+
         |                         |
         +------------+------------+
                      |
                      v
              +---------------+
              | inode 12345   |
              | i_nlink = 2   |  <-- 链接数增加
              +---------------+

关键理解：
1. inode 不包含文件名
2. 文件名存储在目录项中
3. 一个 inode 可以有多个文件名（硬链接）
4. 删除文件名只是减少 i_nlink
5. 当 i_nlink = 0 且无进程打开时，inode 被释放
```

### 5.4 Linux 5.15 inode 结构

```c
struct inode {
    /* 权限和类型 */
    umode_t i_mode;          /* 文件类型和权限 */
    unsigned short i_opflags;
    kuid_t i_uid;            /* 所有者 UID */
    kgid_t i_gid;            /* 所有者 GID */
    unsigned int i_flags;    /* 文件系统标志 */
    
    /* ACL */
    struct posix_acl *i_acl;
    struct posix_acl *i_default_acl;
    
    /* 操作函数 */
    const struct inode_operations *i_op;
    struct super_block *i_sb;
    struct address_space *i_mapping;
    
    /* 安全 */
    void *i_security;
    
    /* 标识 */
    unsigned long i_ino;     /* inode 号 */
    union {
        const unsigned int i_nlink;  /* 链接数 */
        unsigned int __i_nlink;
    };
    
    /* 设备号（设备文件） */
    dev_t i_rdev;
    
    /* 大小 */
    loff_t i_size;           /* 文件大小 */
    
    /* 时间戳 */
    struct timespec64 i_atime;  /* 访问时间 */
    struct timespec64 i_mtime;  /* 修改时间 */
    struct timespec64 i_ctime;  /* 状态改变时间 */
    
    /* 锁 */
    spinlock_t i_lock;
    unsigned short i_bytes;
    u8 i_blkbits;            /* 块大小位数 */
    u8 i_write_hint;
    blkcnt_t i_blocks;       /* 块数 */
    
    /* 状态 */
    unsigned long i_state;
    struct rw_semaphore i_rwsem;
    
    /* 脏时间 */
    unsigned long dirtied_when;
    unsigned long dirtied_time_when;
    
    /* 哈希和链表 */
    struct hlist_node i_hash;
    struct list_head i_io_list;
    
    /* 回写 */
    struct bdi_writeback *i_wb;
    int i_wb_frn_winner;
    u16 i_wb_frn_avg_time;
    u16 i_wb_frn_history;
    
    /* LRU */
    struct list_head i_lru;
    struct list_head i_sb_list;
    struct list_head i_wb_list;
    
    /* dentry 链表 */
    union {
        struct hlist_head i_dentry;
        struct rcu_head i_rcu;
    };
    
    /* 版本和计数 */
    atomic64_t i_version;
    atomic64_t i_sequence;
    atomic_t i_count;        /* 引用计数 */
    atomic_t i_dio_count;
    atomic_t i_writecount;   /* 写者计数 */
    atomic_t i_readcount;    /* 读者计数 */
    
    /* 文件操作 */
    const struct file_operations *i_fop;
    
    /* 文件锁 */
    struct file_lock_context *i_flctx;
    
    /* 地址空间 */
    struct address_space i_data;
    
    /* 设备链表 */
    struct list_head i_devices;
    
    /* 特殊数据 */
    union {
        struct pipe_inode_info *i_pipe;
        struct cdev *i_cdev;
        char *i_link;
        unsigned i_dir_seq;
    };
    
    /* 生成号 */
    __u32 i_generation;
    
    /* fsnotify */
    __u32 i_fsnotify_mask;
    struct fsnotify_mark_connector __rcu *i_fsnotify_marks;
    
    /* 加密 */
    struct fscrypt_info *i_crypt_info;
    
    /* 完整性 */
    struct fsverity_info *i_verity_info;
    
    /* 私有数据 */
    void *i_private;
};
```

### 5.5 inode 操作

```c
struct inode_operations {
    /* 查找目录项 */
    struct dentry * (*lookup)(struct inode *, struct dentry *, unsigned int);
    
    /* 获取符号链接目标 */
    const char * (*get_link)(struct dentry *, struct inode *, 
                             struct delayed_call *);
    
    /* 权限检查 */
    int (*permission)(struct user_namespace *, struct inode *, int);
    
    /* ACL 操作 */
    struct posix_acl * (*get_acl)(struct inode *, int, bool);
    int (*set_acl)(struct user_namespace *, struct inode *,
                   struct posix_acl *, int);
    
    /* 读取符号链接 */
    int (*readlink)(struct dentry *, char __user *, int);
    
    /* 创建文件 */
    int (*create)(struct user_namespace *, struct inode *, struct dentry *,
                  umode_t, bool);
    
    /* 硬链接 */
    int (*link)(struct dentry *, struct inode *, struct dentry *);
    
    /* 删除文件 */
    int (*unlink)(struct inode *, struct dentry *);
    
    /* 创建符号链接 */
    int (*symlink)(struct user_namespace *, struct inode *, struct dentry *,
                   const char *);
    
    /* 创建目录 */
    int (*mkdir)(struct user_namespace *, struct inode *, struct dentry *,
                 umode_t);
    
    /* 删除目录 */
    int (*rmdir)(struct inode *, struct dentry *);
    
    /* 创建特殊文件 */
    int (*mknod)(struct user_namespace *, struct inode *, struct dentry *,
                 umode_t, dev_t);
    
    /* 重命名 */
    int (*rename)(struct user_namespace *, struct inode *, struct dentry *,
                  struct inode *, struct dentry *, unsigned int);
    
    /* 设置属性 */
    int (*setattr)(struct user_namespace *, struct dentry *, struct iattr *);
    
    /* 获取属性 */
    int (*getattr)(struct user_namespace *, const struct path *,
                   struct kstat *, u32, unsigned int);
    
    /* 扩展属性 */
    ssize_t (*listxattr)(struct dentry *, char *, size_t);
    
    /* fiemap */
    int (*fiemap)(struct inode *, struct fiemap_extent_info *, u64, u64);
    
    /* 更新时间 */
    int (*update_time)(struct inode *, struct timespec64 *, int);
    
    /* 原子打开 */
    int (*atomic_open)(struct inode *, struct dentry *, struct file *,
                       unsigned, umode_t);
    
    /* 创建临时文件 */
    int (*tmpfile)(struct user_namespace *, struct inode *, struct dentry *,
                   umode_t);
    
    /* 文件属性 */
    int (*fileattr_set)(struct user_namespace *, struct dentry *, 
                        struct fileattr *);
    int (*fileattr_get)(struct dentry *, struct fileattr *);
};
```

---

## 6. dentry：目录项缓存

### 6.1 什么是 dentry？

> **dentry 是目录项的内存表示，缓存文件名到 inode 的映射**

### 6.2 dentry 的作用

```
问题：每次访问 /home/user/test.txt 都要从磁盘解析路径？

传统方式（无缓存）：
访问 /home/user/test.txt：
1. 读取根目录，查找 "home" --> inode 100
2. 读取 inode 100 的数据，查找 "user" --> inode 200
3. 读取 inode 200 的数据，查找 "test.txt" --> inode 300
4. 共 3 次磁盘读取！

使用 dentry 缓存：
访问 /home/user/test.txt：
1. 查找 dentry 缓存："/home/user" 命中！
2. 直接获取 inode 200
3. 查找 dentry 缓存："test.txt" 命中！
4. 直接获取 inode 300
5. 0 次磁盘读取！
```

### 6.3 dentry 结构

```c
struct dentry {
    /* RCU 查找字段 */
    unsigned int d_flags;           /* 标志 */
    seqcount_spinlock_t d_seq;      /* 序列锁 */
    struct hlist_bl_node d_hash;    /* 哈希链表节点 */
    struct dentry *d_parent;        /* 父目录 */
    struct qstr d_name;             /* 文件名 */
    struct inode *d_inode;          /* 关联的 inode */
    unsigned char d_iname[DNAME_INLINE_LEN]; /* 内联文件名 */
    
    /* 引用计数 */
    struct lockref d_lockref;       /* 锁和引用计数 */
    
    /* 操作函数 */
    const struct dentry_operations *d_op;
    struct super_block *d_sb;       /* 所属超级块 */
    unsigned long d_time;           /* 重新验证时间 */
    void *d_fsdata;                 /* 文件系统私有数据 */
    
    /* LRU 和查找 */
    union {
        struct list_head d_lru;     /* LRU 链表 */
        wait_queue_head_t *d_wait;  /* 查找等待队列 */
    };
    
    /* 子目录链表 */
    struct list_head d_child;       /* 父目录的子目录链表 */
    struct list_head d_subdirs;     /* 子目录链表 */
    
    /* 别名和 RCU */
    union {
        struct hlist_node d_alias;  /* inode 别名链表 */
        struct hlist_bl_node d_in_lookup_hash;
        struct rcu_head d_rcu;
    } d_u;
};
```

### 6.4 dentry 操作

```c
struct dentry_operations {
    /* 重新验证 dentry（网络文件系统） */
    int (*d_revalidate)(struct dentry *, unsigned int);
    int (*d_weak_revalidate)(struct dentry *, unsigned int);
    
    /* 计算哈希值 */
    int (*d_hash)(const struct dentry *, struct qstr *);
    
    /* 比较文件名 */
    int (*d_compare)(const struct dentry *, unsigned int,
                     const char *, const struct qstr *);
    
    /* 删除 dentry */
    int (*d_delete)(const struct dentry *);
    
    /* 初始化 dentry */
    int (*d_init)(struct dentry *);
    
    /* 释放 dentry */
    void (*d_release)(struct dentry *);
    
    /* 剪枝 dentry */
    void (*d_prune)(struct dentry *);
    
    /* 释放 inode */
    void (*d_iput)(struct dentry *, struct inode *);
    
    /* 获取动态名称 */
    char *(*d_dname)(struct dentry *, char *, int);
    
    /* 自动挂载 */
    struct vfsmount *(*d_automount)(struct path *);
    
    /* 管理遍历 */
    int (*d_manage)(const struct path *, bool);
    
    /* 获取真实 dentry */
    struct dentry *(*d_real)(struct dentry *, const struct inode *);
};
```

### 6.5 dentry 缓存结构

```
Dentry 缓存（Dcache）结构：

哈希表（快速查找）：
+-------------------+
| dentry_hashtable  |
+-------------------+
         |
         | hash(parent, name)
         v
+-------------------+     +-------------------+     +-------------------+
| dentry "home"     |<--->| dentry "user"     |<--->| dentry "test.txt" |
| d_parent = /      |     | d_parent = home   |     | d_parent = user   |
| d_inode = 100     |     | d_inode = 200     |     | d_inode = 300     |
+-------------------+     +-------------------+     +-------------------+

LRU 链表（回收）：
+-------------------+     +-------------------+     +-------------------+
| 最近使用          |<--->| 较少使用          |<--->| 最少使用          |
| (hot)             |     | (warm)            |     | (cold)            |
+-------------------+     +-------------------+     +-------------------+
         ^                                                   |
         |                                                   v
         +-------------------(循环链表)----------------------+
```

---

## 7. file：打开的文件对象

### 7.1 什么是 file？

> **file 表示进程打开的一个文件实例，存储打开状态和读写位置**

### 7.2 file 与 inode 的关系

```
重要概念：一个 inode 可以对应多个 file

进程 A 打开 /home/test.txt：
+-------------------+
| 进程 A            |
| fd[3]             |-----> +---------------+
+-------------------+       | file A        |
                            | f_pos = 100   |
                            | f_mode = READ |
                            +-------+-------+
                                    |
                                    v
                            +---------------+
                            | inode 12345   |
                            | i_size = 1024 |
                            +---------------+
                                    ^
                                    |
                            +-------+-------+
                            | file B        |
                            | f_pos = 500   |
                            | f_mode = WRITE|
                            +-------+-------+
                                    ^
                                    |
+-------------------+       +-------+-------+
| 进程 B            |       | file C        |
| fd[5]             |------>| f_pos = 0     |
+-------------------+       | f_mode = READ |
                            +---------------+

关键理解：
1. 一个 inode 可以有多个 file
2. 每个 file 有独立的读写位置
3. 每个 file 可以有不同的打开模式
4. file 属于进程，inode 属于文件系统
```

### 7.3 file 结构

```c
struct file {
    union {
        struct llist_node fu_llist;
        struct rcu_head fu_rcuhead;
    } f_u;
    
    struct path f_path;             /* 路径（dentry + vfsmount） */
    struct inode *f_inode;          /* 关联的 inode */
    const struct file_operations *f_op; /* 文件操作 */
    
    /* 保护 f_ep, f_flags 的锁 */
    spinlock_t f_lock;
    enum rw_hint f_write_hint;      /* 写提示 */
    atomic_long_t f_count;          /* 引用计数 */
    unsigned int f_flags;           /* 打开标志 */
    fmode_t f_mode;                 /* 打开模式 */
    struct mutex f_pos_lock;        /* 位置锁 */
    loff_t f_pos;                   /* 当前读写位置 */
    struct fown_struct f_owner;     /* 所有者（用于信号） */
    const struct cred *f_cred;      /* 凭证 */
    struct file_ra_state f_ra;      /* 预读状态 */
    
    u64 f_version;                  /* 版本号 */
    void *f_security;               /* 安全模块数据 */
    void *private_data;             /* 私有数据 */
    
    /* epoll */
    struct hlist_head *f_ep;
    
    /* 地址空间 */
    struct address_space *f_mapping;
    
    /* 错误追踪 */
    errseq_t f_wb_err;
    errseq_t f_sb_err;
};
```

### 7.4 file 操作

```c
struct file_operations {
    struct module *owner;
    
    /* 定位 */
    loff_t (*llseek)(struct file *, loff_t, int);
    
    /* 读写 */
    ssize_t (*read)(struct file *, char __user *, size_t, loff_t *);
    ssize_t (*write)(struct file *, const char __user *, size_t, loff_t *);
    ssize_t (*read_iter)(struct kiocb *, struct iov_iter *);
    ssize_t (*write_iter)(struct kiocb *, struct iov_iter *);
    
    /* 轮询 */
    int (*iopoll)(struct kiocb *kiocb, bool spin);
    
    /* 目录遍历 */
    int (*iterate)(struct file *, struct dir_context *);
    int (*iterate_shared)(struct file *, struct dir_context *);
    
    /* 事件轮询 */
    __poll_t (*poll)(struct file *, struct poll_table_struct *);
    
    /* ioctl */
    long (*unlocked_ioctl)(struct file *, unsigned int, unsigned long);
    long (*compat_ioctl)(struct file *, unsigned int, unsigned long);
    
    /* 内存映射 */
    int (*mmap)(struct file *, struct vm_area_struct *);
    unsigned long mmap_supported_flags;
    
    /* 打开和关闭 */
    int (*open)(struct inode *, struct file *);
    int (*flush)(struct file *, fl_owner_t id);
    int (*release)(struct inode *, struct file *);
    
    /* 同步 */
    int (*fsync)(struct file *, loff_t, loff_t, int datasync);
    int (*fasync)(int, struct file *, int);
    
    /* 锁 */
    int (*lock)(struct file *, int, struct file_lock *);
    
    /* 发送页面 */
    ssize_t (*sendpage)(struct file *, struct page *, int, size_t, 
                        loff_t *, int);
    
    /* 获取未映射区域 */
    unsigned long (*get_unmapped_area)(struct file *, unsigned long, 
                                        unsigned long, unsigned long, 
                                        unsigned long);
    
    /* 检查标志 */
    int (*check_flags)(int);
    
    /* flock 锁 */
    int (*flock)(struct file *, int, struct file_lock *);
    
    /* splice */
    ssize_t (*splice_write)(struct pipe_inode_info *, struct file *, 
                            loff_t *, size_t, unsigned int);
    ssize_t (*splice_read)(struct file *, loff_t *, 
                           struct pipe_inode_info *, size_t, unsigned int);
    void (*splice_eof)(struct file *file);
    
    /* 租约 */
    int (*setlease)(struct file *, long, struct file_lock **, void **);
    
    /* 预分配 */
    long (*fallocate)(struct file *file, int mode, loff_t offset, loff_t len);
    
    /* 显示信息 */
    void (*show_fdinfo)(struct seq_file *m, struct file *f);
    
    /* 复制文件范围 */
    ssize_t (*copy_file_range)(struct file *, loff_t, struct file *,
                               loff_t, size_t, unsigned int);
    
    /* 重映射文件范围 */
    loff_t (*remap_file_range)(struct file *file_in, loff_t pos_in,
                               struct file *file_out, loff_t pos_out,
                               loff_t len, unsigned int remap_flags);
    
    /* 建议 */
    int (*fadvise)(struct file *, loff_t, loff_t, int);
};
```

---

## 8. 文件系统注册与挂载

### 8.1 文件系统注册

```c
struct file_system_type {
    const char *name;               /* 文件系统名称 */
    int fs_flags;                   /* 标志 */
    
    /* 初始化超级块 */
    int (*init_fs_context)(struct fs_context *);
    
    /* 参数规范 */
    const struct fs_parameter_spec *parameters;
    
    /* 获取超级块（旧接口） */
    struct dentry *(*mount)(struct file_system_type *, int,
                            const char *, void *);
    
    /* 杀死超级块 */
    void (*kill_sb)(struct super_block *);
    
    struct module *owner;           /* 所属模块 */
    struct file_system_type *next;  /* 链表 */
    struct hlist_head fs_supers;    /* 超级块链表 */
    
    /* 配额支持 */
    struct lock_class_key s_lock_key;
    struct lock_class_key s_umount_key;
    struct lock_class_key s_vfs_rename_key;
    struct lock_class_key s_writers_key[SB_FREEZE_LEVELS];
    
    struct lock_class_key i_lock_key;
    struct lock_class_key i_mutex_key;
    struct lock_class_key invalidate_lock_key;
    struct lock_class_key i_mutex_dir_key;
};
```

### 8.2 注册文件系统

```c
int register_filesystem(struct file_system_type *fs)
{
    struct file_system_type **p;
    
    /* 检查名称 */
    if (fs->name == NULL || strlen(fs->name) > 255)
        return -EINVAL;
    
    /* 检查是否已注册 */
    for (p = &file_systems; *p; p = &(*p)->next)
        if (strcmp((*p)->name, fs->name) == 0)
            return -EBUSY;
    
    /* 添加到链表 */
    *p = fs;
    return 0;
}

/* ext4 注册示例 */
static struct file_system_type ext4_fs_type = {
    .owner          = THIS_MODULE,
    .name           = "ext4",
    .init_fs_context = ext4_init_fs_context,
    .parameters     = ext4_param_specs,
    .kill_sb        = kill_block_super,
    .fs_flags       = FS_REQUIRES_DEV | FS_ALLOW_IDMAP,
};

MODULE_ALIAS_FS("ext4");

static int __init ext4_init_fs(void)
{
    return register_filesystem(&ext4_fs_type);
}
```

### 8.3 挂载流程

```
挂载命令：mount -t ext4 /dev/sda1 /mnt

挂载流程：
+-------------------+
| 用户空间 mount    |
+-------------------+
         |
         | sys_mount()
         v
+-------------------+
| VFS 层            |
| do_mount()        |
+-------------------+
         |
         | 查找文件系统类型
         v
+-------------------+
| get_fs_type()     |
| 查找 "ext4"       |
+-------------------+
         |
         | 调用文件系统挂载函数
         v
+-------------------+
| ext4_mount()      |
| 读取超级块        |
| 创建根 dentry     |
+-------------------+
         |
         | 创建 mount 结构
         v
+-------------------+
| vfs_create_mount()|
| 创建 vfsmount     |
+-------------------+
         |
         | 添加到挂载树
         v
+-------------------+
| graft_tree()      |
| 挂载到 /mnt       |
+-------------------+
```

### 8.4 挂载结构

```c
struct vfsmount {
    struct dentry *mnt_root;        /* 挂载根目录 */
    struct super_block *mnt_sb;     /* 超级块 */
    int mnt_flags;                  /* 挂载标志 */
    struct user_namespace *mnt_userns; /* 用户命名空间 */
};

struct mount {
    struct vfsmount mnt;
    struct mount *mnt_parent;       /* 父挂载点 */
    struct dentry *mnt_mountpoint;  /* 挂载点 dentry */
    struct list_head mnt_mounts;    /* 子挂载链表 */
    struct list_head mnt_child;     /* 父挂载的子链表 */
    int mnt_id;                     /* 挂载 ID */
    int mnt_group_id;               /* 组 ID */
    struct hlist_head mnt_pins;     /* pin 链表 */
    struct hlist_head mnt_stuck_children;
    struct mnt_namespace *mnt_ns;   /* 命名空间 */
    struct mountpoint *mnt_mp;      /* 挂载点 */
    struct hlist_node mnt_mp_list;  /* 挂载点链表 */
    struct list_head mnt_umounting; /* 卸载链表 */
    struct list_head mnt_umounts;   /* 子卸载链表 */
    u64 mnt_expiry_mark;            /* 过期标记 */
};
```

---

## 9. 文件打开流程

### 9.1 open 系统调用流程

```
open("/home/user/test.txt", O_RDONLY)

+-------------------+
| 用户空间 open()   |
+-------------------+
         |
         | syscall
         v
+-------------------+
| sys_open()        |
| do_sys_open()     |
+-------------------+
         |
         | 1. 分配文件描述符
         v
+-------------------+
| get_unused_fd()   |
| 分配 fd           |
+-------------------+
         |
         | 2. 打开文件
         v
+-------------------+
| do_filp_open()    |
| 路径解析          |
+-------------------+
         |
         | 3. 路径遍历
         v
+-------------------+
| path_lookupat()   |
| 逐级解析路径      |
+-------------------+
         |
         | 4. 查找 dentry
         v
+-------------------+
| lookup_fast()     |  <-- 快速路径：从 dcache 查找
| lookup_slow()     |  <-- 慢速路径：调用文件系统
+-------------------+
         |
         | 5. 创建 file 结构
         v
+-------------------+
| vfs_open()        |
| do_dentry_open()  |
+-------------------+
         |
         | 6. 调用文件系统的 open
         v
+-------------------+
| f_op->open()      |
| ext4_file_open()  |
+-------------------+
         |
         | 7. 安装文件描述符
         v
+-------------------+
| fd_install()      |
| 关联 fd 和 file   |
+-------------------+
         |
         v
+-------------------+
| 返回 fd           |
+-------------------+
```

### 9.2 路径解析详解

```c
static int link_path_walk(const char *name, struct nameidata *nd)
{
    int err;
    
    while (*name == '/')
        name++;
    
    while (*name) {
        const char *this_name = name;
        int len;
        
        /* 提取路径组件 */
        for (len = 0; *name && *name != '/'; name++, len++)
            ;
        
        /* 查找 dentry */
        err = walk_component(nd, WALK_FOLLOW);
        if (err < 0)
            return err;
        
        /* 跳过斜杠 */
        while (*name == '/')
            name++;
    }
    
    return 0;
}

static int walk_component(struct nameidata *nd, int flags)
{
    struct dentry *dentry;
    struct inode *inode;
    
    /* 快速路径：从 dcache 查找 */
    dentry = lookup_fast(nd);
    if (IS_ERR(dentry))
        return PTR_ERR(dentry);
    
    /* 慢速路径：调用文件系统 */
    if (!dentry) {
        dentry = lookup_slow(nd);
        if (IS_ERR(dentry))
            return PTR_ERR(dentry);
    }
    
    /* 更新路径 */
    nd->path.dentry = dentry;
    return 0;
}
```

---

## 10. 文件读写流程

### 10.1 read 系统调用流程

```
read(fd, buf, count)

+-------------------+
| 用户空间 read()   |
+-------------------+
         |
         | syscall
         v
+-------------------+
| sys_read()        |
| ksys_read()       |
+-------------------+
         |
         | 获取 file 结构
         v
+-------------------+
| fdget_pos(fd)     |
| 从进程获取 file   |
+-------------------+
         |
         | 调用 VFS 读函数
         v
+-------------------+
| vfs_read()        |
+-------------------+
         |
         | 检查权限
         v
+-------------------+
| rw_verify_area()  |
| 检查读权限        |
+-------------------+
         |
         | 调用文件系统读函数
         v
+-------------------+
| f_op->read()      |  <-- 同步读
| f_op->read_iter() |  <-- 异步读
+-------------------+
         |
         | 对于普通文件
         v
+-------------------+
| generic_file_read_iter() |
| 页缓存读取        |
+-------------------+
         |
         | 检查页缓存
         v
+-------------------+
| find_get_page()   |
| 查找页缓存        |
+-------------------+
         |
         | 如果未命中
         v
+-------------------+
| page_cache_sync_readahead() |
| 同步预读          |
+-------------------+
         |
         | 读取数据
         v
+-------------------+
| copy_page_to_iter() |
| 复制到用户空间    |
+-------------------+
         |
         v
+-------------------+
| 返回读取字节数    |
+-------------------+
```

### 10.2 write 系统调用流程

```
write(fd, buf, count)

+-------------------+
| 用户空间 write()  |
+-------------------+
         |
         | syscall
         v
+-------------------+
| sys_write()       |
| ksys_write()      |
+-------------------+
         |
         | 获取 file 结构
         v
+-------------------+
| fdget_pos(fd)     |
+-------------------+
         |
         | 调用 VFS 写函数
         v
+-------------------+
| vfs_write()       |
+-------------------+
         |
         | 检查权限
         v
+-------------------+
| rw_verify_area()  |
+-------------------+
         |
         | 调用文件系统写函数
         v
+-------------------+
| f_op->write()     |
| f_op->write_iter()|
+-------------------+
         |
         | 对于普通文件
         v
+-------------------+
| generic_file_write_iter() |
+-------------------+
         |
         | 获取页面
         v
+-------------------+
| pagecache_write_begin() |
+-------------------+
         |
         | 复制数据
         v
+-------------------+
| copy_page_from_iter() |
| 从用户空间复制    |
+-------------------+
         |
         | 完成写入
         v
+-------------------+
| pagecache_write_end() |
| 标记页面为脏      |
+-------------------+
         |
         | 后台回写
         v
+-------------------+
| 脏页回写          |
| writeback         |
+-------------------+
```

---

## 11. 目录操作

### 11.1 目录遍历

```c
struct dir_context {
    filldir_t actor;    /* 回调函数 */
    loff_t pos;         /* 当前位置 */
};

/* 目录遍历回调函数类型 */
typedef int (*filldir_t)(struct dir_context *ctx, const char *name, 
                         int namelen, loff_t offset, u64 ino, 
                         unsigned int d_type);

/* getdents 系统调用 */
SYSCALL_DEFINE3(getdents, unsigned int, fd,
                struct linux_dirent __user *, dirent, unsigned int, count)
{
    struct fd f;
    struct getdents_callback buf = {
        .ctx.actor = filldir,
        .current_dir = dirent,
        .count = count,
    };
    
    f = fdget_pos(fd);
    if (!f.file)
        return -EBADF;
    
    /* 调用 iterate */
    iterate_dir(f.file, &buf.ctx);
    
    fdput_pos(f);
    return buf.error ? buf.error : buf.prev;
}

static int filldir(struct dir_context *ctx, const char *name, int namlen,
                   loff_t offset, u64 ino, unsigned int d_type)
{
    struct linux_dirent __user *dirent;
    struct getdents_callback *buf =
        container_of(ctx, struct getdents_callback, ctx);
    
    /* 复制到用户空间 */
    dirent = buf->current_dir;
    if (copy_to_user(dirent->d_name, name, namlen))
        return -EFAULT;
    
    dirent->d_ino = ino;
    dirent->d_off = offset;
    dirent->d_reclen = sizeof(struct linux_dirent) + namlen;
    
    buf->current_dir = (void __user *)dirent + dirent->d_reclen;
    buf->prev = dirent->d_off;
    
    return 0;
}
```

### 11.2 创建文件

```c
/* 创建普通文件 */
int vfs_create(struct user_namespace *mnt_userns, struct inode *dir,
               struct dentry *dentry, umode_t mode, bool want_excl)
{
    int error;
    
    /* 检查权限 */
    error = inode_permission(mnt_userns, dir, MAY_WRITE | MAY_EXEC);
    if (error)
        return error;
    
    /* 调用文件系统的 create */
    error = dir->i_op->create(mnt_userns, dir, dentry, mode, want_excl);
    if (!error)
        fsnotify_create(dir, dentry);
    
    return error;
}

/* 创建目录 */
int vfs_mkdir(struct user_namespace *mnt_userns, struct inode *dir,
              struct dentry *dentry, umode_t mode)
{
    int error;
    
    error = inode_permission(mnt_userns, dir, MAY_WRITE | MAY_EXEC);
    if (error)
        return error;
    
    error = dir->i_op->mkdir(mnt_userns, dir, dentry, mode);
    if (!error)
        fsnotify_mkdir(dir, dentry);
    
    return error;
}

/* 创建符号链接 */
int vfs_symlink(struct user_namespace *mnt_userns, struct inode *dir,
                struct dentry *dentry, const char *oldname)
{
    int error;
    
    error = inode_permission(mnt_userns, dir, MAY_WRITE | MAY_EXEC);
    if (error)
        return error;
    
    error = dir->i_op->symlink(mnt_userns, dir, dentry, oldname);
    if (!error)
        fsnotify_create(dir, dentry);
    
    return error;
}
```

---

## 12. 缓存机制详解

### 12.1 Page Cache

```
Page Cache 结构：

文件 inode
+-------------------+
| address_space     |
| i_pages (xarray)  |
+-------------------+
         |
         | 索引
         v
+-------------------+
| xarray            |
| [0] --> page 0    |
| [1] --> page 1    |
| [2] --> page 2    |
| ...               |
+-------------------+

页面结构：
+-------------------+
| struct page       |
| index = 0         |  <-- 文件偏移 / PAGE_SIZE
| mapping = inode   |
| flags = dirty     |
+-------------------+
         |
         | 数据
         v
+-------------------+
| 4KB 数据          |
| 文件内容          |
+-------------------+
```

### 12.2 Dentry Cache

```
Dentry Cache 结构：

哈希表：
+-------------------+
| dentry_hashtable  |
| [0]               |
| [1] --> dentry    |
| [2] --> dentry    |
| ...               |
+-------------------+

查找过程：
1. 计算 hash(parent, name)
2. 在哈希桶中查找
3. 比较文件名
4. 返回 dentry

LRU 链表：
+-------------------+
| dentry_unused     |
| (LRU 链表头)      |
+-------------------+
         |
         v
+-------------------+     +-------------------+
| 最近使用          |<--->| 较少使用          |
+-------------------+     +-------------------+
                                    |
                                    v
                            +-------------------+
                            | 最少使用          |
                            | (回收候选)        |
                            +-------------------+
```

### 12.3 Inode Cache

```
Inode Cache 结构：

哈希表：
+-------------------+
| inode_hashtable   |
| [0]               |
| [1] --> inode     |
| [2] --> inode     |
| ...               |
+-------------------+

查找过程：
1. 计算 hash(sb, ino)
2. 在哈希桶中查找
3. 比较 inode 号
4. 返回 inode

LRU 链表：
+-------------------+
| inode_unused      |
| (LRU 链表头)      |
+-------------------+
         |
         v
+-------------------+
| 最近使用          |
+-------------------+
```

---

## 13. VFS 的设计哲学

### 13.1 一切皆文件

```
Unix 哲学：一切皆文件

普通文件：/home/user/test.txt
目录：/home/user/
设备文件：/dev/sda, /dev/null
管道：/tmp/pipe
套接字：/var/run/docker.sock
符号链接：/lib64 -> /usr/lib64
proc 文件：/proc/cpuinfo
sys 文件：/sys/class/net/eth0/mtu

好处：
1. 统一的 API：open, read, write, close
2. 统一的权限模型
3. 统一的命名空间
4. 易于理解和编程
```

### 13.2 分层与抽象

```
VFS 分层设计：

+-------------------+
| 用户空间          |  <-- 应用程序
+-------------------+
         |
         v
+-------------------+
| 系统调用层        |  <-- sys_open, sys_read
+-------------------+
         |
         v
+-------------------+
| VFS 抽象层        |  <-- 统一接口
+-------------------+
         |
         v
+-------------------+
| 文件系统实现      |  <-- ext4, xfs, nfs
+-------------------+
         |
         v
+-------------------+
| 块设备层          |  <-- 驱动程序
+-------------------+
         |
         v
+-------------------+
| 硬件设备          |  <-- 磁盘、SSD
+-------------------+

好处：
1. 上层不需要知道下层实现
2. 下层变化不影响上层
3. 易于添加新功能
4. 易于测试和维护
```

### 13.3 缓存为王

```
VFS 缓存策略：

+-------------------+
| Dentry Cache      |  <-- 路径解析加速
| 目录项缓存        |
+-------------------+
         |
         v
+-------------------+
| Inode Cache       |  <-- 元数据缓存
| inode 缓存        |
+-------------------+
         |
         v
+-------------------+
| Page Cache        |  <-- 数据缓存
| 页缓存            |
+-------------------+

缓存原则：
1. 时间局部性：最近访问的数据可能再次访问
2. 空间局部性：相邻的数据可能一起访问
3. 预读：预测性地读取数据
4. 延迟写：延迟写入，合并 I/O
```

### 13.4 性能优化技术

```
VFS 性能优化：

1. RCU 路径查找
   - 无锁路径解析
   - 大幅提高并发性能

2. 预读机制
   - 预测性读取
   - 减少 I/O 次数

3. 大页支持
   - 减少页表开销
   - 提高 TLB 命中率

4. 异步 I/O
   - io_uring
   - 批量提交

5. Direct I/O
   - 绕过页缓存
   - 适合特定场景

6. 多队列块层
   - blk-mq
   - 充分利用 SSD 性能
```

---

## 总结

VFS 是 Linux 内核最核心的子系统之一，它通过抽象层设计实现了：

1. **统一接口**：所有文件系统使用相同的 API
2. **可扩展性**：易于添加新的文件系统
3. **高性能**：多层缓存机制
4. **安全性**：统一的权限模型

理解 VFS 对于理解 Linux 系统至关重要，它是连接用户空间和存储设备的桥梁。
