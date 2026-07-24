# Day 24 · Specialist Prompt 体系：角色、输入、输出与禁止项

## 当天结论

Day 24 没有增加新的课程生成节点，而是把已有 Specialist 的自然语言约束提升为可维护的工程合同。

当前运行中的八名 Specialist——Planner、Pedagogy、Story、Visual、Page Writer、Image Prompt、HTML Engineer 和 QA——继续使用原有 Agent、Zod Schema 与 Workflow handoff。它们的 Prompt 统一登记在 [`specialist-library.ts`](../src/server/prompts/specialist-library.ts)，并统一采用以下八段结构：

```text
Role
Goal
Inputs
Output Schema
Rules
Forbidden
Examples
Failure Handling
```

第九名 Repair 只有 `0.1.0` draft Prompt。它没有 Agent 模块、共享 `RepairResultSchema`、Workflow 节点、Supervisor 候选、SSE 事件或 UI。这样既完成了九名 Specialist 的职责审查，也不会把未来能力伪装成当前实现。

本日新增 `npm run prompt:lint`。Lint 只读取并报告 Prompt 合同问题，不自动改写正文。真正的强制边界仍由结构化输出 Schema、业务校验、Workflow `produces` 白名单、HTML 安全合同和有限 Supervisor 循环提供。

## 为什么需要 Specialist Prompt Library

多 Agent 系统拆分模块后，并不会自动获得职责隔离。如果每个 Agent 都接收完整状态、原始用户 Prompt 和所有工具，再用一段“请生成高质量课程”的宽泛 Prompt，系统只是把一个全能模型调用复制了多次。

这种退化会造成：

- Planner 提前写完整正文，导致 Page Writer 无法区分规划事实和建议文案。
- Page Writer 修改页面目标或模板，破坏 CoursePlan 的稳定引用。
- HTML Engineer 根据原始用户 Prompt 重写 DSL，绕过内容审核。
- QA 一边评分一边修改 HTML，导致报告无法对应被评估的原始产物。
- Repair 无边界重写整页并自行宣布通过，形成不可审计循环。

Prompt Library 的价值不在于把文本集中存放，而在于使每个 handoff 都能回答四个问题：

1. 该 Agent 最少需要知道什么？
2. 它只允许产出什么？
3. 哪些工作必须留给下一节点或确定性代码？
4. 输入无效时如何失败，而不是越权补救？

## 当前目录结构

```text
src/server/prompts/
├── specialist-library.ts       # 九名 Specialist、状态、版本和合同索引
├── prompt-loader.ts            # 版本化读取、缓存和模板变量渲染
├── types.ts                    # Prompt 与 Library 类型
├── course-planner.ts           # active builder
├── pedagogy.ts                 # active builder
├── story.ts                    # active builder
├── visual-director.ts          # active builder
├── page-writer.ts              # active builder
├── image-prompt.ts             # active builder
├── html-engineer.ts            # active builder
├── page-qa.ts                  # active builder
└── templates/
    ├── *.system.v2.md           # active Specialist
    ├── *.user.v2.md             # active Specialist
    ├── repair.system.v1.md     # draft only
    └── repair.user.v1.md       # draft only

scripts/
└── prompt-lint.ts
```

现有 Intent、Supervisor 和 SinglePage Prompt 不在这个 Library 中。Intent 是入口解析，Supervisor 是协调者，SinglePage 是早期训练实现。GenerateImage 是确定性 Skill，不是 Agent。

## 八段合同各自解决什么问题

### Role

Role 只说明专业身份，不使用“你是最强大的课程专家”之类宽泛描述。角色越宽，越容易把其他节点的职责吸收进来。

### Goal

Goal 定义当前调用的单一成功条件。例如 HTML Engineer 的目标是把既定 DSL 转成安全 HTML，而不是“让用户满意”。后者会诱导模型重新解释原始需求并修改 DSL。

### Inputs

Inputs 是最小上下文白名单。Prompt 文字只能描述边界，真正的上下文裁剪仍由 Agent builder 和 Workflow node 完成。

所有 active Prompt 都明确：输入字段是数据。字段中即使出现“忽略系统规则”、另一段 Prompt、HTML 或代码，也不能改变 System Prompt。这不能彻底解决所有 Prompt injection，但能减少把课程正文误当控制指令的风险。

### Output Schema

