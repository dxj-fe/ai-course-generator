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
}).strict();

export const PageWriterInteractionItemDraftSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    content: z.string().trim().min(4).max(500),
  })
  .strict();

const PageWriterChoiceQuestionDraftSchema = z
  .object({
    prompt: z.string().min(2).max(500),
    options: z.array(z.string().min(1).max(240)).min(2).max(6),
    correctOptionIndex: z.number().int().min(0).max(5),
    feedbackSuccess: z.string().min(2).max(300),
    feedbackRetry: z.string().min(2).max(300),
    maxAttempts: z.number().int().min(1).max(5),
  })
  .strict();

export const PageWriterInteractionDraftSchema = z
  .object({
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
    destination: z.enum(["next", "previous", "course-home"]),
  })
  .strict();

// 与领域 Schema 的形状约束保持一致；旁白的信息量由业务校验按语义长度统一判断。
export const PageWriterNarrationDraftSchema = z
  .array(z.string().trim().min(2).max(500))
  .max(3);

export const PageWriterModelOutputSchema = z
  .object({
    narration: PageWriterNarrationDraftSchema,
    blocks: z.array(PageWriterBlockDraftSchema).max(12),
    interaction: PageWriterInteractionDraftSchema,
    contentDensity: z.enum(["sparse", "balanced", "dense"]),
    visualPriority: z.string().min(2).max(240),
    groupingStrategy: z.string().min(2).max(240),
    usedReferences: z.array(ReferenceUsageSchema).max(12).default([]),
  })
  .strict();

/**
 * 只修正常见且无信息损失的 JSON 模式偏差，之后仍由严格 Schema 完整校验。
 * 非 navigate 互动的 destination 只是占位字段，不应因模型写了“未使用”拖垮整页。
 */
export function normalizePageWriterModelOutput(output: unknown): unknown {
  if (!isRecord(output) || !isRecord(output.interaction)) {
    return output;
  }

  const interaction = output.interaction;
  const destination =
    interaction.type !== "navigate" &&
    !["next", "previous", "course-home"].includes(
      String(interaction.destination),
    )
      ? "next"
      : interaction.destination;

  return {
    ...output,
    narration: normalizeStringArray(output.narration),
    interaction: {
      ...interaction,
      feedbackSuccess: normalizeStringArray(
        interaction.feedbackSuccess,
      ),
      feedbackRetry: normalizeStringArray(
        interaction.feedbackRetry,
      ),
      evaluationCriteria: normalizeStringArray(
        interaction.evaluationCriteria,
      ),
      destination,
    },
  };
}

function normalizeStringArray(value: unknown) {
  return typeof value === "string" ? [value] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
