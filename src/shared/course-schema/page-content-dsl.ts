import { z } from "zod";

import { AssetRoleSchema, AssetTypeSchema } from "./asset";

/** 语义内容块的职责，而不是前端组件或布局名称。 */
export const PageContentBlockKindSchema = z.enum([
  "concept",
  "fact",
  "example",
  "instruction",
  "question",
  "recap",
]);

/**
 * 页面正文的最小可定位单元。
 * blockId 供 QA/Repair 精确引用；其余字段只表达内容语义。
 */
export const PageContentBlockSchema = z
  .object({
    id: z.string().regex(/^block-[a-z0-9-]+$/).max(80),
    kind: PageContentBlockKindSchema,
    label: z.string().min(1).max(80).optional(),
    heading: z.string().min(1).max(120),
    body: z.string().min(2).max(800),
    supportingPoints: z.array(z.string().min(2).max(240)).max(8),
  })
  .strict();

/** Page Writer 只声明素材需求；真实 URI 和 Asset ID 由素材流程补齐。 */
export const PageContentAssetSlotSchema = z
  .object({
    id: z.string().regex(/^asset-slot-[0-9]{2}$/),
    type: AssetTypeSchema,
    role: AssetRoleSchema,
    purpose: z.string().min(2).max(240),
    required: z.boolean(),
    altTextGuidance: z.string().min(2).max(240),
  })
  .strict();

const InteractionOptionSchema = z
  .object({
    id: z.string().regex(/^option-[a-z0-9-]+$/).max(80),
    label: z.string().min(1).max(240),
  })
  .strict();

const InteractionItemSchema = z
  .object({
    id: z.string().regex(/^item-[a-z0-9-]+$/).max(80),
    label: z.string().min(1).max(160),
    content: z.string().min(2).max(500),
  })
  .strict();

const InteractionFeedbackSchema = z
  .object({
    success: z.string().min(2).max(300),
    retry: z.string().min(2).max(300),
  })
  .strict();

/** 无互动页面仍显式返回 none，避免缺失字段被误判为生成失败。 */
export const NoInteractionSchema = z.object({ type: z.literal("none") }).strict();

/** 页面导航只表达行为语义，不规定按钮样式。 */
export const NavigateInteractionSchema = z
  .object({
    type: z.literal("navigate"),
    actionLabel: z.string().min(1).max(80),
    destination: z.enum(["next", "previous", "course-home"]),
  })
  .strict();

/** 逐项揭示内容，具体展开、翻转或动画方式由 HTML Engineer 决定。 */
export const RevealInteractionSchema = z
  .object({
    type: z.literal("reveal"),
    prompt: z.string().min(2).max(240),
    items: z.array(InteractionItemSchema).min(1).max(8),
  })
  .strict();

/** 单道选择题拥有稳定 ID、可判断答案和解释性反馈。 */
export const ChoiceQuestionSchema = z
  .object({
    id: z.string().regex(/^question-[0-9]{2}$/),
    prompt: z.string().min(2).max(500),
    options: z.array(InteractionOptionSchema).min(2).max(6),
    correctOptionId: z.string().min(1).max(80),
    feedback: InteractionFeedbackSchema,
    maxAttempts: z.number().int().min(1).max(5),
  })
  .strict()
  .superRefine((interaction, context) => {
    const optionIds = interaction.options.map(({ id }) => id);

    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({
        code: "custom",
        message: "choice options 不能包含重复 ID",
        path: ["options"],
      });
    }

    if (!optionIds.includes(interaction.correctOptionId)) {
      context.addIssue({
        code: "custom",
        message: "correctOptionId 必须引用真实选项",
        path: ["correctOptionId"],
      });
    }
  });

/** choice 可以包含多道题，满足测验模板的 1–8 个互动槽位。 */
export const ChoiceInteractionSchema = z
  .object({
    type: z.literal("choice"),
    questions: z.array(ChoiceQuestionSchema).min(1).max(8),
  })
  .strict();

/** 排序互动使用稳定 itemId 表达正确顺序。 */
export const SortInteractionSchema = z
  .object({
    type: z.literal("sort"),
    prompt: z.string().min(2).max(300),
    items: z.array(InteractionItemSchema).min(2).max(8),
    correctOrderIds: z.array(z.string().min(1).max(80)).min(2).max(8),
    feedback: InteractionFeedbackSchema,
  })
  .strict()
  .superRefine((interaction, context) => {
    const itemIds = interaction.items.map(({ id }) => id);

    if (
      new Set(itemIds).size !== itemIds.length ||
      new Set(interaction.correctOrderIds).size !== itemIds.length ||
      itemIds.some((id) => !interaction.correctOrderIds.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "correctOrderIds 必须无重复地覆盖全部排序项",
        path: ["correctOrderIds"],
      });
    }
  });

