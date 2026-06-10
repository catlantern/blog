# 网络安全资讯日报 – 2026年5月16日

**本期要点**：
1. 微软5月补丁日修复137个CVE漏洞（含30个严重级），其中.NET和SQL Server零日漏洞已被利用
2. Windows 11曝YellowKey和GreenPlasma双漏洞，BitLocker加密可被完全绕过，PoC已公开
3. 富士康北美工厂遭Nitro勒索软件攻击，Apple和Nvidia客户数据被窃
4. 卡巴斯基披露Daemon Tools官网遭供应链攻击，安装程序被植入恶意代码
5. TanStack npm生态遭大规模供应链投毒，42个包84个恶意版本在6分钟内上线

---

### 🔥 高危漏洞预警

> **标题**：微软2026年5月补丁日更新：共修复137个漏洞（含30个严重级）
> **来源**：微软安全响应中心 / 中国石油大学(北京)信息化管理处
> **发布时间**：2026-05-13
> **摘要**：微软发布5月安全更新，共修复137个CVE漏洞，其中30个标记为Critical（严重）。漏洞类型涵盖61个特权提升、31个远程代码执行、15个信息泄露等。同时确认两个零日漏洞（.NET拒绝服务CVE-2026-26127和SQL Server权限提升CVE-2026-21262）已被在野利用。
> **链接**：https://www.cup.edu.cn/nic/wlaq/6b2796b156d943c09f474188034f49b0.htm
> **标签**：`#微软` `#补丁星期二` `#零日漏洞` `#CVE-2026-26127` `#CVE-2026-21262`

> **标题**：Windows 11曝YellowKey和GreenPlasma双漏洞：BitLocker完全可绕过，PoC已公开
> **来源**：BleepingComputer / IT之家
> **发布时间**：2026-05-14
> **摘要**：安全研究员Chaotic Eclipse公开披露了影响Windows 11及Windows Server的两个未修复漏洞。YellowKey可完全绕过BitLocker全盘加密，攻击者可通过特殊U盘访问加密数据；GreenPlasma为Windows CTF Monitor本地权限提升漏洞。PoC利用代码已公开发布，微软尚未发布官方修复。
> **链接**：https://www.ithome.com/0/950/111.htm
> **标签**：`#Windows11` `#BitLocker` `#零日漏洞` `#PoC公开` `#YellowKey` `#GreenPlasma`

> **标题**：Apache HTTP Server和MINA框架紧急安全更新修复多个高危漏洞
> **来源**：Apache软件基金会 / PHP中文网
> **发布时间**：2026-05-14
> **摘要**：Apache软件基金会发布紧急安全更新，修复HTTP Server 2.4.67中的11个漏洞（含CVE-2026-23918 HTTP/2双释放致RCE、CVE-2026-28780 AJP堆溢出等），以及MINA网络框架中的多个高危漏洞，部分可导致远程代码执行。
> **链接**：https://www.youleyou.com/wenzhang/2893022.html
> **标签**：`#Apache` `#HTTP_Server` `#MINA` `#RCE` `#CVE-2026-23918`

> **标题**：Palo Alto Networks产品多漏洞安全公告
> **来源**：香港政府电脑保安事故协调中心（GovCERT.HK）
> **发布时间**：2026-05-14
> **摘要**：Palo Alto Networks发布安全公告，修复影响其多个产品的安全漏洞。建议用户及时更新至最新版本。具体漏洞细节暂未完全公开。
> **链接**：https://www.govcert.gov.hk/tc/alerts_detail.php?id=1869
> **标签**：`#PaloAlto` `#PAN-OS` `#防火墙`

---

### 💥 数据泄露事件

> **标题**：富士康北美工厂遭勒索攻击：Apple和Nvidia客户数据被窃取
> **来源**：DIGITIMES / Notebookcheck
> **发布时间**：2026-05-14
> **摘要**：富士康确认其位于美国威斯康星州的工厂遭受勒索软件攻击。攻击者通过入侵北美多个工厂系统，窃取了包括Apple和Nvidia在内的客户敏感数据。Nitro勒索软件组织声称对此次攻击负责。事件暴露了台湾制造业在海外网络安全防护上的短板。
> **链接**：https://www.digitimes.com/news/a20260514PD208/foxconn-wisconsin-cybersecurity-plant-security.html
> **标签**：`#富士康` `#勒索软件` `#数据泄露` `#Nitro` `#供应链安全`

> **标题**：Škoda（斯柯达）在线商店遭黑客攻击，客户信息泄露
> **来源**：网易订阅 / 外媒报道
> **发布时间**：2026-05-13
> **摘要**：斯柯达官方确认其在线商店系统遭到黑客入侵，攻击者利用系统漏洞窃取了客户个人信息。受影响的客户数量及具体泄露数据类型仍在调查中。
> **链接**：https://www.163.com/dy/article/KSPVUD5P0527DRNR.html
> **标签**：`#斯柯达` `#车企安全` `#数据泄露` `#电商安全`

