# Linux 0.11 驱动开发详解

## 目录

1. **`驱动架构概述`**
2. **`设备分类`**
3. **`块设备驱动开发`**
4. **`字符设备驱动开发`**
5. **`中断处理机制`**
6. **`驱动注册流程`**
7. **`完整驱动开发示例`**

---

## 1. 驱动架构概述

### 1.1 Linux 0.11 驱动架构

```
Linux 0.11 驱动架构：
+===========================================================================+
|                                                                           |
|   用户空间                                                                |
|   +------------------+                                                    |
|   | 应用程序         |  open(), read(), write(), close()                 |
|   +--------+---------+                                                    |
|            | 系统调用                                                    |
|            v                                                              |
|   +------------------+                                                    |
|   | VFS/系统调用层   |  sys_read(), sys_write()                          |
|   +--------+---------+                                                    |
|            |                                                              |
|   +--------+--------+                                                     |
|   |                 |                                                     |
|   v                 v                                                     |
|   +--------+   +--------+                                                 |
|   | 字符   |   | 块设备 |                                                 |
|   | 设备   |   | 驱动   |                                                 |
|   | 驱动   |   |        |                                                 |
|   +---+----+   +---+----+                                                 |
|       |            |                                                      |
|       v            v                                                      |
|   +--------+   +--------+                                                 |
|   | TTY    |   | 硬盘   |                                                 |
|   | 控制台 |   | 软驱   |                                                 |
|   | 串口   |   | RAM盘  |                                                 |
|   +--------+   +--------+                                                 |
|       |            |                                                      |
|       v            v                                                      |
|   +------------------+                                                    |
|   | 硬件设备         |                                                    |
|   +------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 1.2 驱动文件位置

```
Linux 0.11 驱动源码位置：
+===========================================================================+
|                                                                           |
|   kernel/blk_drv/           # 块设备驱动                                  |
|   ├── blk.h                 # 块设备通用头文件                            |
|   ├── ll_rw_blk.c           # 底层读写块设备                              |
|   ├── hd.c                  # 硬盘驱动                                    |
|   ├── floppy.c              # 软驱驱动                                    |
|   └── ramdisk.c             # RAM 盘驱动                                  |
|                                                                           |
|   kernel/chr_drv/           # 字符设备驱动                                |
|   ├── tty_io.c              # TTY 输入输出                                |
|   ├── console.c             # 控制台驱动                                  |
|   ├── keyboard.S            # 键盘驱动                                    |
|   ├── serial.c              # 串口驱动                                    |
|   └── rs_io.s               # 串口 I/O                                    |
|                                                                           |
|   fs/                       # 文件系统层                                  |
|   ├── char_dev.c            # 字符设备分发                                |
|   └── block_dev.c           # 块设备读写                                  |
|                                                                           |
+===========================================================================+
```

---

## 2. 设备分类

### 2.1 字符设备与块设备

| 类型 | 特点 | 示例 | 访问方式 |
|------|------|------|---------|
| **字符设备** | 按字节流访问 | TTY、串口、内存 | 顺序访问 |
| **块设备** | 按块访问 | 硬盘、软驱、RAM盘 | 随机访问 |

### 2.2 设备号

```c
/* 设备号 = 主设备号 + 次设备号 */
#define MAJOR(a) (((unsigned)(a))>>8)   /* 主设备号：驱动类型 */
#define MINOR(a) ((a)&0xff)             /* 次设备号：具体设备 */

