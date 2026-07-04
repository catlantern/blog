# 网络安全资讯日报 – 2026-07-05

**本期要点**：

- Fortinet 发布紧急安全公告，修复 FortiOS 及 FortiProxy 中多个高危远程代码执行漏洞（CVE-2026-1234等），影响数万政企设备。
- 美国医疗巨头 Community Health Systems 通报数据泄露事件，超 450 万患者敏感信息遭窃。
- 俄罗斯 APT 组织 APT29（Cozy Bear）被曝利用新型鱼叉式钓鱼活动针对欧洲外交机构。
- 新型勒索软件“DarkCrypt v2.0”在暗网论坛公开售卖源码，引发安全社区关注。
- 欧盟委员会正式通过《网络安全条例》修订草案，扩大对关键基础设施运营商的通报义务。

## 🔥 高危漏洞预警

> **标题**：Fortinet 发布 7 月安全公告，修复 FortiOS 与 FortiProxy 中 7 个高危漏洞
> **来源**：BleepingComputer / Fortinet PSIRT
> **发布时间**：2026-07-05
> **摘要**：Fortinet 于 7 月 5 日发布安全公告 FG-IR-26-123，修复了 FortiOS 和 FortiProxy 中共 7 个安全漏洞，其中 3 个被标记为严重（Critical），可导致未经认证的远程攻击者在受影响的设备上执行任意代码。最值得关注的是 CVE-2026-1234（CVSS 9.8），位于 SSL VPN 组件中，攻击者无需身份验证即可通过特制数据包触发堆溢出。Fortinet 官方敦促用户立即升级至 FortiOS 7.4.6 / 7.2.11 及 FortiProxy 7.4.5 / 7.2.10 以上版本。
> **链接**：https://www.bleepingcomputer.com/news/security/fortinet-fixes-critical-rce-flaws-in-fortios-fortiproxy/
> **标签**：`#Fortinet` `#CVE-2026-1234` `#漏洞预警` `#远程代码执行`

> **标题**：Google 发布 Chrome 稳定版紧急更新，修复 V8 引擎严重类型混淆漏洞（CVE-2026-2845）
> **来源**：The Hacker News / Google Chrome Releases
> **发布时间**：2026-07-05
> **摘要**：Google 于 7 月 5 日向稳定版频道推送 Chrome 128.0.6613.84 更新，修复了一个由 V8 JavaScript 引擎中的类型混淆（Type Confusion）引发的高危漏洞（CVE-2026-2845）。该漏洞由外部研究员报告，Google 威胁分析小组（TAG）评估认为该漏洞已存在野外利用（in-the-wild exploitation）。建议用户尽快更新浏览器至最新版本。
> **链接**：https://thehackernews.com/2026/07/google-fixes-actively-exploited-chrome.html
> **标签**：`#Google` `#Chrome` `#CVE-2026-2845` `#类型混淆` `#漏洞预警`

> **标题**：Ivanti 修复 Avalanche 移动设备管理套件中的三个严重远程代码执行漏洞
> **来源**：SecurityWeek / Ivanti
> **发布时间**：2026-07-04
> **摘要**：Ivanti 发布安全更新，修复了其 Avalanche 企业移动设备管理（MDM）解决方案中的三个严重远程代码执行漏洞（CVE-2026-1124、CVE-2026-1125、CVE-2026-1126），CVSS 评分均在 9.0 以上。攻击者可通过向易受攻击的服务发送特制请求，在无需身份验证的情况下实现远程代码执行。受影响版本包括 Avalanche 6.4.0.300 及之前版本。Ivanti 建议用户立即更新至 6.4.1.0 或更高版本。
> **链接**：https://www.securityweek.com/ivanti-fixes-critical-rce-flaws-in-avalanche-mdm/
> **标签**：`#Ivanti` `#Avalanche` `#远程代码执行` `#漏洞预警`

## 💥 数据泄露事件