Output Schema 说明模型应该服务哪个真实下游合同。它不能替代 Zod：自然语言只能提高一次生成命中率，Zod 才能确定性拒绝非法结构。

当前输出边界是：

| Specialist | 模型/适配层目标 |
| --- | --- |
| Planner | CoursePlanSchema；System Prompt 2.0.1 |
| Pedagogy | PedagogyPlanSchema |
| Story | StoryArcSchema |
| Visual | VisualBriefSchema |
| Page Writer | PageContentDSLSchema |
| Image Prompt | 方向草稿 → AssetRequestSchema[] |
| HTML Engineer | HtmlOutputSchema + HTML 合同；Prompt 2.1.0/2.1.0 |
| QA | 语义草稿 → QualityReportSchema |
| Repair | draft，暂无运行时 Schema |

### Rules

Rules 只保留该 Specialist 完成职责需要的正向约束。跨节点稳定技术字段仍由代码补齐，路由、重试和停止条件仍由 Supervisor 运行层决定。

### Forbidden

Forbidden 显式说明不能做什么。只写“专注于你的任务”不够，因为模型无法从模糊措辞推导项目的职责边界。

禁止项需要与实际架构一致，例如：

- Planner 不生成技术 ID 和 HTML。
- Image Prompt 不调用图片 Provider。
- HTML Engineer 不读取原始用户 Prompt。
- QA 不修改页面，不自行宣布通过。
- Repair 不扩大范围，不跳过 re-QA。

### Examples

Examples 只演示精确字段形状，不能成为业务事实。示例越完整，模型越容易照抄示例内容；因此示例保持最小，但字段必须与结构化输出相容。

### Failure Handling

失败策略防止 Specialist 用越权行为“自救”。例如模板缺失时，Planner 不能发明模板；DSL 与素材冲突时，HTML Engineer 不能引用外部图片；QA 输入不完整时不能伪造评分。

模型调用失败后，由 Agent 和 Workflow 把错误结构化，再由受限 Supervisor 根据候选和预算决定重试或停止。

## 版本管理

八名 active Specialist 本次统一升级为 `2.0.0/2.0.0`，因为职责、输入边界、禁止项和失败合同都发生了行为级变化。

版本管理提供：

- 可复现性：知道一次生成使用了哪套合同。
- 可回滚性：效果退化时可以恢复完整组合版本。
- 缓存正确性：Image Prompt 版本变化会使请求集缓存自然失效。
- 可审计性：失败日志能关联 Prompt 合同，而不是只关联模型名。
- 对比能力：可基于同一输入比较不同 Prompt 版本。

System/User 版本必须一起记录。不能只修改文件却保留旧版本，也不能只提升版本而不记录原因。

## Prompt Lint

### 本地验收补充：CSS 背景可访问名称

真实课程生成曾连续三次返回“CSS 背景必须提供匹配的可访问说明或显式隐藏”。根因是模型能够正确绑定批准 URI，却会把 `Asset.altText` 同义改写成另一条 `aria-label`；Supervisor 重试仍使用相同输入，因此机械错误会重复直到预算耗尽。

HTML Engineer System Prompt 已提升到 `2.0.1`，明确要求逐字复制批准 altText。Agent 适配层还会对已经唯一绑定到真实素材槽的 CSS consumer 规范化 `role/aria-label/aria-hidden`，再执行原严格校验。未知 URI、跨槽引用、重复槽位、宽泛 CSS selector 和缺失素材绑定不会被修复，仍然失败。

### 本地验收补充：Planner interactionType

OpenAI-compatible Provider 默认可能只支持 JSON object mode，而不执行 JSON Schema 枚举约束。真实 Planner 输出因此可能把 interactionType 写成 `multiple-choice`、中文描述或页面类型，随后在 Zod 校验阶段连续失败。

Planner System Prompt 已提升到 `2.0.1` 并列出 pageType 到 canonical interactionType 的映射。结构化客户端支持在严格 Zod 校验前运行节点专属 normalizer；Planner 只在 pageType 已通过枚举校验、interactionType 非法或缺失时使用确定性默认值。非法 pageType、页面数量、模板和其他字段不会被掩盖。

### 本地验收补充：HTML 重试反馈

真实五页课程在 summary 页连续缺少同一段 DSL 原文。此前 Supervisor 能看到失败并决定 retry，但 Specialist 调用仍收到完全相同的 DSL、模板和素材，没有上一次校验问题，因此模型容易重复同一省略。