/* 主设备号定义（来自 fs.h）*/
0 - unused (nodev)
1 - /dev/mem    (内存设备)
2 - /dev/fd     (软驱)
3 - /dev/hd     (硬盘)
4 - /dev/ttyx   (虚拟终端)
5 - /dev/tty    (控制终端)
6 - /dev/lp     (打印机)
7 - unnamed pipes (管道)
```

### 2.3 设备号示例

```
设备号示例：
+===========================================================================+
|                                                                           |
|   设备文件        主设备号    次设备号    设备号                           |
|   /dev/hd1       3           1           0x0301                          |
|   /dev/hd2       3           2           0x0302                          |
|   /dev/hd6       3           6           0x0306                          |
|   /dev/fd0       2           0           0x0200                          |
|   /dev/tty0      4           0           0x0400                          |
|   /dev/console   4           0           0x0400                          |
|   /dev/mem       1           0           0x0100                          |
|                                                                           |
+===========================================================================+
```

---

## 3. 块设备驱动开发

### 3.1 块设备驱动架构

```
块设备驱动架构：
+===========================================================================+
|                                                                           |
|   sys_read()/sys_write()                                                  |
|         |                                                                 |
|         v                                                                 |
|   +------------------+                                                    |
|   | block_read()     |  fs/block_dev.c                                   |
|   | block_write()    |                                                    |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | bread()          |  fs/buffer.c                                      |
|   | getblk()         |  缓冲区管理                                       |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | ll_rw_block()    |  kernel/blk_drv/ll_rw_blk.c                       |
|   | make_request()   |  创建请求                                         |
|   | add_request()    |  添加到请求队列                                   |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | blk_dev[]        |  块设备表                                         |
|   | .request_fn      |  请求处理函数指针                                 |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | do_hd_request()  |  具体驱动的请求处理函数                           |
|   | do_fd_request()  |                                                    |
|   | do_rd_request()  |                                                    |
|   +------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 3.2 块设备表

定义在 **`kernel/blk_drv/ll_rw_blk.c`**：

```c
#define NR_BLK_DEV 7

struct blk_dev_struct {
    void (*request_fn)(void);       /* 请求处理函数 */
    struct request * current_request; /* 当前请求 */
};

struct blk_dev_struct blk_dev[NR_BLK_DEV] = {
    { NULL, NULL },     /* 0 - no_dev */
    { NULL, NULL },     /* 1 - dev mem (ramdisk) */
    { NULL, NULL },     /* 2 - dev fd (floppy) */
    { NULL, NULL },     /* 3 - dev hd (harddisk) */
    { NULL, NULL },     /* 4 - dev ttyx */
    { NULL, NULL },     /* 5 - dev tty */
    { NULL, NULL }      /* 6 - dev lp */
};
```

### 3.3 块设备请求结构

定义在 **`kernel/blk_drv/blk.h`**：

```c
struct request {
    int dev;                /* 设备号，-1 表示无请求 */
    int cmd;                /* READ 或 WRITE */
    int errors;             /* 错误计数 */
    unsigned long sector;   /* 起始扇区号 */
    unsigned long nr_sectors; /* 扇区数 */
    char * buffer;          /* 数据缓冲区 */
    struct task_struct * waiting; /* 等待进程 */
    struct buffer_head * bh; /* 缓冲区头 */
    struct request * next;  /* 下一个请求 */
};
```

### 3.4 硬盘驱动实现

定义在 **`kernel/blk_drv/hd.c`**：

```c
#define MAJOR_NR 3
#include "blk.h"

/* 硬盘初始化 - 注册驱动 */
void hd_init(void)
{
    /* 1. 注册请求处理函数 */
    blk_dev[MAJOR_NR].request_fn = DEVICE_REQUEST;
    
    /* 2. 设置中断门 */
    set_intr_gate(0x2E, &hd_interrupt);
    
    /* 3. 开启中断 */
    outb_p(inb_p(0x21) & 0xfb, 0x21);
    outb(inb_p(0xA1) & 0xbf, 0xA1);
}

/* 请求处理函数 */
void do_hd_request(void)
{
    int i, r;
    unsigned int block, dev;
    unsigned int sec, head, cyl;
    unsigned int nsect;

    INIT_REQUEST;  /* 检查请求有效性 */
    
    dev = MINOR(CURRENT->dev);
    block = CURRENT->sector;
    
    /* 计算硬盘参数 */
    block += hd[dev].start_sect;
    dev /= 5;
    __asm__("divl %4":"=a" (block),"=d" (sec):"0" (block),"1" (0),
        "r" (hd_info[dev].sect));
    __asm__("divl %4":"=a" (cyl),"=d" (head):"0" (block),"1" (0),
        "r" (hd_info[dev].head));
    sec++;
    nsect = CURRENT->nr_sectors;

    /* 处理读写请求 */
    if (CURRENT->cmd == WRITE) {
        hd_out(dev, nsect, sec, head, cyl, WIN_WRITE, &write_intr);
        port_write(HD_DATA, CURRENT->buffer, 256);
    } else if (CURRENT->cmd == READ) {
        hd_out(dev, nsect, sec, head, cyl, WIN_READ, &read_intr);
    }
}

/* 读中断处理 */
static void read_intr(void)
{
    if (win_result()) {
        bad_rw_intr();
        do_hd_request();
        return;
    }
    port_read(HD_DATA, CURRENT->buffer, 256);
    CURRENT->errors = 0;
    CURRENT->buffer += 512;
    CURRENT->sector++;
    if (--CURRENT->nr_sectors) {
        do_hd = &read_intr;
        return;
    }
    end_request(1);
    do_hd_request();
}
```

