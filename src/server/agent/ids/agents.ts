export const AgentIds = {
  /** 新生产链路中的主 Agent；沿用旧规划 Agent 的持久化 ID。 */
  CourseLead: "curriculum-architect",
  /** @deprecated 仅保留源码与历史 WorkOrder 兼容。 */
  CourseArchitect: "curriculum-architect",
  /** @deprecated 仅恢复已经持久化的旧 Director WorkOrder。 */
  CourseDirector: "course-director",
  CoursePageBuilder: "page-builder",
  CourseReviewer: "course-reviewer",
} as const;

export type AgentId = (typeof AgentIds)[keyof typeof AgentIds];
