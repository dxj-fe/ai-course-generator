# 后端目录架构重设计

## 背景

当前后端已完成 `agent-v2` 多 Agent 运行时重构，但 `src/server` 仍以全局技术目录为主。课程生成相关代码横跨 `course-generation`、`tasks`、`storage`、`model-steps`、`prompts`、`tools`、`quality`、`repair` 与 `workflows`，新功能的归属、依赖方向和复用边界不够直观。

本任务只设计目标架构与迁移方案，不直接批量移动生产代码。

## 目标

- 建立统一、可注册和可校验的 Agent 能力中心。
- 统一管理 Agent、Prompt、Tool、Context 和输入输出 Schema，并以独立 Skill Registry 管理项目内标准 Agent Skills。
- 让 Agent 成为业务可动态派发的步骤，而不是固定 Workflow 节点。
- 使用简洁工程命名表达代码层次和可复用能力。
- 保留 Next.js App Router、`agent-v2`、SQLite durable facts、SSE 和现有产品 API。
- 给出可以逐步执行、每阶段可验证且可回滚的迁移顺序。

## 非目标

- 本次不直接实施动态派工或改变数据库语义。
- 不在本次设计中引入微服务、消息队列、依赖注入框架或新的测试框架。
- 不为追求目录整齐而一次性重写实现。

## 当前判断

- 项目是 Node.js 22 + Next.js 16 + TypeScript 的模块化单体，不是 Go 服务。
- `src/server` 有 122 个 TypeScript 文件、约 3.6 万行；12 个文件达到 800 行以上，其中 2 个超过 1000 行。
- `course-generation` 已形成核心业务域，但其根目录同时承载 Agent、策略、命令、持久化编排、投影和兼容适配。
- 多数 `model-steps`、`prompts`、`quality`、`repair` 和部分 `tools/workflows` 实际只服务课程生成，却放在全局目录中。
- `storage` 按表/Store 横向展开，业务模块无法独立看见自己的完整持久化边界。
- 当前存在 `html-engineer` 和 `page-writer` 两组文件级循环依赖。
- API Route 直接导入 Store、EventBus 和内部实现，组合根缺失。
- `shared/course-schema` 同时暴露浏览器合同与服务端运行事实，公开边界过宽。

## 用户确认的方向

- Agent 同时可能服务课程、辅助学习等不同业务，不能放在单一课程模块内部。
- 使用统一的 Agent Registry、Agent Runtime 和代码插件目录管理 Agent、Prompt、Tool、Context 及输入输出合同，使用独立 Skill Registry 管理项目运行时 Skill 资源。
- 采用代码启动时静态注册；新增 Agent 需要发版，暂不建设数据库动态插件系统。
- 每名 Agent 只保留一份定义配置；它通过统一 ID 引用已注册的 Prompt、Tool、Context 和 Skill，并显式获得受限本地资源读取 Tool。
- 所有 ID 由类型安全的常量统一管理，业务代码不得硬编码字符串。
- 生课不采用固定 Workflow；Course Director 提议下一步动作，Course Run Engine 与 Gate 校验后原子创建 WorkOrder。
- 顶层使用简洁工程命名：`agent`、`course`、`conversation`、`preview`、`infra`；当前不预建 `learning`。
- 使用 `infra` 表示 AI、数据库、文件和事件等基础能力，不使用 `platform`。
- Agent Skill 必须遵循 Agent Skills 开放规范，是可从外部引入、受项目版本控制的 `SKILL.md` 资源目录，不是 TypeScript 指令插件。
- Skill 专供课芽产品内部 Agent 使用，属于项目运行时资源，不属于开发此仓库的 Codex/Claude 等开发代理资源。
- Skill 统一收录在项目 `resources/agent/skills`，产品 Agent 通过受限本地资源读取 Tool 渐进读取。

正式目标结构与迁移步骤见 `docs/architecture/backend-target-architecture.md`。

## 设计原则

1. Agent 是可注册的通用能力，也是业务运行中的一个动态步骤。
2. Agent Registry 只管理定义与依赖；Agent Runtime 只执行单个 Agent。
3. Course Run Engine 驱动耐久 WorkOrder，不硬编码固定 Agent 链。
4. Director 负责语义提议，Engine、Policy 与 Gate 负责确定性授权。
5. 业务代码通过统一 ID 和 Registry 使用 Agent，不导入插件内部实现。
6. `infra` 只表达无业务语义的基础能力，课程 Store 仍归 `course` 所有。
7. 迁移期间允许兼容导出，但禁止新代码继续写入旧目录。
8. Skill Registry 只扫描 `resources/agent/skills`，并根据 Agent 定义生成可见 Catalog 和文件授权范围。
9. 产品 Agent 通过 `read_local_resource` 渐进读取 Skill；不得扫描开发代理目录或读取任意宿主文件。

## Agent Skill 纠偏

官方 Agent Skills 规范确认：

- Skill 是至少包含 `SKILL.md` 的独立目录；
- 可选携带 `scripts/`、`references/`、`assets/`；
- 启动时只披露 `name`、`description` 和项目逻辑路径；
- Agent 判断相关后通过本地资源读取 Tool 加载完整 `SKILL.md`；
- 引用资料和脚本按需加载，不能启动时全部塞入上下文；
- Skill 规范不强制安装位置，因此产品 Skill 可以固定在项目运行时资源目录；
- 文件读取必须处理目录越界、符号链接、大小预算、重复读取和上下文压缩。

因此继续删除 `agent/plugins/skills` 和 `defineSkill()`，但恢复项目内统一 `SkillIds`；Skill 内容位于 `resources/agent/skills`，代码只负责注册、授权和读取。

## TODO

- [x] 读取项目技术治理与现有架构文档。
- [x] 盘点后端目录、文件规模、入口和当前模块分布。
- [x] 分析跨目录依赖、循环风险和复用错位。
- [x] 完成目标目录树与目录职责设计。
- [x] 完成依赖规则、公开 API 和组合根设计。
- [x] 完成现有目录到目标目录的映射。
- [x] 完成分阶段迁移、验证与回滚方案。
- [x] 更新正式架构文档和索引。
- [x] 按用户确认重写统一 Agent 插件架构。
- [x] 移除固定 Workflow 与旧分层命名。
- [x] 将 Platform 命名和职责调整为 Infra。
- [x] 重新复核并归档。
- [x] 查阅 Agent Skills 官方规范和客户端实现指南。
- [x] 重写 Skill 目录、发现、注册、激活和安全模型。
- [x] 更新 Agent 定义、迁移映射与测试计划。
- [x] 重新复核并归档 Skill 修订。
- [x] 将 Skill 从开发代理安装目录调整到项目运行时资源目录。
- [x] 用受限本地资源读取 Tool 重写渐进披露流程。
- [x] 清理多安装根、Skill Slot 和专用激活 Tool 等不再适用的设计。
- [x] 重新复核并归档项目内 Skill 修订。
