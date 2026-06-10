# 网络安全资讯日报 – 2026年5月19日

**本期要点**：
1. 「MiniPlasma」Windows零日漏洞PoC公开，完全打补丁的Windows 11仍可被提权至SYSTEM
2. 微软Exchange Server XSS零日漏洞(CVE-2026-42897)在野利用持续，香港政府CERT已发高危警报
3. CISA将思科SD-WAN满分漏洞(CVSS 10.0)列入已知被利用漏洞(KEV)目录，联邦机构限期修复
4. 富士康北美工厂遭Nitrogen勒索软件攻击，约8TB数据（含Apple、Nvidia客户信息）被窃
5. 国家数据局印发《2026年数字经济发展工作要点》，强调网络安全与数据安全

---

## 🔥 高危漏洞预警

> **标题**：「MiniPlasma」零日漏洞：全补丁Windows 11仍可提权至SYSTEM
> **来源**：香港政府电脑保安事故协调中心(GovCERT HK) / Notebookcheck
> **发布时间**：2026-05-19 02:34
> **摘要**：安全研究员Chaotic Eclipse发布名为「MiniPlasma」的Windows权限提升零日漏洞PoC，该漏洞追踪编号为CVE-2020-17103，影响Windows Cloud Files Mini Filter Driver。即使用户安装了最新的2026年5月补丁星期二更新，攻击者仍可利用该漏洞从低权限账户提升至SYSTEM级别。该漏洞本应在2020年修复，但修复不完整导致五年后仍可被利用。
> **链接**：https://www.govcert.gov.hk/tc/alerts_detail.php?id=1875
> **标签**：`#零日漏洞` `#Windows` `#提权` `#PoC`

> **标题**：微软Exchange Server XSS零日漏洞(CVE-2026-42897)已遭在野利用
> **来源**：安全内参 / 香港GovCERT / Notebookcheck
> **发布时间**：2026-05-18
> **摘要**：微软确认CVE-2026-42897（CVSS 8.1）正在被黑客积极利用。该漏洞为Exchange Server中的跨站脚本(XSS)漏洞，攻击者可通过发送伪造电子邮件在受害者浏览器中执行任意JavaScript。仅影响本地部署的Exchange Server，Exchange Online不受影响。香港CERT已发布高危警报(A26-05-28)。
> **链接**：https://www.secrss.com/articles/90456
> **标签**：`#Exchange` `#零日漏洞` `#XSS` `#在野利用`

> **标题**：CISA紧急点名：思科SD-WAN满分漏洞(CVE-2026-20182)列入KEV
> **来源**：至顶网网络与安全频道 / 网易
> **发布时间**：2026-05-18
> **摘要**：思科披露影响Catalyst SD-WAN Controller与SD-WAN Manager平台的身份验证绕过漏洞CVE-2026-20182，CVSS评分10.0（最高严重级别）。CISA已将其列入已知被利用漏洞(KEV)目录，要求联邦文职行政部门(FCEB)机构限期修复。该漏洞已于2026年5月被检测到在野利用。
> **链接**：https://net.zhiding.cn/network_security_zone/2026/0518/3187293.shtml
> **标签**：`#CISA` `#思科` `#SD-WAN` `#CVSS10`

> **标题**：Windows内核权限提升漏洞(CVE-2026-40369)安全风险通告
> **来源**：安全内参（奇安信）
> **发布时间**：2026-05-18
> **摘要**：奇安信发布安全风险通告，披露Windows内核权限提升漏洞CVE-2026-40369（QVD-2026-25963），CVSS评分7.8，影响量级达千万级，评级为高危。
> **链接**：https://www.secrss.com/articles/90469
> **标签**：`#Windows内核` `#权限提升` `#奇安信`