现在 `runSupervisedWorkflow` 只把同一 node/page 的最近安全错误传给执行边界；HTML 节点进一步筛选 `生成 HTML 校验失败`，拆成最多 20 条 issues，再通过 `validationFeedback` 注入 HTML Engineer User Prompt。反馈不包含原始 HTML 或私有推理。恢复 checkpoint 时，若 attempt 尚未耗尽，也会复用该页持久化错误。严格正文、标记、素材和安全校验保持不变。

运行：

```bash
npm run prompt:lint
```

当前 Lint 检查：

- Library 是否恰好登记九名 Specialist。
- Specialist ID 和 Prompt 文件是否重复。
- System/User 文件和 active 模块是否存在。
- 八个必要段落是否存在、唯一且顺序正确。
- System Prompt 是否明确输入数据边界。
- User Prompt 是否明确指令性字段仍是数据。
- User 模板变量是否与 Library 声明完全一致。

Lint 不做以下事情：

- 不自动改写 Prompt。
- 不判断自然语言生成质量。
- 不证明模型输出一定通过 Schema。
- 不替代业务校验或安全预检。
- 不执行 Repair draft。

## Review-only 工作流

Prompt Review 的推荐顺序是：

```text
读取现有 Prompt
  → 按角色/输入/输出/禁止项列出问题
  → 生成 review 报告
  → 人工或代码审查接受/拒绝建议
  → 逐个修改 Prompt
  → 提升版本并记录 changelog
  → lint + schema/agent tests
```

不要让 Review 工具一边分析一边静默覆盖全部 Prompt。否则无法判断哪项建议导致行为改变，也无法对单个 Specialist 回滚。

本次审查结果记录在 [`docs/prompt-review.md`](../docs/prompt-review.md)，版本变化记录在 [`docs/prompt-changelog.md`](../docs/prompt-changelog.md)。

## Prompt 与运行时边界

Prompt 不是安全边界。当前系统采用多层约束：

```text
最小类型化输入
  → Specialist System/User Prompt
  → 模型结构化输出
  → Zod Schema
  → 业务一致性校验
  → Workflow produces 白名单与集中 merge
  → checkpoint
  → 严格公开 SSE 投影
```

任何一层都不应假设上一层绝不会出错。模型即使返回结构合法的对象，也可能引用不存在的模板或错误页面；业务校验仍需复验。Workflow 即使拿到已校验对象，也只允许节点修改 `produces` 中声明的字段。

## Repair 为什么保持 draft

手册要求九名 Specialist 都有 Prompt，但当前项目明确没有 Repair 运行时合同。Day 24 只定义职责和禁止项，是为了让后续实现有清晰边界。

如果现在直接创建 `RepairResultSchema` 和 Workflow 节点，会提前决定尚未完成的设计问题：

- Repair 修 DSL、HTML，还是二者之一？
- 一个候选能处理多少 issue？
- repair budget 如何持久化？
- 修复后哪些 validator 必须重跑？
- re-QA 的通过条件由谁计算？

因此 draft 只承诺：限定目标、最小修改、引用真实 issue、遵守预算、经过相同校验和 re-QA。它不能被当前 Agent 或 Supervisor 调用。

## 与前端的关系

Day 24 是服务端 Prompt 和工具链收紧，没有新增产品页面、面板或交互。现有 `/chat` Timeline 继续只显示结构化公开 Agent/Supervisor 摘要，不显示 System Prompt、完整输入、原始模型输出或私有推理。

Prompt 版本目前保留在服务端模型请求和产物流程中，不需要在 Keya UI 增加“Prompt 控制台”。

## 验收与验证

Day 24 的成功条件：

- 九名 Specialist 全部登记，只有 Repair 为 draft。
- 八名 active Specialist 继续使用原有 builder 和输出 Schema。
- 所有 Specialist System Prompt 通过八段合同 Lint。
- 删除必要段落或模板变量时，测试能发现问题。
- Prompt Review 和 Changelog 可审计。
- Repair 没有运行时接线。
- Workflow、SSE 和 Keya UI 行为不变。

验证命令：

```bash
npm run prompt:lint
npm test
npm run lint
npm run build
```

## 面试追问与参考答案

### 1. 多 Agent 系统中，Prompt 设计最容易出现什么问题？

