# 课芽 · AI 全栈重前端简历项目

本文提供可直接放入简历的项目描述和七条技术亮点。所有表述均以当前源码、测试和已提交文档为依据；不把设计稿、计划或失败的真实模型 Demo 描述为已验收能力。

## 一句话定位

独立设计并实现课芽 AI 个性化课程生成器，将自然语言需求和参考资料编排为可恢复、可质检、可互动并可导出的多章节 HTML 课程，覆盖 Next.js 复杂前端状态、Node.js 多 Agent 编排、结构化模型输出和生成内容安全交付。

## 技术栈

Next.js 16、React 19、TypeScript、Node.js、LangGraph.js、Vercel AI SDK、Zod、SQLite、SSE、Playwright、Vitest、Tailwind CSS、shadcn/ui。

## 简历投递版

**课芽 · AI 个性化课程生成器｜AI 全栈开发（重前端）**

- 设计异步课程任务与严格 SSE 协议，在 checkpoint 持久化后发布 `snapshot`、公开 `event` 和 `terminal`，支持 `Last-Event-ID` 重放、暂停、恢复与取消，并用 API Client → `useSSETask` → `ChatApp` 隔离传输、业务状态和展示组件。
- 以 Zod 建立 `CourseIntent`、`CoursePlan`、`PageContentDSL`、`QualityReport`、`RepairResult` 和 `CourseGenerationState` 等共享合同，对模型输出、Agent handoff、持久化数据和前端输入进行分层校验，将格式漂移收敛为可定位的阶段错误。
- 将整课生成拆分为全局 Specialist、隔离 Page Worker 和规则型 LangGraph Supervisor；Supervisor 只能从后端计算的合法节点中路由，页面失败可独立重试或从 checkpoint 恢复，避免重跑已完成章节。
- 建立八种功能模板与六种样式模板的独立 Registry：功能模板约束教学结构与互动槽位，样式模板输出 Design Tokens，并通过有界检索只向 Planner 提供相关卡片，兼顾生成稳定性和视觉组合空间。
- 实现图片 Prompt、Provider 调用、内容键缓存、内部素材存储和类型化 fallback，将背景、角色、图标、纹理与 HTML 文本/互动分离；供应商失败时页面仍可通过 CSS、SVG 或占位素材继续交付。
- 构建“确定性合同 + 三视口 Playwright 证据 + 六维模型 QA + 定向 Repair/re-QA”的质量闭环；服务器限定 Repair 的 DSL block 或 HTML 位置，连续无改善时安全停止，避免模型扩大修改范围或自我宣布通过。
- 产品化 `/chat`、`/course` 和持久课程播放器：将任务、课程与会话保存到 SQLite，并在浏览器本地保存学习进度和互动状态，支持历史搜索、断点返回、sandbox HTML 学习和 ZIP 导出；交付包仅包含校验后的课程状态、页面 HTML 与素材清单。

## 七条亮点的证据映射

### 1. SSE 与可恢复长任务

**解决的问题：** 课程生成是长任务，页面刷新、网络断开或单页失败不能等同于取消整门课程。

**技术动作：**

- 服务端持久化 checkpoint 后再发布公共事件。
- SSE 消息只允许 `snapshot`、`event`、`terminal`，业务事件 sequence 同时作为重放游标。
- API client 和 Hook 负责网络协议，`ChatApp` 负责会话、任务与页面状态。

**源码证据：**

- [`course-generation-task-service.ts`](../../src/server/tasks/course-generation-task-service.ts)
- [`course-task-sse.ts`](../../src/server/tasks/course-task-sse.ts)
- [`course-task-event.ts`](../../src/shared/course-schema/course-task-event.ts)
- [`use-sse-task.ts`](../../src/features/course-planner/hooks/use-sse-task.ts)
- [`chat-app.tsx`](../../src/features/keya/chat-app.tsx)

**测试证据：**

- [`course-generation-task-service.test.ts`](../../tests/unit/server/tasks/course-generation-task-service.test.ts)
- [`course-task-sse.test.ts`](../../tests/unit/server/tasks/course-task-sse.test.ts)
- [`course-task-stream.test.ts`](../../tests/unit/features/course-task-stream.test.ts)
- [`course-task-routes.test.ts`](../../tests/unit/app/api/course-task-routes.test.ts)

**边界：** EventBus、活动 runner 和 AbortController 仍是单进程实现，不是分布式任务队列。

### 2. 结构化输出与共享状态合同

**解决的问题：** 模型字段缺失或类型漂移如果直接进入 UI，会在长链路末端变成难定位的运行时错误。

**技术动作：**

- 每个 Agent 只返回一种 Zod Schema 约束的专业产物。
- Agent 输出在合并状态、写 checkpoint 和进入 UI 前重新校验。
- `CourseGenerationState` 统一承载全局产物、页面产物、attempt、错误和公开事件。

**源码证据：**

