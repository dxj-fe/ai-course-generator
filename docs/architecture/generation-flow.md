# 从提示词到课程 HTML

## 请求与任务

`/chat` 调用课程任务 API。Web 服务校验 `CourseCreationBrief`，创建 queued 任务、课程占位和会话关联后立即返回，不在请求进程执行 Agent Loop，也不在 Next 启动时默认恢复旧任务。显式 `course-task-worker` 先验证 Doubao 2.0 Pro 身份与 Chromium 连接，再按租约领取任务。浏览器通过 `/api/courses/tasks/[taskId]/events` 订阅 SSE；公开事件只包含可展示进度、Artifact 引用和安全错误，不暴露私有推理。

本地 `pnpm dev` / `pnpm start` 会并列启动 Web 与 Worker；生产部署也可以分别运行 `start:web` 和 `worker:course`。`COURSE_TASK_INLINE_EXECUTION=1` 只供固定 Demo 等明确的单进程场景使用。

## 最小 Agent 链路

生产链路只有三种职责：

1. `Course Lead` 理解 Brief、资料和学习目标，形成课程上下文与页面 WorkOrder。
2. 多个 `Page Creator` 在固定并发池中持续补位制作页面，默认最大并发为 3。
3. `Course Reviewer` 读取整课页面与真实浏览器证据，提交通过或定点返工结论。

新任务的规划与 Review 后决策都由同一个 `Course Lead` Agent ID（持久化值仍为 `curriculum-architect`）承担。Lead 提交架构并通过确定性 Gate 后直接派发 Page WorkOrder，不再额外调用一次模型做“架构验收”；独立 Reviewer 提交整课 Review 后，再唤醒同一个 Lead 决定发布、定点返工或重做规划。`course-director` 仅用于恢复数据库中已经存在的旧 WorkOrder。

规划首轮由 Harness 直接注入 Brief、Skill 核心说明和有界资料证据（摘要、关键事实、引用 ID 与有限原文摘录）。Provider 只看到轻量 `CoursePlanDraft` 和唯一提交工具，不再先调用资料检索、Skill 读取或完整 Schema 校验；稳定 ID、Brief 已确认字段和迁移兼容字段由 Harness 投影。真实 Doubao Pro 盲测中该阶段一次提交耗时 33.676 秒。

架构阶段不再检索功能或样式模板，也不要求模型输出 pageType、interactionType、模板 ID 或图片槽位。迁移期 Schema 会为仍被旧投影读取的字段填入 `agent-authored`、`none` 等兼容默认值；Architecture Gate 只检查可执行范围、引用边界、页数、依赖和验收条件，不用模板注册表或学科关键词决定课程形态。

`buildDependsOnPageIds` 只允许表达“必须读取前页实际产物”的生成依赖。三页及以上课程至少要有两个可直接从 CourseArchitecture 开工的页面，否则 Architecture Gate 要求 Lead 删除伪串行依赖。所有依赖已满足的页面进入同一个固定并发池，Demo 与默认运行最多三路 Page Creator 并发；任一页面完成后立即补入下一张可运行 WorkOrder，不等待整批页面一起结束。

## Page Creator Loop

每个页面 WorkOrder 拥有独立目录：

```text
.data/agent-workspaces/{taskId}/{workOrderId}/
├── TASK.md
├── index.html
└── page.json
```

Harness 在第一次 Provider 调用前已经把 CourseContext、PageTask、已验收依赖摘要、授权事实边界和当前 workspace 内容放进 Prompt，因此新页面不花模型回合机械读取上下文。生产循环为：

```text
预加载页面上下文、Skill 核心说明与 workspace
→ 直接创建或修改 index.html
→ edit_page_workspace 自动 checkpoint、渲染、截图与质量检查
→ 查看三视口截图与 DOM、Console、网络、互动证据
→ 按需检索资料、调用生图 Tool 或继续修改
→ submit_page / block_page
```

核心页面创作不再委托给一次性 Page Writer、HTML Engineer 或 Page QA 模型。新建 Page WorkOrder 的 ToolSet 只包含上下文读取、workspace 读写、按需生图、资料检索、渲染、检查和提交；旧生成/修复 Tool 只在运行时为历史 WorkOrder 提供恢复能力。`page.json` 只保存实际使用的授权资料引用，不保存页面块、互动或视觉结构。HTML 是新页面的内容真相；Harness 在 checkpoint 时根据 PageTask 和 HTML 自动生成旧下游暂时需要的兼容 Artifact。`PageContentDSL` 仍作为播放器、Artifact 与历史任务的迁移期读模型存在，但不再由 Page Creator 输出，也不主导新页面构图。

页面 Gate 只要求完整 HTML、安全 envelope、单一 `<main>`、引用权限和可交付质量，不要求 `data-page-id`、`data-block-id`、固定 runtime 标记、固定互动类型或模板映射。页面可直接使用原生 HTML、CSS 和受信任运行时表达最适合当前教学目标的结构。

生图是 `generate_page_image` Tool。Page Creator 自行判断是否调用、如何写 Prompt、以及怎样把返回的内部 URI 放入 HTML；没有独立图片 Agent。

## Browser Harness

后台 Worker 复用一个 Playwright Chromium 进程，每个视口检查使用独立 `BrowserContext`。页面默认阻止外部网络，只允许平台内部素材 URI。

