# Day 19：SSE 事件协议与实时 Agent Timeline 数据层

## 今日产出

- 新增严格的 `CourseTaskRecordSchema`、`CourseTaskCreateResponseSchema` 和 `CourseTaskStreamMessageSchema`，统一约束任务记录、创建响应以及 `snapshot`、`event`、`terminal` 三类流消息。
- 扩展现有课程公开事件，加入 `agent_start`、`agent_done` 和 `page_done`。工作流在长耗时 Agent 调用前先保存开始事件，完成后再保存完成事件，浏览器因此能在整课结束前看到真实阶段变化。
- 新增进程内 `CourseTaskEventBus`。工作流检查点成功写入后才同步发布消息，订阅者只能收到通过共享 Schema 校验的公开数据。
- 新增 `.data/course-tasks/{taskId}/task.json` 任务存储，持久化 `taskId` 与 `courseId`、`traceId`、任务状态的关系；课程产物仍由 `.data/courses/{courseId}/course.json` 保存。
- 新增 `POST /api/courses/tasks` 创建后台课程任务、`GET /api/courses/tasks/[taskId]/events` 订阅 SSE、`DELETE /api/courses/tasks/[taskId]` 显式取消任务。
- SSE 支持初次快照、`id` 游标、`Last-Event-ID` 增量重放、15 秒心跳、连接清理和终态主动关闭。
- 新增类型化 API Client 与 `useSSETask`。原生 `MessageEvent` 在 Hook 边界完成 JSON 解析、Zod 校验、顺序检查和去重，不进入展示组件。
- Keya `/chat` 继续使用现有 Composer、Agent Timeline 和右侧 learning workspace；Day 19 只替换整课生成的传输与增量状态更新，没有新增页面、平行控制台或第二套视觉系统。

## 真实数据流

```text
/chat composer
  -> typed course-task API client
  -> POST /api/courses/tasks
  -> 202 { taskId, courseId, traceId, status: "queued" }
  -> CourseGenerationTaskService
       -> CourseGenerationWorkflow
       -> checkpoint CourseGenerationState
       -> CourseStore atomic save
       -> CourseTaskEventBus publish
  -> GET /api/courses/tasks/{taskId}/events
  -> snapshot / event / terminal SSE frames
  -> useSSETask parse + validate + deduplicate
  -> Keya Task Controller adapter
  -> existing chat Timeline + right learning workspace
```

课程规划、页面顺序、失败短路和恢复仍由 Day 18 的服务端 Workflow 决定。SSE Route Handler 不复制业务规则，Hook 也不会根据零散事件重新规划课程；它只把已经验证并持久化的状态增量交给 Controller。

## 严格公开事件协议

课程公开事件继续以 `CourseGenerationPublicEventSchema` 为唯一事实来源。事件包含：

- `id`、单调连续的 `sequence`、`traceId` 和 `timestamp`；
- `type`、`stage`、`step` 和面向用户的 `summary`；
- 可选的 `pageId` 与 `agent`。

Day 19 增加的边界事件有：

- `agent_start`：长耗时 Agent 调用前已经进入该阶段；
- `agent_done`：Agent 结果已经校验并进入课程状态；
- `page_done`：当前页的 DSL、素材结果和 HTML 已通过完整页面检查点，可以预览。

SSE 外层是 strict 判别联合：

1. `snapshot` 携带完整、已校验的 `CourseGenerationState`；
2. `event` 只携带一个严格公开事件；
3. `terminal` 携带 completed、failed 或 cancelled 终态及最终检查点。

协议故意没有任意 `payload` 或 `data` 字段。未知字段会被 Zod 拒绝，因此内部 Agent event data、系统 Prompt、模型原始 chunk、工具私有上下文和 chain-of-thought 没有结构化通道可以流向浏览器。`summary` 仍必须由服务端编写为公开摘要；strict Schema 不能替代摘要内容的安全审查。

## EventBus、任务记录与课程检查点

任务服务区分两类持久化事实：

- `course.json` 保存可恢复的课程业务状态和全部公开事件；
- `task.json` 保存一次运行的 `taskId`、对应 `courseId`、`traceId`、输入、状态和错误摘要。

任务 ID 和课程 ID 都通过受控 Schema 校验，不能包含绝对路径或 `..`。任务记录写入时先创建同目录临时文件，再原子 rename；读写两端都重新执行 Schema 校验，同一 store 实例还用写队列保持覆盖顺序。

EventBus 只负责当前 Node.js 进程里的实时通知。它按 `taskId` 隔离订阅者，发布前校验完整流消息，并用同步发布保持同一任务的发送顺序。EventBus 不承担持久化日志；断线重放由 `CourseGenerationState.events` 完成，避免内存状态成为第二个事实来源。

