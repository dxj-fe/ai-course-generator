# 从一句话到多页 HTML：agent-v2 真实代码链

> 这份文档用于按源码排查“为什么效果不好、为什么报错、应该从哪里重构”。
> 新任务不经过 LangGraph，也没有一个每步都转发消息的假 Supervisor。

## 1. 一眼看完

```text
一句话 + 可选资料
→ CourseCreationBrief
→ agent-v2 Task
→ CourseRun + Architect WorkOrder
→ Curriculum Architect 提交完整 CourseArchitecture
→ Architecture Gate
→ Course Director 语义验收
→ 原子创建 N 张 Page WorkOrder
→ 按 build 依赖分 wave，并行 Page Builder
→ 每页 Page Gate，通过后生成 PageSummary 并解锁后继页
→ 全部当前页面完成
→ 冻结 CourseManifest
→ Course Reviewer 审整课
→ Course Director：发布 / 局部返工 / 重新规划
→ Final Gate
→ CourseStateProjector
→ 现有 SQLite checkpoint + SSE + Keya UI
```

## 2. 阶段一：整理 Brief

主要文件：

- `src/features/keya/course-creation-model.ts`
- `src/features/keya/chat-app.tsx`
- `src/shared/course-schema/course-creation-brief.ts`

`CourseCreationBrief` 保存原始需求、主题、受众、学习目标、语言、学习方式和可选页数。参考资料单独保存为 `ReferencePack[]`，不会混成一段无法追溯的 Prompt。

成功标准：

- 学习目标能被后续架构转成可观察证据；
- 用户明确指定的页数、语言和受众没有丢失；
- 资料解析失败时不会假装已经引用；
- 后端收到结构化 `creationBrief`。

常见问题：

- 目标只有“了解一下”，没有完成后能做什么；
- 前端 Brief 和共享 Schema 漂移；
- 把编译后的长 Prompt 当事实源，原字段发生冲突；
- 资料摘要成功，但原 chunk 引用丢失。

## 3. 阶段二：创建 agent-v2 任务

主要文件：

- `src/app/api/courses/tasks/route.ts`
- `src/server/course/task/service.ts`
- `src/shared/course-schema/course-task-event.ts`

新任务固定：

```ts
source: "agent-v2"
```

并要求携带 `creationBrief`。Route 写入 queued 任务并唤醒后台；Task Service 调用 `runCourseGenerationAgentV2()`，把引擎 checkpoint 投影回现有 `CourseGenerationState`。

这里要分清两种存储：

- CourseTask / CourseStore：现有产品任务和前端 checkpoint；
- CourseRun Repository：agent-v2 的真实执行状态。

Task Service 是两者之间的桥，负责 checkpoint、任务终态和当前进程通知；SSE Route
还会通过 `CoursePublicEventReader` 直接追读 `course_run_events`，补齐其他进程的
durable 事件。
`course_execution_claims` 则是同一 `courseId` 的数据库唯一执行权：两个 Web/Worker
进程并发创建任务时，只有一个能在同一事务中写入 claim 和 TaskRecord。
`course_task_control_intents` 保存跨进程 cancel intent：意图一旦落库，resume 和旧
runner 的普通写入都被围栏拒绝；若控制进程中途退出，恢复 worker 会继续收口取消。

失败点：

- agent-v2 任务缺 Brief；
- 同一 courseId 已有活动任务；
- 历史 source 被错误地送进新执行器；
- 后台唤醒后进程退出，但没有耐久 worker 扫描恢复。

## 4. 阶段三：建立 CourseRun

主要文件：

- `src/server/course/run/engine.ts`
- `src/server/course/store/repository.ts`
- `src/server/course/store/run.ts`
- `src/server/course/store/work-order.ts`

引擎启动时：

1. 按 taskId 查已有 CourseRun；
2. 新建或接管 trace；
3. 原子 bootstrap CourseRun 和 `architect_course` WorkOrder；
4. 领取 CourseRun lease；
5. 发布第一个投影 checkpoint。

`CourseRun` 是根聚合，`WorkOrder` 是可领取的任务。二者分开，是因为一个课程会同时有多张页面工作单。

失败点：

