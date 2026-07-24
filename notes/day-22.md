# Day 22 · 手写多 Agent Workflow：串行 Specialists 替代大函数流程

## 当天结论

Day 22 把课程生成从“一个顶层函数直接承载各阶段执行细节”重构为“兼容 facade + 领域节点工厂 + 通用串行运行器”。这次改动提升的是服务端编排的显式性、可测试性和失败定位能力，不是增加模型 Agent，也不是引入动态调度。

当前入口仍是 [`runCourseGenerationWorkflow`](../src/server/workflows/course-generation-workflow.ts)：

- [`sequential-workflow.ts`](../src/server/workflows/sequential-workflow.ts) 提供通用 `WorkflowNode`、`requiredInputs`、`produces`、`runSequentialWorkflow` 与 `WorkflowNodeError`；
- [`course-generation-nodes.ts`](../src/server/workflows/course-generation-nodes.ts) 把 Intent、Planner、Course Design、逐页 Writer、Assets、HTML 包装成课程领域节点；
- facade 根据已校验 checkpoint 按固定阶段顺序选择仍需执行的节点，继续负责页面依赖、完成/失败映射与 checkpoint 生命周期；
- [`CourseGenerationStateSchema`](../src/shared/course-schema/course-generation-state.ts) 仍是可持久化整课状态的事实来源。

本日没有新增 `/api/courses/generate-workflow`。现有异步任务 API、SSE、前端 Controller、Timeline、learning workspace、共享 Schema、取消和恢复语义全部保持兼容。

## 重构前后对比

| 维度 | 重构前 | Day 22 之后 |
| --- | --- | --- |
| 公共入口 | `runCourseGenerationWorkflow` | 相同；保留为 compatibility facade |
| 阶段顺序 | 顶层函数中的 `if / for` 与 Agent 调用细节交织 | facade 按 checkpoint 和页面依赖装配固定顺序节点，Agent 调用细节收进领域节点 |
| Handoff | 依赖局部代码约定 | `requiredInputs` 显式声明前置值 |
| 输出权限 | 每个分支自行构造下一状态 | `produces` 同时声明必需产物与允许写入的顶层 patch 字段 |
| 状态合并 | 分散在顶层分支 | `runSequentialWorkflow` 调用唯一 merge；课程 facade 使用 `CourseGenerationStateSchema.parse` 复验完整状态 |
| 失败定位 | 主要依赖阶段分支和错误映射 | `WorkflowNodeError` 始终携带 `nodeName`，课程 facade 再映射原有 stage/page/agent/code/message |
| Agent 事件 | 顶层流程逐段聚合 | 节点返回安全投影后的事件，运行层在 checkpoint 前统一追加；原生私有 `data` 不进入公开状态 |
| 恢复 | 根据 checkpoint 中已有产物跳过阶段 | 语义不变；facade 只装配缺失全局产物和失败页尚未完成的节点 |
| UI/传输 | Task API → SSE → Controller → Keya UI | 完全不变；前端不知道服务端从大函数改成节点运行器 |
| 动态能力 | 无 Supervisor、无自动重试/循环、无页面并发 | 仍然没有；显式节点不是动态多 Agent 调度 |

重构没有把所有业务逻辑塞进一个“万能 Node”。领域规则仍由原来的 Agent、Schema、Registry 与子流程负责：

- Intent 节点复用 `generateCourseIntent`；
- Planner 节点复用 `runCoursePlannerAgent`；
- Course Design 节点复用 `runCourseDesignWorkflow`，内部仍是 Pedagogy → Story → Visual；
- Assets 节点复用 `runImageAssetWorkflow`，缓存、Provider、fallback 语义不变；
- Writer 与 HTML 节点继续只处理一个页面。

## WorkflowNode 合同

通用节点的核心形状可以概括为：

```ts
type WorkflowNode<State, Context, Event> = {
  name: string;
  requiredInputs: readonly WorkflowValue<State>[];
  produces: readonly WorkflowValue<State>[];
  run(
    state: Readonly<State>,
    context: Context,
  ): Promise<{
    patch: Partial<State>;
    events: readonly Event[];
  }>;
};
```

