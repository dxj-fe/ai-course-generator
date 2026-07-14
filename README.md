# AI Course Generator

一句话生成一门由多页关联 HTML 组成的课程。当前 Day 14 版本由 HTML Engineer 把 PageContentDSL 实现为自包含单页 HTML，通过服务端合同与安全校验后，在 Seaca 学习工作区和独立预览路由中隔离展示。

## Day 01 交付

- Next.js + React + TypeScript 项目已创建。
- 模型供应商通过 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME` 配置，不在业务代码里硬编码。
- `POST /api/ai/generate` 返回普通文本。
- `POST /api/ai/stream` 返回 AI SDK UI message stream。
- 首页可以输入 prompt，并分别验证普通生成与流式输出。
- 项目已迁移到 `src/` 分层架构，目录规范见 `docs/architecture/directory-structure.md`。

## Day 02 交付

- AI 调用已抽到 `src/server/ai/client.ts`，提供 `generateTextSafe` 和 `streamTextSafe`。
- API 请求支持 `systemPrompt`、`temperature`、`maxTokens` 和 `traceId`。
- 错误响应统一为 `{ code, message, traceId }`，用于前端展示和服务端日志定位。
- Playground 支持编辑 system prompt、切换 temperature、调整 max tokens。
- Day 02 复盘记录见 `notes/day-02.md`。

## Day 03 交付

- 新增 `CourseIntentSchema`，约束 `topic`、`audienceAgeRange`、`courseLength`、`visualStyle`、`difficulty`、`mustInclude`、`avoid` 和 `language`。
- AI Client 新增 `generateStructuredObjectSafe`，通过 AI SDK structured output 生成并校验对象。
- 新增 `POST /api/agents/intent`，把 `userPrompt` 解析为结构化 CourseIntent。
- Playground 增加 CourseIntent JSON 展示，便于观察结构化输出和 schema 错误。
- Day 03 复盘记录见 `notes/day-03.md`。

## Day 04 交付

- Intent Agent 的 system/user Prompt 已迁移到带版本号的 Markdown 模板。
- 新增 `PromptTemplate` 契约与服务端 Prompt Loader，校验缺失变量和未知变量。
- 用户原始需求通过 JSON string 注入，Prompt 明确隔离不可信输入并拒绝角色越权。
- 新增 Prompt Review Checklist、5 个固定 bad case 与 Prompt Loader 单元测试。
- AI 日志只记录 Prompt 长度、版本、traceId、耗时和错误，不记录 Prompt 正文或私有推理过程。

## Day 05 交付

- 新增 Skill 契约和 Skill Registry，执行前后分别校验输入与输出。
- 新增功能模板搜索、样式模板搜索和 CourseIntent 校验三个 Skill。
- 新增 `POST /api/demo/tool-call`，由模型选择工具、后端执行并返回 Tool Result。
- 工具调用日志记录 `toolName`、输入、输出、耗时、成功状态和 `traceId`。
- Day 05 面试复盘见 `notes/day-05.md`。

## Day 06 交付

- 新增最小 `Agent<State>`、AgentState、AgentEvent 和手写循环引擎。
- SinglePageAgent 先调用 Day 5 模板 Tool，再生成结构化 PagePlan 草稿。
- AgentState 包含步骤预算、模板选择、PagePlan、事件和可序列化错误。
- 新增 `POST /api/agents/single-page`，返回最终状态与 Timeline 事件数组。
- Day 06 面试复盘见 `notes/day-06.md`。

## Day 07 交付

- 新增 `Course`、`CourseOutline`、`PagePlan`、`Asset`、`Theme` 和 `QualityReport` Zod Schema。
- `pageType` 明确覆盖封面、故事导入、知识卡、问答、对比、时间线、总结和成就页。
- 核心 Schema 与 TypeScript 类型从 `src/shared/course-schema` 统一导出，前后端共享。
- 为每个核心 Schema 提供受测试保护的 example JSON。
- Course 聚合校验页面顺序与依赖、素材引用和质量报告目标。
- 字段设计与 DSL 边界说明见 `docs/schema.md`，面试复盘见 `notes/day-07.md`。

## Day 08 交付

- 新增共享 `FunctionalTemplateSchema`、五种教学槽位和 Functional Template Registry。
- 实现封面、故事导入、知识卡、对比、时间线、选择题、任务成就和总结 8 个模板。
- 每个 Day 07 `pageType` 都有对应模板和通过 `PagePlanSchema` 的 mock。
- Day 05 `searchFunctionalTemplateSkill` 改为查询共享 Registry，并返回候选、分数和匹配理由。
- 新增 `/templates` TemplateGallery，前端可查看槽位、适用场景、约束和 PagePlan 示例。
- 设计说明见 `docs/templates-functional.md`，面试复盘见 `notes/day-08.md`。

## Day 09 交付

- 新增共享 `StyleTemplateSchema`，覆盖颜色、排版、间距、表面、装饰、动效、密度和素材指导。
- 实现科幻、童趣、极简、自然、黑板和游戏任务六套样式模板。
- 新增 Style Registry，并将 `professional` CourseIntent 兼容映射到 `minimal`。
- 新增 StyleTemplate 到 CSS Variables、CSS 文本和 Day 07 Theme 的转换器。
- Day 05 `searchStyleTemplateSkill` 改为查询共享 Registry 并返回候选、分数和理由。
- 通过测试验证全部 48 种功能模板和样式模板组合。
- `/templates` 新增六张由真实 CSS Variables 驱动的风格预览卡。
- 设计说明见 `docs/templates-style.md`，面试复盘见 `notes/day-09.md`。

## Day 10 交付

- `PagePlanSchema` 新增 `interactionType` 和规划阶段的 `assetNeeds`。
- 新增 `CoursePlanSchema`，约束 3–12 页、连续顺序、合法依赖和“引入—讲解—互动—总结”节奏。
- 新增版本化 Course Planner Prompt 和一步 `CoursePlannerAgent`。
- Planner 使用 Day 08/09 Registry 校验功能模板、pageType、样式模板和全课程视觉一致性。
- 新增 `POST /api/courses/plan`，支持一句话生成 CourseIntent 和 CoursePlan，也支持直接输入 CourseIntent。
- 首页新增 CourseOutlinePanel、PagePlanList、Agent Timeline 和五个固定测试主题。
- 设计决策和八道详细面试题见 `notes/day-10.md`。

## Day 11 交付

- 新增 `PedagogyPlanSchema`、`StoryArcSchema`、`VisualBriefSchema` 和逐页 `PageWorkerBriefSchema`。
- 实现单一职责的 PedagogyAgent、StoryAgent 和 VisualDirectorAgent，并使用独立版本化 Prompt。
- 新增串行 Course Design Workflow，支持失败短路、公开事件聚合、pageId 对齐和 HTML 越界校验。
- Visual Director 引用 Day 09 的真实 StyleTemplate，不复制颜色 Token。
- 新增 `POST /api/courses/design`，消费已完成的 CourseIntent 与 CoursePlan。
- 首页新增教学、故事、视觉三个 Tab、Professional Agent Timeline 和 Page Worker 交接协议检查器。
- 实现说明和八道详细面试题见 `notes/day-11.md`。

## Day 12 交付

- 新增 `PageContentDSLSchema`，覆盖语义 blocks、七类 interaction、assetSlots 和弱 layoutHints。
- 技术 ID、素材槽位和 readingOrder 由确定性代码从 PagePlan 补齐。
- 实现一步 `PageWriterAgent`、版本化 Prompt 和 `POST /api/pages/write`。
- Page Writer 校验 PagePlan、PageWorkerBrief、FunctionalTemplate、互动类型和素材需求的一致性。
- 为八个 FunctionalTemplate 分别提供一份合法 DSL example。
- 首页新增 PageDSLViewer，可选择任一页面生成并检查 DSL，并明确区分未来 HTML 输出。
- 边界设计见 `docs/dsl-boundary.md`，实现说明和八道详细面试题见 `notes/day-12.md`。

## Day 13 交付

- 新增完整文档 `GeneratedHtmlContract`，校验 doctype、html/head/body、viewport 和内联 style。
- 新增 `sanitizeHtmlLite`，拒绝外链脚本、外链 iframe、事件属性、危险 URL、跳转和主动嵌入内容。
- 新增确定性 Day 13 demo builder，从已校验的 PageContentDSL 生成自包含静态 HTML，不提前实现 HtmlEngineerAgent。
- Seaca `/chat` 右侧学习工作区使用 `srcDoc` 和空权限 `sandbox` 展示页面，生成 HTML 不进入主应用 DOM。
- 安全策略见 `docs/html-preview-security.md`，实现说明和详细面试题见 `notes/day-13.md`。

## Day 14 交付

- 新增一步 `HtmlEngineerAgent` 和版本化 Prompt，只消费 PageContentDSL、服务端 Registry 模板与 VisualBrief，不读取原始用户 Prompt。
- 新增 `POST /api/pages/generate-html`，返回完整 `HtmlOutput` 与公开 Agent 事件。
- 模型 HTML 在服务端立即执行完整文档合同、无脚本安全预检和 DSL 稳定标记检查。
- Seaca `/chat` 支持逐页生成、失败重试、上游失效和空权限 iframe 快速预览。
- 新增 `/preview/[previewId]` 独立预览路由；HTML 通过随机 ID 存入重新校验的浏览器临时缓存，不进入 URL。
- 同一 DSL 的 sci-fi、kids-playful、minimal 三风格用例和详细面试复盘见 `notes/day-14.md`。

## 启动

```bash
pnpm install
pnpm dev
```

默认访问地址：

```text
http://localhost:3000
```

如果 `3000` 端口已被占用，Next.js 会提示新的本地端口。

## 环境变量

复制示例文件后填写真实模型配置。当前优先使用火山方舟 / 豆包的 OpenAI-compatible 配置：

```bash
cp .env.local.example .env.local
```

```env
ARK_API_KEY=your_volcengine_ark_api_key
ARK_MODEL_ID=your_doubao_model_id
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