- 两个 worker 同时持有有效 lease；
- trace 已变化，旧 worker 仍继续写；
- lockVersion 被绕过；
- running WorkOrder 的 lease 过期后没有恢复；
- 内存 AbortController 停了，但数据库执行权没有切断。

恢复标准：

- 新 worker 只能领取过期 lease；
- 已 submitted / accepted 的工作单不重跑；
- Repository 事务、WorkOrder 幂等键和具体工具缓存避免大部分重复业务写入；
- ToolOperation 只提供输入哈希、状态和 ArtifactRef 审计，不会自动重放工具结果；
- 每次状态迁移后都能从 Repository 重建 UI checkpoint。
- 所有普通 Repository 事务都在同一 `BEGIN IMMEDIATE` 内核对当前 TaskRecord 的
  task/course/trace/status=running，并确认没有 cancel intent；控制命令走显式例外
  路径。
- Task Service 写 CourseStore 时必须带旧 payload CAS，并在同一条 SQL 中校验当前
  TaskRecord 的 trace/status；pause/cancel 后旧 runner 的 checkpoint 写入必须失败。
- cancel 必须先原子登记 durable intent；resume 的 paused → queued CAS 同时检查
  intent 以及 CourseRun/CourseStore 终态，不能留下 `CourseRun cancelled + Task queued`。
- CourseStore 的旧 trace 终态不能阻塞或污染同 courseId 的新 attempt；当前 taskId
  已有终态 CourseRun 时，通过只读投影和独立 `reconcile()` 对齐
  CourseStore/TaskRecord。
- pause 提交后重查 CourseRun；恢复扫描也会处理 paused + terminal Run，并优先收口
  cancel intent，不能把这两类控制任务长期饿死或永久跳过。

Next 启动时只做一次恢复扫描。要持续接管 queued/running 任务，部署环境必须运行 `npm run worker:course`，或提供等价的外部定时调度。

## 5. 阶段四：Curriculum Architect

主要文件：

- `src/server/agent/plugins/agents/course/architect-handler.ts`
- `src/server/course/gate/architecture.ts`
- `src/shared/course-schema/course-architecture.ts`

Architect 的唯一目标是交一份完整 `CourseArchitecture`：

```text
CoursePack
  facts / terms / examples / constraints

CourseBlueprint
  title / audience / objectives / courseRules

PageTask[]
  每页 purpose / objectiveIds / teachingPoints / interaction
  assetNeeds / templates / acceptance / buildDependsOnPageIds
```

它可以按需搜索参考资料和模板，并调用验证工具；最终必须调用提交工具。普通文字回答不算交付。

Architecture Gate 检查：

- courseId、pageId、order；
- 学习目标覆盖；
- 资料引用；
- 模板和互动约束；
- build 依赖存在且无环；
- 页面验收条件。

效果不好的第一排查点：

- `objectives` 是否可观察；
- 每个 `PageTask.purpose` 是否真的不同；
- `teachingPoints` 是否只是同一句话换说法；
- 讲解页与练习页是否成对；
- 互动是否服务目标；
- 素材和模板是否适合页面职责；
- build 依赖是否必要。

如果这里错，后面 Page Builder 再聪明也只能把错误架构做得更漂亮。

## 6. 阶段五：Director 验收和原子派工

主要文件：

- `src/server/agent/plugins/agents/course/director-handler.ts`
- `src/server/agent/plugins/tools/course/director.ts`
- `src/server/course/run/director-round-commit.ts`
- `src/server/course/run/commands.ts`

Architect 提交后，引擎创建 `director_round`。Director 先读 `RunSummary`，再检查完整架构，最终只能：

- `accept_architecture_and_dispatch_pages`
- `request_architecture_revision`

架构合法时 Director 不能主动 `fail_course`。语义退回在整个任务内最多 2 次；第三次
调用 `request_architecture_revision` 会先得到机器产生的
`ARCHITECTURE_REVISION_BUDGET_EXHAUSTED`，只有这时同一回合才开放失败动作。
模型自报“不可恢复”或自造错误码不会获得失败权限。

接受时同一事务完成：

1. Architect WorkOrder accepted；
2. `CourseRun.activeArchitecture` 切到当前 Artifact；
3. 创建恰好 N 张 `build_page` WorkOrder；
4. 无依赖页 queued；
5. 有依赖页 waiting_dependencies；
6. Director round accepted；
7. CourseRun 进入 building。

