import { z } from "zod";

/** Quality Agent 对后续工作流给出的最终处理建议。 */
export const QualityDecisionSchema = z.enum(["pass", "revise", "fail"]);

/** 单个质量问题的严重程度，用于排序和 UI 告警。 */
export const QualitySeveritySchema = z.enum(["info", "warning", "error"]);

/** 一个质量维度的量化得分和可读结论。 */
export const QualityDimensionSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(2).max(300),
});

/** 可定位、可修改的具体质量问题。 */
export const QualityIssueSchema = z.object({
  code: z.string().min(1).max(80),
  severity: QualitySeveritySchema,
  message: z.string().min(2).max(500),
  suggestion: z.string().min(2).max(500),
  pageId: z.string().min(1).max(80).optional(),
});

/**
 * Quality Agent 的结构化输出，可指向整门课程或单个页面。
 * 固定维度保证不同版本的报告可以比较，issues 用于驱动修改闭环。
 */
export const QualityReportSchema = z.object({
  id: z.string().min(1).max(80),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("course"), courseId: z.string().min(1).max(80) }),
    z.object({ type: z.literal("page"), pageId: z.string().min(1).max(80) }),
  ]),
  overallScore: z.number().min(0).max(100),
  dimensions: z.object({
    contentAccuracy: QualityDimensionSchema,
    layoutQuality: QualityDimensionSchema,
    courseCoherence: QualityDimensionSchema,
    styleConsistency: QualityDimensionSchema,
  }),
  issues: z.array(QualityIssueSchema).max(50),
  decision: QualityDecisionSchema,
  createdAt: z.string().datetime({ offset: true }),
});

export type QualityDecision = z.infer<typeof QualityDecisionSchema>;
export type QualitySeverity = z.infer<typeof QualitySeveritySchema>;
export type QualityDimension = z.infer<typeof QualityDimensionSchema>;
export type QualityIssue = z.infer<typeof QualityIssueSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;
