# AI 代理文档索引

## 技术治理

`../AGENTS.md` - 项目级代码质量、测试、文档与沟通约束，处理任何开发任务前必读。

## 产品与架构文档

`../docs/ui-integration.md` - 课芽产品界面边界与能力地图，修改或新增前端界面时必读。

`../docs/architecture/prompt-to-html-current-flow.md` - 当前 `/chat` 从一句话到课程 HTML 的真实运行链路，分析生成、质量或故障问题时必读。

`../docs/architecture/multi-agent-flow.md` - agent-v2 的四类 Agent、WorkOrder 协议、依赖波次、证据闸门、返工与恢复流程，修改课程编排时必读。

`../docs/multi-agent-design.md` - 多 Agent 生课的架构取舍、模块边界和实施原则，评审整体方案或新增角色时必读。

`../docs/architecture/backend-target-architecture.md` - 统一 Agent Registry/Runtime、代码插件目录、项目内 Agent Skills 资源与注册中心、受限本地资源读取、类型安全 ID、动态 Course Run、`course`/`infra` 目录与渐进迁移方案，新增 Agent、引入 Skill 或移动后端模块前必读。

## 当前任务文档

`workflow/260730-implement-backend-refactor.md` - 按目标架构实施后端迁移，并从 Prompt、Tool、Skill、模型路由和 Harness 提升课程一次生成质量。

## 已完成任务文档

`workflow/done/260730-redesign-backend-architecture.md` - 后端目标目录、统一 Agent 能力中心、动态 Course Run 与项目内 Agent Skills 注册中心的设计记录。

`workflow/done/260728-course-generation-flow-inspector.md` - “一句话生成课程”交互式流程分析页的范围、事实来源、实现记录与验证标准。

`workflow/done/260729-refresh-keya-green-theme.md` - 课芽全产品绿色清新卡通主题改造的范围、设计系统、实施边界与验收记录。

`workflow/done/260729-true-multi-agent-refactor.md` - “一句话生成课程”的技术重构依据与实施记录：四类真 Agent、WorkOrder/Artifact、持久化恢复、证据闸门、旧代码迁移和最终并发审计修复。

## 全局重要记忆

- 当前新课程主链固定通过 `POST /api/courses/tasks` 创建 `source: agent-v2` 的异步任务，并持久化结构化 `CourseCreationBrief`；旧 `workflow` / `langgraph` 记录继续可读。
- 课程每一节独立生成一份 HTML；内容 DSL、素材、HTML、QA 与 Repair 均位于隔离的 Page Worker 边界内。
- 诊断信息可以展示结构化公开状态、源码位置与确定性风险，但不得展示模型私有推理。
- 所有用户可见产品壳层统一使用 `src/app/globals.css` 的 `--keya-*` 绿色主题；生成课程 HTML 和样式模板预览保留独立主题，不向 iframe 注入平台样式。
- 产品内部 Agent 的 Skill 只安装在 `resources/agent/skills`，通过 Skill Registry 注册；统一 Skill Harness 完整加载已触发 Skill 的 `SKILL.md`，获授权 Agent 再使用 `read_local_resource` 渐进读取 references。不得扫描 `.codex/skills`、`.agents/skills` 等开发代理目录，也不得开放任意本地文件读取。Skill 不能只在顶层 Agent 消息中展示，已读方法资源必须进入真正执行创作的 Model Step Context。
- 新增 Agent、Prompt、Tool、Context 或 Schema 时，必须声明稳定 ID 并汇总到 `agentPluginCatalog`；课程 Agent 执行实现通过 Handler Catalog 装配，业务和 Engine 不硬编码插件字符串或具体实现分支。Agent 定义中的 `tools` 与 `runtime` 是 WorkOrder 默认权限和预算的唯一来源，Course 只能通过统一 Agent Catalog 读取。
- Agent 的质量分数是观测信号，不是自动返修条件。生产 Gate 只固定安全、Schema、数据一致性和明确交付错误，Repair 只处理可定位的 `error`；warning 或低分应优先回到 Prompt、模型、Skill、Tool 和上下文设计。
- Route 和 Worker 通过 `src/server/setup` 或业务公开门面取能力；`server` 不得依赖 `features`，`shared` 不得依赖 `server`，`app` 不得越过公开门面导入 Agent 插件、Course 内部实现或底层数据库/文件模块。