为什么必须原子：

- 不能接受了架构却漏创建页面；
- 不能页面已经开始跑，activeArchitecture 还没切换；
- 不能一次重试重复创建第二套页面工作单。

## 7. 阶段六：按依赖 wave 并行 Page Builder

主要文件：

- `src/server/course/run/engine.ts`
- `src/server/agent/plugins/agents/course/page-builder-handler.ts`
- `src/server/agent/plugins/contexts/course/page-builder.ts`
- `src/server/agent/plugins/tools/course/page-builder.ts`
- `src/server/agent/plugins/tools/course/page-builder-model-steps.ts`

### 7.1 调度规则

引擎只选择当前架构下，状态为 queued/running 的页面工作单。每轮最多取 `concurrency` 张，通过 Promise Pool 并行。

`order` 与 `buildDependsOnPageIds` 分开：

- order 决定学习时第几页；
- build 依赖决定生成时必须先读哪页结果。

不要为了“顺序连贯”把所有页面串成链。只有后页内容真的依赖前页生成结果时才加 build 依赖。

### 7.2 Page Builder 输入

输入必须已封口：

- 当前架构 Artifact；
- 当前 PageTask；
- Brief 和被授权的 ReferencePack；
- 依赖页面的 `PageSummary`；
- fix_page 时的旧页面 Artifact、冻结的 CourseReview 和具体 issue。

页面级 Review issue 必须带机器字段 `targetArtifact`：

- `page_content`：课程内容、学习动作、事实或互动本身要改；
- `page_html`：内容仍成立，只修渲染、布局或 HTML 行为。

系统不从 `suggestedAction` 等自然语言里猜修哪里。一个页面同时有内容和 HTML
问题时，优先从 `page_content` 开始；只要内容变化，后续素材、HTML 和质量都要按新
版本重建。

它不应该读取：

- 其他无关页面完整 HTML；
- 会在执行中变化的 currentPages；
- 其他 Agent 的私有推理；
- 未被 WorkOrder 授权的工具或 Artifact。

### 7.3 Page Builder 工具循环

Page Builder 自主决定何时读取、生成和修订，但工具有限。实际产出仍分为：

1. `page_content`
2. `page_assets`
3. `page_html`
4. `page_quality`

工具内部复用现有 Page Writer、图片、HTML Engineer、QA 和 Repair 能力。这些是专业生成能力，不再分别冒充能够协作的顶层 Agent。

`block_page` 只在有证据的不可继续修复状态开放。当前 attempt 必须已经读取上下文，
并存在失败的 current `PageQuality`；随后还必须满足修复被明确拒绝、有效质量修订
预算耗尽，或确定性修复计划无法授权任何可行操作之一。普通 Provider、内容、素材、
HTML 工具失败不能直接 block。WorkOrder 声明的 ReferencePack/Chunk 缺失时，在创建
Page Builder execution 前抛出 `PAGE_REFERENCE_INPUT_INVALID`，不让模型替坏输入
找借口。

失败点：

- WorkOrder 输入没有封口；
- fix_page 没带旧产物或具体 issue；
- 模型只输出说明，没有调用 terminal 工具；
- allowedTools 配错导致越权或缺能力；
- Provider 失败后盲目重跑有副作用的工具；
- 页面上下文包含太多无关资料。

### 7.4 Fix WorkOrder 的新旧产物边界

旧页面是只读 `baseline`，不是新 WorkOrder 的 checkpoint：

- checkpoint 只接受由当前 Fix WorkOrder 创建、且 pageId 相同的 Artifact；
- `page_content` 返工必须先生成新的 content，再走素材、HTML、Quality；
- `page_html` 返工可复用 baseline content/assets，但旧 HTML 和旧 Quality 永远
  不能冒充当前结果；
- 因上游页面返工而进入依赖闭包的页面，没有直接 issue 也必须按
  `dependency_refresh → page_content` 重生内容；
- `submit_page` 前必须已经读取上下文、产生机器指定的目标 Artifact，并生成本次
  WorkOrder 的当前 `PageQuality`。

所以“创建了一张 fix 单”不等于“真的修了”。如果模型只重新提交旧版本，确定性工具
会拒绝交活。

