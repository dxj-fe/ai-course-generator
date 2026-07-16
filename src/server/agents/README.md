# Agent 契约索引

本目录保存课程生成中的模型 Agent。当前系统已经把不同专业职责拆成多个 Agent，并由受限 Supervisor 在显式 `WorkflowNode` 候选中进行可恢复串行调度；Repair、自动 QA、页面并发和 LangGraph 尚未实现。本文只记录当前真实契约与后续角色边界，不把目标架构描述成已交付能力。

## 状态说明

- **已实现**：存在可调用源码，并已接入当前流程或独立 API。
- **目标角色**：仅定义职责边界，当前没有模块、共享 Schema 或运行事件。
- **执行范围**：Workflow 内的调度边界，不是独立模型 Agent。
- **Skill / 基础设施**：确定性能力或外部工具，不属于 Agent。

## 通用 handoff 原则

1. Agent 只接收完成自己职责所需的最小、类型化输入；后续 Agent 消费前序已经通过 Schema 和业务规则校验的产物。
2. 模型不负责生成稳定技术 ID、选择任意服务端模板或决定 Workflow 分支。适配层补齐技术字段，Registry、Schema 和业务校验器提供确定性边界。
3. Agent 返回自己的状态和产物；节点适配器只返回声明的 partial state 与事件，`runSequentialWorkflow` 按 `produces` 白名单集中合并课程状态、处理失败短路并触发既有 checkpoint 钩子。展示组件不能复制这些调度规则。
4. `AgentRuntimeContext` 只携带 `traceId` 与可选 `AbortSignal`；一步 Agent 仍受统一步骤预算和结构化错误约束。参见 [core/types.ts](./core/types.ts) 与 [core/minimal-agent.ts](./core/minimal-agent.ts)。
5. Agent 内部事件可以临时携带调试 `data`，但进入课程 checkpoint 前必须投影为严格的公开事件。公开事件只保留 `id`、`sequence`、`type`、`traceId`、`timestamp`、`step`、`summary`、`stage`、可选 `pageId` 和可选 `agent`，不得包含系统 Prompt、原始模型输出、HTML/DSL 正文、API Key、私有上下文或 chain-of-thought。参见 [course-generation-state.ts](../../shared/course-schema/course-generation-state.ts) 与 [course-task-event.ts](../../shared/course-schema/course-task-event.ts)。
6. Handoff 失败必须保留所属阶段、可选 `pageId`、稳定错误码和公开错误摘要；恢复由服务端 checkpoint 决定，不由 Agent 或 Timeline 从自然语言日志猜测。

## 入口解析

### Intent

- **状态**：已实现的入口解析能力；它不在手册列出的九名 Specialist 中。
- **输入**：原始 `userPrompt`、`traceId`、可选 `AbortSignal`。
- **输出**：经过 `CourseIntentSchema` 校验的 `CourseIntent`。
- **校验边界**：Intent 模块校验结构；课程 Workflow 再把 MVP 页数收敛到 3–5 页并复验。
- **禁止职责**：不规划具体页面，不写页面内容，不选择 HTML 实现，不调度后续 Agent。
- **源码**：[intent-agent.ts](./intent-agent.ts)、[course-generation-nodes.ts](../workflows/course-generation-nodes.ts)、[course-generation-workflow.ts](../workflows/course-generation-workflow.ts)。

## 九名 Specialist

### 1. Planner

- **状态**：已实现，对应 `CoursePlannerAgent`。
- **输入**：已校验的 `CourseIntent` 与 `AgentRuntimeContext`。
- **输出**：`CoursePlannerAgentState.outline` 中的 `CoursePlan`。
- **校验边界**：`CoursePlanSchema`、页数与 `CourseIntent.courseLength` 一致性、功能/样式模板 Registry 引用、规划阶段不得夹带素材或 HTML。
- **禁止职责**：不写页面正文，不生成专业教学/故事/视觉 brief，不生成素材或 HTML，不决定运行时重试。
- **源码**：[course-planner-agent.ts](./course-planner-agent.ts)、[course-plan.ts](../../shared/course-schema/course-plan.ts)。

### 2. Pedagogy

