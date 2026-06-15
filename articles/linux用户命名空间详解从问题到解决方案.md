# Linux用户命名空间详解：从问题到解决方案

## 目标

读完本文，你要明白两件事：

1. **用户命名空间是怎么工作的**
2. **为什么要设计成这样**

---

# 一、先从最根本的问题开始：如何隔离用户权限？

Linux系统中，用户权限管理面临一个根本问题：

- **root用户（UID 0）拥有所有权限**
- **普通用户权限受限**
- **多个应用或容器可能需要不同的权限隔离**

传统系统中，所有进程共享同一个用户ID空间：

- 进程A（UID 1000）和进程B（UID 1000）是同一个用户
- root用户（UID 0）在任何地方都是root
- 无法让一个容器内的root用户在宿主机上只是普通用户

## 问题

如果多个容器共享同一个用户ID空间：

- 容器内的root用户在宿主机也是root（安全隐患）
- 不同容器无法有独立的用户管理
- 无法实现权限隔离

所以需要一个机制来隔离用户和组ID。

---

# 二、于是有了用户命名空间：隔离用户和组ID

用户命名空间（User Namespace）的设计理念：

- **隔离用户ID和组ID**：不同命名空间可以有独立的用户ID映射
- **权限隔离**：容器内的root在宿主机可以是普通用户
- **安全增强**：限制容器进程的权限范围
- **灵活映射**：管理员可以配置UID/GID映射关系

## 核心思想

用户命名空间通过UID/GID映射实现权限隔离：

1. **内核内部ID（kuid/kgid）**：全局唯一的内核ID
2. **用户空间ID（uid/gid）**：每个命名空间独立的用户ID
3. **映射关系**：定义用户空间ID到内核ID的转换规则

---

# 三、用户命名空间架构：分层映射

```
┌─────────────────────────────────────────────────────────────┐
│                    用户命名空间层次结构                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  初始用户命名空间（init_user_ns）                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UID 0 = root（全局root）                            │   │
│  │  UID 1000 = user1（全局用户）                        │   │
│  │  所有进程共享这个命名空间的用户ID                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│                          ↓ 创建子命名空间                    │
│                          ↓                                  │
│  容器1用户命名空间                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UID 0 = 容器root                                    │   │
│  │  映射到宿主机UID 100000                               │   │
│  │  UID 1000 = 容器用户                                 │   │
│  │  映射到宿主机UID 101000                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│                          ↓ 创建子命名空间                    │
│                          ↓                                  │
│  容器2用户命名空间                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UID 0 = 容器root                                    │   │
│  │  映射到宿主机UID 200000                               │   │
│  │  UID 1000 = 容器用户                                 │   │
│  │  映射到宿主机UID 201000                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 关键概念

### 1. 用户命名空间层次

用户命名空间形成树状结构：

- **init_user_ns**：初始用户命名空间（根）
- **子命名空间**：从父命名空间创建
- **level**：命名空间的深度（最多32层）

### 2. UID/GID映射

每个用户命名空间有三组映射：

- **uid_map**：用户ID映射
- **gid_map**：组ID映射
- **projid_map**：项目ID映射

### 3. 权限转换

用户命名空间改变了权限检查逻辑：

- **ns_capable()**：在特定命名空间检查权限
- **capable()**：在初始命名空间检查权限

---

# 四、核心数据结构详解

## 1. user_namespace结构

**定义位置**：**`include/linux/user_namespace.h`**

```c
struct user_namespace {
    struct uid_gid_map    uid_map;      /* 用户ID映射 */
    struct uid_gid_map    gid_map;      /* 组ID映射 */
    struct uid_gid_map    projid_map;   /* 项目ID映射 */
    struct user_namespace *parent;      /* 父命名空间 */
    int                   level;        /* 命名空间层级 */
    kuid_t                owner;        /* 命名空间创建者UID */
    kgid_t                group;        /* 命名空间创建者GID */
    struct ns_common      ns;           /* 通用命名空间结构 */
    unsigned long         flags;        /* 命名空间标志 */
    bool                  parent_could_setfcap; /* 父命名空间是否有CAP_SETFCAP */
    
#ifdef CONFIG_KEYS
    struct list_head      keyring_name_list; /* 密钥环列表 */
    struct key            *user_keyring_register; /* 用户密钥环注册 */
    struct rw_semaphore   keyring_sem;  /* 密钥环信号量 */
#endif

#ifdef CONFIG_PERSISTENT_KEYRINGS
    struct key            *persistent_keyring_register; /* 持久密钥环注册 */
#endif
    
    struct work_struct    work;         /* 工作队列 */
#ifdef CONFIG_SYSCTL
    struct ctl_table_set  set;          /* sysctl表集合 */
    struct ctl_table_header *sysctls;   /* sysctl头 */
#endif
    