关键顺序是：

```text
更新 CourseGenerationState
  -> 保存并校验 course checkpoint
  -> 发布 snapshot/event
  -> SSE 写入浏览器
```

如果 checkpoint 写入失败，对应进度不会提前显示为已经完成。这个顺序让刷新后的持久化结果与用户刚刚看到的 Timeline 保持一致。

## POST、SSE 与 DELETE 的职责

### 创建任务

`POST /api/courses/tasks` 接收新课程的 `userPrompt`，或接收已有 `courseId` 继续 Day 18 检查点。Route Handler 只负责校验和创建任务记录，返回 HTTP 202 后使用 Next.js `after()` 启动任务；运行仍受部署平台和当前 `maxDuration` 限制。

### 订阅进度

`GET /api/courses/tasks/[taskId]/events` 返回 `text/event-stream`，并设置禁止缓存和代理缓冲的响应头。Route 在读取持久化状态之前先订阅 EventBus，把这一小段竞态窗口内产生的消息暂存，完成快照或重放后再按序发送缓冲消息。

每个业务消息使用命名事件：

```text
id: 12
event: event
data: {"type":"event","taskId":"task-...","courseId":"course-...","event":{...}}
```

15 秒一次的 `: ping` 是 SSE comment，只用于保持连接，不进入 Timeline。任务到达终态时 Route 发送一次 `terminal` 并关闭流；浏览器卸载或网络断开则只释放当前订阅和心跳。

### 取消任务

`DELETE /api/courses/tasks/[taskId]` 表达用户主动取消意图，由任务服务持有的 `AbortController` 中止 Workflow。关闭 EventSource、切换会话、刷新页面或暂时断网都不等于取消后台任务，否则一次普通的连接波动就会破坏可恢复生成。

DELETE 会先把课程检查点和任务记录持久化为 cancelled，再发布 `terminal`，同时中止当前进程持有的 Workflow。若任务运行在另一实例，后续 checkpoint 会读取已持久化的 cancelled 任务记录并停止继续覆盖。前端仍以经过 Schema 校验的 `terminal` 为展示终态，而不是仅凭 HTTP 响应在本地伪造状态。

## Last-Event-ID、快照与重放

公开事件的 `sequence` 同时用作 SSE `id`。浏览器正常重连时会自动携带最后已接收的事件 ID；命令行验收也可以手动设置 `Last-Event-ID`。

- 首次订阅且没有游标：读取 `course.json` 并发送完整 `snapshot`，之后接实时事件。
- 重连且有游标：从持久化 `events[]` 中只发送当前任务 trace 下 `sequence > Last-Event-ID` 的事件，再接实时 EventBus。
- 已完成任务重新订阅：先恢复快照或缺失事件，再发送与任务记录一致的 `terminal`，随后关闭连接。

Route 在“订阅 EventBus”与“加载磁盘检查点”之间使用缓冲区，客户端再按 sequence 去重，所以重放和实时切换即使有重叠也不会产生重复 Timeline 行。这里提供的是至少一次传输加幂等归并，不声称跨网络、跨进程的端到端 exactly-once。

## `useSSETask` 与客户端状态边界

`useSSETask` 位于 Course Planner feature 的 Controller 数据层，负责：

- 创建和销毁原生 EventSource；
- 监听 `snapshot`、`event`、`terminal` 命名事件；
- JSON 解析和共享 Schema 校验；
- 校验 `taskId`、`courseId` 与连续 `sequence`；
- 丢弃重连后重复的 sequence；
- 将网络连接状态与任务业务状态分开；
- 对浏览器可恢复的网络错误保留 EventSource 自动重连，对协议错误立即关闭；
- 在终态或组件清理时主动关闭连接。

增量事件必须建立在 snapshot 上。若先收到 event、sequence 出现缺口、消息引用了其他任务/课程，或数据无法合并为合法 `CourseGenerationState`，Hook 会把它当作协议错误，而不是用不完整状态继续渲染。

类型化 API Client 只负责 POST 和 DELETE 的 HTTP/JSON 边界；`useSSETask` 负责 SSE 边界；`ChatApp` Controller 把最新课程状态交给既有 `courseGenerationToKeyaRun` adapter。`CourseRunTimeline` 和 learning workspace 不直接调用业务 API，也不读取原生 EventSource。

## Keya 产品边界

Day 19 没有重新设计产品界面：

- `/chat` composer 创建任务并提供已有取消操作；
- `/chat` thread 的现有 Agent Timeline 随 snapshot/event 增量更新公开摘要；
- `/chat` 右侧 learning workspace 在检查点到达后更新课程规划、页面、素材和 HTML 预览；
- `/`、`/course`、`/templates` 不新增 Day 19 产品表面；
- Day 18 的 `POST /api/courses/generate` 可以保留为批量兼容入口，但 Keya 整课 Controller 使用任务 API 与 SSE；
- 没有把旧 `AiPlayground` 或 course-planner 面板挂回产品路由。