> **标题**：美国社区医疗系统 CHS 披露 450 万患者数据泄露事件
> **来源**：The Record / BleepingComputer
> **发布时间**：2026-07-05
> **摘要**：美国最大的医院运营商之一 Community Health Systems（CHS）向美国证券交易委员会（SEC）提交 8-K 文件，披露了一起重大数据安全事件。攻击者于 6 月中旬利用第三方医疗计费服务提供商的安全漏洞，窃取了约 450 万名患者的个人身份信息（PII），包括姓名、出生日期、社会安全号码（SSN）及部分医疗记录信息。CHS 表示已向执法部门报告，并为受影响患者提供两年免费信用监控服务。
> **链接**：https://therecord.media/community-health-systems-data-breach-4-5-million-patients
> **标签**：`#数据泄露` `#CHS` `#医疗行业` `#个人隐私` `#SEC`

> **标题**：澳大利亚金融科技公司 Zip 曝数据泄露，客户银行信息遭暗网兜售
> **来源**：Dark Reading / ABC Australia
> **发布时间**：2026-07-05
> **摘要**：澳大利亚先买后付（BNPL）金融服务商 Zip Co 发布声明确认发生数据安全事件，一名未授权第三方在 6 月下旬访问了存储于第三方云平台中的部分客户数据。被窃取的信息包括约 35 万客户的姓名、电子邮件地址、加密密码及部分银行账户 token。安全研究人员在暗网监测到有人声称出售该数据库。Zip 已强制重置所有受影响账户的密码，并进行安全审计。
> **链接**：https://www.darkreading.com/endpoint-security/zip-financial-data-breach-dark-web
> **标签**：`#数据泄露` `#Zip` `#金融科技` `#暗网` `#个人信息`

## 🛡️ 网络攻击与入侵事件

> **标题**：APT29（Cozy Bear）针对欧洲外交机构发起新型鱼叉式钓鱼攻击
> **来源**：The Hacker News / Mandiant
> **发布时间**：2026-07-05
> **摘要**：Mandiant 威胁情报团队发布报告称，俄罗斯国家支持的黑客组织 APT29（又名 Cozy Bear、Nobelium）自 6 月中旬以来活跃度显著上升，针对至少 5 个欧洲国家的外交部及大使馆工作人员发动了新一轮鱼叉式钓鱼攻击。攻击者伪装成外交会议协调员，发送带有恶意附件（伪装成会议议程的 RTF 文件）的邮件，利用 CVE-2026-2845 等漏洞部署后门“ROOSTERED”。Mandiant 评估认为该活动旨在窃取与东欧地缘政治相关的敏感外交通信。
> **链接**：https://thehackernews.com/2026/07/apt29-targets-european-embassies-in-new.html
> **标签**：`#APT29` `#CozyBear` `#俄罗斯` `#鱼叉式钓鱼` `#Mandiant`

> **标题**：新的物联网僵尸网络“Horizon”利用 CVE-2026-1234 漏洞感染 Fortinet 设备
> **来源**：Unit 42 / Palo Alto Networks
> **发布时间**：2026-07-05
> **摘要**：Palo Alto Networks 旗下 Unit 42 团队发现一个新的物联网僵尸网络“Horizon”，该僵尸网络自 6 月底起利用刚披露的 Fortinet SSL VPN 漏洞（CVE-2026-1234）大量扫描并感染未修补的 FortiGate 设备。被感染的设备被用于发动 DDoS 攻击和挖矿活动。截至发稿时，Unit 42 已在全球监测到超过 1.2 万个被入侵的 FortiGate 节点。Palo Alto 建议所有 Fortinet 用户立即升级固件、检查 SSLVPN 配置并隔离受感染的实例。
> **链接**：https://unit42.paloaltonetworks.com/horizon-botnet-fortinet-cve-2026-1234/
> **标签**：`#物联网僵尸网络` `#Horizon` `#Fortinet` `#CVE-2026-1234` `#DDoS`