- [`course-generation-state.ts`](../../src/shared/course-schema/course-generation-state.ts)
- [`intent.ts`](../../src/shared/course-schema/intent.ts)
- [`course-plan.ts`](../../src/shared/course-schema/course-plan.ts)
- [`page-content-dsl.ts`](../../src/shared/course-schema/page-content-dsl.ts)
- [`quality.ts`](../../src/shared/course-schema/quality.ts)
- [`repair.ts`](../../src/shared/course-schema/repair.ts)

**测试证据：**

- [`course-generation-state.test.ts`](../../tests/unit/shared/course-generation-state.test.ts)
- [`page-content-dsl.test.ts`](../../tests/unit/shared/page-content-dsl.test.ts)
- [`repair.test.ts`](../../tests/unit/shared/repair.test.ts)
- [`course-generation-parity.test.ts`](../../tests/unit/server/langgraph/course-generation-parity.test.ts)

**边界：** Schema 能保证结构和有限业务不变量，不能替代对事实正确性、教学质量和视觉质量的验收。

### 3. 多 Agent、Page Worker 与 LangGraph

**解决的问题：** 单个超级 Prompt 同时规划、写作、实现 HTML 和评价自己时，容易出现职责冲突、上下文膨胀、输出截断与粗粒度重试。

**技术动作：**

- 全局层拆分 Intent、Planner、Pedagogy、Story 和 Visual。
- 页面层用 Page Worker 隔离 Writer、Assets、HTML、QA 和 Repair。
- LangGraph Supervisor 只在后端计算的合法动作中路由；业务规则仍由 Agent、Worker、Validator 和 Route Handler 持有。

**源码证据：**

- [`course-graph.ts`](../../src/server/langgraph/course-generation/course-graph.ts)
- [`supervisor-routing.ts`](../../src/server/langgraph/course-generation/supervisor-routing.ts)
- [`course-workers-workflow.ts`](../../src/server/workflows/course-workers-workflow.ts)
- [`course-generation-nodes.ts`](../../src/server/workflows/course-generation-nodes.ts)
- [`supervisor-agent.ts`](../../src/server/agents/supervisor-agent.ts)

**测试证据：**

- [`course-generation-graph.test.ts`](../../tests/unit/server/langgraph/course-generation-graph.test.ts)
- [`supervisor-routing.test.ts`](../../tests/unit/server/langgraph/supervisor-routing.test.ts)
- [`page-worker.test.ts`](../../tests/unit/server/workflows/page-worker.test.ts)
- [`promise-pool.test.ts`](../../tests/unit/server/workflows/promise-pool.test.ts)

**边界：** 多 Agent 增加模型调用、状态和版本维护成本，因此校验、缓存、唯一合法路由和 ZIP 组装等确定性工作不使用 Agent。

### 4. 功能模板与样式模板

**解决的问题：** 模型能生成主题内容，但不能天然保证每页承担明确教学职责或整课视觉一致。

**技术动作：**

- 功能模板定义教学目标、内容槽位、互动和完成条件。
- 样式模板定义颜色、字体、间距、表面、素材和动效 Token。
- Registry 与有界检索让 Planner 看到完整 ID allowlist，但只接收相关模板详情。

**源码证据：**

- [`functional/registry.ts`](../../src/shared/templates/functional/registry.ts)
- [`functional/templates.ts`](../../src/shared/templates/functional/templates.ts)
- [`style/registry.ts`](../../src/shared/templates/style/registry.ts)
- [`style/templates.ts`](../../src/shared/templates/style/templates.ts)
- [`template-skills.ts`](../../src/server/tools/template-skills.ts)

**测试证据：**

- [`functional-templates.test.ts`](../../tests/unit/shared/functional-templates.test.ts)
- [`style-templates.test.ts`](../../tests/unit/shared/style-templates.test.ts)
- [`template-skills.test.ts`](../../tests/unit/server/tools/template-skills.test.ts)
- [`retrieval-skills.test.ts`](../../tests/unit/server/tools/retrieval-skills.test.ts)

**边界：** 模板提供结构和 Token，不直接生成当前主题的最终内容，也不把页面限制成固定 React 组件树。

### 5. 图片素材、缓存与降级

**解决的问题：** 图片生成速度慢、供应商可能失败，而且将文字或互动烘焙进图片会破坏响应式、可访问性和真实交互。

**技术动作：**

- Image Prompt 只生成背景、角色、图标和纹理请求。
- Skill 校验 Provider 结果并保存为内部 URI；缓存按 Prompt、风格、比例和模型身份建立内容键。
- 非取消类失败返回类型化 CSS、SVG 或占位 fallback，任务取消则立即停止后续素材工作。

**源码证据：**

- [`image-prompt-agent.ts`](../../src/server/agents/image-prompt-agent.ts)
- [`generate-image-skill.ts`](../../src/server/tools/generate-image-skill.ts)
- [`asset-cache.ts`](../../src/server/assets/asset-cache.ts)
- [`image-asset-workflow.ts`](../../src/server/workflows/image-asset-workflow.ts)
- [`asset.ts`](../../src/shared/course-schema/asset.ts)