Adapter 现在同时参考持久化阶段与 `agent_start`、`agent_done`、`page_done`，因此未完成的 Planner、Design、Page Writer、Assets 和 HTML 会显示 running，而不是等待最终批量响应后一次性变绿。

## 单进程 MVP 限制

当前 EventBus、活动任务 Map 和 AbortController 都保存在单个 Node.js 进程内，适合 Day 19 本地 MVP，但不是多实例生产调度器：

- 请求若被负载均衡到另一实例，内存订阅者收不到原实例发布的实时消息；
- 进程重启后课程和任务 JSON 仍在，但运行中的函数与 AbortController 已丢失；
- 多实例同时覆盖本地 JSON，单实例写队列不能提供分布式并发控制；
- `after()` 仍受平台函数存活时间约束，不能替代耐久任务队列。

生产扩展应把任务调度和事件发布迁移到持久队列、数据库与 Redis/NATS 等 Pub/Sub，并为 worker 建立租约、幂等键和重试策略。共享 Schema、checkpoint 和客户端 reducer 可以继续复用；Day 19 不提前实现这些基础设施。

## 自动化与真实模型验收

自动化测试应覆盖：

- 公开事件和三类流消息的合法样例，以及对未知字段、私有 `data`、Prompt、API Key、reasoning 的拒绝；
- 任务 ID 路径安全、任务记录原子保存、损坏 JSON、任务 ID 错配和写入顺序；
- EventBus 的任务隔离、同步顺序、重复退订和订阅者异常边界；
- SSE 编码中的 `id`、命名 `event`、JSON `data`、空行结尾和 `Last-Event-ID` 校验；
- POST 返回 202、GET 初始快照/增量重放/实时消息/终态、DELETE 取消与 404；
- Workflow 在 Agent 前产生 `agent_start`，完成后产生 `agent_done`，完成页面产生 `page_done`；
- Hook 的 snapshot 前置、连续序号、重放去重、协议错误、网络重连、终态关闭和清理；
- Adapter 把实时阶段投影成现有 Timeline 的 running/completed/failed 状态；
- `pnpm test`、`pnpm lint` 和 `pnpm build`。

自动化不能证明真实模型耗时下的首事件时机、长连接经过本地代理是否被缓冲、页面内容质量或真实取消响应速度。真实模型验收应使用一门低成本三页课程，分别记录：

1. POST 在课程完成前返回 taskId；
2. Intent、Planner、Design 和逐页事件在生成期间持续到达；
3. 中途断网或刷新后能够从持久化游标恢复，且 Timeline 没有重复行；
4. 主动取消后产生 cancelled 检查点和 terminal，普通断线不会取消；
5. 完成后重新订阅能读取最终状态，素材与 HTML 仍可在 learning workspace 预览；
6. 浏览器网络响应和页面文本中没有系统 Prompt、密钥、私有 event data 或隐藏推理。

## 面试题与参考答案

### 1. 为什么这个场景选择 SSE，而不是 WebSocket？

核心结论：整课生成的主要通信方向是服务端向浏览器持续推送状态，SSE 的单向 HTTP 模型足够，协议和运维成本也更低。

在 ai-course-generator 中，POST 创建任务，EventSource 订阅进度，偶发的用户取消通过 DELETE 完成，不需要在一条双向长连接中持续发控制帧。SSE 还原生支持事件 ID、自动重连和 UTF-8 文本事件，正好匹配结构化 Timeline。

主要权衡是 SSE 不适合高频双向协作或二进制数据，并且浏览器对同源连接数、代理缓冲和平台超时有约束。如果未来加入多人实时编辑、连续控制 Agent 或高频双向消息，再评估 WebSocket；不要因为“实时”两个字就提前增加复杂度。

### 2. 为什么公开事件 Schema 不能直接复用模型或 AI SDK 的原生流 chunk？

核心结论：框架原生 chunk 是供应商和执行细节，不是稳定的产品协议，还可能携带 reasoning、工具参数或错误上下文。

本项目在服务端把 Agent 行为转换成 `CourseGenerationPublicEvent`，只暴露阶段、页面、Agent、公开摘要和顺序。前端因此不依赖某个模型 SDK，也不会在切换供应商时重做 Timeline。

代价是需要维护一次显式映射，而且公开摘要的诊断信息少于服务端日志。常见追问是“如何排障”：答案是用 traceId 关联权限受控的服务端日志，而不是放宽浏览器事件协议。

### 3. 为什么必须先保存 checkpoint，再 publish EventBus？

