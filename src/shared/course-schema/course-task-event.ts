import { z } from "zod";

import {
  CourseGenerationPublicEventSchema,
  CourseGenerationStateSchema,
  CourseIdSchema,
  PageWorkerModeSchema,
} from "./course-generation-state";

/** 可安全用作任务存储目录名及 SSE 订阅键的稳定 ID。 */
export const CourseTaskIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^task-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export const CourseTaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/** 公开标识任务由兼容手写编排还是 LangGraph 运行。 */
export const CourseTaskRuntimeSourceSchema = z.enum([
  "workflow",
  "langgraph",
]);

const CourseTaskPageCountSchema = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const CourseTaskErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1_000),
  })
  .strict();

/** 持久化 taskId 与课程检查点之间的映射及任务生命周期。 */
export const CourseTaskRecordSchema = z
  .object({
    version: z.literal(1),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    traceId: z.string().min(1).max(120),
    userPrompt: z.string().min(2).max(4_000),
    pageCount: CourseTaskPageCountSchema.optional(),
    executionMode: PageWorkerModeSchema.optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
    source: CourseTaskRuntimeSourceSchema.default("workflow"),
    status: CourseTaskStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    error: CourseTaskErrorSchema.optional(),
  })
  .strict();

export const CourseTaskCreateResponseSchema = z
  .object({
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    traceId: z.string().min(1).max(120),
    status: z.literal("queued"),
    source: CourseTaskRuntimeSourceSchema.default("workflow"),
  })
  .strict();

const CourseTaskStreamSnapshotSchema = z
  .object({
    type: z.literal("snapshot"),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    source: CourseTaskRuntimeSourceSchema.default("workflow"),
    state: CourseGenerationStateSchema,
  })
  .strict();

const CourseTaskStreamEventSchema = z
  .object({
    type: z.literal("event"),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    source: CourseTaskRuntimeSourceSchema.default("workflow"),
    event: CourseGenerationPublicEventSchema,
  })
  .strict();

const CourseTaskTerminalStatusSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
]);

const CourseTaskStreamTerminalSchema = z
  .object({
    type: z.literal("terminal"),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    source: CourseTaskRuntimeSourceSchema.default("workflow"),
    status: CourseTaskTerminalStatusSchema,
    state: CourseGenerationStateSchema,
  })
  .strict();

/**
 * SSE 只传递可校验的课程快照、公开事件和终态。
 * 不提供任意 payload/data，避免把 Agent 私有上下文带到浏览器。
 */
export const CourseTaskStreamMessageSchema = z
  .discriminatedUnion("type", [
    CourseTaskStreamSnapshotSchema,
    CourseTaskStreamEventSchema,
    CourseTaskStreamTerminalSchema,
  ])
  .superRefine((message, context) => {
    const referencedCourseId =
      message.type === "event" ? undefined : message.state.courseId;

    if (referencedCourseId && referencedCourseId !== message.courseId) {
      context.addIssue({
        code: "custom",
        message: "SSE 消息的 courseId 必须与课程检查点一致",
        path: ["state", "courseId"],
      });
    }

    if (message.type === "terminal" && message.state.status !== message.status) {
      context.addIssue({
        code: "custom",
        message: "SSE 终态必须与课程检查点状态一致",
        path: ["status"],
      });
    }
  });

export type CourseTaskId = z.infer<typeof CourseTaskIdSchema>;
export type CourseTaskStatus = z.infer<typeof CourseTaskStatusSchema>;
export type CourseTaskRuntimeSource = z.infer<
  typeof CourseTaskRuntimeSourceSchema
>;
export type CourseTaskRecord = z.infer<typeof CourseTaskRecordSchema>;
export type CourseTaskCreateResponse = z.infer<
  typeof CourseTaskCreateResponseSchema
>;
export type CourseTaskStreamMessage = z.infer<
  typeof CourseTaskStreamMessageSchema
>;