    struct ucounts        *ucounts;     /* 用户计数 */
    long ucount_max[UCOUNT_COUNTS];     /* 用户计数限制 */
} __randomize_layout;
```

### 关键字段说明

- **uid_map/gid_map/projid_map**：定义ID映射关系
- **parent**：指向父命名空间，形成层次结构
- **level**：命名空间深度，限制最多32层
- **owner/group**：创建者的UID/GID，用于权限检查
- **flags**：命名空间标志，如USERNS_SETGROUPS_ALLOWED
- **ucounts**：用户资源计数，限制命名空间数量

## 2. uid_gid_map结构

**定义位置**：**`include/linux/user_namespace.h`**

```c
struct uid_gid_map { /* 64 bytes -- 1 cache line */
    u32 nr_extents;  /* 映射范围数量 */
    union {
        struct uid_gid_extent extent[UID_GID_MAP_MAX_BASE_EXTENTS]; /* 内联映射 */
        struct {
            struct uid_gid_extent *forward;  /* 前向映射数组 */
            struct uid_gid_extent *reverse;  /* 反向映射数组 */
        };
    };
};
```

### 映射存储方式

- **nr_extents <= 5**：使用内联数组extent[]
- **nr_extents > 5**：使用动态分配的forward/reverse数组

## 3. uid_gid_extent结构

**定义位置**：**`include/linux/user_namespace.h`**

```c
struct uid_gid_extent {
    u32 first;        /* 命名空间内的起始ID */
    u32 lower_first;  /* 父命名空间内的起始ID */
    u32 count;        /* 映射范围大小 */
};
```

### 映射示例

```
映射配置：first=0, lower_first=100000, count=1000

含义：
- 命名空间内UID 0-999 映射到父命名空间UID 100000-100999
- 命名空间内UID 0 = 父命名空间UID 100000
- 命名空间内UID 1 = 父命名空间UID 100001
- ...
- 命名空间内UID 999 = 父命名空间UID 100999
```

## 4. nsproxy结构

**定义位置**：**`include/linux/nsproxy.h`**

```c
struct nsproxy {
    atomic_t count;                      /* 引用计数 */
    struct uts_namespace *uts_ns;        /* UTS命名空间 */
    struct ipc_namespace *ipc_ns;        /* IPC命名空间 */
    struct mnt_namespace *mnt_ns;        /* 挂载命名空间 */
    struct pid_namespace *pid_ns_for_children; /* PID命名空间 */
    struct net           *net_ns;        /* 网络命名空间 */
    struct time_namespace *time_ns;      /* 时间命名空间 */
    struct time_namespace *time_ns_for_children; /* 子进程时间命名空间 */
    struct cgroup_namespace *cgroup_ns;  /* Cgroup命名空间 */
};
```

### 命名空间代理的作用

- **统一管理**：一个进程的所有命名空间通过nsproxy管理
- **共享机制**：多个进程可以共享同一个nsproxy
- **引用计数**：通过count字段管理生命周期

---

# 五、用户命名空间创建流程

## 1. 创建用户命名空间

**核心函数**：**`kernel/user_namespace.c`**

```c
/*
 * create_user_ns() - 创建新的用户命名空间
 * 
 * @new: 新的凭证结构
 * 
 * 创建流程：
 * 1. 检查层级限制（最多32层）
 * 2. 增加用户命名空间计数
 * 3. 分配并初始化user_namespace结构
 * 4. 设置命名空间层级和创建者
 * 5. 初始化资源限制
 * 6. 设置凭证的用户命名空间
 */
