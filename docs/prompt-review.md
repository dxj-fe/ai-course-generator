# Day 24 Prompt Review

本审查先记录建议，再逐项决定是否修改。Prompt Lint 只报告合同问题，不自动覆盖文件。

| Specialist | 审查发现 | 建议 | 处理结果 |
| --- | --- | --- | --- |
| Planner | 已有输出和禁止项，但没有统一 Inputs/Failure Handling；兼容 Provider 可能忽略枚举 Schema | 明确只规划结构，并逐字列出 pageType→interactionType 映射 | 已采纳，升级 2.0.1/2.0.0 |
| Pedagogy | 边界较窄，但失败条件和数据边界不显式 | 增加页数冲突处理和 Prompt injection 边界 | 已采纳，升级 2.0.0 |
| Story | 能限制教学越权，但缺少输入/目标章节 | 明确叙事只连接既定目标 | 已采纳，升级 2.0.0 |
| Visual | Token 和页数约束完整，但合同散落 | 集中 Schema、Rules、Forbidden | 已采纳，升级 2.0.0 |
| Page Writer | DSL 规则详细，但缺少最小输入和失败策略 | 保留交互细节，补齐单页边界 | 已采纳，升级 2.0.0 |
| Image Prompt | 素材边界清楚，但未显式声明不调用 Provider | 区分创意方向与 GenerateImage Skill | 已采纳，升级 2.0.0 |
| HTML Engineer | 安全合同完整，但章节与其他 Specialist 不一致；Supervisor 重试未把上次校验问题传回 | 保留全部合同，逐字复用批准 altText，并把安全结构化校验反馈注入同页重试 | 已采纳，升级 2.1.0/2.1.0 |
| QA | report-only 边界存在，但未说明输入冲突的处理 | 明确不得修复、自判通过或伪造几何证据 | 已采纳，升级 2.0.0 |
| Repair | 当前没有实现 | 只建立 draft 合同，不创造虚假 Schema 或运行入口 | 已采纳，保持 0.1.0 draft |

Day 27 复审：`RepairRequestSchema`、`RepairResultSchema`、定向候选校验和两轮 qa-repair-loop 已实现，因此 Repair 合同升级为 active `1.0.0/1.0.0`。原草案中的“不扩大范围、不跳过 re-QA、不自判通过”继续保留，并由代码执行。

Day 27 本地回归复审：Repair system 升级为 `1.0.1` 以支持授权标签边界插入；Page QA system 升级为 `2.1.2`，由运行层规范化兼容 Provider 的超长摘要、常见 severity 同义词和缺失定位描述，并阻止模型把硬合同允许的静态反馈、批准 alt 和合法 block 顺序误报为 Repair issue。规范化不修复未知维度、issue code 或无法确定的严重度。

## 未采纳建议

- 没有把九个 Prompt 合并成一个“全能课程 Prompt”，因为这会破坏 Specialist 的可验证 handoff。
- 没有把 Intent、Supervisor、SinglePage 或 GenerateImage 加入九名 Specialist。
- 没有让 Prompt Lint 自动修正文案；自动改写会让审查结果失去可控性。
- 没有为 Repair 预先创建运行时 Schema、Agent、节点或重试循环。

## 复验结论

职责收窄只改变模型合同，不改变当前 Agent 输入类型、结构化输出 Schema、Workflow 状态合并、SSE 协议或 UI。所有 active Prompt 继续服务原有下游节点，Repair 明确保持不可执行。
