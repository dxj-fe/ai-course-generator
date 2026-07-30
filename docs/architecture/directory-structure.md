# 当前目录结构

项目使用 Next.js App Router，并按“可复用能力 + 少量业务目录”组织服务端。当前源码已经退出全局 `storage`、`prompts`、`tools`、`workflows`、`model-steps` 等技术型一级目录。

```text
ai-course-generator/
├── resources/
│   └── agent/
│       └── skills/
│           ├── course-design/
│           │   ├── SKILL.md
│           │   └── references/
│           │       ├── course-structure.md
│           │       └── objective-evidence.md
│           └── course-page-design/
│               ├── SKILL.md
│               ├── agents/openai.yaml
│               └── references/
│                   ├── fixed-canvas-composition.md
│                   └── learning-interactions.md
├── scripts/
│   └── course-task-worker.ts
├── src/
│   ├── app/                              # 页面、Route Handler、HTTP/SSE 入站
│   ├── features/                         # 产品 UI 与浏览器端能力
│   ├── server/
│   │   ├── setup/                        # 唯一组合根
│   │   │   ├── agent.ts                  # Registry + Runtime
│   │   │   ├── course-agents.ts          # 课程 Agent handler catalog
│   │   │   ├── skills.ts                 # 项目 Skill Registry
│   │   │   ├── capabilities.ts           # 独立页面能力门面
│   │   │   ├── web.ts                    # Web 服务装配
│   │   │   └── worker.ts                 # Worker 服务装配
│   │   ├── agent/                        # 可复用 Agent 能力中心
│   │   │   ├── ids/                      # Agent/Prompt/Tool/Context/Schema/Skill ID
│   │   │   ├── types/                    # 插件定义合同
│   │   │   ├── registry/                 # 统一代码插件 Registry 与 Agent Catalog 门面
│   │   │   ├── runtime/                  # Executor、Runner、预算、权限、Tool 执行
│   │   │   ├── skill/                    # Agent Skills 发现、校验、会话与安全解析
│   │   │   └── plugins/
│   │   │       ├── agents/course/        # 四类 Agent 定义与 handler
│   │   │       ├── contexts/course/      # 只读 WorkOrder Context
│   │   │       ├── prompts/course/       # 顶层 Agent 与 Model Step Prompt
│   │   │       ├── schemas/course/       # Agent 私有 Schema 注册
│   │   │       ├── tools/course/         # 课程 Agent 可执行 Tool
│   │   │       ├── tools/system/         # Skill Harness + read_local_resource
│   │   │       └── model-steps/course/   # Agent 内部专业模型步骤
│   │   ├── course/                       # 完整课程业务
│   │   │   ├── gate/                     # Architecture/Page/Review Gate
│   │   │   ├── policy/                   # Run、返工、阻塞授权
│   │   │   ├── run/                      # Engine、Command、Lease、Tool Ledger
│   │   │   ├── store/                    # Course/Task/Run/WorkOrder/Artifact Store
│   │   │   ├── task/                     # Task 生命周期、恢复、SSE
│   │   │   ├── projection/               # 公开状态和事件投影
│   │   │   ├── stream/                   # Durable 公开事件读取
│   │   │   ├── page/                     # 页面质量、Repair plan、Fallback
│   │   │   ├── service/                  # 设计、历史、导出
│   │   │   └── legacy/                   # 只读历史格式适配
│   │   ├── conversation/                 # 会话 Store 与 Service
│   │   ├── preview/                      # HTML Preview Store
│   │   ├── reference/                    # 上传资料解析
│   │   └── infra/                        # 无课程业务语义的基础能力
│   │       ├── ai/                       # Client、Provider、Router、Cache、错误
│   │       ├── database/                 # SQLite connection 与 codec
│   │       ├── file/                     # 安全文件读取和生成素材
│   │       ├── browser/                  # Playwright 页面证据
│   │       └── concurrency/              # Promise Pool
│   └── shared/                           # 浏览器/服务端共享的纯 Schema、协议与投影
│       ├── course-schema/
│       └── course-view/                  # CourseState → Keya 只读视图
├── tests/
│   ├── fixtures/
│   ├── provider-spike/
│   └── unit/
└── .agentdocs/                            # AI 代理使用的任务与架构记忆
```

## 放置规则

