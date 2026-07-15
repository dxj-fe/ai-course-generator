# Day 18：串行多页课程 MVP 与统一预览

## 今日产出

- 一个提示通过 `POST /api/courses/generate` 进入服务端整课工作流。
- 工作流依次执行 Intent、Course Planner、Pedagogy/Story/Visual，并按 `CoursePlan.pages` 顺序为每页执行 Page Writer、Assets 和 HTML Engineer。
- Day 18 页数只允许 3–5。显式 `pageCount` 是服务端受信约束；未显式指定时，工作流尊重 Intent 结果并把它收敛到该范围。
- `CourseGenerationStateSchema` 同时描述课程阶段、当前页面、逐页 DSL/素材/HTML、公开事件、结构化错误和时间字段。
- `.data/courses/{courseId}/course.json` 在每个阶段边界原子替换。失败不会删除之前页面，恢复时跳过已完成页面和当前页已经完成的阶段。
- `/chat` composer 一次启动整课任务并可取消；Task Controller 将批量状态映射到现有 Planner、Design、Page Writer、Assets、HTML Timeline。
- 右侧 learning workspace 提供统一多页预览。页面选择使用 Tab 语义，任何时刻只挂载当前选中的一个空权限沙箱 iframe。
- 现有逐页按钮继续提供局部重试和 QA。QA 不属于 Day 18 强制生成链，不会阻塞整课 HTML 交付。

## 真实数据流

```text
/chat composer
  -> typed API client
  -> POST /api/courses/generate
  -> CourseGenerationWorkflow
       -> Intent Agent
       -> Course Planner Agent
       -> Course Design Workflow
            -> Pedagogy -> Story -> Visual
       -> page 1: Page Writer -> Assets -> HTML Engineer -> checkpoint
       -> page 2: Page Writer -> Assets -> HTML Engineer -> checkpoint
       -> ...
  -> CourseGenerationState
  -> Seaca Task Controller adapter
  -> chat public Timeline + right learning workspace
  -> selected HtmlPreviewFrame only
```

展示组件不调用业务 API，也不解析模型或框架的原生流数据。工作流负责顺序、页数、依赖、失败短路和恢复；Controller 只把共享状态投影成现有界面所需的数据。Day 19 改为 SSE 时，应替换传输和增量更新方式，而不是重新设计这条业务链或预览组件。

## 状态与公开事件边界

`CourseGenerationState` 是可持久化事实，主要包含：

- `status`、`currentStage`、`currentPageId`；
- 已校验的 `intent`、`outline`、专业 briefs 和 Page Worker briefs；
- 有序 `pages[]`，每页保存 `currentStage`、DSL、素材结果和 HTML；
- 可公开 `events[]` 与当前尝试的 `errors[]`；
- `startedAt`、`updatedAt`、`completedAt` 和 `durationMs`。

公开事件 Schema 是 strict 的，不接受原始 Agent `data`。工作流只复制 `type`、`summary`、阶段、页面、Agent 名、步骤和追踪字段，因此系统 Prompt、生产图片 Prompt、私有工具上下文和 chain-of-thought 不会因为 checkpoint 或前端 Timeline 被持久化。

状态在写盘前和读取后都重新通过 Zod。完成态还有更强约束：Intent 页数必须与 CoursePlan 一致；页面状态必须按计划顺序覆盖；每个完成页面必须有 DSL 和 HTML；素材结果必须无重复地覆盖全部 asset slot；整课完成时所有页面都必须完成。

## 检查点和恢复语义

存储使用受控 `courseId`，拒绝绝对路径、`..` 和其他目录穿越输入。每次保存先在同目录写完整临时 JSON，再 rename 成 `course.json`；同一 store 实例还用写队列保持并发 checkpoint 顺序。读取不存在的课程返回 `undefined`，损坏 JSON、Schema 漂移或目录 ID 不匹配则显式失败，不能被当作空课程覆盖。

页面失败时，当前页记录精确阶段和错误，后继页保持 `pending`，此前页面仍为 `completed` 并保留 HTML。恢复请求只需要原 `courseId`：

1. Intent、Plan 或 briefs 已存在就不再调用对应 Agent。
2. 已完成页面完全跳过。
3. 当前页已有 DSL 时跳过 Page Writer；素材已完成时跳过 Assets。
4. 从失败的 HTML 阶段恢复，只重新调用当前页 HTML，然后继续后继页。
5. 新尝试使用新的 traceId，UI 只展示当前尝试的事件；旧事件仍保留在 checkpoint 供审计。

取消沿用已有 AbortSignal。Agent 返回 `AGENT_ABORTED` 或请求信号终止时，课程状态写为 `cancelled`，并与普通失败使用同一恢复入口。前端取消只表达用户意图；服务端仍负责在安全边界保存状态。

## 为什么保持串行

Day 18 的目标是先证明多页链路、页面依赖、检查点和统一预览，而不是优化吞吐。`dependsOnPageIds` 表达前页依赖，后页内容和视觉连续性也可能依赖前页已经确定的结果。串行执行使失败边界、成本归属和恢复位置清晰。

并行页面、Supervisor、Page Worker 调度、Repair 和 LangGraph 都会引入额外的竞态、合并和重试语义，属于后续训练日。当前实现没有提前加入这些能力。

