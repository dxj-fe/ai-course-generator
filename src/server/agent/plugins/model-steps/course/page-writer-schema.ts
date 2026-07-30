import { z } from "zod";

import {
  PageContentBlockKindSchema,
  PageInteractionTypeSchema,
  ReferenceUsageSchema,
} from "@/shared/course-schema";

export const PageWriterBlockDraftSchema = z.object({
  kind: PageContentBlockKindSchema,
  label: z.string().min(1).max(80).optional(),
  heading: z.string().min(1).max(120),
  body: z.string().trim().min(12).max(800),
  supportingPoints: z.array(z.string().trim().min(4).max(240)).max(8),
});

export const PageWriterInteractionItemDraftSchema = z.union([
  z.object({
    label: z.string().trim().min(1).max(160),
    content: z.string().trim().min(4).max(500),
  }),
  // 兼容把简单对象压成标签字符串的 Provider；适配层只会用同页 block
  // 的完整正文补足解释，无法匹配时仍由内容校验拒绝。
  z.string().trim().min(1).max(160),
]);

const PageWriterChoiceQuestionDraftSchema = z.object({
  prompt: z.string().min(2).max(500),
  options: z.array(z.string().min(1).max(240)).min(2).max(6),
  correctOptionIndex: z.number().int().min(0).max(5),
  feedbackSuccess: z.string().min(2).max(300),
  feedbackRetry: z.string().min(2).max(300),
  maxAttempts: z.number().int().min(1).max(5),
});

export const PageWriterInteractionDraftSchema = z.object({
  type: PageInteractionTypeSchema,
  prompt: z.string().max(500),
  items: z.array(PageWriterInteractionItemDraftSchema).max(8),
  questions: z.array(PageWriterChoiceQuestionDraftSchema).max(1),
  feedbackSuccess: z.array(z.string().min(2).max(300)).max(8),
  feedbackRetry: z.array(z.string().min(2).max(300)).max(8),
  maxAttempts: z.number().int().min(1).max(5),
  placeholder: z.string().max(160),
  evaluationCriteria: z.array(z.string().min(2).max(240)).max(6),
  actionLabel: z.string().max(80),
  // 对非 navigate 互动这是无意义占位字段，先兼容模型别名，再在适配层收敛。
  destination: z.string().trim().max(80),
});

// 与领域 Schema 的形状约束保持一致；旁白的信息量由业务校验按语义长度统一判断。
export const PageWriterNarrationDraftSchema = z
  .array(z.string().trim().min(2).max(500))
  .max(3);

export const PageWriterModelOutputSchema = z.object({
  narration: PageWriterNarrationDraftSchema,
  // 兼容部分模型把简单对象数组压缩为字符串数组；领域 Schema 仍保持严格。
  blocks: z.array(z.unknown()).max(12),
  interaction: PageWriterInteractionDraftSchema,
  // 模型可能使用 medium、紧凑等同义标签；适配层会收敛为领域枚举。
  contentDensity: z.string().trim().min(1).max(40),
  visualPriority: z.string().min(2).max(240),
  groupingStrategy: z.string().min(2).max(240),
  usedReferences: z.array(ReferenceUsageSchema).max(12).default([]),
});
