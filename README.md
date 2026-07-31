# 课芽 AI 课程生成器

课芽是一个基于 Next.js、React、AI SDK 与 SQLite 的全栈课程生成应用。用户在 `/chat` 提交学习需求，系统通过课程架构、页面制作、课程调度和整课审查四类 Agent 生成可交互课程，并在 `/course` 中持续保存和播放结果。

## 产品入口

- `/`：产品首页。
- `/chat`：创建课程、查看公开生成进度和课程工作区。
- `/course`：课程历史。
- `/course/[courseId]`：互动课程播放器。
- `/templates`：功能模板与样式模板目录。
- `/preview/[previewId]`：受控 HTML 预览。

产品界面只使用 `src/features/keya`。服务端任务、会话、历史、预览、素材和引用解析 API 位于 `src/app/api`。

## 本地运行

要求 Node.js 22.5 或更高版本，并使用 pnpm。

```bash
pnpm install
cp .env.local.example .env.local
pnpm dev
```

语言模型按 `cheap`、`balanced`、`strong` 三个档位配置。每个档位必须显式选择 `ark` 或 `generic`，并配置对应模型名：

```dotenv
MODEL_PROVIDER_CHEAP=ark
MODEL_PROVIDER_BALANCED=ark
MODEL_PROVIDER_STRONG=ark

ARK_API_KEY=your_key
ARK_MODEL_ID_CHEAP=your_model
ARK_MODEL_ID_BALANCED=your_model
ARK_MODEL_ID_STRONG=your_model
```

使用通用供应商时，设置 `MODEL_API_KEY`、`MODEL_BASE_URL` 和三个 `MODEL_NAME_*`。图片生成默认复用 Ark，也可完整设置 `IMAGE_*`。

## 生成流程

1. `/chat` 创建任务并建立会话关联。
2. Curriculum Architect 生成课程事实、目标、统一规则与逐页任务。
3. Course Director 按依赖关系派发 Page Builder。
4. Page Builder 依次生成内容 DSL、素材、HTML 和质量证据。
5. Course Reviewer 核对目标覆盖、跨页连贯性和当前封口产物。
6. 通过审查后发布课程；需要返工时只重建受影响的产物链。

任务进度通过带 `traceId + sequence` 游标的 SSE 传输。数据库只接受当前结构，不读取历史格式。

## 验证

```bash
pnpm lint
pnpm run prompt:lint
pnpm test
pnpm build
```

固定 Demo：

```bash
pnpm run demo:run
pnpm run demo:check -- --course .data/course.json --baseline docs/demo/baselines/solar-system.json
```

## 目录

- `src/features/keya`：当前产品界面与浏览器端 API。
- `src/server/agent`：Agent 注册、运行时、Prompt、工具和项目内 Skill。
- `src/server/course`：课程编排、Gate、投影、存储和任务服务。
- `src/shared/course-schema`：前后端共享协议。
- `tests`：单元测试与浏览器集成测试。
- `docs`：当前架构、安全、协议、模板与 Demo 说明。

## 文档

- [架构总览](docs/architecture/README.md)
- [提示词到课程 HTML](docs/architecture/generation-flow.md)
- [多 Agent 设计](docs/architecture/multi-agent.md)
- [共享协议](docs/architecture/schema.md)
- [产品 UI 集成](docs/product/ui-integration.md)
- [可靠性与成本](docs/operations/reliability-and-cost.md)
- [HTML 预览安全](docs/operations/html-preview-security.md)
- [功能模板](docs/templates/functional.md)
- [样式模板](docs/templates/style.md)
