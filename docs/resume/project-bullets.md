# 课芽 · AI 全栈重前端简历项目

本文提供可以直接放入简历的项目描述。所有表述以当前 `agent-v2` 源码和测试为准，不把历史 LangGraph、已删除的假 Agent 或尚未验证的线上指标写成当前能力。

## 一句话定位

独立设计并实现课芽 AI 个性化课程生成器，将一句自然语言需求和参考资料编排为可恢复、可质检、可互动并可导出的多章节 HTML 课程，覆盖 Next.js 产品状态、真实多 Agent 协作、结构化生成、SQLite 耐久任务和生成内容安全交付。

## 技术栈

Next.js 16、React 19、TypeScript、Node.js、Vercel AI SDK `ToolLoopAgent`、Zod、SQLite、SSE、Playwright、Vitest、Tailwind CSS、shadcn/ui。

## 简历投递版

**课芽 · AI 个性化课程生成器｜AI 全栈开发（重前端）**

- 设计 `Architect → Director → Page Builder × N → Reviewer → Director` 的四角色协作协议：Architect 一次提交整课目标和全部页面任务，Director 语义验收后原子派工，页面按真实生成依赖分 wave 并行，整课 Review 后再发布或定向返工。
- 基于 `CourseRun + WorkOrder + immutable Artifact` 构建 SQLite 耐久运行时，为每次 Agent 回合封口输入、限制工具与预算，并用数据库 lease、版本围栏、原子命令和 current 指针支持崩溃接管、局部重试和失效传播。
- 用 AI SDK `ToolLoopAgent` 实现真正的工具循环；将旧 Writer、Image Prompt、HTML、QA、Repair 收敛为 Page Builder 可选的 Model Steps，机械派工、依赖检查、并发、验收和状态迁移全部交给 TypeScript 引擎。
- 建立 Architecture Gate、Page Gate、Course Reviewer 和 Final Gate 四级质量边界；单页检查 DSL、素材、HTML 安全、互动和三视口证据，整课检查目标覆盖、重复、断层、难度与一致性，旧 Review 不能发布新页面。
- 设计严格 SSE 协议，在持久化后发布 `snapshot`、allowlist `event` 和 `terminal`，支持断线重放、暂停、恢复和取消；通过只读 Projector 将 agent-v2 事实映射回现有 Keya `/chat`、`/course` 和课程播放器。
- 实现图片 Provider、内容键缓存、内部素材存储和类型化 fallback，并用 HTML 合同、危险 URL/脚本拦截、受限 iframe 与平台互动运行时隔离模型生成内容。
- 增加显式 `course-task-worker` 扫描 queued/running 任务并原子领取过期 lease；Next 启动扫描仅作为一次恢复快路径，部署时明确要求常驻 worker 或外部调度，不把 `after()` 描述成耐久队列。

## 七条亮点的证据映射

### 1. 真正的多 Agent 协作

**解决的问题：** 固定模型流水线即使有很多“Agent”名字，也没有主从派工、产物验收和最小返工边界。

**技术动作：**

- Architect 从全局产出完整 `CourseArchitecture`，包含 CoursePack、CourseBlueprint 和全部 PageTask。
- Director 只在架构提交和整课 Review 后运行短回合，不充当每步过场 Supervisor。
- Director 接受架构与创建恰好 N 张 Page WorkOrder 在同一事务完成。
- Reviewer 只评价冻结 manifest，不直接修改页面或发布。

**源码证据：**

- [`curriculum-architect-agent.ts`](../../src/server/agent/plugins/agents/course/architect-handler.ts)
- [`course-director-agent.ts`](../../src/server/agent/plugins/agents/course/director-handler.ts)
- [`page-builder-agent.ts`](../../src/server/agent/plugins/agents/course/page-builder-handler.ts)
- [`course-reviewer-agent.ts`](../../src/server/agent/plugins/agents/course/reviewer-handler.ts)
- [`director-round-commit.ts`](../../src/server/course/run/director-round-commit.ts)

**测试证据：**

- [`curriculum-architect-agent.test.ts`](../../tests/unit/server/course-generation/curriculum-architect-agent.test.ts)
- [`course-director-agent.test.ts`](../../tests/unit/server/course-generation/course-director-agent.test.ts)
- [`page-builder-agent.test.ts`](../../tests/unit/server/course-generation/page-builder-agent.test.ts)
- [`course-reviewer-agent.test.ts`](../../tests/unit/server/course-generation/course-reviewer-agent.test.ts)