/** 开放输入只给出评价标准，不要求前端硬编码唯一答案。 */
export const InputInteractionSchema = z
  .object({
    type: z.literal("input"),
    prompt: z.string().min(2).max(500),
    placeholder: z.string().min(1).max(160),
    evaluationCriteria: z.array(z.string().min(2).max(240)).min(1).max(6),
    feedback: InteractionFeedbackSchema,
  })
  .strict();

/** 探索互动定义可浏览对象，不约束其视觉排列方式。 */
export const ExploreInteractionSchema = z
  .object({
    type: z.literal("explore"),
    prompt: z.string().min(2).max(300),
    items: z.array(InteractionItemSchema).min(2).max(8),
  })
  .strict();

export const PageContentInteractionSchema = z.discriminatedUnion("type", [
  NoInteractionSchema,
  NavigateInteractionSchema,
  RevealInteractionSchema,
  ChoiceInteractionSchema,
  SortInteractionSchema,
  InputInteractionSchema,
  ExploreInteractionSchema,
]);

/** 弱布局提示只描述阅读和分组意图，不出现像素、CSS 或组件树。 */
export const PageLayoutHintsSchema = z
  .object({
    contentDensity: z.enum(["sparse", "balanced", "dense"]),
    visualPriority: z.string().min(2).max(240),
    groupingStrategy: z.string().min(2).max(240),
    readingOrder: z.array(z.string().min(1).max(80)).max(12),
  })
  .strict();

/**
 * HTML Engineer、QA、Repair 和预览层共享的单页内容协议。
 * 它约束内容与互动语义，但不会锁死任何具体 UI 实现。
 */
export const PageContentDSLSchema = z
  .object({
    version: z.literal(1),
    pageId: z.string().min(1).max(80),
    functionalTemplateId: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    narration: z.array(z.string().min(2).max(500)).max(3),
    blocks: z.array(PageContentBlockSchema).max(12),
    interaction: PageContentInteractionSchema,
    assetSlots: z.array(PageContentAssetSlotSchema).max(12),
    layoutHints: PageLayoutHintsSchema,
  })
  .strict()
  .superRefine((dsl, context) => {
    const blockIds = dsl.blocks.map(({ id }) => id);
    const assetSlotIds = dsl.assetSlots.map(({ id }) => id);

    if (new Set(blockIds).size !== blockIds.length) {
      context.addIssue({
        code: "custom",
        message: "blocks 不能包含重复 ID",
        path: ["blocks"],
      });
    }

    if (new Set(assetSlotIds).size !== assetSlotIds.length) {
      context.addIssue({
        code: "custom",
        message: "assetSlots 不能包含重复 ID",
        path: ["assetSlots"],
      });
    }

    if (
      dsl.layoutHints.readingOrder.length !== blockIds.length ||
      new Set(dsl.layoutHints.readingOrder).size !== blockIds.length ||
      blockIds.some((id) => !dsl.layoutHints.readingOrder.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "readingOrder 必须无重复地覆盖全部 blockId",
        path: ["layoutHints", "readingOrder"],
      });
    }

    if (containsHtmlMarkup(dsl)) {
      context.addIssue({
        code: "custom",
        message: "PageContentDSL 不能包含 HTML 标记",
        path: [],
      });
    }
  });

/** 检查字符串内容中是否出现真实 HTML 标签，而不是普通的 HTML 文字。 */
function containsHtmlMarkup(value: unknown) {
  return /<\/?(?:html|head|body|main|section|article|div|span|script|style|p|h[1-6]|button|img|svg|a|ul|ol|li)\b/i.test(
    JSON.stringify(value),
  );
}

export type PageContentBlockKind = z.infer<
  typeof PageContentBlockKindSchema
>;
export type PageContentBlock = z.infer<typeof PageContentBlockSchema>;
export type PageContentAssetSlot = z.infer<
  typeof PageContentAssetSlotSchema
>;
export type PageContentInteraction = z.infer<
  typeof PageContentInteractionSchema
>;
export type PageLayoutHints = z.infer<typeof PageLayoutHintsSchema>;
export type PageContentDSL = z.infer<typeof PageContentDSLSchema>;
