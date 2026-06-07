
# 加载CobaltStrike Beacon DLL静默情况分析

## 一、样本概况

| 属性         | 值                                                                  |
| ---------- | ------------------------------------------------------------------ |
| **文件名**    | `dump_0x16FDCFC0049.dll`                                           |
| **体系架构**   | x86-64 (PE32+)                                                     |
| **基址**     | `0x180000000`                                                      |
| **映像大小**   | `0x58000` (360,448 字节)                                             |
| **MD5**    | `6ecc8b16cf5925cccdaae7c2ded01943`                                 |
| **SHA256** | `4ab24972fbaa8dc28003c8c2321a5c0cb5ff4f47c201ef5feb17bb00f1c46450` |
| **函数总数**   | 965（含 261 个导入函数）                                                   |
| **节区**     | `.text` / `.idata` / `.rdata` / `.data` / `.pdata`                 |
|            |                                                                    |

### 两个入口点

| 入口 | 地址 | 说明 |
|---|---|---|
| `DllEntryPoint` | `0x180021B48` | PE 头指定的入口 → `DllMain` |
| `ReflectiveLoader` | `0x1800194D4` | 导出序号 1，供反射式注入器调用 |

---

## 二、DllMain 的分发逻辑

反编译 `DllMain`（`0x1800193E0`）后得到清晰的 switch-case 结构：

```c
BOOL __stdcall DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved)
{
    DWORD v5 = fdwReason - 1;

    if (v5)                                       // reason != 1
    {
        DWORD v6 = v5 - 3;
        if (v6)                                   // reason != 4
        {
            if (v6 == 9)                          // reason == 13
                sub_18001B848(lpvReserved);        //   → 另一条自定义路径
        }
        else                                      // reason == 4
        {
            // 非原生加载的清理/解绑逻辑
            // ...
            sub_18000CA74(lpvReserved);            // ★ 主 C2 通信循环
        }
    }
    else                                          // reason == 1
    {
        sub_18001B47C();                           //   → 初始化（静默）
    }
    return 1;
}
```

映射为表格：

| `fdwReason` | Windows 含义 | 本 DLL 行为 |
|---|---|---|
| `0` | `DLL_PROCESS_DETACH` | **无操作** |
| `1` | `DLL_PROCESS_ATTACH` | `sub_18001B47C()` — **仅初始化** |
| `2` | `DLL_THREAD_ATTACH` | **无操作** |
| `3` | `DLL_THREAD_DETACH` | **无操作** |
| **`4`** | 👈 **非标准值，由反射注入器自定义** | `sub_18000CA74()` — **启动 C2 主循环** |
| `13` | 👈 **非标准值** | `sub_18001B848()` — 另一条自定义路径 |

> **关键结论**：Windows 的 `LoadLibrary` 机制只会传入 `fdwReason ∈ {0, 1, 2, 3}`，**绝不会传入 4 或 13**。因此标准加载方式永远无法触发恶意行为。

---

## 三、`fdwReason=1` 初始化阶段 —— `sub_18001B47C()`

此函数在 `DLL_PROCESS_ATTACH` 时执行，行为如下：

### 3.1 内存池分配
```
sub_180015FEC(1280)    → 分配 1280 字节内存池
sub_1800161E8(v2, 256) → 从池中切出 4 个 256 字节块 + 2 个 128 字节块
malloc(0x800)          → 分配 2048 字节配置表
```

### 3.2 主机信息收集
- `GetComputerNameExA(ComputerNamePhysicalDnsDomain, ...)` — 获取 DNS 域名
- `GetComputerNameA(...)` — 获取 NetBIOS 计算机名
- `GetUserNameA(...)` — 获取当前用户名
- 三项信息存入全局变量供后续 C2 通信使用（用于向服务器注册受害者身份）

### 3.3 配置解密
```c
// 6144 字节嵌入式密文，XOR 0x2E 解密
for (i = 0; i < 6144; ++i)
    byte_180046040[i] ^= 0x2E;
```
解密后的配置包含 C2 服务器地址、URI 路径、通信参数等条目，按 type-tagged 格式（类型1=short, 类型2=dword, 类型3=blob）解析到全局配置表中。

解密后**立即将原始数据清零**（`memset(byte_180046040, 0, 6144)`），防止内存取证。