---

### 🛡️ 网络攻击与入侵事件

> **标题**：卡巴斯基发现Daemon Tools官网遭供应链攻击
> **来源**：卡巴斯基GReAT / 新浪财经
> **发布时间**：2026-05-14
> **摘要**：卡巴斯基全球研究与分析团队发现一起正在进行的供应链攻击，目标为Daemon Tools官方网站。攻击者篡改了官方安装程序，在交付合法应用的同时植入恶意代码。该软件被广泛用于虚拟光驱模拟，全球用户基数庞大。
> **链接**：https://cj.sina.com.cn/articles/view/3948743169/eb5d0a0100101cqkq
> **标签**：`#供应链攻击` `#DaemonTools` `#卡巴斯基` `#GReAT`

> **标题**：TanStack npm生态遭大规模供应链投毒：42个包84个恶意版本6分钟上线
> **来源**：安全内参 / Socket / Wiz
> **发布时间**：2026-05-13
> **摘要**：威胁行为体"Mini Shai-Hulud"（归因于TeamPCP组织）通过劫持TanStack项目的合法发布流程，在6分钟内向npm推送了84个恶意版本，波及42个软件包。恶意代码可窃取云密钥与GitHub令牌。Mistral AI的PyPI包、UiPath等同时受波及。OpenAI确认未发现用户数据泄露。
> **链接**：https://www.secrss.com/articles/90242
> **标签**：`#供应链攻击` `#npm` `#TanStack` `#MistralAI` `#TeamPCP`

> **标题**：谷歌报告首次发现利用AI开发零日漏洞攻击工具
> **来源**：谷歌威胁情报小组 / 新华社
> **发布时间**：2026-05-13
> **摘要**：谷歌威胁情报小组发布报告称，首次发现网络攻击者利用AI技术开发零日漏洞攻击工具。攻击工具针对一款流行的开源网页系统管理工具，利用Python脚本实现，可绕过双重认证。该攻击在早期阶段被谷歌发现并及时阻断。
> **链接**：https://news.qq.com/rain/a/20260513A07E5300
> **标签**：`#AI攻击` `#零日漏洞` `#谷歌威胁情报` `#新型威胁`

---

### 🦠 恶意软件/勒索软件动态

> **标题**：Nitro勒索软件组织攻击富士康北美工厂，索要高额赎金
> **来源**：DIGITIMES / Notebookcheck
> **发布时间**：2026-05-14
> **摘要**：Nitro勒索软件组织宣称对富士康北美工厂攻击负责。攻击者加密了工厂系统并窃取数据，威胁若不支付赎金将公开Apple和Nvidia的客户数据。这是今年以来针对制造业最严重的勒索软件攻击事件之一。
> **链接**：https://www.notebookcheck.net/Foxconn-ransomware-attack-sees-Apple-and-Nvidia-data-stolen.1296897.0.html
> **标签**：`#勒索软件` `#Nitro` `#富士康` `#制造业`

---

### 📜 政策法规与合规动向

> **标题**：美国NIH新规：2026年5月25日起要求所有数据管理计划公开
> **来源**：MIT Libraries
> **发布时间**：2026-05-15
> **摘要**：美国国立卫生研究院（NIH）宣布自2026年5月25日起，要求所有受资助研究项目的数据管理计划必须公开共享。这一政策将对生物医药领域的数据安全与隐私保护提出新要求。
> **链接**：https://libraries.mit.edu/news/bibliotech/recognizing-the-next-generation-of-open-data-leaders/
> **标签**：`#NIH` `#数据管理` `#政策合规` `#数据共享`

---

### 📊 行业报告/威胁情报研究

> **标题**：Palo Alto Networks借助新AI模型发现的漏洞数量显著增长
> **来源**：格隆汇
> **发布时间**：2026-05-14
> **摘要**：Palo Alto Networks披露，借助其新AI模型，在过去一个季度中发现的漏洞数量获得显著增长。这一趋势表明AI在网络安全漏洞挖掘领域正发挥越来越重要的作用。
> **链接**：https://www.gelonghui.com/live/2448148
> **标签**：`#AI安全` `#漏洞挖掘` `#PaloAlto`

> **标题**：软件供应链已成企业网络风险新前线
> **来源**：SiliconANGLE
> **发布时间**：2026-05-15
> **摘要**：分析指出，在经历了TanStack、Daemon Tools等连续供应链攻击事件后，软件供应链已成为企业网络安全风险的新前沿。建议企业加强SBOM管理和第三方组件安全审查。
> **链接**：https://siliconangle.com/2026/05/15/software-supply-chain-new-ground-zero-enterprise-cyber-risk-dont-get-caught-short/
> **标签**：`#供应链安全` `#行业分析` `#SBOM`

