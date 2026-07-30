import { z } from "zod";

import { CourseLanguageSchema } from "./intent";

export const CourseSectionCountSchema = z.union([
  z.literal("auto"),
  z.number().int().positive(),
]);

export const CourseLearningModeSchema = z.enum([
  "guided",
  "practice",
  "mixed",
]);

/**
 * 用户确认后的课程输入。它与当前 Keya 前端类型保持兼容，后续可直接上移替换类型声明。
 */
export const CourseCreationBriefSchema = z
  .object({
    originalRequest: z.string().trim().min(2).max(4_000),
    topic: z.string().trim().min(1).max(160),
    audience: z.string().trim().min(1).max(240),
    goal: z.string().trim().min(2).max(500).optional(),
    sectionCount: CourseSectionCountSchema.optional(),
    learningMode: CourseLearningModeSchema,
    language: CourseLanguageSchema,
  })
  .strict();

export type CourseSectionCount = z.infer<typeof CourseSectionCountSchema>;
export type CourseLearningMode = z.infer<typeof CourseLearningModeSchema>;
export type CourseCreationBrief = z.infer<typeof CourseCreationBriefSchema>;
