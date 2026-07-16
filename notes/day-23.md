# Day 23 · Supervisor Agent：路由、重试、停止条件、人工可解释调度

## 当天结论

Day 23 在 Day 22 的显式 `WorkflowNode` 合同之上加入了第一个受限 Supervisor。课程生成不再由顶层函数直接遍历固定节点数组，而是每一轮先根据已校验 checkpoint 计算真正可执行的候选节点，再由 Supervisor 提出结构化 `run / retry / complete / stop` 决策，最后由确定性运行层决定该提案能否执行。

当前真实入口仍是 [`runCourseGenerationWorkflow`](../src/server/workflows/course-generation-workflow.ts)：

- [`supervisor.ts`](../src/shared/course-schema/supervisor.ts) 定义节点名、调度目标、停止原因、互斥决策和持久化 attempt 状态；
- [`supervisor-agent.ts`](../src/server/agents/supervisor-agent.ts) 只消费压缩状态、确定性候选、最近失败和预算，返回结构化调度提案；
- [`supervised-workflow.ts`](../src/server/workflows/supervised-workflow.ts) 持有候选白名单、重试预算、取消、无进展和全局决策上限；
- [`sequential-workflow.ts`](../src/server/workflows/sequential-workflow.ts) 继续负责单个节点的输入检查、输出白名单、集中 merge 和节点错误定位；
- [`course-generation-workflow.ts`](../src/server/workflows/course-generation-workflow.ts) 继续作为兼容 facade，负责初始化、恢复、checkpoint、公开事件和最终课程状态映射。

Supervisor 是控制面，不是新的课程内容生产者。它不会生成 CoursePlan、Page DSL、图片或 HTML，也不能修改 retry budget、绕过 `requiredInputs / produces`、直接保存 checkpoint 或向 SSE 发布任意数据。

本日没有引入 LangGraph、自动 Page QA、Repair Agent、独立 Page Worker 或页面并发。现有任务 API、SSE 消息外壳、Controller、learning workspace 和产品路由保持不变。

## Day 22 与 Day 23 的关系

Day 22 解决“节点如何显式表达、运行和合并”，Day 23 解决“下一次应该运行哪个节点、失败后是否允许重试、何时必须停止”。

| 维度 | Day 22 | Day 23 |
| --- | --- | --- |
| 节点合同 | `name / requiredInputs / produces / run` | 完全复用 |
| 节点执行 | 调用方传入数组，运行器按顺序遍历 | Supervisor 每轮从运行层候选中选择一个节点 |
| 状态合并 | `runSequentialWorkflow` 集中 merge | 完全复用，不允许 Supervisor 直接 merge |
| 决策输出 | 无 | `SupervisorDecisionSchema`：run/retry/complete/stop |
| 动态选择 | 无 | 有，但只能选择确定性 `availableNodes` |
| 自动重试 | 无 | 同 node/page 最多重试 2 次 |
| 停止条件 | 节点失败即结束 | 不可重试、预算耗尽、非法决策、无节点、无进展、取消、决策上限 |
| 持久化预算 | 无 | `CourseGenerationState.supervisor.attempts` |
| 可解释调度 | 无专门事件 | `supervisor_decision` 公开摘要 |
| 前端 | Agent/page Timeline | 原 Timeline 增加最近三条 Supervisor 摘要 |
| LangGraph | 无 | 仍无；Supervisor 是架构角色，不等于框架 |

显式节点是 Supervisor 可以安全选择的能力清单；Supervisor 没有替代节点合同。若没有 Day 22 的前置输入和声明产物，Day 23 的模型决策就缺少可验证的执行边界。

## Supervisor 决策合同

共享合同位于 [`src/shared/course-schema/supervisor.ts`](../src/shared/course-schema/supervisor.ts)。当前允许六种课程节点名：

```ts
type CourseGenerationNodeName =
  | "intent"
  | "planner"
  | "course-design"
  | "page-writer"
  | "assets"
  | "html-engineer";
```

页面节点仅靠名称无法唯一定位，因此调度目标使用 `nodeName + pageId?`：

```ts
type SupervisorNodeTarget = {
  nodeName: CourseGenerationNodeName;
  pageId?: string;
};
```