- **状态**：已实现，对应 `PedagogyAgent`。
- **输入**：`CourseIntent`、`CoursePlan` 与 `AgentRuntimeContext`。
- **输出**：`PedagogyPlan`，包括课程学习进阶、受众适配和按 `pageId` 对齐的教学指导。
- **校验边界**：`PedagogyPlanSchema`、指导数量与课程页数一致、稳定 `pageId` 由适配层按规划顺序补齐。
- **禁止职责**：不改课程页结构，不设计跨页故事，不决定视觉样式，不写页面 DSL 或 HTML。
- **源码**：[pedagogy-agent.ts](./pedagogy-agent.ts)、[pedagogy.ts](../../shared/course-schema/pedagogy.ts)。

### 3. Story

- **状态**：已实现，对应 `StoryAgent`。
- **输入**：`CourseIntent`、`CoursePlan`、已校验 `PedagogyPlan` 与 `AgentRuntimeContext`。
- **输出**：`StoryArc`，包括叙事模式、连续性规则和按页对齐的 story beats。
- **校验边界**：`StoryArcSchema`、beat 数量与课程页数一致；`narrativeMode: none` 时适配层确定性移除模型虚构角色。
- **禁止职责**：不覆盖教学目标，不选择样式模板，不写页面正文、互动实现或 HTML。
- **源码**：[story-agent.ts](./story-agent.ts)、[story.ts](../../shared/course-schema/story.ts)。

### 4. Visual

- **状态**：已实现，对应 `VisualDirectorAgent`。
- **输入**：`CourseIntent`、`CoursePlan`、`PedagogyPlan`、`StoryArc` 与 `AgentRuntimeContext`。
- **输出**：`VisualBrief`，包括真实 `StyleTemplate` 引用、全局视觉规则和按页视觉指导。
- **校验边界**：`VisualBriefSchema`、课程必须收敛到一个真实样式模板、页面指导覆盖全部 `pageId`；专业 brief 汇总后还会拒绝提前出现的 HTML。
- **禁止职责**：不改教学与叙事语义，不生成最终页面文案，不调用图片服务，不输出 HTML/CSS 实现。
- **源码**：[visual-director-agent.ts](./visual-director-agent.ts)、[course-design-workflow.ts](../workflows/course-design-workflow.ts)、[visual.ts](../../shared/course-schema/visual.ts)。

### 5. PageWriter

- **状态**：已实现，对应 `PageWriterAgent`，每次只负责一个页面。
- **输入**：`CourseIntent`、单页 `PagePlan`、同页 `PageWorkerBrief` 与 `AgentRuntimeContext`。
- **输出**：单页 `PageContentDSL`。
- **校验边界**：`PageContentDSLSchema`、`PagePlan`/brief/DSL 的 `pageId` 对齐、功能模板职责与槽位约束、互动协议；稳定 block/item/option/asset slot ID 由代码投影和复验。
- **禁止职责**：不写最终 HTML/CSS，不生成图片，不改全局课程规划，不读取其他页面的完整私有状态。
- **源码**：[page-writer-agent.ts](./page-writer-agent.ts)、[page-content-dsl.ts](../../shared/course-schema/page-content-dsl.ts)、[course-design.ts](../../shared/course-schema/course-design.ts)。

### 6. ImagePrompt

- **状态**：已实现，对应 `ImagePromptAgent`。
- **输入**：单页 `PageContentDSL`、全局 `VisualBrief` 与 `AgentRuntimeContext`；适配层解析真实 `StyleTemplate` 和当前页视觉指导。
- **输出**：与当前页全部素材槽一一对应的 `AssetRequest[]`。
- **校验边界**：`AssetRequestSchema`、素材槽无重复全覆盖、受限素材类型/比例/安全区、Prompt 禁止把文字或整套 UI 烘焙进图片。
- **禁止职责**：不直接调用图片 Provider，不缓存或存储二进制，不写页面正文，不生成 HTML。真实生图由独立 Skill 完成。
- **源码**：[image-prompt-agent.ts](./image-prompt-agent.ts)、[image-asset-workflow.ts](../workflows/image-asset-workflow.ts)、[asset.ts](../../shared/course-schema/asset.ts)。

### 7. HtmlEngineer

