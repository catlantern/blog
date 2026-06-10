# 嵌入式文件系统与 Busybox 详解

> **重要说明**
> 
> 本文档讲述的是**现代嵌入式 Linux 系统**的文件系统构建方法，与 Linux 0.11 内核**没有直接关系**。
> 
> | 项目 | 时间 | 说明 |
> |------|------|------|
> | Linux 0.11 | 1991年 | 早期内核，使用独立的 shell 和命令程序 |
> | Busybox | 1995年 | 现代嵌入式工具集，将多个命令集成于一体 |
> 
> Linux 0.11 的文件系统实现请参考 **`文件系统详解.md`**。
> 
> 本文档作为**扩展知识**，帮助理解现代嵌入式系统的文件系统构建实践。

## 目录

1. **`Busybox 概述`**
2. **`Busybox 架构原理`**
3. **`Busybox 初始化机制`**
4. **`嵌入式文件系统制作`**
5. **`文件系统镜像格式`**
6. **`完整构建实例`**

---

## 1. Busybox 概述

### 1.1 什么是 Busybox

Busybox 是一个**多合一的可执行文件**，集成了大量常用的 Unix 命令：

```
Busybox = 多个命令的集合体

+-------------------+
|    busybox        |
+-------------------+
| ls, cp, mv, rm    |
| cat, echo, grep   |
| mount, umount     |
| ifconfig, route   |
| init, getty       |
| ... 300+ 命令     |
+-------------------+
```

### 1.2 Busybox 的优势

| 特性 | 说明 |
|------|------|
| **体积小** | 静态编译约 1-2MB，动态链接约 500KB |
| **资源占用低** | 适合嵌入式设备，内存占用少 |
| **模块化** | 可按需选择编译哪些命令 |
| **高度可配置** | 通过 menuconfig 配置功能 |
| **兼容性好** | 支持 glibc 和 uclibc |

### 1.3 Busybox 与传统命令对比

```
传统 Linux 命令：
/bin/ls       -- 独立可执行文件
/bin/cp       -- 独立可执行文件
/bin/mv       -- 独立可执行文件
...
总大小：几十 MB

Busybox 方式：
/bin/busybox  -- 单一可执行文件
/bin/ls -> busybox  -- 符号链接
/bin/cp -> busybox  -- 符号链接
/bin/mv -> busybox  -- 符号链接
...
总大小：约 1-2 MB
```

---

## 2. Busybox 架构原理

### 2.1 多重调用机制

Busybox 支持两种调用方式：

**方式一：通过符号链接**

```bash
# 创建符号链接
ln -s busybox ls
ln -s busybox cp
ln -s busybox cat

# 执行
./ls -la        # 实际执行 busybox ls -la
./cp file1 file2  # 实际执行 busybox cp file1 file2
```

**方式二：直接调用**

```bash
# 直接调用 busybox
./busybox ls -la
./busybox cp file1 file2
```

### 2.2 命令识别原理

```c
/* busybox 主函数原理 */
int main(int argc, char **argv)
{
    char *applet_name;
    
    /* 1. 获取程序名（可能是符号链接名） */
    applet_name = basename(argv[0]);
    
    /* 2. 查找对应的命令实现 */
    for (i = 0; i < NUM_APPLETS; i++) {
        if (strcmp(applets[i].name, applet_name) == 0) {
            /* 3. 执行对应命令 */
            return applets[i].main(argc, argv);
        }
    }
    
    /* 4. 如果是 "busybox" 本身，检查参数 */
    if (strcmp(applet_name, "busybox") == 0) {
        if (argc > 1) {
            /* busybox ls -la 格式 */
            applet_name = argv[1];
            return find_and_run_applet(applet_name, argc - 1, argv + 1);
        }
    }
    
    fprintf(stderr, "applet not found\n");
    return 1;
}
```

### 2.3 命令表结构

```c
/* 命令表定义示例 */
struct applet {
    const char *name;      /* 命令名 */
    int (*main)(int, char **);  /* 主函数指针 */
    enum bb_install_loc_t install_loc;  /* 安装位置 */
};

/* 命令表 */
static const struct applet applets[] = {
    {"ls",      ls_main,      BB_DIR_BIN},
    {"cp",      cp_main,      BB_DIR_BIN},
    {"mv",      mv_main,      BB_DIR_BIN},
    {"cat",     cat_main,     BB_DIR_BIN},
    {"echo",    echo_main,    BB_DIR_BIN},
    {"mount",   mount_main,   BB_DIR_SBIN},
    {"ifconfig",ifconfig_main,BB_DIR_SBIN},
    {"init",    init_main,    BB_DIR_SBIN},
    ...
};
```

