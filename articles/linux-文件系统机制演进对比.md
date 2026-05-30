# Linux 文件系统机制演进对比

## 目录

1. **`概述`**
2. **`架构对比`**
3. **`核心数据结构对比`**
4. **`文件系统支持对比`**
5. **`挂载机制对比`**
6. **`缓存机制对比`**
7. **`文件操作对比`**
8. **`安全与权限对比`**
9. **`性能优化对比`**
10. **`总结`**

---

## 1. 概述

### 1.1 Linux 0.11 文件系统特点

| 特性 | 说明 |
|------|------|
| **文件系统类型** | 仅支持 Minix 文件系统 |
| **架构** | 简单的分层结构，无抽象层 |
| **缓存** | Buffer Cache（缓冲区缓存） |
| **最大文件** | 约 256 MB |
| **最大文件名** | 14/30 字节 |
| **挂载** | 基本的挂载支持 |

### 1.2 Linux 5.15 文件系统特点

| 特性 | 说明 |
|------|------|
| **文件系统类型** | 支持 50+ 种文件系统 |
| **架构** | VFS 抽象层 + 多种文件系统实现 |
| **缓存** | Page Cache + Buffer Cache + Dentry Cache + Inode Cache |
| **最大文件** | 16 TB（32位）/ 8 EB（64位） |
| **最大文件名** | 255 字节 |
| **挂载** | 支持绑定挂载、共享子树、ID 映射等 |

---

## 2. 架构对比

### 2.1 Linux 0.11 架构

```
+-------------------+
|    用户空间       |
+-------------------+
         |
         v
+-------------------+
|    系统调用       |
|  sys_open, sys_read |
+-------------------+
         |
         v
+-------------------+
|   Minix 文件系统  |  <-- 直接调用具体文件系统
|   fs/open.c       |
|   fs/read_write.c |
+-------------------+
         |
         v
+-------------------+
|   Buffer Cache    |  <-- 缓冲区缓存
|   fs/buffer.c     |
+-------------------+
         |
         v
+-------------------+
|   块设备驱动      |
|   kernel/blk_drv  |
+-------------------+
         |
         v
+-------------------+
|     硬盘          |
+-------------------+
```

**特点**：
- 没有抽象层，直接操作具体文件系统
- 代码与 Minix 文件系统紧密耦合
- 难以添加新的文件系统

### 2.2 Linux 5.15 架构

```
+-------------------+
|    用户空间       |
+-------------------+
         |
         v
+-------------------+
|    系统调用       |
|  sys_open, sys_read |
+-------------------+
         |
         v
+-------------------+
|    VFS 层         |  <-- 虚拟文件系统抽象层
|  fs/open.c        |
|  fs/read_write.c  |
|  fs/namei.c       |
+-------------------+
         |
    +----+----+----+----+
    |    |    |    |    |
    v    v    v    v    v
+------+ +------+ +------+ +------+
| ext4 | | xfs  | | btrfs| | nfs  | ...  <-- 多种文件系统
+------+ +------+ +------+ +------+
    |         |        |        |
    v         v        v        v
+-----------------------------------+
|         Page Cache                |  <-- 页缓存
+-----------------------------------+
                |
                v
+-----------------------------------+
|         块设备层                   |
+-----------------------------------+
                |
                v
+-----------------------------------+
|           存储设备                 |
+-----------------------------------+
```

**特点**：
- VFS 层提供统一接口
- 支持多种文件系统并存
- 文件系统实现与 VFS 解耦
- 易于添加新的文件系统

---

## 3. 核心数据结构对比

### 3.1 超级块（super_block）

| 字段 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **设备号** | s_dev | s_dev |
| **魔数** | s_magic | s_magic |
| **块大小** | 固定 1KB | s_blocksize（可变） |
| **最大文件** | s_max_size | s_maxbytes |
| **根目录** | s_isup | s_root（dentry） |
| **挂载点** | s_imount | 通过 mount 结构管理 |
| **操作函数** | 无 | s_op（super_operations） |
| **文件系统类型** | 无 | s_type |
| **UUID** | 无 | s_uuid |
| **用户命名空间** | 无 | s_user_ns |
| **冻结状态** | 无 | s_writers |
| **加密支持** | 无 | s_cop |
| **配额支持** | 无 | s_dquot |