课程级节点没有 `pageId`；页面 Writer、Assets 和 HTML 节点必须携带目标页面。`targetKey` 将它们标准化为：

```text
intent:course
page-writer:page-01-cover
html-engineer:page-02-knowledge
```

这样同名节点在不同页面拥有独立重试预算。

### 四种互斥决策

`SupervisorDecisionSchema` 使用互斥分支表达四类结果：

```ts
type SupervisorDecision =
  | {
      action: "run";
      nextNode: SupervisorNodeTarget;
      reasonSummary: string;
    }
  | {
      action: "retry";
      nextNode: SupervisorNodeTarget;
      retryTarget: SupervisorNodeTarget;
      reasonSummary: string;
    }
  | {
      action: "complete";
      reasonSummary: string;
    }
  | {
      action: "stop";
      reasonSummary: string;
      stopReason: {
        code: SupervisorStopReasonCode;
        message: string;
        recoverable: boolean;
      };
    };
```

合同的重要约束：

1. `run` 必须指定 `nextNode`，不能携带重试或停止字段。
2. `retry` 的 `nextNode` 与 `retryTarget` 必须完全一致，避免“说明重试 A，实际运行 B”。
3. `complete` 不能指定下一节点；运行层还会复验全部必需产物确实完成。
4. `stop` 必须包含稳定 code、公开 message 和是否可恢复，不能只返回模糊的自然语言。
5. `reasonSummary` 长度限制为 2–300 字符，只允许公开、可验证的事实摘要。

Schema 只证明结构有效，不能证明业务决策合法。`nextNode: { nodeName: "html-engineer", pageId: "page-01" }` 即使类型正确，目标页也可能尚未生成 DSL，因此仍必须经过运行层候选白名单校验。

## Supervisor 输入为什么必须压缩

[`runSupervisorAgent`](../src/server/agents/supervisor-agent.ts) 不接收完整 `CourseGenerationState`，而是接收 `SupervisorInput`：

```ts
type SupervisorInput = {
  stateSummary: SupervisorStateSummary;
  availableNodes: SupervisorAvailableNode[];
  attempts: SupervisorAttempt[];
  recentFailure?: SupervisorRecentFailure;
};
```

### `stateSummary`

只保留调度需要的事实：

- 课程状态、当前阶段和当前页面；
- 是否已有 Intent、Outline 和 Course Design；
- 是否满足整课完成条件；
- 每页的 pageId、顺序、状态、当前阶段、是否已有 DSL 和 HTML。

它不包含：

- 用户完整 Prompt；
- CoursePlan 正文、教学 brief、PageContentDSL 正文；
- 图片 Prompt、素材二进制或完整 HTML；
- Agent 原生 event data、模型消息、系统 Prompt 或 chain-of-thought。

### `availableNodes`

候选由服务端代码计算，每项只包含：

- 精确 `target`；
- 对应 stage 和 Agent；
- 人类可读的 `requiredInputs` 名称；
- 人类可读的 `produces` 名称。

Supervisor Prompt 明确要求逐字段复制候选 target，不能自行发明 nodeName 或 pageId。

### `recentFailure`

只暴露最近一次节点失败的：

- target；
- 稳定 code 和安全 message；
- 是否可重试；
- 已用 attempts 和最大 attempts。

原始异常 stack、Provider payload 和内部上下文不会进入 Supervisor Prompt。

压缩输入有三项直接收益：降低 token 成本、减少 Prompt injection 传播面、避免 Supervisor 因看到专业产物而越权改写内容。

## 可用节点如何确定

候选计算位于 [`listAvailableCourseNodes`](../src/server/workflows/course-generation-workflow.ts)，遵循当前产品真实依赖：

```text
没有 intent
  → Intent

已有 intent，但没有 outline
  → Planner

已有 outline，但缺少 briefs/pageWorkerBriefs
  → Course Design

全局产物完成后，对依赖已完成的页面：
  没有 content
    → Page Writer
  content 已完成且 currentStage=assets
    → Assets
  素材阶段完成且 currentStage=html、没有 htmlOutput
    → HTML Engineer
```

候选生成后还会逐个运行节点自己的 `requiredInputs` selector。只有全部输入真实存在的节点才会进入 `availableNodes`。

