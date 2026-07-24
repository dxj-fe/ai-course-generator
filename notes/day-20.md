# Day 20：任务、Agent 与页面三层 Timeline

## 今日产出

- 新增纯 `buildCourseRunTimelineModel`，将 `KeyaCourseRun` 和可选 SSE 遥测投影为任务摘要、全局 Agent 与逐页阶段。
- 增强现有 `CourseRunTimeline`，展示任务状态、连接状态、页面进度、当前 Agent/页面、耗时、恢复尝试和精确失败位置。
- 新增 `PageProgressPanel`，在 learning workspace 集中展示每页 Page DSL、图片素材、HTML 和可选 QA。
- 新增 `GenerationLogDrawer`，使用原生 `details/summary` 展示经过共享 Schema 校验的公开事件。
- `ChatApp` 仅将当前活动任务的 `connectionStatus` 与 `taskStatus` 传给当前对话，网络连接状态不写入持久化课程。

## 产品落点

Day 20 不新增路由，也不恢复旧 `AiPlayground` 或训练控制台。

- `/chat` composer 继续负责提示输入、创建任务与取消意图。
- `/chat` thread 展示对话、三层 Timeline、失败卡、断点恢复和结构化公开日志。
- `/chat` 右侧 learning workspace 展示逐页进度、DSL、素材、HTML 预览与 QA。
- `/`、`/course` 和 `/templates` 没有 Day 20 专用界面。

## 数据流与责任边界

```text
CourseGenerationWorkflow
  -> checkpoint CourseGenerationState
  -> strict public event + Day 19 SSE
  -> useSSETask validation / ordering / deduplication
  -> ChatApp Task Controller
  -> buildCourseRunTimelineModel
  -> ChatThread Timeline + learning workspace PageProgressPanel
```

Route Handler 和 Workflow 仍然是课程编排与失败短路的事实来源。Timeline 投影只组织已经确定的状态，不决定下一个 Agent，不重新规划页面，也不直接消费 `MessageEvent`。

## 耗时语义

任务终态优先使用服务端持久化的 `durationMs`。运行中任务才使用 `startedAt -> now` 生成展示计时，最多每秒刷新一次。`aria-live` 只播报任务/阶段变化，不播报每秒的数字变化。

单 Agent 阶段耗时在同一 `traceId + stage + pageId + agent` 内推导：

1. 使用该次尝试最早的 `agent_start`；
2. 使用最后的匹配 `agent_done` 或 `error`；
3. 同一 trace 里的重复边界不会增加尝试次数；
4. 缺少合法时间或终止边界时不伪造精确耗时。

## 恢复与重试语义

Day 20 不从事件 `summary` 中解析“重试”文字。整课事件出现多个 distinct `traceId` 即表示任务从新的运行边界恢复；同一逻辑阶段在不同 trace 中出现 `agent_start` 时，才可以显示阶段尝试次数。

这个策略可以证明断点恢复，但不声称能精确统计同一 trace 内的未持久化局部重试。若产品未来必须展示“第 N 次”，应在服务端公开协议增加结构化 `attempt`，而不是让 UI 猜测。

## 失败定位

当 `CourseGenerationError` 存在时，失败卡显示：

- 共享错误码和面向用户的 message；
- 结构化 `pageId`，全局错误则显示整课；
- 同 trace、stage 和 page 内最近的 `agent_start.agent`；
- 无法安全确定 Agent 时回退为 `Workflow`。

页面组件不根据错误文字重新推断 stage/page，也不复制 Workflow 的恢复规则。

## 结构化日志安全边界

`GenerationLogDrawer` 只遍历 `run.generation.events`，展示：

- `id`、`sequence`、`type`、`traceId`、`timestamp`、`step`；
- `stage`、可选 `pageId`、可选 `agent`；
- 服务端编写的公开 `summary`。

组件不序列化 `run`，不读取 `useSSETask.messages`，因此 snapshot 中的 Prompt、Page DSL、HTML 和其他产物正文不会进入 DOM。测试还使用包含 `systemPrompt`、`reasoning`、raw snapshot 和任意 event data 的污染对象确认这一边界。

## 页面进度与可选 QA

PageProgressPanel 对每页展示 Writer 产生的 Page DSL、Assets、HTML 和 QA。页面交付状态只由前三个必需阶段计算：

