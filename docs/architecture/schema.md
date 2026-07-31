# 共享协议

共享 Zod Schema 位于 `src/shared/course-schema`，是 Route、Agent 工具、数据库投影和前端状态的共同合同。

## 主要协议

- `CourseCreationBrief`：用户确认后的课程需求。
- `CourseTaskRecord`、`CourseTaskStreamMessage`：任务控制与 SSE。
- `CourseArchitecture`：事实底稿、课程蓝图和页面任务。
- `PageContentDSL`：页面内容、互动、布局与运行时。
- `HtmlOutput`：完整 HTML、生成时间和 `revision`。
- `QualityReport`：规则检查、模型评分与三视口截图证据。
- `CourseRun`、`WorkOrder`、`CourseArtifact`：持久化编排协议。
- `CourseManifest`、`CourseReview`：整课封口与审查。
- `CourseGenerationState`：面向产品的当前投影。

## 约束

- 所有服务边界先解析再使用，持久化读取也必须重新解析。
- Schema 默认严格拒绝未知字段。
- `PageContentDSL.runtime` 必填；互动完成规则必须与页面互动一致。
- Artifact 使用递增 `revision` 表示同一范围的修订，不用于选择不同协议。
- SSE 游标由 `traceId` 和 `sequence` 组成。
- 公共错误只包含稳定错误码与可公开消息。

JSON 示例位于 `src/shared/course-schema/examples`，测试会验证示例与当前 Schema 一致。
