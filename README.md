# 课芽 AI 课程生成器

课芽是一个基于 Next.js、React、AI SDK 与 SQLite 的全栈课程生成应用。用户在 `/chat` 提交学习需求，Course Lead、并行 Page Creator 与 Course Reviewer 通过共享 WorkOrder 和 Artifact 协作生成可交互课程，并在 `/course` 中持续保存和播放结果。

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
pnpm run browser:install
cp .env.local.example .env.local
pnpm dev
```

所有文本 Agent 固定使用 Volcengine Ark 的 Doubao Seed 2.0 Pro（`doubao-seed-2-0-pro-260215`），避免在排障期间混入 mini/lite 的能力差异：

```dotenv
ARK_API_KEY=your_key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

图片生成是 Page Creator 按需调用的 Tool，默认复用 Ark，也可完整设置 `IMAGE_*`。`pnpm dev` 会同时启动 Web 与 Course Worker；后者独立持有 Agent Loop、Chromium 和任务恢复。部署时也可分别运行 `pnpm run start:web` 与 `pnpm run worker:course`。

## 生成流程

1. `/chat` 创建任务并入队，Web 进程立即返回。
2. Course Worker 预检 Doubao 2.0 Pro 与 Chromium 后领取任务。
3. Course Lead 设计课程蓝图，并按依赖关系派发并行 Page Creator。
4. Page Creator 在 Agent Loop 中自由制作 HTML，按需调用生图与浏览器检查 Tool。
5. Course Reviewer 通过真实渲染截图、DOM、控制台和互动结果进行独立审查。
6. Course Lead 决定发布或定向返工；运行环境故障只释放执行权并保留检查点。

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