### 2.4 Busybox 目录结构

```
busybox 源码目录：
busybox-1.xx.x/
├── Makefile              # 主 Makefile
├── Config.in             # 配置选项
├── applets/              # 命令注册
│   ├── applets.c         # 命令表生成
│   └── individual.c      # 单独编译支持
├── archival/             # 压缩相关命令
│   ├── tar.c
│   ├── gzip.c
│   └── unzip.c
├── coreutils/            # 核心命令
│   ├── ls.c
│   ├── cp.c
│   ├── mv.c
│   └── cat.c
├── editors/              # 编辑器
│   ├── vi.c
│   └── sed.c
├── findutils/            # 查找命令
│   ├── find.c
│   └── grep.c
├── init/                 # init 相关
│   ├── init.c
│   └── halt.c
├── networking/           # 网络命令
│   ├── ifconfig.c
│   ├── route.c
│   └── ping.c
├── util-linux/           # Linux 工具
│   ├── mount.c
│   └── fdisk.c
└── include/              # 头文件
    └── busybox.h
```

---

## 3. Busybox 初始化机制

### 3.1 init 进程实现

Busybox 的 init 是嵌入式系统中最常用的 init 实现：

```c
/* busybox init 主函数 */
int init_main(int argc, char **argv)
{
    /* 1. 解析 inittab 配置 */
    parse_inittab();
    
    /* 2. 执行 sysinit 动作 */
    run_actions(SYSINIT);
    
    /* 3. 执行 wait 动作 */
    run_actions(WAIT);
    
    /* 4. 执行 once 动作 */
    run_actions(ONCE);
    
    /* 5. 主循环 */
    while (1) {
        /* 执行 respawn 动作 */
        run_actions(RESPAWN);
        
        /* 执行 askfirst 动作 */
        run_actions(ASKFIRST);
        
        /* 等待子进程退出 */
        wpid = wait(NULL);
        while (wpid > 0) {
            /* 检查是否需要重启 */
            for (a = init_action_list; a; a = a->next) {
                if (a->pid == wpid) {
                    a->pid = 0;
                    break;
                }
            }
            wpid = waitpid(-1, NULL, WNOHANG);
        }
        
        sleep(1);
    }
}
```

### 3.2 inittab 配置格式

```
# inittab 格式
# <id>:<runlevels>:<action>:<process>

# 动作类型：
# sysinit  - 系统初始化时执行，等待完成
# wait     - 等待执行完成
# once     - 只执行一次，不等待
# respawn  - 进程退出后重启
# askfirst - 类似 respawn，但需要按回车
# ctrlaltdel - Ctrl+Alt+Del 时执行
# shutdown - 关机时执行
# restart  - 重启时执行

# 示例配置：
::sysinit:/etc/init.d/rcS
::askfirst:-/bin/sh
tty1::askfirst:-/bin/sh
ttyS0::askfirst:-/bin/sh
::ctrlaltdel:/sbin/reboot
::shutdown:/bin/umount -a -r
```

### 3.3 init_action 结构

```c
/* init 动作结构 */
struct init_action {
    struct init_action *next;   /* 链表指针 */
    pid_t pid;                  /* 进程 ID */
    char command[256];          /* 要执行的命令 */
    char terminal[32];          /* 终端设备 */
    enum action_type action;    /* 动作类型 */
};

/* 动作类型枚举 */
enum action_type {
    SYSINIT,      /* 系统初始化 */
    WAIT,         /* 等待完成 */
    ONCE,         /* 执行一次 */
    RESPAWN,      /* 重启 */
    ASKFIRST,     /* 询问后启动 */
    CTRLALTDEL,   /* Ctrl+Alt+Del */
    SHUTDOWN,     /* 关机 */
    RESTART       /* 重启 */
};
```

### 3.4 run_actions 函数