**Linux 0.11 超级块**：
```c
struct super_block {
    unsigned short s_ninodes;
    unsigned short s_nzones;
    unsigned short s_imap_blocks;
    unsigned short s_zmap_blocks;
    unsigned short s_firstdatazone;
    unsigned short s_log_zone_size;
    unsigned long s_max_size;
    unsigned short s_magic;
    
    struct buffer_head * s_imap[8];
    struct buffer_head * s_zmap[8];
    unsigned short s_dev;
    struct m_inode * s_isup;
    struct m_inode * s_imount;
    unsigned long s_time;
    struct task_struct * s_wait;
    unsigned char s_lock;
    unsigned char s_rd_only;
    unsigned char s_dirt;
};
```

**Linux 5.15 超级块**：
```c
struct super_block {
    struct list_head s_list;
    dev_t s_dev;
    unsigned char s_blocksize_bits;
    unsigned long s_blocksize;
    loff_t s_maxbytes;
    struct file_system_type *s_type;
    const struct super_operations *s_op;
    unsigned long s_flags;
    unsigned long s_magic;
    struct dentry *s_root;
    struct rw_semaphore s_umount;
    int s_count;
    atomic_t s_active;
    void *s_security;
    struct hlist_bl_head s_roots;
    struct list_head s_mounts;
    struct block_device *s_bdev;
    struct backing_dev_info *s_bdi;
    void *s_fs_info;
    u32 s_time_gran;
    uuid_t s_uuid;
    struct user_namespace *s_user_ns;
    struct sb_writers s_writers;
    struct list_lru s_dentry_lru;
    struct list_lru s_inode_lru;
    spinlock_t s_inode_list_lock;
    struct list_head s_inodes;
};
```

### 3.2 索引节点（inode）

| 字段 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **模式** | i_mode | i_mode |
| **UID/GID** | i_uid, i_gid | i_uid, i_gid（kuid_t/kgid_t） |
| **大小** | i_size | i_size（loff_t） |
| **时间** | i_time | i_atime, i_mtime, i_ctime（timespec64） |
| **链接数** | i_nlinks | i_nlink |
| **数据块指针** | i_zone[9] | i_mapping（address_space） |
| **引用计数** | i_count | i_count（atomic_t） |
| **锁** | i_lock（简单锁） | i_rwsem（读写信号量） |
| **操作函数** | 无 | i_op, i_fop |
| **ACL** | 无 | i_acl, i_default_acl |
| **安全标签** | 无 | i_security |
| **加密信息** | 无 | i_crypt_info |
| **文件锁** | 无 | i_flctx |

**Linux 0.11 inode**：
```c
struct m_inode {
    unsigned short i_mode;
    unsigned short i_uid;
    unsigned long i_size;
    unsigned long i_mtime;
    unsigned char i_gid;
    unsigned char i_nlinks;
    unsigned short i_zone[9];  /* 直接/间接块指针 */
    
    struct task_struct * i_wait;
    unsigned long i_atime;
    unsigned long i_ctime;
    unsigned short i_dev;
    unsigned short i_num;
    unsigned short i_count;
    unsigned char i_lock;
    unsigned char i_dirt;
    unsigned char i_pipe;
    unsigned char i_mount;
};
```

**Linux 5.15 inode**：
```c
struct inode {
    umode_t i_mode;
    unsigned short i_opflags;
    kuid_t i_uid;
    kgid_t i_gid;
    unsigned int i_flags;
    
    struct posix_acl *i_acl;
    struct posix_acl *i_default_acl;
    
    const struct inode_operations *i_op;
    struct super_block *i_sb;
    struct address_space *i_mapping;
    
    void *i_security;
    
    unsigned long i_ino;
    union {
        const unsigned int i_nlink;
        unsigned int __i_nlink;
    };
    dev_t i_rdev;
    loff_t i_size;
    struct timespec64 i_atime;
    struct timespec64 i_mtime;
    struct timespec64 i_ctime;
    spinlock_t i_lock;
    unsigned short i_bytes;
    u8 i_blkbits;
    blkcnt_t i_blocks;
    
    unsigned long i_state;
    struct rw_semaphore i_rwsem;
    
    struct hlist_node i_hash;
    struct list_head i_io_list;
    struct list_head i_lru;
    struct list_head i_sb_list;
    struct hlist_head i_dentry;
    
    atomic64_t i_version;
    atomic_t i_count;
    atomic_t i_dio_count;
    atomic_t i_writecount;
    
    const struct file_operations *i_fop;
    struct file_lock_context *i_flctx;
    struct address_space i_data;
    
    void *i_private;
};
```

