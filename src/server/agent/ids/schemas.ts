export const SchemaIds = {
  CourseArchitectInput: "course.architect.input",
  CourseArchitecture: "course.architecture",
  CourseDirectorInput: "course.director.input",
  CourseDirectorDecision: "course.director.decision",
  CoursePageBuilderInput: "course.page-builder.input",
  CoursePageSubmission: "course.page-submission",
  CourseReviewerInput: "course.reviewer.input",
  CourseReview: "course.review",
} as const;

export type SchemaId = (typeof SchemaIds)[keyof typeof SchemaIds];
