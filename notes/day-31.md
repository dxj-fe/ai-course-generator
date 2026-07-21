# Day 31 · LangGraph Supervisor 与条件路由

## 当天结论

生产课程 Graph 已从固定边升级为受控动态拓扑。Supervisor 只读取经过共享 Schema 校验的课程状态、页面状态、QA 结论和持久化预算；它不生成业务产物，也不读取 Prompt、原生框架事件或 chain-of-thought。条件边只消费已经持久化的 `SupervisorDecision`，因此决定、公开事件、checkpoint 与实际跳转保持一致。

## 当前拓扑

```text
START → Supervisor
  ├─ 缺少 Intent ─────────────→ Intent ────────┐
  ├─ 缺少 CoursePlan ─────────→ Planner ───────┤
  ├─ 缺少专业 briefs ─────────→ Course Design ─┤
  ├─ 页面可执行 ──────────────→ Page Workers ──┤
  ├─ QA shouldRepair ─────────→ Repair/re-QA ──┤→ Supervisor
  ├─ 可重试页面失败 ──────────→ Retry Page ────┤
  ├─ 全部页面完成 ────────────→ Finalize → END
  └─ 取消/预算耗尽/不可恢复 ──→ Mark Failed → END
```

Intent、Planner 和 Course Design 节点继续使用原 `WorkflowNode`。页面依赖、并发、Writer/Assets/HTML/QA、issue 分类、Repair 候选校验与 checkpoint merge 继续由现有 Page Worker 运行层负责；Graph 不复制这些业务规则。

## 路由表

| 已验证状态事实 | Supervisor 决策 | Graph 节点 | 有界条件 |
| --- | --- | --- | --- |
| 缺少 `intent` | `run(intent)` | `intent-node` | 同目标最多 3 次 |
| 缺少 `outline` | `run(planner)` | `planner-node` | 同目标最多 3 次 |
| 缺少 briefs / handoff / worker config | `run(course-design)` | `briefs-node` | 同目标最多 3 次 |
| 有 QA `shouldRepair` 页面 | `run(repair, pageId)` | `repair-page-node` | 单次只执行 1 轮，总计最多 2 轮 |
| 页面以可重试错误失败 | `retry(page-worker, pageId)` | `retry-page-node` | 目标页阶段/Graph attempt 最多 3 次 |
| 有依赖已满足的未完成页面 | `run(page-worker, pageId)` | `page-workers-node` | QA 或失败出现后交还 Supervisor |
| 所有页面完成 | `complete` | `finalize-node` | 单向终态 |
| 取消、不可恢复、预算耗尽或无合法节点 | `stop` | `mark-failed-node` | 单向终态 |

## 为什么采用规则优先 Supervisor

“缺少规划就执行 Planner”“QA 明确要求修订就进入 Repair”“预算耗尽就停止”都只有一个合法答案。使用模型做这些判断会增加延迟、费用和非确定性，并可能产生越权目标。模型 Supervisor 只在存在无法由可靠规则表达的语义选择时才有价值；当前核心课程图不需要这种自由度。

## 有界循环与失败恢复

Graph 允许回到 Supervisor，但不允许无条件自循环：

- `decisionCount` 提供全局决策上限；
- `SupervisorAttempt` 为 node/page 目标保留最多 3 次执行记录；
- Page Worker 阶段 attempts 与 Graph attempts 共同决定页面是否还能 Retry；
- `repairHistory` 是最多 2 轮的持久化事实；
- `repair-page-node` 每次只授权一轮，完成后必须重新经过 Supervisor；
- `mark-failed-node` 保留具体页面错误码，Supervisor stop 原因保存在 `lastDecision`，显式恢复时可以重新评估已重置阶段的 retryability。

LangGraph 自身的 recursion limit 是框架步数保险，不是业务重试预算。一个 Supervisor decision 和其目标节点最多占用两个 Graph steps；五页课程在前三页各执行两轮合法 Repair 时会超过框架默认的 25 steps。生产 `invoke` 与 `stream` 因此统一使用 130-step ceiling，使其高于持久化的 64-decision 领域 guard。真正的停止条件仍是 node/page 三次 attempt、两轮 Repair 和全局 decision limit；提高框架 ceiling 不会放开无限重试。早期被默认 25-step 错误覆盖的 checkpoint 也可以在显式恢复时重新进入当前页面。

