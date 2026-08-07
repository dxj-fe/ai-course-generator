# 项目文档索引

## 当前架构

`../docs/architecture/README.md` - 系统边界、核心实体与运行原则，修改后端结构前必读。

`../docs/architecture/generation-flow.md` - 当前课程生成全链路，修改编排、页面生成或发布流程前必读。

`../docs/architecture/multi-agent.md` - Agent 角色、工作单、证据 Gate 与恢复规则，修改 Agent 或工具前必读。

`../docs/architecture/schema.md` - 当前共享协议与约束，修改 Schema 或 API 前必读。

## 前端

`../docs/product/ui-integration.md` - Keya 产品入口、能力地图和界面约束，修改前端时必读。

`../docs/operations/html-preview-security.md` - HTML 合同、沙箱和浏览器 QA，修改预览或播放器时必读。

## 运行与模板

`../docs/operations/reliability-and-cost.md` - 模型路由、执行预算、质量与本地数据约束。

`../docs/templates/functional.md` - 功能模板选择与扩展规则。

`../docs/templates/style.md` - 样式模板与设计 token 规则。

## 当前任务文档

`workflow/260806-redesign-creative-course-generation.md` - 最小多 Agent Loop 生课架构及当前大规模重构的阶段、边界与验证记录。

## 已完成任务文档

`workflow/done/260806-analyze-course-generation-richness.md` - 当前生课链路、课程不丰富的根因、问题代码与优先优化方向。

`workflow/done/260806-fix-course-generation-failures.md` - 生课高频失败的全局根因、Browser/Worker 责任分离、Doubao 2.0 Pro 统一路由与 5 页真实盲测结果。

## 全局重要记忆

- 产品 UI 只使用 `src/features/keya` 与当前产品路由。
- 课程任务、Prompt、Schema 和数据库只维护当前合同，不按历史标识分流。
- Artifact 与 HTML 的 `revision` 只表示不可变产物的递增修订。
- 生课系统首期目标只设一个 Course Lead、并行 Page Creator 和一个 Course Reviewer；通过 WorkOrder、Artifact、Review 协作，生图、检索和 Skill 均作为 Tool，不提前拆独立 Agent 或建设通用消息系统。
- 新页面使用按 WorkOrder 稳定存在的本地 workspace 反复编辑 HTML，并在 render/submit 时 checkpoint 到 SQLite Artifact；executionAttempt 不更换工作目录，文件缺失时才用数据库 checkpoint 初始化。历史 WorkOrder 仅在缺少新工具权限时使用旧 Model Step 恢复链路。
- 浏览器证据统一由后台 Playwright Browser Pool 采集，每次渲染使用独立 BrowserContext，并向 Page Creator 与 Reviewer提供 PNG、DOM、Console、网络和受控互动结果。
- Browser Harness 不再要求作者写 `data-page-id`；可信运行时在唯一 `main` 上补运行标识。三视口截图缺失、截图失败、失效按钮、不可读的整体缩放属于交付阻断证据。
- 学习端 HTML 使用自然纵向滚动，不再把丰富网页压缩进固定幻灯片画布；纵向长度只做 warning，横向溢出、真实文字/交互裁切、失效互动和运行时错误仍是硬门禁。
- Page Creator 拒绝无变化 workspace 写入，只保留最新一轮三视口 PNG，最多完成 3 轮有证据的质量修订；达到预算后由 Harness 直接执行唯一 submit/block 终态，不能再花一次模型调用机械封口。
- Page Creator 使用 `page-writer` 强档模型路由；课程至少三页时 Architecture Gate 要求至少两个无生成依赖页面，Demo 默认三路并发，确保多 Agent 协作不是名义并行。
- 新任务只使用同一个 `curriculum-architect` 身份作为 Course Lead：架构 Gate 后直接派发页面，独立 Reviewer 完成后再由同一 Lead 决策；`course-director` 只恢复旧 WorkOrder。
- 生产 Harness 不要求固定页型、互动类型、模板 ID、图片槽、伴随 HTML 填写的 blocks/interaction draft 或 HTML `data-*` DSL 标记；HTML 是页面内容真相，旧字段只在下游需要时由 Harness 补兼容值。
- 课程质量用跨学科提示词、真实浏览器证据和 A/B 人工盲测评价，不以模板命中或固定步骤评价。
- Web 进程默认只负责 API、UI、SSE 和持久任务入队；显式 Course Worker 独占 Agent Loop、Browser Pool 与恢复扫描，领取任务前必须通过模型和 Chromium 预检。
- 当前所有文本 Agent 固定使用 `volcengine-ark/doubao-seed-2-0-pro-260215`，旧 cheap/balanced/strong 只保留协议兼容，不再切换模型或 fallback 到 mini/lite。
- Browser Harness 启动或进程故障属于可恢复运行时错误：释放 CourseRun/WorkOrder lease、把 Task 留在 queued/checkpoint，不生成页面质量失败或消耗修订预算。
- Provider/Agent 瞬态超时固定使用同一个 Pro 模型最多尝试三次；任务回到 queued，稳定 workspace 与 Artifact checkpoint 均保留。Lead 规划 120 秒、Page Creator 300 秒、Reviewer 120 秒、Final Lead 60 秒，各 continuation 共享阶段 deadline。
- Course Lead 首轮预加载 Skill 核心说明和有界资料证据，只向 Provider 开放轻量 draft 提交；Page Creator 首轮预加载 CourseContext、PageTask、workspace 与事实边界，第一次动作直接编辑 HTML。
- 新页面的 `edit_page_workspace` 自动 checkpoint、Playwright 渲染和质量检查；所有当前依赖已满足的 Page WorkOrder 进入固定并发池，任一页面完成后立即补入下一页。
- Browser 裁切只在真实文字 Range 或交互盒越过 `overflow:hidden/clip` 边界时阻断；装饰轨道、光晕和素材画框的几何越界不再诱发无效修订。
- CourseRun/WorkOrder lease 由阶段预算决定，恢复基础下限为 2 分钟且覆盖阶段预算加 1 分钟，不再固定等待 15 分钟。
