import { z } from "zod";

import {
  PageContentBlockKindSchema,
  ReferenceUsageSchema,
} from "@/shared/course-schema";

export const PageWriterBlockDraftSchema = z.object({
  kind: PageContentBlockKindSchema,
  label: z.string().min(1).max(80).optional(),
  heading: z.string().min(1).max(120),
  body: z.string().trim().min(2).max(800),
  supportingPoints: z
    .array(z.string().trim().min(2).max(240))
    .max(8)
    .default([]),
}).strict();

export const PageWriterInteractionItemDraftSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    content: z.string().trim().min(2).max(500),
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

const NoInteractionDraftSchema = z
  .object({ type: z.literal("none") })
  .strict();

const NavigateInteractionDraftSchema = z
  .object({
    type: z.literal("navigate"),
    actionLabel: z.string().min(1).max(80),
    destination: z.enum(["next", "previous", "course-home"]),
  })
  .strict();

const RevealInteractionDraftSchema = z
  .object({
    type: z.literal("reveal"),
    prompt: z.string().min(2).max(500),
    items: z.array(PageWriterInteractionItemDraftSchema).min(1).max(8),
  })
  .strict();

const ExploreInteractionDraftSchema = RevealInteractionDraftSchema.extend({
  type: z.literal("explore"),
}).strict();

const ChoiceInteractionDraftSchema = PageWriterChoiceQuestionDraftSchema.extend({
  type: z.literal("choice"),
}).strict();

const SortInteractionDraftSchema = z
  .object({
    type: z.literal("sort"),
    prompt: z.string().min(2).max(500),
    items: z.array(PageWriterInteractionItemDraftSchema).min(2).max(8),
    feedbackSuccess: z.string().min(2).max(300),
    feedbackRetry: z.string().min(2).max(300),
  })
  .strict();

const InputInteractionDraftSchema = z
  .object({
    type: z.literal("input"),
    prompt: z.string().min(2).max(500),
    placeholder: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim().length === 0
          ? undefined
          : value,
      z.string().trim().min(1).max(160).optional(),
    ),
    evaluationCriteria: z.preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.string().trim().min(2).max(240)).min(1).max(6),
    ),
    feedbackSuccess: z.string().min(2).max(300),
    feedbackRetry: z.string().min(2).max(300),
  })
  .strict();

export const PageWriterInteractionDraftSchema = z.discriminatedUnion("type", [
  NoInteractionDraftSchema,
  NavigateInteractionDraftSchema,
  RevealInteractionDraftSchema,
  ChoiceInteractionDraftSchema,
  SortInteractionDraftSchema,
  InputInteractionDraftSchema,
  ExploreInteractionDraftSchema,
]);

// 与领域 Schema 的形状约束保持一致；这里只约束可解析形状，不猜测语义质量。
export const PageWriterNarrationDraftSchema = z
  .array(z.string().trim().min(2).max(500))
  .max(3);

export const PageWriterModelOutputSchema = z
  .object({
    narration: PageWriterNarrationDraftSchema,
    blocks: z.array(PageWriterBlockDraftSchema).max(12),
    interaction: PageWriterInteractionDraftSchema,
    usedReferences: z.array(ReferenceUsageSchema).max(12).default([]),
  })
  .strict();

/**
 * 只兼容无损的等价 JSON 形状：narration 单字符串、旧版单元素
 * choice.questions 包装，以及 choice 反馈的 success/retry 短别名。不合并
 * 多题或超量 items，不删除 block，也不补写教学内容。
 */
export function normalizePageWriterModelOutput(
  output: unknown,
): unknown {
  if (!isRecord(output)) return output;

  return {
    ...output,
    narration: normalizeStringArray(output.narration),
    interaction: normalizeInteractionShape(output.interaction),
  };
}

function normalizeInteractionShape(value: unknown) {
  if (!isRecord(value) || value.type !== "choice") return value;
  const flattened = flattenLegacySingleChoice(value);
  if (!isRecord(flattened)) return flattened;

  const { success, retry, ...rest } = flattened;
  return {
    ...rest,
    feedbackSuccess: flattened.feedbackSuccess ?? success,
    feedbackRetry: flattened.feedbackRetry ?? retry,
  };
}

function flattenLegacySingleChoice(value: Record<string, unknown>) {
  if (!Array.isArray(value.questions)) return value;
  if (value.questions.length !== 1 || !isRecord(value.questions[0])) {
    return value;
  }

  const rest = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "questions"),
  );
  return { ...rest, ...value.questions[0] };
}

function normalizeStringArray(value: unknown) {
  return typeof value === "string" ? [value] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