如果没有设置 `ARK_API_KEY`，才会回退到通用 OpenAI-compatible 配置：

```env
MODEL_API_KEY=your_api_key
MODEL_BASE_URL=https://your-openai-compatible-endpoint/v1
MODEL_NAME=your_model_name
```

## API 验收

普通文本接口：

```bash
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"用三句话介绍什么是 AI Agent。"}'
```

Intent Agent 接口：

```bash
curl -X POST http://localhost:3000/api/agents/intent \
  -H "Content-Type: application/json" \
  -d '{"userPrompt":"给 8 岁小朋友做一门太阳系入门课，要有互动问答。"}'
```

Tool Calling Demo：

```bash
curl -X POST http://localhost:3000/api/demo/tool-call \
  -H "Content-Type: application/json" \
  -d '{"pagePurpose":"为 8 岁儿童设计一个互动问答页面"}'
```

SinglePageAgent：

```bash
curl -X POST http://localhost:3000/api/agents/single-page \
  -H "Content-Type: application/json" \
  -d '{"pageGoal":"设计一个太阳系互动问答页面","audience":"8 岁儿童"}'
```

Course Planner Agent：

```bash
curl -X POST http://localhost:3000/api/courses/plan \
  -H "Content-Type: application/json" \
  -d '{"userPrompt":"为 8 岁儿童设计一门 5 页太阳系入门课，包含互动问答，使用科幻风格。"}'
```