> **标题**：AI发现潜伏18年NGINX高危漏洞(CVE-2026-42945)，全球近三分之一网站面临RCE风险
> **来源**：太平洋科技 / 安全内参
> **发布时间**：2026-05-15
> **摘要**：初创公司depthfirst的AI安全分析系统自主发现潜伏18年的NGINX关键漏洞CVE-2026-42945，CVSS评分9.2。漏洞位于ngx_http_rewrite_module模块，属堆缓冲区溢出，攻击者可实现远程代码执行(RCE)。影响全球约三分之一的网站服务器。
> **链接**：https://www.pconline.com.cn/ai/2150/21509371.html
> **标签**：`#NGINX` `#AI漏洞挖掘` `#RCE` `#CVSS9.2`

---

## 💥 数据泄露事件

> **标题**：富士康(Foxconn)北美工厂遭Nitrogen勒索软件攻击，约8TB数据被窃
> **来源**：IT之家 / Notebookcheck / Digitimes
> **发布时间**：2026-05-13
> **摘要**：富士康确认其位于美国威斯康星州Mount Pleasant的工厂及德州工厂遭勒索软件攻击。Nitrogen勒索软件组织声称窃取了约8TB数据，涉及超1100万份文件，包含Apple、Nvidia、AMD、Google、Intel等客户的机密项目资料。富士康表示受影响的工厂"目前正在恢复正常生产"。
> **链接**：https://www.ithome.com/0/949/600.htm
> **标签**：`#富士康` `#勒索软件` `#数据泄露` `#供应链攻击`

---

## 🛡️ 网络攻击与入侵事件

> **标题**：卡巴斯基发现Daemon Tools官网遭供应链攻击
> **来源**：新浪财经（卡巴斯基GReAT团队）
> **发布时间**：2026-05-14
> **摘要**：卡巴斯基全球研究与分析团队(GReAT)发现一起正在进行的供应链攻击，针对Daemon Tools官方网站。被篡改的安装程序在交付合法应用的同时植入恶意代码。Daemon Tools是全球广泛使用的虚拟光驱模拟软件，用户基数庞大。
> **链接**：https://cj.sina.com.cn/articles/view/3948743169/eb5d0a0100101cqkq
> **标签**：`#供应链攻击` `#DaemonTools` `#卡巴斯基`

---

## 🦠 恶意软件/勒索软件动态

> **标题**：Nitrogen勒索软件组织攻击富士康北美工厂
> **来源**：Notebookcheck / Digitimes
> **发布时间**：2026-05-14
> **摘要**：5月11日，Nitrogen勒索软件组织声称对富士康北美工厂实施攻击。该组织窃取8TB数据后索要赎金。此次攻击凸显了台湾制造业在网络安全防护方面的差距，也暴露了大型代工厂作为供应链环节所面临的特殊风险。
> **链接**：https://www.digitimes.com/news/a20260514PD208/foxconn-wisconsin-cybersecurity-plant-security.html
> **标签**：`#Nitrogen` `#勒索软件` `#富士康` `#制造业`

---

## 📜 政策法规与合规动向

> **标题**：国家数据局印发《2026年数字经济发展工作要点》
> **来源**：国家数据局 / 界面新闻
> **发布时间**：2026-05-19
> **摘要**：为全面贯彻落实党的二十大和二十届历次全会精神，落实"十五五"规划纲要任务部署，国家数据局印发《2026年数字经济发展工作要点》，其中包含数据安全治理、网络安全基础设施建设等重点方向。
> **链接**：https://www.nda.gov.cn/sjj/swdt/xwfb/0519/20260519194643007508935_pc.html
> **标签**：`#数据安全` `#数字经济` `#国家数据局` `#政策`

> **标题**：美国加大网络安全战略力度：FCC禁令与网络行动新动向
> **来源**：联合早报
> **发布时间**：2026-05-18
> **摘要**：美国联邦通信委员会(FCC)近期对外国制造的消费级路由器实施禁令，结合美国根据"绝对决心行动"对委内瑞拉开展的网络行动，显示美国2026年网络安全战略正从被动防御转向主动威慑。
> **链接**：https://www.zaobao.com/forum/views/story20260518-9067084
> **标签**：`#美国网络安全` `#FCC` `#路由器禁令` `#地缘政治`

