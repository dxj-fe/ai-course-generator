# Day 21：Supervisor + Specialist 多 Agent 架构复盘

## 当天产出与边界

Day 21 的产出是基于真实代码完成一次多 Agent 架构复盘，重点是解释“为什么拆分角色、当前实现到了哪里、下一步为什么可能需要 Supervisor”，而不是继续增加业务功能。

- 梳理现有 Specialist 的输入、输出和禁止职责：Planner、Pedagogy、Story、Visual Director、Page Writer、Image Prompt、HTML Engineer 与 Page QA。
- 对照当前串行工作流和目标 Supervisor 架构，明确两者不是同一个概念。
- 形成一份可用于面试的 3 分钟口述稿和五道深入问答。
- 本日不修改业务代码、产品 UI、共享 Schema、API 或工作流。
- 当前项目尚未实现 Supervisor Agent、Repair Agent 或 LangGraph runtime；本文只描述目标边界，不把未来设计写成既成能力。

真实源码入口：

- Specialist 的统一运行边界：[core/types.ts](../src/server/agents/core/types.ts)、[core/minimal-agent.ts](../src/server/agents/core/minimal-agent.ts) 和 [core/events.ts](../src/server/agents/core/events.ts)。
- 当前课程级固定编排：[course-generation-workflow.ts](../src/server/workflows/course-generation-workflow.ts)。
- 专业设计串行编排：[course-design-workflow.ts](../src/server/workflows/course-design-workflow.ts)。
- 图片方向、缓存与生图工具编排：[image-asset-workflow.ts](../src/server/workflows/image-asset-workflow.ts)。
- 已存在但尚未接入课程主工作流的只读 QA：[page-qa-agent.ts](../src/server/agents/page-qa-agent.ts)。

## 当前 Specialist 契约

当前 Specialist 都通过 `createMinimalAgent` 运行。它们是有严格输入输出、一次有界执行和公开事件的专业节点，不是能够自由互相调用的自治 Agent 网络。

| Specialist | 可信输入 | 主要输出 | 明确禁止 |
| --- | --- | --- | --- |
| Planner | `CourseIntent`、服务端模板 Registry | `CoursePlan`：课程概述、目标和有序页面规划 | 不写完整正文、题目、HTML；不发明技术 ID、模板或生命周期状态 |
| Pedagogy | `CourseIntent`、`CoursePlan` | `PedagogyPlan`：年龄适配、递进、脚手架、理解检查、误区和无障碍策略 | 不设计故事、视觉、布局、HTML 或完整讲稿 |
| Story | Intent、Plan、Pedagogy | `StoryArc`：叙事模式、任务线、跨页 beat、转场和连续性规则 | 不改变学习目标、页面顺序和教学策略；不决定视觉或生成正文 |
| Visual Director | Intent、Plan、Pedagogy、Story、真实 `StyleTemplate` | `VisualBrief`：视觉概念、布局原则、素材方向、逐页构图和无障碍规则 | 不创建第二套 Token，不修改教学/叙事，不生成 HTML、CSS 或完整图片 Prompt |
| Page Writer | Intent、单页 `PagePlan`、单页 `PageWorkerBrief` | `PageContentDSL`：旁白、内容块、互动和布局提示 | 不生成 HTML/CSS/组件或图片 URL；不自行决定模板、ID、素材槽和 reading order |
| Image Prompt | `PageContentDSL`、`VisualBrief`、真实 StyleTemplate | 与素材槽一一对应的 `AssetRequest[]` | 不生成整页 UI 图片，不在图片中生成文字，不输出 URL、尺寸或文件路径 |
| HTML Engineer | DSL、功能/样式模板、VisualBrief、已校验素材 | 通过合同、内容和安全校验的 `HtmlOutput` | 不重新规划或改写教学内容，不读取原始 Prompt，不输出脚本、外部依赖或框架组件 |
| Page QA | PagePlan、DSL、HTML、VisualBrief、素材及可选课程上下文 | 六维 `QualityReport`、结构化 issues 和 repair hints | 只报告问题，不修改 DSL/HTML；不否认确定性 heuristics，不伪造像素级证据 |

对应实现分别位于 [course-planner-agent.ts](../src/server/agents/course-planner-agent.ts)、[pedagogy-agent.ts](../src/server/agents/pedagogy-agent.ts)、[story-agent.ts](../src/server/agents/story-agent.ts)、[visual-director-agent.ts](../src/server/agents/visual-director-agent.ts)、[page-writer-agent.ts](../src/server/agents/page-writer-agent.ts)、[image-prompt-agent.ts](../src/server/agents/image-prompt-agent.ts)、[html-engineer-agent.ts](../src/server/agents/html-engineer-agent.ts) 和 [page-qa-agent.ts](../src/server/agents/page-qa-agent.ts)。

