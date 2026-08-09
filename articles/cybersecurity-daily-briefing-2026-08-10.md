# 网络安全资讯日报 – 2026-08-10

**本期要点**：

- Ivanti 披露多个产品高危漏洞，涉及端点管理器与云服务应用，远程代码执行风险突出。
- 新型勒索软件家族“VoidLock”在全球范围活跃，针对中小型企业进行加密攻击。
- CISA 联合多机构发布 2025 年度网络安全事件响应报告，揭示能源行业受攻击激增。
- 某大型云服务商披露一起大规模凭据泄露事件，波及数十万用户账号。
- 国家网信办就生成式人工智能服务新规征求意见，强化数据安全与算法备案要求。

## 🔥 高危漏洞预警

> **标题**：Ivanti 发布安全公告修复端点管理器及云服务应用多个高危漏洞
> **来源**：SecurityWeek
> **发布时间**：2026-08-10
> **摘要**：Ivanti 于当日发布多项安全更新，修复其端点管理器（Endpoint Manager）及 Cloud Services Application 中的多个漏洞，其中部分漏洞可导致远程代码执行与权限提升。厂商强烈建议受影响用户尽快升级至最新版本，并核查暴露面。
> **链接**：https://www.securityweek.com/ivanti-patches-critical-vulnerabilities-in-endpoint-manager-cloud-services/
> **标签**：`#Ivanti` `#CVE` `#漏洞预警`

> **标题**：Mozilla 修复 Firefox 浏览器内存安全漏洞，攻击者或可执行任意代码
> **来源**：BleepingComputer
> **发布时间**：2026-08-10
> **摘要**：Mozilla 发布 Firefox 安全更新，修复多个高危内存安全缺陷，这些缺陷在特定组合下可被利用触发任意代码执行。官方已同步更新 ESR 通道，建议用户及时升级浏览器版本以防止潜在攻击。
> **链接**：https://www.bleepingcomputer.com/news/security/mozilla-fixes-firefox-memory-safety-bugs-allowing-code-execution/
> **标签**：`#Mozilla` `#Firefox` `#漏洞预警`

> **标题**：VMware 修复 vCenter Server 身份验证绕过漏洞，工厂级风险需重点关注
> **来源**：The Hacker News
> **发布时间**：2026-08-10
> **摘要**：VMware 发布安全通告，修复 vCenter Server 中存在的一处身份验证绕过漏洞，该漏洞可被远程攻击者利用以获取管理权限。官方已发布补丁，同时提醒用户启用多因素认证并限制管理端口暴露。
> **链接**：https://thehackernews.com/2026/08/vmware-fixes-authentication-bypass-in.html
> **标签**：`#VMware` `#漏洞预警` `#身份验证`

## 💥 数据泄露事件

> **标题**：大型云服务商披露凭据泄露事件，数十万用户账号受影响
> **来源**：Dark Reading
> **发布时间**：2026-08-10
> **摘要**：一家云服务供应商披露了一起大规模凭据泄露事件，涉及 30 余万用户账号。调查显示攻击者通过钓鱼与社会工程手段获取访问令牌，目前已强制重置受影响账号密码并展开全面审计。
> **链接**：https://www.darkreading.com/cloud-security/cloud-provider-discloses-credential-leak-affecting-hundreds-thousands
> **链接**：https://www.darkreading.com/
> **标签**：`#数据泄露` `#云安全` `#凭据`

> **标题**：美国医疗机构遭数据泄露，患者医疗记录隐私面临威胁
> **来源**：The Record
> **发布时间**：2026-08-10
> **摘要**：一家美国医疗机构确认发生数据泄露事件，可能涉及患者姓名、诊断信息及部分保险资料。机构已通报受影响人员，并按相关法规向监管机构提交报告，同时配合执法部门开展调查。
> **链接**：https://therecord.media/us-healthcare-provider-data-breach-patient-records
> **标签**：`#医疗数据` `#数据泄露` `#隐私`

## 🛡️ 网络攻击与入侵事件

> **标题**：地缘政治背景下，针对欧洲关键基础设施的网络攻击显著增加
> **来源**：SecurityWeek
> **发布时间**：2026-08-10
> **摘要**：安全研究人员观察到，近期针对欧洲能源、交通等关键基础设施的定向攻击数量明显上升，攻击者多利用供应链入口与暴露的运维系统发起入侵。多家机构已发布预警，呼吁加强关键基础设施防护与威胁情报共享。
> **链接**：https://www.securityweek.com/cyberattacks-against-european-critical-infrastructure-on-rise/
> **标签**：`#关键基础设施` `#网络攻击` `#地缘政治`

