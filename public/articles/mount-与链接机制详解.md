# Mount 与链接机制详解

## 目录

1. **`概述`**
2. **`Mount 挂载机制`**
3. **`硬链接实现`**
4. **`软链接说明`**
5. **`路径解析过程`**
6. **`完整流程图`**

---

## 1. 概述

### 1.1 三种机制对比

| 机制 | 作用 | Linux 0.11 支持 |
|------|------|----------------|
| **Mount** | 将文件系统挂载到目录树 | ✅ 完整支持 |
| **硬链接** | 多个文件名指向同一 inode | ✅ 完整支持 |
| **软链接** | 符号链接，指向路径 | ❌ 未实现 |

### 1.2 核心数据结构关系

```
+===========================================================================+
|                        核心数据结构关系                                   |
+===========================================================================+

                         +-------------------+
                         |   super_block     |
                         |   超级块          |
                         +---------+---------+
                                   |
                      +------------+------------+
                      |                         |
                      v                         v
              +-------------+           +-------------+
              | s_isup      |           | s_imount    |
              | 文件系统根  |           | 挂载点 inode|
              +------+------+           +------+------+
                     |                         |
                     v                         v
              +-------------+           +-------------+
              |   inode     |<--------->|   inode     |
              |   i_mount=1 |  挂载关系  |   i_nlinks  |
              +-------------+           +-------------+
                     |                         ^
                     v                         |
              +-------------+           +------+------+
              | dir_entry   |           | dir_entry   |
              | 目录项      |-----------| 目录项      |
              | (硬链接)    |  同一 inode| (硬链接)    |
              +-------------+           +-------------+
```

---

## 2. Mount 挂载机制

### 2.1 Mount 的作用

Mount 将一个文件系统挂载到目录树的某个目录上：

```
挂载前：
+-------------------+
| 根文件系统        |
| /                 |
| ├── bin/          |
| ├── etc/          |
| └── mnt/          |  <-- 空目录
+-------------------+

挂载后：
+-------------------+
| 根文件系统        |
| /                 |
| ├── bin/          |
| ├── etc/          |
| └── mnt/          |  <-- 挂载点
|     ├── file1     |  <-- 新文件系统的内容
|     └── file2     |
+-------------------+
```

### 2.2 关键数据结构

**super_block 结构**（定义在 **`include/linux/fs.h`**）：

```c
struct super_block {
    unsigned short s_ninodes;       /* inode 数量 */
    unsigned short s_nzones;        /* 数据块数量 */
    unsigned short s_imap_blocks;   /* inode 位图块数 */
    unsigned short s_zmap_blocks;   /* 数据块位图块数 */
    unsigned short s_firstdatazone; /* 第一个数据块号 */
    unsigned short s_log_zone_size; /* log2(块大小/扇区大小) */
    unsigned long s_max_size;       /* 文件最大大小 */
    unsigned short s_magic;         /* 魔数 0x137F */
    
    /* 以下是内存中的字段 */
    struct buffer_head * s_imap[8]; /* inode 位图缓冲区 */
    struct buffer_head * s_zmap[8]; /* 数据块位图缓冲区 */
    unsigned short s_dev;           /* 设备号 */
    struct m_inode * s_isup;        /* 文件系统根 inode */
    struct m_inode * s_imount;      /* 挂载点 inode !!!关键!!! */
    unsigned long s_time;
    struct task_struct * s_wait;
    unsigned char s_lock;
    unsigned char s_rd_only;
    unsigned char s_dirt;
};
```

**inode 中的挂载标记**：

```c
struct m_inode {
    ...
    unsigned char i_mount;          /* 是否为挂载点 !!!关键!!! */
    ...
};
```

### 2.3 sys_mount 系统调用

定义在 **`fs/super.c`**：

