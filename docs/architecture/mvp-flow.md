# 当前课程生成 MVP 流程

> **IMPLEMENTED / 当前事实**
>
> 本文只描述当前产品真实运行的课程生成链路。它是由 TypeScript 明确编排的可恢复串行 workflow，不是 Supervisor 调度，也没有使用 LangGraph。

## 产品入口与完整调用链

`/chat` 通过类型化任务客户端创建后台任务；Route Handler 返回 `202` 后，任务服务在服务端持有任务生命周期和取消信号。课程 workflow 依次完成全局规划、专业设计和逐页生成，并在稳定边界保存 checkpoint。SSE 只传输共享协议中的快照、公开事件和终态，前端 controller 再把它们投影到对话 Timeline 与右侧 learning workspace。

```mermaid
flowchart TD
  Chat["/chat composer"] --> Client["createCourseTask()<br/>typed task API client"]
  Client --> TaskRoute["POST /api/courses/tasks<br/>202 queued"]
  TaskRoute --> After["Next.js after()"]
  After --> TaskService["CourseGenerationTaskService<br/>queued -> running -> terminal"]
  TaskService --> Workflow["runCourseGenerationWorkflow"]

  Workflow --> Intent["Intent"]
  Intent --> Planner["Course Planner"]

  subgraph DesignWorkflow ["Course Design Workflow"]
    Pedagogy["Pedagogy Agent"] --> Story["Story Agent"]
    Story --> Visual["Visual Director"]
  end

  Planner --> Pedagogy

  Visual --> PageLoop{"下一规划页面"}
  PageLoop --> PageWriter["Page Writer<br/>PageContentDSL"]
  PageWriter --> AssetSlots{"是否有 asset slots"}
  AssetSlots -->|"否"| SkipAssets["确定性跳过素材"]
  AssetSlots -->|"是"| ImagePrompt["Image Prompt Agent<br/>或 request-set cache"]
  ImagePrompt --> AssetLoop["按 slot 串行解析"]
  AssetLoop --> AssetCache{"ready asset cache"}
  AssetCache -->|"hit"| AssetResult["AssetGenerationResult"]
  AssetCache -->|"miss / stale / bypass"| ImageSkill["GenerateImage Skill"]
  ImageSkill -->|"ready"| AssetResult
  ImageSkill -->|"provider failure"| Fallback["typed fallback"]
  Fallback --> AssetResult
  AssetResult --> MoreSlots{"仍有素材槽?"}
  MoreSlots -->|"是"| AssetLoop
  SkipAssets --> Html["HTML Engineer"]
  MoreSlots -->|"否"| Html
  Html --> PageDone["validated HtmlOutput<br/>page_done"]
  PageDone --> MorePages{"仍有页面?"}
  MorePages -->|"是"| PageLoop
  MorePages -->|"否"| Complete["CourseGenerationState completed"]

  Workflow -. "每个稳定边界" .-> Checkpoint["typed checkpoint"]
  Checkpoint --> CourseStore["CourseStore"]
  Checkpoint --> EventBus["single-process EventBus"]
  TaskService --> TaskStore["CourseTaskStore"]
  EventBus --> SSE["GET /api/courses/tasks/:taskId/events"]
  CourseStore --> SSE
  SSE --> Controller["useSSETask + ChatApp controller"]
  Controller --> Timeline["chat thread / Agent Timeline"]
  Controller --> Workspace["learning workspace / preview"]

  PageDone -. "用户显式触发，可选旁路" .-> QA["Page QA<br/>report only"]
  QA -. "QualityReport，不修改 HTML" .-> Workspace
```

## 当前串行顺序

顶层事实来源是 [`runCourseGenerationWorkflow`](../../src/server/workflows/course-generation-workflow.ts)：

1. 创建新状态，或校验并加载已有 [`CourseGenerationState`](../../src/shared/course-schema/course-generation-state.ts)。
2. 缺少 `intent` 时运行 Intent；成功后保存 checkpoint。
3. 缺少 `outline` 时运行 [`Course Planner`](../../src/server/agents/course-planner-agent.ts)；Planner 由确定性代码补齐 ID、模板和依赖。当前每一页都依赖它的前一页，因此页面天然串行。
4. 缺少专业 briefs 时进入 [`Course Design Workflow`](../../src/server/workflows/course-design-workflow.ts)，严格按 `Pedagogy -> Story -> Visual` 执行，再投影出逐页 `PageWorkerBrief`。
5. 按 `CoursePlan.pages` 顺序遍历页面。每页依次执行 `Page Writer -> Assets -> HTML Engineer`；当前页失败会停止当前页及所有后继页，但保留此前已完成的 HTML。
6. 所有页面完成后，课程进入 `completed` 并保存最终 checkpoint。