这意味着模型没有“执行权限”，只有“在已授权集合中提出选择”的能力。最终授权仍由运行层完成。

页面依赖也由代码判断：某页的 `dependsOnPageIds` 尚未全部完成时，该页节点不会成为候选。Supervisor 不需要在 Prompt 中复制依赖算法，也不能忽略依赖直接调度后继页面。

## 有限监督循环

[`runSupervisedWorkflow`](../src/server/workflows/supervised-workflow.ts) 的每轮生命周期是：

1. 检查 AbortSignal；取消后生成确定性 stop 决策，不再调用模型或 Specialist。
2. 检查全局 decision count，给最终 stop 事件保留一个持久化名额。
3. 判断课程是否已经满足完成条件。
4. 从当前 checkpoint 计算可用节点。
5. 若刚有节点失败，只允许失败目标继续成为候选，避免绕过失败去执行无关后继节点。
6. 过滤 attempts 已达到 3 次的目标。
7. 没有合法节点但课程未完成时，确定性停止。
8. 构造压缩 `SupervisorInput` 并调用 Supervisor Agent。
9. 对提案进行业务校验：动作与失败上下文匹配、目标位于候选、complete 条件真实成立。
10. 保存结构化决策状态和公开 `supervisor_decision` 事件。
11. 对 run/retry 目标增加 attempt，并在长耗时节点执行前 checkpoint。
12. 复用 `runSequentialWorkflow` 执行单个节点，继续经过 requiredInputs、produces、集中 merge 和 Schema。
13. 失败时保存节点的安全公开事件，并进入下一轮重试/停止判断。
14. 成功时比较领域进度指纹；若没有任何有效产物或阶段推进，确定性停止。
15. 全部课程产物完成后，Supervisor 只能返回 complete 或 stop；complete 后由 facade 保存最终课程状态。

这个循环是有限的，因为 attempt 和 decision 两类预算都由代码维护，模型不能修改。

## 重试预算

手册要求“同一页面同一节点最多重试 2 次”。当前实现将首次执行也记入 attempts：

```text
attempt 1：首次运行
attempt 2：第一次重试
attempt 3：第二次重试
attempt 4：禁止
```

因此 `SupervisorAttemptSchema.attempts` 的合法范围是 1–3。

预算保存在：

```ts
type SupervisorRuntimeState = {
  decisionCount: number;
  attempts: SupervisorAttempt[];
  lastDecision?: SupervisorDecision;
};
```

`CourseGenerationState.supervisor` 是 checkpoint 的一部分。任务恢复时保留原 attempts，而不是重新获得两次重试机会。例如 HTML Engineer 已运行一次后失败，人工从 checkpoint 恢复，下一次执行会被记录为 attempt 2。

### 为什么不能只从 Timeline 事件推断 attempts

Day 20 Timeline 的 attempt 主要按不同 trace 推导恢复次数；同一 trace 内的自动重试可能有多个 `agent_start`。运行预算属于业务事实，不能依赖展示事件反推，否则事件裁剪、重放或协议升级都可能改变可执行次数。

因此：

- `supervisor.attempts` 决定是否还能运行；
- `events` 负责公开观测；
- Timeline 是只读投影，不参与预算计算。

### 哪些错误允许重试

当前运行层只对明确的执行/Provider 类错误开放有限重试，例如：

- `AGENT_EXECUTION_ERROR`；
- `AGENT_STEP_LIMIT`；
- `WORKFLOW_NODE_EXECUTION_ERROR`；
- `MODEL_TIMEOUT / MODEL_RATE_LIMITED / MODEL_PROVIDER_ERROR`；
- 部分 Agent 未产出结果的稳定失败码。

以下错误不应自动重试：

- `AGENT_ABORTED / WORKFLOW_ABORTED`；
- 缺少节点输入；
- 节点写入未声明字段；
- 合并后仍缺少声明产物；
- Supervisor 选择非法目标；
- 确定性 HTML 合同或状态不一致错误。

重试不是“失败就再跑一次”。只有错误类型可恢复、预算仍有剩余、目标仍在候选集合中时，Supervisor 才可能返回 retry。

## 停止条件

`SupervisorStopReasonCodeSchema` 当前包含：