### 3.3 目录项（dentry）

| 特性 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **结构** | dir_entry（磁盘格式） | dentry（内存缓存） |
| **缓存** | 无 | Dentry Cache |
| **哈希表** | 无 | d_hash |
| **LRU 链表** | 无 | d_lru |
| **引用计数** | 无 | d_lockref.count |
| **操作函数** | 无 | d_op |

**Linux 0.11 目录项**：
```c
struct dir_entry {
    unsigned short inode;
    char name[NAME_LEN];  /* 14 或 30 字节 */
};
```

**Linux 5.15 dentry**：
```c
struct dentry {
    unsigned int d_flags;
    seqcount_spinlock_t d_seq;
    struct hlist_bl_node d_hash;
    struct dentry *d_parent;
    struct qstr d_name;
    struct inode *d_inode;
    unsigned char d_iname[DNAME_INLINE_LEN];
    
    struct lockref d_lockref;
    const struct dentry_operations *d_op;
    struct super_block *d_sb;
    unsigned long d_time;
    void *d_fsdata;
    
    union {
        struct list_head d_lru;
        wait_queue_head_t *d_wait;
    };
    struct list_head d_child;
    struct list_head d_subdirs;
    
    union {
        struct hlist_node d_alias;
        struct hlist_bl_node d_in_lookup_hash;
        struct rcu_head d_rcu;
    } d_u;
};
```

### 3.4 文件对象（file）

| 字段 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **模式** | f_mode | f_mode |
| **标志** | f_flags | f_flags |
| **位置** | f_pos | f_pos（loff_t） |
| **inode** | f_inode | f_inode |
| **操作函数** | 无 | f_op |
| **引用计数** | f_count | f_count（atomic_long_t） |
| **预读状态** | 无 | f_ra |
| **私有数据** | 无 | private_data |
| **错误追踪** | 无 | f_wb_err, f_sb_err |

**Linux 0.11 文件表项**：
```c
struct file {
    unsigned short f_mode;
    unsigned short f_flags;
    unsigned short f_count;
    struct m_inode * f_inode;
    off_t f_pos;
};
```

**Linux 5.15 file**：
```c
struct file {
    union {
        struct llist_node fu_llist;
        struct rcu_head fu_rcuhead;
    } f_u;
    struct path f_path;
    struct inode *f_inode;
    const struct file_operations *f_op;
    
    spinlock_t f_lock;
    enum rw_hint f_write_hint;
    atomic_long_t f_count;
    unsigned int f_flags;
    fmode_t f_mode;
    struct mutex f_pos_lock;
    loff_t f_pos;
    struct fown_struct f_owner;
    const struct cred *f_cred;
    struct file_ra_state f_ra;
    
    u64 f_version;
    void *f_security;
    void *private_data;
    
    struct hlist_head *f_ep;
    struct address_space *f_mapping;
    errseq_t f_wb_err;
    errseq_t f_sb_err;
};
```

---

## 4. 文件系统支持对比

### 4.1 Linux 0.11 支持的文件系统

```
+-------------------+
|   Minix 文件系统  |  <-- 唯一支持的文件系统
+-------------------+
```

**Minix 文件系统特点**：
- 简单、可靠
- 最大文件 256 MB
- 文件名长度 14/30 字节
- 无日志功能
- 无扩展属性

### 4.2 Linux 5.15 支持的文件系统

```
+-------------------+-------------------+-------------------+
|    本地文件系统    |    网络文件系统    |    特殊文件系统    |
+-------------------+-------------------+-------------------+
| ext2, ext3, ext4  | NFS, CIFS/SMB    | procfs, sysfs    |
| XFS               | AFS              | tmpfs, devtmpfs  |
| Btrfs             | Ceph             | debugfs          |
| JFS, ReiserFS     | GlusterFS        | tracefs          |
| F2FS              | Lustre           | configfs         |
| NILFS2            | 9P               | securityfs       |
| OCFS2             |                  | cgroup           |
| GFS2              |                  | pstore           |
+-------------------+-------------------+-------------------+

+-------------------+-------------------+
|   闪存文件系统     |   其他文件系统     |
+-------------------+-------------------+
| JFFS2             | NTFS（只读/读写） |
| YAFFS2            | FAT/VFAT          |
| UBIFS             | exFAT             |
| LogFS             | HFS/HFS+          |
+-------------------+-------------------+
```

**主要文件系统特点**：

