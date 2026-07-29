# Directory Structure

项目使用 `src/` 形式的 Next.js App Router。Route 层保持薄，产品 UI、客户端数据层、服务端 AI 编排和共享协议分别放置。

```text
ai-course-generator/
├── src/
│   ├── app/
│   │   ├── api/                    # Route Handlers
│   │   │   ├── courses/           # task、history、detail、export
│   │   │   ├── pages/             # Writer、Assets、HTML、QA
│   │   │   ├── references/        # txt/md/pdf 解析
│   │   │   └── previews/          # 临时预览
│   │   ├── chat/                   # 产品课程创建
│   │   ├── course/                 # 历史与持久播放器
│   │   ├── preview/                # 临时诊断预览
│   │   └── templates/              # 模板目录
│   ├── components/
│   │   ├── ui/                     # 本地 shadcn/ui primitives
│   │   └── site-header.tsx
│   ├── config/                     # 环境变量与模型配置
│   ├── features/
│   │   ├── keya/                   # 当前产品 UI 与 Task Controller
│   │   ├── course-planner/         # API clients、SSE hook、数据适配
│   │   └── template-gallery/       # 模板目录
│   ├── server/
│   │   ├── agents/                 # 专业 Agent
│   │   ├── ai/                     # Provider、模型路由、错误与缓存
│   │   ├── courses/                # 课程历史与导出服务
│   │   ├── langgraph/              # 生产 Graph、nodes、stream mapper
│   │   ├── prompts/                # 版本化 Prompt library
│   │   ├── quality/                # 确定性检查与 Playwright QA
│   │   ├── repair/                 # Repair 分类和候选应用
│   │   ├── storage/                # SQLite 与文件存储
│   │   ├── tasks/                  # Task lifecycle 与 EventBus
│   │   ├── tools/                  # Skill/Tool adapters
│   │   └── workflows/              # 兼容 Workflow、Worker 和 merge
│   └── shared/
│       ├── course-schema/           # 前后端共享 Zod 合同
│       ├── html-preview/            # HTML 安全与平台运行时协议
│       └── templates/               # 功能/样式模板及 Token
├── scripts/                         # Prompt lint、Demo、质量比较
├── tests/unit/                      # 与 src 层次对应的 Vitest 测试
├── docs/                            # 架构、合同、Demo 和面试资料
├── notes/                           # 每日训练复盘
├── .agentdocs/                      # 手册与交付进度
└── .data/                           # 本地持久化与生成产物（Git ignored）
```

## Placement Rules

- `src/app`：只保留页面装配、Metadata 和 Route Handler；业务规则下沉到 feature/server。
- `src/features/keya`：当前课芽产品组件和 Task Controller，不恢复旧训练面板。
- `src/features/course-planner`：浏览器 API client、SSE hook 和类型化适配，不包含服务端 Agent 规则。
- `src/components/ui`：无业务依赖的可复用控件。
- `src/server/agents`：模型驱动的专业结构化产物，不直接持久化或向 SSE 推送。
- `src/server/langgraph` 与 `src/server/workflows`：编排、路由、合并和恢复；不复制 Agent 业务规则。
- `src/server/tools`：受控副作用与 Registry 查询。
- `src/server/storage`：SQLite、文件和 checkpoint adapter。
- `src/shared`：前后端安全共享的 Schema、常量和协议；不得导入 Node-only 模块。
- `tests/unit`：镜像被测模块路径；真实模型 Demo 与确定性单测分开。

## Dependency Direction

```text
app routes/pages
  → features or server services
  → server agents/workflows/tools/storage
  → shared schemas and contracts
```

- 客户端组件不能导入 `src/server/*`。
- 展示组件不能直接调用业务 API。
- Route Handler 和 Agent/Workflow 是业务规则事实来源。
- Prompt、Provider 密钥和服务器文件路径不能进入共享浏览器类型。
- 优先使用 `@/*` 导入；只有多个领域真正共享时才提升到 `src/shared`。

## Product UI Source of Truth

产品 UI 位于 `src/features/keya`，稳定路由为 `/`、`/chat`、`/course`、`/course/[courseId]` 和 `/templates`。旧训练组件只可作为类型、API 或局部逻辑参考，不能重新挂回产品路由。