| code | 触发条件 | 目的 |
| --- | --- | --- |
| `requested` | Supervisor 在合法情况下主动建议停止 | 保留受限人工可解释停止入口 |
| `retry_exhausted` | 目标已经执行 3 次 | 防止单页/节点无限循环和成本失控 |
| `non_retryable_error` | 最近错误属于确定性或取消类错误 | 避免无意义重复调用 |
| `invalid_decision` | 模型输出结构失败或业务校验失败 | 防止幻觉节点和越权路由 |
| `no_available_node` | 课程未完成但没有满足输入合同的节点 | 暴露状态机断点，而不是空转 |
| `no_progress` | 节点声称成功但领域状态未推进 | 防止重复成功事件形成死循环 |
| `decision_limit` | 全局调度决策达到上限 | 为异常路径提供最终保险丝 |

当前全局运行上限允许 63 次普通决策，并为第 64 条确定性 stop 决策保留持久化空间。正常 3–5 页流程远低于该上限；即使每个节点都用满 3 次执行，也无法无限循环。

### 模型决策与确定性停止的优先级

模型可以提出 stop，但硬停止条件不需要再问模型。例如预算已经耗尽时，运行层直接创建 `retry_exhausted` 决策。如果仍调用模型，不仅浪费成本，还可能让模型错误建议继续运行。

最终原则是：

```text
模型提出策略
代码决定授权
代码拥有预算
代码保证终止
```

## 公开事件、checkpoint 与 SSE

每条 accepted decision 或确定性 stop 都通过 [`recordSupervisorDecision`](../src/server/workflows/course-generation-workflow.ts) 完成：

1. 增加 `decisionCount`；
2. run/retry 时按 target 增加 attempts；
3. 保存完整、Schema 校验后的 `lastDecision`；
4. 追加 `supervisor_decision` 公开事件；
5. 调用 `CourseGenerationStateSchema.parse`；
6. 保存 checkpoint；
7. 由既有 Task Service/EventBus/SSE 发布新事件。

公开事件只包含现有 allowlist 字段：

- id、sequence、traceId、timestamp、step；
- type=`supervisor_decision`；
- stage、可选 pageId、agent=`supervisor`；
- 公开 `summary`。

summary 会在 run/retry 时附加“第 N 次执行”，例如：

```text
第 2 页 HTML 输入已就绪，运行 HTML Engineer。（第 1 次执行）
HTML 生成遇到暂时错误，预算允许再次执行。（第 2 次执行）
```

不会进入事件或浏览器的内容包括完整决策 Prompt、stateSummary JSON、最近错误 stack、Page DSL、HTML、模型原始响应和 chain-of-thought。

SSE 外层仍是 `snapshot / event / terminal` 三类消息。Day 23 只是为严格公开事件 union 增加一种 event type，没有让前端消费 AI SDK 或未来 LangGraph 的原生 stream chunk。

## Seaca Timeline 落点

Day 23 继续使用现有 `/chat` 产品壳：

- [`course-run-timeline-model.ts`](../src/features/seaca/course-run-timeline-model.ts) 从 checkpoint 事件中投影 `supervisorDecisions`；
- [`course-run-timeline.tsx`](../src/features/seaca/course-run-timeline.tsx) 在任务摘要与 Agent 进度之间展示最近三条公开调度摘要；
- [`generation-log-drawer.tsx`](../src/features/seaca/generation-log-drawer.tsx) 保留全部 `supervisor_decision` 结构化日志；
- learning workspace 继续只展示课程规划、DSL、素材、HTML、预览和 QA 产物。

没有新增 `/supervisor`、`/workflow` 或 `/generate` 页面，也没有把旧 `AiPlayground` 挂回产品路由。

Timeline 组件只显示服务端给出的事实，不会根据 summary 文案推断下一节点、预算或停止条件。展示组件不是业务状态机。

## 一次典型运行示例

正常三页课程的控制流可以概括为：

```text
Supervisor: run intent
  → Intent node 成功

Supervisor: run planner
  → Planner node 成功

Supervisor: run course-design
  → Pedagogy → Story → Visual 成功

Supervisor: run page-writer(page-01)
  → DSL 成功

Supervisor: run assets(page-01)
  → 无素材槽时确定性跳过，或执行素材 workflow

Supervisor: run html-engineer(page-01)
  → HTML 暂时失败

Supervisor: retry html-engineer(page-01)
  → attempt 2 成功

...继续后续页面...

Supervisor: complete
  → facade 保存 completed checkpoint 和 finish 事件
```

