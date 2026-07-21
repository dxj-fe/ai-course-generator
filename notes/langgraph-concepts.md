# LangGraph 基础概念与边界

## 学习范围

Day 28 只验证 LangGraph 的 State、Node、Edge、Conditional Edge、Reducer
和 Graph Runtime。生产课程工作流迁移、Graph Streaming 到 SSE 的映射和
持久化 checkpointer 分别留给后续训练日。

当前实现使用：

- `@langchain/langgraph` 1.4.8
- `@langchain/core` 1.2.3
- 当前官方 `StateSchema`、`ReducedValue`、`StateGraph`、`START`、`END` API
- 独立 Node 文件：`src/server/langgraph/nodes/planner-node.ts`

官方资料：

- [LangGraph Overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Quickstart](https://docs.langchain.com/oss/javascript/langgraph/quickstart)
- [Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)

## 1. State

State 是一次 Graph 执行期间的共享状态快照。Node 不应原地修改 State，而是
返回需要更新的字段。

在项目中，生产 State 是 `CourseGenerationState`。Day 28 Demo 只保留：

- `prompt`：用户输入，普通覆盖字段。
- `plan`：Planner 输出，普通覆盖字段。
- `events`：运行摘要，使用 Reducer 累计。

State 不等于前端状态，也不应保存私有推理。未来仍需由 API 客户端和
Task Controller 把服务端公开状态投影到 Seaca UI。

## 2. Node

Node 是读取当前 State 并返回部分 State 更新的函数。它可以调用模型、工具或
普通 TypeScript 逻辑；LangGraph 不要求 Node 必须是 LLM Agent。

Demo 的 `planner` 是确定性函数，不调用模型。这样测试只验证编排语义，不把
Provider 延迟、配额和随机性混入概念验收。

## 3. Edge

Edge 决定 Node 完成后执行什么：

- 普通 Edge 表达固定顺序。
- `START` 表示 Graph 入口。
- `END` 表示 Graph 终点。

Demo 使用 `START → planner → END`。生产流程中的 Intent → Planner →
Course Design 也是固定 Edge 候选。

## 4. Conditional Edge

Conditional Edge 读取 State，并根据确定性规则返回下一节点或 `END`。

当前项目的 Supervisor 已经承担类似职责：它只能在运行层计算出的可用节点中
选择目标，并受重试预算、取消状态、完成条件和全局决策上限约束。

Day 28 不把 Supervisor 接入 StateGraph，防止概念 Demo 演变为 Day 29 迁移。

## 5. Reducer

Reducer 决定单个 State 字段如何应用 Node 更新：

```text
newValue = reducer(currentValue, nodeUpdate)
```

没有自定义 Reducer 时，字段更新采用覆盖语义。Demo 的 `events` 使用数组追加
Reducer，因此输入中的 start 事件和 Planner 返回的完成事件都保留。

Reducer 必须确定、无副作用，并考虑并行和重放。生产 `pages` 不能使用简单
`concat`，否则同一页面可能重复；未来应按 `pageId` 合并后运行完整 Schema 校验。

## 6. Graph Runtime

`StateGraph` 是图构建器；添加 Node 和 Edge 后必须 `compile()` 才能得到可执行
Graph。编译后的 Graph 提供 `invoke` 和 `stream`。

Day 28 使用：

- `invoke`：验证最终 `plan` 与累计 `events`。
- `streamMode: "updates"`：只观察 Planner 返回的状态增量。

原生 stream chunk 不是产品事件。未来接入生产时必须先在服务端转换成严格的
`CourseGenerationPublicEvent`，再通过现有 checkpoint、EventBus 和 SSE 发送。

## LangGraph、LangChain 与 AI SDK

- LangGraph：低层状态与工作流编排运行时。
- LangChain：模型、工具、消息、检索和高层 Agent 组件集合。
- AI SDK：本项目现有模型调用、结构化输出和文本流能力。

LangGraph 可以单独使用，也可以在 Node 内调用现有 AI SDK Agent。Day 28 不用
LangChain Model 替换现有 AI SDK 客户端，避免同时迁移编排层和模型调用层。

## 运行验证

```bash
pnpm test -- tests/unit/server/langgraph/course-workflow-demo.test.ts
pnpm lint
pnpm test
pnpm build
```

定向测试覆盖：

1. `START → planner → END` 能完成。
2. `plan` 使用覆盖更新。
3. `events` Reducer 保留 start 并追加 Planner 事件。
4. 调用方输入不被原地修改。
5. `updates` 流只暴露 Planner 的部分更新。
6. 无效 Prompt 在 Node 执行前失败。

## 面试复盘

### LangGraph 会让 Agent 更聪明吗？

不会。它让状态、分支、循环、恢复和流式事件更可控。模型质量仍由模型选择、
Prompt、上下文、工具、Schema、QA 和 Repair 决定。

### 为什么 Reducer 需要按字段设计？

不同字段的业务语义不同。阶段和单一产物适合覆盖，事件适合追加，并行页面需要
按稳定 ID 合并。一个通用的深合并函数无法正确表达这些差异。

### 为什么前端不能直接消费 graph stream？

框架 chunk 可能随版本、stream mode 和节点实现变化，也可能携带不适合公开的
内部数据。服务端产品事件协议能稳定 UI，并继续执行安全白名单和恢复语义。
