# Day 29 · 生产课程流程迁移到 LangGraph StateGraph

## 当天结论

本次迁移的核心不是把已有 TypeScript 改写成另一套框架语法，而是让 StateGraph 调度现有业务合同。生产 Graph 使用唯一的 `CourseGenerationState`，通过五个粗粒度节点完成整课生成；手写 Supervisor workflow 仍是产品默认和显式 fallback。

## 为什么使用粗粒度节点

Intent、Planner 和 Course Design 已经是稳定的课程级 `WorkflowNode`，适合直接映射。页面侧已有隔离 Page Worker、依赖调度、Promise Pool、阶段重试、QA、两轮 Repair 和 checkpoint merge。如果把这些阶段再次拆成顶层 Graph Node，就会产生两个页面调度所有者，并破坏已验证的恢复语义。因此 Day 29 只设置一个 `page-workers-node`。

## 状态与更新策略

Graph State 字段来自共享 Schema。普通字段和数组字段都由当前串行节点返回完整新快照，每次更新后重新执行聚合 Schema。Day 28 Demo 的 events Reducer 用于学习累计语义；生产 Graph 没有为了“使用 Reducer”而重复追加已经编号的公开事件。

未来若顶层 Graph 真正并行执行页面，`pages` 必须按 `pageId` 合并，`events` 必须由单一产品层重新编号，`errors` 必须去重并限制公开字段；不能使用通用数组 concat。

## 失败、恢复与 fallback

预期的节点失败会转换为已校验的 failed/cancelled `CourseGenerationState`，后续固定节点看到终态后保持 no-op，Graph 最终仍返回可持久化状态。恢复时初始化器保留已完成全局产物和页面，三个全局节点确定性跳过，Page Worker 只运行失败页与其后继页。

Graph 失败不会隐式重跑手写 workflow。Fallback 是调用方明确选择的另一入口，因为自动双跑可能重复外部模型、生图、缓存和 checkpoint 副作用。

## 面试题与参考答案

### 1. LangGraph 迁移给项目带来了什么，而没有带来什么？

它带来显式、可编译的 State/Node/Edge 拓扑和后续 streaming/checkpointer 扩展点；没有提升模型智力，也没有替代 Prompt、Schema、validator、业务 workflow 或前端状态管理。在本项目中，Graph Node 仍调用 AI SDK Agent 和现有 Page Worker。

### 2. 如何避免框架迁移造成业务逻辑重写？

先把框架无关的初始化、节点生命周期、失败、完成和 checkpoint 提取为共享运行时，再让两种 runner 调用它。Graph Node 是适配器，不重新定义 CoursePlan、Page DSL、HTML、QA 或 Repair 规则。代价是迁移期要维护两个入口，因此必须用 parity 测试和明确的默认运行时控制范围。

### 3. 为什么不能让 Graph State 和领域 State 各自维护一套 Schema？

两份 Schema 会在字段新增、跨字段约束和恢复版本上漂移。当前 Graph 直接复用 `CourseGenerationStateSchema.shape`，并在节点后执行完整聚合校验。字段级通道校验解决局部类型，聚合 Schema 继续解决事件顺序、页面引用和 completed 完整性。

### 4. 为什么 Graph 失败后不能自动 fallback？

Agent 和工具有外部副作用。一次 Graph 运行可能已经调用模型、生成图片并写入 checkpoint；自动启动手写版本会造成重复费用、产物冲突和事件重复。安全 fallback 应在运行前显式选择，或基于同一 checkpoint 由用户发起恢复。

### 5. Graph stream 为什么不能直接传给前端？

Graph chunk 是框架运行时格式，会随 stream mode、节点名和版本变化，也可能包含内部状态。产品前端只应消费稳定的 `CourseGenerationPublicEvent` 和课程快照。Day 30 应在服务端完成 chunk 到公开事件的映射，再复用既有 SSE、Controller 和 Timeline。

## 验证重点

- 固定拓扑能够生成完整三页课程；
- Planner 失败不会运行后续业务节点；
- 失败页面恢复时不重跑全局节点和已完成页面；
- Graph 与 handwritten runner 的领域产物一致；
- Agent 私有 `data` 不进入公开事件；
- 手写 workflow 的既有测试在共享运行时提取后保持通过。
