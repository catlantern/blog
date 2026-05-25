# 网络安全资讯日报 – 2026年5月24日

**本期要点**：
1. 微软紧急推送带外补丁，修复两项已遭在野利用的Windows Defender零日漏洞（CVE-2026-41091等）
2. NGINX Rift（CVE-2026-42945）高危漏洞持续扩散，仅三成服务器完成更新，CVSS评分9.2
3. Linux内核3周内曝出第4个高危漏洞，Dirty Frag、Copy Fail、PinTheft接连浮出水面
4. 工信部通报31款APP违规收集个人信息，2026年第3批专项整治行动持续推进

---

### 🔥 高危漏洞预警

> **标题**：微软修复两项Defender零日漏洞，攻击者已利用超过一个月
> **来源**：CNMO / Notebookcheck / 腾讯新闻
> **发布时间**：2026-05-21
> **摘要**：微软推送带外安全更新，修复两项已在零日攻击中被利用的Microsoft Defender漏洞。其中CVE-2026-41091为权限提升漏洞，影响Microsoft Defender for Endpoint等多个组件。安全研究员Chaotic Eclipse在未经协调的情况下披露了这两个漏洞。
> **链接**：https://m.cnmo.com/news/809489.html
> **标签**：`#零日漏洞` `#MicrosoftDefender` `#CVE-2026-41091`

> **标题**：NGINX Rift（CVE-2026-42945）高危漏洞遭黑客利用，潜伏18年影响1.3亿服务器
> **来源**：CSDN / 侠游戏网 / 爱尖刀
> **发布时间**：2026-05-18至2026-05-22
> **摘要**：F5 Networks于5月13日发布紧急安全公告，披露代号"NGINX Rift"的高危漏洞CVE-2026-42945，CVSS评分9.2。该漏洞自2008年NGINX 0.6.27版本即存在，影响NGINX Open Source、NGINX Plus及NGINX Ingress Controller。5月18日确认已被黑客利用，安全社区拉响警报。
> **链接**：https://blog.csdn.net/weixin_42376192/article/details/161210582
> **标签**：`#NGINX` `#CVE-2026-42945` `#远程代码执行`

> **标题**：NGINX 1.31.0再曝致命零日漏洞
> **来源**：CSDN（Nebula Security实验室）
> **发布时间**：2026-05-22
> **摘要**：Nebula Security实验室披露NGINX 1.31.0版本中存在的新的零日漏洞，全球运维团队刚完成升级即面临新威胁。漏洞细节及PoC暂未完全公开。
> **链接**：https://blog.csdn.net/ylscode/article/details/161322597
> **标签**：`#NGINX` `#零日漏洞`

> **标题**：Linux内核Dirty Frag本地权限提升漏洞（QVD-2026-24699）风险通报
> **来源**：长江大学互联网与信息中心 / 各高校CERT
> **发布时间**：2026-05-22
> **摘要**：Linux内核Dirty Frag本地权限提升漏洞（QVD-2026-24699）被公开披露。低权限攻击者可利用该漏洞提升至root权限，影响所有主流Linux发行版。各高校及政企单位已收到风险通报要求排查。
> **链接**：https://nic.yangtzeu.edu.cn/info/1012/2001.htm
> **标签**：`#Linux内核` `#权限提升` `#DirtyFrag`

> **标题**：3周内第4个：又一Linux内核高危漏洞披露，潜伏近9年
> **来源**：IT之家 / Cyberkendra
> **发布时间**：2026-05-21
> **摘要**：科技媒体Cyberkendra报道称，Linux内核在短短3周内出现第4个需要紧急处理的高危漏洞。此前已披露Copy Fail（CVE-2026-31431）、Dirty Frag（QVD-2026-24699）和PinTheft等漏洞，其中CVE-2026-46333由Qualys披露，允许本地普通用户读取root权限文件。
> **链接**：https://www.ithome.com/0/953/319.htm
> **标签**：`#Linux内核` `#CVE-2026-46333` `#提权漏洞`

> **标题**：Microsoft产品多个漏洞安全警报（A26-05-41）
> **来源**：香港政府电脑保安事故协调中心（GovCERT）
> **发布时间**：2026-05-24
> **摘要**：香港政府CERT发布Microsoft产品多个漏洞安全警报，涵盖多项安全更新，提醒用户及时安装补丁。
> **链接**：https://www.govcert.gov.hk/tc/alerts_detail.php?id=1886
> **标签**：`#Microsoft` `#安全更新`

---

### 💥 数据泄露事件

> **标题**：工信部通报31款APP违规收集个人信息
> **来源**：工业和信息化部 / 光明网 / 新京报
> **发布时间**：2026-05-21
> **摘要**：工信部发布关于侵害用户权益行为的APP(SDK)通报（2026年第3批，总第56批），共31款APP因违规收集个人信息被点名。依据《个人信息保护法》《网络安全法》等法律法规，涉及超范围收集、强制索权等问题。
> **链接**：https://www.miit.gov.cn/xwfb/gxdt/sjdt/art/2026/art_720149eef58649cabb912793bc7922cf.html
> **标签**：`#个人信息保护` `#APP违规` `#工信部通报`