若 HTML 连续失败三次：

```text
attempt 1 失败
attempt 2 失败
attempt 3 失败
确定性 stop: retry_exhausted
课程状态 → failed
最后一个有效 checkpoint、此前完成页面和公开失败位置全部保留
```

## 恢复语义与幂等性

恢复时 facade 仍验证 `courseId + userPrompt`，替换新的 traceId，并清除课程终态错误标记，但保留：

- 已完成 Intent、Outline、brief 和页面产物；
- 已完成页面；
- 历史公开事件；
- Supervisor decision count；
- 每个 node/page 的 attempts。

候选计算会跳过已有产物。例如第 1 页完成、第 2 页已有 DSL 且 HTML 失败，恢复后不会重新运行 Intent、Planner、Design、第 1 页或第 2 页 Writer，而是从第 2 页 HTML 阶段继续。

持久化 attempts 防止“通过不断恢复刷新预算”。这也是为什么人工恢复不等于清空自动控制状态。若产品未来需要真正的人工 override，应设计显式权限、原因和新任务版本，而不是偷偷重置数组。

模型和外部工具调用仍是 at-least-once 语义；长耗时节点开始前会先 checkpoint。进程在调用中退出时，恢复可能再次执行该节点，因此素材缓存、稳定 ID 和副作用幂等仍然重要。Supervisor 不自动创造 exactly-once 保证。

## 与 LangGraph 的关系

Supervisor 是职责角色，LangGraph 是可选运行框架。

当前手写实现已经明确：

- State：`CourseGenerationState`；
- Node：`WorkflowNode`；
- Edge 决策：`SupervisorDecision` + 运行层校验；
- Reducer/merge：`runSequentialWorkflow` 的集中 merge；
- Checkpoint：`CourseStore`；
- Streaming：严格 SSE 公开协议；
- Stop：retry、progress、cancel 和 decision guards。

未来若迁移 LangGraph，应映射这些已经稳定的合同，而不是让框架原生 chunk、Reducer 或 checkpoint 格式进入前端。Day 23 不需要框架即可学习和验证 Supervisor 的核心思想。

## 验证关注点

共享 Schema 测试位于 [`supervisor.test.ts`](../tests/unit/shared/supervisor.test.ts)，覆盖：

- 四种决策都能通过 Schema；
- retry 的 nextNode 与 retryTarget 不一致时被拒绝；
- attempts 最大值为 3；
- 相同节点在不同页面拥有不同 target key。

Agent 测试位于 [`supervisor-agent.test.ts`](../tests/unit/server/agents/supervisor-agent.test.ts)，覆盖：

- 输入原样传给依赖并返回经过 Schema 校验的决策；
- 模型编造节点时结构校验失败。

课程工作流测试位于 [`course-generation-workflow.test.ts`](../tests/unit/server/workflows/course-generation-workflow.test.ts)，覆盖：

- 正常多页路径仍按依赖顺序完成；
- 短暂错误连续失败两次、第三次执行成功；
- 第三次仍失败后以 `SUPERVISOR_RETRY_EXHAUSTED` 停止；
- 非法 Supervisor target 在任何 Specialist 调用前被拒绝；
- 非重试错误保留已完成页面并支持从 checkpoint 恢复；
- 取消继续映射为 `cancelled`；
- 决策事件数量与持久化 decision count 一致。

Timeline 测试验证公开 Supervisor 事件的投影和现有 UI 展示；SSE 协议测试验证 `supervisor_decision` 是合法公开类型，而任意私有字段仍会被 strict Schema 拒绝。

本日最终验证结果：

- 53 个测试文件、299 项测试通过；
- ESLint 通过；
- Next.js production build 与 TypeScript 检查通过；
- `/chat` 本地浏览器加载正常，无控制台错误。

## 面试题与参考答案

### 1. Supervisor Agent 的职责边界是什么？

**核心结论：** Supervisor 负责控制面，只决定下一节点、重试、完成或停止；专业产物仍由 Specialist 负责，硬约束仍由代码和 Schema 负责。

