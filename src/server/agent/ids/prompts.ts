export const PromptIds = {
  CourseArchitectSystemV1: "course.architect.system.v1",
  CourseDirectorSystemV2: "course.director.system.v2",
  CoursePageBuilderSystemV1: "course.page-builder.system.v1",
  CourseReviewerSystemV1: "course.reviewer.system.v1",
  CoursePedagogySystemV2: "course.model-step.pedagogy.system.v2",
  CoursePedagogyUserV2: "course.model-step.pedagogy.user.v2",
  CourseStorySystemV2: "course.model-step.story.system.v2",
  CourseStoryUserV2: "course.model-step.story.user.v2",
  CourseVisualSystemV2: "course.model-step.visual.system.v2",
  CourseVisualUserV2: "course.model-step.visual.user.v2",
  CoursePageWriterSystemV3: "course.model-step.page-writer.system.v3",
  CoursePageWriterUserV3: "course.model-step.page-writer.user.v3",
  CourseImagePromptSystemV2: "course.model-step.image-prompt.system.v2",
  CourseImagePromptUserV2: "course.model-step.image-prompt.user.v2",
  CourseHtmlEngineerSystemV2:
    "course.model-step.html-engineer.system.v2",
  CourseHtmlEngineerUserV2: "course.model-step.html-engineer.user.v2",
  CoursePageQaSystemV2: "course.model-step.page-qa.system.v2",
  CoursePageQaUserV2: "course.model-step.page-qa.user.v2",
  CourseRepairSystemV1: "course.model-step.repair.system.v1",
  CourseRepairUserV1: "course.model-step.repair.user.v1",
} as const;

export type PromptId = (typeof PromptIds)[keyof typeof PromptIds];