```c
/* 执行指定类型的动作 */
static void run_actions(int action_type)
{
    struct init_action *a;
    
    for (a = init_action_list; a; a = a->next) {
        /* 跳过不匹配的类型 */
        if (a->action != action_type)
            continue;
        
        /* 跳过已在运行的进程 */
        if (a->pid != 0)
            continue;
        
        /* 创建新进程 */
        a->pid = fork();
        if (a->pid == 0) {
            /* 子进程 */
            if (a->terminal[0]) {
                /* 打开终端 */
                close(0);
                close(1);
                close(2);
                setsid();
                open(a->terminal, O_RDWR);
                dup(0);
                dup(0);
            }
            
            /* 执行命令 */
            if (a->command[0] == '-') {
                /* 带登录 shell */
                char *shell = a->command + 1;
                char *argv[2] = { shell, NULL };
                execvp(shell, argv);
            } else {
                system(a->command);
            }
            exit(0);
        }
        
        /* 父进程处理 */
        if (action_type == SYSINIT || action_type == WAIT) {
            /* 等待进程完成 */
            waitpid(a->pid, NULL, 0);
            a->pid = 0;
        }
        
        if (action_type == ONCE) {
            /* once 动作完成后清除 pid */
            a->pid = 0;
        }
    }
}
```

### 3.5 new_init_action 函数

```c
/* 创建新的 init 动作 */
void new_init_action(int action, const char *command, const char *term)
{
    struct init_action *new_action, *a;
    
    /* 分配新结构 */
    new_action = malloc(sizeof(struct init_action));
    if (!new_action)
        return;
    
    /* 初始化 */
    new_action->pid = 0;
    new_action->action = action;
    strncpy(new_action->command, command, 255);
    new_action->command[255] = '\0';
    strncpy(new_action->terminal, term, 31);
    new_action->terminal[31] = '\0';
    new_action->next = NULL;
    
    /* 添加到链表 */
    if (!init_action_list) {
        init_action_list = new_action;
    } else {
        a = init_action_list;
        while (a->next)
            a = a->next;
        a->next = new_action;
    }
}
```

### 3.6 初始化流程图

```
Busybox init 初始化流程：
+===================+
|   内核启动        |
|   execve("/sbin/init") |
+=========+=========+
          |
          v
+=========+=========+
|   init_main()     |
+=========+=========+
          |
          v
+=========+=========+
|   parse_inittab() |
|   解析 /etc/inittab|
+=========+=========+
          |
          v
+=========+=========+
|   run_actions(SYSINIT) |
|   执行系统初始化脚本 |
|   /etc/init.d/rcS  |
+=========+=========+
          |
          v
+=========+=========+
|   run_actions(WAIT)|
|   等待型动作       |
+=========+=========+
          |
          v
+=========+=========+
|   run_actions(ONCE)|
|   一次性动作       |
+=========+=========+
          |
          v
+=========+=========+
|   主循环          |
+=========+=========+
          |
    +-----+-----+
    |           |
    v           v
+-------+   +-------+
|respawn|   |askfirst|
| 动作  |   | 动作   |
+-------+   +-------+
    |           |
    v           v
+-------+   +-------+
| Shell |   | 登录  |
| 进程  |   | 提示  |
+-------+   +-------+
```

---

## 4. 嵌入式文件系统制作

### 4.1 最小文件系统结构

```
最小嵌入式根文件系统：
rootfs/
├── bin/                    # 用户命令
│   ├── busybox             # busybox 主程序
│   ├── sh -> busybox       # 符号链接
│   ├── ls -> busybox
│   ├── cat -> busybox
│   └── ...
├── sbin/                   # 系统命令
│   ├── init -> ../bin/busybox
│   ├── mount -> ../bin/busybox
│   ├── ifconfig -> ../bin/busybox
│   └── ...
├── etc/                    # 配置文件
│   ├── init.d/
│   │   └── rcS             # 启动脚本
│   ├── inittab             # init 配置
│   ├── fstab               # 挂载表
│   ├── passwd              # 用户信息
│   └── group               # 组信息
├── dev/                    # 设备节点
│   ├── console
│   ├── null
│   ├── tty0
│   └── ...
├── lib/                    # 共享库
│   ├── libc.so.6
│   ├── ld-linux.so.3
│   └── ...
├── proc/                   # proc 挂载点
├── sys/                    # sysfs 挂载点
├── tmp/                    # 临时文件
└── var/                    # 可变数据
    ├── log/
    └── run/
```

### 4.2 创建基础目录结构