## 数据与 UI 边界

```text
Agent / Page Worker
  → validated CourseGenerationState
  → SupervisorDecision + checkpoint
  → LangGraph conditional edge
  → Day 30 strict stream mapper
  → task EventBus / snapshot / event / terminal SSE
  → API client / task controller
  → existing /chat Timeline and learning workspace
```

条件路由不会进入浏览器。UI 只看结构化公开 decision 摘要、页面阶段、错误和终态，不读取 LangGraph chunk、Graph 节点内部状态或私有推理。本日没有新增路由、组件或第二套视觉系统。

## 关键测试

- 拓扑测试确认 `START → supervisor`，所有非终态节点返回 Supervisor，Finalize/Mark Failed 进入 END；
- 路由单测覆盖 Planner、Repair、Retry、Stop 白名单映射；
- QA 单测覆盖 `shouldRepair → Repair` 与两轮预算耗尽；
- 页面失败单测覆盖可重试错误与三次预算耗尽；
- Page Worker 单测覆盖 QA 后暂停、单轮 Repair 后继续；
- Graph 集成测试覆盖完整课程、Planner 失败、事件 streaming 和失败页面断点恢复；
- 五页多 Repair 回归同时覆盖 `invoke` 与产品 `stream`，证明超过默认 25 steps 后仍由领域预算完成或停止；
- parity 测试确认手写入口与 Graph 领域产物一致，且两者都有安全的 Supervisor decision 事件。

## 面试题与参考答案

### 1. Conditional Edge 与普通 Edge 的区别是什么？

普通 Edge 的目标在编译时固定；Conditional Edge 在节点完成后根据状态返回一个声明过的路由键。在本项目中，Supervisor 先生成并持久化经过 Schema 校验的 decision，`routeBySupervisor` 再把它映射到有限节点白名单。这样动态的是调度路径，不是业务权限。代价是必须为每条分支设计终止条件和测试。

### 2. 为什么条件函数不直接检查所有业务状态？

如果条件函数重新做一次决策，checkpoint 中的 Supervisor 事件可能与实际跳转不一致。当前条件函数只读取 `lastDecision`；状态判断由 Supervisor 节点完成，decision 与事件先持久化，然后才跳转。常见追问是故障恢复：恢复后重新运行 Supervisor 节点即可基于最新状态产生新决定。

### 3. 如何防止 Graph 无限循环？

需要多层预算而不是只依赖框架 recursion limit：全局 decision limit、node/page attempt limit、Page Worker 阶段 attempt、Repair 两轮预算以及 deterministic stop。框架 recursion limit 只是最后保险，不能表达用户可理解的失败原因。本项目在预算耗尽时进入 Mark Failed，并保留可公开的结构化 stop reason。

### 4. 为什么 Repair 没有完全拆成新的业务实现？

Graph 负责“何时允许执行”，Page Worker 负责“如何分类 issue、限制 scope、校验候选并 re-QA”。复制实现会产生两个 Repair 事实来源。当前只给 Page Worker 增加每次运行的 Repair 轮数上限，使 Graph 可以在每轮后重新取得控制权；权衡是节点更粗，但领域规则保持单一所有者。

### 5. LangGraph Supervisor 与前端 Controller 的边界是什么？

Supervisor 是服务端业务控制面，Controller 是产品状态投影。Supervisor 决定下一节点并写 checkpoint；Controller 只把严格 SSE 中的课程、页面和公开事件映射到 UI。前端不能根据摘要文本复制重试或 Repair 规则，否则更换传输或恢复状态时会发生漂移。

## 当天复盘

1. 哪些课程调度分支是确定性事实，哪些未来才可能需要模型判断？
2. 如果新增人工审批节点，应该增加哪一种状态事实、decision 和终止条件？
3. 为什么显式恢复可以重置当前阶段 attempt，却不能清空 Repair 历史？
4. 如何证明 UI 没有从事件摘要反推 Graph 路由？
5. 当一个节点执行成功但没有产生任何新状态时，Supervisor 应如何识别 no-progress？