## 8. 阶段七：Page Gate 和 PageSummary

主要文件：

- `src/server/course/gate/page.ts`
- `src/server/course/run/page-operations.ts`
- `src/shared/course-schema/page-summary.ts`

Page Gate 是确定性验收，不调用模型做自由决定。它检查：

- PageContentDSL 是否满足 PageTask；
- 素材槽是否齐全；
- HTML 是否通过安全、结构和标记校验；
- 互动、完成规则和反馈是否存在；
- QualityReport 是否没有具体 error；
- 需要的截图是否齐全且对应当前版本。

通过后，在一个事务里：

1. 接受页面 WorkOrder；
2. 保存 `PageSummary`；
3. 更新 `CourseRun.currentPages[pageId]`；
4. 清除该页 stale 标记；
5. 查找依赖已经全部满足的后继 WorkOrder；
6. 加入依赖 PageSummary、封口输入并 queued。

PageSummary 是 Agent 间的受控协作信息。它避免给后继页整个 HTML，也避免只传一句模糊的“上一页完成了”。

失败点：

- HTML 与截图不是同一版本；
- 旧 Artifact 混进当前提交；
- Gate 通过后 current 指针没原子更新；
- 解锁后继页时覆盖了它原有架构和 issue 输入；
- fix_page 把自身旧 summary 误当作依赖摘要。

## 9. 阶段八：冻结 CourseManifest

主要文件：

- `src/server/course/gate/review.ts`
- `src/shared/course-schema/course-manifest.ts`
- `src/server/course/run/commands.ts`

只有以下条件满足才创建 Review：

- activeArchitecture 存在；
- 架构里的每个 pageId 都有 current page；
- 没有 stale 页面；
- 当前页面 Artifact 指针完整；
- 没有仍需执行的当前分支页面工作单。

系统按顺序构造 `CourseManifest`，写入：

- 架构 ArtifactRef；
- 每页 content/assets/html/quality/summary ArtifactRef；
- sourceWorkOrderId；
- 版本 hash。

然后创建输入封口的 `review_course` WorkOrder。

manifest 解决的是：“Reviewer 说通过时，到底通过的是哪一版课程？”

## 10. 阶段九：Course Reviewer

主要文件：

- `src/server/agent/plugins/agents/course/reviewer-handler.ts`
- `src/server/agent/plugins/contexts/course/reviewer.ts`
- `src/server/agent/plugins/tools/course/reviewer.ts`
- `src/shared/course-schema/course-review.ts`

Reviewer 读取：

- 课程目标矩阵；
- 全部当前 PageSummary；
- 每页 Quality 摘要；
- 有疑点时的受控证据。

Reviewer 不读取 HTML 源码，不修改页面，也不创建返工单。
它必须先读取课程矩阵，再把摘要和质量证据按每批最多 20 页读到末尾。Reviewer 的
`maxSteps/maxToolCalls/timeout` 按 manifest 页数计算，不再使用只够小课程的固定 8
步预算。

`block_course_review` 只在全量证据读完后，由机器检测到 PageSummary 的
`courseId/order` 与冻结 manifest 冲突，或 PageSummary 内的质量投影
`overallScore/decision/issueCodes` 与对应 PageQuality 冲突时动态开放。PageQuality
本身不含课程或顺序字段。健康封口下工具会被隐藏，直接调用也被拒绝；少读证据只能
继续读取，普通内容问题必须形成 `revise_pages` 或 `replan`。

它要检查：

- 每个目标是否有 teaching page；
- 每个目标是否有 assessment/evidence page；
- 页面是否重复或断层；
- 难度是否递进；
- 术语、事实、例子和视觉规则是否一致；
- 计划中的互动是否真的落地；
- 课程开头承诺和结尾回扣是否一致。

输出：

```ts
decision: "pass" | "revise_pages" | "replan"
```

每个问题必须有 scope、pageId（页面问题时）、severity、证据 ArtifactRef 和 suggestedAction。

证据不是任意 ArtifactRef：

- 页面 issue 至少引用该页 current `page_summary` 或 `page_quality`；
- 课程 issue 只能引用 current `course_architecture`、`page_summary` 或
  `page_quality`；