**原理或设计原因：** 如果 Supervisor 同时写 CoursePlan、Page DSL 或 HTML，它会重新变成上下文过长、难验证的超级 Agent。稳定的 Supervisor 应只读取最小结构化状态，在有限动作集合中提出决策，并允许确定性运行层拒绝。

**在 ai-course-generator 中的实际落地：** Supervisor 输入只有状态摘要、availableNodes、attempts 和最近失败。它不能访问完整 HTML，也不能直接调用节点或 checkpoint。`runSupervisedWorkflow` 验证后才把目标交给 Day 22 节点运行器。

**主要权衡或常见追问：** 过弱的 Supervisor 可能只是昂贵的 `switch`；过强则不可审计。当前项目只在运行时失败和完成判断上增加有限动态性，不把已有确定性依赖规则交给模型重新发明。

### 2. 为什么结构化输出通过 Zod 后还不能直接执行？

**核心结论：** Schema 只保证“形状合法”，运行层必须继续保证“动作在当前状态下被授权”。

**原理或设计原因：** 一个合法 nodeName 可能缺少输入、pageId 不存在、依赖未完成或预算已耗尽。类型系统无法证明持久化运行时状态当前允许该动作。

**在 ai-course-generator 中的实际落地：** Supervisor 可以输出合法的 `html-engineer` target，但只有当该精确 target 出现在 `availableNodes` 中，且 attempts 小于 3，运行层才执行。complete 也必须由 `isCourseReadyToComplete` 复验。

**主要权衡或常见追问：** 双层校验增加代码量，但把模型从执行授权边界移开。Prompt 是行为引导，Schema 是结构边界，候选白名单和预算才是执行边界。

### 3. 多 Agent 系统如何避免无限循环和成本失控？

**核心结论：** 必须使用模型无法修改的多维预算和确定性终止条件，不能只在 Prompt 中写“不要无限循环”。

**原理或设计原因：** 模型可能重复选择同一节点、在失败后继续建议重试，或者返回成功但状态没有推进。只有服务端计数、状态指纹和取消信号能提供硬保证。

**在 ai-course-generator 中的实际落地：** 同 node/page 最多执行 3 次，全局最多 63 次普通调度并保留最终 stop 决策；不可重试错误、非法决策、无候选、无进展和 AbortSignal 都会立即停止。

**主要权衡或常见追问：** 固定预算可能在极少数可恢复场景中过早停止，因此 stopReason 包含 recoverable，后续可以设计显式人工处理；不能为了提高自动成功率取消保险丝。

### 4. retry budget 为什么要按 `nodeName + pageId` 持久化？

**核心结论：** 页面级 target 是最小失败和恢复单元；预算必须与该单元绑定并保存进 checkpoint，才能防止跨页污染和恢复刷新预算。

**原理或设计原因：** 仅按 `html-engineer` 计数会让第 1 页失败消耗第 2 页额度；仅保存在内存会让进程重启或人工恢复重新获得次数。

**在 ai-course-generator 中的实际落地：** `targetKey` 生成 `html-engineer:page-01-cover` 等稳定键。首次运行计为 attempt 1，最多允许 attempts=3；恢复时原数组保留。

**主要权衡或常见追问：** 如果未来一个节点内部还有多个独立工具副作用，node/page 可能仍太粗，需要加入 operation/asset key；当前课程阶段的最小重跑边界就是单页单节点，不提前细化。

### 5. 如何做到“可解释调度”而不泄露 chain-of-thought？

**核心结论：** 公开解释应是基于结构化事实的短摘要，而不是模型的隐藏推理过程或完整上下文。

**原理或设计原因：** 用户需要知道运行了哪个节点、失败位置、当前 attempt 和停止原因；不需要系统 Prompt、内部候选评分、长推理或 Provider payload。后者既有安全风险，也不是稳定产品合同。

**在 ai-course-generator 中的实际落地：** `reasonSummary` 限制长度并进入 strict `supervisor_decision` 事件；事件还携带 stage、pageId 和 agent。Timeline 显示最近三条，日志抽屉显示全部，但两者都不渲染 SupervisorInput 或模型原始响应。