> **标题**：华为路由器零日漏洞被指系卢森堡全国通信瘫痪"元凶"
> **来源**：JQman / 知情人士
> **发布时间**：2026-05-21
> **摘要**：多名知情人士称，2025年卢森堡全国通信网络大面积瘫痪事件，系攻击者利用华为企业路由器软件中的零日漏洞所致。该漏洞此前未被披露也未获CVE编号，导致移动通信、固话及紧急服务中断。
> **链接**：https://www.jqman.com/cloudnews/458404.html
> **标签**：`#华为` `#零日漏洞` `#关键基础设施`

---

### 🛡️ 网络攻击与入侵事件

> **标题**：NGINX堆缓冲区溢出漏洞已开始被黑客利用，安全公司提醒紧急升级
> **来源**：爱尖刀 / K2数据恢复大师
> **发布时间**：2026-05-18
> **摘要**：安全社区确认CVE-2026-42945（NGINX Rift）已被黑客在真实环境中利用。该漏洞自2008年引入，影响超过1.3亿台服务器。截至5月18日，仅约三成服务器完成补丁更新，安全形势严峻。
> **链接**：https://ijiandao.com/safe/it/487871.html
> **标签**：`#NGINX` `#在野利用` `#CVE-2026-42945`

> **标题**：Windows零日漏洞幸存五周年：全补丁系统仍可提权至SYSTEM
> **来源**：网易
> **发布时间**：2026-05-19
> **摘要**：安全研究员Chaotic Eclipse发布概念验证代码，证明攻击者仍可利用一个本该在2020年修复的Windows漏洞，在完全打补丁的系统上获取SYSTEM权限。该漏洞的持久存在引发对微软补丁机制的质疑。
> **链接**：https://www.163.com/dy/article/KT945CNF05561FZI.html
> **标签**：`#Windows` `#权限提升` `#ChaoticEclipse`

---

### 🦠 恶意软件/勒索软件动态

> **标题**：2026年国际反勒索软件日：卡巴斯基分享勒索软件趋势与战术见解
> **来源**：中关村在线 / 卡巴斯基
> **发布时间**：2026-05-22
> **摘要**：卡巴斯基发布勒索软件趋势报告，概述2025年形势并对2026年进行展望。数据显示2025年拉丁美洲检测到的勒索软件攻击组织数量显著增长，攻击者战术持续演进。
> **链接**：https://m.zol.com.cn/article/11849437.html
> **标签**：`#勒索软件` `#卡巴斯基` `#威胁情报`

---

### 📜 政策法规与合规动向

> **标题**：工信部发布2026年第3批侵害用户权益APP通报
> **来源**：工信部官方 / 光明网
> **发布时间**：2026-05-21
> **摘要**：根据中央网信办、工信部、公安部联合发布的《关于开展2026年个人信息保护系列专项行动的公告》，工信部通报31款违规APP/SDK，涉及违规收集个人信息、强制索取权限等问题。这是2026年个人信息保护系列专项行动的重要成果。
> **链接**：https://wap.miit.gov.cn/jgsj/xgj/fwjd/art/2026/art_c8323f5c3a394d24b5ae85ebaabbee3b.html
> **标签**：`#个人信息保护` `#专项行动` `#合规`

---

### 📊 行业报告/威胁情报研究

> **标题**：Linux内核高危漏洞集中爆发：3周4个漏洞深度分析
> **来源**：IT之家 / 安全内参 / 腾讯新闻
> **发布时间**：2026-05-21
> **摘要**：五月中旬以来，Linux内核高危漏洞集中披露。继Copy Fail（CVE-2026-31431）和Dirty Frag（QVD-2026-24699）之后，PinTheft和CVE-2026-46333相继曝光。Qualys披露的CVE-2026-46333允许普通用户读取SSH主机密钥等敏感文件，潜伏期长达近9年。
> **链接**：https://news.qq.com/rain/a/20260521A05DES00
> **标签**：`#Linux内核` `#漏洞分析` `#威胁情报`

> **标题**：2026年英国AI驱动钓鱼攻击态势解析
> **来源**：CSDN
> **发布时间**：2026-05-22
> **摘要**：研究显示2026年英国境内钓鱼攻击呈现AI深度赋能、多渠道协同、移动场景渗透的显著特征。NCSC监测数据显示超过84%遭遇网络安全事件的英国机构将钓鱼列为首要入侵途径，相关诈骗损失已突破12亿英镑。
> **链接**：https://blog.csdn.net/fireroothacker/article/details/161306179
> **标签**：`#AI钓鱼` `#英国` `#网络诈骗`