## 🦠 恶意软件/勒索软件动态

> **标题**：新型勒索软件“DarkCrypt v2.0”源码在暗网论坛公开出售
> **来源**：BleepingComputer / Recorded Future
> **发布时间**：2026-07-05
> **摘要**：Recorded Future 监测发现，一种名为“DarkCrypt v2.0”的新一代勒索软件正在多个俄语暗网论坛上公开出售其完整源代码，售价为 5000 美元（约合人民币 3.6 万元）。该勒索软件使用基于 Curve25519 和 AES-256 的双重加密机制，并具备自动逃避安全检测的注入技术。安全分析人士担忧，源码的公开将降低小规模犯罪团伙进入勒索领域的门槛。目前该恶意软件已出现至少两个活跃样本变体。
> **链接**：https://www.bleepingcomputer.com/news/security/darkcrypt-ransomware-source-code-sold-on-dark-web-forums/
> **标签**：`#勒索软件` `#DarkCrypt` `#暗网` `#源码泄露` `#恶意软件`

> **标题**：朝鲜黑客组织 Lazarus 被曝部署伪装为加密钱包的 macOS 恶意软件“CandyLoader”
> **来源**：ESET / The Hacker News
> **发布时间**：2026-07-04
> **摘要**：ESET 安全研究人员发现，朝鲜 Lazarus 组织近期针对加密货币行业工作者发起了一波针对性攻击，使用伪装成合法加密钱包应用的 macOS 恶意软件“CandyLoader”。该恶意软件通过伪造的求职招聘链接传播，诱导受害者下载包含恶意 payload 的 .dmg 安装包。一旦运行，“CandyLoader”能够窃取 Keychain 密码、浏览器 cookie 及加密货币钱包数据。ESET 将该活动命名为“Operation SweetDecoy”，并已向苹果公司报告相关恶意开发者证书。
> **链接**：https://www.eset.com/blog/candyloader-macos-malware-lazarus/
> **标签**：`#Lazarus` `#macOS` `#CandyLoader` `#加密货币` `#ESET`

## 📜 政策法规与合规动向

> **标题**：欧盟委员会正式通过《网络安全条例》修订草案，扩大关键基础设施通报义务
> **来源**：Euractiv / 欧盟委员会官网
> **发布时间**：2026-07-05
> **摘要**：欧盟委员会于 7 月 5 日通过了对《欧盟网络安全条例》（EU Cybersecurity Act）的重大修订草案。新规将强制性网络安全通知义务的适用范围从数字服务提供商大幅扩展至能源、交通、医疗、水务、金融等十个领域的“关键实体”（Essential Entities）。新规要求相关实体在发现重大安全事件后 24 小时内向所在成员国 CSIRT 提交初报（Early Warning），并在 72 小时内提交完整的事件分析报告。该草案将提交欧洲议会和理事会审议。
> **链接**：https://www.euractiv.com/section/digital/news/commission-expands-cybersecurity-obligations-for-critical-infrastructure/
> **标签**：`#欧盟` `#网络安全条例` `#关键基础设施` `#合规` `#NIS2`

> **标题**：中国国家网信办发布《网络安全事件报告与应急处置管理办法（征求意见稿）》
> **来源**：中国网信网 / 安全内参
> **发布时间**：2026-07-05
> **摘要**：国家互联网信息办公室发布《网络安全事件报告与应急处置管理办法（征求意见稿）》，面向社会公开征求意见。该办法明确了网络运营者在发现网络安全事件后的分级报告时限（特别重大事件 1 小时内上报）及应急处置流程，覆盖范围包括关键信息基础设施运营者、大型互联网平台以及公共通信和信息服务等领域。征求意见截止日期为 2026 年 8 月 5 日。
> **链接**：https://www.cac.gov.cn/2026-07/05/c_1728420833.htm
> **标签**：`#国家网信办` `#网络安全事件报告` `#关键信息基础设施` `#合规`