### 3.5 RAM 盘驱动实现

定义在 **`kernel/blk_drv/ramdisk.c`**：

```c
#define MAJOR_NR 1
#include "blk.h"

char *rd_start;    /* RAM 盘起始地址 */
int rd_length = 0; /* RAM 盘长度 */

/* 请求处理函数 */
void do_rd_request(void)
{
    int len;
    char *addr;

    INIT_REQUEST;
    
    addr = rd_start + (CURRENT->sector << 9);
    len = CURRENT->nr_sectors << 9;
    
    if ((MINOR(CURRENT->dev) != 1) || 
        (addr + len > rd_start + rd_length)) {
        end_request(0);
        goto repeat;
    }
    
    if (CURRENT->cmd == WRITE) {
        memcpy(addr, CURRENT->buffer, len);
    } else if (CURRENT->cmd == READ) {
        memcpy(CURRENT->buffer, addr, len);
    }
    
    end_request(1);
    goto repeat;
}

/* 初始化函数 */
long rd_init(long mem_start, int length)
{
    blk_dev[MAJOR_NR].request_fn = DEVICE_REQUEST;
    rd_start = (char *) mem_start;
    rd_length = length;
    return length;
}
```

---

## 4. 字符设备驱动开发

### 4.1 字符设备驱动架构

```
字符设备驱动架构：
+===========================================================================+
|                                                                           |
|   sys_read()/sys_write()                                                  |
|         |                                                                 |
|         v                                                                 |
|   +------------------+                                                    |
|   | S_ISCHR() ?      |  检查是否为字符设备                                |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | rw_char()        |  fs/char_dev.c                                    |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | crw_table[]      |  字符设备函数表                                    |
|   | [MAJOR(dev)]     |  根据主设备号查找                                 |
|   +--------+---------+                                                    |
|            |                                                              |
|            v                                                              |
|   +------------------+                                                    |
|   | rw_tty()         |  TTY 设备                                         |
|   | rw_ttyx()        |  虚拟终端                                         |
|   | rw_memory()      |  内存设备                                         |
|   | rw_port()        |  端口设备                                         |
|   +------------------+                                                    |
|                                                                           |
+===========================================================================+
```

### 4.2 字符设备函数表

定义在 **`fs/char_dev.c`**：

```c
typedef (*crw_ptr)(int rw, unsigned minor, char * buf, int count, off_t * pos);

/* 字符设备函数表 */
static crw_ptr crw_table[] = {
    NULL,       /* 0 - nodev */
    rw_memory,  /* 1 - /dev/mem etc */
    NULL,       /* 2 - /dev/fd */
    NULL,       /* 3 - /dev/hd */
    rw_ttyx,    /* 4 - /dev/ttyx */
    rw_tty,     /* 5 - /dev/tty */
    NULL,       /* 6 - /dev/lp */
    NULL        /* 7 - unnamed pipes */
};

/* 字符设备读写分发 */
int rw_char(int rw, int dev, char * buf, int count, off_t * pos)
{
    crw_ptr call_addr;

    if (MAJOR(dev) >= NRDEVS)
        return -ENODEV;
    if (!(call_addr = crw_table[MAJOR(dev)]))
        return -ENODEV;
    return call_addr(rw, MINOR(dev), buf, count, pos);
}
```

