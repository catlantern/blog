# Linux 5.15 Mount 与链接机制详解

## 目录

1. **`概述`**
2. **`挂载机制`**
3. **`硬链接机制`**
4. **`软链接机制`**
5. **`路径解析机制`**
6. **`访问流程详解`**
7. **`实际案例分析`**

---

## 1. 概述

### 1.1 什么是 Mount 与链接？

```
Mount（挂载）：
+===========================================================================+
|                                                                           |
|   定义：                                                                  |
|   +-------------------+                                                    |
|   | 将文件系统关联到目录树的某个目录 |                                     |
|   | 使文件系统中的文件可以通过该目录访问 |                                  |
|   +-------------------+                                                    |
|                                                                           |
|   作用：                                                                  |
|   +-------------------+                                                    |
|   | 构建统一的文件系统命名空间 |                                            |
|   | 支持多种文件系统类型     |  ext4、btrfs、xfs 等                        |
|   | 支持多设备挂载           |  硬盘、U盘、网络文件系统等                   |
|   +-------------------+                                                    |
|                                                                           |
|   示例：                                                                  |
|   +-------------------+                                                    |
|   | mount /dev/sda1 /mnt |  将设备 /dev/sda1 挂载到 /mnt 目录             |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+

硬链接（Hard Link）：
+===========================================================================+
|                                                                           |
|   定义：                                                                  |
|   +-------------------+                                                    |
|   | 多个文件名指向同一个 inode |                                            |
|   | 它们是同一个文件的不同名字 |                                            |
|   +-------------------+                                                    |
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 共享相同的 inode   |  inode 号相同                                     |
|   | 共享相同的数据     |  数据块相同                                       |
|   | 删除原文件不影响链接 |  链接数减 1，但文件仍存在                       |
|   | 不能跨文件系统     |  inode 不能跨文件系统                             |
|   | 不能链接目录       |  防止循环                                         |
|   +-------------------+                                                    |
|                                                                           |
|   示例：                                                                  |
|   +-------------------+                                                    |
|   | ln /home/user/file.txt /home/user/hardlink.txt |                       |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+

软链接（Symbolic Link）：
+===========================================================================+
|                                                                           |
|   定义：                                                                  |
|   +-------------------+                                                    |
|   | 特殊类型的文件     |                                                    |
|   | 存储目标文件的路径 |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   特点：                                                                  |
|   +-------------------+                                                    |
|   | 有自己的 inode     |  inode 号不同                                     |
|   | 存储目标路径       |  可以是相对路径或绝对路径                         |
|   | 可以跨文件系统     |  只存储路径字符串                                 |
|   | 可以链接目录       |                                                    |
|   | 目标删除后成为悬空链接 |  访问会失败                                     |
|   +-------------------+                                                    |
|                                                                           |
|   示例：                                                                  |
|   +-------------------+                                                    |
|   | ln -s /home/user/file.txt /home/user/softlink.txt |                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 1.2 为什么需要 Mount 与链接？

```
为什么需要 Mount？
+===========================================================================+
|                                                                           |
|   1. 统一命名空间：                                                       |
|   +-------------------+                                                    |
|   | 所有文件系统通过统一的目录树访问 |                                      |
|   | 用户无需关心文件在哪个设备上     |                                      |
|   +-------------------+                                                    |
|                                                                           |
|   2. 灵活扩展：                                                           |
|   +-------------------+                                                    |
|   | 可以随时添加新的存储设备 |                                                |
|   | 可以挂载网络文件系统   |                                                  |
|   +-------------------+                                                    |
|                                                                           |
|   3. 隔离与安全：                                                         |
|   +-------------------+                                                    |
|   | 不同文件系统可以有不同的挂载选项 |                                      |
|   | 只读挂载、noexec 挂载等           |                                      |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+

为什么需要硬链接？
+===========================================================================+
|                                                                           |
|   1. 节省空间：                                                           |
|   +-------------------+                                                    |
|   | 不需要复制文件内容 |                                                    |
|   | 只增加目录项     |                                                      |
|   +-------------------+                                                    |
|                                                                           |
|   2. 同步更新：                                                           |
|   +-------------------+                                                    |
|   | 修改任何一个链接都会更新文件 |                                          |
|   | 所有链接看到的内容一致       |                                          |
|   +-------------------+                                                    |
|                                                                           |
|   3. 备份保护：                                                           |
|   +-------------------+                                                    |
|   | 删除原文件不会丢失数据 |                                                  |
|   | 只要链接数不为 0，文件就存在 |                                           |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+

