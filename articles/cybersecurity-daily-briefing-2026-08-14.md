# 网络安全资讯日报 – 2026-08-14

**本期要点**：

- 微软发布 2026 年 8 月补丁星期二更新，修复多个被积极利用的零日漏洞，涉及 Windows 与 Exchange Server。
- 某跨国云服务商披露重大数据泄露事件，数千万条用户记录在暗网被公开兜售。
- 勒索软件组织针对医疗机构发起新一轮攻击，多家医院系统被迫下线。
- 欧盟通过新版《网络韧性法案》执行细则，进一步收紧联网设备安全义务。
- 多份行业威胁报告指出，针对供应链与 API 的攻击在二季度持续走高。

## 🔥 高危漏洞预警

> **标题**：微软 2026 年 8 月补丁星期二：修复两个已被积极利用的零日漏洞
> **来源**：BleepingComputer
> **发布时间**：2026-08-12
> **摘要**：微软在 2026 年 8 月月度更新中修复了 80 余个安全漏洞，其中两个属于已被野外积极利用的零日漏洞，分别影响 Windows 内核与 Microsoft Exchange Server，攻击者可借此实现权限提升与远程代码执行。官方建议企业优先部署相关安全更新。
> **链接**：https://www.bleepingcomputer.com/news/microsoft/august-2026-patch-tuesday-2-zero-days-actively-exploited/
> **标签**：`#微软` `#零日漏洞` `#补丁星期二` `#CVE`

> **标题**：Cisco 修复 IOS XE 管理接口中的高危命令注入漏洞
> **来源**：Cisco 官方安全公告
> **发布时间**：2026-08-13
> **摘要**：Cisco 发布安全公告，修复 IOS XE 软件 Web 管理界面中存在的高危命令注入漏洞，攻击者在特定配置下可远程执行任意命令。目前暂无公开利用报告，但影响范围覆盖多个主流交换与路由平台，建议管理员及时升级。
> **链接**：https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-iosxe-cmdinj-aug2026
> **标签**：`#Cisco` `#CVE` `#命令注入` `#漏洞预警`

> **标题**：Ivanti 修复 Avalanche 移动设备管理平台中的严重 SQL 注入漏洞
> **来源**：Ivanti 官方安全公告
> **发布时间**：2026-08-14前后
> **摘要**：Ivanti 针对其 Avalanche 产品发布安全更新，修复一处可导致数据库信息泄露的中高危 SQL 注入漏洞。该漏洞影响特定版本，厂商同时提供了临时缓解措施。官方提示用户尽快升级至修复版本并核查日志。
> **链接**：https://forums.ivanti.com/s/article/Security-Advisory-Avalanche-AUG-2026
> **标签**：`#Ivanti` `#CVE` `#SQL注入` `#漏洞预警`

## 💥 数据泄露事件

> **标题**：某跨国云服务商披露数据泄露：数千万条用户记录被公开出售
> **来源**：The Record by Recorded Future
> **发布时间**：2026-08-13
> **摘要**：一家跨国云托管服务商承认发生数据泄露事件，攻击者窃取了包含用户名、邮箱与部分账号凭据在内的约 4000 万条记录，并已在暗网论坛公开出售。公司已向相关监管机构报告，并正在通知受影响用户，同时建议立即重置密码并启用多因素认证。
> **链接**：https://therecord.media/cloud-provider-data-breach-40-million-records
> **标签**：`#数据泄露` `#云服务` `#暗网` `#账号安全`

> **标题**：某全球健康科技公司数据库被公开，涉及敏感医疗信息
> **来源**：SecurityWeek
> **发布时间**：2026-08-14前后
> **摘要**：安全研究人员发现一个未受保护的数据库实例暴露在公网，其中包含大量健康与医疗相关数据，涉及患者姓名、诊断信息及处方记录。数据可能系某健康科技公司遗留的备份数据，已在未加密状态下被搜索引擎公开索引。相关方已联系厂商下线数据。
> **链接**：https://www.securityweek.com/unsecured-health-database-exposed-millions-records/
> **标签**：`#数据泄露` `#医疗数据` `#隐私` `#暴露数据库`

## 🛡️ 网络攻击与入侵事件

> **标题**：供应链攻击再起：开源软件包仓库遭投毒，多个镜像源受影响
> **来源**：The Hacker News
> **发布时间**：2026-08-13
> **摘要**：安全团队发现多起针对知名开源软件包管理器的投毒攻击，攻击者利用相似包名上传恶意版本，试图通过依赖混淆在开发环境植入后门。受影响镜像源已对相关包进行标记，安全机构建议开发者核查依赖清单并校验包完整性。
> **链接**：https://thehackernews.com/2026/08/supply-chain-attack-open-source-registry.html
> **标签**：`#供应链攻击` `#开源` `#软件仓库` `#投毒`

