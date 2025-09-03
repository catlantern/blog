

**学习路径：arch/x86/boot/main.c**

**学习目的：了解linux的启动流程**

##  分析第一个函数调用init_default_io_ops();的作用：

```
static inline void init_default_io_ops(void)
{
        pio_ops.f_inb  = __inb;
        pio_ops.f_outb = __outb;
        pio_ops.f_outw = __outw;
}
```

跟进_\_inb发现 define inb __inb

继续跟进 inb发现【#define BUILDIO(bwl, bw, type)】宏定义

### 了解BUILDIO(bwl, bw, type)宏定义

```c
#define BUILDIO(bwl, bw, type)						
									
//返回从端口读取的数据(value)
static __always_inline type __in##bwl(u16 port)				
{									
	type value;							
	asm volatile("in" #bwl " %w1, %" #bw "0"			
		     : "=a"(value) : "Nd"(port));			
	return value;							
}

BUILDIO(b, b, u8)
BUILDIO(w, w, u16)
BUILDIO(l,  , u32)
#undef BUILDIO
```

- ##  `bwl` - 指令后缀参数

  **作用**：指定汇编指令的后缀，决定操作的数据宽度

  ```c
  // bwl = b  →  "in" + "b"  =  "inb"  (输入字节)
  // bwl = w  →  "in" + "w"  =  "inw"  (输入字)  
  // bwl = l  →  "in" + "l"  =  "inl"  (输入双字)
  ```

- ## `bw` - 寄存器格式参数

  **作用**：指定寄存器的操作数格式修饰符

  ```c
  // bw = b   →  "%" + "b" + "0"  =  "%b0"  (8位寄存器，如%al)
  // bw = w   →  "%" + "w" + "0"  =  "%w0"  (16位寄存器，如%ax)
  // bw = ""  →  "%" + "" + "0"   =  "%0"   (32位寄存器，如%eax)
  ```

- ## `type` - 数据类型参数

  **作用**：指定函数返回值和局部变量的数据类型

  ```c
  // type = u8   →  static __always_inline u8 __inb(u16 port)
  // type = u16  →  static __always_inline u16 __inw(u16 port)  
  // type = u32  →  static __always_inline u32 __inl(u16 port)
  ```



## 接下来返回到init_default_io_ops的调用

```c
static inline void init_default_io_ops(void)
{
	pio_ops.f_inb  = __inb;
	pio_ops.f_outb = __outb;
	pio_ops.f_outw = __outw;
}
```

所以这个函数的作用是`将直接硬件访问函数赋给函数指针`



## 分析第二个函数调用copy_boot_params();的作用:

```c
static void copy_boot_params(void)
{
	struct old_cmdline {
		u16 cl_magic; // 魔数，标识命令行存在
		u16 cl_offset;  // 命令行在段内的偏移量
	};
	const struct old_cmdline * const oldcmd = absolute_pointer(OLD_CL_ADDRESS);
	//OLD_CL_ADDRESS 是个常量，跟进后发现定义为#define OLD_CL_ADDRESS		0x020	
    //absolute_pointer() 将地址转换为绝对指针
    //所以oldcmd是旧版命令行指针
    
	BUILD_BUG_ON(sizeof(boot_params) != 4096);
	memcpy(&boot_params.hdr, &hdr, sizeof(hdr)); 

	if (!boot_params.hdr.cmd_line_ptr && oldcmd->cl_magic == OLD_CL_MAGIC) {
		/* Old-style command line protocol */
		u16 cmdline_seg;

		/*
		 * Figure out if the command line falls in the region
		 * of memory that an old kernel would have copied up
		 * to 0x90000...
		 */
		if (oldcmd->cl_offset < boot_params.hdr.setup_move_size)
			cmdline_seg = ds(); // 命令行在被移动的区域内
		else
			cmdline_seg = 0x9000; //// 命令行在固定区域

		boot_params.hdr.cmd_line_ptr = (cmdline_seg << 4) + oldcmd->cl_offset; //计算出命令行参数正确的地址
	}
}
```

- 分析BUILD_BUG_ON(sizeof(boot_params) != 4096);

  `BUILD_BUG_ON` 是一个**编译时断言宏**，用于在编译阶段检查条件是否满足。

  ## 基本作用

  ```c
  cBUILD_BUG_ON(sizeof(boot_params) != 4096);
  ```

  所以`BUILD_BUG_ON(sizeof(boot_params) != 4096);`代码的意思是：**如果 `boot_params` 结构体的大小不是4096字节，编译就会失败**。