为什么需要软链接？
+===========================================================================+
|                                                                           |
|   1. 跨文件系统：                                                         |
|   +-------------------+                                                    |
|   | 可以链接不同文件系统的文件 |                                              |
|   | 硬链接做不到这一点       |                                                |
|   +-------------------+                                                    |
|                                                                           |
|   2. 链接目录：                                                           |
|   +-------------------+                                                    |
|   | 可以创建目录的链接   |                                                    |
|   | 硬链接不允许链接目录 |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   3. 灵活引用：                                                           |
|   +-------------------+                                                    |
|   | 可以链接不存在的文件 |                                                    |
|   | 可以随时更改目标     |                                                    |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 2. 挂载机制

### 2.1 挂载相关数据结构

```c
/*
 * vfsmount 结构 - 挂载的核心表示
 * 定义在 include/linux/mount.h
 */
struct vfsmount {
    struct dentry *mnt_root;        /* 挂载树的根 dentry */
    struct super_block *mnt_sb;     /* 超级块指针 */
    int mnt_flags;                  /* 挂载标志 */
    struct user_namespace *mnt_userns;  /* 用户命名空间 */
};

/*
 * mount 结构 - 内部挂载表示
 * 定义在 fs/mount.h
 */
struct mount {
    struct hlist_node mnt_hash;     /* 哈希链表节点 */
    struct mount *mnt_parent;       /* 父挂载点 */
    struct dentry *mnt_mountpoint;  /* 挂载点 dentry */
    struct vfsmount mnt;            /* 嵌入的 vfsmount */
    union {
        struct rcu_head mnt_rcu;    /* RCU 回收 */
        struct list_head mnt_list;  /* 链表节点 */
    };
    struct list_head mnt_child;     /* 子挂载链表 */
    struct list_head mnt_instance;  /* 超级块实例链表 */
    const char *mnt_devname;        /* 设备名 */
    struct list_head mnt_mounts;    /* 子挂载链表 */
    struct list_head mnt_mp_list;   /* 同一挂载点的挂载链表 */
    struct mnt_namespace *mnt_ns;   /* 挂载命名空间 */
    struct mountpoint *mnt_mp;      /* 挂载点结构 */
    union {
        struct hlist_node mnt_mp_list;  /* 挂载点链表 */
        struct hlist_node mnt_slave_list;  /* 从属挂载链表 */
    };
    struct mount *mnt_master;       /* 主挂载点 */
    struct mnt_group *mnt_group;    /* 挂载组 */
    struct path mnt_ex_mountpoint;  /* 外部挂载点 */
};

/*
 * 挂载标志
 */
#define MNT_READONLY       0x01     /* 只读挂载 */
#define MNT_NOSUID         0x02     /* 忽略 setuid/setgid */
#define MNT_NODEV          0x04     /* 禁止设备文件 */
#define MNT_NOEXEC         0x08     /* 禁止执行 */
#define MNT_NOATIME        0x10     /* 不更新访问时间 */
#define MNT_NODIRATIME     0x20     /* 不更新目录访问时间 */
#define MNT_RELATIME       0x40     /* 相对访问时间 */
#define MNT_NOSYMFOLLOW    0x80     /* 不跟随符号链接 */
```

### 2.2 挂载系统调用

```c
/*
 * mount 系统调用
 * 定义在 fs/namespace.c
 */
SYSCALL_DEFINE5(mount, char __user *, dev_name, char __user *, dir_name,
        char __user *, type, unsigned long, flags, void __user *, data)
{
    int ret;
    char *kernel_type;
    char *kernel_dev;
    void *options;

    /* 复制用户空间参数 */
    kernel_type = copy_mount_string(type);
    ret = PTR_ERR(kernel_type);
    if (IS_ERR(kernel_type))
        goto out_type;

    kernel_dev = copy_mount_string(dev_name);
    ret = PTR_ERR(kernel_dev);
    if (IS_ERR(kernel_dev))
        goto out_dev;

    options = copy_mount_options(data);
    ret = PTR_ERR(options);
    if (IS_ERR(options))
        goto out_data;

    /* 执行挂载操作 */
    ret = do_mount(kernel_dev, dir_name, kernel_type, flags, options);

    kfree(options);
out_data:
    kfree(kernel_dev);
out_dev:
    kfree(kernel_type);
out_type:
    return ret;
}

/*
 * do_mount - 执行挂载的核心函数
 */
long do_mount(const char *dev_name, const char *dir_name,
        const char *type_page, unsigned long flags, void *data_page)
{
    struct path path;
    int ret;

    /* 检查权限 */
    if (!may_mount())
        return -EPERM;

    /* 查找挂载点路径 */
    ret = user_path_at_empty(AT_FDCWD, dir_name, LOOKUP_FOLLOW, &path, NULL);
    if (ret)
        return ret;

    /* 根据标志执行不同的挂载操作 */
    if (flags & MS_REMOUNT)
        ret = do_remount(&path, flags, sb_flags, mnt_flags, data_page);
    else if (flags & MS_BIND)
        ret = do_loopback(&path, dev_name, flags & MS_REC);
    else if (flags & (MS_SHARED | MS_PRIVATE | MS_SLAVE | MS_UNBINDABLE))
        ret = do_change_type(&path, flags);
    else if (flags & MS_MOVE)
        ret = do_move_mount(&path, dev_name);
    else
        ret = do_new_mount(&path, type_page, sb_flags, mnt_flags,
                   dev_name, data_page);

    path_put(&path);
    return ret;
}
```