- **状态**：已实现，对应 `HtmlEngineerAgent`，每次只生成一个静态页面。
- **输入**：单页 `PageContentDSL`、`VisualBrief`、可选已批准 `AssetGenerationResult[]` 与 `AgentRuntimeContext`。功能模板、样式模板和当前页视觉指导只从服务端 Registry 解析；**不读取原始用户 Prompt**。
- **输出**：包含完整单页 HTML 的 `HtmlOutput`，以及服务端内部的合同/安全预检结果。
- **校验边界**：完整文档合同、轻量安全预检、DSL 静态文本与稳定定位标记、互动标记、模板引用、素材槽 URI/alt/可访问性和批准素材清单。
- **禁止职责**：不重新规划或改写 DSL 语义，不读取原始 Prompt，不调用业务 API 或图片服务，不引用未批准外部素材，不把脚本能力带出 sandbox 合同。
- **源码**：[html-engineer-agent.ts](./html-engineer-agent.ts)、[html-preview validation.ts](../../shared/html-preview/validation.ts)、[page.ts](../../shared/course-schema/page.ts)。

### 8. QA

- **状态**：已实现，对应 `PageQAAgent`；当前由用户对已生成页面显式触发，不是整课主链的必需阶段。
- **输入**：`PagePlan`、`PageContentDSL`、HTML 字符串、`VisualBrief`、可选素材结果、可选前后页课程上下文与 `AgentRuntimeContext`。
- **输出**：不可变的 `QualityReport`。
- **校验边界**：先执行确定性 HTML/布局启发式，再校验模型的六维评价和 issue 位置；总分、限分、`shouldRepair` 与 `decision` 由代码规则计算，不采用模型自报结果。
- **禁止职责**：**report-only**；不修改 DSL 或 HTML，不调用 Repair，不自行把报告标成通过，不改变已交付页面状态。
- **源码**：[page-qa-agent.ts](./page-qa-agent.ts)、[basic-layout-heuristics.ts](../quality/basic-layout-heuristics.ts)、[page-quality.ts](../quality/page-quality.ts)、[quality.ts](../../shared/course-schema/quality.ts)。

### 9. Repair

- **状态**：**目标角色，尚未实现**；当前没有 `RepairAgent` 模块、输入输出类型或运行事件。
- **目标输入边界**：应只消费原始页面产物、已经校验的 `QualityReport`、明确的问题定位和有限修复预算；最终类型留待对应训练日设计。
- **目标输出边界**：应返回可审计的定向修复候选及已处理问题引用，再经过相同 Schema、HTML 合同与 QA 复验；本文不预先声明不存在的共享类型。
- **禁止职责**：不改全局 CoursePlan，不掩盖原始报告，不自行宣布质量通过，不无限循环，不无差别重写整页，不扩展到未授权页面。
- **现有前置协议**：[quality.ts](../../shared/course-schema/quality.ts)、[page-content-dsl.ts](../../shared/course-schema/page-content-dsl.ts)、[DSL 边界文档](../../../docs/dsl-boundary.md)。

## 协调角色与确定性能力

### WorkflowNode 与串行运行器

- **状态**：已实现的**协调原语**，不是模型 Agent，也不是 Supervisor。
- [`WorkflowNode`](../workflows/sequential-workflow.ts) 通过 `name`、`requiredInputs`、`produces` 和 `run` 声明一个固定 handoff；`run` 只返回 partial state 与结构化事件。
- `runSequentialWorkflow` 按给定数组顺序执行节点，统一检查前置输入、拒绝未声明 patch、验证声明产物，并把失败包装为带 `nodeName` 的 `WorkflowNodeError`。
- [`course-generation-nodes.ts`](../workflows/course-generation-nodes.ts) 包装 Intent、Planner、Course Design 和逐页 Writer/Assets/HTML；它复用已有 Agent 与子流程，不把业务规则复制进通用运行器。
- `runCourseGenerationWorkflow` 保留为任务服务的兼容 facade，负责初始化/恢复、上下文装配、集中 merge、checkpoint 和原有结果映射。
- **边界**：节点合同仍不负责动态选择、重试、循环或并发；这些协调策略由受限 Supervisor 运行层持有。

### Supervisor