核心结论：持久化状态是事实来源，实时消息只是对事实变化的通知。先发布会让用户看到一个刷新后不存在的完成状态。

ai-course-generator 的 task service 在 checkpoint callback 中先调用 CourseStore.save，再发布 snapshot/event。这样 SSE 断开后可以从同一个 `course.json` 重放，Timeline 和恢复逻辑不会产生分叉。

权衡是磁盘写入延迟会增加事件延迟，但这比显示不可恢复的虚假进度安全。生产环境可用数据库事务或 outbox 模式优化一致性，不能简单把 publish 移到写入之前。

### 4. Last-Event-ID 如何避免漏事件和重复事件？

核心结论：服务端用持久化 sequence 重放游标之后的事件，客户端用同一 sequence 做幂等去重，并验证不允许出现缺口。

SSE 帧的 `id` 等于公开事件 sequence。重连时 Route 从 checkpoint 发送 `sequence > Last-Event-ID` 的当前 trace 事件；Route 的订阅前置缓冲覆盖“读磁盘期间的新事件”；Hook 丢弃不大于当前 sequence 的重复消息。

这仍然是至少一次语义，而不是 exactly-once。多实例场景还需要共享事件日志或 Pub/Sub；仅靠浏览器 Last-Event-ID 无法恢复另一个实例内存中尚未持久化的消息。

### 5. 为什么 EventSource 断开不能等价于取消任务？

核心结论：连接生命周期和业务任务生命周期是两个不同状态机。刷新、切换页面、移动网络抖动都可能关闭连接，但用户并没有要求丢弃生成工作。

本项目中 GET SSE 断开只退订 EventBus 并清理心跳，只有 DELETE 才进入显式取消路径。任务服务先保存 cancelled 课程检查点和任务终态，再中止本进程的 Workflow；其他执行者也会在下一次 checkpoint 观察该终态并停止，保证刷新后仍能读取一致结果。

权衡是无人订阅时任务仍可能消耗模型成本。因此产品可在未来增加明确的超时或后台任务管理策略，但不能用不可靠的网络断开代替用户授权的取消操作。

### 6. 为什么需要同时保存 task record 和 course state？

核心结论：课程状态描述可恢复业务产物，任务记录描述某一次执行的生命周期与路由标识，两者职责不同。

一个 `courseId` 可以在失败后创建新的 `taskId` 和 `traceId` 继续运行。`course.json` 保留跨尝试的页面与公开事件；`task.json` 让 SSE Route 找到对应课程并判断本次任务是 queued、running 还是终态。

权衡是跨文件一致性需要明确写入顺序。生产数据库中可使用事务和外键；Day 19 的本地 MVP 用严格 Schema、先课程后事件、任务终态记录来保持可解释性。

### 7. `useSSETask` 为什么要区分 connectionStatus 和 taskStatus？

核心结论：网络连接暂时失败不代表后台任务失败，把二者合并会向用户报告错误状态并破坏自动重连。

Hook 可以处于 reconnecting，同时最新课程仍是 running；只有经过验证的 terminal 才把业务任务置为 completed、failed 或 cancelled。协议错误会关闭连接，因为继续归并可能污染状态；普通 EventSource error 则等待浏览器重连。

常见追问是“UI 应展示什么”：Timeline 保留最后合法状态，并提示连接正在恢复；不要把所有阶段改成 failed，也不要凭本地计时器假装任务已经完成。

### 8. 当前进程内 EventBus 上生产会遇到什么问题，如何演进？

核心结论：它不能跨实例广播、不能在进程重启后恢复订阅，也不能提供耐久任务执行保证。

当前实现适合验证协议、SSE 路由和 Keya 数据边界。生产演进时应将 task record 放入数据库，将工作提交到持久队列，并把公开事件通过 outbox 加 Pub/Sub 分发；worker 使用幂等 taskId、租约和 checkpoint 防止重复执行。

共享的 Zod 协议、CourseGenerationState、SSE 编码和前端 reducer 仍可保留。权衡是外部基础设施增加运维和一致性复杂度，因此应在确有多实例与耐久执行需求时引入，而不是在 Day 19 提前搭建。

## 当天结束复盘

1. 当前公开事件中的哪些字段是恢复事实，哪些只是便于展示的观测信息？
2. SSE Route 为什么要先订阅 EventBus，再读取持久化快照？
3. 如果客户端收到 sequence 12 后直接收到 14，应选择忽略、继续还是关闭连接？为什么？
4. 用户刷新 `/chat` 后，哪些状态来自磁盘，哪些状态只能由当前浏览器重新建立？
5. 把单进程 EventBus 替换成 Redis Pub/Sub 时，哪些共享 Schema 与 UI 代码应该完全不用修改？