**测试证据：**

- [`image-prompt-agent.test.ts`](../../tests/unit/server/agents/image-prompt-agent.test.ts)
- [`generate-image-skill.test.ts`](../../tests/unit/server/tools/generate-image-skill.test.ts)
- [`asset-cache.test.ts`](../../tests/unit/server/assets/asset-cache.test.ts)
- [`image-asset-workflow.test.ts`](../../tests/unit/server/workflows/image-asset-workflow.test.ts)

**边界：** 图片结果仍依赖 Provider 质量；当前素材存储是本地文件，不是对象存储和 CDN。

### 6. QA、Repair 与生成 HTML 安全

**解决的问题：** Schema 正确不代表内容好、页面可用或 HTML 安全；让生成 Agent 自评并任意重写会扩大风险。

**技术动作：**

- HTML 先通过结构、安全、DSL marker、素材绑定和互动协议检查。
- QA 结合确定性启发式、三个固定视口的 Playwright 证据和模型判断，产出六维报告。
- 服务器根据 issue 分类 Repair scope；候选重新通过原合同和 re-QA，连续三次无改善则停止。

**源码证据：**

- [`page-quality.ts`](../../src/server/quality/page-quality.ts)
- [`playwright-screenshot.ts`](../../src/server/quality/playwright-screenshot.ts)
- [`qa-repair-loop.ts`](../../src/server/workflows/qa-repair-loop.ts)
- [`repair-candidate.ts`](../../src/server/repair/repair-candidate.ts)
- [`html-engineer-agent.ts`](../../src/server/agents/html-engineer-agent.ts)

**测试证据：**

- [`page-quality.test.ts`](../../tests/unit/server/quality/page-quality.test.ts)
- [`playwright-screenshot.test.ts`](../../tests/unit/server/quality/playwright-screenshot.test.ts)
- [`qa-repair-loop.test.ts`](../../tests/unit/server/workflows/qa-repair-loop.test.ts)
- [`repair-agent.test.ts`](../../tests/unit/server/agents/repair-agent.test.ts)
- [`html-preview-frame.test.tsx`](../../tests/unit/features/html-preview-frame.test.tsx)

**边界：** QA 是工程质量门槛，不替代学科专家、人工审美或生产发布审批。

### 7. 产品化课程历史、播放器与 ZIP 导出

**解决的问题：** 生成结果如果只存在聊天内存中，就无法恢复、检索、持续学习或形成可交付产物。

**技术动作：**

- SQLite 保存课程、任务、会话和有时效预览；播放器用浏览器 `localStorage` 保存当前设备的学习进度、互动状态与朗读偏好。
- `/course` 提供历史搜索和状态筛选，`/course/[courseId]` 提供安全播放器、学习状态和导出。
- 完成课程导出 `course.json`、逐页 HTML 与不包含私有 Agent 数据的素材清单。

**源码证据：**

- [`course-history-service.ts`](../../src/server/courses/course-history-service.ts)
- [`course-export.ts`](../../src/server/courses/course-export.ts)
- [`course-library.tsx`](../../src/features/keya/course-library.tsx)
- [`interactive-course-player.tsx`](../../src/features/keya/interactive-course-player.tsx)
- [`course-player-model.ts`](../../src/features/keya/course-player-model.ts)

**测试证据：**

- [`course-history-service.test.ts`](../../tests/unit/server/courses/course-history-service.test.ts)
- [`course-export.test.ts`](../../tests/unit/server/courses/course-export.test.ts)
- [`course-library.test.tsx`](../../tests/unit/features/course-library.test.tsx)
- [`interactive-course-player.test.tsx`](../../tests/unit/features/interactive-course-player.test.tsx)
- [`course-player-model.test.ts`](../../tests/unit/features/course-player-model.test.ts)

**边界：** 当前没有用户账号、租户权限、对象存储、发布审批和线上 SLA。

## 禁止使用的表述

- “上线后提升学习效率 XX%”：没有真实用户实验和统计证据。
- “支持海量并发”：任务执行和 EventBus 仍是单进程实现。
- “真实模型 Demo 已全部通过”：仓库中两次正式记录均失败。
- “自研大模型”或“训练模型”：项目使用 OpenAI-compatible Provider，没有训练基础模型。
- “完全自动保证课程正确”：QA 不能替代学科专家和人工发布验收。
- “企业级权限/多租户”：当前没有账号和租户隔离。

## 推荐链接

- [GitHub 仓库](https://github.com/dxj-fe/ai-course-generator)
- [项目 README](../../README.md)
- [逐条面试深挖](./interview-deep-dive.md)
- [截图与证据清单](./screenshots.md)
- [3 / 8 / 15 分钟项目讲解](../interview-story.md)