```bash
#!/bin/bash

# 创建根文件系统目录
ROOTFS=rootfs

mkdir -p $ROOTFS/{bin,sbin,etc,dev,lib,proc,sys,tmp,var,var/log,var/run}
mkdir -p $ROOTFS/etc/init.d

echo "目录结构创建完成"
```

### 4.3 安装 Busybox

```bash
#!/bin/bash

ROOTFS=rootfs
BUSYBOX=busybox-1.36.0

# 方法一：使用 busybox 的安装功能
make -C $BUSYBOX CONFIG_PREFIX=$ROOTFS install

# 方法二：手动安装
cp $BUSYBOX/busybox $ROOTFS/bin/
cd $ROOTFS/bin

# 创建常用命令的符号链接
for cmd in sh ash ls cp mv rm cat echo mkdir rmdir mount umount \
           grep find sed awk vi ps kill sleep date df du free top \
           ifconfig route ping netstat telnet tftp; do
    ln -sf busybox $cmd
done

cd ../sbin
for cmd in init halt reboot poweroff getty mdev; do
    ln -sf ../bin/busybox $cmd
done
```

### 4.4 创建设备节点

```bash
#!/bin/bash

ROOTFS=rootfs

# 创建必要的设备节点
cd $ROOTFS/dev

# 控制台
sudo mknod console c 5 1

# 空设备
sudo mknod null c 1 3

# 零设备
sudo mknod zero c 1 5

# 随机设备
sudo mknod random c 1 8
sudo mknod urandom c 1 9

# 终端
sudo mknod tty c 5 0
sudo mknod tty0 c 4 0
sudo mknod tty1 c 4 1

# 设置权限
sudo chmod 666 console null zero tty*
```

### 4.5 创建配置文件

**创建 /etc/inittab：**

```bash
cat > $ROOTFS/etc/inittab << 'EOF'
# /etc/inittab
::sysinit:/etc/init.d/rcS
::askfirst:-/bin/sh
tty1::askfirst:-/bin/sh
ttyS0::askfirst:-/bin/sh
::ctrlaltdel:/sbin/reboot
::shutdown:/bin/umount -a -r
EOF
```

**创建 /etc/init.d/rcS：**

```bash
cat > $ROOTFS/etc/init.d/rcS << 'EOF'
#!/bin/sh

# 挂载虚拟文件系统
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null

# 如果没有 devtmpfs，使用 mdev
if [ ! -c /dev/console ]; then
    mount -t tmpfs tmpfs /dev
    mknod /dev/console c 5 1
    mknod /dev/null c 1 3
    echo /sbin/mdev > /proc/sys/kernel/hotplug
    mdev -s
fi

# 设置主机名
hostname MyDevice

# 配置网络（可选）
# ifconfig eth0 192.168.1.100 netmask 255.255.255.0 up
# route add default gw 192.168.1.1

echo "Welcome to Embedded Linux!"
EOF

chmod +x $ROOTFS/etc/init.d/rcS
```

**创建 /etc/fstab：**

```bash
cat > $ROOTFS/etc/fstab << 'EOF'
# device    mount   type    options     dump    fsck
proc        /proc   proc    defaults    0       0
sysfs       /sys    sysfs   defaults    0       0
devpts      /dev/pts devpts defaults    0       0
tmpfs       /tmp    tmpfs   defaults    0       0
EOF
```

**创建 /etc/passwd 和 /etc/group：**

```bash
cat > $ROOTFS/etc/passwd << 'EOF'
root:x:0:0:root:/root:/bin/sh
nobody:x:65534:65534:nobody:/nonexistent:/bin/false
EOF

cat > $ROOTFS/etc/group << 'EOF'
root:x:0:
nobody:x:65534:
EOF
```

### 4.6 安装共享库

```bash
#!/bin/bash

ROOTFS=rootfs

# 查找需要的库
# 使用 ldd 查看 busybox 依赖
ldd $ROOTFS/bin/busybox

# 复制所需的库
# 假设使用 arm-linux-gnueabihf 交叉编译器
CROSS_LIB=/usr/arm-linux-gnueabihf/lib

# 复制 libc
cp $CROSS_LIB/libc.so.6 $ROOTFS/lib/
cp $CROSS_LIB/libm.so.6 $ROOTFS/lib/
cp $CROSS_LIB/libpthread.so.0 $ROOTFS/lib/
cp $CROSS_LIB/ld-linux-armhf.so.3 $ROOTFS/lib/

# 创建 ld-linux 链接
cd $ROOTFS/lib
ln -sf ld-linux-armhf.so.3 ld-linux.so.3
```

