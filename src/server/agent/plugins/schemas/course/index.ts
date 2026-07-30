import { SchemaIds } from "@/server/agent/ids";
import type { SchemaDefinition } from "@/server/agent/types/schema";

export const courseSchemaDefinitions = Object.freeze([
  {
    id: SchemaIds.CourseArchitectInputV1,
    description: "课程架构师可见的 Brief、资料索引和返工上下文。",
  },
  {
    id: SchemaIds.CourseArchitectureV1,
    description: "课程事实、目标、全局规则与 PageTask 的完整合同。",
  },
  {
    id: SchemaIds.CourseDirectorInputV1,
    description: "主 Agent 关键决策回合的 CourseRun 摘要与证据。",
  },
  {
    id: SchemaIds.CourseDirectorDecisionV1,
    description: "接受、退回、局部返工、重规划或发布决策。",
  },
  {
    id: SchemaIds.CoursePageBuilderInputV1,
    description: "单页职责、完整课程上下文、资料和依赖摘要。",
  },
  {
    id: SchemaIds.CoursePageSubmissionV1,
    description: "页面内容、素材、HTML、质量和摘要 Artifact 引用。",
  },
  {
    id: SchemaIds.CourseReviewerInputV1,
    description: "冻结 manifest 与全部当前页面受控证据。",
  },
  {
    id: SchemaIds.CourseReviewV1,
    description: "目标覆盖、跨页问题、证据和发布判断。",
  },
] satisfies readonly SchemaDefinition[]);
