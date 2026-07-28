import { z } from "zod";

/** 描述学习任务对应的认知层级，供后续 Page Worker 控制内容深度。 */
export const CognitiveLevelSchema = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "create",
]);

/** 显式记录课程如何适配目标年龄，而不是只保留一个年龄数字。 */
export const AgeAdaptationSchema = z.object({
  readingLevel: z.string().min(2).max(160),
  tone: z.string().min(2).max(160),
  explanationDepth: z.string().min(2).max(240),
  chunkingStrategy: z.string().min(2).max(240),
});

/** 约束连续被动页面数量和互动出现频率。 */
export const InteractionCadenceSchema = z.object({
  recommendedIntervalPages: z.number().int().min(1).max(4),
  maxPassivePages: z.number().int().min(1).max(4),
  strategy: z.string().min(5).max(300),
});

/** 为单个 PagePlan 提供教学脚手架和理解检查方式。 */
export const PedagogyPageGuidanceSchema = z.object({
  pageId: z.string().min(1).max(80),
  cognitiveLevel: CognitiveLevelSchema,
  scaffolding: z.array(z.string().min(2).max(200)).min(1).max(6),
  interactionPurpose: z.string().min(2).max(240),
  checkForUnderstanding: z.string().min(2).max(240),
});

/** 保存常见误区和对应的纠正策略。 */
export const MisconceptionStrategySchema = z.object({
  misconception: z.string().min(2).max(240),
  correction: z.string().min(2).max(300),
});

/**
 * PedagogyAgent 的完整交接协议。
 * 它只描述教学策略，不包含故事角色、视觉 Token 或 HTML。
 */
export const PedagogyPlanSchema = z
  .object({
    audienceSummary: z.string().min(5).max(300),
    ageAdaptation: AgeAdaptationSchema,
    learningProgression: z.array(z.string().min(5).max(300)).min(2).max(12),
    interactionCadence: InteractionCadenceSchema,
    pageGuidance: z.array(PedagogyPageGuidanceSchema).min(1),
    misconceptions: z.array(MisconceptionStrategySchema).max(8),
    accessibilityStrategies: z
      .array(z.string().min(2).max(240))
      .min(1)
      .max(10),
  })
  .superRefine((plan, context) => {
    const pageIds = plan.pageGuidance.map(({ pageId }) => pageId);

    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "pageGuidance 不能重复引用同一页面",
        path: ["pageGuidance"],
      });
    }
  });

export type CognitiveLevel = z.infer<typeof CognitiveLevelSchema>;
export type AgeAdaptation = z.infer<typeof AgeAdaptationSchema>;
export type InteractionCadence = z.infer<typeof InteractionCadenceSchema>;
export type PedagogyPageGuidance = z.infer<
  typeof PedagogyPageGuidanceSchema
>;
export type MisconceptionStrategy = z.infer<
  typeof MisconceptionStrategySchema
>;
export type PedagogyPlan = z.infer<typeof PedagogyPlanSchema>;