- 任一必需阶段失败：页面失败；
- 三个必需阶段全部完成：页面完成；
- 任一必需阶段运行：页面运行；
- QA 缺失：显示“可选·未运行”，不降级页面状态。

## 无障碍与响应式

- 任务页面进度使用 `role="progressbar"` 和数值 ARIA 属性。
- 所有状态都有文字，不只依赖绿色或红色。
- 日志抽屉使用原生 disclosure 语义，键盘可以打开/关闭，不在移动端 workspace dialog 中再叠加一个模态框。
- 页面进度在窄屏为两列，`sm` 起为四列；长 pageId、traceId 和错误使用可换行语义。
- 不对每秒计时更新使用 live region，避免读屏器噪音。

## 自动化与真实任务验收

自动化覆盖：

- 任务/页面分组、页面完成数和 QA 非阻塞语义；
- 完成/运行阶段耗时、同 trace 重复边界和跨 trace 恢复；
- 失败 Agent/page/code/message 定位与 Workflow 回退；
- 连接重连与任务失败的独立展示；
- 公开日志排序、空态与敏感字段泄漏防护；
- 逐页进度的空态、混合状态、失败和可选 QA。

自动化不能代替真实模型耗时下的事件频率、真实错误文案和模型/图片供应商质量。真实验收应另外运行一个低成本三页任务，不把真实调用混入单元测试。

## 演示截图

- `docs/demo-screenshots/day-20/agent-timeline-desktop.jpg`：1280px 桌面双栏，覆盖任务摘要、三层 Timeline、失败定位和逐页四阶段矩阵。
- `docs/demo-screenshots/day-20/agent-timeline-mobile.jpg`：390×844 移动视口，覆盖恢复尝试、阶段耗时、精确失败卡和等待页面。

截图使用确定性的公开事件夹具生成，没有触发模型或图片供应商调用；临时验收路由在截图完成后已删除。真实 `/chat` 另行验证了 1280px 与 390px 外壳、无横向溢出、移动 workspace dialog 焦点进入与关闭后的焦点恢复，并确认浏览器控制台没有 warning/error。

## 面试复盘

### 1. AI 前端为什么不能只显示 spinner？

AI 任务长耗时、结果不确定且可能在某一页的某个 Agent 失败。Spinner 只能说明浏览器正在等待，无法解释已完成什么、失败范围或是否可恢复。Day 20 用任务、Agent、页面三层状态提供可理解反馈，同时只暴露公开事件。

### 2. Timeline 为什么需要纯投影模型？

服务端 checkpoint 是业务事实，Timeline 是针对用户问题优化的只读视图。纯函数将分组、耗时、恢复和错误位置集中计算，UI 组件只渲染，测试可以注入 `nowMs` 确定性验证。代价是多一层 adapter，但避免各组件对原始事件做不同推断。

### 3. 断线重连和 Agent 重试有什么区别？

`connectionStatus: reconnecting` 只表示浏览器与 SSE 的网络连接正在恢复，后台任务可仍然是 running。Agent 重试或断点恢复表示 Workflow 发起了新的执行尝试。本项目分开两个 Badge，避免普通网络波动被误报为生成失败或模型重试。

### 4. 为什么日志抽屉不直接渲染 SSE messages？

snapshot 和 terminal 包含完整课程状态，其中有用户 Prompt、DSL 和 HTML 产物；框架原生流还可能随 SDK 版本变化。Day 20 仅渲染经过严格共享 Schema 的公开事件，可以观测阶段、页面和错误，但没有 Prompt、私有 data 或 chain-of-thought 通道。

### 5. 什么时候应该在协议中增加 attempt 而不是前端推导？

用户只需要理解“该阶段已从断点再次执行”时，不同 trace 的边界事件已经足够。若 attempt 用于计费、SLA、审计或必须精确区分同 trace 内的自动重试，它就应是服务端公开协议的显式字段。UI 猜测可以提供友好提示，不能变成精确业务事实。

## 当天结束复盘

1. 当同一 Agent 在一个 trace 内产生重复边界时，耗时和 attempt 是否仍然稳定？
2. 页面 QA 失败为什么不能让已完成 HTML 的页面变成交付失败？
3. 日志组件的输入中哪些是产品可观测字段，哪些应只留在服务端？
4. 用户是否能在五秒内说出当前 Agent、当前页面和失败原因？
5. 移动端 workspace 已是 dialog，日志为什么选择非模态原生 disclosure？