四个字段各自承担不同责任：

1. `name`：稳定的执行和错误定位标识；它不是展示文案。
2. `requiredInputs`：节点运行前必须能从当前状态选择到的值。缺失时返回 `WORKFLOW_NODE_INPUT_MISSING`，节点不会被调用。
3. `produces`：一方面限定 patch 可写的顶层字段，另一方面用 selector 确认合并后的具体产物确实存在。
4. `run`：只计算节点候选 patch 和公开安全事件；不能保存整课 checkpoint、直接发布 SSE 或绕过集中 merge。

`WorkflowValue` 同时保留人类可读名称、顶层状态 key 和 selector。selector 很重要：仅检查 `pages` 这个数组存在，并不能证明目标页已经拥有 DSL 或 HTML；页面节点可以用 selector 检查 `pages[pageId].content`、当前阶段或 `htmlOutput`。

### `produces` 的保护范围

当前白名单约束的是 patch 的**顶层 key**。例如页面节点可以声明写 `pages`，再由 selector 确认目标页产物和阶段迁移。它不是深层字段级 capability system，因此仍必须依靠：

- 聚焦的课程节点实现；
- 合并后的 `CourseGenerationStateSchema`；
- PagePlan、brief、DSL、素材与 HTML 的业务一致性校验；
- 单元测试验证节点没有越权修改其他状态。

如果未来需要不可信插件节点，单靠顶层 `produces` 不够，还需要更细的 patch schema 或领域 reducer。Day 22 不提前增加这类复杂度。

## 串行执行与集中 merge

[`runSequentialWorkflow`](../src/server/workflows/sequential-workflow.ts) 对每个节点执行相同生命周期：

1. 检查全部 `requiredInputs`；
2. 运行可选 `beforeNode`，课程流程在这里投影真实 `agent_start` 并先 checkpoint；
3. 调用节点 `run`；
4. 拒绝 `produces` 未声明的 patch 顶层字段；
5. 调用唯一 `merge`；课程流程用 `CourseGenerationStateSchema.parse({ ...state, ...patch })` 校验完整状态；
6. 检查 `produces` 的 selector 在合并后都能选到有效产物；
7. 运行可选 `afterNode`，追加节点公开事件、`agent_done`、可选 `page_done`，再按原语义 checkpoint；
8. 将新状态交给下一个节点。

任何一步失败都会停止后继节点，并返回失败前最后一个被接受的状态。未知异常会被包装为安全的 `WorkflowNodeError`；课程节点的已知失败通过 `CourseGenerationNodeError` 保留稳定错误码和已投影的公开事件，再由 facade 映射到原有课程错误合同。

集中 merge 的价值不只是少写展开运算符。它保证所有 Specialist 节点 patch 都必须经过同一个完整状态 Schema；facade 仍负责开始、失败和完成等课程生命周期迁移。未来替换执行框架时，领域产物仍只有一个接受边界。

## 课程领域节点与固定顺序

课程节点在 [`course-generation-nodes.ts`](../src/server/workflows/course-generation-nodes.ts) 中定义，但实际待执行数组由 facade 根据 checkpoint 构造：

```text
缺 intent              → Intent
缺 outline             → Planner
缺 briefs/page briefs  → Course Design

对每个未完成页面：
  缺 content           → Page Writer
  素材阶段未解析       → Assets
  缺 htmlOutput        → HTML Engineer
```

这是一种**确定性恢复选择**，不是 Supervisor：规则只检查已经验证的产物与页面阶段，顺序和后继关系仍写死在服务端 TypeScript 中。页面依赖未完成仍会 fail-fast；已完成页面不会重跑；失败页会从 checkpoint 中缺失的阶段继续。

节点名称描述的是运行边界，不改变 Specialist 数量：

- `course-design` 是对既有三 Agent 子流程的协调包装，不是一名新的模型 Specialist；
- `assets` 是 Image Prompt + cache + GenerateImage Skill/fallback 子流程，不是“素材 Agent”；
- `WorkflowNode` 与 `runSequentialWorkflow` 都是确定性协调基础设施。