每个 Agent 自己仍使用统一的最小状态、步骤上限和结构化事件合同，见 [`minimal-agent.ts`](../../src/server/agents/core/minimal-agent.ts)。不过，哪个 Agent 何时执行不是模型决定的，而是顶层 workflow 中的固定分支决定的。

## 素材子流程

[`runImageAssetWorkflow`](../../src/server/workflows/image-asset-workflow.ts) 是页面素材阶段的真实实现：

- 先查询完整 `AssetRequest[]` 的 request-set cache；未命中时才调用 Image Prompt Agent。
- 按素材槽顺序逐个查询 ready asset cache。
- 未命中、失效或没有可用模型身份时调用 [`GenerateImage Skill`](../../src/server/tools/generate-image-skill.ts)。Skill 是有类型输入输出的工具，不是 Specialist Agent。
- 生图失败可以返回结构化 fallback，素材 workflow 仍可完成。
- cache 读写错误被计入公开摘要，但不会阻断生图主链路。
- 父 workflow 只在整页素材阶段完成后保存该页全部 `assets`。

## Checkpoint、任务服务与 SSE

[`CourseGenerationTaskService`](../../src/server/tasks/course-generation-task-service.ts) 负责 `queued / running / completed / failed / cancelled` 生命周期，而不是生成课程内容。它把 workflow 的 checkpoint 回调接到：

- [`CourseStore`](../../src/server/storage/course-store.ts)：保存可恢复的课程聚合；
- [`CourseTaskStore`](../../src/server/storage/course-task-store.ts)：保存 task 与 course 的映射及任务终态；
- [`CourseTaskEventBus`](../../src/server/tasks/course-task-event-bus.ts)：向当前进程的订阅者发布新事件；
- [`SSE Route`](../../src/app/api/courses/tasks/[taskId]/events/route.ts)：先从 checkpoint 快照或 `Last-Event-ID` 重放，再切到实时订阅。

workflow 会在长耗时 Agent 运行前保存 `agent_start`，并在校验后的阶段结果、页面完成、失败和整课完成处再次 checkpoint。恢复时依据已保存的 `intent`、`outline`、brief、DSL、素材阶段和 `htmlOutput` 跳过已完成工作，而不是从 UI 状态推测进度。

SSE 合同由 [`course-task-event.ts`](../../src/shared/course-schema/course-task-event.ts) 定义，只允许：

- 完整、已校验的课程快照；
- 结构化公开事件；
- 与课程 checkpoint 一致的终态。

顶层 workflow 在持久化 Agent 事件时只保留 `type`、`stage`、`pageId`、`agent`、`step`、`summary`、时间和 trace 信息，不复制 Agent 原生 `data`，因此不会把 Prompt、模型私有上下文或 chain-of-thought 发送给前端。

## 前端数据边界

[`course-task-api.ts`](../../src/features/course-planner/lib/course-task-api.ts) 只负责创建和取消任务；[`use-sse-task.ts`](../../src/features/course-planner/hooks/use-sse-task.ts) 把 SSE 消息转换为共享的类型化任务状态。[`ChatApp`](../../src/features/seaca/chat-app.tsx) 充当当前产品的 Task Controller，再把状态传给：

- [`ChatThread`](../../src/features/seaca/chat-thread.tsx) 与 [`CourseRunTimeline`](../../src/features/seaca/course-run-timeline.tsx)：公开 Agent 进度、耗时、错误和恢复；
- [`CourseWorkspacePanel`](../../src/features/seaca/course-workspace-panel.tsx)：规划、DSL、素材、HTML、安全预览和质量报告。

展示组件不直接调用生成业务 API，也不消费框架原生流事件。

## QA 是可选旁路

[`Page QA Agent`](../../src/server/agents/page-qa-agent.ts) 与 [`/api/pages/qa`](../../src/app/api/pages/qa/route.ts) 已经存在，但它们没有接入 `runCourseGenerationWorkflow` 的必需成功路径。当前用户在 HTML 已生成后显式运行 QA：

- QA 只返回 `QualityReport`；
- QA 不修改 HTML；
- QA 失败不抹掉已经交付的页面；
- 当前没有自动 `QA -> Repair -> re-QA` 循环。

## 当前明确不存在的能力

- 没有 Supervisor Agent，也没有基于状态的动态节点选择。
- 没有 Repair Agent 或自动修复循环。
- 没有 Page Worker 隔离执行单元或受控页面并发；“Page Worker brief”只是逐页输入合同。
- 没有 LangGraph StateGraph、条件边、Reducer 或框架原生 streaming。
- 没有自动 Page QA 质量门槛。
- EventBus 与活动任务去重都是单进程实现，不是分布式任务队列或 lease。

目标架构及其停止条件见 [`multi-agent-flow.md`](./multi-agent-flow.md)。
