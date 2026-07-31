import { z } from "zod";

import { AssetRoleSchema, AssetTypeSchema } from "./asset";
import { ReferenceUsageSchema } from "./reference";

/**
 * 定义 Planner 和模板系统共同理解的页面教学类型。
 * 枚举保持稳定，避免不同 Agent 为同一页面类型创造不同名称。
 */
export const PageTypeSchema = z.enum([
  "cover",
  "story_intro",
  "knowledge_card",
  "quiz",
  "comparison",
  "timeline",
  "summary",
  "achievement",
]);

/** 描述页面在生成流水线中的当前阶段。 */
export const PageStatusSchema = z.enum([
  "planned",
  "generating",
  "ready",
  "failed",
]);

/** 描述页面在课程规划阶段需要的主要交互方式。 */
export const PageInteractionTypeSchema = z.enum([
  "none",
  "navigate",
  "reveal",
  "choice",
  "sort",
  "input",
  "explore",
]);

/**
 * 描述 Planner 预期后续素材 Agent 提供的素材。
 * 它表达“需要什么”，与已经落库的 assetIds 分离。
 */
export const PageAssetNeedSchema = z.object({
  type: AssetTypeSchema,
  role: AssetRoleSchema,
  purpose: z.string().min(2).max(240),
  required: z.boolean(),
});

/**
 * 保存 HTML Engineer Agent 的可版本化输出。
 * generatedAt 和 revision 用于缓存失效、审计和重新生成。
 */
export const HtmlOutputSchema = z.object({
  html: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  revision: z.number().int().positive(),
});

/**
 * 多页课程流水线使用的完整页面计划。
 * 它在 PagePlanDraft 基础上补充顺序、模板、素材、依赖和 HTML 状态。
 */
export const PagePlanSchema = z
  .object({
    id: z.string().min(1).max(80),
    order: z.number().int().positive(),
    pageType: PageTypeSchema,
    title: z.string().min(1).max(120),
    learningObjective: z.string().min(5).max(300),
    contentSummary: z.string().min(5).max(500),
    interactionType: PageInteractionTypeSchema,
    assetNeeds: z.array(PageAssetNeedSchema).max(12),
    functionalTemplateId: z.string().min(1).max(80),
    styleTemplateId: z.string().min(1).max(80),
    assetIds: z.array(z.string().min(1).max(80)).max(20),
    dependsOnPageIds: z.array(z.string().min(1).max(80)).max(20),
    usedReferences: z.array(ReferenceUsageSchema).max(12).optional(),
    status: PageStatusSchema,
    htmlOutput: HtmlOutputSchema.optional(),
  })
  .superRefine((page, context) => {
    // 重复引用会让下游重复加载或渲染同一素材。
    if (new Set(page.assetIds).size !== page.assetIds.length) {
      context.addIssue({
        code: "custom",
        message: "assetIds 不能包含重复 ID",
        path: ["assetIds"],
      });
    }

    // 页面依赖是集合语义，同一依赖只应出现一次。
    if (new Set(page.dependsOnPageIds).size !== page.dependsOnPageIds.length) {
      context.addIssue({
        code: "custom",
        message: "dependsOnPageIds 不能包含重复 ID",
        path: ["dependsOnPageIds"],
      });
    }

    // 自依赖会形成最小依赖环，使页面无法进入可执行状态。
    if (page.dependsOnPageIds.includes(page.id)) {
      context.addIssue({
        code: "custom",
        message: "页面不能依赖自身",
        path: ["dependsOnPageIds"],
      });
    }

    // ready 表示已经产生可交付结果，因此必须同时存在 HTML。
    if (page.status === "ready" && !page.htmlOutput) {
      context.addIssue({
        code: "custom",
        message: "ready 页面必须包含 htmlOutput",
        path: ["htmlOutput"],
      });
    }
  });

export type PageType = z.infer<typeof PageTypeSchema>;
export type PageStatus = z.infer<typeof PageStatusSchema>;
export type PageInteractionType = z.infer<typeof PageInteractionTypeSchema>;
export type PageAssetNeed = z.infer<typeof PageAssetNeedSchema>;
export type HtmlOutput = z.infer<typeof HtmlOutputSchema>;
export type PagePlan = z.infer<typeof PagePlanSchema>;