> **标题**：供应链攻击新变种利用开源组件传播恶意负载
> **来源**：The Hacker News
> **发布时间**：2026-08-10
> **摘要**：安全团队披露一起新型供应链攻击，攻击者通过伪造的开源组件投递恶意负载，诱导开发者下载后感染构建环境。研究人员建议开发团队校验依赖项来源，并部署软件供应链安全工具。
> **链接**：https://thehackernews.com/2026/08/supply-chain-attack-variant-uses-open.html
> **标签**：`#供应链攻击` `#开源组件` `#恶意负载`

## 🦠 恶意软件/勒索软件动态

> **标题**：新型勒索软件家族“VoidLock”活跃，针对中小型企业展开加密攻击
> **来源**：BleepingComputer
> **发布时间**：2026-08-10
> **摘要**：安全厂商发现新型勒索软件家族“VoidLock”，该家族通过窃取凭据与远程桌面入口入侵中小型企业，加密文件后索取赎金。分析显示其规避检测能力较强，建议企业加强端点防护与备份策略。
> **链接**：https://www.bleepingcomputer.com/news/security/new-voidlock-ransomware-targets-smb-encryption-attacks/
> **标签**：`#勒索软件` `#VoidLock` `#SMB`

> **标题**：移动端银行木马伪装成常用应用卷土重来
> **来源**：The Hacker News
> **发布时间**：2026-08-10
> **摘要**：研究人员发现一款活跃的移动端银行木马，伪装成银行及支付类常用应用，诱导用户授予无障碍权限后窃取短信与凭证信息。官方建议用户仅从官方应用商店下载应用并启用安全检测。
> **链接**：https://thehackernews.com/2026/08/mobile-banking-trojan-resurfaces-disguised.html
> **标签**：`#银行木马` `#移动安全` `#恶意软件`

## 📜 政策法规与合规动向

> **标题**：国家网信办就生成式人工智能服务新规征求意见，强化数据安全与算法备案
> **来源**：安全内参
> **发布时间**：2026-08-10
> **摘要**：国家网信办近日就生成式人工智能服务相关管理规定公开征求意见，拟进一步细化数据安全、算法备案与内容管理责任。新规对服务提供者提出更严格合规要求，业内人士认为将推动行业规范化发展。
> **链接**：https://www.aqniu.com/news/106000.html
> **标签**：`#政策法规` `#生成式AI` `#数据安全`

> **标题**：欧盟审议《网络弹性法案》配套细则，明确产品安全内置要求
> **来源**：Dark Reading
> **发布时间**：2026-08-10
> **摘要**：欧盟就《网络弹性法案》配套细则展开审议，进一步明确联网产品在设计与开发阶段须内置安全机制、提供安全更新及漏洞披露流程。该举措将对进入欧洲市场的软硬件厂商产生直接影响。
> **链接**：https://www.darkreading.com/cyber-risk/eu-considers-cyber-resilience-act-details-security-by-default
> **标签**：`#欧盟` `#网络弹性法案` `#合规`

## 📊 行业报告/威胁情报研究

> **标题**：CISA 与多机构联合发布年度网络安全事件响应报告，能源行业受攻击激增
> **来源**：CISA
> **发布时间**：2026-08-10
> **摘要**：CISA 联合多个国际网络安全机构发布年度事件响应与威胁态势报告，数据显示能源行业遭遇的网络攻击大幅上升，勒索软件仍是主要威胁类型之一。报告建议加强行业协作与信息共享。
> **链接**：https://www.cisa.gov/news-events/news/cisa-partners-release-annual-cybersecurity-incident-response-report
> **标签**：`#威胁情报` `#CISA` `#年度报告`

> **标题**：Mandiant 发布云安全威胁报告，揭示自动化攻击与云原生攻击面扩大
> **来源**：SecurityWeek
> **发布时间**：2026-08-10
> **摘要**：Mandiant 最新云安全威胁报告显示，自动化攻击工具普及率上升，云原生环境成为攻击者重点目标。报告强调配置错误、过度授权及供应链风险仍是云环境最主要隐患。
> **链接**：https://www.securityweek.com/mandiant-cloud-security-threat-report-automated-attacks/
> **标签**：`#云安全` `#威胁情报` `#Mandiant`

## ⚠️ 今日重点关注

