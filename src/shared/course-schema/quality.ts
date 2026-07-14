import { z } from "zod";

/** Quality Agent 对后续工作流给出的最终处理建议。 */
export const QualityDecisionSchema = z.enum(["pass", "revise", "fail"]);

/** 单个质量问题的严重程度，用于排序和 UI 告警。 */
export const QualitySeveritySchema = z.enum(["info", "warning", "error"]);

/** 页面质量报告固定比较的六个维度。 */
export const QualityDimensionNameSchema = z.enum([
  "contentAccuracy",
  "layoutQuality",
  "courseCoherence",
  "styleConsistency",
  "htmlRuntime",
  "assetUsability",
]);

/** 一个质量维度的量化得分和可读结论。 */
export const QualityDimensionSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(2).max(300),
});

/** Repair Agent 可直接消费的问题位置；description 为无法使用 selector 时的兜底。 */
export const QualityIssueLocationSchema = z
  .object({
    pageId: z.string().min(1).max(80).optional(),
    blockId: z.string().min(1).max(80).optional(),
    selector: z.string().min(1).max(240).optional(),
    viewport: z.string().min(1).max(80).optional(),
    description: z.string().min(2).max(240),
  })
  .strict();

/** 可定位、可修改并标明证据来源的具体质量问题。 */
export const QualityIssueSchema = z
  .object({
    code: z.string().min(1).max(80),
    dimension: QualityDimensionNameSchema,
    severity: QualitySeveritySchema,
    source: z.enum(["heuristic", "model"]),
    message: z.string().min(2).max(500),
    location: QualityIssueLocationSchema,
    repairHint: z.string().min(2).max(500),
  })
  .strict();

const QualityDimensionsSchema = z
  .object({
    contentAccuracy: QualityDimensionSchema,
    layoutQuality: QualityDimensionSchema,
    courseCoherence: QualityDimensionSchema,
    styleConsistency: QualityDimensionSchema,
    htmlRuntime: QualityDimensionSchema,
    assetUsability: QualityDimensionSchema,
  })
  .strict();

/**
 * QA 只描述页面现状和后续处理建议，不携带修复后的 HTML。
 * shouldRepair 由确定性门槛计算，不能与严重问题或 decision 相互矛盾。
 */
export const QualityReportSchema = z
  .object({
    id: z.string().min(1).max(80),
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("course"), courseId: z.string().min(1).max(80) }),
      z.object({ type: z.literal("page"), pageId: z.string().min(1).max(80) }),
    ]),
    overallScore: z.number().min(0).max(100),
    dimensions: QualityDimensionsSchema,
    issues: z.array(QualityIssueSchema).max(50),
    shouldRepair: z.boolean(),
    decision: QualityDecisionSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.issues.some(({ severity }) => severity === "error") &&
      !report.shouldRepair
    ) {
      context.addIssue({
        code: "custom",
        message: "存在 error 级问题时 shouldRepair 必须为 true",
        path: ["shouldRepair"],
      });
    }

    if (report.shouldRepair && report.decision === "pass") {
      context.addIssue({
        code: "custom",
        message: "shouldRepair 为 true 时 decision 不能是 pass",
        path: ["decision"],
      });
    }

    if (!report.shouldRepair && report.decision !== "pass") {
      context.addIssue({
        code: "custom",
        message: "无需修复的报告 decision 必须是 pass",
        path: ["decision"],
      });
    }
  });

export type QualityDecision = z.infer<typeof QualityDecisionSchema>;
export type QualitySeverity = z.infer<typeof QualitySeveritySchema>;
export type QualityDimensionName = z.infer<typeof QualityDimensionNameSchema>;
export type QualityDimension = z.infer<typeof QualityDimensionSchema>;
export type QualityIssueLocation = z.infer<typeof QualityIssueLocationSchema>;
export type QualityIssue = z.infer<typeof QualityIssueSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;