> **标题**：NETSCOUT揭示AI降低非洲DDoS攻击门槛
> **来源**：ITWeb / NETSCOUT
> **发布时间**：2026-05-20
> **摘要**：NETSCOUT在ITWeb Security Summit 2026上指出，AI技术正显著降低非洲地区发起DDoS攻击的门槛，攻击频率和规模持续上升。
> **链接**：https://www.itweb.co.za/article/netscout-highlights-how-ai-is-lowering-african-ddos-attack-barriers-at-itweb-security-summit-2026/KBpdg7pmxBVMLEew
> **标签**：`#DDoS` `#AI攻击` `#非洲`

---

### 💼 安全市场/产品/融资并购

> **标题**：2026数安大会于5月22-24日举行
> **来源**：瓯海新闻网
> **发布时间**：2026-05-21
> **摘要**：2026数据安全大会于5月22日至24日召开，聚焦数据安全政策、技术趋势和产业发展等热点议题，汇聚行业专家和政企代表。
> **链接**：https://app.ohnews.cn/webDetails/video?id=20095765&tenantId=78
> **标签**：`#数据安全` `#行业大会`

---

**⚠️ 今日重点关注**

**1. 微软Defender零日漏洞（CVE-2026-41091+）—— 已在野利用超过一个月**
- **攻击复杂度**：中
- **影响范围估算**：所有运行Microsoft Defender for Endpoint的Windows系统，覆盖全球数亿企业终端
- **建议优先级**：24小时内处置
- **相关联历史事件**：2026年2月微软补丁日曾修复6个零日漏洞，Defender产品线近年成为攻击者重点关注目标

**2. NGINX Rift（CVE-2026-42945）—— CVSS 9.2，波及1.3亿服务器**
- **攻击复杂度**：低
- **影响范围估算**：全球约1.3亿台NGINX服务器受影响，从Open Source到商业版均受影响
- **建议优先级**：24小时内处置
- **相关联历史事件**：2026年2月Ingress NGINX流量控制器发现4个新漏洞，NGINX安全态势持续恶化

**3. Linux内核漏洞集中爆发 —— 3周4个高危漏洞**
- **攻击复杂度**：中（均为本地提权，需已有初始访问权限）
- **影响范围估算**：所有主流Linux发行版，覆盖服务器、云基础设施、嵌入式设备
- **建议优先级**：一周内修复
- **相关联历史事件**：类似Dirty Pipe (CVE-2022-0847)、Dirty COW等经典提权漏洞模式重现

**4. 工信部通报31款违规APP —— 个人信息保护持续高压**
- **攻击复杂度**：不适用（非攻击，为合规问题）
- **影响范围估算**：31款APP/SDK涉及大量国内移动互联网用户
- **建议优先级**：关注即可（已通报限期整改）
- **相关联历史事件**：2026年个人信息保护系列专项行动持续推进，此前已有多批次通报

**📎 今日引用信源**

- [CNMO - 微软修复Defender零日漏洞](https://m.cnmo.com/news/809489.html)
- [CSDN - NGINX Rift深度解析](https://blog.csdn.net/weixin_42376192/article/details/161210582)
- [CSDN - NGINX 1.31.0新零日漏洞](https://blog.csdn.net/ylscode/article/details/161322597)
- [IT之家 - Linux内核3周第4个漏洞](https://www.ithome.com/0/953/319.htm)
- [长江大学 - Dirty Frag风险通报](https://nic.yangtzeu.edu.cn/info/1012/2001.htm)
- [工信部 - 2026年第3批APP通报](https://www.miit.gov.cn/xwfb/gxdt/sjdt/art/2026/art_720149eef58649cabb912793bc7922cf.html)
- [香港GovCERT - Microsoft安全警报A26-05-41](https://www.govcert.gov.hk/tc/alerts_detail.php?id=1886)
- [香港GovCERT - Nginx漏洞警报A26-05-36](https://www.govcert.gov.hk/tc/alerts_detail.php?id=1881)
- [卡巴斯基 - 2026年勒索软件趋势报告](https://m.zol.com.cn/article/11849437.html)
- [JQman - 华为路由器零日与卢森堡事件](https://www.jqman.com/cloudnews/458404.html)
- [网易 - Windows提权漏洞幸存五年](https://www.163.com/dy/article/KT945CNF05561FZI.html)
- [腾讯新闻 - Linux高危漏洞分析](https://news.qq.com/rain/a/20260521A05DES00)
- [光明网 - 31款APP违规通报](https://m.gmw.cn/2026-05/21/content_1304465037.htm)
- [NETSCOUT - AI降低非洲DDoS门槛](https://www.itweb.co.za/article/netscout-highlights-how-ai-is-lowering-african-ddos-attack-barriers-at-itweb-security-summit-2026/KBpdg7pmxBVMLEew)