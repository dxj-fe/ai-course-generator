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
  focalPoint: z.string().min(2).max(240),
  composition: z.string().min(2).max(240),
  assetPurpose: z.string().min(2).max(240),
});

/** 定义动效强度、用途和降低动效时的替代策略。 */
export const VisualMotionGuidanceSchema = z.object({
  intensity: VisualMotionIntensitySchema,
  strategy: z.string().min(2).max(240),
  reducedMotionAlternative: z.string().min(2).max(240),
});

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
export type VisualBrief = z.infer<typeof VisualBriefSchema>;