```c
int sys_mount(char * dev_name, char * dir_name, int rw_flag)
{
    struct m_inode * dev_i, * dir_i;
    struct super_block * sb;
    int dev;

    /* 1. 获取设备文件的 inode */
    if (!(dev_i = namei(dev_name)))
        return -ENOENT;
    dev = dev_i->i_zone[0];         /* 块设备的设备号 */
    if (!S_ISBLK(dev_i->i_mode)) {  /* 必须是块设备 */
        iput(dev_i);
        return -EPERM;
    }
    iput(dev_i);

    /* 2. 获取挂载点目录的 inode */
    if (!(dir_i = namei(dir_name)))
        return -ENOENT;
    
    /* 3. 检查挂载点是否可用 */
    if (dir_i->i_count != 1 || dir_i->i_num == ROOT_INO) {
        iput(dir_i);
        return -EBUSY;              /* 目录正在使用或是根目录 */
    }
    if (!S_ISDIR(dir_i->i_mode)) {  /* 必须是目录 */
        iput(dir_i);
        return -EPERM;
    }

    /* 4. 读取设备的超级块 */
    if (!(sb = read_super(dev))) {
        iput(dir_i);
        return -EBUSY;
    }
    
    /* 5. 检查是否已挂载 */
    if (sb->s_imount) {             /* 该文件系统已挂载 */
        iput(dir_i);
        return -EBUSY;
    }
    if (dir_i->i_mount) {           /* 该目录已是挂载点 */
        iput(dir_i);
        return -EPERM;
    }

    /* 6. 建立挂载关系 */
    sb->s_imount = dir_i;           /* 超级块指向挂载点 */
    dir_i->i_mount = 1;             /* 标记为挂载点 */
    dir_i->i_dirt = 1;              /* 标记为脏 */
    
    /* 注意：这里不 iput(dir_i)，在 umount 时释放 */
    return 0;
}
```

### 2.4 挂载关系建立过程

```
挂载过程：
+===========================================================================+
|                                                                           |
|   挂载前：                                                                |
|   +-------------+              +-------------+                            |
|   | 设备文件    |              | 挂载点目录  |                            |
|   | /dev/hda1   |              | /mnt        |                            |
|   | inode       |              | inode       |                            |
|   | i_zone[0]   |              | i_mount = 0 |                            |
|   | = 0x301     |              +-------------+                            |
|   +-------------+                                                            |
|                                                                           |
+===========================================================================+
|                                                                           |
|   挂载后：                                                                |
|   +-------------+              +-------------+      +-------------+        |
|   | 设备文件    |              | 挂载点目录  |      | 超级块      |        |
|   | /dev/hda1   |              | /mnt        |      | s_dev=0x301 |        |
|   +-------------+              | inode       |<---->| s_imount    |        |
|                                | i_mount = 1 |      | s_isup      |        |
|                                +------+------+      +------+------+        |
|                                       |                    |               |
|                                       |                    v               |
|                                       |             +-------------+        |
|                                       |             | 根 inode    |        |
|                                       +------------>| (被挂载FS)  |        |
|                                                     | i_num = 1   |        |
|                                                     +-------------+        |
|                                                                           |
+===========================================================================+
```

### 2.5 sys_umount 卸载

```c
int sys_umount(char * dev_name)
{
    struct m_inode * inode;
    struct super_block * sb;
    int dev;

    /* 1. 获取设备 inode */
    if (!(inode = namei(dev_name)))
        return -ENOENT;
    dev = inode->i_zone[0];
    if (!S_ISBLK(inode->i_mode)) {
        iput(inode);
        return -ENOTBLK;
    }
    iput(inode);

    /* 2. 不能卸载根文件系统 */
    if (dev == ROOT_DEV)
        return -EBUSY;

    /* 3. 获取超级块 */
    if (!(sb = get_super(dev)) || !(sb->s_imount))
        return -ENOENT;

    /* 4. 检查是否有进程在使用该文件系统 */
    for (inode = inode_table; inode < inode_table + NR_INODE; inode++)
        if (inode->i_dev == dev && inode->i_count)
            return -EBUSY;

    /* 5. 解除挂载关系 */
    sb->s_imount->i_mount = 0;      /* 清除挂载标记 */
    iput(sb->s_imount);             /* 释放挂载点 inode */
    sb->s_imount = NULL;
    iput(sb->s_isup);               /* 释放文件系统根 inode */
    sb->s_isup = NULL;
    put_super(dev);                 /* 释放超级块 */
    sync_dev(dev);                  /* 同步设备 */
    return 0;
}
```

### 2.6 挂载点遍历处理

当遍历到挂载点的 ".." 时，需要特殊处理（定义在 **`fs/namei.c`**）：

