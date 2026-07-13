import { z } from "zod";

import { CourseOutlineSchema } from "./course";

const INTRO_PAGE_TYPES = new Set(["cover", "story_intro"]);
const EXPLANATION_PAGE_TYPES = new Set([
  "knowledge_card",
  "comparison",
  "timeline",
]);
const ASSESSMENT_PAGE_TYPES = new Set(["quiz", "achievement"]);
const PASSIVE_INTERACTIONS = new Set(["none", "navigate"]);

/**
 * CoursePlannerAgent 的结构化输出协议。
 * 在通用 CourseOutline 约束之上补充页数和教学节奏要求。
 */
export const CoursePlanSchema = CourseOutlineSchema.superRefine(
  (outline, context) => {
    if (outline.pages.length < 3 || outline.pages.length > 12) {
      context.addIssue({
        code: "custom",
        message: "课程规划必须包含 3 到 12 个页面",
        path: ["pages"],
      });
    }

    const firstPage = outline.pages[0];
    const lastPage = outline.pages.at(-1);

    if (firstPage && !INTRO_PAGE_TYPES.has(firstPage.pageType)) {
      context.addIssue({
        code: "custom",
        message: "课程第一页必须是封面或故事导入",
        path: ["pages", 0, "pageType"],
      });
    }

    if (lastPage && lastPage.pageType !== "summary") {
      context.addIssue({
        code: "custom",
        message: "课程最后一页必须是总结页",
        path: ["pages", outline.pages.length - 1, "pageType"],
      });
    }

    if (
      !outline.pages.some((page) =>
        EXPLANATION_PAGE_TYPES.has(page.pageType),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "课程至少需要一个知识讲解页面",
        path: ["pages"],
      });
    }

    if (
      !outline.pages.some(
        (page) => !PASSIVE_INTERACTIONS.has(page.interactionType),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "课程至少需要一个主动交互页面",
        path: ["pages"],
      });
    }

    const firstAssessmentIndex = outline.pages.findIndex((page) =>
      ASSESSMENT_PAGE_TYPES.has(page.pageType),
    );

    if (
      firstAssessmentIndex >= 0 &&
      outline.pages
        .slice(firstAssessmentIndex + 1, -1)
        .some((page) => EXPLANATION_PAGE_TYPES.has(page.pageType))
    ) {
      context.addIssue({
        code: "custom",
        message: "知识讲解页面必须位于测验或成果任务之前",
        path: ["pages"],
      });
    }
  },
);

export type CoursePlan = z.infer<typeof CoursePlanSchema>;