### 2.3 挂载点查找

```c
/*
 * lookup_mnt - 查找挂载点
 * 定义在 fs/namespace.c
 */
struct mount *lookup_mnt(const struct path *path)
{
    struct mount *child_mnt;
    struct hlist_head *head;

    /* 计算哈希值 */
    head = mnt_hash(path->mnt, path->dentry);

    /* 在哈希表中查找 */
    hlist_for_each_entry_rcu(child_mnt, head, mnt_hash) {
        if (child_mnt->mnt_parent == real_mount(path->mnt) &&
            child_mnt->mnt_mountpoint == path->dentry)
            return child_mnt;
    }
    return NULL;
}

/*
 * follow_down - 进入挂载点
 */
int follow_down(struct path *path)
{
    struct mount *mnt;

    mnt = lookup_mnt(path);
    if (mnt) {
        path->mnt = &mnt->mnt;
        path->dentry = dget(mnt->mnt.mnt_root);
        return 1;
    }
    return 0;
}

/*
 * follow_up - 返回上层挂载
 */
int follow_up(struct path *path)
{
    struct mount *mnt = real_mount(path->mnt);
    struct mount *parent;

    if (mnt == mnt->mnt_parent)
        return 0;

    parent = mnt->mnt_parent;
    path->dentry = dget(mnt->mnt_mountpoint);
    path->mnt = &parent->mnt;
    return 1;
}
```

---

## 3. 硬链接机制

### 3.1 硬链接原理

```
硬链接原理图：
+===========================================================================+
|                                                                           |
|   目录项（dentry）                inode                    数据块         |
|   +------------------+          +------------------+     +-------------+  |
|   | /home/user/file  |--------->| inode #1000      |---->| 数据块 1    |  |
|   +------------------+          | i_nlinks = 2     |     +-------------+  |
|                                   | i_mode = S_IFREG |     | 数据块 2    |  |
|   +------------------+          | i_size = 1024    |     +-------------+  |
|   | /home/user/link  |--------->| i_blocks = 2     |                        |
|   +------------------+          +------------------+                        |
|                                                                           |
|   两个目录项指向同一个 inode，i_nlinks = 2                                |
|                                                                           |
+===========================================================================+
```

### 3.2 硬链接系统调用

```c
/*
 * link 系统调用
 * 定义在 fs/namei.c
 */
SYSCALL_DEFINE2(link, const char __user *, oldname, const char __user *, newname)
{
    return do_linkat(AT_FDCWD, getname(oldname), AT_FDCWD, getname(newname), 0);
}

/*
 * do_linkat - 创建硬链接的核心函数
 */
static int do_linkat(int olddfd, struct filename *from, int newdfd,
             struct filename *to, int flags)
{
    struct dentry *new_dentry;
    struct path old_path, new_path;
    struct inode *delegated_inode = NULL;
    int how = 0;
    int error;

    /* 查找源文件 */
    error = filename_lookup(olddfd, from, how, &old_path, NULL);
    if (error)
        goto out_putnames;

    /* 查找目标目录 */
    error = filename_parentat(newdfd, to, 0, &new_path, &last, &to->last);
    if (error)
        goto out_putpath;

    /* 创建新的目录项 */
    new_dentry = lookup_positive_unlocked(to->last.name, new_path.dentry,
                          to->last.len);
    if (IS_ERR(new_dentry)) {
        error = PTR_ERR(new_dentry);
        goto out_unlock;
    }

    /* 创建硬链接 */
    error = vfs_link(old_path.dentry, mnt_user_ns(new_path.mnt),
             new_path.dentry->d_inode, new_dentry, &delegated_inode);

    dput(new_dentry);
out_unlock:
    inode_unlock(new_path.dentry->d_inode);
out_putpath:
    path_put(&old_path);
out_putnames:
    putname(from);
    putname(to);
    return error;
}

/*
 * vfs_link - VFS 层硬链接创建
 */
int vfs_link(struct dentry *old_dentry, struct user_namespace *mnt_userns,
         struct inode *dir, struct dentry *new_dentry,
         struct inode **delegated_inode)
{
    struct inode *inode = old_dentry->d_inode;
    unsigned max_links = dir->i_sb->s_max_links;
    int error;

    if (!inode)
        return -ENOENT;

    /* 检查权限 */
    error = may_create(mnt_userns, dir, new_dentry);
    if (error)
        return error;

    /* 必须在同一文件系统 */
    if (dir->i_sb != inode->i_sb)
        return -EXDEV;

    /* 不能链接不可变或追加文件 */
    if (IS_APPEND(inode) || IS_IMMUTABLE(inode))
        return -EPERM;

    /* 不能链接目录 */
    if (S_ISDIR(inode->i_mode))
        return -EPERM;

    /* 检查链接数限制 */
    if (max_links && inode->i_nlink >= max_links)
        return -EMLINK;

    /* 调用文件系统特定的 link 操作 */
    error = dir->i_op->link(old_dentry, dir, new_dentry);

    if (!error)
        fsnotify_link(dir, inode, new_dentry);

    return error;
}
```

