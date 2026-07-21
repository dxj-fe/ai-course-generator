# LangGraph 与当前课程工作流映射

Day 28 的目标是建立概念映射和最小运行证明，不迁移生产流程。当前
`runCourseGenerationWorkflow`、checkpoint、SSE、Controller 与 Seaca UI 均保持不变。

## 实现文件

- `src/server/langgraph/course-workflow-demo-state.ts`：State 与 events Reducer。
- `src/server/langgraph/nodes/planner-node.ts`：独立 Planner Node。
- `src/server/langgraph/course-workflow-demo.ts`：Edge、Graph 编译、invoke 与 stream。

## 核心映射

| LangGraph 概念 | 运行时职责 | 当前项目对应 | Day 28 Demo |
| --- | --- | --- | --- |
| State | 保存一次图执行的共享状态快照 | `CourseGenerationState`、`PageGenerationState` | `prompt`、`plan`、`events` |
| Node | 读取 State，执行一个职责并返回部分更新 | `CourseGenerationNode.run`、Page Worker 阶段 | 确定性 `planner` |
| Edge | 声明固定的下一执行节点 | Intent → Planner → Course Design | `START → planner → END` |
| Conditional Edge | 根据 State 选择下一节点或终止 | Supervisor 的 run/retry/complete/stop，QA/Repair 分支 | 只记录映射，Day 28 不增加分支 |
| Reducer | 决定某个 State 字段如何合并节点更新 | 状态字段覆盖、`appendEvent` 追加公开事件 | `events` 追加；`plan` 覆盖 |
| Graph Runtime | 编译并执行节点、边和状态更新 | 手写 Sequential/Supervised Workflow | 编译后的独立 `StateGraph` |

## WorkflowNode 到 LangGraph Node

当前 `WorkflowNode` 已经接近 `State → Partial<State>`：

- `requiredInputs` 对应节点执行前的输入条件。
- `produces` 对应节点允许返回的 State 更新范围。
- `run` 对应 LangGraph Node 函数。
- `merge` 对应普通字段覆盖和按字段 Reducer。
- `beforeNode`、`afterNode` 对应运行时生命周期事件和 checkpoint。

迁移时不应把这些业务约束删掉。LangGraph 负责调度和状态应用，输入校验、
输出白名单、Zod 聚合校验、公开事件净化仍然属于项目运行层。

## 固定 Edge 与 Conditional Edge

固定依赖适合普通 Edge，例如：

```text
START → intent → planner → course-design
```

当前 Supervisor 根据可用节点、最近错误、重试预算和完成条件选择
`run`、`retry`、`complete` 或 `stop`，对应 Conditional Edge 的路由职责。
路由函数只能从运行层提供的 allowlist 选择目标，不能让模型发明节点。

## Reducer 映射

普通 State 字段使用覆盖语义：

- `intent`
- `outline`
- `briefs`
- `currentStage`

累计字段需要显式合并语义：

- `events`：保持顺序追加，并继续由产品层分配全局 `id` 和 `sequence`。
- `errors`：受数量和结构约束的追加，不允许保存 Provider 原始错误。
- 并行 `pages`：未来不能简单拼接数组，必须按 `pageId` 合并并重新执行
  `CourseGenerationStateSchema` 校验。

Day 28 Demo 只实现 `events` 追加 Reducer，避免提前设计 Day 29 的生产并行合并。

## 迁移时必须保持的合同

1. Agent、Prompt、Zod Schema 和业务验证仍是现有模块的职责。
2. checkpoint 必须先于 EventBus 发布，保证 SSE 可恢复。
3. 浏览器只接收 `CourseGenerationPublicEvent`，不接收原生 graph chunk。
4. `useSSETask` 和 Task Controller 继续隔离传输格式与展示状态。
5. Timeline 不展示 Prompt、私有 event data、模型原始消息或 chain-of-thought。
6. 手写 Workflow 在 Day 29 迁移验收完成前仍是生产事实来源和 fallback。

## Day 28 结论

当前项目已经具备清晰的 State、Node 和调度合同。引入 LangGraph 的价值是把
图结构、条件边、运行时流和后续持久化能力标准化，不是重写 Specialist，
也不会自动提升模型输出质量。
