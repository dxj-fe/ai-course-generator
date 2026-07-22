import { z } from "zod";

import {
  CourseGenerationStageSchema,
  CourseGenerationStateSchema,
  CourseGenerationStatusSchema,
  CourseIdSchema,
} from "./course-generation-state";
import {
  CourseTaskIdSchema,
  CourseTaskRuntimeSourceSchema,
  CourseTaskStatusSchema,
} from "./course-task-event";

export const CourseRunSummarySchema = z
  .object({
    taskId: CourseTaskIdSchema,
    traceId: z.string().min(1).max(120),
    status: CourseTaskStatusSchema,
    source: CourseTaskRuntimeSourceSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    error: z
      .object({
        code: z.string().min(1).max(100),
        message: z.string().min(1).max(1_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const CourseHistoryItemSchema = z
  .object({
    courseId: CourseIdSchema,
    title: z.string().min(1).max(160),
    prompt: z.string().min(2).max(4_000),
    status: CourseGenerationStatusSchema,
    currentStage: CourseGenerationStageSchema,
    totalPages: z.number().int().nonnegative().max(5),
    completedPages: z.number().int().nonnegative().max(5),
    referenceCount: z.number().int().nonnegative().max(3),
    runCount: z.number().int().nonnegative(),
    exportable: z.boolean(),
    startedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    latestRun: CourseRunSummarySchema.optional(),
  })
  .strict();

export const CourseHistoryListResponseSchema = z
  .object({
    items: z.array(CourseHistoryItemSchema).max(100),
    total: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
  })
  .strict();

export const CourseHistoryDetailResponseSchema = z
  .object({
    course: CourseGenerationStateSchema,
    runs: z.array(CourseRunSummarySchema).max(100),
  })
  .strict();

export type CourseRunSummary = z.infer<typeof CourseRunSummarySchema>;
export type CourseHistoryItem = z.infer<typeof CourseHistoryItemSchema>;
export type CourseHistoryListResponse = z.infer<
  typeof CourseHistoryListResponseSchema
>;
export type CourseHistoryDetailResponse = z.infer<
  typeof CourseHistoryDetailResponseSchema
>;
