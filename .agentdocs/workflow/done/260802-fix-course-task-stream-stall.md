# 修复建课任务无响应

## 问题现状

- 浏览器在课程架构刚被接受后收到 `page-01` 增量事件，但客户端最近快照仍没有页面，`CourseGenerationStateSchema` 拒绝合并并主动关闭 SSE。
- SSE 同进程 EventBus 与跨进程持久化轮询都可能先发送增量事件、后发送包含新页面结构的快照，违反客户端合并前提。
- 本次任务的 Page Writer 对 `page-04`、`page-05` 连续返回不符合草稿 Schema 或业务质量约束的结果；结构化生成只要求无约束 JSON，模型没有拿到 JSON Schema。
- Page Builder 把 `SCHEMA_ERROR` 当作可无限交还 Agent 的失败，最终分别重复调用内容生成 16 次和 20 次并耗尽工具预算，任务以 `AGENT_TOOL_BUDGET_EXCEEDED` 失败。

## 目标与验收

- [x] SSE 在页面结构切换时先建立可合并的页面基线，客户端不再因合法的新页面事件关闭连接。
- [x] 结构化模型调用把当前 Zod Schema 作为生成约束传给模型，同时保留本地二次校验与可选归一化能力。
- [x] Page Builder 的模型步骤失败有明确重试上限，Schema/供应商异常不会循环到耗尽整份工具预算。
- [x] 补充单元与 Route 集成回归测试，并通过项目 lint、typecheck、build 和相关测试。

## 实施阶段

### 阶段一：复现与根因确认

- [x] 核对浏览器错误、终端日志与 SQLite 中的任务、事件、工作单和工具调用。
- [x] 确认事件 8 首次引用 `page-01`，而客户端只有事件 1–7 的无页面快照。
- [x] 确认 `page-04`、`page-05` 的内容生成循环分别达到 16 次和 20 次。

### 阶段二：修复协议与生成可靠性

- [x] 修正 EventBus 和 durable poll 的快照/增量顺序。
- [x] 在 SSE 发送边界发现未知页面事件时，从 durable state 补齐结构快照。
- [x] 让结构化输出使用 Schema 约束。
- [x] 限制同一模型步骤的无产物重试次数。

### 阶段三：验证与文档回顾

- [x] 增加并运行回归测试，共 100 项相关测试通过。
- [x] 通过 `lint`、Prompt lint、TypeScript、生产构建和 diff 格式检查。
- [x] 更新架构文档中的 SSE 顺序和模型失败策略，并归档本任务文档。

## 验证说明

- 完整测试共 839 项通过；另有 2 项既有测试因仓库缺少 `docs/demo/quality-benchmark-prompts.json` 与 Demo baseline 文件失败，与本次改动无关。