### 3.4 API 哈希解析
通过 `sub_18001C680` 对 `kernel32.dll` 和 `ntdll.dll` 的导出表做 DJB2 类哈希查找，动态解析函数地址，避免在导入表中暴露敏感 API 名称。

### 3.5 **没有发生的操作**
- ❌ 不创建线程
- ❌ 不建立网络连接
- ❌ 不启动任何持续性机制
- ❌ 不修改注册表或文件系统

**这就是 `LoadLibrary` 后你看到「加载成功」但无事发生的原因。**

---

## 四、`fdwReason=4` 载荷阶段 —— `sub_18000CA74()`（C2 主循环）

这是真正干活的地方。反编译后的关键部分：

```c
// 1. 读取 C2 配置
sub_18001C230(v5, ...)  // 初始化 C2 连接结构（含代理、User-Agent等）
sub_1800134A0(v29)       // 解析 URI 列表

// 2. WinINet / Winsock 初始化
sub_18000F1E4(37)        // InternetOpen / WSAStartup
sub_18000F1F8(37, 36)    // InternetConnect / connect

// 3. ★ 主循环 —— 只要 dword_180042000 为真就持续运行
while (dword_180042000)
{
    // 从配置表获取下一个 URI 路径
    sub_18001BFC0(v2, v5)  // 取路径
    sub_18001BFC0(0, v5)   // 取 User-Agent / 参数

    // HTTP 请求/响应
    sub_18000E9F4(...)     // 发送请求，接收响应
    sub_18001AD44(...)     // 解析响应数据
    sub_180018E0C(...)     // ★ 处理 C2 服务器下发的任务

    // 根据配置做 sleep 间隔（jitter）
    if (dword_180049488)
        sub_18000F3A0()    // Sleep with jitter

    sub_18001211C()        // 清理本轮状态
}

sub_18001DA74()            // 退出前清理（可能调用 ExitProcess）
```

### 能力矩阵（基于导入表分析）

| 类别 | API | 能力 |
|---|---|---|
| **网络通信** | `WinINet`（12 个 API）+ `WS2_32`（19 个 API） | HTTP/HTTPS C2 通信、Socket 直连 |
| **进程操作** | `CreateProcessA/AsUserA/WithTokenW/WithLogonW` | 创建新进程（含令牌窃取） |
| **跨进程注入** | `VirtualAllocEx` / `WriteProcessMemory` / `CreateRemoteThread` | 向其他进程注入代码 |
| **令牌操作** | `DuplicateTokenEx` / `ImpersonateLoggedOnUser` / `AdjustTokenPrivileges` | 令牌窃取与提权 |
| **命名管道** | `CreateNamedPipeA` / `ConnectNamedPipe` / `ImpersonateNamedPipeClient` | 管道 C2 / 横向移动 |
| **文件操作** | 29 个 File I/O API | 文件上传/下载/遍历 |
| **加密** | `CryptAcquireContextA` / `CryptGenRandom` | 随机数生成（用于 jitter/密钥） |
| **反调试** | `IsDebuggerPresent` | 调试器检测 |
| **横向移动** | `CreateService` / `OpenSCManager` (通过动态解析) | 服务创建 |

这完全符合 **Cobalt Strike / Metasploit Meterpreter** 类反射式载荷的特征。

---

## 五、`ReflectiveLoader` 的执行流程

导出函数 `ReflectiveLoader`（`0x1800194D4`）是真正被注入器调用的入口：

```
ReflectiveLoader(参数)
│
├─ 1. sub_180019854()         → 获取当前 EIP，定位原始 DLL 在内存中的位置
├─ 2. sub_1800198E4()         → 解析 PEB 找到 kernel32/ntdll 基址
├─ 3. sub_180019C74/9CD4()    → 通过哈希解析关键 API
│     (VirtualAlloc, LoadLibraryA, GetProcAddress 等)
├─ 4. sub_180019F24()         → 分配新内存区域（SizeOfImage）
├─ 5. sub_18001A0F4()         → 拷贝 PE 头 + 各节区到新内存（按 SectionAlignment 对齐）
├─ 6. sub_18001A1B4()         → 修复重定位表（Relocation Directory）
├─ 7. sub_18001A2B4()         → 解析导入表（Import Directory），加载依赖 DLL
├─ 8. sub_180019764()         → 设置内存保护属性
├─ 9. sub_18001A574()         → 调用 TLS 回调（如果有）
├─10. sub_18001A094()         → Finalize: FlushInstructionCache
│
└─11. DllMain(newBase, 1, 参数)  → ★ 仅传入 fdwReason=1
     return newBase               → 将新基址返回给注入器
```