- 分析memcpy(&boot_params.hdr, &hdr, sizeof(hdr));

  跟进`&hdr`后发现是个结构定义【extern struct setup_header hdr;】

  跟进setup_header结构

  ```c
  struct setup_header {
      //基本启动信息
  	__u8	setup_sects; // setup代码占用的扇区数
  	__u16	root_flags;  // 根文件系统标志
  	__u32	syssize; // 保护模式内核代码大小
  	__u16	ram_size; // RAM磁盘大小
  	__u16	vid_mode; // 视频模式
  	__u16	root_dev; // 根设备号
      
      //协议标识和版本
  	__u16	boot_flag; // 启动标志 (0xAA55)
  	__u16	jump; // 跳转指令
  	__u32	header; // 协议头标识 (0x53726448 = "HdrS")
  	__u16	version;  // 协议版本
      
      //内存和加载信息
  	__u32	realmode_swtch; // 实模式切换例程地址
  	__u16	start_sys_seg; // 系统代码起始段地址 (0x1000)
  	__u16	kernel_version; // 内核版本字符串偏移
  	__u8	type_of_loader; // 加载器类型
  	__u8	loadflags; // 加载标志
  	__u16	setup_move_size; // setup代码移动大小
  	__u32	code32_start; // 32位代码起始地址
      
      //RAM磁盘和命令行
  	__u32	ramdisk_image; // RAM磁盘镜像地址
  	__u32	ramdisk_size; // RAM磁盘大小
  	__u32	cmdline_size; // 命令行最大大小
      
      //现代内核特性
      __u32	initrd_addr_max;       // initrd最大地址
      __u32	kernel_alignment;      // 内核对齐要求
      __u8	relocatable_kernel;    // 可重定位内核标志
      __u8	min_alignment;         // 最小对齐要求
      __u16	xloadflags;            // 扩展加载标志
      __u32	cmdline_size;          // 命令行最大大小
  
  
      //硬件架构相关
      __u32	hardware_subarch;      // 硬件子架构
      __u64	hardware_subarch_data; // 子架构特定数据
  
      //64位和UEFI支持
      __u32	payload_offset;        // 有效载荷偏移
      __u32	payload_length;        // 有效载荷长度
      __u64	setup_data;            // setup数据链表
      __u64	pref_address;          // 首选加载地址
      __u32	init_size;             // 初始化代码大小
      __u32	handover_offset;       // 交接偏移量
      __u32	kernel_info_offset;    // 内核信息偏移
  } __attribute__((packed));
  ```

  所以这个结构的意思是`Linux内核启动协议的核心数据结构，包含了内核启动所需的所有关键信息。`

  所以`memcpy(&boot_params.hdr, &hdr, sizeof(hdr));`这行代码的作用是`复制标准启动头到启动参数里`

- 分析if (!boot_params.hdr.cmd_line_ptr && oldcmd->cl_magic == OLD_CL_MAGIC)

  - `cmd_line_ptr == 0`：没有使用新版命令行协议

  - `cl_magic == OLD_CL_MAGIC`：存在旧版命令行协议数据

    所以`if (!boot_params.hdr.cmd_line_ptr && oldcmd->cl_magic == OLD_CL_MAGIC)`满足的条件是`只处理旧版本内核的命令行参数`

所以这个函数的作用是`统一和标准化启动参数的获取过程，确保内核能够正确获取bootloader传递的各种启动信息。`

## 分析第三个函数调用console_init();的作用：

跟进后发现

```c
void console_init(void)
{
	parse_earlyprintk();

	if (!early_serial_base)
		parse_console_uart8250();
}
```