```c
static struct buffer_head * find_entry(struct m_inode ** dir,
    const char * name, int namelen, struct dir_entry ** res_dir)
{
    ...
    /* 检查是否为 ".." */
    if (namelen == 2 && get_fs_byte(name) == '.' && get_fs_byte(name + 1) == '.') {
        /* 如果是伪根目录，返回 "." */
        if ((*dir) == current->root)
            namelen = 1;
        /* 如果是文件系统根目录，需要跳转到挂载点 */
        else if ((*dir)->i_num == ROOT_INO) {
            sb = get_super((*dir)->i_dev);
            if (sb->s_imount) {
                iput(*dir);
                (*dir) = sb->s_imount;  /* 切换到挂载点目录 */
                (*dir)->i_count++;
            }
        }
    }
    ...
}
```

---

## 3. 硬链接实现

### 3.1 硬链接概念

硬链接是多个目录项指向同一个 inode：

```
硬链接示意图：
+-------------------+           +-------------------+
| 目录项1           |           | 目录项2           |
| name: "file.txt"  |           | name: "link.txt"  |
| inode: 100        |------|    | inode: 100        |------|
+-------------------+      |    +-------------------+      |
                           |                              |
                           |                              |
                           v                              v
                    +--------------------------------------------+
                    |              inode 100                     |
                    | i_nlinks = 2                               |
                    | i_mode = regular file                      |
                    | i_size = 1024                              |
                    | i_zone[0] = 数据块号                        |
                    +--------------------------------------------+
                                      |
                                      v
                              +-------------+
                              | 数据块      |
                              | 文件内容    |
                              +-------------+
```

### 3.2 硬链接特点

| 特点 | 说明 |
|------|------|
| **共享 inode** | 多个文件名指向同一 inode |
| **引用计数** | inode 的 i_nlinks 记录链接数 |
| **删除行为** | 删除一个链接，i_nlinks 减 1，只有为 0 时才真正删除 |
| **跨文件系统** | ❌ 不能跨文件系统创建硬链接 |
| **目录链接** | ❌ 不能对目录创建硬链接 |

### 3.3 sys_link 系统调用

定义在 **`fs/namei.c`**：

```c
int sys_link(const char * oldname, const char * newname)
{
    struct dir_entry * de;
    struct m_inode * oldinode, * dir;
    struct buffer_head * bh;
    const char * basename;
    int namelen;

    /* 1. 获取源文件的 inode */
    oldinode = namei(oldname);
    if (!oldinode)
        return -ENOENT;
    
    /* 2. 不能对目录创建硬链接 */
    if (S_ISDIR(oldinode->i_mode)) {
        iput(oldinode);
        return -EPERM;
    }

    /* 3. 获取目标目录 */
    dir = dir_namei(newname, &namelen, &basename);
    if (!dir) {
        iput(oldinode);
        return -EACCES;
    }
    if (!namelen) {
        iput(oldinode);
        iput(dir);
        return -EPERM;
    }

    /* 4. 不能跨文件系统创建硬链接 */
    if (dir->i_dev != oldinode->i_dev) {
        iput(dir);
        iput(oldinode);
        return -EXDEV;
    }

    /* 5. 检查目标目录写权限 */
    if (!permission(dir, MAY_WRITE)) {
        iput(dir);
        iput(oldinode);
        return -EACCES;
    }

    /* 6. 检查目标文件是否已存在 */
    bh = find_entry(&dir, basename, namelen, &de);
    if (bh) {
        brelse(bh);
        iput(dir);
        iput(oldinode);
        return -EEXIST;
    }

    /* 7. 在目标目录添加新的目录项 */
    bh = add_entry(dir, basename, namelen, &de);
    if (!bh) {
        iput(dir);
        iput(oldinode);
        return -ENOSPC;
    }

    /* 8. 设置新目录项指向原 inode */
    de->inode = oldinode->i_num;
    bh->b_dirt = 1;
    brelse(bh);
    iput(dir);

    /* 9. 增加链接计数 */
    oldinode->i_nlinks++;
    oldinode->i_ctime = CURRENT_TIME;
    oldinode->i_dirt = 1;
    iput(oldinode);
    
    return 0;
}
```

### 3.4 硬链接创建流程

