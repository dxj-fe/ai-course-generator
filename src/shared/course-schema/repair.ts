import { z } from "zod";

import { AssetGenerationResultSchema } from "./asset";
import { PageContentDSLSchema } from "./page-content-dsl";
import { QualityReportSchema } from "./quality";
import { VisualBriefSchema } from "./visual";

export const MAX_REPAIR_ROUNDS = 2;

export const RepairTargetArtifactSchema = z.enum(["dsl", "html"]);

export const RepairFailureClassSchema = z.enum([
  "unlocatable_issue",
  "unsupported_asset_issue",
  "scope_violation",
  "candidate_invalid",
  "budget_exhausted",
  "agent_failed",
]);

export const RepairRequestSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    targetArtifact: RepairTargetArtifactSchema,
    round: z.number().int().min(1).max(MAX_REPAIR_ROUNDS),
    maxRounds: z.literal(MAX_REPAIR_ROUNDS),
    sourceReport: QualityReportSchema,
    issueCodes: z.array(z.string().min(1).max(80)).min(1).max(20),
    allowedBlockIds: z.array(z.string().min(1).max(80)).max(20),
    allowedSelectors: z.array(z.string().min(1).max(240)).max(20),
    content: PageContentDSLSchema,
    html: z.string().min(1).max(200_000),
    visualBrief: VisualBriefSchema,
    assets: z.array(AssetGenerationResultSchema).max(12),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.sourceReport.target.type !== "page" ||
      request.sourceReport.target.pageId !== request.pageId ||
      request.content.pageId !== request.pageId
    ) {
      context.addIssue({
        code: "custom",
        message: "RepairRequest 的页面引用必须一致",
        path: ["pageId"],
      });
    }

    const reportCodes = new Set(request.sourceReport.issues.map(({ code }) => code));
    if (request.issueCodes.some((code) => !reportCodes.has(code))) {
      context.addIssue({
        code: "custom",
        message: "RepairRequest 只能引用来源 QualityReport 中的 issue code",
        path: ["issueCodes"],
      });
    }

    if (
      request.targetArtifact === "dsl" &&
      request.allowedBlockIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "DSL Repair 必须限定至少一个 blockId",
        path: ["allowedBlockIds"],
      });
    }
  });

export const HtmlRepairPatchSchema = z
  .object({
    issueCode: z.string().min(1).max(80),
    operation: z
      .enum(["replace", "insert_after_open_tag", "insert_before_close_tag"])
      .optional(),
    search: z.string().min(1).max(20_000).optional(),
    selector: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/i)
      .max(40)
      .optional(),
    replacement: z.string().max(20_000),
    summary: z.string().min(2).max(300),
  })
  .strict()
  .superRefine((patch, context) => {
    const operation = patch.operation ?? "replace";
    if (operation === "replace" && !patch.search) {
      context.addIssue({
        code: "custom",
        message: "replace patch 必须提供 search",
        path: ["search"],
      });
    }
    if (operation !== "replace" && !patch.selector) {
      context.addIssue({
        code: "custom",
        message: "tag boundary insert patch 必须提供 selector",
        path: ["selector"],
      });
    }
  });

const RepairResultBaseSchema = z.object({
  pageId: z.string().min(1).max(80),
  addressedIssueCodes: z.array(z.string().min(1).max(80)).min(1).max(20),
  unresolvedIssueCodes: z.array(z.string().min(1).max(80)).max(20),
  changeSummary: z.array(z.string().min(2).max(300)).min(1).max(10),
});

export const DslRepairResultSchema = RepairResultBaseSchema.extend({
  kind: z.literal("dsl_candidate"),
  targetArtifact: z.literal("dsl"),
  candidate: PageContentDSLSchema,
}).strict();

export const HtmlRepairResultSchema = RepairResultBaseSchema.extend({
  kind: z.literal("html_patch_candidate"),
  targetArtifact: z.literal("html"),
  patches: z.array(HtmlRepairPatchSchema).min(1).max(8),
}).strict();

export const DeclinedRepairResultSchema = z
  .object({
    kind: z.literal("declined"),
    pageId: z.string().min(1).max(80),
    targetArtifact: RepairTargetArtifactSchema,
    issueCodes: z.array(z.string().min(1).max(80)).min(1).max(20),
    failureClass: RepairFailureClassSchema,
    reasonSummary: z.string().min(2).max(500),
  })
  .strict();

export const RepairResultSchema = z.discriminatedUnion("kind", [
  DslRepairResultSchema,
  HtmlRepairResultSchema,
  DeclinedRepairResultSchema,
]);

export const RepairAttemptStatusSchema = z.enum([
  "running",
  "applied",
  "failed",
]);

/** 页面 checkpoint 中保存每轮来源报告和公开结果，不重复保存候选正文。 */
export const RepairAttemptRecordSchema = z
  .object({
    round: z.number().int().min(1).max(MAX_REPAIR_ROUNDS),
    sourceReport: QualityReportSchema,
    targetArtifact: RepairTargetArtifactSchema,
    issueCodes: z.array(z.string().min(1).max(80)).min(1).max(20),
    status: RepairAttemptStatusSchema,
    changeSummary: z.array(z.string().min(2).max(300)).max(10).default([]),
    failureClass: RepairFailureClassSchema.optional(),
    resultReportId: z.string().min(1).max(80).optional(),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.status !== "running" && !attempt.completedAt) {
      context.addIssue({
        code: "custom",
        message: "已结束的 Repair attempt 必须包含 completedAt",
        path: ["completedAt"],
      });
    }
    if (attempt.status === "failed" && !attempt.failureClass) {
      context.addIssue({
        code: "custom",
        message: "失败的 Repair attempt 必须包含 failureClass",
        path: ["failureClass"],
      });
    }
  });

export type RepairTargetArtifact = z.infer<typeof RepairTargetArtifactSchema>;
export type RepairFailureClass = z.infer<typeof RepairFailureClassSchema>;
export type RepairRequest = z.infer<typeof RepairRequestSchema>;
export type HtmlRepairPatch = z.infer<typeof HtmlRepairPatchSchema>;
export type DslRepairResult = z.infer<typeof DslRepairResultSchema>;
export type HtmlRepairResult = z.infer<typeof HtmlRepairResultSchema>;
export type DeclinedRepairResult = z.infer<typeof DeclinedRepairResultSchema>;
export type RepairResult = z.infer<typeof RepairResultSchema>;
export type RepairAttemptStatus = z.infer<typeof RepairAttemptStatusSchema>;
export type RepairAttemptRecord = z.infer<typeof RepairAttemptRecordSchema>;
