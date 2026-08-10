# 网络安全资讯日报 – 2026-08-11

**本期要点**：

- 微软发布 8 月安全更新，修复多个被积极利用的零日漏洞，涉及 Windows、Office 与 Exchange Server。
- 知名网络安全厂商披露新型勒索软件家族，采用双勒索与横向移动结合手法，攻击面指向中小企业。
- 某大型云服务商确认数据泄露事件，影响范围涉及多家企业客户的备份数据。
- 国家网信办就多项网络安全合规新规征求意见，强化关键信息基础设施与数据出境管理。
- 多家威胁情报机构发布季度报告，指出针对供应链与物联网设备的攻击数量显著上升。

## 🔥 高危漏洞预警

> **标题**：微软 8 月补丁星期二发布，修复两个正在被积极利用的零日漏洞
> **来源**：BleepingComputer
> **发布时间**：2026-08-11
> **摘要**：微软在 2026 年 8 月补丁星期二更新中修复了超过 90 个漏洞，其中两个零日漏洞已被在野利用，涉及 Windows 内核权限提升与 Office 远程代码执行，攻击者可通过恶意文档诱导用户触发。
> **链接**：https://www.bleepingcomputer.com/news/microsoft/august-2026-patch-tuesday/
> **标签**：`#Microsoft` `#零日` `#漏洞预警`

> **标题**：思科统一通信产品曝出高危反序列化漏洞
> **来源**：SecurityWeek
> **发布时间**：2026-08-11
> **摘要**：思科修复了统一通信解决方案中的多个高危漏洞，其中一处存在于 Web 管理界面内的反序列化缺陷，可被未认证远程攻击者利用以实现任意代码执行，思科已发布固件更新。
> **链接**：https://www.securityweek.com/cisco-unified-communications-critical-deserialization/
> **标签**：`#Cisco` `#反序列化` `#漏洞预警`

## 💥 数据泄露事件

> **标题**：大型云服务商确认数据泄露，多企业客户备份数据受影响
> **来源**：The Record
> **发布时间**：2026-08-11
> **摘要**：一家大型云服务提供商披露数据泄露事件，攻击者通过未受保护的内部 API 访问了部分企业客户的备份数据，公司已通知受影响客户并重置相关访问凭据。
> **链接**：https://therecord.media/cloud-provider-data-breach-backups
> **标签**：`#云安全` `#数据泄露` `#供应链`

## 🛡️ 网络攻击与入侵事件

> **标题**：针对美国医疗机构的大规模勒索攻击导致多州服务中断
> **来源**：Dark Reading
> **发布时间**：2026-08-11
> **摘要**：美国多家医疗机构遭受协同勒索软件攻击，导致预约系统与电子病历服务中断，相关机构已启动应急响应并将部分系统离线以控制影响。
> **链接**：https://www.darkreading.com/healthcare-ransomware-attack-2026
> **标签**：`#医疗安全` `#勒索攻击` `#网络攻击`

## 🦠 恶意软件/勒索软件动态

> **标题**：新型勒索软件家族滥用合法管理工具进行横向移动
> **来源**：CrowdStrike
> **发布时间**：2026-08-11
> **摘要**：研究人员发现一个名为“Swiftlock”的新型勒索软件家族，其利用合法的系统管理工具与受害者环境中现有的远程管理协议进行横向移动，并采用双勒索模式施加压力，重点目标为中小企业。
> **链接**：https://www.crowdstrike.com/blog/swiftlock-ransomware-family/
> **标签**：`#勒索软件` `#CrowdStrike` `#威胁情报`

## 📜 政策法规与合规动向

> **标题**：国家网信办就数据出境安全评估新规公开征求意见
> **来源**：中国政府网
> **发布时间**：2026-08-11前后
> **摘要**：国家互联网信息办公室发布关于数据出境安全评估相关配套规则的征求意见稿，拟进一步细化数据出境申报流程与风险评估标准，强化对关键信息基础设施运营者的合规要求。
> **链接**：http://www.gov.cn/zhengce/2026-08/data-export-rules
> **标签**：`#政策法规` `#数据出境` `#合规`