| 文件系统 | 特点 |
|---------|------|
| **ext4** | Linux 默认，日志，大文件支持 |
| **XFS** | 高性能，大文件，企业级 |
| **Btrfs** | COW，快照，校验和，子卷 |
| **F2FS** | 闪存优化，SSD 友好 |
| **NFS** | 网络文件系统，跨机器共享 |
| **tmpfs** | 内存文件系统，高性能 |

---

## 5. 挂载机制对比

### 5.1 Linux 0.11 挂载机制

```c
int sys_mount(char * dev_name, char * dir_name, int rw_flag)
{
    /* 简单的挂载实现 */
    /* 建立挂载关系 */
    sb->s_imount = dir_i;    /* 超级块指向挂载点 */
    dir_i->i_mount = 1;      /* 标记为挂载点 */
}
```

**特点**：
- 只支持设备挂载
- 无挂载选项
- 无绑定挂载
- 无共享子树

### 5.2 Linux 5.15 挂载机制

```c
struct vfsmount {
    struct dentry *mnt_root;      /* 挂载根目录 */
    struct super_block *mnt_sb;   /* 超级块 */
    int mnt_flags;                /* 挂载标志 */
    struct user_namespace *mnt_userns;
};

struct mount {
    struct vfsmount mnt;
    struct mount *mnt_parent;
    struct dentry *mnt_mountpoint;
    struct list_head mnt_mounts;
    struct list_head mnt_child;
    int mnt_id;
    int mnt_group_id;
    struct hlist_head mnt_pins;
    struct hlist_head mnt_stuck_children;
    struct mnt_namespace *mnt_ns;
};
```

**挂载选项**：

| 选项 | 说明 |
|------|------|
| MNT_NOSUID | 忽略 setuid/setgid 位 |
| MNT_NODEV | 禁止访问设备文件 |
| MNT_NOEXEC | 禁止执行程序 |
| MNT_NOATIME | 不更新访问时间 |
| MNT_NODIRATIME | 不更新目录访问时间 |
| MNT_RELATIME | 相对访问时间更新 |
| MNT_READONLY | 只读挂载 |
| MNT_SHARED | 共享挂载 |
| MNT_UNBINDABLE | 不可绑定挂载 |

**挂载传播类型**：

```
共享挂载（Shared）：
+-------------------+
| / (shared)        |
|   └── /mnt (shared)
+-------------------+
         |
         v
+-------------------+
| /data (shared)    |  <-- 挂载传播
+-------------------+

从属挂载（Slave）：
+-------------------+
| / (shared)        |
|   └── /mnt (slave)  <-- 只接收，不传播
+-------------------+

私有挂载（Private）：
+-------------------+
| / (shared)        |
|   └── /mnt (private)  <-- 完全隔离
+-------------------+

不可绑定挂载（Unbindable）：
+-------------------+
| / (shared)        |
|   └── /mnt (unbindable)  <-- 不能被绑定挂载
+-------------------+
```

---

## 6. 缓存机制对比

### 6.1 Linux 0.11 缓存机制

```
+-------------------+
|   Buffer Cache    |  <-- 唯一的缓存
+-------------------+
         |
         v
+-------------------+
|   块设备          |
+-------------------+

Buffer Cache 特点：
- 固定大小缓冲区（1KB）
- 哈希表 + LRU 链表
- 缓存磁盘块
- 无页缓存
```

### 6.2 Linux 5.15 缓存机制

```
+-------------------+     +-------------------+     +-------------------+
|   Dentry Cache    |     |   Inode Cache     |     |   Page Cache      |
|   (dcache)        |     |   (icache)        |     |   (pagecache)     |
+-------------------+     +-------------------+     +-------------------+
         |                         |                         |
         v                         v                         v
+-------------------+     +-------------------+     +-------------------+
|   目录项缓存      |     |   inode 缓存      |     |   文件数据缓存    |
|   路径解析加速    |     |   元数据缓存      |     |   读写缓冲        |
+-------------------+     +-------------------+     +-------------------+

+-------------------+
|   Buffer Cache    |  <-- 作为 Page Cache 的一部分
+-------------------+
         |
         v
+-------------------+
|   块设备          |
+-------------------+
```

**Page Cache 特点**：
- 以页（4KB）为单位
- 使用 xarray 管理页面
- 支持预读
- 支持脏页回写
- 支持大页

