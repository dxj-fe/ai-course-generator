import { z } from "zod";

import { CourseIdSchema } from "./course-generation-state";
import { PageInteractionTypeSchema } from "./page";
import { QualityDecisionSchema } from "./quality";
import { ReferenceUsageSchema } from "./reference";

/**
 * 给依赖页面和整课 Reviewer 使用的受控摘要。
 * 它保留实际页面的教学信息，但不会把大段 HTML 带进 Agent 上下文。
 */
export const PageSummarySchema = z
  .object({
    courseId: CourseIdSchema,
    pageId: z.string().min(1).max(80),
    order: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(2).max(500),
    objectiveIds: z.array(z.string().min(1).max(80)).min(1).max(20),
    buildDependencyPageIds: z.array(z.string().min(1).max(80)).max(20),
    keyPoints: z.array(z.string().trim().min(2).max(500)).min(1).max(24),
    contentDigest: z.string().trim().min(2).max(2_000),
    learnerAction: z.string().trim().min(2).max(500),
    assessment: z.string().trim().min(2).max(500).optional(),
    interactionType: PageInteractionTypeSchema,
    usedReferences: z.array(ReferenceUsageSchema).max(12),
    quality: z
      .object({
        overallScore: z.number().min(0).max(100),
        decision: QualityDecisionSchema,
        issueCodes: z.array(z.string().min(1).max(80)).max(50),
      })
      .strict(),
  })
  .strict()
  .superRefine((summary, context) => {
    for (const field of [
      "objectiveIds",
      "buildDependencyPageIds",
      "keyPoints",
    ] as const) {
      if (new Set(summary[field]).size !== summary[field].length) {
        context.addIssue({
          code: "custom",
          message: `${field} 不能包含重复项`,
          path: [field],
        });
      }
    }
    if (summary.buildDependencyPageIds.includes(summary.pageId)) {
      context.addIssue({
        code: "custom",
        message: "页面摘要不能把自己列为生成依赖",
        path: ["buildDependencyPageIds"],
      });
    }
  });

export type PageSummary = z.infer<typeof PageSummarySchema>;
