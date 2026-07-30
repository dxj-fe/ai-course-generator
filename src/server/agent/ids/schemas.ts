export const SchemaIds = {
  CourseArchitectInputV1: "course.architect.input.v1",
  CourseArchitectureV1: "course.architecture.v1",
  CourseDirectorInputV1: "course.director.input.v1",
  CourseDirectorDecisionV1: "course.director.decision.v1",
  CoursePageBuilderInputV1: "course.page-builder.input.v1",
  CoursePageSubmissionV1: "course.page-submission.v1",
  CourseReviewerInputV1: "course.reviewer.input.v1",
  CourseReviewV1: "course.review.v1",
} as const;

export type SchemaId = (typeof SchemaIds)[keyof typeof SchemaIds];