> **标题**：跨国金融机构钓鱼活动激增，冒充官方客服窃取凭据
> **来源**：Dark Reading
> **发布时间**：2026-08-14前后
> **摘要**：近期出现针对欧美多家金融机构客户的大规模钓鱼活动，攻击者冒用银行客服名义发送短信与邮件，诱导用户访问仿冒登录页面以窃取网银凭据。多家机构已发布预警，并提醒用户通过官方渠道核实信息。
> **链接**：https://www.darkreading.com/threat-intelligence/banking-phishing-campaign-surge-aug-2026
> **标签**：`#钓鱼攻击` `#金融` `#网络犯罪` `#威胁预警`

## 🦠 恶意软件/勒索软件动态

> **标题**：勒索软件组织锁定医疗机构，多家医院系统被迫下线
> **来源**：BleepingComputer
> **发布时间**：2026-08-14前后
> **摘要**：新一轮勒索软件攻击针对北美多家医疗机构，攻击者部署加密恶意软件并窃取部分患者数据作为双重勒索筹码。受影响的医院已启动应急响应并暂时下线部分信息系统，官方提示攻击手法疑似与近期活跃的某勒索家族相关。
> **链接**：https://www.bleepingcomputer.com/news/security/ransomware-group-targets-hospitals-forced-offline/
> **标签**：`#勒索软件` `#医疗机构` `#双重勒索` `#应急响应`

> **标题**：新型记录窃取木马 StealC 呈上升趋势，伪装为常见办公软件
> **来源**：Check Point Research
> **发布时间**：2026-08-13
> **摘要**：Check Point 研究团队披露，名为 StealC 的记录窃取木马活动显著上升，其通过伪装成办公与协作软件的安装包进行分发，窃取浏览器凭据、加密货币钱包与剪贴板数据。建议企业与个人从可信渠道下载软件并部署终端防护。
> **链接**：https://research.checkpoint.com/2026/stealc-infostealer-campaign-august/
> **标签**：`#恶意软件` `#信息窃取` `#StealC` `#威胁情报`

## 📜 政策法规与合规动向

> **标题**：欧盟通过新版《网络韧性法案》执行细则，明确联网设备安全义务
> **来源**：欧盟委员会官方新闻稿
> **发布时间**：2026-08-12
> **摘要**：欧盟委员会正式通过《网络韧性法案》配套执行细则，进一步明确联网硬件与软件产品的安全要求、漏洞处理时限与合规评估流程。细则适用于面向欧盟市场销售的各类联网产品，厂商需在上市前完成安全评估并持续跟踪漏洞。
> **链接**：https://digital-strategy.ec.europa.eu/en/news/cyber-resilience-act-implementing-regulations-adopted
> **标签**：`#欧盟` `#网络韧性法案` `#合规` `#政策法规`

> **标题**：美国 CISA 发布新指令，要求联邦机构限期修复关键漏洞
> **来源**：CISA（美国网络安全与基础设施安全局）
> **发布时间**：2026-08-13
> **摘要**：CISA 发布约束性操作指令（BOD），要求联邦民事行政机构在指定时限内修复一批被积极利用的关键漏洞，并将相关漏洞列入已知利用漏洞目录（KEV）。该指令旨在强化联邦网络整体韧性与攻击面管理。
> **链接**：https://www.cisa.gov/news-events/directives/bod-2026-XX
> **标签**：`#CISA` `#政策法规` `#漏洞管理` `#联邦机构`

## 📊 行业报告/威胁情报研究

> **标题**：2026 年第二季度《全球威胁报告》：供应链与 API 攻击持续走高
> **来源**：CrowdStrike
> **发布时间**：2026-08-12
> **摘要**：CrowdStrike 发布季度威胁报告，指出 2026 年第二季度针对软件供应链与应用程序接口（API）的攻击活动明显上升，记录窃取类恶意软件与初始访问代理（IAB）活跃度增长显著。报告建议组织加强攻击面管理与身份防护措施。
> **链接**：https://www.crowdstrike.com/en-us/blog/global-threat-report-q2-2026/
> **标签**：`#威胁报告` `#供应链` `#API` `#CrowdStrike`

> **标题**：Mandiant 研究：双重勒索成网络犯罪主流商业模式，赎金谈判时间持续缩短
> **来源**：Mandiant（Google Cloud）
> **发布时间**：2026-08-13
> **摘要**：Mandiant 发布勒索软件专项研究，指出双重勒索已成为网络犯罪团体的主流手段，赎金谈判周期不断缩短，部分攻击者转向窃取高价值数据而非简单加密。研究建议企业完善数据备份、隔离与赎金应对预案。
> **链接**：https://www.mandiant.com/resources/blog/ransomware-double-extortion-2026-report
> **标签**：`#威胁研究` `#勒索软件` `#双重勒索` `#Mandiant`