int create_user_ns(struct cred *new)
{
    struct user_namespace *ns, *parent_ns = new->user_ns;
    kuid_t owner = new->euid;
    kgid_t group = new->egid;
    struct ucounts *ucounts;
    int ret, i;

    /* 1. 检查层级限制 */
    ret = -ENOSPC;
    if (parent_ns->level > 32)
        goto fail;

    /* 2. 增加用户命名空间计数 */
    ucounts = inc_user_namespaces(parent_ns, owner);
    if (!ucounts)
        goto fail;

    /* 3. 检查是否在chroot环境中 */
    ret = -EPERM;
    if (current_chrooted())
        goto fail_dec;

    /* 4. 检查创建者是否有映射 */
    ret = -EPERM;
    if (!kuid_has_mapping(parent_ns, owner) ||
        !kgid_has_mapping(parent_ns, group))
        goto fail_dec;

    /* 5. 分配用户命名空间结构 */
    ret = -ENOMEM;
    ns = kmem_cache_zalloc(user_ns_cachep, GFP_KERNEL);
    if (!ns)
        goto fail_dec;

    /* 6. 设置命名空间属性 */
    ns->parent_could_setfcap = cap_raised(new->cap_effective, CAP_SETFCAP);
    ret = ns_alloc_inum(&ns->ns);
    if (ret)
        goto fail_free;
    ns->ns.ops = &userns_operations;

    /* 7. 初始化引用计数和层级 */
    refcount_set(&ns->ns.count, 1);
    ns->parent = parent_ns;
    ns->level = parent_ns->level + 1;
    ns->owner = owner;
    ns->group = group;
    INIT_WORK(&ns->work, free_user_ns);

    /* 8. 初始化资源限制 */
    for (i = 0; i < MAX_PER_NAMESPACE_UCOUNTS; i++) {
        ns->ucount_max[i] = INT_MAX;
    }
    set_rlimit_ucount_max(ns, UCOUNT_RLIMIT_NPROC, enforced_nproc_rlimit());
    set_rlimit_ucount_max(ns, UCOUNT_RLIMIT_MSGQUEUE, rlimit(RLIMIT_MSGQUEUE));
    set_rlimit_ucount_max(ns, UCOUNT_RLIMIT_SIGPENDING, rlimit(RLIMIT_SIGPENDING));
    set_rlimit_ucount_max(ns, UCOUNT_RLIMIT_MEMLOCK, rlimit(RLIMIT_MEMLOCK));
    ns->ucounts = ucounts;

    /* 9. 继承父命名空间的标志 */
    mutex_lock(&userns_state_mutex);
    ns->flags = parent_ns->flags;
    mutex_unlock(&userns_state_mutex);

#ifdef CONFIG_KEYS
    INIT_LIST_HEAD(&ns->keyring_name_list);
    init_rwsem(&ns->keyring_sem);
#endif

    /* 10. 设置sysctl */
    ret = -ENOMEM;
    if (!setup_userns_sysctls(ns))
        goto fail_keyring;

    /* 11. 设置凭证的用户命名空间 */
    set_cred_user_ns(new, ns);
    return 0;

fail_keyring:
#ifdef CONFIG_PERSISTENT_KEYRINGS
    key_put(ns->persistent_keyring_register);
#endif
    ns_free_inum(&ns->ns);
fail_free:
    kmem_cache_free(user_ns_cachep, ns);
fail_dec:
    dec_user_namespaces(ucounts);
fail:
    return ret;
}
```

## 2. 设置凭证的用户命名空间

**定义位置**：**`kernel/user_namespace.c`**

```c
/*
 * set_cred_user_ns() - 设置凭证的用户命名空间
 * 
 * @cred: 凭证结构
 * @user_ns: 用户命名空间
 * 
 * 设置流程：
 * 1. 初始化安全位
 * 2. 设置capabilities（初始为全部权限）
 * 3. 清除密钥授权
 * 4. 设置用户命名空间
 */
static void set_cred_user_ns(struct cred *cred, struct user_namespace *user_ns)
{
    /* 1. 初始化安全位 */
    cred->securebits = SECUREBITS_DEFAULT;
    
    /* 2. 设置capabilities */
    cred->cap_inheritable = CAP_EMPTY_SET;      /* 无继承权限 */
    cred->cap_permitted = CAP_FULL_SET;         /* 全部允许权限 */
    cred->cap_effective = CAP_FULL_SET;         /* 全部有效权限 */
    cred->cap_ambient = CAP_EMPTY_SET;          /* 无环境权限 */
    cred->cap_bset = CAP_FULL_SET;              /* 全部边界集 */
    
#ifdef CONFIG_KEYS
    /* 3. 清除密钥授权 */
    key_put(cred->request_key_auth);
    cred->request_key_auth = NULL;
#endif
    
    /* 4. 设置用户命名空间 */
    cred->user_ns = user_ns;
}
```

### 关键点

- **新命名空间的root用户**：在创建时拥有全部capabilities
- **权限范围限制**：这些权限只在当前命名空间有效
- **父命名空间视角**：在父命名空间中只是普通用户

---

# 六、UID/GID映射机制详解

## 1. 映射方向

用户命名空间支持两种映射方向：

- **向下映射（map_down）**：从命名空间ID到内核ID
- **向上映射（map_up）**：从内核ID到命名空间ID

```
┌─────────────────────────────────────────────────────────────┐
│                    UID/GID映射方向                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  向下映射（map_down）：                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  命名空间UID → 内核kuid                               │   │
│  │                                                          │   │
│  │  容器内UID 0 → 内核kuid 100000                         │   │
│  │  容器内UID 1000 → 内核kuid 101000                      │   │
│  │                                                          │   │
│  │  用途：内核权限检查、文件系统访问                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  向上映射（map_up）：                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  内核kuid → 命名空间UID                               │   │
│  │                                                          │   │
│  │  内核kuid 100000 → 容器内UID 0                         │   │
│  │  内核kuid 101000 → 容器内UID 1000                      │   │
│  │                                                          │   │
│  │  用途：显示给用户、进程信息输出                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 2. 向下映射函数

**核心函数**：**`kernel/user_namespace.c`**

```c
/*
 * map_id_range_down() - 将命名空间ID范围映射到内核ID
 * 
 * @map: UID/GID映射表
 * @id: 命名空间内的起始ID
 * @count: ID范围大小
 * 
 * 返回：映射后的内核ID，失败返回(u32)-1
 */
static u32 map_id_range_down(struct uid_gid_map *map, u32 id, u32 count)
{
    struct uid_gid_extent *extent;
    unsigned extents = map->nr_extents;
    smp_rmb();

    /* 根据映射数量选择查找方法 */
    if (extents <= UID_GID_MAP_MAX_BASE_EXTENTS)
        extent = map_id_range_down_base(extents, map, id, count);
    else
        extent = map_id_range_down_max(extents, map, id, count);

    /* 执行映射转换 */
    if (extent)
        id = (id - extent->first) + extent->lower_first;
    else
        id = (u32) -1;  /* 无映射 */

    return id;
}

/*
 * map_id_down() - 将单个命名空间ID映射到内核ID
 */
static u32 map_id_down(struct uid_gid_map *map, u32 id)
{
    return map_id_range_down(map, id, 1);
}
```