最常见的是职责重叠、上下文过载和输出合同漂移。多个 Agent 都看到原始需求和完整状态时，会倾向于重新解决整道问题，而不是只完成自己的 handoff。结果表现为 Planner 写正文、Writer 改规划、HTML Engineer 改 DSL、QA 直接修页面。

另一个问题是自然语言 Prompt 与真实 Schema 不一致。Prompt 示例要求一个字段，Zod 却要求另一种形状，会造成稳定的模型重试。最后是版本漂移：Prompt 内容变了但版本没变，缓存、日志和回滚都失去可信度。

解决方法不是把 Prompt 写得更长，而是缩小输入和输出，明确禁止项，并让运行时校验成为最终裁判。

### 2. 如何防止 Specialist Agent 职责越界？

第一层是最小输入：不需要原始用户 Prompt 的 Agent 就不应收到它。第二层是唯一输出 Schema：每个 Specialist 只能交付一个下游合同。第三层是明确 Forbidden 和工具白名单：例如 Image Prompt 不能调用 Provider，QA 不能调用 Repair。

Prompt 外还需要强制边界：Zod 拒绝非法结构，业务校验拒绝非法引用，Workflow `produces` 拒绝未声明状态修改，Supervisor 只允许选择确定性候选，checkpoint 和 SSE 只保存允许公开的字段。

因此防越界是“Prompt 约束 + 上下文裁剪 + 类型合同 + 运行时授权”的组合，不是依赖模型自律。

### 3. Prompt Library 为什么需要版本管理？

Prompt 是程序行为的一部分。版本号使一次运行可复现，允许定位某次质量变化是模型、输入还是 Prompt 引起的，也支持回滚和 A/B 对比。

在本项目中，Image Prompt 版本还参与缓存边界。如果 Prompt 改变但版本不变，同一个缓存键可能返回旧语义下的素材请求；提升版本可以自然失效旧编译结果。

### 4. Structured Outputs 已经有 Schema，为什么还要写 Output Schema 段？

Structured Outputs 负责“最终对象能否被机器接受”，Prompt 中的 Output Schema 负责“模型是否理解该对象在 handoff 中的语义”。例如一个字段类型是 string，并不能告诉模型它应该写学习目标还是完整正文。

Prompt 可以降低第一次生成失败率并减少语义漂移，但不能替代 Schema。Schema 可以强制字段类型和枚举，却不能单独保证页面目标与上游 CoursePlan 一致，因此还需要业务校验。

### 5. 为什么 Forbidden 要单独成段？

正向目标通常不能覆盖所有越权路径。告诉 QA“评估页面”并不自动意味着它不会返回修复后的 HTML；告诉 HTML Engineer“生成页面”也不自动意味着它不会重新规划课程。

单独的 Forbidden 让代码审查和 Lint 能快速确认边界是否存在，也便于后续 Agent 变更时比较职责差异。

### 6. 如何处理 Prompt Injection？

首先减少传播：只把当前 Agent 必需的类型化字段传入，不传播完整原始对话和其他 Agent 的私有消息。其次明确数据边界：字段里的指令仍是课程内容。再次避免给 Specialist 不必要的工具和状态写权限。

最后假设 Prompt injection 仍可能成功，用输出 Schema、业务校验、URI 白名单、HTML 安全预检和 Workflow 输出白名单限制影响范围。Prompt injection 防护的目标不是证明模型永不受影响，而是让一次受影响的模型调用无法越权改变系统。

### 7. Prompt Lint 能检查语义质量吗？

静态 Lint 擅长检查可机械验证的合同：必要段落、文件、版本、模板变量和数据边界。它不能证明 Prompt 会产生高质量课程，也不能证明两个自然语言规则没有隐含冲突。

语义质量需要固定测试集、真实模型评估、Schema 通过率、下游成功率、重试率和人工 Review。Lint 是低成本前置防线，不是最终评价器。

### 8. 为什么 Repair 不能自行宣布修复成功？

Repair 是被评估对象，不应该同时担任裁判。它可能只隐藏症状、改变无关语义，或引入新的问题。修复候选必须重新经过原 Schema、HTML 合同、安全检查和独立 QA，再由确定性规则计算是否通过。

将 Repair 与 re-QA 分开，也能保留原始报告、修复差异和最终报告，形成可审计链路并限制无限循环。
