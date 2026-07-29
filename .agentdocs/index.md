# AI 代理文档索引

## 技术治理

`../AGENTS.md` - 项目级代码质量、测试、文档与沟通约束，处理任何开发任务前必读。

## 产品与架构文档

`../docs/ui-integration.md` - 课芽产品界面边界与能力地图，修改或新增前端界面时必读。

`../docs/architecture/prompt-to-html-current-flow.md` - 当前 `/chat` 从一句话到课程 HTML 的真实运行链路，分析生成、质量或故障问题时必读。

## 已完成任务文档

`workflow/done/260728-course-generation-flow-inspector.md` - “一句话生成课程”交互式流程分析页的范围、事实来源、实现记录与验证标准。

## 全局重要记忆

- 当前新课程主链固定通过 `POST /api/courses/tasks` 创建 `source: langgraph` 的异步任务；旧分阶段 API 仅用于兼容和测试。
- 课程每一节独立生成一份 HTML；内容 DSL、素材、HTML、QA 与 Repair 均位于隔离的 Page Worker 边界内。
- 诊断信息可以展示结构化公开状态、源码位置与确定性风险，但不得展示模型私有推理。