跟进parse_earlyprintk();
```c
static void parse_earlyprintk(void)
{
	int baud = DEFAULT_BAUD;   // 默认波特率
	char arg[32]; // 存储命令行参数值的缓冲区
	int pos = 0;// 参数解析位置指针
	int port = 0;// 串口端口地址（0表示未设置）

     /* 
	 * 从命令行中查找 earlyprintk 参数
	 * 例如：earlyprintk=serial,0x3f8,115200
	 */
	if (cmdline_find_option("earlyprintk", arg, sizeof(arg)) > 0) {
		char *e;

         /* 
		 * 检查是否以 "serial" 开头
		 * 支持格式：serial,0x3f8,115200 或 serial,ttyS0,115200
		 */
		if (!strncmp(arg, "serial", 6)) {
			port = DEFAULT_SERIAL_PORT;// 设置默认串口端口
			pos += 6;// 移动位置指针，跳过"serial"
		}

         /* 
		 * 跳过逗号分隔符
		 * 例如：serial,0x3f8,115200 中的逗号
		 */
		if (arg[pos] == ',')
			pos++;

		/*
		 * 解析串口端口地址
		 * 支持以下格式：
		 * 1. "serial,0x3f8,115200" - 直接指定16进制端口地址
		 * 2. "serial,ttyS0,115200" - 使用设备名
		 * 3. "ttyS0,115200" - 直接指定设备
		 *
          * 
		 * 检查是否是指定16进制端口地址的格式
		 * pos == 7 是因为 "serial," 的长度为 7
		 * 例如：serial,0x3f8,115200
		 */
		if (pos == 7 && !strncmp(arg + pos, "0x", 2)) {
            // 解析16进制端口地址（如 0x3f8）
			port = simple_strtoull(arg + pos, &e, 16);
            // 验证解析结果是否有效
			if (port == 0 || arg + pos == e)
				port = DEFAULT_SERIAL_PORT; // 解析失败使用默认端口
			else
				pos = e - arg;  // 更新位置指针到数值结束位置
		} 
         /* 
		 * 检查是否是指定ttyS设备的格式
		 * 例如：serial,ttyS0,115200 或 ttyS1,38400
		 */
        else if (!strncmp(arg + pos, "ttyS", 4)) {
              // COM端口基地址映射表
			// bases[0] = 0x3f8 (COM1/ttyS0)
			// bases[1] = 0x2f8 (COM2/ttyS1)
			static const int bases[] = { 0x3f8, 0x2f8 };
			int idx = 0;// 默认选择COM1

			pos += 4;// 跳过"ttyS"

			if (arg[pos++] == '1')
				idx = 1;// 选择COM2

			port = bases[idx];// 设置对应的端口地址
		}
		/* 
		 * 跳过第二个逗号分隔符
		 * 例如：serial,0x3f8,115200 中的第二个逗号
		 */
		if (arg[pos] == ',')
			pos++;

         /* 
		 * 解析波特率参数
		 * simple_strtoull 可以自动识别进制（0表示自动识别）
		 */
		baud = simple_strtoull(arg + pos, &e, 0);
		if (baud == 0 || arg + pos == e)
			baud = DEFAULT_BAUD; // 解析失败使用默认波特率
	}
    /* 
	 * 如果成功解析到端口地址，则初始化串口硬件
	 * 这样在内核启动早期就可以通过串口输出调试信息
	 */

	if (port)
		early_serial_init(port, baud); //在系统启动早期阶段配置串行端口（通常是COM1、COM2等）
}
```

所以函数作用是`解析内核命令行中的earlyprintk参数，提取串口配置信息（端口地址和波特率），并初始化相应的串行端口用于早期调试输出`



## 分析代码片段作用

```c
	if (cmdline_find_option_bool("debug"))
		puts("early console in setup code\n");
```

代码作用：`如果在内核命令行中设置了debug参数，就输出一条调试信息`



## 分析第四个函数调用init_heap();的作用：

```c
static void init_heap(void)
{
	char *stack_end;

	if (boot_params.hdr.loadflags & CAN_USE_HEAP) { //检查bootloader是否支持堆内存使用
		stack_end = (char *) (current_stack_pointer - STACK_SIZE); //栈的底部地址（栈向下增长）
		heap_end = (char *) ((size_t)boot_params.hdr.heap_end_ptr + 0x200); //堆的结束地址，基于bootloader提供的信息
		if (heap_end > stack_end) //确保堆不会与栈冲突，防止内存覆盖
			heap_end = stack_end;
	} else {
		/* Boot protocol 2.00 only, no heap available */
		puts("WARNING: Ancient bootloader, some functionality may be limited!\n");  //如果bootloader太老不支持堆，发出警告
	}
}
```

函数作用：`根据bootloader提供的信息初始化堆内存边界，为内核启动过程中的动态内存分配做准备`



## 分析代码片段作用

```c
	if (validate_cpu()) {
		puts("Unable to boot - please use a kernel appropriate for your CPU.\n");
		die();
	}
```

