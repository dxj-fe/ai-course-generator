import { z } from "zod";

import { PageTypeSchema } from "./page";
import { VisualStyleSchema } from "./intent";

export const RETRIEVAL_MAX_SKILL_CARDS = 3;
export const RETRIEVAL_MAX_TEMPLATE_CARDS = 3;
export const RETRIEVAL_MAX_REFERENCE_HITS = 3;
export const RETRIEVAL_MAX_REFERENCE_CHUNKS_PER_HIT = 4;

const CardIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const CardNameSchema = z.string().min(2).max(100);
const CardDescriptionSchema = z.string().min(5).max(300);
const CardUsageSchema = z.array(z.string().min(2).max(180)).min(1).max(6);
const CardLimitationsSchema = z
  .array(z.string().min(2).max(180))
  .min(1)
  .max(6);
const CardKeywordsSchema = z
  .array(z.string().min(1).max(40))
  .min(1)
  .max(16);

export const ToolCardSchema = z
  .object({
    kind: z.literal("tool"),
    id: CardIdSchema,
    name: CardNameSchema,
    description: CardDescriptionSchema,
    whenToUse: CardUsageSchema,
    inputSchemaSummary: z.string().min(2).max(240),
    outputSummary: z.string().min(2).max(240),
    limitations: CardLimitationsSchema,
    keywords: CardKeywordsSchema,
  })
  .strict();

export const SkillCardSchema = z
  .object({
    kind: z.literal("skill"),
    id: CardIdSchema,
    name: CardNameSchema,
    description: CardDescriptionSchema,
    agentNames: z
      .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80))
      .min(1)
      .max(6),
    whenToUse: CardUsageSchema,
    inputSchemaSummary: z.string().min(2).max(240),
    outputSummary: z.string().min(2).max(240),
    limitations: CardLimitationsSchema,
    keywords: CardKeywordsSchema,
  })
  .strict();

export const TemplateCardSchema = z
  .object({
    kind: z.enum(["functional-template", "style-template"]),
    id: CardIdSchema,
    name: CardNameSchema,
    description: CardDescriptionSchema,
    whenToUse: CardUsageSchema,
    inputSchemaSummary: z.string().min(2).max(240),
    outputSummary: z.string().min(2).max(240),
    limitations: CardLimitationsSchema,
    tags: z.array(z.string().min(1).max(80)).min(1).max(16),
    pageType: PageTypeSchema.optional(),
    visualStyle: VisualStyleSchema.optional(),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.kind === "functional-template" && !card.pageType) {
      context.addIssue({
        code: "custom",
        message: "功能模板 Card 必须提供 pageType",
        path: ["pageType"],
      });
    }
    if (card.kind === "style-template" && !card.visualStyle) {
      context.addIssue({
        code: "custom",
        message: "样式模板 Card 必须提供 visualStyle",
        path: ["visualStyle"],
      });
    }
  });

export const ReferenceHitSchema = z
  .object({
    referencePackId: z.string().regex(/^ref-[a-f0-9]{24}$/),
    sourceName: z.string().min(1).max(200),
    summary: z.string().min(2).max(1_000),
    keyFacts: z.array(z.string().min(2).max(500)).max(6),
    chunkIds: z
      .array(z.string().regex(/^chunk-[0-9]{2}$/))
      .min(1)
      .max(RETRIEVAL_MAX_REFERENCE_CHUNKS_PER_HIT),
    reason: z.string().min(2).max(240),
  })
  .strict();

export const SkillCardMatchSchema = z
  .object({
    card: SkillCardSchema,
    reason: z.string().min(2).max(240),
  })
  .strict();

export const TemplateCardMatchSchema = z
  .object({
    card: TemplateCardSchema,
    reason: z.string().min(2).max(240),
  })
  .strict();

export const SkillCardSearchResultSchema = z
  .object({
    matches: z.array(SkillCardMatchSchema).max(RETRIEVAL_MAX_SKILL_CARDS),
  })
  .strict();

export const TemplateCardSearchResultSchema = z
  .object({
    functional: z
      .array(TemplateCardMatchSchema)
      .max(RETRIEVAL_MAX_TEMPLATE_CARDS),
    style: z
      .array(TemplateCardMatchSchema)
      .max(RETRIEVAL_MAX_TEMPLATE_CARDS),
  })
  .strict();

export const ReferenceSearchResultSchema = z
  .object({
    hits: z.array(ReferenceHitSchema).max(RETRIEVAL_MAX_REFERENCE_HITS),
  })
  .strict();

export type ToolCard = z.infer<typeof ToolCardSchema>;
export type SkillCard = z.infer<typeof SkillCardSchema>;
export type TemplateCard = z.infer<typeof TemplateCardSchema>;
export type ReferenceHit = z.infer<typeof ReferenceHitSchema>;
export type SkillCardMatch = z.infer<typeof SkillCardMatchSchema>;
export type TemplateCardMatch = z.infer<typeof TemplateCardMatchSchema>;
export type SkillCardSearchResult = z.infer<typeof SkillCardSearchResultSchema>;
export type TemplateCardSearchResult = z.infer<
  typeof TemplateCardSearchResultSchema
>;
export type ReferenceSearchResult = z.infer<typeof ReferenceSearchResultSchema>;