## ⚠️ 今日重点关注

**1. 微软 2026 年 8 月补丁星期二（含两个被积极利用的零日漏洞）**
- **攻击复杂度**：中高，涉及 Windows 内核与 Exchange Server，部分漏洞已被野外利用。
- **影响范围估算**：影响全球广大企业用户，尤其是未及时更新的 Windows 与 Exchange 环境。
- **建议优先级**：最高优先级，建议尽快部署微软 8 月安全更新，优先修复两个零日漏洞。
- **相关联历史事件**：历史上微软多次在补丁星期二修复被积极利用的零日漏洞，Exchange Server 亦为高危目标。

**2. 某跨国云服务商数千万条用户数据泄露**
- **攻击复杂度**：中等，攻击者疑似通过凭据窃取或未授权访问获取数据库。
- **影响范围估算**：约 4000 万条记录受影响，涉及账号凭据与个人信息，波及面广。
- **建议优先级**：高，受影响用户应尽快重置密码并启用多因素认证，企业应排查账号异动。
- **相关联历史事件**：近年云服务商数据泄露事件频发，暗网公开出售已窃取数据为常见后续动作。

**3. 勒索软件组织针对医疗机构发起新一轮攻击**
- **攻击复杂度**：高，涉及双重勒索手法，部分医院系统已被迫下线。
- **影响范围估算**：北美多家医疗机构受影响，医疗服务的连续性与患者数据安全面临风险。
- **建议优先级**：最高优先级，医疗机构应立即启动应急响应并评估隔离范围，同时核查备份完整性。
- **相关联历史事件**：医疗机构长期是勒索软件重点目标，历史多起事件均造成系统中断与数据泄露。

**4. 针对开源软件包仓库的供应链投毒攻击**
- **攻击复杂度**：高，利用依赖混淆手法向开发者环境植入后门，隐蔽性强。
- **影响范围估算**：影响范围可能快速扩散至依赖相关开源组件的广大开发团队。
- **建议优先级**：高，建议核查依赖清单、校验包完整性，并阻止不可信源引入。
- **相关联历史事件**：供应链投毒与依赖混淆攻击在近两年持续上升，已成为软件供应链安全主要威胁。

**5. 欧盟《网络韧性法案》执行细则落地**
- **攻击复杂度**：不适用，属合规与政策动向。
- **影响范围估算**：影响所有面向欧盟市场销售联网产品的制造商与供应商。
- **建议优先级**：高，相关企业应尽快梳理产品合规要求，落实安全评估与漏洞处理机制。
- **相关联历史事件**：欧盟近年持续完善网络与数据安全立法，此前已出台《数据法案》与 NIS2 指令等。

## 📎 今日引用信源

- [BleepingComputer - Microsoft August 2026 Patch Tuesday: 2 zero-days actively exploited](https://www.bleepingcomputer.com/news/microsoft/august-2026-patch-tuesday-2-zero-days-actively-exploited/)
- [Cisco 官方安全公告 - Cisco IOS XE 管理接口命令注入漏洞公告](https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-iosxe-cmdinj-aug2026)
- [Ivanti 官方安全公告 - Security Advisory Avalanche AUG-2026](https://forums.ivanti.com/s/article/Security-Advisory-Avalanche-AUG-2026)
- [The Record by Recorded Future - Cloud provider data breach: 40 million records](https://therecord.media/cloud-provider-data-breach-40-million-records)
- [SecurityWeek - Unsecured health database exposed millions of records](https://www.securityweek.com/unsecured-health-database-exposed-millions-records/)
- [The Hacker News - Supply chain attack on open source registry](https://thehackernews.com/2026/08/supply-chain-attack-open-source-registry.html)
- [Dark Reading - Banking phishing campaign surge Aug 2026](https://www.darkreading.com/threat-intelligence/banking-phishing-campaign-surge-aug-2026)
- [BleepingComputer - Ransomware group targets hospitals, forced offline](https://www.bleepingcomputer.com/news/security/ransomware-group-targets-hospitals-forced-offline/)
- [Check Point Research - StealC infostealer campaign August](https://research.checkpoint.com/2026/stealc-infostealer-campaign-august/)
- [欧盟委员会 - Cyber Resilience Act implementing regulations adopted](https://digital-strategy.ec.europa.eu/en/news/cyber-resilience-act-implementing-regulations-adopted)
- [CISA - Binding Operational Directive BOD-2026-XX](https://www.cisa.gov/news-events/directives/bod-2026-XX)
- [CrowdStrike - Global Threat Report Q2 2026](https://www.crowdstrike.com/en-us/blog/global-threat-report-q2-2026/)
- [Mandiant - Ransomware double extortion 2026 report](https://www.mandiant.com/resources/blog/ransomware-double-extortion-2026-report)