### 映射算法

```
假设映射配置：
  extent[0]: first=0, lower_first=100000, count=1000

输入：id=500（命名空间内UID）

查找过程：
  1. 检查id是否在范围内：500 >= 0 && 500 <= 999
  2. 计算偏移：offset = id - first = 500 - 0 = 500
  3. 计算内核ID：kuid = lower_first + offset = 100000 + 500 = 100500

输出：kuid=100500（内核内部UID）
```

## 3. 向上映射函数

**核心函数**：**`kernel/user_namespace.c`**

```c
/*
 * map_id_up() - 将内核ID映射到命名空间ID
 * 
 * @map: UID/GID映射表
 * @id: 内核内部ID
 * 
 * 返回：映射后的命名空间ID，失败返回(u32)-1
 */
static u32 map_id_up(struct uid_gid_map *map, u32 id)
{
    struct uid_gid_extent *extent;
    unsigned extents = map->nr_extents;
    smp_rmb();

    /* 根据映射数量选择查找方法 */
    if (extents <= UID_GID_MAP_MAX_BASE_EXTENTS)
        extent = map_id_up_base(extents, map, id);
    else
        extent = map_id_up_max(extents, map, id);

    /* 执行映射转换 */
    if (extent)
        id = (id - extent->lower_first) + extent->first;
    else
        id = (u32) -1;  /* 无映射 */

    return id;
}
```

### 映射算法

```
假设映射配置：
  extent[0]: first=0, lower_first=100000, count=1000

输入：id=100500（内核内部UID）

查找过程：
  1. 检查id是否在范围内：100500 >= 100000 && 100500 <= 100999
  2. 计算偏移：offset = id - lower_first = 100500 - 100000 = 500
  3. 计算命名空间ID：uid = first + offset = 0 + 500 = 500

输出：uid=500（命名空间内UID）
```

## 4. make_kuid和from_kuid函数

**核心函数**：**`kernel/user_namespace.c`**

```c
/*
 * make_kuid() - 将用户命名空间的UID转换为内核kuid
 * 
 * @ns: 用户命名空间
 * @uid: 用户命名空间内的UID
 * 
 * 返回：内核内部kuid
 */
kuid_t make_kuid(struct user_namespace *ns, uid_t uid)
{
    /* 映射UID到全局内核UID */
    return KUIDT_INIT(map_id_down(&ns->uid_map, uid));
}
EXPORT_SYMBOL(make_kuid);

/*
 * from_kuid() - 将内核kuid转换为用户命名空间的UID
 * 
 * @targ: 目标用户命名空间
 * @kuid: 内核内部kuid
 * 
 * 返回：用户命名空间内的UID，无映射返回(uid_t)-1
 */
uid_t from_kuid(struct user_namespace *targ, kuid_t kuid)
{
    /* 从全局内核UID映射到目标命名空间UID */
    return map_id_up(&targ->uid_map, __kuid_val(kuid));
}
EXPORT_SYMBOL(from_kuid);

/*
 * from_kuid_munged() - 将内核kuid转换为用户命名空间的UID（容错版本）
 * 
 * @targ: 目标用户命名空间
 * @kuid: 内核内部kuid
 * 
 * 返回：用户命名空间内的UID，无映射返回overflowuid
 */
uid_t from_kuid_munged(struct user_namespace *targ, kuid_t kuid)
{
    uid_t uid;
    uid = from_kuid(targ, kuid);

    if (uid == (uid_t) -1)
        uid = overflowuid;  /* 使用溢出UID */
    return uid;
}
EXPORT_SYMBOL(from_kuid_munged);
```

### 使用场景

- **make_kuid**：内核权限检查、文件系统访问、进程创建
- **from_kuid**：显示进程信息、返回给用户空间
- **from_kuid_munged**：stat、getuid等系统调用，必须返回有效UID

---

# 七、UID/GID映射配置

## 1. 映射写入接口

**核心函数**：**`kernel/user_namespace.c`**