这段代码的作用是：`检查CPU是否满足内核运行要求，如果不满足则输出错误信息并终止系统启动`

## 分析第五个函数调用set_bios_mode();的作用：

```c
static void set_bios_mode(void)
{
#ifdef CONFIG_X86_64
	struct biosregs ireg;

	initregs(&ireg);
	ireg.ax = 0xec00;
	ireg.bx = 2;
	intcall(0x15, &ireg, NULL);
#endif
}
```

这个函数的作用是：`通知BIOS内核打算运行的CPU模式，通过调用set_bios_mode()函数设置BIOS为64位增强模式`



## 分析第六个函数调用detect_memory的作用：

```c
void detect_memory(void)
{
	detect_memory_e820();//使用INT 15h E820h功能检测内存，提供最详细的内存布局信息

	detect_memory_e801();// 使用INT 15h E801h功能检测内存，作为E820的备选方案

	detect_memory_88();// 使用INT 15h 88h功能检测内存，最古老但兼容性最好的方法
}
```

这个函数的作用是：`检测系统可用内存，通过调用三种不同的BIOS内存检测方法来获取内存布局信息`



## 分析第七个函数调用keyboard_init(void);的作用：

```c
static void keyboard_init(void)
{
	struct biosregs ireg, oreg;

	initregs(&ireg);

	ireg.ah = 0x02;		/* Get keyboard status (获取键盘状态)*/
	intcall(0x16, &ireg, &oreg);
	boot_params.kbd_status = oreg.al; //保存键盘移位键状态

	ireg.ax = 0x0305;	/* Set keyboard repeat rate (设置键盘重复率)*/
	intcall(0x16, &ireg, NULL);
}
```

这个函数的作用是：`初始化键盘设置，获取当前键盘状态并设置键盘重复率`



## 分析第八个函数调用query_ist();的作用：

```c
static void query_ist(void)
{
	struct biosregs ireg, oreg;

	/*
	 * Some older BIOSes apparently crash on this call, so filter
	 * it from machines too old to have SpeedStep at all.
	 */
	if (cpu.level < 6) ///* 过滤掉太老的CPU，避免BIOS崩溃 */
		return;

	initregs(&ireg);
	ireg.ax  = 0xe980;	 /* IST Support */
	ireg.edx = 0x47534943;	 /* Request value */
	intcall(0x15, &ireg, &oreg);

    //保存Intel SpeedStep技术相关信息
	boot_params.ist_info.signature  = oreg.eax;
	boot_params.ist_info.command    = oreg.ebx;
	boot_params.ist_info.event      = oreg.ecx;
	boot_params.ist_info.perf_level = oreg.edx;
}
```

代码作用：`查询并获取Intel SpeedStep技术相关信息，用于电源管理和性能调节`



## 分析代码片段

```c
/* Query APM information - 查询APM电源管理信息 */
#if defined(CONFIG_APM) || defined(CONFIG_APM_MODULE)
	query_apm_bios();  /* 只有当内核配置了APM支持时才调用 */

#endif

/* Query EDD information - 查询EDD磁盘信息 */
#if defined(CONFIG_EDD) || defined(CONFIG_EDD_MODULE)
	query_edd();       /* 只有当内核配置了EDD支持时才调用 */
#endif
```

- ## `query_apm_bios()` - 查询APM BIOS信息

  ```c
  /* 获取高级电源管理(APM)相关信息 */
  query_apm_bios();
  ```

  **具体作用**：

  - 查询BIOS中的APM（Advanced Power Management）支持情况
  - 获取电源管理功能信息，如：
    - APM版本号
    - 电源管理接口状态
    - 电池状态信息
    - 电源管理能力
  - 为内核电源管理子系统提供硬件支持信息

  ## `query_edd()` - 查询EDD信息

  ```c
  /* 获取增强磁盘驱动(EDD)相关信息 */
  query_edd();
  ```

  **具体作用**：

  - 查询BIOS中的EDD（Enhanced Disk Drive）服务信息
  - 获取详细的磁盘硬件信息，如：
    - 磁盘参数（柱面数、磁头数、扇区数）
    - 磁盘访问模式
    - 磁盘几何结构信息
    - 支持的大容量磁盘信息
  - 为内核磁盘子系统提供准确的硬件磁盘信息

这两段代码的作用是：`根据内核配置选项有条件地查询APM和EDD硬件信息`



## 分析第九个函数调用set_video();的作用：

