import { z } from "zod";

import {
  CourseCreationBriefSchema,
  type CourseGenerationState,
  CourseIdSchema,
  CoursePageCountSchema,
  REFERENCE_MAX_PACKS,
  ReferencePackSchema,
  type CourseTaskCreateResponse,
  type CourseTaskRecord,
} from "@/shared/course-schema";

export type CourseGenerationTaskService = {
  create(input: unknown): Promise<CourseTaskCreateResponse>;
  run(taskId: string): Promise<CourseGenerationState | undefined>;
  pause(taskId: string): Promise<CourseTaskRecord | undefined>;
  resume(taskId: string): Promise<CourseTaskRecord | undefined>;
  cancel(taskId: string): Promise<CourseTaskRecord | undefined>;
  /** 只根据持久化权威终态收口 Task/Course，不表达用户取消。 */
  reconcile(taskId: string): Promise<CourseTaskRecord | undefined>;
  load(taskId: string): Promise<CourseTaskRecord | undefined>;
};

export const CourseTaskCreateInputSchema = z
  .object({
    courseId: CourseIdSchema.optional(),
    userPrompt: z.string().trim().min(2).max(4_000).optional(),
    creationBrief: CourseCreationBriefSchema.optional(),
    referencePacks: z.array(ReferencePackSchema).max(REFERENCE_MAX_PACKS).optional(),
    pageCount: CoursePageCountSchema.optional(),
    // 当前运行时只按真实依赖 wave 调度；concurrency=1 即为串行效果。
    executionMode: z.literal("parallel").optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
    traceId: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.courseId || value.userPrompt), {
    message: "userPrompt 或 courseId 至少提供一个",
  });