### 3.3 硬链接的限制

```
硬链接的限制：
+===========================================================================+
|                                                                           |
|   1. 不能跨文件系统：                                                     |
|   +-------------------+                                                    |
|   | inode 是文件系统特定的 |                                                |
|   | 不同文件系统有不同的 inode 编号空间 |                                   |
|   | 检查：dir->i_sb != inode->i_sb |                                       |
|   +-------------------+                                                    |
|                                                                           |
|   2. 不能链接目录：                                                       |
|   +-------------------+                                                    |
|   | 防止目录循环       |  a/b/c/a/b/c/...                                  |
|   | 检查：S_ISDIR(inode->i_mode) |                                         |
|   +-------------------+                                                    |
|                                                                           |
|   3. 链接数限制：                                                         |
|   +-------------------+                                                    |
|   | 最大链接数由文件系统决定 |                                              |
|   | ext4: 65000       |                                                    |
|   | 检查：inode->i_nlink >= max_links |                                    |
|   +-------------------+                                                    |
|                                                                           |
|   4. 不能链接不可变文件：                                                 |
|   +-------------------+                                                    |
|   | IS_APPEND(inode) || IS_IMMUTABLE(inode) |                              |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

---

## 4. 软链接机制

### 4.1 软链接原理

```
软链接原理图：
+===========================================================================+
|                                                                           |
|   软链接文件                          目标文件                            |
|   +------------------+               +------------------+                  |
|   | dentry: link     |               | dentry: file     |                  |
|   +------------------+               +------------------+                  |
|           |                                   |                           |
|           v                                   v                           |
|   +------------------+               +------------------+                  |
|   | inode #1001      |               | inode #1000      |                  |
|   | i_mode = S_IFLNK |               | i_mode = S_IFREG |                  |
|   | i_size = 路径长度 |               | i_size = 文件大小 |                  |
|   +------------------+               +------------------+                  |
|           |                                   |                           |
|           v                                   v                           |
|   +------------------+               +------------------+                  |
|   | 数据块:          |               | 数据块:          |                  |
|   | "/home/user/file"|-------------->| 文件内容         |                  |
|   +------------------+  存储目标路径  +------------------+                  |
|                                                                           |
|   软链接有自己的 inode，存储目标文件的路径                                 |
|                                                                           |
+===========================================================================+
```

### 4.2 软链接系统调用

```c
/*
 * symlink 系统调用
 * 定义在 fs/namei.c
 */
SYSCALL_DEFINE2(symlink, const char __user *, oldname, const char __user *, newname)
{
    return do_symlinkat(getname(oldname), AT_FDCWD, getname(newname));
}

/*
 * do_symlinkat - 创建软链接的核心函数
 */
static int do_symlinkat(struct filename *from, int newdfd, struct filename *to)
{
    struct dentry *dentry;
    struct path path;
    int error;

    /* 查找目标目录 */
    error = filename_parentat(newdfd, to, 0, &path, &last, &to->last);
    if (error)
        goto out_putnames;

    /* 创建新的目录项 */
    dentry = lookup_positive_unlocked(to->last.name, path.dentry, to->last.len);
    if (IS_ERR(dentry)) {
        error = PTR_ERR(dentry);
        goto out_unlock;
    }

    /* 创建软链接 */
    error = vfs_symlink(mnt_user_ns(path.mnt), path.dentry->d_inode,
                dentry, from->name);

    dput(dentry);
out_unlock:
    inode_unlock(path.dentry->d_inode);
    path_put(&path);
out_putnames:
    putname(to);
    putname(from);
    return error;
}

/*
 * vfs_symlink - VFS 层软链接创建
 */
int vfs_symlink(struct user_namespace *mnt_userns, struct inode *dir,
        struct dentry *dentry, const char *oldname)
{
    int error;