**Dentry Cache 特点**：
- 缓存目录项
- 加速路径解析
- 哈希表查找
- LRU 回收

**Inode Cache 特点**：
- 缓存 inode 结构
- 减少磁盘访问
- 哈希表 + LRU

---

## 7. 文件操作对比

### 7.1 文件打开流程对比

**Linux 0.11**：
```c
int sys_open(const char * filename, int flag, int mode)
{
    struct m_inode * inode;
    struct file * f;
    int fd;
    
    /* 1. 解析路径名 */
    if (!(inode = namei(filename)))
        return -ENOENT;
    
    /* 2. 分配文件表项 */
    for (fd = 0; fd < NR_OPEN; fd++)
        if (!current->filp[fd])
            break;
    
    /* 3. 设置文件表项 */
    f = file_table + fd;
    f->f_mode = mode;
    f->f_flags = flag;
    f->f_inode = inode;
    f->f_pos = 0;
    
    return fd;
}
```

**Linux 5.15**：
```c
long do_sys_open(int dfd, const char __user *filename, int flags, umode_t mode)
{
    struct open_flags op;
    int fd = -1;
    struct filename *tmp;
    
    /* 1. 解析路径名 */
    tmp = getname(filename);
    if (IS_ERR(tmp))
        return PTR_ERR(tmp);
    
    /* 2. 准备打开标志 */
    fd = get_unused_fd_flags(flags);
    if (fd >= 0) {
        struct file *f = do_filp_open(dfd, tmp, &op);
        if (IS_ERR(f)) {
            put_unused_fd(fd);
            fd = PTR_ERR(f);
        } else {
            fsnotify_open(f);
            fd_install(fd, f);
        }
    }
    putname(tmp);
    return fd;
}

struct file *do_filp_open(int dfd, struct filename *pathname,
                          const struct open_flags *op)
{
    struct nameidata nd;
    int flags = op->lookup_flags;
    struct file *filp;
    
    /* 1. 路径解析 */
    set_nameidata(&nd, dfd, pathname, NULL);
    filp = path_openat(&nd, op, flags | LOOKUP_RCU);
    if (unlikely(filp == ERR_PTR(-ECHILD)))
        filp = path_openat(&nd, op, flags);
    if (unlikely(filp == ERR_PTR(-ESTALE)))
        filp = path_openat(&nd, op, flags | LOOKUP_REVAL);
    restore_nameidata();
    return filp;
}
```

### 7.2 文件读写对比

**Linux 0.11**：
```c
int sys_read(unsigned int fd, char * buf, int count)
{
    struct file * file;
    struct m_inode * inode;
    
    file = current->filp[fd];
    inode = file->f_inode;
    
    if (S_ISCHR(inode->i_mode))
        return rw_char(READ, inode->i_zone[0], buf, count, &file->f_pos);
    
    if (S_ISBLK(inode->i_mode))
        return block_read(inode->i_zone[0], buf, count);
    
    /* 普通文件读取 */
    return file_read(inode, file, buf, count);
}
```

**Linux 5.15**：
```c
ssize_t vfs_read(struct file *file, char __user *buf, size_t count, loff_t *pos)
{
    ssize_t ret;
    
    if (!(file->f_mode & FMODE_READ))
        return -EBADF;
    if (!(file->f_mode & FMODE_CAN_READ))
        return -EINVAL;
    
    ret = rw_verify_area(READ, file, pos, count);
    if (ret)
        return ret;
    
    if (count > MAX_RW_COUNT)
        count =  MAX_RW_COUNT;
    
    if (file->f_op->read)
        ret = file->f_op->read(file, buf, count, pos);
    else if (file->f_op->read_iter)
        ret = new_sync_read(file, buf, count, pos);
    else
        ret = -EINVAL;
    
    if (ret > 0) {
        fsnotify_access(file);
        add_rchar(current, ret);
    }
    
    return ret;
}
```

### 7.3 支持的操作对比

| 操作 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| open | ✓ | ✓ |
| read | ✓ | ✓ |
| write | ✓ | ✓ |
| close | ✓ | ✓ |
| lseek | ✓ | ✓ |
| stat | ✓ | ✓（增强） |
| fstat | ✓ | ✓ |
| mkdir | ✓ | ✓ |
| rmdir | ✓ | ✓ |
| unlink | ✓ | ✓ |
| rename | ✓ | ✓（增强） |
| symlink | ✗ | ✓ |
| readlink | ✗ | ✓ |
| fcntl | ✗ | ✓ |
| ioctl | ✓（简单） | ✓（完整） |
| mmap | ✗ | ✓ |
| sendfile | ✗ | ✓ |
| splice | ✗ | ✓ |
| copy_file_range | ✗ | ✓ |
| fallocate | ✗ | ✓ |
| sync_file_range | ✗ | ✓ |