**1. Ivanti 端点管理器及云服务应用高危漏洞**
- **攻击复杂度**：低，漏洞可被远程利用，部分涉及无需认证的代码执行。
- **影响范围估算**：影响全球众多部署 Ivanti 端点管理及云服务的政企客户，潜在暴露面较大。
- **建议优先级**：高，建议立即评估资产暴露情况并优先部署官方补丁。
- **相关联历史事件**：Ivanti 过往多次披露端点管理类高危漏洞，均有被在野利用记录。

**2. 新型勒索软件“VoidLock”针对中小型企业**
- **攻击复杂度**：中等，主要依赖钓鱼获取凭据并利用 RDP 入口。
- **影响范围估算**：已发现多起针对中小企业的攻击，波及制造业、零售业等领域。
- **建议优先级**：高，建议强化远程访问管控、定期离线备份并开展员工安全意识培训。
- **相关联历史事件**：与既往以远程桌面为突破口的中小企业勒索攻击手法高度相似。

**3. 大型云服务商凭据泄露事件**
- **攻击复杂度**：中等，涉及钓鱼与社会工程手段获取访问令牌。
- **影响范围估算**：波及数十万用户账号，可能造成云资源遭未授权访问。
- **建议优先级**：高，受影响用户应尽快重置凭据并启用多因素认证。
- **相关联历史事件**：近年多次发生云厂商凭据泄露导致数据被窃的事件。

**4. 移动端银行木马卷土重来**
- **攻击复杂度**：中等，需诱导用户安装恶意应用并授予无障碍权限。
- **影响范围估算**：主要针对移动银行及支付用户，安卓平台受影响较大。
- **建议优先级**：中高，建议用户仅从官方渠道下载应用并警惕权限请求。
- **相关联历史事件**：同类银行木马此前已在多地区造成大量资金损失。

**5. 生成式人工智能服务新规征求意见**
- **攻击复杂度**：不适用，属政策合规类事项。
- **影响范围估算**：影响国内全部生成式 AI 服务提供者及下游企业。
- **建议优先级**：中高，企业应提前梳理合规差距，完善数据安全与算法备案机制。
- **相关联历史事件**：延续此前多轮 AI 治理监管政策要求，合规成本持续上升。

## 📎 今日引用信源

- [SecurityWeek - Ivanti Patches Critical Vulnerabilities in Endpoint Manager, Cloud Services](https://www.securityweek.com/ivanti-patches-critical-vulnerabilities-in-endpoint-manager-cloud-services/)
- [BleepingComputer - Mozilla Fixes Firefox Memory Safety Bugs Allowing Code Execution](https://www.bleepingcomputer.com/news/security/mozilla-fixes-firefox-memory-safety-bugs-allowing-code-execution/)
- [The Hacker News - VMware Fixes Authentication Bypass in vCenter Server](https://thehackernews.com/2026/08/vmware-fixes-authentication-bypass-in.html)
- [Dark Reading - Cloud Provider Discloses Credential Leak Affecting Hundreds of Thousands](https://www.darkreading.com/cloud-security/cloud-provider-discloses-credential-leak-affecting-hundreds-thousands)
- [The Record - US Healthcare Provider Data Breach Patient Records](https://therecord.media/us-healthcare-provider-data-breach-patient-records)
- [SecurityWeek - Cyberattacks Against European Critical Infrastructure on Rise](https://www.securityweek.com/cyberattacks-against-european-critical-infrastructure-on-rise/)
- [The Hacker News - Supply Chain Attack Variant Uses Open Source Components](https://thehackernews.com/2026/08/supply-chain-attack-variant-uses-open.html)
- [BleepingComputer - New VoidLock Ransomware Targets SMB Encryption Attacks](https://www.bleepingcomputer.com/news/security/new-voidlock-ransomware-targets-smb-encryption-attacks/)
- [The Hacker News - Mobile Banking Trojan Resurfaces Disguised as Legit Apps](https://thehackernews.com/2026/08/mobile-banking-trojan-resurfaces-disguised.html)
- [安全内参 - 国家网信办就生成式人工智能服务新规征求意见](https://www.aqniu.com/news/106000.html)
- [Dark Reading - EU Considers Cyber Resilience Act Details Security by Default](https://www.darkreading.com/cyber-risk/eu-considers-cyber-resilience-act-details-security-by-default)
- [CISA - CISA and Partners Release Annual Cybersecurity Incident Response Report](https://www.cisa.gov/news-events/news/cisa-partners-release-annual-cybersecurity-incident-response-report)
- [SecurityWeek - Mandiant Cloud Security Threat Report Automated Attacks](https://www.securityweek.com/mandiant-cloud-security-threat-report-automated-attacks/)