    /* 检查权限 */
    error = may_create(mnt_userns, dir, dentry);
    if (error)
        return error;

    /* 检查文件系统是否支持 symlink 操作 */
    if (!dir->i_op->symlink)
        return -EPERM;

    /* 调用文件系统特定的 symlink 操作 */
    error = dir->i_op->symlink(mnt_userns, dir, dentry, oldname);

    return error;
}
```

### 4.3 软链接解析

```c
/*
 * 软链接解析流程
 * 定义在 fs/namei.c
 */

/*
 * 步骤 1: 检测软链接
 */
static int may_follow_link(struct nameidata *nd, struct path *link)
{
    struct inode *inode = link->dentry->d_inode;

    /* 检查是否是软链接 */
    if (!S_ISLNK(inode->i_mode))
        return -EINVAL;

    /* 检查权限 */
    if (inode->i_op->follow_link)
        return 0;

    return -ELOOP;
}

/*
 * 步骤 2: 获取链接目标
 */
static const char *get_link(struct nameidata *nd)
{
    struct dentry *dentry = nd->link.dentry;
    struct inode *inode = dentry->d_inode;
    const char *res;

    /* 调用文件系统的 follow_link 操作 */
    res = inode->i_op->follow_link(dentry, inode, nd);

    return res;
}

/*
 * 步骤 3: 解析链接路径
 */
static int trailing_symlink(struct nameidata *nd)
{
    const char *s;
    int error;

    /* 获取链接目标 */
    s = get_link(nd);
    if (IS_ERR(s))
        return PTR_ERR(s);

    /* 检查循环 */
    if (unlikely(nd->flags & LOOKUP_NO_SYMLINKS))
        return -ELOOP;

    /* 解析链接路径 */
    error = link_path_walk(s, nd);

    return error;
}
```

---

## 5. 路径解析机制

### 5.1 路径解析流程

```
路径解析流程：
+===========================================================================+
|                                                                           |
|   用户调用 open("/home/user/file.txt")                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 确定起始点        |  根目录或当前目录                                  |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 解析 "home"       |  在根目录中查找 home                              |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 检查是否是挂载点  |  lookup_mnt()                                     |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 检查是否是软链接  |  S_ISLNK()                                        |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 解析 "user"       |  在 home 目录中查找 user                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 检查挂载点和软链接|                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 解析 "file.txt"   |  在 user 目录中查找 file.txt                      |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   +-------------------+                                                    |
|   | 返回最终路径      |  path = {mnt, dentry}                             |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 5.2 路径解析核心函数

```c
/*
 * path_lookup - 路径查找
 * 定义在 fs/namei.c
 */
int path_lookup(const char *name, unsigned int flags, struct path *path)
{
    struct nameidata nd;
    int err;

    err = filename_lookup(AT_FDCWD, getname_kernel(name), flags, path, &nd);

    return err;
}

/*
 * link_path_walk - 路径遍历
 */
static int link_path_walk(const char *name, struct nameidata *nd)
{
    struct path next;
    int err;

    while (*name == '/')
        name++;

    while (*name) {
        struct qstr this;
        long len;
        int type;

        /* 提取下一个路径分量 */
        err = walk_component(nd, &next, LOOKUP_FOLLOW);
        if (err < 0)
            return err;

        /* 处理软链接 */
        if (err) {
            err = trailing_symlink(nd);
            if (err)
                return err;
        }

        /* 跳过斜杠 */
        while (*name == '/')
            name++;
    }

    return 0;
}

/*
 * walk_component - 处理单个路径分量
 */
static int walk_component(struct nameidata *nd, struct path *path, int flags)
{
    struct inode *inode;
    struct dentry *dentry;

    /* 在目录中查找 dentry */
    dentry = lookup_fast(nd, &inode);
    if (IS_ERR(dentry))
        return PTR_ERR(dentry);

    /* 检查挂载点 */
    if (d_mountpoint(dentry)) {
        int err = follow_managed(path, nd);
        if (err < 0)
            return err;
    }

    /* 检查软链接 */
    if (S_ISLNK(inode->i_mode) && (flags & LOOKUP_FOLLOW)) {
        nd->link = *path;
        return 1;  /* 需要跟随软链接 */
    }

    return 0;
}

/*
 * follow_managed - 处理挂载点
 */
static int follow_managed(struct path *path, struct nameidata *nd)
{
    unsigned flags = nd->flags;
    struct dentry *dentry = path->dentry;
    struct vfsmount *mnt = path->mnt;
    int ret;

    /* 检查是否有挂载点 */
    if (d_mountpoint(dentry)) {
        /* 进入挂载点 */
        while (d_mountpoint(dentry)) {
            struct mount *child = lookup_mnt(path);
            if (!child)
                break;

            dentry = child->mnt.mnt_root;
            mnt = &child->mnt;
        }
    }

    path->dentry = dentry;
    path->mnt = mnt;

    return 0;
}
```