```
sys_link 执行流程：
+-------------------+
| namei(oldname)    |
| 获取源文件 inode  |
+---------+---------+
          |
          v
+-------------------+
| 检查是否为目录    |
| S_ISDIR()?        |
+---------+---------+
          |
          v
+-------------------+
| dir_namei(newname)|
| 获取目标目录      |
+---------+---------+
          |
          v
+-------------------+
| 检查是否同一设备  |
| dir->i_dev ==     |
| oldinode->i_dev?  |
+---------+---------+
          |
          v
+-------------------+
| find_entry()      |
| 检查目标是否存在  |
+---------+---------+
          |
          v
+-------------------+
| add_entry()       |
| 添加新目录项      |
+---------+---------+
          |
          v
+-------------------+
| de->inode =       |
| oldinode->i_num   |
| 目录项指向原 inode|
+---------+---------+
          |
          v
+-------------------+
| oldinode->        |
| i_nlinks++        |
| 增加链接计数      |
+-------------------+
```

### 3.5 硬链接删除（unlink）

```c
int sys_unlink(const char * name)
{
    const char * basename;
    int namelen;
    struct m_inode * dir, * inode;
    struct buffer_head * bh;
    struct dir_entry * de;

    /* 1. 获取父目录 */
    if (!(dir = dir_namei(name, &namelen, &basename)))
        return -ENOENT;
    if (!namelen) {
        iput(dir);
        return -ENOENT;
    }

    /* 2. 检查写权限 */
    if (!permission(dir, MAY_WRITE)) {
        iput(dir);
        return -EPERM;
    }

    /* 3. 查找目录项 */
    bh = find_entry(&dir, basename, namelen, &de);
    if (!bh) {
        iput(dir);
        return -ENOENT;
    }

    /* 4. 获取文件 inode */
    if (!(inode = iget(dir->i_dev, de->inode))) {
        iput(dir);
        brelse(bh);
        return -ENOENT;
    }

    /* 5. 不能删除目录（需用 rmdir） */
    if (S_ISDIR(inode->i_mode)) {
        iput(inode);
        iput(dir);
        brelse(bh);
        return -EPERM;
    }

    /* 6. 清除目录项 */
    de->inode = 0;              /* 目录项 inode 设为 0 表示删除 */
    bh->b_dirt = 1;
    brelse(bh);

    /* 7. 减少链接计数 */
    inode->i_nlinks--;
    inode->i_dirt = 1;
    inode->i_ctime = CURRENT_TIME;
    
    /* 8. 如果链接数为 0，释放 inode 和数据块 */
    if (inode->i_nlinks == 0) {
        /* truncate() 会释放所有数据块 */
        /* iput() 会释放 inode */
    }
    
    iput(inode);
    iput(dir);
    return 0;
}
```

### 3.6 目录项结构

```c
/* 目录项结构（定义在 fs.h） */
struct dir_entry {
    unsigned short inode;       /* inode 号 */
    char name[NAME_LEN];        /* 文件名（14 字节） */
};

/* 目录项在磁盘上的布局 */
+-------------------+-------------------+-------------------+
| inode (2 bytes)   | name (14 bytes)   | 下一个目录项      |
+-------------------+-------------------+-------------------+
```

---

## 4. 软链接说明

### 4.1 Linux 0.11 未实现软链接

经过源码分析，**Linux 0.11 没有实现软链接（符号链接）功能**：

1. **没有 S_IFLNK 文件类型定义**
   - 在 `include/sys/stat.h` 中只定义了：
     - S_IFREG（普通文件）
     - S_IFDIR（目录）
     - S_IFCHR（字符设备）
     - S_IFBLK（块设备）
     - S_IFIFO（管道）
   - 没有 S_IFLNK（符号链接）

2. **没有 symlink 系统调用**
   - 源码中没有 `sys_symlink` 函数

3. **没有符号链接处理逻辑**
   - 路径解析中没有处理符号链接的代码

### 4.2 软链接概念（现代 Linux）

虽然 Linux 0.11 未实现，但了解软链接概念有助于理解现代系统：

```
软链接示意图：
+-------------------+           +-------------------+
| 软链接文件        |           | 目标文件          |
| link.txt          |           | /home/file.txt    |
| inode: 200        |           | inode: 100        |
| i_mode: S_IFLNK   |           | i_mode: S_IFREG   |
| 数据块内容:       |           +-------------------+
| "/home/file.txt"  |                    |
+-------------------+                    |
         |                               |
         | 读取路径字符串                 |
         | 重新解析路径                   |
         +------------------------------->|
                                           v
                                   +-------------+
                                   | 文件内容    |
                                   +-------------+
```

### 4.3 硬链接与软链接对比

