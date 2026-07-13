# AI Course Generator

一句话生成一门由多页关联 HTML 组成的课程。当前 Day 04 版本将 CourseIntent Agent 的 Prompt 升级为可版本化、可测试、可审查的工程资产。

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