## 当前工作流与目标架构

当前主链路是代码确定的串行 workflow：

```text
Intent
  -> Planner
  -> Pedagogy -> Story -> Visual Director
  -> 对每一页：Page Writer -> Image Prompt / Image Skill -> HTML Engineer
  -> checkpoint / public events / next page
```

这条链路的阶段、顺序、失败短路和断点恢复由 [course-generation-workflow.ts](../src/server/workflows/course-generation-workflow.ts) 的 TypeScript 规则决定。它具有“协调者”的作用，但不是 Supervisor Agent：它不会基于模型判断选择下一个 Specialist，也没有 handoff、动态路由或 Agent 自主决策。

Page QA 已经作为独立只读 Specialist 存在，但当前课程主工作流还没有调用它。Repair Agent、QA → Repair 循环和 LangGraph StateGraph 均不存在。因此当前可准确描述为“固定多-Specialist workflow”，不能描述为“已完成 Supervisor + QA/Repair + LangGraph 架构”。

目标 Supervisor 的价值应集中在以下控制面：

- 根据结构化共享状态选择下一个允许执行的 Specialist。
- 在预算内决定重试、降级、跳过、人工介入或结束任务。
- 生成公开、可审计的调度摘要，并保留 trace、pageId、attempt 和错误边界。
- 只传递最小 handoff，不把整门课程上下文无差别复制给每个 Agent。

Supervisor 不应自己写课程正文、视觉 brief、图片 Prompt、HTML 或 QA 结论，也不应在 Prompt 中复制 Route Handler、Workflow、模板 Registry 和共享 Schema 已经确定的业务规则。否则它会重新变成职责过载的“超级 Agent”。

## 3 分钟口述稿

我做的是一句话生成多页 HTML 课程。它同时包含需求理解、课程规划、教学设计、跨页叙事、视觉规范、页面内容、图片素材、HTML 工程和质量评估。全部交给一个大 Prompt，容易出现上下文过长、约束冲突、输出难验证，以及单页失败却必须全量重跑。

因此当前项目先实现固定的多-Specialist workflow：Intent 解析需求，Planner 规划页面；Pedagogy、Story、Visual Director 生成专业 brief；每页再由 Page Writer 生成 PageContentDSL，Image Prompt 生成结构化素材请求，图片 workflow 处理缓存、生图和 fallback，HTML Engineer 只根据 DSL、模板、视觉 brief 与批准素材生成 HTML。每个产物都先经过 Schema 和业务规则校验，再进入 checkpoint；前端 Timeline 只接收公开结构化摘要。

当前调度者仍是 TypeScript workflow，不是 Supervisor Agent。Page QA 已实现为只读 Specialist，但尚未进入课程必需链路；Repair 和 LangGraph 也没有实现。未来只有在 QA 后该修 DSL 还是 HTML、图片失败该重试还是降级、是否仍有预算等真实分支出现时，才需要 Supervisor。它只负责路由、预算和停止条件，专业产物仍由 Specialist 负责，硬规则仍由 Schema、Registry 和 Workflow 校验。

多 Agent 也会增加调用次数、延迟、费用和观测成本。我的取舍是先用确定性 workflow 跑通真实链路并建立状态、checkpoint 和事件契约；当分支复杂到普通状态机难以维护时再引入 Supervisor，最后才评估 LangGraph，而不是为了架构名称提前增加复杂度。

## 面试题与参考答案

### 1. 为什么这个项目不直接使用一个超级 Prompt？

**核心结论：** 多 Agent 的理由不是角色数量多，而是课程生成包含多组目标冲突、验证方式不同、失败恢复粒度不同的职责。拆分后，每个输出都可以独立约束、测试和恢复。

**原理或设计原因：** 单一上下文同时要求规划、教学、视觉、正文、图片和 HTML 时，模型需要在相互竞争的约束间取舍；最终输出通常又大又耦合。职责拆分使每个节点拥有较小上下文、明确 Schema 和单一完成条件，并能在失败时只重跑目标阶段。

**项目实际落地：** Planner 只输出 `CoursePlan`，Page Writer 只输出 `PageContentDSL`，Image Prompt 只输出素材方向，HTML Engineer 只把可信 DSL 编译为 HTML。技术 ID、模板引用和状态由代码补齐，相关边界可从 [course-planner-agent.ts](../src/server/agents/course-planner-agent.ts) 和 [page-writer-agent.ts](../src/server/agents/page-writer-agent.ts) 看到。

**主要权衡或常见追问：** 拆分会增加延迟、费用和接口维护成本。若任务只有一步、输出很小且失败无需局部恢复，单模型调用反而更合适；不能把“多 Agent”当作默认答案。

### 2. 当前固定 workflow 与 Supervisor Agent 有什么区别？

