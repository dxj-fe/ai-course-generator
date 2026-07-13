import { z } from "zod";

export const PagePlanSectionSchema = z.object({
  title: z.string().min(1).max(80),
  purpose: z.string().min(2).max(240),
});

export const PagePlanDraftSchema = z
  .object({
    title: z.string().min(2).max(120),
    learningObjective: z.string().min(5).max(300),
    sections: z.array(PagePlanSectionSchema).min(2).max(6),
    functionalTemplateId: z.string().min(1).optional(),
    styleTemplateId: z.string().min(1).optional(),
    visualDirection: z.string().min(5).max(300),
  })
  .refine(
    (plan) => Boolean(plan.functionalTemplateId || plan.styleTemplateId),
    {
      message: "functionalTemplateId 或 styleTemplateId 至少提供一个",
      path: ["functionalTemplateId"],
    },
  );

export type PagePlanDraft = z.infer<typeof PagePlanDraftSchema>;
