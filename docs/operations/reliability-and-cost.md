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
- 规划 Lead 使用 120 秒、Page Creator 使用 300 秒、Reviewer 使用 120 秒、Final Lead 使用 60 秒总预算；同一 WorkOrder 的 continuation 共享 deadline，不会每轮重置 300 秒。预算到期终止当前 attempt，再由恢复协议决定是否继续，不把第一次瞬态超时直接写成整课失败。
- Course Lead 的首轮 Prompt 已预加载有界资料证据与 Skill 核心说明，只开放轻量 draft 提交，避免“检索一次再规划一次”的长尾放大。
- Page Creator 首轮已预加载页面上下文，`edit_page_workspace` 自动 checkpoint、Playwright 渲染和质量检查；最多三轮有证据的质量修订。唯一 submit/block 终态由 Harness 直接执行，避免在 deadline 末端再次等待 Provider。
- 所有依赖已满足页面进入三路连续补位并发池；页面完成立即释放槽位，不按固定 batch 等待慢页。
- CourseRun/WorkOrder lease 的基础下限为 2 分钟，活跃 WorkOrder 覆盖阶段预算加 1 分钟；Worker 崩溃后不再固定等待 15 分钟才能恢复。
- Agent run、Provider 回合和 Tool 都记录耗时，能区分模型生成慢、浏览器慢和工具状态空转。

## 质量

- 页面必须通过内容、HTML、安全、运行时、三视口截图和质量 Gate。
- 学习器允许页面自然纵向滚动；纵向长度只记录 warning，横向溢出、真实文字/交互裁切、控制台错误和失效互动继续阻断。
- 整课必须通过目标覆盖与跨页一致性审查。
- 质量对比记录首轮通过率、模型渲染率、返工次数、截图覆盖率和综合分。

## 当前真实基线

2026-08-06 的固定 Doubao Seed 2.0 Pro 太阳系 5 页盲测一次完成：Course Lead 33.676 秒，后端全链路 416.523 秒，Demo 含最终截图与导出共 421 秒；5 页全部由模型 HTML 首轮 WorkOrder 接受，综合分 93.32，0 issue / 0 warning。该结果证明典型 4～5 页课程在三路并发下可以稳定进入 15 分钟 SLA；后续仍需用跨学科批量盲测观察 P95，而不是据单案例承诺所有主题都在 7 分钟内。

## 运维

本地运行数据位于 `.data`，不提交到 Git。`pnpm dev` 和 `pnpm start` 同时启动 Web 与 Worker；分离部署使用 `pnpm run start:web` 和 `pnpm run worker:course`。Chromium 必须在具备浏览器进程权限的 Worker 环境运行。当前数据库结构发生变化时重新创建本地数据库，不在生产代码中保留历史导入分支。