| 特性 | 硬链接 | 软链接 |
|------|--------|--------|
| **实现方式** | 多个目录项指向同一 inode | 特殊文件存储目标路径 |
| **跨文件系统** | ❌ 不支持 | ✅ 支持 |
| **链接目录** | ❌ 不支持 | ✅ 支持 |
| **删除原文件** | 文件仍存在 | 链接失效（悬空链接） |
| **inode 号** | 与原文件相同 | 与原文件不同 |
| **文件大小** | 与原文件相同 | 路径字符串长度 |
| **Linux 0.11** | ✅ 支持 | ❌ 不支持 |

---

## 5. 路径解析过程

### 5.1 namei 函数

`namei()` 是路径解析的核心函数，定义在 **`fs/namei.c`**：

```c
struct m_inode * namei(const char * pathname)
{
    const char * basename;
    int inr, dev, namelen;
    struct m_inode * dir;
    struct buffer_head * bh;
    struct dir_entry * de;

    /* 1. 获取父目录和文件名 */
    if (!(dir = dir_namei(pathname, &namelen, &basename)))
        return NULL;
    
    /* 2. 特殊情况：路径以 / 结尾 */
    if (!namelen)
        return dir;

    /* 3. 在父目录中查找文件 */
    bh = find_entry(&dir, basename, namelen, &de);
    if (!bh) {
        iput(dir);
        return NULL;
    }

    /* 4. 获取 inode 号 */
    inr = de->inode;
    dev = dir->i_dev;
    brelse(bh);
    iput(dir);

    /* 5. 读取 inode */
    dir = iget(dev, inr);
    if (dir) {
        dir->i_atime = CURRENT_TIME;
        dir->i_dirt = 1;
    }
    return dir;
}
```

### 5.2 get_dir 函数

`get_dir()` 遍历路径的每一级：

```c
static struct m_inode * get_dir(const char * pathname)
{
    char c;
    const char * thisname;
    struct m_inode * inode;
    struct buffer_head * bh;
    int namelen, inr, idev;
    struct dir_entry * de;

    /* 1. 确定起始目录 */
    if (!current->root || !current->root->i_count)
        panic("No root inode");
    if (!current->pwd || !current->pwd->i_count)
        panic("No cwd inode");

    if ((c = get_fs_byte(pathname)) == '/') {
        inode = current->root;      /* 绝对路径从根开始 */
        pathname++;
    } else if (c) {
        inode = current->pwd;       /* 相对路径从当前目录开始 */
    } else {
        return NULL;
    }
    inode->i_count++;

    /* 2. 逐级遍历路径 */
    while (1) {
        thisname = pathname;
        
        /* 检查是否为目录且有执行权限 */
        if (!S_ISDIR(inode->i_mode) || !permission(inode, MAY_EXEC)) {
            iput(inode);
            return NULL;
        }

        /* 提取下一级目录名 */
        for (namelen = 0; (c = get_fs_byte(pathname++)) && (c != '/'); namelen++)
            ;
        
        /* 路径结束，返回当前 inode */
        if (!c)
            return inode;

        /* 在当前目录中查找下一级 */
        if (!(bh = find_entry(&inode, thisname, namelen, &de))) {
            iput(inode);
            return NULL;
        }

        /* 获取下一级的 inode */
        inr = de->inode;
        idev = inode->i_dev;
        brelse(bh);
        iput(inode);
        
        if (!(inode = iget(idev, inr)))
            return NULL;
    }
}
```

### 5.3 find_entry 函数

`find_entry()` 在目录中查找指定的目录项：

