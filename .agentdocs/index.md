# 项目文档索引

## 当前架构

`../docs/architecture/README.md` - 系统边界、核心实体与运行原则，修改后端结构前必读。

`../docs/architecture/generation-flow.md` - 当前课程生成全链路，修改编排、页面生成或发布流程前必读。

`../docs/architecture/multi-agent.md` - Agent 角色、工作单、证据 Gate 与恢复规则，修改 Agent 或工具前必读。

`../docs/architecture/schema.md` - 当前共享协议与约束，修改 Schema 或 API 前必读。

## 前端

`../docs/product/ui-integration.md` - Keya 产品入口、能力地图和界面约束，修改前端时必读。

`../docs/operations/html-preview-security.md` - HTML 合同、沙箱和浏览器 QA，修改预览或播放器时必读。

## 运行与模板

`../docs/operations/reliability-and-cost.md` - 模型路由、执行预算、质量与本地数据约束。

`../docs/templates/functional.md` - 功能模板选择与扩展规则。

`../docs/templates/style.md` - 样式模板与设计 token 规则。

## 全局重要记忆

- 产品 UI 只使用 `src/features/keya` 与当前产品路由。
- 课程任务、Prompt、Schema 和数据库只维护当前合同，不按历史标识分流。
- Artifact 与 HTML 的 `revision` 只表示不可变产物的递增修订。
