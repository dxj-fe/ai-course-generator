# LangGraph 生产迁移说明

## 迁移范围

Day 29 把课程生成的核心固定路径迁移为可执行 StateGraph，但没有替换产品任务服务的默认运行时：

```text
START
  → intent-node
  → planner-node
  → briefs-node
  → page-workers-node
  → finalize-node
  → END
```

Graph Node 只适配现有业务边界。Intent、Planner 和 Briefs 继续使用 `CourseGenerationNode`；Page Workers 继续使用依赖感知、默认并发度 2 的课程 Worker 运行层；Finalize 继续使用共享完成态与 checkpoint 逻辑。

## 单一状态模型

`CourseGenerationGraphStateSchema` 直接从 `CourseGenerationStateSchema.shape` 构造。LangGraph 只提供字段通道和固定调度；每个节点输入、节点输出及最终结果仍通过完整 `CourseGenerationStateSchema`，因此页面引用、事件顺序、课程完成态和跨字段约束没有迁移到第二份 Schema。

顶层节点当前按固定边串行执行。`events`、`pages` 和 `errors` 返回已由共享运行时合并、重排并校验的完整快照，不提前添加顶层并行 Reducer。Page Worker 内部并发仍由 Promise Pool 与串行 merge/checkpoint 队列处理。

## 共享生命周期

`course-generation-runtime.ts` 现在同时服务两种 runner：

- 初始化新状态和恢复 checkpoint；
- 校验并执行现有 WorkflowNode；
- 在长 Agent 前 checkpoint `agent_start`；
- 净化并追加节点公开事件；
- 生成 failed/cancelled/completed 状态；
- 重新执行聚合 Schema 并调用注入的 checkpoint。

Graph Node 不直接保存 CourseStore，也不直接发布 SSE。Task Service 仍负责在 checkpoint 成功后发布 snapshot/event/terminal。

## Handwritten fallback

`runCourseGenerationWorkflow` 仍由 `CourseGenerationTaskService` 默认调用，并保留受限 Supervisor 的 run/retry/complete/stop 决策和公开 `supervisor_decision` 事件。`runCourseGenerationGraphWorkflow` 是另一个显式入口，不会在失败后自动调用手写版本，避免模型、生图和存储副作用重复执行。

确定性 parity 测试比较两种运行时的 Intent、CoursePlan、专业 briefs、PageWorkerBrief、页面产物、错误和完成态。Supervisor 决策事件属于手写运行时特有的可观测信息，不要求逐条相同。

## 未迁移范围

- Graph stream 到产品 `CourseGenerationPublicEvent` 的适配；
- Graph checkpointer 与现有 CourseStore checkpoint 的替换；
- Supervisor conditional edge；
- LangGraph 原生页面并行、`Send` 或 `Command`；
- 任务服务默认运行时切换；
- 任何 React、Controller、API 请求字段或产品路由。

这些边界使 Day 30 可以只替换运行时流映射，而不重新设计 SSE 或 Seaca UI。