---

## 6. 访问流程详解

### 6.1 情况一：访问硬链接文件

```
场景：访问硬链接文件
+===========================================================================+
|                                                                           |
|   文件结构：                                                              |
|   +-------------------+                                                    |
|   | /home/user/file.txt   |  原文件                                       |
|   | /home/user/hardlink.txt |  硬链接                                      |
|   +-------------------+                                                    |
|   两者指向同一个 inode                                                    |
|                                                                           |
+===========================================================================+

访问流程：
+===========================================================================+
|                                                                           |
|   用户调用 open("/home/user/hardlink.txt")                                |
|           |                                                               |
|           v                                                               |
|   步骤 1: 路径解析开始                                                    |
|   +-------------------+                                                    |
|   | path_lookup()     |                                                    |
|   | 起始点: 根目录    |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 2: 解析 "home"                                                     |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 查找根目录的 dentry |                                                   |
|   | 在 dentry 中查找 "home" |                                               |
|   | 获取 home 的 dentry |                                                   |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 3: 检查挂载点                                                      |
|   +-------------------+                                                    |
|   | d_mountpoint()    |  检查 home 是否是挂载点                           |
|   | lookup_mnt()      |  查找是否有文件系统挂载在 home                     |
|   | 结果: 无挂载      |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 4: 解析 "user"                                                     |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 在 home 目录中查找 "user" |                                             |
|   | 获取 user 的 dentry |                                                   |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 5: 检查挂载点                                                      |
|   +-------------------+                                                    |
|   | d_mountpoint()    |  检查 user 是否是挂载点                           |
|   | 结果: 无挂载      |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 6: 解析 "hardlink.txt"                                             |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 在 user 目录中查找 "hardlink.txt" |                                     |
|   | 获取 hardlink.txt 的 dentry |                                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 7: 获取 inode                                                      |
|   +-------------------+                                                    |
|   | dentry->d_inode   |  获取 inode                                       |
|   | inode->i_ino = 1000 |  与 file.txt 相同的 inode 号                     |
|   | inode->i_nlink = 2 |  链接数为 2                                       |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 8: 检查软链接                                                      |
|   +-------------------+                                                    |
|   | S_ISLNK()         |  检查是否是软链接                                 |
|   | 结果: 不是软链接  |  S_IFREG                                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 9: 返回路径                                                        |
|   +-------------------+                                                    |
|   | path->mnt = 根文件系统 |                                                |
|   | path->dentry = hardlink.txt 的 dentry |                                |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 10: 打开文件                                                       |
|   +-------------------+                                                    |
|   | vfs_open()        |                                                    |
|   | 使用 inode #1000  |  与 file.txt 相同                                 |
|   | 访问相同的数据块  |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   结果：访问的是与 file.txt 相同的文件内容                                |
|                                                                           |
+===========================================================================+
```

### 6.2 情况二：访问软链接文件

```
场景：访问软链接文件
+===========================================================================+
|                                                                           |
|   文件结构：                                                              |
|   +-------------------+                                                    |
|   | /home/user/file.txt    |  原文件（inode #1000）                        |
|   | /home/user/softlink.txt |  软链接（inode #1001）                       |
|   +-------------------+                                                    |
|   softlink.txt 存储路径 "/home/user/file.txt"                             |
|                                                                           |
+===========================================================================+

访问流程：
+===========================================================================+
|                                                                           |
|   用户调用 open("/home/user/softlink.txt")                                |
|           |                                                               |
|           v                                                               |
|   步骤 1: 路径解析开始                                                    |
|   +-------------------+                                                    |
|   | path_lookup()     |                                                    |
|   | 起始点: 根目录    |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 2: 解析 "home"                                                     |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 获取 home 的 dentry |                                                   |
|   | 检查挂载点: 无    |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 3: 解析 "user"                                                     |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 获取 user 的 dentry |                                                   |
|   | 检查挂载点: 无    |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 4: 解析 "softlink.txt"                                             |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 获取 softlink.txt 的 dentry |                                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 5: 获取 inode                                                      |
|   +-------------------+                                                    |
|   | dentry->d_inode   |                                                    |
|   | inode->i_ino = 1001 |  软链接自己的 inode                               |
|   | inode->i_mode = S_IFLNK |  软链接类型                                  |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 6: 检测软链接                                                      |
|   +-------------------+                                                    |
|   | S_ISLNK()         |  检查是否是软链接                                 |
|   | 结果: 是软链接    |  S_IFLNK                                          |
|   | 设置 LOOKUP_FOLLOW |  需要跟随软链接                                  |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 7: 获取链接目标                                                    |
|   +-------------------+                                                    |
|   | get_link()        |                                                    |
|   | inode->i_op->follow_link |                                              |
|   | 读取数据块内容    |                                                    |
|   | 返回: "/home/user/file.txt" |                                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 8: 解析链接目标路径                                                |
|   +-------------------+                                                    |
|   | link_path_walk()  |  重新解析路径                                     |
|   | 路径: "/home/user/file.txt" |                                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 9: 解析 "home"                                                     |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 获取 home 的 dentry |                                                   |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 10: 解析 "user"                                                    |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 获取 user 的 dentry |                                                   |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 11: 解析 "file.txt"                                                |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 获取 file.txt 的 dentry |                                               |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 12: 获取目标 inode                                                 |
|   +-------------------+                                                    |
|   | dentry->d_inode   |                                                    |
|   | inode->i_ino = 1000 |  原文件的 inode                                  |
|   | inode->i_mode = S_IFREG |  普通文件                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 13: 返回路径                                                       |
|   +-------------------+                                                    |
|   | path->mnt = 根文件系统 |                                                |
|   | path->dentry = file.txt 的 dentry |                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 14: 打开文件                                                       |
|   +-------------------+                                                    |
|   | vfs_open()        |                                                    |
|   | 使用 inode #1000  |  原文件的 inode                                   |
|   | 访问原文件的数据块 |                                                    |
|   +-------------------+                                                    |
|                                                                           |
|   结果：通过软链接访问到了原文件的内容                                    |
|                                                                           |
+===========================================================================+
```