Day 11 专业设计工作流（`intent` 与 `outline` 使用 Planner 的真实返回值）：

```bash
curl -X POST http://localhost:3000/api/courses/design \
  -H "Content-Type: application/json" \
  -d '{"intent": {"...": "CourseIntent"}, "outline": {"...": "CoursePlan"}}'
```

Day 12 单页 Page Writer（使用 Planner 和 Day 11 的真实返回值）：

```bash
curl -X POST http://localhost:3000/api/pages/write \
  -H "Content-Type: application/json" \
  -d '{"intent": {"...": "CourseIntent"}, "page": {"...": "PagePlan"}, "brief": {"...": "PageWorkerBrief"}}'
```

Day 14 单页 HTML Engineer（使用 Page Writer 与 Visual Director 的真实返回值）：

```bash
curl -X POST http://localhost:3000/api/pages/generate-html \
  -H "Content-Type: application/json" \
  -d '{"content": {"...": "PageContentDSL"}, "visualBrief": {"...": "VisualBrief"}}'
```

流式接口：

```bash
curl -N -X POST http://localhost:3000/api/ai/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"用三句话介绍什么是 AI Agent。"}'
```

接口也兼容 AI SDK UI messages：

```json
{
  "messages": [
    {
      "id": "1",
      "role": "user",
      "parts": [{ "type": "text", "text": "生成一段课程简介。" }]
    }
  ]
}
```

## 今日截图

![Day 01 homepage](.agentdocs/day-01-home.png)

## 验证命令

```bash
pnpm test
pnpm lint
pnpm build
```