- 只引用 `page_html`、`page_content` 或 `page_assets` 会被 Schema/Gate 拒绝，
  因为 Reviewer 没有读取这些原始产物；
- Gate 逐个核对 kind、scope、version、hash 和 current manifest。

失败点：

- 没读完全部页面就 pass；
- 用 summary 文案代替 ArtifactRef 证据；
- manifestHash 过期；
- 页面问题写成 course scope，导致不必要 replan；
- 内容有问题却用 blocked 逃避结论。

## 11. 阶段十：Director 发布、返工或重规划

Director 的第二个语义回合读取 CourseReview，只能选一个动作。

`fail_course` 不是第四个主观选项：`pass` Review 必须进入 Final Gate；
`revise_pages` / `replan` 在各自持久化预算未耗尽时必须先执行。只有机器确认页面返工
或 replan 预算耗尽后，才会开放失败动作。

### 11.1 publish

只有 Review decision=pass 才能请求发布，随后仍要经过 Final Gate。

### 11.2 revise_pages

系统：

1. 读取 page-scoped issues；
2. 计算点名页面的 build 依赖传递闭包；
3. 标记这些页面 stale；
4. 按 issue 的 `targetArtifact` 创建直接返工单；
5. 对依赖闭包页创建强制 `page_content` 刷新的返工单；
6. 把旧产物作为只读 baseline，而不是新 checkpoint；
7. 重新进入 wave 调度。

返工后必须重新 manifest、Reviewer 和 Director。

### 11.3 replan

全局目标矩阵、页面职责或顺序有问题时：

1. 增加 planningRevision / replanRound；
2. 创建新 `architect_course` WorkOrder；
3. 保留旧分支审计；
4. 新架构仍从 Gate、Director 和原子派工重新开始。

## 12. 阶段十一：Final Gate 和交付

主要文件：

- `src/server/course/gate/review.ts`
- `src/server/course/run/commands.ts`
- `src/server/course/projection/state.ts`
- `src/server/course/projection/public-events.ts`

Final Gate 重新从 current 指针构造 manifest，检查：

- hash 与 Review 输入一致；
- Review 是当前版本且 pass；
- active Architecture 已接受；
- 每个 current 页面都来自当前架构分支的 accepted Page WorkOrder；
- 没有 stale 页面；
- 课程仍持有合法写入围栏。

通过后 `CourseRun.phase=completed`。

这里不会重新加载整套 content/assets/html/quality，也不会重跑 HTML、安全、互动或
布局检查。实现会读取本任务 WorkOrder 列表建立索引，但只核对 current 页面引用的
source WorkOrder 是否 accepted，不会把所有历史 WorkOrder 的状态当成发布条件。发布
依赖前面 Page Gate 已建立的 accepted WorkOrder、不可变 ArtifactRef 和 current
manifest；不要把 Final Gate 理解成第二次完整页面 QA。

Projector 再把 agent-v2 Repository 事实转换为旧 `CourseGenerationState`，由 Task Service：

1. 保存 CourseStore checkpoint；
2. 保存 CourseTaskRecord；
3. 发布 strict snapshot/event/terminal；
4. 让 `/chat` 和 `/course` 继续使用同一套 Keya UI。

Projector 只读当前 ArtifactRef，不从公开文案猜状态，也不把模型私有推理发到浏览器。

SSE 同时走两条路径：

- 当前进程 EventBus：事务提交后的低延迟通知；
- 每 500 ms 通过 `CoursePublicEventReader` 直接追读
  `course_run_events`：补齐其他进程 worker 的 Agent/Tool 事件。

CourseStore/TaskStore 只用于 snapshot 和 terminal 判断。游标是
`traceId + durable sequence`；过滤旧 revision 或私有事件后允许有序号空洞，不能把
剩余事件按数组位置重编号。replan 时 Reader 选择最新非 inactive Architect，并允许
它自己的安全事件在旧 Architecture 仍 active 时实时显示。恢复生成新 trace 后，旧
trace 的 Last-Event-ID 不会压住新 trace；Reader 会把查询游标重置为 0，但数据库
sequence 仍按 taskId 全局递增，不会从 1 重新编号。trace 切换时服务端先发送新 trace
的基线 snapshot；CourseStore 尚未对齐期间到达的 EventBus 增量不会抢跑，而是由
durable log 在 snapshot 后重放。