```c
static struct buffer_head * find_entry(struct m_inode ** dir,
    const char * name, int namelen, struct dir_entry ** res_dir)
{
    int entries;
    int block, i;
    struct buffer_head * bh;
    struct dir_entry * de;
    struct super_block * sb;

    entries = (*dir)->i_size / (sizeof(struct dir_entry));
    *res_dir = NULL;
    if (!namelen)
        return NULL;

    /* 特殊处理 ".." */
    if (namelen == 2 && get_fs_byte(name) == '.' && get_fs_byte(name + 1) == '.') {
        /* 伪根目录处理 */
        if ((*dir) == current->root)
            namelen = 1;
        /* 挂载点处理：跳转到挂载点目录 */
        else if ((*dir)->i_num == ROOT_INO) {
            sb = get_super((*dir)->i_dev);
            if (sb->s_imount) {
                iput(*dir);
                (*dir) = sb->s_imount;
                (*dir)->i_count++;
            }
        }
    }

    /* 读取目录数据块 */
    if (!(block = (*dir)->i_zone[0]))
        return NULL;
    if (!(bh = bread((*dir)->i_dev, block)))
        return NULL;

    /* 遍历目录项 */
    i = 0;
    de = (struct dir_entry *) bh->b_data;
    while (i < entries) {
        /* 处理跨块的情况 */
        if ((char *)de >= BLOCK_SIZE + bh->b_data) {
            brelse(bh);
            bh = NULL;
            if (!(block = bmap(*dir, i / DIR_ENTRIES_PER_BLOCK)) ||
                !(bh = bread((*dir)->i_dev, block))) {
                i += DIR_ENTRIES_PER_BLOCK;
                continue;
            }
            de = (struct dir_entry *) bh->b_data;
        }

        /* 匹配文件名 */
        if (match(namelen, name, de)) {
            *res_dir = de;
            return bh;
        }
        de++;
        i++;
    }

    brelse(bh);
    return NULL;
}
```

### 5.4 路径解析流程图

```
解析路径 "/home/user/file.txt"：
+===========================================================================+
|                                                                           |
|   输入: "/home/user/file.txt"                                            |
|                                                                           |
+===========================================================================+
          |
          v
+-------------------+
| 检查首字符        |
| '/' ? 从 root 开始|
+---------+---------+
          |
          v
+-------------------+
| current->root     |
| inode = 根目录    |
+---------+---------+
          |
          v
+===================+     +===================+
| 遍历 "home"       |---->| find_entry()      |
| 在根目录中查找    |     | 读取目录数据块    |
+===================+     | 匹配目录项名      |
          |               +=========+=========+
          v                         |
+-------------------+               |
| 获取 home 的 inode|<--------------+
+---------+---------+
          |
          v
+===================+     +===================+
| 遍历 "user"       |---->| find_entry()      |
| 在 home 目录中查找|     | 读取目录数据块    |
+===================+     | 匹配目录项名      |
          |               +=========+=========+
          v                         |
+-------------------+               |
| 获取 user 的 inode|<--------------+
+---------+---------+
          |
          v
+===================+     +===================+
| 遍历 "file.txt"   |---->| find_entry()      |
| 在 user 目录中查找|     | 读取目录数据块    |
+===================+     | 匹配目录项名      |
          |               +=========+=========+
          v                         |
+-------------------+               |
| 获取 file.txt     |<--------------+
| 的 inode          |
+---------+---------+
          |
          v
+-------------------+
| 返回 inode        |
+-------------------+
```

### 5.5 挂载点处理流程

```
遍历挂载点的 ".."：
+===========================================================================+
|                                                                           |
|   当前位置: 挂载文件系统的根目录 (inode 号 = ROOT_INO = 1)               |
|                                                                           |
+===========================================================================+
          |
          v
+-------------------+
| find_entry("..")  |
+---------+---------+
          |
          v
+-------------------+
| 检测到 ".."       |
| 且 i_num == 1     |
+---------+---------+
          |
          v
+-------------------+
| get_super(dev)    |
| 获取超级块        |
+---------+---------+
          |
          v
+-------------------+
| sb->s_imount      |
| 存在?             |
+---------+---------+
          |
    +-----+-----+
    | Yes       | No
    v           v
+-------+   +-------+
| 切换到 |   | 正常  |
| 挂载点 |   | 返回  |
| 目录   |   | ".."  |
+-------+   +-------+
    |
    v
+-------------------+
| 返回挂载点目录    |
| 的父目录          |
+-------------------+
```

---

## 6. 完整流程图

### 6.1 Mount 挂载完整流程

```
+===========================================================================+
|                        Mount 挂载完整流程                                 |
+===========================================================================+

用户空间:  mount /dev/hda1 /mnt
              |
              v
+-------------------+
| sys_mount()       |
+---------+---------+
          |
          v
+---------+---------+     +---------+---------+
| namei("/dev/hda1")|---->| 获取设备 inode    |
+---------+---------+     | i_zone[0]=设备号  |
          |               +-------------------+
          v
+---------+---------+     +---------+---------+
| namei("/mnt")     |---->| 获取挂载点 inode  |
+---------+---------+     | 检查 i_mount=0    |
          |               | 检查是目录        |
          v               +-------------------+
+---------+---------+
| read_super(dev)   |
+---------+---------+
          |
          v
+---------+---------+     +---------+---------+
| 读取超级块        |---->| bread(dev, 1)     |
| 验证魔数          |     | 读取块 1          |
| 读取位图          |     | s_magic=0x137F    |
+---------+---------+     +-------------------+
          |
          v
+---------+---------+
| 建立挂载关系      |
| sb->s_imount=dir_i|
| dir_i->i_mount=1  |
+---------+---------+
          |
          v
+-------------------+
| 挂载完成          |
+-------------------+
```