```c
void set_video(void)
{
	u16 mode = boot_params.hdr.vid_mode;  /* 获取启动参数中的视频模式 */

	RESET_HEAP();  /* 重置堆内存 */

	store_mode_params();  /* 存储当前模式参数 */
	save_screen();        /* 保存当前屏幕内容 */
	probe_cards(0);       /* 探测显卡硬件 */

	for (;;) {  /* 循环直到设置成功 */
		if (mode == ASK_VGA)  /* 如果是询问模式 */
			mode = mode_menu();   /* 显示菜单让用户选择 */

		if (!set_mode(mode))  /* 尝试设置视频模式 */
			break;  /* 设置成功则退出循环 */

		printf("Undefined video mode number: %x\n", mode);  /* 设置失败提示 */
		mode = ASK_VGA;  /* 重新设置为询问模式 */
	}
	
	boot_params.hdr.vid_mode = mode;  /* 更新启动参数中的视频模式 */
	vesa_store_edid();     /* 存储显示器EDID信息 */
	store_mode_params();   /* 重新存储模式参数 */

	if (do_restore)        /* 如果需要恢复 */
		restore_screen();  /* 恢复之前保存的屏幕内容 */
}

```

这个函数的作用是：`设置视频显示模式，让用户选择或配置合适的显示分辨率和显示模式`



## 分析第十个函数调用go_to_protected_mode();的作用：

```c
void go_to_protected_mode(void)
{
	/* Hook before leaving real mode, also disables interrupts */
	/* 切换到保护模式前的钩子函数，同时禁用中断 */
	realmode_switch_hook();

	/* Enable the A20 gate */
	/* 启用A20地址线门，解决内存寻址问题 */
	if (enable_a20()) {
		puts("A20 gate not responding, unable to boot...\n");
		die();  /* A20门无响应，无法启动 */
	}

	/* Reset coprocessor (IGNNE#) */
	/* 重置协处理器 */
	reset_coprocessor();

	/* Mask all interrupts in the PIC */
	/* 屏蔽PIC中的所有中断 */
	mask_all_interrupts();

	/* Actual transition to protected mode... */
	/* 实际的保护模式转换 */
	setup_idt();  /* 设置中断描述符表 */
	setup_gdt();  /* 设置全局描述符表 */
	
	/* 跳转到保护模式并执行内核 */
	protected_mode_jump(boot_params.hdr.code32_start,
			    (u32)&boot_params + (ds() << 4));
}
```

跟进realmode_switch_hook();函数

```c
static void realmode_switch_hook(void)
{
	/* 检查是否有自定义的实模式切换钩子函数 */
	if (boot_params.hdr.realmode_swtch) {
		/* 如果有，调用用户自定义的切换函数 */
		asm volatile("lcallw *%0"  /* 远程调用 */
			     : : "m" (boot_params.hdr.realmode_swtch)
			     : "eax", "ebx", "ecx", "edx");
	} else {
		/* 如果没有自定义函数，执行默认操作 */
		asm volatile("cli");  /* 清除中断标志，禁用中断 */
		outb(0x80, 0x70);     /* 向端口0x70写入0x80，禁用NMI（不可屏蔽中断） */
		io_delay();           /* I/O延迟，确保操作完成 */
	}
}

```

这个函数的作用是：`在切换到保护模式之前执行必要的清理和准备工作`

**具体功能**：

1. **中断管理**：
   - 禁用所有可屏蔽中断（CLI指令）
   - 禁用NMI（不可屏蔽中断）
2. **用户定制**：
   - 允许OEM厂商或系统集成商提供自定义的切换处理函数
   - 通过`realmode_swtch`字段指定自定义函数地址
3. **系统稳定**：
   - 确保在模式切换过程中不会被中断干扰
   - 为安全的模式切换创造条件