```c
/*
 * proc_uid_map_write() - 写入UID映射
 * 
 * @file: proc文件
 * @buf: 用户空间缓冲区
 * @size: 数据大小
 * @ppos: 文件位置
 * 
 * 映射格式：
 *   <ns_uid_start> <parent_uid_start> <count>
 * 
 * 示例：
 *   0 100000 1000
 *   含义：命名空间UID 0-999 映射到父命名空间UID 100000-100999
 */
ssize_t proc_uid_map_write(struct file *file, const char __user *buf,
                           size_t size, loff_t *ppos)
{
    struct seq_file *seq = file->private_data;
    struct user_namespace *ns = seq->private;
    struct user_namespace *seq_ns = seq_user_ns(seq);

    /* 1. 检查是否有父命名空间 */
    if (!ns->parent)
        return -EPERM;

    /* 2. 检查权限：只能由命名空间或父命名空间的进程写入 */
    if ((seq_ns != ns) && (seq_ns != ns->parent))
        return -EPERM;

    /* 3. 调用map_write写入映射 */
    return map_write(file, buf, size, ppos, CAP_SETUID,
                     &ns->uid_map, &ns->parent->uid_map);
}

/*
 * proc_gid_map_write() - 写入GID映射
 */
ssize_t proc_gid_map_write(struct file *file, const char __user *buf,
                           size_t size, loff_t *ppos)
{
    struct seq_file *seq = file->private_data;
    struct user_namespace *ns = seq->private;
    struct user_namespace *seq_ns = seq_user_ns(seq);

    if (!ns->parent)
        return -EPERM;

    if ((seq_ns != ns) && (seq_ns != ns->parent))
        return -EPERM;

    return map_write(file, buf, size, ppos, CAP_SETGID,
                     &ns->gid_map, &ns->parent->gid_map);
}
```

## 2. 映射权限检查

**核心函数**：**`kernel/user_namespace.c`**

```c
/*
 * new_idmap_permitted() - 检查是否允许创建新的ID映射
 * 
 * @file: proc文件
 * @ns: 用户命名空间
 * @cap_setid: 需要的capability（CAP_SETUID或CAP_SETGID）
 * @new_map: 新的映射配置
 * 
 * 权限规则：
 * 1. 单个ID映射：允许创建者映射自己的UID/GID
 * 2. 多个ID映射：需要在父命名空间有CAP_SETUID/CAP_SETGID
 */
static bool new_idmap_permitted(const struct file *file,
                                struct user_namespace *ns, int cap_setid,
                                struct uid_gid_map *new_map)
{
    const struct cred *cred = file->f_cred;

    /* 1. 检查root映射是否正确 */
    if (cap_setid == CAP_SETUID && !verify_root_map(file, ns, new_map))
        return false;

    /* 2. 允许单个ID映射（创建者映射自己的ID） */
    if ((new_map->nr_extents == 1) && (new_map->extent[0].count == 1) &&
        uid_eq(ns->owner, cred->euid)) {
        u32 id = new_map->extent[0].lower_first;
        
        if (cap_setid == CAP_SETUID) {
            kuid_t uid = make_kuid(ns->parent, id);
            if (uid_eq(uid, cred->euid))
                return true;  /* 允许映射自己的UID */
        } else if (cap_setid == CAP_SETGID) {
            kgid_t gid = make_kgid(ns->parent, id);
            if (!(ns->flags & USERNS_SETGROUPS_ALLOWED) &&
                gid_eq(gid, cred->egid))
                return true;  /* 允许映射自己的GID */
        }
    }

    /* 3. 允许无权限要求的映射 */
    if (!cap_valid(cap_setid))
        return true;

    /* 4. 检查是否有CAP_SETUID/CAP_SETGID权限 */
    if (ns_capable(ns->parent, cap_setid) &&
        file_ns_capable(file, ns->parent, cap_setid))
        return true;

    return false;
}
```

## 3. 映射配置示例

### 单个ID映射（无特权）

```
# 容器内UID 0 映射到宿主机UID 1000（当前用户）
echo "0 1000 1" > /proc/<pid>/uid_map

# 容器内GID 0 映射到宿主机GID 1000（当前组）
echo "0 1000 1" > /proc/<pid>/gid_map
```

### 多个ID映射（需要特权）

```
# 容器内UID 0-999 映射到宿主机UID 100000-100999
echo "0 100000 1000" > /proc/<pid>/uid_map

# 容器内GID 0-999 映射到宿主机GID 100000-100999
echo "0 100000 1000" > /proc/<pid>/gid_map
```

### 多段映射

```
# 容器内UID 0-99 映射到宿主机UID 100000-100099
# 容器内UID 100-199 映射到宿主机UID 0-99（root）
echo "0 100000 100
      100 0 100" > /proc/<pid>/uid_map
```

---

# 八、Capabilities权限管理

## 1. 命名空间内的Capabilities

用户命名空间改变了capabilities的检查逻辑：

```
┌─────────────────────────────────────────────────────────────┐
│                    Capabilities权限检查                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统系统（无用户命名空间）：                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  capable(CAP_SYS_ADMIN)                              │   │
│  │  • 检查进程是否有CAP_SYS_ADMIN                       │   │
│  │  • 在全局范围内有效                                  │   │
│  │  • root用户拥有所有capabilities                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  用户命名空间系统：                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ns_capable(user_ns, CAP_SYS_ADMIN)                  │   │
│  │  • 检查进程在特定命名空间是否有权限                   │   │
│  │  • 只在当前命名空间有效                              │   │
│  │  • 容器root在宿主机无特权                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 2. ns_capable函数

**定义位置**：**`include/linux/capability.h`**

```c
/*
 * ns_capable() - 检查进程在特定命名空间是否有capability
 * 
 * @ns: 用户命名空间
 * @cap: capability标志
 * 
 * 返回：true如果有权限，false否则
 */
