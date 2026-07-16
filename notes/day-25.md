# Day 25 · Page Worker：页面级状态、串行/并行取舍与 Promise Pool

## 当天结论

Day 25 把原来直接读写整课 `CourseGenerationState` 的逐页节点，迁移成真正隔离的页面执行边界：

```text
PagePlan + PageWorkerBrief + 必要全局指导 + 页面 checkpoint
  → Page Writer
  → Image Prompt / Assets
  → HTML Engineer
  → Page QA
  → PageWorkerResult
```

[`generatePageWorker`](../src/server/workflows/page-worker.ts) 不接收完整课程状态，也不能保存课程 checkpoint 或发布 SSE。它只管理一个页面的 DSL、素材、HTML、质量报告、attempts、错误和局部公开事件。

多页调度由 [`runCourseWorkersWorkflow`](../src/server/workflows/course-workers-workflow.ts) 持有。它根据 `dependsOnPageIds` 解锁页面，通过 [`runPromisePool`](../src/server/workflows/promise-pool.ts) 执行可配置的 serial/parallel 模式；parallel 默认并发度为 2。Worker 可以并发调用模型，但所有结果必须进入同一个串行 merge/checkpoint 队列，因此课程状态和事件序号仍只有一个写入者。

## 为什么 Page Worker 不是 Specialist Agent

Specialist Agent 负责一个专业判断，例如：

- Page Writer 把页面计划转换成 `PageContentDSL`。
- Image Prompt 把素材槽转换成受约束的图片请求。
- HTML Engineer 把 DSL 和批准素材转换成安全 HTML。
- Page QA 对既有产物生成只读质量报告。

Page Worker 不增加新的专业判断。它是执行边界，负责按顺序调用这些 Specialist、检查取消、记录页面局部 attempts，并把结果封装成 `PageWorkerResult`。

这种区分避免把“谁做判断”和“谁负责编排”混在一起。Worker 的 Prompt、角色或输出内容都不应与 Specialist 重叠。

## 页面局部合同

Day 25 扩展了现有 `PageGenerationState`，没有创建第二套页面事实来源。新增状态包括：

- `qa` 页面和课程公开阶段；
- `qualityReport`：现有 `QualityReport` 的页面级结果；
- `attempts`：Writer、Assets、HTML、QA 各自最多三次的局部预算；
- `workerConfig`：课程持久化的 `serial | parallel` 与 concurrency；
- `PageWorkerEvent`：尚未分配课程级 id/sequence 的局部公开事件；
- `PageWorkerResult`：`pageId + PageGenerationState + PageWorkerEvent[]`。

`PageWorkerResultSchema` 会检查结果、局部状态和每条事件是否引用同一个 `pageId`。`QualityReport` 如果以页面为目标，也必须引用当前页面。

旧 checkpoint 仍可缺少 `workerConfig`、`attempts` 和 `qualityReport`。恢复旧状态时由课程入口补齐默认 Worker 配置，不要求历史已完成页面重新执行 QA。

## Page Worker 执行与重试

Worker 内部阶段保持严格顺序：

1. 没有 DSL 时执行 Page Writer。
2. DSL 没有素材槽时确定性跳过素材 Provider；有素材槽时复用现有图片请求集缓存、ready cache、GenerateImage Skill 和 fallback。
3. HTML Engineer 消费当前页 DSL、VisualBrief 与批准素材。
4. Page QA 消费 PagePlan、DSL、HTML、素材和相邻页面上下文，只返回报告。
5. QA 完成后页面才进入 `completed / complete`，并产生 `page_done`。

每个阶段最多执行三次。只有 Provider、超时、通用 Agent 执行和阶段失败等白名单错误会自动重试；取消和结构合同错误不会无条件循环。

HTML 阶段仍保留 Day 24 的安全反馈路径：如果错误消息来自 HTML 合同校验，Worker 只提取最多 20 条问题，通过 `validationFeedback` 传回下一次 HTML 调用，不传原始 HTML 或私有推理。

页面 attempts 会进入 checkpoint，防止进程恢复后绕过同一轮预算。用户从失败 checkpoint 发起新的恢复任务时，只清空失败阶段的旧预算，允许一轮新的三次尝试，并继续保留上次安全错误作为首轮反馈。

## Promise Pool

`runPromisePool(items, worker, options)` 提供四个确定性属性：

1. 默认 `concurrency = 2`，并拒绝非正整数。
2. 结果数组与输入顺序一致，不按完成时间重排。
3. 单项 rejection 只记录在对应结果，不中断其他已启动任务。
4. `AbortSignal` 触发后不再领取新任务；未启动项返回 AbortError。

Promise Pool 只控制同时执行的 Promise 数量，不决定页面依赖、课程终态或重试策略。依赖就绪属于课程 Worker 运行层，页面重试属于单页 Worker。

## 依赖感知的课程调度

课程调度每轮只选择满足以下条件的页面：

- 页面尚未完成；
- 本轮课程执行尚未尝试该页；
- 所有 `dependsOnPageIds` 页面已经完成。

serial 模式每轮只取第一个就绪页面；parallel 模式把全部就绪页面交给 Promise Pool，但实际并发数不会超过配置。

如果一个页面失败：

- 同批已经启动的其他页面继续执行；
- 已完成页面及其 HTML、QA 报告不会被删除；
- 依赖失败页面的后继页面不会启动；
- 与失败页面无依赖关系的页面仍可以完成；
- 所有可继续页面结束后，课程以失败页面的结构化错误进入终态。

## 为什么并发 Worker 仍需要串行 merge

如果两个 Worker 都读取课程状态并分别执行：