跟进enable_a20()：
```c
int enable_a20(void)
{
       int loops = A20_ENABLE_LOOPS;  /* 设置重试次数 */
       int kbc_err;

       while (loops--) {  /* 循环尝试启用A20 */
	       /* First, check to see if A20 is already enabled
		  (legacy free, etc.) */
	       /* 首先检查A20是否已经启用（现代系统可能默认启用） */
	       if (a20_test_short())
		       return 0;  /* 已启用，直接返回成功 */
	       
	       /* Next, try the BIOS (INT 0x15, AX=0x2401) */
	       /* 尝试通过BIOS调用启用A20 */
	       enable_a20_bios();
	       if (a20_test_short())
		       return 0;  /* 启用成功 */
	       
	       /* Try enabling A20 through the keyboard controller */
	       /* 尝试通过键盘控制器启用A20 */
	       kbc_err = empty_8042();  /* 检查键盘控制器是否空闲 */

	       if (a20_test_short())
		       return 0; /* BIOS工作了，但是有延迟反应 */
	
	       if (!kbc_err) {  /* 键盘控制器可用 */
		       enable_a20_kbc();  /* 通过键盘控制器启用A20 */
		       if (a20_test_long())
			       return 0;  /* 长时间测试通过 */
	       }
	       
	       /* Finally, try enabling the "fast A20 gate" */
	       /* 最后尝试启用"快速A20门" */
	       enable_a20_fast();
	       if (a20_test_long())
		       return 0;  /* 测试通过 */
       }
       
       return -1;  /* 所有方法都失败，返回错误 */
}

```

这个函数的作用是：`启用A20地址线，解决内存寻址问题(没有启用A20就无法正确进入保护模式。)`

跟进reset_coprocessor();

```c
static void reset_coprocessor(void)
{
	outb(0, 0xf0);  /* 向端口0xf0写入0，发送重置信号 */
	io_delay();     /* I/O延迟，确保操作完成 */
	outb(0, 0xf1);  /* 向端口0xf1写入0，清除重置信号 */
	io_delay();     /* I/O延迟，确保操作完成 */
}
```

这个函数的作用是：**重置数学协处理器（FPU，浮点运算单元）**。

跟进mask_all_interrupts();

```c
static void mask_all_interrupts(void)
{
	/* 屏蔽从片PIC的所有中断 */
	outb(0xff, 0xa1);	/* Mask all interrupts on the secondary PIC */
	io_delay();
	
	/* 屏蔽主片PIC的所有中断，除了级联中断 */
	outb(0xfb, 0x21);	/* Mask all but cascade on the primary PIC */
	io_delay();
}

```

这个函数的作用是：`屏蔽所有可屏蔽中断，确保在模式切换过程中的系统稳定性`

跟进setup_idt();

```c
static void setup_idt(void)
{
	/* 定义一个空的IDT描述符 */
	static const struct gdt_ptr null_idt = {0, 0};
	
	/* 加载空的IDT到CPU */
	asm volatile("lidtl %0" : : "m" (null_idt));
}

```

这个函数的作用是：`设置空的中断描述符表（IDT）`

跟进setup_gdt();

```c
static void setup_gdt(void)
{
	/* 有些机器要求GDT 8字节对齐，Intel推荐16字节对齐 */
	static const u64 boot_gdt[] __attribute__((aligned(16))) = {
		/* CS: 代码段，可读可执行，4GB，基地址0 */
		[GDT_ENTRY_BOOT_CS] = GDT_ENTRY(DESC_CODE32, 0, 0xfffff),
		/* DS: 数据段，可读可写，4GB，基地址0 */
		/* TSS: 32位任务状态段，104字节，基地址4096 */
		/* 这里设置TSS只是为了兼容Intel VT虚拟化技术，实际上不使用 */
		[GDT_ENTRY_BOOT_TSS] = GDT_ENTRY(DESC_TSS32, 4096, 103),
	};
	
	/* Xen HVM会错误地存储gdt_ptr的指针而不是内容，所以设为static */
	static struct gdt_ptr gdt;

	gdt.len = sizeof(boot_gdt)-1;  /* GDT长度（limit）*/
	gdt.ptr = (u32)&boot_gdt + (ds() << 4);  /* GDT基地址 */

	asm volatile("lgdtl %0" : : "m" (gdt));  /* 加载GDT到CPU */
}

```

这个函数的作用是：`设置全局描述符表（GDT），为保护模式提供必要的段描述符`

分析代码片段

```c
	protected_mode_jump(boot_params.hdr.code32_start, //boot_params.hdr.code32_start是内核映像中32位代码段的入口点
			    (u32)&boot_params + (ds() << 4)); //(u32)&boot_params + (ds() << 4)// 计算boot_params结构体的物理地址。
```

这个函数的作用是：`实际执行从实模式到保护模式的跳转，并开始执行32位内核代码`



**分析完毕**，这个`main()`函数的作用是：**执行16位实模式下的系统初始化和准备工作，最终跳转到32位保护模式**。