- `src/app` 只做请求解析、响应映射和页面装配；Route 通过 `server/setup` 取得服务，不直接创建 Store 或 Agent。
- `src/server/agent` 是所有业务可复用的 Agent 基础设施；业务 Agent 作为代码插件注册，不能在业务目录另建私有 Runtime。
- `src/server/agent/plugins/agents/course` 只放拥有独立 WorkOrder、工具选择和持久化终态的顶层 Agent。
- `src/server/agent/plugins/model-steps/course` 放顶层 Agent 内部的一次专业模型调用。Model Step 没有独立 WorkOrder，不命名为 Agent。
- `src/server/course` 拥有 CourseRun、WorkOrder、Artifact、Gate、Policy、Task 和课程 Store 等课程语义。
- `src/server/infra` 只放跨业务基础能力，不出现 CourseRun、WorkOrder、Page Gate 等业务概念。
- `resources/agent/skills` 只放产品内部 Agent 的运行时 Skill 资源；产品 Runtime 不扫描 `.codex/skills`、`.agents/skills` 或其他开发代理目录。
- `src/shared` 不能导入 `src/server`，也不能包含 Prompt、私有 Agent Context、Provider 凭据或服务器文件路径。
- 不恢复固定生课 `workflow` 目录。Course Engine 根据持久化 WorkOrder 的 `agentId` 动态执行。

## 依赖方向

```text
app / worker
  → setup
  → course + conversation + preview + reference
  → agent executor / registered plugins
  → infra
  → shared

resources/agent/skills
  → agent/skill registry
  → read_local_resource
  → 获授权的产品 Agent Session
```

关键边界：

1. `course` 依赖通用 `AgentExecutor`，不按具体 Agent 名称分支。
2. Agent Tool 不能绕过 Course Command/Repository 直接写业务事实。
3. Agent 只通过 `read_local_resource` 渐进读取定义中声明的 Skill 子树。
4. Director 只提交结构化 Action Proposal；Policy、Gate 和 Repository 负责确定性授权与原子提交。
5. Gate 负责安全、合同和明确交付错误；主观评分只是观测目标，不自动触发 Repair。
6. Repair 只处理有精确证据的局部异常，不是普通页面生成的必经步骤。

## 命名规则

- 目录与 TypeScript 文件统一使用 kebab-case；一级目录使用单数能力名。
- 目录已经表达上下文时，文件名不重复目录名，例如 `course/run/engine.ts`、`course/store/artifact.ts`。
- Agent 定义使用角色名，如 `architect.ts`；执行 handler 使用 `architect-handler.ts`。
- Agent 定义中的 `tools` 和 `runtime` 是新 WorkOrder 权限与预算的默认事实来源；业务只能通过统一 Agent Catalog 读取，不能再复制 `*_TOOLS` 或 `*_BUDGET` 常量。特定 WorkOrder 可以按策略收窄，不能扩权。
- Tool 使用职责或动宾名，如 `retrieval.ts`、`generate-image.ts`；注册 ID 只引用 `agent/ids` 常量。
- Prompt 使用 `角色.消息类型.vN.md`，如 `architect.system.v1.md`。
- Model Step 使用 `*-model-step.ts`，避免与顶层 Agent 混淆。
- `index.ts` 只做稳定导出；组合与依赖创建只放 `setup`。
- 单文件不超过 1000 行，接近上限时按职责拆分，不使用 `part-1.ts` 之类无语义命名。
- Agent Skill 必须遵循开放规范：目录名与 `SKILL.md` frontmatter `name` 一致，详细资料按需放入 `references/`。
- Agent 定义中的 `skills` 决定当前 Session 可见和可读的 Skill。统一 Skill Harness 会完整加载已触发 Skill 的 `SKILL.md` 核心说明，Agent 仍只能通过 `read_local_resource` 渐进读取获授权的 `references/`；已读内容必须进入真正执行创作的 Model Step Context，不能只停留在顶层工具消息中。

## 后台运行

Next 启动钩子只执行一次恢复扫描。常驻部署需要同时运行：

```bash
npm run worker:course
```

Worker 和 Web 使用同一套 `setup` 组合入口与持久化事实；没有常驻进程的平台需要外部调度，不能把 Next `after()` 或启动扫描当作耐久队列。