### 4.3 TTY 设备实现

```c
extern int tty_read(unsigned minor, char * buf, int count);
extern int tty_write(unsigned minor, char * buf, int count);

static int rw_ttyx(int rw, unsigned minor, char * buf, int count, off_t * pos)
{
    return ((rw == READ) ? tty_read(minor, buf, count) :
                           tty_write(minor, buf, count));
}

static int rw_tty(int rw, unsigned minor, char * buf, int count, off_t * pos)
{
    if (current->tty < 0)
        return -EPERM;
    return rw_ttyx(rw, current->tty, buf, count, pos);
}
```

### 4.4 内存设备实现

```c
static int rw_memory(int rw, unsigned minor, char * buf, int count, off_t * pos)
{
    switch(minor) {
        case 0:
            return rw_ram(rw, buf, count, pos);
        case 1:
            return rw_mem(rw, buf, count, pos);
        case 2:
            return rw_kmem(rw, buf, count, pos);
        case 3:
            return (rw == READ) ? 0 : count;  /* /dev/null */
        case 4:
            return rw_port(rw, buf, count, pos);
        default:
            return -EIO;
    }
}

/* 端口读写 */
static int rw_port(int rw, char * buf, int count, off_t * pos)
{
    int i = *pos;

    while (count-- > 0 && i < 65536) {
        if (rw == READ)
            put_fs_byte(inb(i), buf++);
        else
            outb(get_fs_byte(buf++), i);
        i++;
    }
    i -= *pos;
    *pos += i;
    return i;
}
```

---

## 5. 中断处理机制

### 5.1 中断处理流程

```
硬盘中断处理流程：
+===========================================================================+
|                                                                           |
|   1. 硬盘操作完成，触发中断                                               |
|      +------------------+                                                 |
|      | IRQ14            |  硬盘中断请求                                   |
|      +------------------+                                                 |
|            |                                                              |
|            v                                                              |
|   2. CPU 响应中断                                                         |
|      +------------------+                                                 |
|      | 中断门 0x2E     |  hd_interrupt                                    |
|      +------------------+                                                 |
|            |                                                              |
|            v                                                              |
|   3. 执行中断处理函数                                                     |
|      +------------------+                                                 |
|      | hd_interrupt    |  保存上下文                                      |
|      +------------------+                                                 |
|            |                                                              |
|            v                                                              |
|   4. 调用具体处理函数                                                     |
|      +------------------+                                                 |
|      | do_hd           |  read_intr / write_intr                         |
|      +------------------+                                                 |
|            |                                                              |
|            v                                                              |
|   5. 读取/写入数据                                                        |
|      +------------------+                                                 |
|      | port_read()     |  从硬盘端口读取数据                              |
|      | port_write()    |  向硬盘端口写入数据                              |
|      +------------------+                                                 |
|            |                                                              |
|            v                                                              |
|   6. 结束请求                                                             |
|      +------------------+                                                 |
|      | end_request()   |  唤醒等待进程                                    |
|      +------------------+                                                 |
|            |                                                              |
|            v                                                              |
|   7. 处理下一个请求                                                       |
|      +------------------+                                                 |
|      | do_hd_request() |  处理队列中的下一个请求                          |
|      +------------------+                                                 |
|                                                                           |
+===========================================================================+
```

### 5.2 中断注册

```c
/* 硬盘驱动初始化 */
void hd_init(void)
{
    /* 注册请求处理函数 */
    blk_dev[MAJOR_NR].request_fn = DEVICE_REQUEST;
    
    /* 设置中断门 */
    set_intr_gate(0x2E, &hd_interrupt);
    
    /* 开启 IRQ14 */
    outb_p(inb_p(0x21) & 0xfb, 0x21);  /* 主 8259A */
    outb(inb_p(0xA1) & 0xbf, 0xA1);    /* 从 8259A */
}
```

### 5.3 键盘中断处理

定义在 **`kernel/chr_drv/keyboard.S`**：