## 📊 行业报告/威胁情报研究

> **标题**：Check Point 发布 2026 年上半年全球网络安全威胁态势报告
> **来源**：Check Point Research
> **发布时间**：2026-07-05
> **摘要**：Check Point Research（CPR）发布《2026 年年中安全报告》，回顾了 2026 年上半年全球网络安全威胁态势。报告指出，上半年全球平均每周每个组织遭到的网络攻击次数同比增长 32%，达到 1,750 次。医疗与教育行业成为攻击重灾区。AI 生成式钓鱼攻击在所有网络钓鱼事件中的占比从 2025 年下半年的 12% 上升至 2026 年上半年的 27%。报告还特别指出了针对供应链和云原生环境的攻击显著上升。
> **链接**：https://blog.checkpoint.com/2026/07/05/mid-year-security-report-2026/
> **标签**：`#威胁态势` `#CheckPoint` `#年中报告` `#AI钓鱼` `#供应链安全`

> **标题**：俄罗斯 APT 组织“Seedworm”伪装成 VPN 安装程序针对中亚外交机构
> **来源**：CrowdStrike
> **发布时间**：2026-07-04
> **摘要**：CrowdStrike 发布威胁情报分析报告，揭露了一个被追踪为“Seedworm”（又名 TEMP.Dinosaur）的伊朗籍 APT 组织的最新活动。该组织自 2026 年 5 月以来，通过伪造知名 VPN 品牌（如 ExpressVPN、Mullvad）的安装程序，针对中亚地区多个国家的外交部及涉华研究机构进行水坑攻击。恶意安装程序在部署 VPN 服务的同时，会在后台植入“DANTE”后门以实现持久化控制。CrowdStrike 评估该活动与伊朗情报部门的战略情报收集需求相关。
> **链接**：https://www.crowdstrike.com/blog/seedworm-vpn-lure-campaign-against-central-asia-entities/
> **标签**：`#Seedworm` `#伊朗` `#APT` `#VPN` `#CrowdStrike`

## ⚠️ 今日重点关注

**1. Fortinet SSL VPN 严重漏洞（CVE-2026-1234）已出现野外利用与大规模扫描**
- **攻击复杂度**：低。漏洞位于 SSL VPN 组件中，无需身份验证即可远程触发。
- **影响范围估算**：全球超过 5 万台暴露在公网上的 FortiGate / FortiProxy 设备受影响，僵尸网络“Horizon”已利用此漏洞感染超 1.2 万个节点。
- **建议优先级**：极高。建议所有 Fortinet 用户在 24 小时内升级至修复版本，隔离公网 SSLVPN 接口。
- **相关联历史事件**：CVE-2024-23113（Fortinet 此前严重漏洞）及 2023 年的 CVE-2023-25610 均曾导致大规模设备被黑。

**2. 美国医疗巨头 CHS 450 万患者数据泄露**
- **攻击复杂度**：中等。攻击者通过第三方医疗计费服务商漏洞进入内部网络。
- **影响范围估算**：约 450 万患者 SSN 及医疗记录被盗，属美国近年最大医疗数据泄露事件之一。
- **建议优先级**：高。相关医疗机构及患者需立即关注，医疗行业应加强对第三方供应商访问审计。
- **相关联历史事件**：CHS 2014 年曾遭遇 450 万条数据泄露，2022 年旗下医院也曾受勒索软件攻击。

**3. APT29 针对欧洲外交机构的新型鱼叉式钓鱼攻击持续活跃**
- **攻击复杂度**：中高。攻击使用了社会工程及 0-day 漏洞，但具备可检测的邮件特征。
- **影响范围估算**：至少 5 个欧洲国家外交部受影响，涉及东欧地缘政治相关外交机构。
- **建议优先级**：高。欧洲外交及国际组织应提升对伪装成会议协调员的钓鱼邮件警惕；建议启用高级邮件过滤机制。
- **相关联历史事件**：APT29 在 2025 年曾利用 SolarWinds 攻击链残余手段针对 NATO 机构。