bool ns_capable(struct user_namespace *ns, int cap)
{
    /* 检查进程在指定命名空间的权限 */
    return has_ns_capability(current, ns, cap);
}

/*
 * capable() - 检查进程在初始命名空间是否有capability
 */
bool capable(int cap)
{
    return ns_capable(&init_user_ns, cap);
}
```

## 3. Capability继承规则

用户命名空间中的capability继承规则：

```
┌─────────────────────────────────────────────────────────────┐
│                    Capability继承规则                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 创建新命名空间时：                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 新命名空间的root拥有全部capabilities               │   │
│  │  • 这些权限只在当前命名空间有效                       │   │
│  │  • 在父命名空间中无特权                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 跨命名空间操作：                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 需要在目标命名空间有相应权限                       │   │
│  │  • 容器内root无法影响宿主机                          │   │
│  │  • 宿主机root可以管理容器                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 文件系统访问：                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 文件权限检查使用内核kuid/kgid                     │   │
│  │  • 容器内UID 0映射到宿主机普通用户                   │   │
│  │  • 无法访问宿主机root拥有的文件                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

# 九、实际应用示例

## 1. 创建用户命名空间

### 使用unshare命令

```bash
# 创建新的用户命名空间
unshare --user

# 查看当前用户命名空间
ls -l /proc/self/ns/user

# 查看UID映射（初始为空）
cat /proc/self/uid_map
```

### 使用clone系统调用

```c
#define _GNU_SOURCE
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>

int child_func(void *arg) {
    printf("Child process:\n");
    printf("  UID: %d\n", getuid());
    printf("  GID: %d\n", getgid());
    
    /* 在新命名空间中，UID/GID初始为-1（未映射） */
    /* 需要配置映射后才能正常使用 */
    
    return 0;
}

int main() {
    printf("Parent process:\n");
    printf("  UID: %d\n", getuid());
    printf("  GID: %d\n", getgid());
    
    /* 创建新的用户命名空间 */
    int flags = CLONE_NEWUSER;
    pid_t pid = clone(child_func, NULL, flags | SIGCHLD, NULL);
    
    if (pid == -1) {
        perror("clone");
        exit(1);
    }
    
    waitpid(pid, NULL, 0);
    return 0;
}
```

## 2. 配置UID/GID映射

### 单个ID映射（无特权）

```bash
# 创建用户命名空间
unshare --user --map-root-user

# 查看UID映射
cat /proc/self/uid_map
# 输出：0 1000 1
# 含义：容器内UID 0 映射到宿主机UID 1000

# 查看GID映射
cat /proc/self/gid_map
# 输出：0 1000 1
# 含义：容器内GID 0 映射到宿主机GID 1000

# 查看当前UID/GID
id
# 输出：uid=0(root) gid=0(root)
# 在容器内显示为root
```

### 多个ID映射（需要特权）

```bash
# 创建用户命名空间
unshare --user

# 获取子进程PID
PID=$!

# 配置UID映射（需要root权限）
echo "0 100000 1000" > /proc/$PID/uid_map

# 配置GID映射（需要root权限）
echo "0 100000 1000" > /proc/$PID/gid_map

# 允许setgroups
echo "allow" > /proc/$PID/setgroups

# 在子进程中查看UID/GID
nsenter --user -t $PID id
# 输出：uid=0(root) gid=0(root)
```

## 3. 容器中的应用

### Docker容器

Docker默认使用用户命名空间：

```bash
# 启用用户命名空间的Docker容器
docker run --userns-remap=default -it ubuntu bash

# 查看容器内的UID
id
# 输出：uid=0(root) gid=0(root)

# 在宿主机查看容器进程的UID
ps aux | grep docker
# 输出：UID为100000+（映射后的UID）
```

### Docker用户命名空间配置

/etc/docker/daemon.json：

```json
{
  "userns-remap": "default"
}
```

### 手动创建容器

```bash
# 1. 创建用户命名空间
unshare --user --fork

# 2. 配置UID映射
echo "0 100000 65536" > /proc/self/uid_map

# 3. 配置GID映射
echo "0 100000 65536" > /proc/self/gid_map

# 4. 允许setgroups
echo "allow" > /proc/self/setgroups

# 5. 创建其他命名空间
unshare --mount --pid --net --uts --fork

# 6. 挂载proc文件系统
mount -t proc proc /proc

# 7. 启动容器shell
bash
```

---

# 十、安全特性与限制

## 1. 层级限制

```
┌─────────────────────────────────────────────────────────────┐
│                    用户命名空间层级限制                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  最大层级：32层                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 防止无限嵌套                                      │   │
│  │  • 避免性能问题                                      │   │
│  │  • 限制权限复杂度                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  检查代码：                                                  │
│  if (parent_ns->level > 32)                                │
│      return -ENOSPC;                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 2. 用户命名空间数量限制

```c
/*
 * 用户命名空间数量限制
 * 
 * 每个用户可以创建的用户命名空间数量有限制
 * 通过ucounts机制管理
 */