### 6.3 情况三：访问挂载点下的文件

```
场景：访问挂载点下的文件
+===========================================================================+
|                                                                           |
|   文件系统结构：                                                          |
|   +-------------------+                                                    |
|   | 根文件系统        |                                                    |
|   | /                 |                                                    |
|   | /mnt              |  挂载点目录                                        |
|   +-------------------+                                                    |
|           |                                                               |
|           | 挂载 /dev/sdb1 到 /mnt                                         |
|           v                                                               |
|   +-------------------+                                                    |
|   | 新文件系统        |                                                    |
|   | /mnt/             |  新文件系统的根目录                                |
|   | /mnt/data/        |                                                    |
|   | /mnt/data/file.txt |                                                   |
|   +-------------------+                                                    |
|                                                                           |
+===========================================================================+

访问流程：
+===========================================================================+
|                                                                           |
|   用户调用 open("/mnt/data/file.txt")                                     |
|           |                                                               |
|           v                                                               |
|   步骤 1: 路径解析开始                                                    |
|   +-------------------+                                                    |
|   | path_lookup()     |                                                    |
|   | 起始点: 根目录    |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 2: 解析 "mnt"                                                      |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 在根目录中查找 "mnt" |                                                   |
|   | 获取 mnt 的 dentry |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 3: 检查挂载点                                                      |
|   +-------------------+                                                    |
|   | d_mountpoint()    |  检查 mnt 是否是挂载点                            |
|   | 结果: 是挂载点    |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 4: 进入挂载点                                                      |
|   +-------------------+                                                    |
|   | follow_managed()  |                                                    |
|   | lookup_mnt()      |  查找挂载在 mnt 的文件系统                        |
|   | 找到: /dev/sdb1   |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 5: 切换到新文件系统                                                |
|   +-------------------+                                                    |
|   | path->mnt = 新文件系统的 vfsmount |                                     |
|   | path->dentry = 新文件系统的根 dentry |                                  |
|   | 新文件系统的根目录 = /mnt/ |                                            |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 6: 解析 "data"                                                     |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 在新文件系统的根目录中查找 "data" |                                     |
|   | 获取 data 的 dentry |                                                   |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 7: 检查挂载点                                                      |
|   +-------------------+                                                    |
|   | d_mountpoint()    |  检查 data 是否是挂载点                           |
|   | 结果: 不是挂载点  |                                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 8: 解析 "file.txt"                                                 |
|   +-------------------+                                                    |
|   | walk_component()  |                                                    |
|   | 在 data 目录中查找 "file.txt" |                                         |
|   | 获取 file.txt 的 dentry |                                               |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 9: 获取 inode                                                      |
|   +-------------------+                                                    |
|   | dentry->d_inode   |                                                    |
|   | inode 属于新文件系统 |                                                   |
|   | inode->i_sb = 新文件系统的超级块 |                                      |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 10: 检查软链接                                                     |
|   +-------------------+                                                    |
|   | S_ISLNK()         |  检查是否是软链接                                 |
|   | 结果: 不是软链接  |  S_IFREG                                          |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 11: 返回路径                                                       |
|   +-------------------+                                                    |
|   | path->mnt = 新文件系统的 vfsmount |                                     |
|   | path->dentry = file.txt 的 dentry |                                    |
|   +-------------------+                                                    |
|           |                                                               |
|           v                                                               |
|   步骤 12: 打开文件                                                       |
|   +-------------------+                                                    |
|   | vfs_open()        |                                                    |
|   | 使用新文件系统的 inode |                                                 |
|   | 访问新文件系统的数据块 |                                                 |
|   +-------------------+                                                    |
|                                                                           |
|   结果：访问的是挂载文件系统中的文件                                      |
|                                                                           |
+===========================================================================+
```