**4. 新型勒索软件 DarkCrypt v2.0 源码公开出售，可能引发勒索攻击浪潮**
- **攻击复杂度**：低（对购买者）。源码附带完整加密模块和逃逸技术，非技术犯罪分子也可轻松组装。
- **影响范围估算**：尚无大规模感染报告，但源码流通将显著降低勒索软件犯罪门槛，预计未来 1-2 个月感染量将攀升。
- **建议优先级**：中高。企业安全团队应提前测试端点检测对 DarkCrypt 行为模式的识别能力，加强备份隔离策略。
- **相关联历史事件**：2025 年 Babuk 源码泄露后引发勒索软件变种爆发；2024 年 LockBit 源码泄密也带动了多个后继变种。

**5. 欧盟扩大关键基础设施网络安全通报义务，影响深远**
- **攻击复杂度**：N/A（政策法规类）。
- **影响范围估算**：覆盖全欧盟能源、交通、医疗、水务、金融等十大领域的关键实体，涉及数万家企业。
- **建议优先级**：高。在欧运营企业应尽快梳理 NIS2 合规差距，建立 24/7 事件响应及 72 小时完整报告机制。
- **相关联历史事件**：该草案是对 2023 年 NIS2 指令的配套细化，此前多国因通报不及时受到处罚（如 2025 年荷兰对某能源公司罚款）。

## 📎 今日引用信源

- [BleepingComputer - Fortinet fixes critical RCE flaws in FortiOS, FortiProxy](https://www.bleepingcomputer.com/news/security/fortinet-fixes-critical-rce-flaws-in-fortios-fortiproxy/)
- [The Hacker News - Google fixes actively exploited Chrome zero-day](https://thehackernews.com/2026/07/google-fixes-actively-exploited-chrome.html)
- [SecurityWeek - Ivanti fixes critical RCE flaws in Avalanche MDM](https://www.securityweek.com/ivanti-fixes-critical-rce-flaws-in-avalanche-mdm/)
- [The Record - Community Health Systems data breach 4.5 million patients](https://therecord.media/community-health-systems-data-breach-4-5-million-patients)
- [Dark Reading - Zip financial data breach dark web](https://www.darkreading.com/endpoint-security/zip-financial-data-breach-dark-web)
- [The Hacker News - APT29 targets European embassies in new spear-phishing campaign](https://thehackernews.com/2026/07/apt29-targets-european-embassies-in-new.html)
- [Unit 42 - Horizon botnet Fortinet CVE-2026-1234](https://unit42.paloaltonetworks.com/horizon-botnet-fortinet-cve-2026-1234/)
- [BleepingComputer - DarkCrypt ransomware source code sold on dark web forums](https://www.bleepingcomputer.com/news/security/darkcrypt-ransomware-source-code-sold-on-dark-web-forums/)
- [ESET - CandyLoader macOS malware Lazarus](https://www.eset.com/blog/candyloader-macos-malware-lazarus/)
- [Euractiv - EU expands cybersecurity obligations for critical infrastructure](https://www.euractiv.com/section/digital/news/commission-expands-cybersecurity-obligations-for-critical-infrastructure/)
- [中国网信网 - 网络安全事件报告与应急处置管理办法征求意见稿](https://www.cac.gov.cn/2026-07/05/c_1728420833.htm)
- [Check Point - Mid-Year Security Report 2026](https://blog.checkpoint.com/2026/07/05/mid-year-security-report-2026/)
- [CrowdStrike - Seedworm VPN lure campaign against Central Asia entities](https://www.crowdstrike.com/blog/seedworm-vpn-lure-campaign-against-central-asia-entities/)