struct ucounts {
    struct hlist_node node;
    struct user_namespace *ns;
    kuid_t uid;
    atomic_t count;
    atomic_long_t ucount[UCOUNT_COUNTS];  /* 各种计数 */
};

enum ucount_type {
    UCOUNT_USER_NAMESPACES,  /* 用户命名空间计数 */
    UCOUNT_PID_NAMESPACES,   /* PID命名空间计数 */
    UCOUNT_UTS_NAMESPACES,   /* UTS命名空间计数 */
    UCOUNT_IPC_NAMESPACES,   /* IPC命名空间计数 */
    UCOUNT_NET_NAMESPACES,   /* 网络命名空间计数 */
    UCOUNT_MNT_NAMESPACES,   /* 挂载命名空间计数 */
    UCOUNT_CGROUP_NAMESPACES,/* Cgroup命名空间计数 */
    UCOUNT_TIME_NAMESPACES,  /* 时间命名空间计数 */
    ...
};
```

## 3. setgroups限制

```
/etc/<pid>/setgroups文件控制setgroups系统调用：

值：
  • "allow"：允许使用setgroups
  • "deny"：禁止使用setgroups

规则：
  • 新创建的用户命名空间默认禁止setgroups
  • 配置GID映射前必须设置为"allow"
  • 防止通过setgroups绕过权限检查
```

## 4. chroot限制

```c
/*
 * chroot限制
 * 
 * 不能在chroot环境中创建用户命名空间
 * 防止通过用户命名空间逃逸chroot
 */
if (current_chrooted())
    return -EPERM;
```

---

# 十一、调试与问题排查

## 1. 查看用户命名空间

```bash
# 查看进程的用户命名空间
ls -l /proc/<pid>/ns/user

# 查看UID映射
cat /proc/<pid>/uid_map

# 查看GID映射
cat /proc/<pid>/gid_map

# 查看projid映射
cat /proc/<pid>/projid_map

# 查看setgroups状态
cat /proc/<pid>/setgroups

# 查看命名空间层级
readlink /proc/<pid>/ns/user
```

## 2. 查看命名空间关系

```bash
# 查看两个进程是否在同一个用户命名空间
ls -l /proc/<pid1>/ns/user /proc/<pid2>/ns/user

# 如果链接相同，则在同一个命名空间

# 查看命名空间的父命名空间
cat /proc/<pid>/uid_map
# 第二列是父命名空间的UID
```

## 3. 常见问题与解决方案

### 问题1：UID映射失败

**症状**：写入uid_map失败

**排查步骤**：

```bash
# 1. 检查是否有父命名空间
cat /proc/<pid>/uid_map
# 如果输出为空，说明没有父命名空间

# 2. 检查权限
# 只有命名空间或父命名空间的进程可以写入

# 3. 检查映射格式
echo "0 1000 1" > /proc/<pid>/uid_map
# 格式：<ns_uid> <parent_uid> <count>

# 4. 检查capability
# 多个ID映射需要CAP_SETUID权限
```

**解决方案**：

- 确保进程在正确的命名空间
- 使用正确的映射格式
- 确保有足够的权限

### 问题2：进程无法访问文件

**症状**：容器内root无法访问宿主机文件

**排查步骤**：

```bash
# 1. 查看UID映射
cat /proc/<pid>/uid_map

# 2. 查看文件权限
ls -l <file>

# 3. 查看容器进程的内核UID
# 通过UID映射计算内核UID

# 4. 检查文件权限是否匹配
```

**解决方案**：

- 调整UID映射范围
- 修改文件权限
- 使用正确的映射策略

### 问题3：setgroups失败

**症状**：调用setgroups失败

**排查步骤**：

```bash
# 1. 查看setgroups状态
cat /proc/<pid>/setgroups

# 2. 如果输出为"deny"，需要设置为"allow"
echo "allow" > /proc/<pid>/setgroups

# 3. 配置GID映射
echo "0 1000 1" > /proc/<pid>/gid_map
```

**解决方案**：

- 先设置setgroups为"allow"
- 再配置GID映射
- 确保映射正确

---

# 十二、总结

## 核心知识点回顾

```
┌─────────────────────────────────────────────────────────────┐
│                    用户命名空间核心知识点                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 基本概念                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 用户命名空间隔离用户和组ID                          │   │
│  │  • 通过UID/GID映射实现权限隔离                        │   │
│  │  • 容器内root在宿主机可以是普通用户                   │   │
│  │  • 层次结构，最多32层                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 核心数据结构                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • user_namespace：用户命名空间结构                   │   │
│  │  • uid_gid_map：UID/GID映射表                        │   │
│  │  • uid_gid_extent：映射范围                          │   │
│  │  • nsproxy：命名空间代理                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 映射机制                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • map_id_down：命名空间ID → 内核ID                  │   │
│  │  • map_id_up：内核ID → 命名空间ID                    │   │
│  │  • make_kuid：创建内核kuid                           │   │
│  │  • from_kuid：转换为命名空间uid                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 权限管理                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • ns_capable：命名空间权限检查                      │   │
│  │  • capabilities只在当前命名空间有效                  │   │
│  │  • 新命名空间root拥有全部权限                        │   │
│  │  • 父命名空间视角无特权                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. 实际应用                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 容器技术：Docker、LXC等                            │   │
│  │  • 安全隔离：限制容器权限                             │   │
│  │  • 用户管理：独立的用户ID空间                        │   │
│  │  • 资源控制：配合其他命名空间                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 掌握标准检验

