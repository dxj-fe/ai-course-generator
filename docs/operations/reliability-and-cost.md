# 可靠性与成本

## 模型路由

所有文本 Agent 固定使用 Volcengine Ark 的 `doubao-seed-2-0-pro-260215`。`cheap`、`balanced`、`strong` 仅作为已有 Agent 协议中的兼容枚举，实际解析到同一个 Pro 模型；模型路由不设置 fallback，HTML 也不使用专用或较弱模型。当前只需要 `ARK_API_KEY`，`ARK_BASE_URL` 可选。

固定 Pro 的目的不是长期否定成本路由，而是在当前课程质量和 Harness 稳定性尚未建立时消除模型档位变量。恢复多模型路由前必须先有真实课程盲测，并证明降档不会降低终态提交率、教学质量和浏览器通过率。

## 执行边界

- CourseRun 与 WorkOrder 使用租约和 CAS。
- Web 默认只入队；显式 Course Worker 独占 Agent Loop、恢复扫描和 Playwright。Worker 领取任务前验证 Pro 模型身份与 Chromium 健康状态。
- 工具调用有幂等键、账本、步骤数、调用数、超时和输出大小限制。
- Page Builder 的内容生成最多连续尝试三次；失败计数从工具账本恢复，达到上限后以 `PAGE_CONTENT_RETRY_EXHAUSTED` 终止当前页面，不能消耗完整 Agent 工具预算。
- 完整产物先写 Artifact，返回给模型的只是受控摘要。
- Page Builder 只生成架构声明需要的素材。
- 返工复用未失效的上游产物。
- Browser 启动/进程故障归类为 `RUNTIME_ERROR`：Task 保持 queued/checkpoint，WorkOrder 与 CourseRun 释放租约，不写页面失败、不进入 HTML 修订循环。
- Provider 网络超时、限流或 Agent 尚未提交终态属于瞬态执行故障：同一个 Pro 模型最多有界尝试三次。每次失败释放租约并把 Task 放回 queued；不会切换 mini，也不会清除已保存 Artifact 或 WorkOrder workspace。
- 默认 Course Worker 并发为 1，单课内部仍最多三路 Page Creator 并行。这样保留多 Agent 协作速度，同时避免两门课程把同一 Provider 瞬时放大到六路 HTML 长请求；只有独立容量池和压测证据允许显式提高 `COURSE_TASK_WORKER_CONCURRENCY`。
- Agent Provider 单回合上限为 150 秒且 SDK 内部重试为 0。正常 Doubao 页面回合的真实范围约 45～100 秒；超过 150 秒按瞬态故障释放执行权，由 WorkOrder 从 workspace/Artifact checkpoint 重试，避免原地盲等到 300 秒总预算。
- 规划 Lead 与 Page Creator 使用 300 秒、Reviewer 使用 120 秒、Final Lead 使用 60 秒总预算；同一 WorkOrder 的 continuation 共享 deadline，不会每轮重置预算。真实 Provider 证明 Lead 的 120 秒旧值会在正常长尾生成尚未完成时提前中断，因此 WorkOrder 与 Planner 声明统一为 300 秒；预算到期仍只终止当前 attempt，再由恢复协议决定是否继续。
- Course Lead 的首轮 Prompt 已预加载有界资料证据与 Skill 核心说明，只开放轻量 draft 提交，避免“检索一次再规划一次”的长尾放大。
- Page Creator 首轮已预加载页面上下文，`edit_page_workspace` 自动 checkpoint 和 Playwright 渲染；最多三轮有证据的质量修订。读取预加载上下文、封装确定性 PageQuality、render/inspect 以及唯一 submit/block 等没有选择空间的状态迁移由 Harness 直接执行并写入同一工具账本，Provider 只处理 HTML 创作、可选生图和有分支的质量修订。
- Page Creator 修订回合不携带多个旧 HTML 和历史工具结果；Harness 用持久化 workspace 重新注入唯一当前 HTML、issue code/selector/repairHint 与最新三视口截图。工具账本和 Artifact 保留完整审计，但 Provider 上下文不会随修订轮数线性膨胀。
- 所有依赖已满足页面进入三路连续补位并发池；页面完成立即释放槽位，不按固定 batch 等待慢页。
- CourseRun/WorkOrder lease 的基础下限为 2 分钟，活跃 WorkOrder 覆盖阶段预算加 1 分钟；领取子 WorkOrder 前先把父 CourseRun 续到同一到期时间，恢复扫描同时检查父租约与任何活跃子租约。租约竞争只让任务回到 queued，不得写 `course_failed`。
- 页面经过有证据修订后合法 blocked 时，Engine 创建 Course Lead 恢复回合并把当前 PageQuality 封口传递给新版 Architect WorkOrder；Lead 在用户固定页数内重新分配单页职责。只有 replan 预算耗尽才允许受控失败，单页阻塞不直接终止整课。
- Agent run、Provider 回合和 Tool 都记录耗时，能区分模型生成慢、浏览器慢和工具状态空转。

## 质量

- 页面必须通过内容、HTML、安全、运行时、三视口截图和质量 Gate。
- 学习器与 Browser Harness 统一使用固定 16:9 舞台；根级或嵌套横向/纵向滚动、真实文字/交互裁切、控制台错误和失效互动均阻断，内容过载通过重新排版或拆页解决。
- 1920×1080 固定舞台与舞台级 `overflow:hidden` 属于平台合同，不触发普通固定宽度或裁切静态警告；真实风险只以三视口几何、文字 Range 和互动证据判断。
- 原始文档宽高超过 1920×1080 的八像素浏览器测量容差即阻断；contain-fit 后没有滚动条不能掩盖比例失真。架构承诺互动的页面必须通过原生控件回放并产生控件之外的可观察反馈，但 Harness 不指定卡片、控件或 DSL 模板。
- 同页存在 details 与 input/select 等多类原生状态控件时必须分别回放，不能以一个成功控件掩盖另一个伪互动；code/pre 之外的裸露 HTML 标记按阻断性内容错误处理。
- 整课必须通过目标覆盖与跨页一致性审查。
- 质量对比记录首轮通过率、模型渲染率、返工次数、截图覆盖率和综合分。

## 当前真实基线

2026-08-06 的固定 Doubao Seed 2.0 Pro 太阳系 5 页盲测一次完成：Course Lead 33.676 秒，后端全链路 416.523 秒，Demo 含最终截图与导出共 421 秒；5 页全部由模型 HTML 首轮 WorkOrder 接受，综合分 93.32，0 issue / 0 warning。该结果证明典型 4～5 页课程在三路并发下可以稳定进入 15 分钟 SLA；后续仍需用跨学科批量盲测观察 P95，而不是据单案例承诺所有主题都在 7 分钟内。

## 运维

本地运行数据位于 `.data`，不提交到 Git。`pnpm dev` 和 `pnpm start` 同时启动 Web 与 Worker；分离部署使用 `pnpm run start:web` 和 `pnpm run worker:course`。Chromium 必须在具备浏览器进程权限的 Worker 环境运行。当前数据库结构发生变化时重新创建本地数据库，不在生产代码中保留历史导入分支。