## 产品 UI 落点与数据流

Day 22 没有新增 UI 落点。完整流向仍是：

```text
/chat composer
  → typed course task API client
  → POST /api/courses/tasks
  → CourseGenerationTaskService
  → runCourseGenerationWorkflow facade
  → fixed WorkflowNode[] + runSequentialWorkflow
  → existing Agents / subworkflows
  → centralized merge + CourseGenerationStateSchema
  → CourseStore checkpoint + task EventBus
  → GET /api/courses/tasks/[taskId]/events
  → useSSETask
  → courseGenerationToKeyaRun / ChatApp controller
  → chat Timeline + right learning workspace
```

边界保持不变：

- API Client 仍负责 HTTP/SSE 到共享类型化任务状态的转换；
- Task Controller 仍拥有课程、页面与运行状态；
- 展示组件不直接调用业务 API，也不消费节点或框架原生事件；
- Timeline 只显示结构化公开摘要、阶段、页面、Agent、错误和恢复；
- System Prompt、模型原始消息、私有 event data 和 chain-of-thought 不进入 checkpoint 或 UI；
- Route Handler 与服务端 workflow 继续是业务规则事实来源。

因此 Day 22 不需要修改 [`use-sse-task.ts`](../src/features/course-planner/hooks/use-sse-task.ts)、[`ChatApp`](../src/features/keya/chat-app.tsx) 或 Keya 产品路由。

## Checkpoint、取消与恢复为何不变

兼容 facade 仍拥有课程级运行语义：

- 新任务初始化或恢复输入先通过 `CourseGenerationStateSchema`；
- 长耗时节点开始前仍先保存 `agent_start`；
- 节点产物通过集中 merge 和声明输出检查后，才追加完成事件并保存 checkpoint；
- 页面失败仍保留之前已完成页面和当前页已接受的 DSL/素材；
- AbortSignal 仍由任务服务传入，取消映射为既有 `cancelled` 状态；
- 完成、失败与取消仍通过原任务记录和 SSE terminal 交付；
- 恢复仍依据服务端持久化产物，不依据 Timeline 文案或浏览器推测。

`runCourseGenerationWorkflow` 的函数签名和返回值保留，是避免一次重构同时影响 Route、Task Service、存储和前端的关键。先稳定内部节点合同，再考虑未来调度层，能把回归面限制在服务端编排模块。

## 明确未实现

Day 22 完成后仍然**没有**：

- Supervisor Agent 或状态驱动的动态 next-node 决策；
- 条件边、自动节点重试、循环或全局预算；
- Repair Agent 或自动 `QA → Repair → re-QA`；
- 自动 Page QA 交付门槛；QA 仍是用户显式触发的 report-only 旁路；
- 独立 Page Worker 状态/进程、页面隔离或受控并发；
- LangGraph StateGraph、Reducer、框架 checkpoint 或原生 streaming；
- 分布式队列、跨实例 EventBus 或 durable lease。

显式 `WorkflowNode` 是这些能力未来可以复用的工程接口，但不能当作这些能力已经交付的证据。

## 验证关注点

通用运行器的单元测试位于 [`sequential-workflow.test.ts`](../tests/unit/server/workflows/sequential-workflow.test.ts)，需要覆盖：

- 按声明顺序执行，前序 merge 对后序可见；
- 不修改调用方传入的原始状态；
- 缺少 `requiredInputs` 时不执行节点；
- 合并后缺少声明产物时失败；
- patch 包含未声明字段时失败；
- 节点异常携带 `nodeName`，并停止全部后继节点。

兼容语义由 [`course-generation-workflow.test.ts`](../tests/unit/server/workflows/course-generation-workflow.test.ts) 继续保护：串行多页生成、稳定 checkpoint、失败页短路、已有 HTML 保留、真实素材传给 HTML、从失败阶段恢复、取消持久化。由于 API/SSE/UI 合同未改，本日无需为了展示节点重构而新增页面或组件。