---

## 8. 安全与权限对比

### 8.1 Linux 0.11 安全机制

```
权限检查：
+-------------------+
| i_mode 低 9 位    |  <-- rwxrwxrwx
+-------------------+
         |
         v
+-------------------+
| 简单的权限检查    |
| current->uid      |
| current->gid      |
+-------------------+
```

**特点**：
- 仅支持基本权限位
- 无 ACL 支持
- 无安全模块
- 无能力系统

### 8.2 Linux 5.15 安全机制

```
权限检查：
+-------------------+
| i_mode 低 9 位    |  <-- rwxrwxrwx
+-------------------+
         |
         v
+-------------------+
| POSIX ACL         |  <-- 访问控制列表
+-------------------+
         |
         v
+-------------------+
| LSM (SELinux,     |  <-- 安全模块
| AppArmor, Smack)  |
+-------------------+
         |
         v
+-------------------+
| Capabilities      |  <-- 能力系统
+-------------------+
```

**安全特性**：

| 特性 | 说明 |
|------|------|
| **POSIX ACL** | 细粒度权限控制 |
| **SELinux** | 强制访问控制 |
| **AppArmor** | 基于路径的访问控制 |
| **Smack** | 简单的强制访问控制 |
| **Capabilities** | 细分 root 权限 |
| **Securebits** | 安全位控制 |
| **User Namespace** | 用户命名空间隔离 |

---

## 9. 性能优化对比

### 9.1 Linux 0.11 性能特点

```
性能特点：
- 简单的 Buffer Cache
- 无预读机制
- 无异步 I/O
- 无大页支持
- 单进程处理
```

### 9.2 Linux 5.15 性能优化

```
性能优化：
+-------------------+
| 预读机制          |  <-- 预测性读取
+-------------------+
         |
         v
+-------------------+
| 异步 I/O          |  <-- io_uring, libaio
+-------------------+
         |
         v
+-------------------+
| 大页支持          |  <-- HugeTLB, THP
+-------------------+
         |
         v
+-------------------+
| 多队列块层        |  <-- blk-mq
+-------------------+
         |
         v
+-------------------+
| Direct I/O        |  <-- 绕过页缓存
+-------------------+
         |
         v
+-------------------+
| RCU 路径查找      |  <-- 无锁路径解析
+-------------------+
```

**性能优化技术**：

| 技术 | 说明 |
|------|------|
| **预读** | 预测性读取数据 |
| **io_uring** | 高性能异步 I/O |
| **大页** | 减少页表开销 |
| **blk-mq** | 多队列块设备 |
| **Direct I/O** | 绕过页缓存 |
| **RCU 查找** | 无锁路径解析 |
| **DAX** | 直接访问存储 |
| **Writeback** | 后台脏页回写 |

---

## 10. 总结

### 10.1 主要演进

| 方面 | Linux 0.11 | Linux 5.15 |
|------|------------|------------|
| **架构** | 单一文件系统 | VFS 抽象层 |
| **文件系统** | 仅 Minix | 50+ 种 |
| **缓存** | Buffer Cache | 多层缓存 |
| **最大文件** | 256 MB | 16 TB / 8 EB |
| **安全** | 基本权限 | ACL + LSM |
| **性能** | 基本实现 | 多种优化 |
| **并发** | 简单锁 | RCU + 细粒度锁 |

### 10.2 关键改进

1. **VFS 抽象层**
   - 统一的文件系统接口
   - 支持多种文件系统
   - 易于扩展

2. **多层缓存**
   - Page Cache 提高读写性能
   - Dentry Cache 加速路径解析
   - Inode Cache 减少磁盘访问

3. **安全增强**
   - POSIX ACL 细粒度权限
   - LSM 安全模块框架
   - 用户命名空间隔离

4. **性能优化**
   - 预读机制
   - 异步 I/O
   - 大页支持
   - RCU 无锁查找

### 10.3 设计哲学

**Linux 0.11**：
- 简单、直接
- 教学目的
- 最小实现

**Linux 5.15**：
- 抽象、可扩展
- 生产级性能
- 安全可靠
- 多场景支持
