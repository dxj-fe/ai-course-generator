# LangGraph Streaming 与产品 SSE 边界

## 目标

Day 30 将 Day 29 的生产 `StateGraph` 从仅返回 `invoke` 终态扩展为可实时消费的 `updates/custom` 流，同时保持 Day 19 已建立的任务、checkpoint、SSE、Controller 和 Keya Timeline 合同。

## 两层 streaming

- LangGraph streaming 是服务端运行时输出：`updates` 表示节点状态更新，`custom` 承载应用主动写出的 checkpoint envelope。
- SSE 是浏览器传输协议：只发送共享 Schema 允许的 `snapshot`、公开 `event` 和 `terminal`。
- `Last-Event-ID` 恢复浏览器事件游标；课程 checkpoint 恢复服务端生成状态。两者不能互相替代。

## 当前数据流

```text
graph.stream([updates, custom])
  -> mapGraphChunkToAgentEvent
  -> validated CourseGenerationState + public events
  -> CourseGenerationTaskService (persist before publish)
  -> CourseTaskEventBus
  -> existing task SSE route
  -> useSSETask
  -> Keya Timeline / learning workspace
```

`custom` envelope 只在服务端内部存在。它必须是一个严格的 checkpoint 对象；mapper 会校验完整课程状态、当前 trace、连续 sequence 和已知节点名，并且只提取既有 `CourseGenerationPublicEvent`。`debug`、`messages`、未知 mode、未知节点和任意私有字段都会被拒绝。

## 为什么同时使用 updates 与 custom

`updates` 在 LangGraph 节点完成后提供节点结果，适合收敛最终状态；但 `page-workers-node` 内部可能包含多个页面和多个 Agent，仅依靠节点完成事件不够实时。现有课程运行时已经在 Agent/页面边界生成 checkpoint，因此 Graph 依赖包装器会在 checkpoint 保存后写入 `custom` channel，让页面级公开事件在整个 Graph 完成前到达任务服务。

## 去重与顺序

- 全局公开事件的 `sequence` 是唯一顺序依据。
- mapper 和任务服务分别维护单调 cursor；同一个 checkpoint 随后的 node update 不会再次发布事件。
- 初始 snapshot 可以包含已产生的事件；后续 event 必须严格等于客户端最后 sequence 加一。
- 并行页面可以交错，但单个页面的 Writer、Assets、HTML、QA、Repair 阶段仍由服务端工作流保证顺序。

## 运行来源

任务记录和每个 SSE 消息都包含严格的 `source: workflow | langgraph`。旧任务记录缺少该字段时按 `workflow` 解析；新 `/chat` 课程任务明确选择 `langgraph`。来源是产品元数据，不包含 Graph 节点、框架配置或调试信息。

## 验证

```bash
pnpm exec vitest run tests/unit/server/langgraph/graph-stream-map.test.ts
pnpm exec vitest run tests/unit/server/langgraph/course-generation-graph.test.ts
pnpm exec vitest run tests/unit/server/tasks/course-generation-task-service.test.ts
pnpm exec vitest run tests/unit/app/api/course-task-routes.test.ts
pnpm exec vitest run tests/unit/features/course-task-stream.test.ts
pnpm exec vitest run tests/unit/features/course-run-timeline.test.tsx
pnpm lint
pnpm test
pnpm build
```

自动化五页用例使用确定性 Agent，检查全部事件连续、运行中更新先于终态、五页 `page_done` 与 CoursePlan 顺序一致。真实模型验收是独立步骤，不应用来替代协议和顺序测试。
