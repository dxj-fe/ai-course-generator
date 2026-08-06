import { z } from "zod";

import { CourseOutlineSchema } from "./course";

const LEAD_PAGE_TYPES = new Set([
  "cover",
  "story_intro",
  "knowledge_card",
  "comparison",
  "timeline",
]);
const CLOSING_PAGE_TYPES = new Set(["summary", "quiz", "achievement"]);
const EXPLANATION_PAGE_TYPES = new Set([
  "knowledge_card",
  "comparison",
  "timeline",
]);
const PASSIVE_INTERACTIONS = new Set(["none", "navigate"]);

/**
 * CoursePlannerAgent 的结构化输出协议。
 * 在通用 CourseOutline 约束之上补充页数和教学节奏要求。
 */
export const CoursePlanSchema = CourseOutlineSchema.superRefine(
  (outline, context) => {
    const firstPage = outline.pages[0];
    const lastPage = outline.pages.at(-1);
    const isSinglePageCourse = outline.pages.length === 1;

    if (
      !isSinglePageCourse &&
      firstPage &&
      !LEAD_PAGE_TYPES.has(firstPage.pageType)
    ) {
      context.addIssue({
        code: "custom",
        message: "课程第一页必须是导入页或知识讲解页",
        path: ["pages", 0, "pageType"],
      });
    }

    if (
      !isSinglePageCourse &&
      lastPage &&
      !CLOSING_PAGE_TYPES.has(lastPage.pageType)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "课程最后一页必须是总结页，或带紧凑回扣的测验/成果任务页",
        path: ["pages", outline.pages.length - 1, "pageType"],
      });
    }

    if (
      outline.pages.length >= 3 &&
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

    let passiveRun = 0;
    outline.pages.forEach((page, index) => {
      passiveRun = PASSIVE_INTERACTIONS.has(page.interactionType)
        ? passiveRun + 1
        : 0;
      if (passiveRun > 2) {
        context.addIssue({
          code: "custom",
          message: "课程不能连续安排超过 2 个没有主动交互的页面",
          path: ["pages", index, "interactionType"],
        });
      }
    });

    const activePageCount = outline.pages.filter(
      (page) => !PASSIVE_INTERACTIONS.has(page.interactionType),
    ).length;
    const minimumActivePages = Math.ceil(outline.pages.length / 4);

    if (activePageCount < minimumActivePages) {
      context.addIssue({
        code: "custom",
        message: `当前课程至少需要 ${minimumActivePages} 个分散的主动交互页面`,
        path: ["pages"],
      });
    }

  },
);

export type CoursePlan = z.infer<typeof CoursePlanSchema>;
