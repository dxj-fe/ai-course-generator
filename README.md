# AI Course Generator

一句话生成一门由多页关联 HTML 组成的课程。当前 Day 01 版本先完成 Next.js 项目、OpenAI-compatible 模型适配层、普通文本接口和最小流式接口。

## Day 01 交付

- Next.js + React + TypeScript 项目已创建。
- 模型供应商通过 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME` 配置，不在业务代码里硬编码。
- `POST /api/ai/generate` 返回普通文本。
- `POST /api/ai/stream` 返回 AI SDK UI message stream。
- 首页可以输入 prompt，并分别验证普通生成与流式输出。
- 项目已迁移到 `src/` 分层架构，目录规范见 `docs/architecture/directory-structure.md`。

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

复制示例文件后填写真实模型配置：

```bash
cp .env.local.example .env.local
```

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
pnpm lint
pnpm build
```