## 面试题与参考答案

### 1. 为什么把大函数拆成 `WorkflowNode[]`，却仍不能称为 Supervisor 多 Agent？

**核心结论：** 节点化解决的是静态编排的显式合同与复用；Supervisor 解决的是根据已校验状态动态选择下一动作。是否有多个函数或多个 Agent 名称，不等于是否有动态调度。

**原理或设计原因：** 当前 `runSequentialWorkflow` 只遍历调用方给定的数组，没有条件边、路由决策 Schema、attempt budget、循环或人工升级。它的可预测性来自“顺序在执行前已经确定”。Supervisor 则必须从有限动作集合中选择、被规则校验，并能说明停止或重试原因。

**在 ai-course-generator 中的实际落地：** facade 根据 checkpoint 按固定顺序选用 Intent、Planner、Course Design 和逐页 Writer/Assets/HTML 节点。它可以跳过已有产物，但不能因为某个语义质量结论选择不同 Specialist。QA 也没有自动进入主链。

**主要权衡或常见追问：** 静态节点可测试、成本低、恢复容易，但不适合动态修复。常见追问是“检查字段来跳过节点是否也是路由？”它是确定性恢复规则，不是拥有有限决策合同的 Supervisor；两者可以共享节点接口，但责任不同。

### 2. `requiredInputs` 和 TypeScript 参数类型有什么不同，为什么两者都需要？

**核心结论：** TypeScript 只在编译期约束代码形状；`requiredInputs` 在运行时验证持久化/恢复状态是否真的具备当前节点需要的值，并提供可定位的节点错误。

**原理或设计原因：** `CourseGenerationState` 中很多阶段产物是可选字段，因为同一个 Schema 要表达从 intent 到 completed 的整个生命周期。恢复 checkpoint、旧数据或错误合并都可能让编译期允许的对象在运行时缺字段。显式前置条件让节点在调用模型前 fail-fast。

**在 ai-course-generator 中的实际落地：** Planner 要求 `intent`；Course Design 要求 `intent + outline`；页面 HTML 节点要求目标页 content、已解析素材阶段和 visual brief。缺失时运行器返回 `WORKFLOW_NODE_INPUT_MISSING` 和对应 `nodeName`，不会浪费一次模型调用。

**主要权衡或常见追问：** 声明会增加少量重复，但换来运行时可观测性和独立节点测试。常见追问是“为什么不只在 `run` 里 throw？”因为分散检查会产生不同错误格式，也无法在通用运行层统一证明 handoff 合同。

### 3. `produces` 为什么既要做 patch 白名单，又要检查合并后的 selector？

**核心结论：** 白名单回答“节点被允许写什么”，selector 回答“节点承诺的结果是否真的出现”；两者解决不同问题。

**原理或设计原因：** 只做白名单时，节点可以合法返回 `{ pages: oldPages }`，却没有生成目标页 HTML；只检查产物时，节点可能顺便覆盖未授权的 `outline` 或 `events`。执行器先拒绝越权 key，再集中 merge，最后验证实际产物。

**在 ai-course-generator 中的实际落地：** HTML 节点只声明修改 `pages`，selector 还必须选到目标页 `htmlOutput` 和 `completed` 状态。全局节点则分别声明 `intent`、`outline`、briefs/page briefs/pages 等产物。合并后的整课状态还必须通过 Zod Schema。

**主要权衡或常见追问：** 当前白名单粒度是顶层字段，`pages` 内部仍依靠领域节点、selector、Schema 和测试保护。若未来执行不可信第三方节点，需要更细的 patch schema/reducer；对当前内部固定节点，深层权限系统会过度设计。

### 4. 为什么状态 merge 必须集中在运行层，而不是让每个节点直接返回完整新状态？

**核心结论：** 集中 merge 建立单一状态接受边界，统一验证、不变式和未来迁移语义；节点只负责自己拥有的产物。