**关键点**：`ReflectiveLoader` 在步骤 11 中**只调用了 `DllMain(base, 1, param)`，即只完成了初始化**。传入 `fdwReason=4` 激活载荷是**外部注入器**在 `ReflectiveLoader` 返回后的额外动作。

---

## 六、完整的反射式注入时序

```
  ┌──────────────┐                ┌──────────────┐              ┌──────────────────┐
  │  注入器       │                │  目标进程      │              │  DLL 内部逻辑      │
  │  (Stager)    │                │              │              │                  │
  └──────┬───────┘                └──────┬───────┘              └────────┬─────────┘
         │                               │                               │
         │ ① VirtualAllocEx +            │                               │
         │   WriteProcessMemory          │                               │
         │   (将原始 DLL 字节写入)         │                               │
         │──────────────────────────────>│                               │
         │                               │                               │
         │ ② CreateRemoteThread          │                               │
         │   (起始地址=ReflectiveLoader)   │                               │
         │──────────────────────────────>│                               │
         │                               │                               │
         │                               │ ③ ReflectiveLoader()          │
         │                               │   手动 PE 映射                 │
         │                               │   重定位修复                   │
         │                               │   导入表解析                   │
         │                               │──────────────────────────────>│
         │                               │                               │
         │                               │ ④ DllMain(base, 1, param)     │
         │                               │──────────────────────────────>│
         │                               │                               │ sub_18001B47C()
         │                               │                               │ • 解密配置
         │                               │                               │ • 收集主机信息
         │                               │                               │ • 解析 API 哈希
         │                               │  ⑤ 返回新基址                  │
         │                               │<──────────────────────────────│
         │ ⑥ ReflectiveLoader 返回       │                               │
         │<──────────────────────────────│                               │
         │                               │                               │
         │ ⑦ 注入器额外调用:              │                               │
         │   DllMain(base, 4, param)     │                               │
         │──────────────────────────────>│──────────────────────────────>│
         │                               │                               │ sub_18000CA74()
         │                               │                               │ • HTTP C2 通信
         │                               │                               │ • 接收命令
         │                               │                               │ • while(1) 循环
         │                               │                               │   [阻塞]
```

---

## 七、为什么 LoadLibrary 无法激活载荷 —— 一图总结

```
          LoadLibraryA("xxx.dll")
                  │
                  ▼
    ┌──────────────────────────────┐
    │  Windows PE Loader           │
    │  处理导入/重定位/TLS          │
    │  调用 DllMain(hinst, 1, NULL)│
    └──────────────┬───────────────┘
                   │
         fdwReason == 1
                   │
                   ▼
    ┌──────────────────────────────────┐
    │  sub_18001B47C()                 │
    │  ┌────────────────────────────┐  │
    │  │ • 分配内存池               │  │
    │  │ • 收集主机名/用户名/域名    │  │
    │  │ • 解密嵌入式配置 (XOR 0x2E) │  │
    │  │ • 解析 API 哈希表          │  │
    │  │ • 清除明文配置              │  │
    │  └────────────────────────────┘  │
    │                                   │
    │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
    │     ✗ 未创建线程                  │
    │     ✗ 未建立网络连接    ⚠        │
    │     ✗ 未进入主循环                │
    │     ✗ 未执行任何载荷              │
    │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
    └──────────────────────────────────┘
                   │
                   ▼
             return TRUE
                   │
                   ▼
    ┌──────────────────────────────┐
    │  FreeLibrary(hModule)        │
    │  DllMain(hinst, 0, NULL)     │
    │  → 无操作，直接卸载            │
    └──────────────────────────────┘

         输出: "DLL 加载成功！"
               "DLL 已卸载。"
         (Surface-level 完全正常)
```

```
          DllMain(hinst, 4, NULL)    ← 反射式注入器的额外调用
                   │
                   ▼
    ┌──────────────────────────────────┐
    │  sub_18000CA74()                 │
    │  ┌────────────────────────────┐  │
    │  │ • 初始化 WinINet/Winsock   │  │
    │  │ • 解析 C2 配置 (URI/端口)  │  │
    │  │ • while(1) 循环:           │  │
    │  │   - HTTP GET/POST to C2    │  │
    │  │   - 解析服务器下发任务      │  │
    │  │   - Sleep(jitter)          │  │
    │  └────────────────────────────┘  │
    │                                   │
    │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
    │     ✓ 网络 C2 通信  🔴 活跃      │
    │     ✓ 命令执行                     │
    │     ✓ 进程注入/令牌窃取             │
    │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
    └──────────────────────────────────┘
                   │
                   ▼
            [程序阻塞，持续与 C2 通信]
```