**核心结论：** 当前 workflow 是确定性编排；Supervisor 是根据状态进行受限动态路由的控制节点。二者都能协调步骤，但决策来源不同。

**原理或设计原因：** 固定 workflow 的边和终止条件写在代码中，可预测、易测试、成本稳定。Supervisor 通常读取结构化状态、可用能力和预算后选择下一节点，适合分支多且运行时信息会改变路径的场景。

**项目实际落地：** [course-generation-workflow.ts](../src/server/workflows/course-generation-workflow.ts) 明确写死 Intent → Planner → Design → 每页 Writer/Assets/HTML，并在每个边界 checkpoint。仓库没有 Supervisor Agent、handoff 协议或动态节点选择，因此当前不能声称已经实现 Supervisor。

**主要权衡或常见追问：** Supervisor 可以减少复杂条件分支，但引入非确定性和额外调用。即使以后加入 Supervisor，硬性安全、模板合法性、最大重试次数和终止条件仍应由代码强制，而不是只靠 Supervisor Prompt。

### 3. Supervisor 应该负责什么，又不应该负责什么？

**核心结论：** Supervisor 负责控制面，不负责专业数据面。它决定“谁在什么条件下执行”，不替 Specialist 生成专业产物。

**原理或设计原因：** 如果 Supervisor 同时规划课程、写正文和修 HTML，它会再次承受超级 Agent 的上下文和职责过载。稳定的 Supervisor 应只读取结构化状态，输出有限的路由决策，并受能力白名单、预算和状态机约束。

**项目实际落地：** 未来它可以根据 `QualityReport.shouldRepair`、错误 stage、pageId、attempt 和预算选择 QA 通过、进入 Repair、降级或终止；Planner、Visual Director、HTML Engineer 仍分别拥有其输出契约。当前这些动态路由尚未实现。

**主要权衡或常见追问：** 过弱的 Supervisor 只是昂贵的 `switch`，过强的 Supervisor 又难以审计。是否引入应取决于分支复杂度，而不是架构名称。

### 4. Specialist 之间如何避免越权和相互污染？

**核心结论：** 不能只靠角色名称，要同时使用最小输入、严格输出、确定性字段补齐、业务校验和公开事件白名单建立边界。

**原理或设计原因：** Prompt 只能降低越权概率，Schema 和程序校验才是执行边界。下游只消费已经校验的上游产物，可以避免把原始用户指令、模型临时字段或错误技术 ID 传播到整条链路。

**项目实际落地：** Course Design workflow 只把已校验的 Pedagogy 结果交给 Story，再把已校验的 Story 交给 Visual；随后按 pageId 投影成最小 `PageWorkerBrief`。HTML Engineer 不接收原始用户 Prompt，Page QA 只产出报告且不会修改 HTML。统一事件只允许 JSON 数据和公开摘要，见 [core/types.ts](../src/server/agents/core/types.ts)。

**主要权衡或常见追问：** 严格边界会增加适配代码，并可能拒绝语义正确但形状略有差异的模型输出。项目使用模型草稿 Schema、规范化层和最终领域 Schema 分层处理，但不能为了通过率取消关键业务约束。

### 5. 什么时候应该使用多 Agent，什么时候不应该？

**核心结论：** 当任务存在专业职责、独立验证、局部恢复或运行时分支时，多 Agent 才有价值；纯线性、低风险的小任务优先使用普通函数、单次模型调用或固定 workflow。

**原理或设计原因：** 多 Agent 的收益来自分解和隔离，成本来自更多调用、上下文传递、状态同步、观测、重试和一致性控制。只有收益大于这些成本时才值得使用。

**项目实际落地：** 课程规划、视觉、页面内容、素材和 HTML 的输出类型与验证方式明显不同，因此适合 Specialist；当前阶段的执行顺序仍然确定，所以项目先保留手写 workflow。QA/Repair、并行页面和复杂降级尚未形成完整闭环，不提前引入 Supervisor 或 LangGraph。

**主要权衡或常见追问：** 如果未来分支增加，可以先用显式状态机和纯函数路由验证规则，再决定是否迁移框架。框架能提供运行时和持久化能力，但不会自动提升模型质量或消除成本。

## 当天结束复盘

1. 我能否不使用“更智能”这种空泛说法，具体解释 Specialist 拆分解决了哪类验证和恢复问题？
2. 我能否准确区分当前 TypeScript workflow 的确定性调度与目标 Supervisor 的动态路由？
3. 如果新增 Supervisor，我会把哪些硬约束继续留在 Schema、Registry 和代码状态机中？
4. Page QA 已存在但未接入主链路、Repair 和 LangGraph 未实现，这些事实是否在文档和口述中保持一致？
5. 面对一个新的 AI 任务，我能否用分支复杂度、验证粒度、恢复需求、延迟和成本判断是否真的需要多 Agent？