---

## 7. 实际案例分析

### 7.1 创建和访问硬链接

```bash
# 创建文件
echo "Hello, World!" > /home/user/file.txt

# 创建硬链接
ln /home/user/file.txt /home/user/hardlink.txt

# 查看 inode 号
ls -li /home/user/file.txt /home/user/hardlink.txt
# 输出：
# 1000 -rw-r--r-- 2 user user 14 Jan 1 10:00 /home/user/file.txt
# 1000 -rw-r--r-- 2 user user 14 Jan 1 10:00 /home/user/hardlink.txt
# 注意：inode 号相同（1000），链接数为 2

# 修改硬链接
echo "Modified" >> /home/user/hardlink.txt

# 查看原文件
cat /home/user/file.txt
# 输出：
# Hello, World!
# Modified

# 删除原文件
rm /home/user/file.txt

# 硬链接仍然可以访问
cat /home/user/hardlink.txt
# 输出：
# Hello, World!
# Modified

# 链接数变为 1
ls -li /home/user/hardlink.txt
# 输出：
# 1000 -rw-r--r-- 1 user user 24 Jan 1 10:01 /home/user/hardlink.txt
```

### 7.2 创建和访问软链接

```bash
# 创建文件
echo "Hello, World!" > /home/user/file.txt

# 创建软链接
ln -s /home/user/file.txt /home/user/softlink.txt

# 查看 inode 号
ls -li /home/user/file.txt /home/user/softlink.txt
# 输出：
# 1000 -rw-r--r-- 1 user user 14 Jan 1 10:00 /home/user/file.txt
# 1001 lrwxrwxrwx 1 user user 20 Jan 1 10:00 /home/user/softlink.txt -> /home/user/file.txt
# 注意：inode 号不同，软链接有自己的 inode

# 访问软链接
cat /home/user/softlink.txt
# 输出：
# Hello, World!

# 删除原文件
rm /home/user/file.txt

# 软链接成为悬空链接
cat /home/user/softlink.txt
# 输出：
# cat: /home/user/softlink.txt: No such file or directory

# 软链接仍然存在
ls -l /home/user/softlink.txt
# 输出：
# lrwxrwxrwx 1 user user 20 Jan 1 10:00 /home/user/softlink.txt -> /home/user/file.txt
```

### 7.3 挂载文件系统

```bash
# 查看当前挂载
mount
# 输出：
# /dev/sda1 on / type ext4 (rw,relatime)
# /dev/sda2 on /home type ext4 (rw,relatime)

# 挂载新文件系统
mount /dev/sdb1 /mnt

# 查看挂载
mount | grep sdb1
# 输出：
# /dev/sdb1 on /mnt type ext4 (rw,relatime)

# 访问挂载点
ls /mnt
# 输出：
# data  file.txt

# 访问挂载点下的文件
cat /mnt/data/file.txt
# 输出：
# This is a file in the mounted filesystem

# 卸载文件系统
umount /mnt

# 挂载点变为空目录
ls /mnt
# 输出：
# (空)
```

---

## 总结

### 核心要点

1. **挂载机制**：
   - 将文件系统关联到目录树
   - 通过 vfsmount 和 mount 结构管理
   - 支持挂载命名空间和挂载传播

2. **硬链接机制**：
   - 多个文件名指向同一个 inode
   - 共享相同的数据
   - 不能跨文件系统，不能链接目录

3. **软链接机制**：
   - 特殊文件存储目标路径
   - 有自己的 inode
   - 可以跨文件系统，可以链接目录

4. **路径解析机制**：
   - 逐级解析路径分量
   - 处理挂载点和软链接
   - 支持递归解析

### 关键代码位置

| 功能 | 文件 |
|------|------|
| mount 系统调用 | **`fs/namespace.c`** |
| vfsmount 结构 | **`include/linux/mount.h`** |
| link 系统调用 | **`fs/namei.c`** |
| symlink 系统调用 | **`fs/namei.c`** |
| vfs_link 函数 | **`fs/namei.c`** |
| 路径解析 | **`fs/namei.c`** |
| 挂载点查找 | **`fs/namespace.c`** |