---

## 八、C 代码实现激活

基于上述分析，要真正激活此 DLL，必须在 `LoadLibrary` 后手动调用 `DllMain(hinst, 4, NULL)`：

```c
#include <windows.h>
#include <stdio.h>

typedef BOOL(WINAPI* DLLMAIN)(HINSTANCE, DWORD, LPVOID);

int main() {
    // 1. 标准加载（触发 fdwReason=1 初始化）
    HMODULE hModule = LoadLibraryA(
        "E:\\Tools\\dump_correct_dll_0x16FDCFC0049.dll");

    if (!hModule) {
        printf("LoadLibrary 失败: %lu\n", GetLastError());
        return 1;
    }
    printf("LoadLibrary 成功，基址: 0x%p\n", hModule);

    // 2. 从 PE 头获取入口点地址
    PIMAGE_DOS_HEADER dos = (PIMAGE_DOS_HEADER)hModule;
    PIMAGE_NT_HEADERS nt =
        (PIMAGE_NT_HEADERS)((BYTE*)hModule + dos->e_lfanew);
    DLLMAIN DllMain = (DLLMAIN)(
        (BYTE*)hModule + nt->OptionalHeader.AddressOfEntryPoint);

    printf("DllMain @ 0x%p\n", DllMain);

    // 3. ⚠ fdwReason=4 → 激活 C2 循环（将阻塞）
    printf("正在激活主载荷...\n");
    DllMain(hModule, 4, NULL);

    // 4. 如果载荷退出循环才会到达此处
    printf("载荷已退出。\n");
    FreeLibrary(hModule);
    return 0;
}
```

### ⚠ 安全警告

1. `DllMain(hinst, 4, NULL)` 会进入**阻塞式的 C2 通信循环**（`while(dword_180042000)`），**请仅在隔离的沙箱/虚拟机中运行**。
2. 该 DLL 包含完整的 C2 植入能力（HTTP/HTTPS 通信、进程注入、令牌窃取、横向移动），属于 **APT / 红队工具级别载荷**。
3. 如果在联网环境中激活，它**会尝试连接嵌入配置中的 C2 服务器**。

---

## 九、设计意图与对抗意义

### 9.1 为什么要把激活拆成两步？

| 设计考量 | 说明 |
|---|---|
| **免杀** | 沙箱通常只调用 `LoadLibrary` 然后检查行为，两步激活导致沙箱看到「无害 DLL」 |
| **解耦** | 反射注入器可以自由选择时机传入 `fdwReason=4`，实现延迟执行 |
| **多态** | 不同注入器可以对同一个 DLL 传入不同的 reason 值，实现不同行为路径 |
| **EDR 规避** | DLL 加载回调中不触发敏感操作（无网络、无进程创建），规避用户态 hook 检测 |

### 9.2 为什么 `ReflectiveLoader` 自己不传 `fdwReason=4`？

`ReflectiveLoader` 的核心职责仅仅是**替换 Windows PE Loader**（手动映射），它返回新基址后，注入器需要这个句柄来：
- 查询导出函数
- 在其他线程中调用
- 选择合适时机激活

将「映射」和「激活」分离，给予了注入器最大的灵活性。

---

## 十、总结

| 加载方式 | 触发的 DllMain 调用 | 实际行为 |
|---|---|---|
| `LoadLibraryA` | `DllMain(hinst, 1, NULL)` | 仅初始化配置 → **无害** |
| `FreeLibrary` | `DllMain(hinst, 0, NULL)` | 无操作 → 正常卸载 |
| **反射注入器** | 注入器先调 `DllMain(hinst, 4, NULL)` | 启动 C2 主循环 → **恶意行为触发** |

运行 `LoadLibrary` 后程序正常退出的根本原因，是**这个 DLL 故意设计为不在 `DLL_PROCESS_ATTACH` 中执行任何危险操作**——它将真正的恶意逻辑隐藏在了一个 Windows 永远不会自动传入的 `fdwReason=4` 分支中。这是高级威胁中典型的 **"sleeping payload"** 模式。