---

### 💼 安全市场/产品/融资并购

> **标题**：微软发布2026年5月.NET和.NET Framework服务更新
> **来源**：Microsoft .NET Blog
> **发布时间**：2026-05-13
> **摘要**：微软发布2026年5月.NET和.NET Framework服务更新，包含安全修复和改进。更新重点修复了已被在野利用的.NET拒绝服务零日漏洞CVE-2026-26127。
> **链接**：https://devblogs.microsoft.com/dotnet/dotnet-and-dotnet-framework-may-2026-servicing-updates/
> **标签**：`#.NET` `#微软` `#安全更新`

---

**⚠️ 今日重点关注**

1. **YellowKey & GreenPlasma Windows零日漏洞**
   - **攻击复杂度**：低（PoC已公开可用）
   - **影响范围估算**：所有Windows 11及Windows Server 2022/2025系统，影响数亿终端
   - **建议优先级**：24小时内处置 —— 在微软官方补丁发布前，建议禁用BitLocker自动解锁功能，对敏感设备实施物理安全管控，监控CTF Monitor异常行为
   - **相关联历史事件**：此前BitLocker曾被多次曝出绕过漏洞（如CVE-2023-21563），但YellowKey是首个完全绕过全盘加密的公开PoC

2. **微软5月补丁日双零日在野利用**
   - **攻击复杂度**：中（CVE-2026-21262需要本地访问）
   - **影响范围估算**：所有运行受影响.NET版本和SQL Server的服务器
   - **建议优先级**：24小时内处置 —— 立即部署KB5083631等5月累积更新
   - **相关联历史事件**：类似此前Exchange Server和MSHTML零日漏洞的利用链条

3. **富士康遭Nitro勒索攻击致Apple/Nvidia数据泄露**
   - **攻击复杂度**：中高
   - **影响范围估算**：富士康北美工厂供应链上下游企业，涉及Apple、Nvidia等核心客户
   - **建议优先级**：一周内修复 —— 受影响企业应立即隔离受感染系统、轮换凭证、评估数据泄露范围
   - **相关联历史事件**：2024年富士康墨西哥工厂也曾遭勒索攻击

4. **TanStack/Daemon Tools双重供应链攻击**
   - **攻击复杂度**：中（攻击者绕过npm 2FA和SLSA验证）
   - **影响范围估算**：全球数百万依赖npm生态的开发者及使用Daemon Tools的终端用户
   - **建议优先级**：24小时内处置 —— 检查npm lockfile中@tanstack/*版本，运行安全扫描；Daemon Tools用户应从官网重新下载最新版
   - **相关联历史事件**：2024年XZ Utils后门事件是此前最严重的供应链攻击

**📎 今日引用信源**

- [中国石油大学(北京)信息化管理处 - 微软补丁日安全通告](https://www.cup.edu.cn/nic/wlaq/6b2796b156d943c09f474188034f49b0.htm)
- [IT之家 - Win11 YellowKey/GreenPlasma漏洞披露](https://www.ithome.com/0/950/111.htm)
- [DIGITIMES - 富士康威斯康星工厂勒索攻击](https://www.digitimes.com/news/a20260514PD208/foxconn-wisconsin-cybersecurity-plant-security.html)
- [Notebookcheck - Foxconn ransomware Apple Nvidia data stolen](https://www.notebookcheck.net/Foxconn-ransomware-attack-sees-Apple-and-Nvidia-data-stolen.1296897.0.html)
- [新浪财经 - 卡巴斯基发现Daemon Tools供应链攻击](https://cj.sina.com.cn/articles/view/3948743169/eb5d0a0100101cqkq)
- [安全内参 - TanStack供应链攻击复盘](https://www.secrss.com/articles/90242)
- [腾讯新闻 - 谷歌报告AI发掘零日漏洞](https://news.qq.com/rain/a/20260513A07E5300)
- [香港GovCERT - Palo Alto产品漏洞](https://www.govcert.gov.hk/tc/alerts_detail.php?id=1869)
- [香港GovCERT - 微软BitLocker/CTF漏洞预警](https://www.govcert.gov.hk/tc/alerts_detail.php?id=1868)
- [SiliconANGLE - 供应链安全分析](https://siliconangle.com/2026/05/15/software-supply-chain-new-ground-zero-enterprise-cyber-risk-dont-get-caught-short/)
- [鄂尔多斯应用技术学院 - 微软5月安全更新](https://nic.oit.edu.cn/info/1038/4891.htm)