### 6.2 硬链接创建完整流程

```
+===========================================================================+
|                        硬链接创建完整流程                                 |
+===========================================================================+

用户空间:  link /home/file.txt /home/link.txt
              |
              v
+-------------------+
| sys_link()        |
+---------+---------+
          |
          v
+---------+---------+     +---------+---------+
| namei(oldname)    |---->| 获取源文件 inode  |
+---------+---------+     | 检查不是目录      |
          |               +-------------------+
          v
+---------+---------+     +---------+---------+
| dir_namei(newname)|---->| 获取目标目录      |
+---------+---------+     | 检查同一设备      |
          |               | 检查写权限        |
          v               +-------------------+
+---------+---------+
| find_entry()      |
| 检查目标不存在    |
+---------+---------+
          |
          v
+---------+---------+     +---------+---------+
| add_entry()       |---->| 在目录中添加项    |
+---------+---------+     | de->inode=原inode |
          |               +-------------------+
          v
+---------+---------+
| oldinode->        |
| i_nlinks++        |
+---------+---------+
          |
          v
+-------------------+
| 硬链接创建完成    |
+-------------------+
```

### 6.3 路径解析与挂载点交互

```
+===========================================================================+
|                    路径解析与挂载点交互流程                               |
+===========================================================================+

解析路径 "/mnt/data/file.txt"，其中 /mnt 是挂载点：

+-------------------+
| 开始解析          |
| pathname =        |
| "/mnt/data/..."   |
+---------+---------+
          |
          v
+---------+---------+
| 解析 "/"          |
| inode = root      |
+---------+---------+
          |
          v
+---------+---------+
| 解析 "mnt"        |
| find_entry()      |
+---------+---------+
          |
          v
+---------+---------+
| 获取 mnt 的 inode |
| i_mount = 1 ?     |
+---------+---------+
          |
    +-----+-----+
    | Yes       | No
    v           v
+-------+   +-------+
| 检测到 |   | 正常  |
| 挂载点 |   | 继续  |
+-------+   +-------+
    |
    v
+-------------------+
| 获取超级块        |
| sb->s_isup        |
| 切换到被挂载 FS   |
| 的根 inode        |
+---------+---------+
          |
          v
+---------+---------+
| 继续解析 "data"   |
| 在新 FS 中查找    |
+---------+---------+
          |
          v
+---------+---------+
| 解析 "file.txt"   |
| 返回最终 inode    |
+-------------------+
```

---

## 7. 总结

### 7.1 关键数据结构总结

| 结构 | 字段 | 作用 |
|------|------|------|
| **super_block** | s_imount | 指向挂载点 inode |
| **super_block** | s_isup | 指向文件系统根 inode |
| **inode** | i_mount | 标记是否为挂载点 |
| **inode** | i_nlinks | 硬链接计数 |
| **dir_entry** | inode | 目录项指向的 inode 号 |

### 7.2 关键函数总结

| 函数 | 文件 | 作用 |
|------|------|------|
| sys_mount() | super.c | 挂载文件系统 |
| sys_umount() | super.c | 卸载文件系统 |
| sys_link() | namei.c | 创建硬链接 |
| sys_unlink() | namei.c | 删除硬链接 |
| namei() | namei.c | 路径解析主函数 |
| get_dir() | namei.c | 遍历路径各级 |
| find_entry() | namei.c | 在目录中查找项 |
| iget() | inode.c | 获取/读取 inode |

### 7.3 Linux 0.11 的限制

| 功能 | 支持情况 |
|------|---------|
| Mount 挂载 | ✅ 完整支持 |
| 硬链接 | ✅ 完整支持 |
| 软链接 | ❌ 未实现 |
| 挂载点遍历 | ✅ 支持 ".." 跳转 |
| 跨设备硬链接 | ❌ 不支持（正确行为） |