---

## 5. 文件系统镜像格式

### 5.1 常见镜像格式对比

| 格式 | 特点 | 适用场景 |
|------|------|---------|
| **ext2/3/4** | 标准Linux文件系统，可读写 | SD卡、硬盘分区 |
| **JFFS2** | 压缩、磨损均衡，只读挂载后可写 | NOR Flash |
| **YAFFS2** | 专为NAND Flash设计 | NAND Flash |
| **UBIFS** | UBI层上的文件系统，性能好 | 大容量NAND |
| **SquashFS** | 只读压缩文件系统 | 只读根文件系统 |
| **CramFS** | 简单压缩只读文件系统 | 小容量系统 |
| **initramfs** | 压缩的cpio归档，加载到内存 | 启动用临时根FS |

### 5.2 ext4 镜像制作

```bash
#!/bin/bash

ROOTFS=rootfs
IMAGE=rootfs.ext4
SIZE=64M

# 创建空镜像文件
dd if=/dev/zero of=$IMAGE bs=$SIZE count=1

# 格式化为 ext4
mkfs.ext4 $IMAGE

# 挂载并复制文件
mkdir -p mnt
sudo mount -o loop $IMAGE mnt
sudo cp -a $ROOTFS/* mnt/
sudo umount mnt
rmdir mnt

echo "ext4 镜像制作完成: $IMAGE"
```

### 5.3 SquashFS 镜像制作

```bash
#!/bin/bash

ROOTFS=rootfs
IMAGE=rootfs.squashfs

# 安装 squashfs-tools
# sudo apt-get install squashfs-tools

# 创建 squashfs 镜像
mksquashfs $ROOTFS $IMAGE -comp xz -noappend

echo "SquashFS 镜像制作完成: $IMAGE"
```

### 5.4 JFFS2 镜像制作

```bash
#!/bin/bash

ROOTFS=rootfs
IMAGE=rootfs.jffs2

# 安装 mtd-utils
# sudo apt-get install mtd-utils

# 创建 JFFS2 镜像
# 假设 Flash 页大小为 4KB
mkfs.jffs2 -r $ROOTFS -o $IMAGE -e 0x4000 --pad=0x1000000 -s 0x1000 -n

echo "JFFS2 镜像制作完成: $IMAGE"
```

### 5.5 UBIFS 镜像制作

```bash
#!/bin/bash

ROOTFS=rootfs
IMAGE=rootfs.ubi

# 安装 mtd-utils
# sudo apt-get install mtd-utils

# UBIFS 参数（根据实际 Flash 调整）
PEB_SIZE=131072    # 物理擦除块大小 (128KB)
LEB_SIZE=129024    # 逻辑擦除块大小
MAX_LEB_CNT=2048   # 最大逻辑块数

# 创建 UBIFS 镜像
mkfs.ubifs -r $ROOTFS -o rootfs.ubifs -m 2048 -e $LEB_SIZE -c $MAX_LEB_CNT

# 创建 UBI 镜像
ubinize -o $IMAGE -m 2048 -p $PEB_SIZE ubinize.cfg

echo "UBIFS 镜像制作完成: $IMAGE"
```

**ubinize.cfg 配置文件：**

```ini
[rootfs]
mode=ubi
image=rootfs.ubifs
vol_id=0
vol_type=dynamic
vol_name=rootfs
vol_flags=autoresize
```

### 5.6 initramfs (cpio) 制作

```bash
#!/bin/bash

ROOTFS=rootfs
IMAGE=rootfs.cpio.gz

# 进入根文件系统目录
cd $ROOTFS

# 创建 cpio 归档并压缩
find . | cpio -o -H newc | gzip > ../$IMAGE

cd ..

echo "initramfs 镜像制作完成: $IMAGE"
```

### 5.7 镜像格式选择指南

```
                    +-------------------+
                    |   存储介质类型    |
                    +---------+---------+
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
    +-----+-----+       +-----+-----+       +-----+-----+
    |   SD卡    |       | NOR Flash |       | NAND Flash|
    |   硬盘    |       | 小容量    |       | 大容量    |
    +-----+-----+       +-----+-----+       +-----+-----+
          |                   |                   |
          v                   v                   v
    +-----+-----+       +-----+-----+       +-----+-----+
    | ext4      |       | JFFS2     |       | UBIFS     |
    | (可读写)  |       | (压缩)    |       | (高性能)  |
    +-----------+       +-----------+       +-----------+
          |
          v
    +-----+-----+
    | SquashFS  |
    | (只读压缩)|
    +-----------+
```