### 2. WorkOrder 与不可变产物

**解决的问题：** 一个不断覆盖的整课 JSON 无法可靠表达“谁基于哪一版输入，交了哪一版产物，以及谁接受了它”。

**技术动作：**

- `CourseRun` 保存当前架构、页面、Review、stale 标记和整课 lease。
- `WorkOrder` 保存 Agent scope、封口输入、依赖、工具权限、预算、attempt、lease 和提交。
- `Artifact` 创建后不原地覆盖，current 指针只在 Gate 和事务通过后切换。
- Repository 命令负责原子派工、页面接受、依赖解锁、返工和发布。

**源码证据：**

- [`course-run.ts`](../../src/shared/course-schema/course-run.ts)
- [`work-order.ts`](../../src/shared/course-schema/work-order.ts)
- [`course-artifact.ts`](../../src/shared/course-schema/course-artifact.ts)
- [`course-run-repository.ts`](../../src/server/course/store/repository.ts)
- [`course-run-commands.ts`](../../src/server/course/run/commands.ts)

**测试证据：**

- [`course-run-repository.test.ts`](../../tests/unit/server/course-generation/course-run-repository.test.ts)
- [`course-run-commands.test.ts`](../../tests/unit/server/course-generation/course-run-commands.test.ts)
- [`course-run-engine.test.ts`](../../tests/unit/server/course-generation/course-run-engine.test.ts)

**边界：** `ToolOperation` 当前记录工具输入哈希、安全摘要和 ArtifactRef，用于审计；它不是通用 exactly-once 或自动 tool replay 层。

### 3. 依赖感知的页面并行

**解决的问题：** 全并行时页面互相不知道实际结果；全串行又浪费时间并扩大失败范围。

**技术动作：**

- `PageTask.order` 控制学习顺序，`buildDependsOnPageIds` 单独控制生成依赖。
- 无依赖页同 wave 并行，依赖页等待上游 Page Gate 通过。
- 上游只向后继页交付受控 `PageSummary` 和 ArtifactRef，不传整份 HTML。
- 修页时只失效目标页和真实依赖它们的传递后继页。

**源码证据：**

- [`course-run-engine.ts`](../../src/server/course/run/engine.ts)
- [`course-run-page-operations.ts`](../../src/server/course/run/page-operations.ts)
- [`course-revision-commands.ts`](../../src/server/course/run/revision-commands.ts)
- [`page-summary.ts`](../../src/shared/course-schema/page-summary.ts)
- [`promise-pool.ts`](../../src/server/infra/concurrency/pool.ts)

### 4. ToolLoopAgent 与 Model Step 分层

**解决的问题：** 一次模型请求包装成类并不等于 Agent；同时也不需要让每个专业生成步骤都成为独立 Agent。

**技术动作：**

- AgentRunner 统一工具 allowlist、原子预算、终态校验、错误分类和暂时性 Provider fallback。
- 四个 Agent 接收独立 WorkOrder，并可根据工具结果继续、修订、提交或阻塞。
- Page Writer、Image Prompt、HTML、QA 和 Repair 作为 `model-steps` 复用，不拥有派工权或 CourseRun 写权限。
- Agent 返回文字不算完成，运行层重新读取 Repository terminal 状态确认交付。

**源码证据：**

- [`runner.ts`](../../src/server/agent/runtime/runner.ts)
- [`budget.ts`](../../src/server/agent/runtime/budget.ts)
- [`page-builder.ts`](../../src/server/agent/plugins/tools/course/page-builder.ts)
- [`model-steps`](../../src/server/agent/plugins/model-steps/course)

**测试证据：**

- [`runner.test.ts`](../../tests/unit/server/agent/runtime/runner.test.ts)
- [`budget.test.ts`](../../tests/unit/server/agent/runtime/budget.test.ts)
- [`model-step.test.ts`](../../tests/unit/server/model-steps/model-step.test.ts)

### 5. 两层课程质量与 HTML 安全

**解决的问题：** 单页格式正确不代表整课可学；让生成者自评通过也无法防止重复、断层或旧版本混入发布。

**技术动作：**

- Architecture Gate 在生成前检查目标覆盖、页面职责、引用、模板和无环依赖。
- Page Gate 验证 DSL、素材、HTML 合同、安全、互动、反馈和质量证据。
- Reviewer 基于冻结 manifest 检查跨页语义，Director 决定修页或重规划。
- Final Gate 从 current 指针重建 manifest，拒绝 stale 页面和过期 Review。

**源码证据：**

