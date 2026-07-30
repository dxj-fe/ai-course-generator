export const ContextIds = {
  CourseBrief: "course.brief",
  CourseReferences: "course.references",
  CourseArchitecture: "course.architecture",
  CourseCurrentPages: "course.current-pages",
  CourseReview: "course.review",
  CourseRun: "course.current-run",
} as const;

export type ContextId = (typeof ContextIds)[keyof typeof ContextIds];