Agent/Provider 原始异常不进入运行事实。统一错误层只保存稳定
`code/causeCode + 固定公开文案`；Projector 和 SSE 再清洗历史脏数据中的
Authorization、API key、Prompt、request body、Unix 路径和带 authority 的
`file://` 路径。清洗位于统一 `send` 边界，durable reader 与同进程 EventBus 的
snapshot、event、terminal 都不能绕过。若 terminal checkpoint 的事件游标落后于
已发 durable event，Route 使用当前 delivered sequence 编码终态并正常关闭连接。

## 13. 错误应该落在哪一层

| 错误 | 处理位置 | 不应该怎么做 |
| --- | --- | --- |
| Brief 缺目标 | 产品输入层 | 让每个页面 Agent 自己猜 |
| 架构目标漏页、依赖有环 | Architecture Gate | 开始生成后再打补丁 |
| 架构合法但教学设计差 | Director 架构回合 | 用 Schema 冒充语义质量 |
| Provider 暂时故障 | Engine 模型路由 | 无限自动重试 |
| 工具越权 | AgentRunner authorization | 靠 Prompt 提醒 |
| 单页内容/HTML/互动不合格 | Page Gate + Page Builder 修订 | Reviewer 直接改 HTML |
| 跨页重复、断层、漏目标 | Reviewer | 每页 QA 各自宣布整课没问题 |
| 局部页面问题 | fix_page | 整课重跑 |
| 目标矩阵本身错误 | replan | 只修 CSS 或文案 |
| 旧 Review 对不上新页面 | Final Gate | 相信 Director 的文字声明 |
| 进程崩溃 | lease + WorkOrder + Repository 事务 + 显式恢复 worker | 依赖内存状态 |

## 14. 重构和排错顺序

### 第一步：先看架构，不先看 HTML

检查 `course_architecture`：

- 目标是否具体；
- PageTask 是否重复；
- 讲解和练习是否配对；
- 依赖是否合理；
- 验收条件是否可验证。

### 第二步：看 WorkOrder 是否真隔离

检查：

- inputArtifactRefs；
- inputSealedAt；
- allowedTools；
- budget；
- dependencyWorkOrderIds / buildDependencyPageIds；
- executionAttempt、lease、submission。

### 第三步：看页面 Gate 证据

不要只看“页面 completed”。要同时看：

- page_content；
- page_html；
- page_quality；
- 截图证据；
- PageSummary；
- sourceWorkOrderId。

### 第四步：看整课 Review

确认 Reviewer：

- 读完全部页面；
- 覆盖每个 objective；
- issue 有当前 ArtifactRef；
- decision 与 issue scope 一致；
- inputManifestHash 是当前 hash。

### 第五步：看恢复和幂等

模拟：

- Architect 提交后进程退出；
- 页面并行执行中退出；
- 图片工具成功但 terminal 提交前退出；
- Review 完成后 Director 前退出；
- fix_page 执行中取消。

恢复后不应重复创建 Artifact 或 Page WorkOrder。外部副作用还要单独检查工具缓存或 Provider 幂等能力；仅有 ToolOperation 审计记录不能保证 exactly-once。

## 15. 旧代码的定位

旧 Specialist、LangGraph、手写整课生成器和固定 `workflows` 目录已经退出当前实现。图片与页面工具位于 Agent 代码插件，质量与 Repair 策略位于 `course/page`，通用并发能力位于 `infra/concurrency`。

当前复用：

- `src/server/agent/plugins/model-steps/course/**` 中 Page Writer / HTML / QA / Repair 等具体生成能力；
- 图片 Skill；
- HTML 与质量校验；
- Promise Pool；
- 旧 CourseGenerationState 的 UI 投影合同。

已退役且不应恢复：

- 固定长链路伪装成 Agent 协作；
- 每步都经过的规则 Supervisor；
- LangGraph 作为新任务状态事实源；
- 一个 Agent 输出后由运行层静默改写；
- 只存在内存里的活动任务状态。

最终判断标准不是类名或框架，而是：

```text
这一回合有没有独立目标、受控上下文、可选择工具、明确产物、
可验证 Gate、可恢复 WorkOrder，以及最小返工边界？
```