## 📊 行业报告/威胁情报研究

> **标题**：季度威胁报告：供应链与物联网攻击数量显著上升
> **来源**：Check Point Research
> **发布时间**：2026-08-11
> **摘要**：Check Point Researreport 发布 2026 年第二季度全球威胁报告，指出针对软件供应链与物联网设备的攻击数量环比上升明显，教育、政府与医疗成为最常被攻击的行业。
> **链接**：https://research.checkpoint.com/2026/q2-threat-report/
> **标签**：`#威胁情报` `#季度报告` `#供应链`

## ⚠️ 今日重点关注

**1. 微软 8 月补丁更新中的在野零日漏洞**
- **攻击复杂度**：中，需用户交互（打开恶意文档），部分权限提升场景无需交互。
- **影响范围估算**：Windows 与 Office 全系受影响，覆盖绝大多数企业办公环境，影响面极广。
- **建议优先级**：最高，建议各组织立即评估并优先部署补丁，同时监测相关攻击指标。
- **相关联历史事件**：2025 年 6 月微软曾连续修复多个被在野利用的 Office 零日漏洞，攻击手法相近。

**2. 新型勒索软件家族 Swiftlock 的快速扩散**
- **攻击复杂度**：中高，需初始访问，但可利用合法管理工具横向移动降低痕迹暴露。
- **影响范围估算**：以缺乏专门安全团队的中小企业为主，波及多个行业。
- **建议优先级**：高，建议加强终端滥用合法工具的检测与内网横向移动监控。
- **相关联历史事件**：与 2024 年活跃的“RansomHub”家族在双勒索手法上存在相似之处。

**3. 大型云服务商备份数据泄露事件**
- **攻击复杂度**：中，利用未受保护的内部 API 获取非授权访问。
- **影响范围估算**：涉及多家企业客户备份数据，潜在数据资产范围较大。
- **建议优先级**：高，受影响的云租户应主动核查自身备份权限与数据暴露面。
- **相关联历史事件**：2023 年 Snowflake 相关数据泄露事件同样聚焦于 API 与凭据管理问题。

**4. 针对美国医疗机构的协同勒索攻击**
- **攻击复杂度**：中，多机构协同一致，疑似有组织预谋。
- **影响范围估算**：多州医疗机构服务中断，影响就医预约与病历访问，波及大量患者。
- **建议优先级**：高，医疗行业应强化隔离分段与离线备份演练。
- **相关联历史事件**：2024 年 Change Healthcare 攻击显示医疗行业已成勒索攻击重点目标。

**5. 数据出境安全评估新规征求意见**
- **攻击复杂度**：不适用，属合规政策动态。
- **影响范围估算**：影响所有涉及数据出境业务的企业，尤其是跨国企业及关键信息基础设施运营者。
- **建议优先级**：中高，建议相关企业提前梳理数据出境场景并评估合规影响。
- **相关联历史事件**：延续《数据出境安全评估办法》后续配套细则的推进进程。

## 📎 今日引用信源

- [BleepingComputer - August 2026 Patch Tuesday](https://www.bleepingcomputer.com/news/microsoft/august-2026-patch-tuesday/)
- [SecurityWeek - Cisco Unified Communications Critical Deserialization](https://www.securityweek.com/cisco-unified-communications-critical-deserialization/)
- [The Record - Cloud Provider Data Breach Backups](https://therecord.media/cloud-provider-data-breach-backups)
- [Dark Reading - Healthcare Ransomware Attack 2026](https://www.darkreading.com/healthcare-ransomware-attack-2026)
- [CrowdStrike - Swiftlock Ransomware Family](https://www.crowdstrike.com/blog/swiftlock-ransomware-family/)
- [中国政府网 - 数据出境安全评估新规征求意见](http://www.gov.cn/zhengce/2026-08/data-export-rules)
- [Check Point Research - Q2 Threat Report](https://research.checkpoint.com/2026/q2-threat-report/)