**原理或设计原因：** 如果每个节点都复制并修改完整状态，就可能覆盖并发/恢复信息、漏掉 Schema 复验或以不同方式追加事件。集中 merge 使“候选 patch → 完整状态验证 → 接受”成为固定协议，也便于以后把执行器换成图运行时而不改变领域合同。

**在 ai-course-generator 中的实际落地：** `runSequentialWorkflow` 调用 facade 提供的 merge；merge 使用 `CourseGenerationStateSchema.parse({ ...current, ...patch })`。节点不获得 `CourseStore.save`，成功后的公开事件与 checkpoint 由生命周期钩子统一处理。

**主要权衡或常见追问：** 单一 merge 简单可靠，但未来并发页面需要冲突可交换的 reducer，而不是简单顶层覆盖。Day 22 保持串行，所以先使用最小正确实现；并发应在 Page Worker 隔离和 reducer 规则明确后再引入。

### 5. `WorkflowNodeError.nodeName` 如何改善错误处理，又为什么不能直接把原始异常发给前端？

**核心结论：** `nodeName` 提供稳定的服务端归因键；公开错误仍必须经过课程错误合同映射，不能泄露模型、Provider 或内部运行细节。

**原理或设计原因：** 通用执行器知道哪个节点失败，但不知道产品阶段、pageId 和 Agent 展示名称。课程 facade 可以用 `nodeName` 找回领域节点元数据，再构造已有 `stage/pageId/code/message`。未知异常被包装为安全消息，避免 stack、Prompt 或私有 payload 进入 checkpoint/SSE。

**在 ai-course-generator 中的实际落地：** `CourseGenerationNodeError` 扩展通用错误，可携带已经投影过的安全事件；`failNodeWorkflow` 用失败节点映射课程错误并保存 checkpoint。Timeline 继续显示精确 Agent/页面/错误码，而不用理解内部节点类。

**主要权衡或常见追问：** 安全包装会牺牲客户端调试细节，因此详细 stack 应留在服务端日志并通过 traceId 关联。常见追问是“nodeName 是否应直接成为 UI 状态？”不应；UI 消费共享公开协议，避免绑定某个运行器实现。

### 6. 如何在重构内部工作流时保证 checkpoint 与恢复语义不回归？

**核心结论：** 保持 facade、共享状态和 checkpoint 边界不变，并用原有端到端工作流测试验证“哪些产物已经接受、恢复时跳过什么”，而不是只测试节点能运行。

**原理或设计原因：** 恢复能力依赖持久化领域产物与接受顺序。若节点在校验前 checkpoint，或恢复仅按 Timeline 文案判断，就可能跳过无效产物；若改了入口合同，则 Task Service、SSE 和 UI 都会被迫同步迁移。

**在 ai-course-generator 中的实际落地：** facade 仍校验 existing state，节点开始前保存 `agent_start`，节点 patch 经白名单、集中 merge、完整 Schema 和声明产物检查后才保存完成 checkpoint。facade 按缺失 intent/outline/brief/content/assets/html 选择节点，已完成页面保持不变。

**主要权衡或常见追问：** `agent_start` checkpoint 可能表示进程在模型调用中退出，恢复后该节点会重新执行，这是有意的 at-least-once 语义；真正副作用要靠素材缓存/幂等键吸收。追问“是否 exactly-once？”当前不是，且单进程任务基础设施也不承诺分布式 exactly-once。

## 当天复盘问题

1. 如果新增一个“术语一致性检查”能力，它应该是确定性 Validator、report-only Agent 节点，还是 Supervisor 决策？你会用什么证据判断？
2. 当前 `produces` 只限制顶层 key。对内部可信节点足够的依据是什么，什么场景会迫使你引入深层 patch schema？
3. 哪些恢复分支属于确定性规则，哪些状态出现后才真正值得引入 Supervisor？
4. 如果未来允许两个无依赖页面并发，集中 merge、页面事件 sequence 和 checkpoint 原子性分别需要怎样改变？
5. 为什么 Day 22 不新增 Timeline 行或节点调试面板？如果要为排障增加信息，应优先扩展哪个服务端公开协议字段？