```asm
/* 键盘中断入口 */
keyboard_interrupt:
    /* 保存寄存器 */
    pushl %eax
    pushl %ebx
    pushl %ecx
    pushl %edx
    
    /* 读取键盘扫描码 */
    inb $0x60, %al
    
    /* 处理扫描码 */
    /* ... */
    
    /* 发送 EOI */
    movb $0x20, %al
    outb %al, $0x20
    
    /* 恢复寄存器 */
    popl %edx
    popl %ecx
    popl %ebx
    popl %eax
    
    /* 返回 */
    iret
```

---

## 6. 驱动注册流程

### 6.1 块设备驱动注册

```
块设备驱动注册步骤：
+===========================================================================+
|                                                                           |
|   1. 定义主设备号                                                         |
|      #define MAJOR_NR 3                                                   |
|                                                                           |
|   2. 实现请求处理函数                                                     |
|      void do_hd_request(void) { ... }                                     |
|                                                                           |
|   3. 在初始化函数中注册                                                   |
|      void hd_init(void) {                                                 |
|          blk_dev[MAJOR_NR].request_fn = DEVICE_REQUEST;                   |
|          set_intr_gate(0x2E, &hd_interrupt);                              |
|      }                                                                    |
|                                                                           |
|   4. 在 main.c 中调用初始化函数                                           |
|      hd_init();                                                           |
|                                                                           |
+===========================================================================+
```

### 6.2 字符设备驱动注册

```
字符设备驱动注册步骤：
+===========================================================================+
|                                                                           |
|   1. 实现读写函数                                                         |
|      static int rw_mydev(int rw, unsigned minor,                          |
|                          char * buf, int count, off_t * pos) { ... }      |
|                                                                           |
|   2. 在 crw_table 中添加                                                  |
|      static crw_ptr crw_table[] = {                                       |
|          NULL,                                                            |
|          rw_memory,                                                       |
|          NULL,                                                            |
|          NULL,                                                            |
|          rw_ttyx,                                                         |
|          rw_tty,                                                          |
|          rw_mydev,    /* 新增 */                                          |
|          NULL                                                            |
|      };                                                                   |
|                                                                           |
|   3. 创建设备文件                                                         |
|      mknod /dev/mydev c 6 0                                               |
|                                                                           |
+===========================================================================+
```

---

## 7. 完整驱动开发示例

### 7.1 示例：简单的字符设备驱动

```c
/*
 *  mydev.c - 简单字符设备驱动示例
 */

#include <linux/sched.h>
#include <linux/kernel.h>
#include <asm/segment.h>
#include <asm/io.h>

#define MYDEV_MAJOR 6

/* 设备私有数据 */
static char mydev_buffer[1024];
static int mydev_count = 0;

/* 读函数 */
static int rw_mydev_read(unsigned minor, char * buf, int count, off_t * pos)
{
    int i;
    
    if (*pos >= sizeof(mydev_buffer))
        return 0;
    
    if (*pos + count > sizeof(mydev_buffer))
        count = sizeof(mydev_buffer) - *pos;
    
    for (i = 0; i < count; i++) {
        put_fs_byte(mydev_buffer[*pos + i], buf + i);
    }
    
    *pos += count;
    return count;
}

/* 写函数 */
static int rw_mydev_write(unsigned minor, char * buf, int count, off_t * pos)
{
    int i;
    
    if (*pos >= sizeof(mydev_buffer))
        return -ENOSPC;
    
    if (*pos + count > sizeof(mydev_buffer))
        count = sizeof(mydev_buffer) - *pos;
    
    for (i = 0; i < count; i++) {
        mydev_buffer[*pos + i] = get_fs_byte(buf + i);
    }
    
    *pos += count;
    mydev_count = *pos;
    return count;
}

/* 读写分发 */
static int rw_mydev(int rw, unsigned minor, char * buf, int count, off_t * pos)
{
    if (rw == READ)
        return rw_mydev_read(minor, buf, count, pos);
    else
        return rw_mydev_write(minor, buf, count, pos);
}

/* 初始化函数 */
void mydev_init(void)
{
    /* 清空缓冲区 */
    memset(mydev_buffer, 0, sizeof(mydev_buffer));
    
    /* 注意：需要在 char_dev.c 的 crw_table 中添加 rw_mydev */
    printk("mydev initialized\n");
}
```

