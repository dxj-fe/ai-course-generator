import { z } from "zod";

/** 与 StyleTemplate 动效强度保持相同语义，但避免领域层反向依赖模板层。 */
export const VisualMotionIntensitySchema = z.enum([
  "none",
  "subtle",
  "dynamic",
]);

/** 描述图片与插画的统一媒介、构图和负向约束。 */
export const VisualAssetDirectionSchema = z.object({
  medium: z.string().min(2).max(200),
  composition: z.string().min(2).max(240),
  negativeConstraints: z.array(z.string().min(2).max(160)).min(1).max(10),
});

/** 为单个 PagePlan 指定视觉焦点和构图差异。 */
export const VisualPageGuidanceSchema = z.object({
  pageId: z.string().min(1).max(80),
  theme: z.string().min(2).max(240).default("基于当前问题的视觉隐喻"),
  focalPoint: z.string().min(2).max(240),
  composition: z.string().min(2).max(300),
  graphicMotif: z
    .string()
    .min(2)
    .max(300)
    .default("用代码原生图形表达当前知识关系"),
  assetPurpose: z.string().min(2).max(240),
});

/** 定义动效强度、用途和降低动效时的替代策略。 */
export const VisualMotionGuidanceSchema = z.object({
  intensity: VisualMotionIntensitySchema,
  strategy: z.string().min(2).max(240),
  reducedMotionAlternative: z.string().min(2).max(240),
});

/**
 * HTML Engineer 消费的精简视觉方向。
 * 保留整课创作约束，但不携带模板实现或固定 DOM 结构。
 */
export const DesignDirectionSchema = z
  .object({
    courseThesis: z.string().min(5).max(400),
    globalGuardrails: z
      .object({
        layoutPrinciples: z
          .array(z.string().min(2).max(240))
          .min(2)
          .max(3),
        typographyGuidance: z.string().min(5).max(300),
        colorUsage: z.string().min(5).max(300),
        assetDirection: VisualAssetDirectionSchema.pick({
          medium: true,
          composition: true,
        }),
        motionGuidance: VisualMotionGuidanceSchema,
        accessibilityRules: z
          .array(z.string().min(2).max(240))
          .min(2)
          .max(4),
        negativeConstraints: z
          .array(z.string().min(2).max(240))
          .min(1)
          .max(6),
      })
      .strict(),
    page: z
      .object({
        theme: z.string().min(2).max(240),
        proofGoal: z.string().min(2).max(240),
        composition: z.string().min(2).max(300),
        graphicMotif: z.string().min(2).max(300),
        assetPurpose: z.string().min(2).max(240),
      })
      .strict(),
    styleReference: z
      .object({
        goal: z.string().min(2).max(400),
        motif: z.string().min(2).max(300),
      })
      .strict(),
    inspirationNotes: z
      .array(
        z
          .object({
            source: z.string().min(1).max(400),
            note: z.string().min(1).max(2_400),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

/**
 * VisualDirectorAgent 的全局视觉 brief。
 * 具体 Token 由 styleTemplateId 指向 Registry，brief 只描述使用原则。
 */
export const VisualBriefSchema = z
  .object({
    styleTemplateId: z.string().min(1).max(80),
    visualConcept: z.string().min(5).max(400),
    layoutPrinciples: z.array(z.string().min(2).max(240)).min(2).max(10),
    typographyGuidance: z.string().min(5).max(300),
    colorUsage: z.string().min(5).max(300),
    assetDirection: VisualAssetDirectionSchema,
    pageGuidance: z.array(VisualPageGuidanceSchema).min(1),
    motionGuidance: VisualMotionGuidanceSchema,
    accessibilityRules: z.array(z.string().min(2).max(240)).min(2).max(12),
  })
  .superRefine((brief, context) => {
    const pageIds = brief.pageGuidance.map(({ pageId }) => pageId);

    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "pageGuidance 不能重复引用同一页面",
        path: ["pageGuidance"],
      });
    }

    if (/#[0-9a-f]{3,8}\b/i.test(JSON.stringify(brief))) {
      context.addIssue({
        code: "custom",
        message: "VisualBrief 应引用 StyleTemplate，不应复制颜色 Token",
        path: ["colorUsage"],
      });
    }
  });

export type VisualAssetDirection = z.infer<
  typeof VisualAssetDirectionSchema
>;
export type VisualMotionIntensity = z.infer<
  typeof VisualMotionIntensitySchema
>;
export type VisualPageGuidance = z.infer<typeof VisualPageGuidanceSchema>;
export type VisualMotionGuidance = z.infer<
  typeof VisualMotionGuidanceSchema
>;
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;
export type VisualBrief = z.infer<typeof VisualBriefSchema>;