```text
stateA = add page-01 result
stateB = add page-02 result
save(stateA)
save(stateB)
```

后写入的 `stateB` 可能覆盖 `page-01`，两个 Worker 还可能生成相同的事件 sequence。

当前实现让 Worker 只调用 `onUpdate({ state, events })`。课程运行层把每个 update 接到同一个 Promise 链：

```text
worker update
  → replace matching pageId only
  → remove/append that page's structured error
  → assign global event id + sequence
  → validate CourseGenerationStateSchema
  → checkpoint
```

因此模型调用可以并行，课程状态写入仍然串行。这是一种简单的单写者模型，不需要让 Specialist 或 Worker 获得 CourseStore 权限。

## 自动 QA 与前端

Day 25 只接入现有 Page QA，没有提前实现 Day 26 的截图或 QA 维度升级，也没有实现 Repair。

新 Worker 自动保存 `qualityReport`。课程适配器把它投影到已有 `pageQa` stage，Seaca 继续复用：

- `/chat` Agent Timeline；
- 页面 Writer、Assets、HTML、QA 进度；
- 现有 `PageQualityPanel`；
- 右侧学习空间与 sandbox HTML 预览。

并发运行状态不再通过单一 `CourseGenerationState.currentPageId/currentStage` 判断。每个 `PageGenerationState.status/currentStage` 才是页面运行状态事实来源，因此 `page-01` 可以处于 Writer，同时 `page-02` 处于 QA。

没有新增产品路由、第二套 Timeline 或框架原生流协议。SSE 仍只发送 checkpoint 快照、公开事件与终态。

## 串行与并行的取舍

串行模式的优点：

- Provider 峰值低；
- 日志顺序直观；
- 相邻页面可以自然等待上页产物；
- 更容易调试成本和失败。

并行模式的优点：

- 独立页面的模型等待时间可以重叠；
- 单页失败不必阻塞同批独立页面；
- 课程总耗时通常更短。

并行带来的代价：

- 同时占用多个模型、生图和存储请求；
- 事件会交错，必须始终按 `pageId/stage` 投影；
- 课程状态不能再依赖单一“当前页面”；
- checkpoint 必须有单写者或 reducer；
- 依赖图、取消和失败隔离必须由确定性代码控制。

默认并发度 2 是保守起点，不代表固定的性能最优值。生产环境还应结合 Provider rate limit、token/图片预算、任务优先级和实际延迟动态配置。

## 验收与验证

### 本地验收补充：Supervisor union JSON

真实兼容 Provider 在 Intent 后曾返回一个 JSON object，但没有满足 `SupervisorDecisionSchema` 的 union 分支，最终只显示 `root: Invalid input`。当时运行层其实只提供了唯一的 Planner 或 Course Design 候选，却仍因模型结构漂移停止课程。

`runSupervisorAgent` 现在只对 Provider 抛出的结构化 Schema 错误执行最小确定性降级：

- `readyToComplete=true` 且无候选时返回 `complete`；
- 没有最近失败且恰好一个候选时运行该候选；
- 最近失败可重试、预算未耗尽且恰好同一个候选时返回 `retry`；
- 多个候选、目标不一致或非 Schema Provider 错误仍然失败。

降级结果继续进入 `SupervisorDecisionSchema` 和 `runSupervisedWorkflow` 白名单校验，因此不会把任意模型输出转成可执行节点。本地真实浏览器复验中，Provider 在 Planner 决策返回无效 union 后被安全降级，Course Design 随后完成有限重试，并成功进入第 1 页 Page Worker 的 Writer、Assets 和 HTML 阶段。

本次验证覆盖：

- 单页 Worker 可以独立执行完整 Writer → Assets → HTML → QA 链路；
- Worker 不修改传入的恢复状态；
- HTML 恢复反馈与三次页面局部预算；
- Promise Pool 最大并发、结果顺序、异常隔离和取消；
- 串行/并行配置与默认并发度 2；
- 页面依赖解锁；
- 一个独立页面失败时其他页面仍完成；
- 并发页面状态与自动 QA 的 Seaca 投影；
- checkpoint、SSE、任务服务和旧状态兼容。

验证命令：

```bash
npm test
npm run lint
npm run prompt:lint
npm run build
```

当前结果：56 个测试文件、320 项测试全部通过，ESLint、Prompt lint 与生产构建通过。

## 面试追问与参考答案

### 1. Page Worker 和 Specialist Agent 是什么关系？

Specialist Agent 是职责单一的专业执行者，Page Worker 是把多个 Specialist 和工具组合成单页子流程的运行边界。Worker 本身不写内容、不决定视觉、不评分，也不拥有新的模型角色；它只负责顺序、局部状态、重试、取消和结果封装。

这种设计让每个 Agent 的输入输出仍然可以单独测试，同时让页面成为天然的隔离、恢复和并发单位。课程运行层只关心 PageWorkerResult，不需要理解 Writer 或 HTML Agent 的内部状态。

### 2. 多页并行生成时如何控制一致性和成本？

一致性由四层保证：使用同一份已校验且版本化的 CoursePlan 和 briefs；只有依赖完成的页面才能启动；Worker 不能修改全局状态；所有结果由单一 merge 队列校验、排序并 checkpoint。

成本通过受控并发、每阶段最多三次执行、取消信号、素材缓存和 Provider fallback 控制。不能直接 `Promise.all` 几十页，因为它会同时放大 token、图片调用、速率限制和失败日志。Promise Pool 把峰值限制在明确预算内，而页面级事件和错误让成本与失败仍能定位到具体 `pageId/stage`。