---

## 📊 行业报告/威胁情报研究

> **标题**：谷歌报告：黑客首次利用AI发现零日漏洞并发起攻击
> **来源**：腾讯新闻（谷歌威胁情报小组）
> **发布时间**：2026-05-13
> **摘要**：5月12日，谷歌在研究报告中称成功阻止黑客利用AI模型实施"大规模漏洞利用行动"的企图。这是首次发现黑客组织利用AI发现未知零日漏洞并试图发起大规模网络攻击。该攻击工具针对一款流行的开源基于网页的系统管理工具，利用Python脚本实现，可绕过双重认证。
> **链接**：https://news.qq.com/rain/a/20260513A05PVQ00
> **标签**：`#AI攻击` `#零日漏洞` `#谷歌` `#威胁情报`

> **标题**：Picus发布2026红色报告：十大高频MITRE ATT&CK攻击技术
> **来源**：发现报告
> **发布时间**：2026-05-15
> **摘要**：Picus安全发布2026年度红色报告，分析十大高频MITRE ATT&CK攻击技术，指出"数字寄生虫"的崛起与静默持久化战略转向，为安全团队提供防御优先级参考。
> **链接**：https://www.fxbaogao.com/detail/5420149
> **标签**：`#MITRE ATT&CK` `#威胁报告` `#Picus`

> **标题**：AV-Comparatives发布2026年EDR检测能力验证测试结果
> **来源**：全球TMT
> **发布时间**：2026-05-15
> **摘要**：AV-Comparatives发布2026年EDR检测能力验证测试结果，九款解决方案获认证。测试针对真实14阶段APT场景，每一步均独立评估检测能力。
> **链接**：https://www.tmtnews.tech/archives/55891
> **标签**：`#EDR` `#AV-Comparatives` `#APT检测`

---

## 💼 安全市场/产品/融资并购

> **标题**：红杉资本预测2026年将迎来AGI时代，引发安全新挑战思考
> **来源**：人人都是产品经理
> **发布时间**：2026-05-18
> **摘要**：红杉资本在AI Ascent活动上预测2026年将迎来AGI时代，深入剖析AI Agent技术从实验室走向商业落地的趋势。AI Agent的安全管理（如OfficeClaw纵深防御体系）成为业界关注热点，Agent安全架构需求日益迫切。
> **链接**：https://www.woshipm.com/ai/6396570.html
> **标签**：`#AI安全` `#AGI` `#红杉资本` `#Agent安全`

---

**⚠️ 今日重点关注**

**1. 「MiniPlasma」Windows Cloud Files Mini Filter Driver零日漏洞（CVE-2020-17103）**
- **攻击复杂度**：中（需本地低权限账户，PoC已公开）
- **影响范围估算**：影响所有Windows 11及Windows Server系统，千万级设备
- **建议优先级**：**24小时内处置** — 微软早在2020年尝试修复但未彻底根除，此次PoC公开后预计很快将被恶意集成到勒索软件工具包中。建议监控微软后续补丁更新并在修复前限制本地用户登录。
- **相关联历史事件**：该漏洞与2020年CVE-2020-17103为同一漏洞根因的修复绕过，类似Windows提权漏洞此前已被多个APT组织（如Lazarus）用于权限维持。

**2. 微软Exchange Server XSS零日漏洞（CVE-2026-42897）在野利用**
- **攻击复杂度**：低（攻击者仅需发送特制电子邮件）
- **影响范围估算**：影响所有本地部署的Microsoft Exchange Server，全球估计数十万服务器
- **建议优先级**：**24小时内处置** — 漏洞已确认在野利用，且攻击门槛极低。建议立即安装微软2026年5月安全更新，在无法立即打补丁的情况下限制OWA访问并启用AMSI。
- **相关联历史事件**：Exchange Server历来是APT攻击的高价值目标（参考2021年ProxyLogon、2022年ProxyShell等系列漏洞），本次漏洞可能被用于初始访问。

