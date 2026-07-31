# 产品 UI 集成

## 唯一界面

当前产品 UI 位于 `src/features/keya`，路由为 `/`、`/chat`、`/course`、`/course/[courseId]`、`/templates` 和 `/preview/[previewId]`。新增能力必须扩展这些界面，不创建第二套产品壳或替换产品路由。

## 能力地图

| 能力 | 入口 | 展示位置 |
| --- | --- | --- |
| 创建课程 | `/chat` | 对话输入区 |
| 生成进度 | `/chat` | 对话线程中的公开事件 |
| 课程页面与预览 | `/chat` | 右侧学习工作区 |
| 历史课程 | `/course` | 课程卡片列表 |
| 互动学习 | `/course/[courseId]` | 课程播放器 |
| 模板浏览 | `/templates` | 模板目录 |
| 引用上传 | `/chat` | 对话输入附件 |

## 状态规则

- 浏览器端 API 统一放在 `src/features/keya/api`。
- 任务流统一由 `src/features/keya/use-course-task-stream.ts` 管理。
- Agent 事件只显示公开摘要和错误，不显示私有推理。
- 未完成页面显示生成状态，不把内部 Artifact 或 Schema 错误暴露给学习者。
- HTML 只通过 `HtmlPreviewFrame` 或课程播放器加载。
- 样式复用 Keya 组件与现有设计变量，避免引入独立视觉系统。

新增产品表面时更新本表。