```
┌─────────────────────────────────────────────────────────────┐
│                    掌握标准检验清单                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  □ 1. 能解释用户命名空间的作用和优势                         │
│                                                             │
│  □ 2. 能解释UID/GID映射的原理                                │
│                                                             │
│  □ 3. 能理解user_namespace结构的关键字段                     │
│                                                             │
│  □ 4. 能理解uid_gid_map和uid_gid_extent结构                  │
│                                                             │
│  □ 5. 能解释map_id_down和map_id_up的工作原理                 │
│                                                             │
│  □ 6. 能解释make_kuid和from_kuid的使用场景                   │
│                                                             │
│  □ 7. 能解释ns_capable和capable的区别                        │
│                                                             │
│  □ 8. 能配置UID/GID映射                                      │
│                                                             │
│  □ 9. 能创建用户命名空间                                     │
│                                                             │
│  □ 10. 能理解用户命名空间的安全限制                          │
│                                                             │
│  □ 11. 能排查用户命名空间相关问题                             │
│                                                             │
│  □ 12. 能理解用户命名空间在容器中的应用                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 关键代码位置

```
┌─────────────────────────────────────────────────────────────┐
│                    关键代码位置                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户命名空间核心实现：                                      │
│  • kernel/user_namespace.c                                  │
│    - create_user_ns()：创建用户命名空间                      │
│    - map_id_down()：向下映射                                │
│    - map_id_up()：向上映射                                  │
│    - make_kuid()：创建kuid                                  │
│    - from_kuid()：转换uid                                   │
│    - proc_uid_map_write()：写入UID映射                      │
│                                                             │
│  用户命名空间头文件：                                        │
│  • include/linux/user_namespace.h                           │
│    - struct user_namespace                                  │
│    - struct uid_gid_map                                     │
│    - struct uid_gid_extent                                  │
│                                                             │
│  命名空间代理：                                              │
│  • kernel/nsproxy.c                                         │
│    - 命名空间管理                                            │
│  • include/linux/nsproxy.h                                  │
│    - struct nsproxy                                         │
│                                                             │
│  Capabilities相关：                                          │
│  • include/linux/capability.h                               │
│    - ns_capable()                                           │
│    - capable()                                              │
│                                                             │
│  进程凭证：                                                  │
│  • include/linux/cred.h                                     │
│    - struct cred                                            │
│    - user_ns字段                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 进一步学习

```
┌─────────────────────────────────────────────────────────────┐
│                    进一步学习方向                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 其他命名空间                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • PID命名空间：隔离进程ID                            │   │
│  │  • 网络命名空间：隔离网络资源                         │   │
│  │  • 挂载命名空间：隔离文件系统                         │   │
│  │  • UTS命名空间：隔离主机名                            │   │
│  │  • IPC命名空间：隔离IPC资源                           │   │
│  │  • Cgroup命名空间：隔离cgroup                         │   │
│  │  • 时间命名空间：隔离时间                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  2. 容器技术                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • Docker：完整容器解决方案                           │   │
│  │  • LXC：Linux容器                                     │   │
│  │  • containerd：容器运行时                             │   │
│  │  • runc：OCI运行时                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  3. 安全增强                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • SELinux：强制访问控制                              │   │
│  │  • AppArmor：基于路径的访问控制                       │   │
│  │  • Seccomp：系统调用过滤                              │   │
│  │  • Capabilities：细粒度权限控制                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  4. 用户命名空间高级特性                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • ID映射优化                                         │   │
│  │  • 多层嵌套                                           │   │
│  │  • 权限继承                                           │   │
│  │  • 资源限制                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  5. 实际应用                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 无特权容器                                         │   │
│  │  • 多租户系统                                         │   │
│  │  • 安全沙箱                                           │   │
│  │  • 系统隔离                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 参考资料

1. **Linux内核文档**: Documentation/admin-guide/user-namespaces.rst
2. **man pages**: man 7 user_namespaces
3. **LWN文章**: https://lwn.net/Articles/532593/
4. **Docker文档**: https://docs.docker.com/engine/security/userns-remap/
5. **LXC文档**: https://linuxcontainers.org/lxc/documentation/

---

**文档版本**: v1.0  
**创建时间**: 2026年   

---

**说明**: 本文档详细讲解了Linux内核的用户命名空间技术，从"如何隔离用户权限"这个根本问题开始，深入分析了用户命名空间的架构、核心数据结构、UID/GID映射机制、权限管理、实际应用和安全特性。通过本文档，读者应该能够理解用户命名空间的核心机制，并能够在实际工作中配置和管理用户命名空间。