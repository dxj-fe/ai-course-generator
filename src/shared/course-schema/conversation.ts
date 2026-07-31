import { z } from "zod";

import { CourseIdSchema } from "./course-generation-state";
import { CourseTaskIdSchema } from "./course-task-event";

export const ConversationIdSchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^conversation-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export const ConversationMessageIdSchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^message-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

export const ConversationMessageSchema = z
  .object({
    id: ConversationMessageIdSchema,
    role: z.enum(["assistant", "user"]),
    content: z.string().min(1).max(20_000),
    duration: z.string().min(1).max(32).optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const ConversationRecordSchema = z
  .object({
    id: ConversationIdSchema,
    title: z.string().trim().min(1).max(160),
    pinned: z.boolean(),
    courseId: CourseIdSchema.optional(),
    taskId: CourseTaskIdSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    messages: z.array(ConversationMessageSchema).max(1_000),
  })
  .strict();

export const ConversationListResponseSchema = z
  .object({
    items: z.array(ConversationRecordSchema).max(200),
    unavailableCount: z.number().int().nonnegative(),
  })
  .strict();

export const DeleteConversationResponseSchema = z
  .object({
    id: ConversationIdSchema,
    deleted: z.literal(true),
  })
  .strict();

export const SaveConversationInputSchema = z
  .object({
    id: ConversationIdSchema,
    title: z.string().trim().min(1).max(160),
    pinned: z.boolean().optional(),
    courseId: CourseIdSchema.optional(),
    taskId: CourseTaskIdSchema.optional(),
    messages: z.array(ConversationMessageSchema).min(1).max(1_000),
  })
  .strict();

export const UpdateConversationInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    pinned: z.boolean().optional(),
    courseId: CourseIdSchema.optional(),
    taskId: CourseTaskIdSchema.optional(),
    appendMessages: z
      .array(ConversationMessageSchema)
      .min(1)
      .max(20)
      .optional(),
    updateMessage: z
      .object({
        id: ConversationMessageIdSchema,
        content: z.string().min(1).max(20_000).optional(),
        duration: z.string().min(1).max(32).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "至少提供一个会话更新字段",
  });

export type ConversationMessage = z.infer<
  typeof ConversationMessageSchema
>;
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
export type ConversationListResponse = z.infer<
  typeof ConversationListResponseSchema
>;
export type DeleteConversationResponse = z.infer<
  typeof DeleteConversationResponseSchema
>;
export type SaveConversationInput = z.infer<
  typeof SaveConversationInputSchema
>;
export type UpdateConversationInput = z.infer<
  typeof UpdateConversationInputSchema
>;