**3. 思科SD-WAN满分漏洞（CVE-2026-20182）**
- **攻击复杂度**：中（无需认证，但需网络访问SD-WAN管理接口）
- **影响范围估算**：影响思科Catalyst SD-WAN Controller和SD-WAN Manager产品线，企业广域网用户
- **建议优先级**：**一周内修复** — CVSS 10.0满分漏洞且已被CISA列入KEV，联邦机构必须限期修复。建议立即隔离SD-WAN管理接口的公网暴露并安装思科安全更新。
- **相关联历史事件**：思科产品此前多次出现SD-WAN相关漏洞（如2023年CVE-2023-20007等），但CVSS满分漏洞极其罕见。

**4. 富士康数据泄露事件后续影响评估**
- **攻击复杂度**：信息暂未公开（Nitrogen组织可能通过钓鱼或弱口令入侵）
- **影响范围估算**：约8TB数据（1100万+文件），涉及Apple、Nvidia、AMD、Google、Intel等科技巨头的供应链机密
- **建议优先级**：**关注即可** — 事件发生在5月12日，目前仍在调查中。建议相关供应链企业排查自身与富士康的数据交互接口，关注是否涉及自身客户数据泄露。
- **相关联历史事件**：富士康2020年也曾遭勒索软件攻击（DoppelPaymer组织），当时被索要约3400万美元赎金。

**5. AI驱动的零日漏洞挖掘成为新趋势**
- **攻击复杂度**：低（攻击者侧使用AI工具）
- **影响范围估算**：全球范围的漏洞生态影响
- **建议优先级**：**关注即可** — 谷歌首次发现黑客利用AI模型发现并利用零日漏洞，同时depthfirst的AI也自主发现了NGINX潜伏18年的漏洞。这标志着进攻性AI正在加速漏洞发现周期，企业需提前规划AI驱动的漏洞管理策略。
- **相关联历史事件**：这是首次公开记录的黑客利用AI进行漏洞挖掘和利用的事件，具有里程碑意义。

**📎 今日引用信源**
- [香港政府电脑保安事故协调中心 - MiniPlasma警报](https://www.govcert.gov.hk/tc/alerts_detail.php?id=1875)
- [安全内参 - Exchange Server零日漏洞](https://www.secrss.com/articles/90456)
- [安全内参 - Windows内核提权漏洞](https://www.secrss.com/articles/90469)
- [至顶网 - 思科SD-WAN满分漏洞](https://net.zhiding.cn/network_security_zone/2026/0518/3187293.shtml)
- [太平洋科技 - NGINX AI发现RCE漏洞](https://www.pconline.com.cn/ai/2150/21509371.html)
- [IT之家 - 富士康勒索软件攻击](https://www.ithome.com/0/949/600.htm)
- [国家数据局 - 2026数字经济发展工作要点](https://www.nda.gov.cn/sjj/swdt/xwfb/0519/20260519194643007508935_pc.html)
- [联合早报 - 美国2026网络安全战略](https://www.zaobao.com/forum/views/story20260518-9067084)
- [腾讯新闻 - 谷歌AI黑客攻击报告](https://news.qq.com/rain/a/20260513A05PVQ00)
- [Digitimes - 富士康攻击安全缺口分析](https://www.digitimes.com/news/a20260514PD208/foxconn-wisconsin-cybersecurity-plant-security.html)
- [新浪财经 - Daemon Tools供应链攻击](https://cj.sina.com.cn/articles/view/3948743169/eb5d0a0100101cqkq)
- [Notebookcheck - MiniPlasma零日漏洞](https://www.notebookcheck.net/MiniPlasma-zero-day-gives-SYSTEM-access-on-fully-patched-Windows-11.1299271.0.html)
- [中国石油大学 - 微软补丁日安全通告](https://www.cup.edu.cn/nic/wlaq/6b2796b156d943c09f474188034f49b0.htm)