- **状态**：**已实现**。`SupervisorDecisionSchema` 约束 `run / retry / complete / stop`，`SupervisorAgent` 只消费压缩状态、确定性可用节点、最近失败和持久化 attempts。
- **职责**：基于已校验课程状态、可用节点、失败位置和有限预算提出下一节点、重试或停止，并只发布可解释的公开决策摘要；运行层再次校验节点白名单、输入合同、每目标最多 3 次执行、无进展、取消和全局决策上限。
- **禁止职责**：不写课程正文，不生成 HTML 或图片，不替 Specialist 修补输出，不泄露内部推理。LangGraph 将来可以承载调度图，但不是 Supervisor 思想本身。
- **源码**：[supervisor-agent.ts](./supervisor-agent.ts)、[supervisor.ts](../../shared/course-schema/supervisor.ts)、[supervised-workflow.ts](../workflows/supervised-workflow.ts)。

### Page Worker

- **状态**：已存在的**逐页执行范围**，不是独立模型 Agent。
- `CourseDesignWorkflow` 把全局 briefs 投影为每页 `PageWorkerBrief`；课程节点装配再为每页按依赖顺序创建 PageWriter → Assets → HtmlEngineer 节点，并在既有阶段边界 checkpoint。
- Page Worker 不拥有另一份课程状态，不绕过全局 Workflow，不把一个页面的私有中间产物传给无关页面。
- 当前逐页节点共享整课状态并串行执行，因此还不是隔离的 Page Worker，也不支持页面并发。
- **源码**：[course-design-workflow.ts](../workflows/course-design-workflow.ts)、[course-generation-nodes.ts](../workflows/course-generation-nodes.ts)、[course-generation-workflow.ts](../workflows/course-generation-workflow.ts)。

### GenerateImage Skill

- **状态**：已实现的 **Skill / Tool，不是 Agent**。
- **输入/输出**：`pageId + altText + AssetRequest` → `AssetGenerationResult`；输入必须来自 ImagePrompt/素材 Workflow。
- **边界**：Skill 负责 Provider 调用、文件校验与内部存储；失败转换为显式 fallback。它不规划页面、不写 Prompt、不生成整页 UI 图片。
- **源码**：[generate-image-skill.ts](../tools/generate-image-skill.ts)、[image-asset-workflow.ts](../workflows/image-asset-workflow.ts)。

### Validator、checkpoint 与 SSE

- **Validator**：Agent Schema、业务一致性校验、HTML 合同和质量规则负责确定性接受/拒绝；模型不能绕过这些边界。
- **Merge / Checkpoint**：`runSequentialWorkflow` 只接受节点 `produces` 声明内的 patch，兼容 facade 的集中 merge 以 `CourseGenerationStateSchema` 复验完整状态；`CourseStore` 仍在原阶段边界保存 checkpoint，失败保留已完成页面，恢复跳过已完成产物。
- **SSE**：Task Service 管理任务生命周期，课程 checkpoint 成功后才发布严格公开消息；EventBus 只负责进程内实时通知，不成为持久化事实来源。
- **源码**：[sequential-workflow.ts](../workflows/sequential-workflow.ts)、[course-generation-workflow.ts](../workflows/course-generation-workflow.ts)、[course-store.ts](../storage/course-store.ts)、[course-generation-task-service.ts](../tasks/course-generation-task-service.ts)、[course-task-sse.ts](../tasks/course-task-sse.ts)。

## 当前与目标边界

当前运行链路是：Supervisor 在确定性候选集合中调度 Intent → Planner → Pedagogy → Story → Visual → 按页 PageWriter → ImagePrompt/GenerateImage Skill → HtmlEngineer；QA 仍为单页显式操作。节点工厂由 `course-generation-nodes.ts` 声明，输入/输出检查和失败定位由通用串行运行器负责，有限循环、重试和停止由 `runSupervisedWorkflow` 负责，checkpoint 与恢复继续由兼容 facade 和任务基础设施保持。

后续训练日仍需实现真正隔离的 Page Worker、QA/Repair 闭环和可选 LangGraph 执行层。当前 Supervisor 不提供页面并发、自动 QA 或修复能力，也不会绕过标准 `WorkflowNode` 合同。
