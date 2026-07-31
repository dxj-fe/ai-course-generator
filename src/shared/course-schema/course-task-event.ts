import { z } from "zod";

import {
  CourseGenerationCauseCodeSchema,
  CourseGenerationPublicEventSchema,
  CourseGenerationStateSchema,
  CourseIdSchema,
  PageWorkerModeSchema,
} from "./course-generation-state";
import {
  REFERENCE_MAX_PACKS,
  ReferencePackSchema,
} from "./reference";
import { CoursePageCountSchema } from "./intent";
import { CourseCreationBriefSchema } from "./course-creation-brief";

/** 可安全用作任务存储目录名及 SSE 订阅键的稳定 ID。 */
export const CourseTaskIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^task-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export const CourseTaskStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const CourseTaskControlActionSchema = z.enum(["pause", "resume"]);

export const CourseTaskControlRequestSchema = z
  .object({
    action: CourseTaskControlActionSchema,
  })
  .strict();

const CourseTaskErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    causeCode: CourseGenerationCauseCodeSchema.optional(),
    message: z.string().min(1).max(1_000),
  })
  .strict();

const CourseTaskRecordBaseSchema = z
  .object({
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    traceId: z.string().min(1).max(120),
    userPrompt: z.string().min(2).max(4_000),
    creationBrief: CourseCreationBriefSchema,
    referencePacks: z.array(ReferencePackSchema).max(REFERENCE_MAX_PACKS).optional(),
    pageCount: CoursePageCountSchema.optional(),
    executionMode: PageWorkerModeSchema.optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
    status: CourseTaskStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    error: CourseTaskErrorSchema.optional(),
  })
  .strict();

/** 持久化 taskId 与课程检查点之间的映射及任务生命周期。 */
export const CourseTaskRecordSchema = CourseTaskRecordBaseSchema
  .superRefine((record, context) => {
    if (
      record.status === "paused" &&
      (record.completedAt !== undefined || record.error !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "paused 任务不能包含终态时间或错误",
        path: ["status"],
      });
    }
  });

export const CourseTaskCreateResponseSchema = z
  .object({
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    traceId: z.string().min(1).max(120),
    status: z.literal("queued"),
  })
  .strict();

export const CourseTaskControlResponseSchema = z
  .object({
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    traceId: z.string().min(1).max(120),
    status: CourseTaskStatusSchema,
  })
  .strict();

const CourseTaskStreamSnapshotSchema = z
  .object({
    type: z.literal("snapshot"),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    /** 课程 checkpoint 在暂停时仍是 running；任务控制态由此字段独立表达。 */
    taskStatus: CourseTaskStatusSchema.optional(),
    state: CourseGenerationStateSchema,
  })
  .strict();

const CourseTaskStreamEventSchema = z
  .object({
    type: z.literal("event"),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
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

    if (
      message.type === "snapshot" &&
      message.taskStatus === "paused" &&
      message.state.status !== "running"
    ) {
      context.addIssue({
        code: "custom",
        message: "paused 任务必须保留 running 课程检查点",
        path: ["taskStatus"],
      });
    }
  });

export type CourseTaskId = z.infer<typeof CourseTaskIdSchema>;
export type CourseTaskStatus = z.infer<typeof CourseTaskStatusSchema>;
export type CourseTaskControlAction = z.infer<
  typeof CourseTaskControlActionSchema
>;
export type CourseTaskControlRequest = z.infer<
  typeof CourseTaskControlRequestSchema
>;
export type CourseTaskControlResponse = z.infer<
  typeof CourseTaskControlResponseSchema
>;
export type CourseTaskRecord = z.infer<typeof CourseTaskRecordSchema>;
export type CourseTaskCreateResponse = z.infer<
  typeof CourseTaskCreateResponseSchema
>;
export type CourseTaskStreamMessage = z.infer<
  typeof CourseTaskStreamMessageSchema
>;