`render_page` 采集：

- 桌面、平板、手机三视口 PNG；
- 溢出、裁切、首屏覆盖、触控尺寸和视觉占比；
- DOM 数量与可定位 outline；
- Console、`pageerror`、`requestfailed`；
- click、check、fill、expectVisible、expectText、expectAttribute 受控互动步骤。

截图会在下一轮作为多模态输入回灌给同一个 Page Creator。新链路的 `edit_page_workspace` 在同一工具调用中完成 HTML checkpoint、Playwright 渲染和质量 Artifact；独立 `render_page` / `inspect_page` 仍用于受控互动步骤、点查和历史兼容，不再要求模型机械串联。Course Reviewer 默认读取最多 20 页的桌面截图概览以及全课紧凑诊断，需要时再加载目标页三视口原图。

模型输入只保留最新一轮三视口 PNG，旧截图会从消息中移除，但历史工具结果和修订记录保留。这样 Agent 能持续看到当前页面，又不会因多轮累计大图耗尽外部 Provider 的多模态上下文。相同 HTML 与相同元数据的 workspace 写入会被拒绝，避免空转。

workspace 以 WorkOrder 为稳定身份，不随 `executionAttempt` 换目录。Worker 或 Provider 中断后先复用本地未提交文件；若文件缺失，才从最新 `page_html` checkpoint 初始化。因此本地文件承担 Agent 工作区，SQLite Artifact 承担可靠 checkpoint，两者不会互相覆盖正在创作的新版本。

学习器 iframe 使用自然纵向滚动，桌面、平板和手机都不再把整页 HTML contain-fit 压缩进固定短画布。QA 仍测量作者 HTML 的原始尺寸，但纵向长度与首屏后可达主操作只保留为 warning；横向溢出、真实正文/交互裁切、失效按钮、控制台错误和互动回放失败仍是确定性问题。`overflow:hidden/clip` 只有在真实文字 Range 或交互盒越过边界时才算裁切，装饰轨道、光晕与素材画框的几何越界不会误触返工。

Worker 停止时关闭 Browser Pool。生产环境先执行 `npm run browser:install` 安装与 Playwright 包匹配的 Chromium 及系统依赖。

Browser 启动失败、进程被系统终止或连接断开统一抛出 `BROWSER_HARNESS_UNAVAILABLE`。它是 Worker 基础设施故障，不是 HTML 质量问题：当前 WorkOrder 和 CourseRun 释放 lease，Task 回到 queued 并保留最近 checkpoint；Page Creator 不会因为浏览器不可用而修改 HTML 或消耗修订轮数。Browser Pool 在启动失败后短暂冷却，避免并行页面重复拉起 Chromium。

## Artifact 与存储

- 编辑期间，HTML 是 workspace 的本地 `index.html`，允许 Agent 多轮小步修改。
- 新链路的 `edit_page_workspace` 自动把当前 HTML checkpoint 为 `page_html` 并生成 `page_quality`；显式 `render_page` 保留给受控互动点查和历史恢复。
- `submit_page` 通过确定性 Page Gate 后，最终 HTML 仍以 Artifact payload 写入 `.data/keya.sqlite`，保持播放器、Manifest 和历史课程链路不变。
- 生图二进制写入 `.data/generated-assets`；截图写入 `.data/quality-screenshots`；Artifact 只保存内部 URI 或证据 ID。

因此当前答案不是“只存文件”或“只存数据库”：创作过程用文件 workspace，可靠 checkpoint 与最终交付继续用 SQLite。

## 审查、返工与发布

Reviewer 检查学习目标覆盖、事实与引用、跨页连贯、视觉完成度和互动结果。Review 绑定当前 manifest，过期 Artifact 不能用于发布决策。局部问题由 Course Lead 创建目标页 Fix WorkOrder；课程级问题回到 Lead 重新规划；通过后 Final Gate 发布精确 CourseManifest。

返工仍受 WorkOrder、allowedTools、预算、lease、CAS 和幂等工具账本约束。普通模型文本不构成完成，只有终态 Tool 成功提交才会推进任务。

Page Creator 走 `page-writer` 强档模型路由，每个 WorkOrder 的所有 continuation 共享 300 秒 deadline，页面初稿后最多进行三轮基于 Browser Harness 的质量修订。当唯一合法动作只剩 `submit_page` 或 `block_page` 时，Harness 直接调用同一个持久化终态工具，不再让 Provider 为机械封口承担一次长尾请求。旧 Model Step 恢复链路仍沿用一次定向 Repair。

## 质量基准与迁移边界

历史运行中的旧 WorkOrder 若没有 workspace 工具权限，会自动继续旧 Model Step 链路完成恢复；新建任务默认使用 Page Creator Loop。`docs/demo/quality-benchmark-prompts.json` 提供跨学科提示词清单，Demo Gate 只检查目标概念、页面运行证据和交付底线，不检查固定页型或互动模板。`npm run quality:blind` 可把同一提示词的基线与候选课程随机化为 A/B 页面包，人工按知识、教学、视觉、互动、连贯五个维度独立评分。

待真实课程盲测达到任务文档中的门槛后，再删除旧 Page Writer、HTML Engineer、Repair、DSL 投影与模板兼容字段，不长期维护两套生产协议。