**主要权衡或常见追问：** 摘要可能不足以排查底层模型错误，因此服务端应通过 traceId 关联内部日志。公开观测与内部诊断应分层，而不是把调试数据直接发给浏览器。

### 6. 固定 workflow、规则路由器和模型 Supervisor 应该如何分工？

**核心结论：** 固定依赖和安全约束留在代码；运行时存在语义判断或多种合法策略时才交给 Supervisor；简单分支优先规则路由器。

**原理或设计原因：** 模型调用增加延迟、成本和不确定性。若每个状态只有一个合法后继节点，普通状态机已经足够；Supervisor 的价值出现在失败分类、质量证据、预算和人工升级共同影响路径时。

**在 ai-course-generator 中的实际落地：** 页面依赖、requiredInputs、produces、attempt 上限和完成条件仍由代码计算；Supervisor 只在候选集合内输出动作和公开原因。Day 23 为后续 QA/Repair 分支准备合同，但没有提前实现它们。

**主要权衡或常见追问：** 当前正常路径多数时刻只有一个候选，因此 Supervisor 的主要教学价值是建立受限控制面和失败循环。等 Day 26–27 出现 QA/Repair 多分支后，动态路由价值会更明显。

### 7. Supervisor 决策应该在节点执行前还是执行后 checkpoint？

**核心结论：** 调度决策和 attempt 必须在长耗时节点执行前保存，节点产物通过校验后再保存完成 checkpoint。

**原理或设计原因：** 若先调用模型节点再记录 attempt，进程中途退出会丢失一次真实执行，恢复后可能突破预算。反过来，执行前保存意味着可能记录一次未完成调用，但这是可审计的 at-least-once 语义。

**在 ai-course-generator 中的实际落地：** `recordSupervisorDecision` 增加 attempts、追加事件并 checkpoint；随后 `beforeNode` 再保存 `agent_start`。成功产物经过 produces、集中 merge 和完整状态 Schema 后才保存完成事件。

**主要权衡或常见追问：** 两次相邻 checkpoint 增加 I/O，但保证调度事实与 Agent 边界可恢复。未来可做原子批量写或事件存储优化，但不能牺牲预算一致性。

### 8. 为什么当前没有直接使用 LangGraph？

**核心结论：** Supervisor 的核心是职责、状态和终止合同，不依赖特定框架；先用手写运行层验证合同，可以避免同时迁移执行、持久化、SSE 和前端。

**原理或设计原因：** 框架能提供图运行、Reducer、checkpoint 和 streaming，但不会自动定义领域状态、重试边界、公开事件安全或 Specialist 权限。合同不稳定时引入框架只会增加调试层次。

**在 ai-course-generator 中的实际落地：** 项目已有 Zod State、WorkflowNode、集中 merge、CourseStore checkpoint、SSE 和 Seaca Controller。Day 23 只补 Supervisor 和有限循环，所有外部合同保持兼容。

**主要权衡或常见追问：** 手写运行器需要自行维护 guard 和测试；当 QA/Repair、条件边和页面并发复杂度明显增加后，可以评估 LangGraph，但迁移应保持共享 State 和公开协议不变。

## 当天复盘问题

1. 如果 Supervisor 在没有最近失败时返回 retry，运行层为什么必须拒绝，而不是把它当作 run？
2. `reasonSummary`、`stopReason.message` 和服务端内部异常分别面向谁，为什么不能合并成一个字段？
3. 某节点已经 attempts=3，但用户点击“从断点继续”时，当前实现为什么仍应停止？产品若要人工 override 应增加哪些显式合同？
4. 当前 `availableNodes` 大多数时候只有一个候选。哪些 Day 26–27 的 QA/Repair 状态会让 Supervisor 真正面临多个合法动作？
5. 如果未来允许两个无依赖页面并发，attempts、decision sequence、集中 merge 和 checkpoint 原子性分别需要怎样改变？
6. 为什么 `supervisor_decision` 可以进入公开 SSE，而完整 `SupervisorInput` 不可以？
7. “模型输出符合 Schema”与“系统授权执行”之间还需要哪些检查？请结合 HTML Engineer 页面节点说明。
8. 如果 success 节点返回了与原状态相同的有效对象，为什么 `produces` 可能仍通过，而 no-progress guard 仍然有价值？