- [`architecture-gate.ts`](../../src/server/course/gate/architecture.ts)
- [`page-gate.ts`](../../src/server/course/gate/page.ts)
- [`course-review-gate.ts`](../../src/server/course/gate/review.ts)
- [`page-quality.ts`](../../src/server/course/page/quality/report.ts)
- [`html-preview`](../../src/shared/html-preview)

**测试证据：**

- [`architecture-gate.test.ts`](../../tests/unit/server/course-generation/architecture-gate.test.ts)
- [`page-gate.test.ts`](../../tests/unit/server/course-generation/page-gate.test.ts)
- [`course-review-gate.test.ts`](../../tests/unit/server/course-generation/course-review-gate.test.ts)
- [`html-preview-frame.test.tsx`](../../tests/unit/features/html-preview-frame.test.tsx)

**边界：** 工程 Gate 和模型 Reviewer 不能替代学科专家、人工审美或生产发布审批。

### 6. 耐久任务、恢复与 SSE

**解决的问题：** 课程是长任务，页面刷新、网络断开或 Node 进程退出不应迫使整门课从头再跑。

**技术动作：**

- CourseRun 和 WorkOrder 使用 SQLite lease、过期接管、trace 和版本围栏。
- Task Service 负责旧产品 Task/Course checkpoint 与 agent-v2 Repository 之间的投影。
- SSE 只允许 `snapshot`、公开 `event` 和 `terminal`，支持持久事件游标重放。
- 显式 worker 持续扫描 queued/running Task；Next instrumentation 只做一次启动恢复。

**源码证据：**

- [`course-generation-task-service.ts`](../../src/server/course/task/service.ts)
- [`course-generation-task-recovery.ts`](../../src/server/course/task/recovery.ts)
- [`course-task-sse.ts`](../../src/server/course/task/sse.ts)
- [`course-task-worker.ts`](../../scripts/course-task-worker.ts)
- [`instrumentation.ts`](../../src/instrumentation.ts)

**测试证据：**

- [`course-generation-task-service.test.ts`](../../tests/unit/server/tasks/course-generation-task-service.test.ts)
- [`course-generation-task-recovery.test.ts`](../../tests/unit/server/tasks/course-generation-task-recovery.test.ts)
- [`course-task-sse.test.ts`](../../tests/unit/server/tasks/course-task-sse.test.ts)

**边界：** 持续恢复要求部署 `npm run worker:course` 或等价外部调度；EventBus 仍是单进程实时通知，不是跨实例消息总线。

### 7. Keya 产品交付

**解决的问题：** 生成结果如果只存在模型上下文，就无法恢复、检索、继续学习或安全导出。

**技术动作：**

- `/chat` 负责 Brief、任务创建、公开 Agent 进度和右侧学习空间。
- `/course` 与 `/course/[courseId]` 提供历史、播放器和导出。
- CourseStateProjector 把新运行时投影为现有 UI 合同，前端不依赖 Agent 框架。
- 播放器只加载再次通过合同的 HTML，并通过受限 iframe 和严格消息 Schema 注入平台互动。

**源码证据：**

- [`course-state-projector.ts`](../../src/server/course/projection/state.ts)
- [`chat-app.tsx`](../../src/features/keya/chat-app.tsx)
- [`course-library.tsx`](../../src/features/keya/course-library.tsx)
- [`interactive-course-player.tsx`](../../src/features/keya/interactive-course-player.tsx)
- [`course-export.ts`](../../src/server/course/service/export.ts)

## 禁止使用的表述

- “使用 LangGraph 编排当前课程”：LangGraph 只存在于历史任务 source 值，不是当前运行时。
- “九名 Specialist 都是真 Agent”：专业单步生成已收敛为 Model Step。
- “工具调用完全 exactly-once”：当前只有分层幂等防护和 ToolOperation 审计，外部副作用仍有崩溃窗口。
- “Next `after()` 保证任务恢复”：持续恢复需要显式 worker 或外部调度。
- “支持海量并发”：当前是 SQLite、本地文件和轮询 worker，没有分布式队列或生产 SLA。
- “完全自动保证课程正确”：工程质量和模型 Review 不能替代学科专家及人工审批。
- “真实模型链路已全部验收”：只有配置真实 Provider 后才能验证模型和生图效果。

## 推荐链接

- [项目 README](../../README.md)
- [当前架构入口](../architecture/README.md)
- [从提示词到最终 HTML](../architecture/prompt-to-html-current-flow.md)
- [多 Agent 课程生成架构](../multi-agent-design.md)
