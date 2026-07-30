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
    // agent-v2 只按真实依赖 wave 调度；concurrency=1 已能获得串行效果，
    // 不再暴露一个运行时不会执行的旧 serial 模式。
    executionMode: z.literal("parallel").optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
    source: z.literal("agent-v2").optional(),
    traceId: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.courseId || value.userPrompt), {
    message: "userPrompt 或 courseId 至少提供一个",
  })
  .superRefine((value, context) => {
    if (value.source === "agent-v2" && !value.creationBrief) {
      context.addIssue({
        code: "custom",
        message: "agent-v2 任务必须提供结构化 creationBrief",
        path: ["creationBrief"],
      });
    }
  });
