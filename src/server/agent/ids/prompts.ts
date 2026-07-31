export const PromptIds = {
  CourseArchitectSystem: "course.architect.system",
  CourseDirectorSystem: "course.director.system",
  CoursePageBuilderSystem: "course.page-builder.system",
  CourseReviewerSystem: "course.reviewer.system",
  CoursePedagogySystem: "course.model-step.pedagogy.system",
  CoursePedagogyUser: "course.model-step.pedagogy.user",
  CourseStorySystem: "course.model-step.story.system",
  CourseStoryUser: "course.model-step.story.user",
  CourseVisualSystem: "course.model-step.visual.system",
  CourseVisualUser: "course.model-step.visual.user",
  CoursePageWriterSystem: "course.model-step.page-writer.system",
  CoursePageWriterUser: "course.model-step.page-writer.user",
  CourseImagePromptSystem: "course.model-step.image-prompt.system",
  CourseImagePromptUser: "course.model-step.image-prompt.user",
  CourseHtmlEngineerSystem: "course.model-step.html-engineer.system",
  CourseHtmlEngineerUser: "course.model-step.html-engineer.user",
  CoursePageQaSystem: "course.model-step.page-qa.system",
  CoursePageQaUser: "course.model-step.page-qa.user",
  CourseRepairSystem: "course.model-step.repair.system",
  CourseRepairUser: "course.model-step.repair.user",
} as const;

export type PromptId = (typeof PromptIds)[keyof typeof PromptIds];