## 统一预览与性能边界

统一预览仍位于 `/chat` 右侧 learning workspace，不新增训练控制台或产品路由。页面列表按 `order` 排序并显示 idle、running、completed、failed。键盘可以使用方向键、Home 和 End 切换 Tab。

只为当前选中且已有 HTML 的页面挂载 `HtmlPreviewFrame`。这避免 3–5 个 `srcDoc` 文档同时解析、布局和占用内存；未选中页面只保留类型化 HTML 字符串。iframe 继续使用空权限 `sandbox`、`srcDoc` 和安全预检，不因为统一预览放宽 Day 13/14 的边界。

## 自动化与真实模型验收

自动化测试覆盖：

- 状态完成态、页数一致性、引用关系、私有事件拒绝和素材覆盖；
- 课程存储的安全 ID、缺失/损坏读取、原子写入和并发保存顺序；
- Agent 调用与页面执行顺序；
- 第 2 页 HTML 失败后保留第 1 页并停止第 3 页；
- 从第 2 页 HTML 恢复时不重跑规划、第 1 页或第 2 页 Page Writer；
- Abort 映射为可恢复 cancelled 状态；
- API 客户端的请求、AbortSignal 和响应 Schema；
- 多页预览只挂载一个 iframe，以及 Composer 的取消操作。

自动化不能证明真实模型生成的 3–5 页内容连贯、图片布局合适或每页视觉质量一致。真实模型验收需单独记录调用成本，并在 375px、768px 和桌面视口检查：完整生成、主动取消、指定页面失败后的恢复、页面切换、键盘焦点、横向溢出、iframe 安全属性和素材 fallback。Day 18 不把真实模型验收伪装成单元测试。

## 面试题与参考答案

### 1. 为什么整课工作流必须放在服务端，而不是让 React 依次调用多个 API？

核心结论：业务顺序、失败短路和恢复规则必须只有一个事实来源。浏览器编排会把规则绑定到某个页面生命周期，刷新、切页或多端调用时很难保持一致。

在本项目中，Route Handler 调用 Course Generation Workflow，后者拥有 Intent、Plan、briefs 和每页阶段。ChatApp 只发一次请求并映射结果。代价是 Day 18 的批量请求等待较久；Day 19 用 SSE 改善反馈，但不会把业务顺序移回 UI。

### 2. 为什么 checkpoint 保存完整状态，而不是只保存最后完成的 pageId？

核心结论：位置不足以证明产物和协议仍然有效。恢复需要已校验的 Intent、Plan、briefs、DSL、素材、HTML 和精确失败阶段。

`CourseGenerationStateSchema` 使 checkpoint 自描述并可重新校验，因此服务端能安全跳过已完成工作。权衡是 JSON 较大，尤其包含 HTML；Day 18 的 3–5 页本地 MVP 可以接受，生产规模可把二进制和大文本拆到对象存储并保留引用。

### 3. 为什么原子 rename 仍然需要读取时做 Schema 校验？

核心结论：原子写只避免读到半个文件，不能防止旧版本、人工修改、逻辑不一致或目录错配。

本项目写前、读后都用同一个 Zod Schema，并核对目录 courseId。多实例生产环境还需要数据库事务或对象存储并发控制；单机写队列不能替代分布式锁。

### 4. 页面 2 的 HTML 失败时，恢复应该重跑哪些步骤？

核心结论：只重跑尚未产生有效 checkpoint 的最小阶段。页面 1 保持完成；页面 2 已有 DSL 和素材，因此只重跑 HTML；成功后再进入页面 3。

如果上游产物被用户显式重新生成，Controller 会使当前页后续产物失效，这是另一类局部重试。不能盲目复用旧 HTML，也不能为了简单而重跑整课并重复模型和图片成本。

### 5. 为什么统一预览只挂载一个 iframe？

核心结论：iframe 是独立文档上下文，多个完整 `srcDoc` 会同时产生解析、样式、布局和内存成本。隐藏 iframe 仍然可能执行这些工作。

CoursePreviewGrid 只挂载当前完成页面，其余页面保留状态和字符串。权衡是首次切到另一页时浏览器才解析它，但对 3–5 页课程这是更可控的性能与安全选择。

### 6. Day 18 为什么不把 QA 放进必过主链？

核心结论：手册当天的交付目标是可恢复的多页 HTML MVP。QA 已存在，但它是报告型能力，不会自动修复；强制 QA 会改变成功定义并提前引入 Repair 决策。

ai-course-generator 保留逐页 QA 按钮和状态。用户可在 HTML 生成后评估页面，但 QA 失败不抹掉已交付 HTML。后续 Supervisor/Repair 训练日再定义自动质量门槛和循环预算。

## 当天结束复盘

1. 当前状态中的哪些字段属于可恢复事实，哪些只是一次尝试的观测信息？
2. 如果 checkpoint 在页面 3 素材完成后写入失败，下一次恢复最多会重复哪一步？
3. 为什么 completed 页面需要同时验证 DSL、素材槽覆盖和 HTML，而不能只看 status？
4. 批量 JSON 改成 SSE 时，哪些模块应改动，哪些业务模块不应改动？
5. 真实多页验收中，哪些结论可以由自动化证明，哪些必须观察浏览器和模型产物？
