export const AgentIds = {
  CourseArchitect: "curriculum-architect",
  CourseDirector: "course-director",
  CoursePageBuilder: "page-builder",
  CourseReviewer: "course-reviewer",
} as const;

export type AgentId = (typeof AgentIds)[keyof typeof AgentIds];
