export const SkillIds = {
  CourseDesign: "course-design",
  CoursePageDesign: "course-page-design",
  FrontendSlides: "frontend-slides",
} as const;

export type SkillId = (typeof SkillIds)[keyof typeof SkillIds];

export const PROJECT_SKILL_IDS = Object.freeze(
  Object.values(SkillIds),
) as readonly SkillId[];