---

## 6. 完整构建实例

### 6.1 构建脚本

```bash
#!/bin/bash

#========================================
# 嵌入式根文件系统完整构建脚本
#========================================

set -e

# 配置变量
ROOTFS=rootfs
BUSYBOX_DIR=busybox-1.36.0
CROSS_COMPILE=arm-linux-gnueabihf-
CROSS_LIB=/usr/arm-linux-gnueabihf/lib
IMAGE_TYPE=squashfs

echo "=== 开始构建根文件系统 ==="

# 1. 创建目录结构
echo "[1/6] 创建目录结构..."
rm -rf $ROOTFS
mkdir -p $ROOTFS/{bin,sbin,etc,dev,lib,proc,sys,tmp,var,var/log,var/run,usr,usr/bin,usr/sbin,root}
mkdir -p $ROOTFS/etc/init.d

# 2. 编译并安装 Busybox
echo "[2/6] 安装 Busybox..."
if [ ! -f $BUSYBOX_DIR/busybox ]; then
    echo "请先编译 Busybox"
    exit 1
fi

cp $BUSYBOX_DIR/busybox $ROOTFS/bin/
chmod +x $ROOTFS/bin/busybox

# 创建符号链接
cd $ROOTFS/bin
for cmd in sh ash ls cp mv rm cat echo mkdir rmdir touch ln chmod chown \
           grep find sed awk head tail wc sort uniq cut tr vi more less \
           mount umount df du free ps kill sleep date hostname uname id whoami \
           dmesg clear reset env printenv setfont loadfont; do
    ln -sf busybox $cmd
done

cd ../sbin
for cmd in init halt reboot poweroff getty mdev ifconfig route ip \
           fdisk mkfs.ext4 fsck; do
    ln -sf ../bin/busybox $cmd
done

cd ../usr/bin
for cmd in file strings xxd hexdump; do
    ln -sf ../../bin/busybox $cmd
done

cd ../../..

# 3. 创建设备节点
echo "[3/6] 创建设备节点..."
cd $ROOTFS/dev
sudo mknod console c 5 1
sudo mknod null c 1 3
sudo mknod zero c 1 5
sudo mknod random c 1 8
sudo mknod urandom c 1 9
sudo mknod tty c 5 0
sudo mknod tty0 c 4 0
sudo mknod tty1 c 4 1
sudo chmod 666 console null zero tty*
cd ../..

# 4. 创建配置文件
echo "[4/6] 创建配置文件..."

# inittab
cat > $ROOTFS/etc/inittab << 'EOF'
::sysinit:/etc/init.d/rcS
::askfirst:-/bin/sh
tty1::askfirst:-/bin/sh
ttyS0::askfirst:-/bin/sh
::ctrlaltdel:/sbin/reboot
::shutdown:/bin/umount -a -r
EOF

# rcS 启动脚本
cat > $ROOTFS/etc/init.d/rcS << 'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev 2>/dev/null || {
    mount -t tmpfs tmpfs /dev
    mknod /dev/console c 5 1
    mknod /dev/null c 1 3
    echo /sbin/mdev > /proc/sys/kernel/hotplug
    mdev -s
}
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts
hostname MyEmbeddedDevice
echo "Welcome to Embedded Linux!"
echo "Kernel: $(uname -r)"
EOF
chmod +x $ROOTFS/etc/init.d/rcS

# fstab
cat > $ROOTFS/etc/fstab << 'EOF'
proc    /proc   proc    defaults    0   0
sysfs   /sys    sysfs   defaults    0   0
devpts  /dev/pts devpts defaults    0   0
tmpfs   /tmp    tmpfs   defaults    0   0
EOF

# passwd
cat > $ROOTFS/etc/passwd << 'EOF'
root:x:0:0:root:/root:/bin/sh
EOF

# group
cat > $ROOTFS/etc/group << 'EOF'
root:x:0:
EOF

# profile
cat > $ROOTFS/etc/profile << 'EOF'
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
export HOME=/root
export PS1='[\u@\h \W]\$ '
EOF

# 5. 安装共享库
echo "[5/6] 安装共享库..."
cp $CROSS_LIB/libc.so.6 $ROOTFS/lib/
cp $CROSS_LIB/libm.so.6 $ROOTFS/lib/
cp $CROSS_LIB/libpthread.so.0 $ROOTFS/lib/
cp $CROSS_LIB/libdl.so.2 $ROOTFS/lib/
cp $CROSS_LIB/ld-linux-armhf.so.3 $ROOTFS/lib/
cd $ROOTFS/lib && ln -sf ld-linux-armhf.so.3 ld-linux.so.3 && cd ../..

# 6. 制作镜像
echo "[6/6] 制作文件系统镜像..."
case $IMAGE_TYPE in
    squashfs)
        mksquashfs $ROOTFS rootfs.squashfs -comp xz -noappend
        echo "镜像: rootfs.squashfs"
        ;;
    ext4)
        dd if=/dev/zero of=rootfs.ext4 bs=64M count=1
        mkfs.ext4 rootfs.ext4
        mkdir -p mnt && sudo mount -o loop rootfs.ext4 mnt
        sudo cp -a $ROOTFS/* mnt/
        sudo umount mnt && rmdir mnt
        echo "镜像: rootfs.ext4"
        ;;
    cpio)
        cd $ROOTFS && find . | cpio -o -H newc | gzip > ../rootfs.cpio.gz && cd ..
        echo "镜像: rootfs.cpio.gz"
        ;;
esac

echo "=== 构建完成 ==="
echo "根文件系统目录: $ROOTFS"
```