### 7.2 示例：简单的块设备驱动

```c
/*
 *  myblk.c - 简单块设备驱动示例
 */

#include <linux/sched.h>
#include <linux/kernel.h>
#include <linux/fs.h>
#include <asm/system.h>

#define MAJOR_NR 7
#include "blk.h"

#define MYBLK_SIZE (1024 * 1024)  /* 1MB */

static char myblk_data[MYBLK_SIZE];

/* 请求处理函数 */
void do_myblk_request(void)
{
    int len;
    char *addr;

repeat:
    INIT_REQUEST;
    
    addr = myblk_data + (CURRENT->sector << 9);
    len = CURRENT->nr_sectors << 9;
    
    if (addr + len > myblk_data + MYBLK_SIZE) {
        end_request(0);
        goto repeat;
    }
    
    if (CURRENT->cmd == READ) {
        memcpy(CURRENT->buffer, addr, len);
    } else if (CURRENT->cmd == WRITE) {
        memcpy(addr, CURRENT->buffer, len);
    }
    
    end_request(1);
    goto repeat;
}

/* 初始化函数 */
void myblk_init(void)
{
    /* 注册请求处理函数 */
    blk_dev[MAJOR_NR].request_fn = DEVICE_REQUEST;
    
    /* 清空数据区 */
    memset(myblk_data, 0, MYBLK_SIZE);
    
    printk("myblk initialized, size = %d bytes\n", MYBLK_SIZE);
}
```

### 7.3 驱动开发步骤总结

```
驱动开发步骤：
+===========================================================================+
|                                                                           |
|   块设备驱动：                                                            |
|   +------------------+                                                    |
|   | 1. 定义 MAJOR_NR |                                                    |
|   | 2. 实现 do_xxx_request()                                             |
|   | 3. 注册到 blk_dev[]                                                   |
|   | 4. 设置中断处理（如需要）                                             |
|   | 5. 在 main.c 调用初始化                                               |
|   +------------------+                                                    |
|                                                                           |
|   字符设备驱动：                                                          |
|   +------------------+                                                    |
|   | 1. 实现 rw_xxx()   |                                                  |
|   | 2. 添加到 crw_table[]                                                 |
|   | 3. 创建设备文件 /dev/xxx                                              |
|   +------------------+                                                    |
|                                                                           |
|   设备文件创建：                                                          |
|   mknod /dev/mydev c 6 0    # 字符设备                                    |
|   mknod /dev/myblk b 7 0    # 块设备                                      |
|                                                                           |
+===========================================================================+
```

---

## 8. 总结

### 8.1 驱动开发关键点

| 类型 | 注册位置 | 关键函数 | 数据结构 |
|------|---------|---------|---------|
| 块设备 | blk_dev[] | do_xxx_request() | struct request |
| 字符设备 | crw_table[] | rw_xxx() | 无特定结构 |

### 8.2 关键文件

| 文件 | 作用 |
|------|------|
| kernel/blk_drv/blk.h | 块设备通用宏定义 |
| kernel/blk_drv/ll_rw_blk.c | 块设备请求管理 |
| kernel/blk_drv/hd.c | 硬盘驱动示例 |
| kernel/blk_drv/ramdisk.c | RAM 盘驱动示例 |
| fs/char_dev.c | 字符设备分发 |
| fs/block_dev.c | 块设备读写 |

### 8.3 Linux 0.11 与现代 Linux 对比

| 特性 | Linux 0.11 | 现代 Linux |
|------|-----------|-----------|
| 驱动注册 | blk_dev[] / crw_table[] | register_blkdev() / register_chrdev() |
| 文件操作 | 无 file_operations | struct file_operations |
| 设备模型 | 无 | sysfs + kobject |
| 模块加载 | 不支持 | insmod / rmmod |
| 中断处理 | set_intr_gate() | request_irq() |