### 6.2 Busybox 编译配置

```bash
# 解压 Busybox
tar xjf busybox-1.36.0.tar.bz2
cd busybox-1.36.0

# 配置（选择静态编译以简化部署）
make defconfig
make menuconfig

# 重要配置选项：
# Settings --->
#   Build Options --->
#     [*] Build static binary (no shared libs)
#     (arm-linux-gnueabihf-) Cross compiler prefix
#
#   Installation Options --->
#     (./_install) Destination path for 'make install'

# 编译
make -j$(nproc)

# 安装到指定目录
make CONFIG_PREFIX=../rootfs install
```

### 6.3 完整构建流程图

```
+===========================================================================+
|                        嵌入式文件系统构建流程                             |
+===========================================================================+

+-------------------+     +-------------------+     +-------------------+
|   准备工具链      |---->|   编译 Busybox    |---->|   创建目录结构    |
|   交叉编译器      |     |   make menuconfig |     |   mkdir -p ...    |
+-------------------+     +-------------------+     +-------------------+
                                                           |
                                                           v
+-------------------+     +-------------------+     +-------------------+
|   制作镜像        |<----|   安装共享库      |<----|   创建配置文件    |
|   squashfs/ext4   |     |   libc, libm...   |     |   inittab, rcS    |
+-------------------+     +-------------------+     +-------------------+
         |
         v
+-------------------+
|   部署到设备      |
|   烧录到 Flash    |
|   或放入 SD 卡    |
+-------------------+
```

---

## 7. 总结

### 7.1 Busybox 核心要点

| 要点 | 说明 |
|------|------|
| **单一二进制** | 所有命令集成在一个可执行文件中 |
| **符号链接** | 通过链接名区分不同命令 |
| **init 功能** | 提供 init 进程实现，支持 inittab |
| **高度可配置** | 可裁剪不需要的命令 |

### 7.2 文件系统制作要点

| 步骤 | 内容 |
|------|------|
| 1. 创建目录 | bin, sbin, etc, dev, lib, proc, sys |
| 2. 安装 Busybox | 复制二进制文件，创建符号链接 |
| 3. 创建设备节点 | console, null, tty 等 |
| 4. 创建配置文件 | inittab, rcS, fstab, passwd |
| 5. 安装共享库 | libc, ld-linux 等 |
| 6. 制作镜像 | squashfs, ext4, jffs2, ubifs 等 |

### 7.3 常见问题解决

| 问题 | 解决方案 |
|------|---------|
| 无法执行程序 | 检查库依赖，使用 ldd |
| 无法打开控制台 | 检查 /dev/console 是否存在 |
| 启动脚本不执行 | 检查 rcS 权限是否为可执行 |
| 挂载失败 | 检查内核是否支持对应文件系统 |
| 找不到命令 | 检查 PATH 环境变量 |