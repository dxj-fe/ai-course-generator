import { z } from "zod";

import { ArtifactRefSchema, type ArtifactKind } from "./course-artifact";
import { CourseGenerationCauseCodeSchema, CourseIdSchema } from "./course-generation-state";
import { CourseReviewDecisionSchema } from "./course-review";
import { CourseTaskIdSchema } from "./course-task-event";
import { WorkOrderStatusSchema } from "./work-order";

export const CourseRunPhaseSchema = z.enum([
  "planning",
  "building",
  "reviewing",
  "revising",
  "completed",
  "failed",
  "cancelled",
]);

export const ActiveArchitectureSchema = z
  .object({
    submissionWorkOrderId: z.string().min(1).max(160),
    architectureRef: ArtifactRefSchema,
  })
  .strict()
  .superRefine((architecture, context) => {
    requireArtifactKind(
      architecture.architectureRef.kind,
      "course_architecture",
      ["architectureRef", "kind"],
      context,
    );
  });

export const CurrentPageArtifactsSchema = z
  .object({
    sourceWorkOrderId: z.string().min(1).max(160),
    contentRef: ArtifactRefSchema,
    assetsRef: ArtifactRefSchema.optional(),
    htmlRef: ArtifactRefSchema,
    qualityRef: ArtifactRefSchema,
    summaryRef: ArtifactRefSchema,
  })
  .strict()
  .superRefine((page, context) => {
    for (const [field, artifact, kind] of [
      ["contentRef", page.contentRef, "page_content"],
      ["assetsRef", page.assetsRef, "page_assets"],
      ["htmlRef", page.htmlRef, "page_html"],
      ["qualityRef", page.qualityRef, "page_quality"],
      ["summaryRef", page.summaryRef, "page_summary"],
    ] as const) {
      if (artifact) {
        requireArtifactKind(artifact.kind, kind, [field, "kind"], context);
      }
    }
  });

export const CurrentCourseReviewSchema = z
  .object({
    workOrderId: z.string().min(1).max(160),
    artifactRef: ArtifactRefSchema,
    inputManifestHash: z.string().min(8).max(160),
  })
  .strict()
  .superRefine((review, context) => {
    requireArtifactKind(
      review.artifactRef.kind,
      "course_review",
      ["artifactRef", "kind"],
      context,
    );
  });

export const CourseRunErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    causeCode: CourseGenerationCauseCodeSchema.optional(),
    message: z.string().min(1).max(1_000),
  })
  .strict();

export const CourseRunSchema = z
  .object({
    id: z.string().min(1).max(160),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    lockVersion: z.number().int().nonnegative(),
    phase: CourseRunPhaseSchema,
    traceId: z.string().min(1).max(160),
    leaseOwner: z.string().min(1).max(160).optional(),
    leaseExpiresAt: z.string().datetime({ offset: true }).optional(),
    planningRevision: z.number().int().nonnegative(),
    activeArchitecture: ActiveArchitectureSchema.optional(),
    currentPages: z.record(
      z.string().min(1).max(80),
      CurrentPageArtifactsSchema,
    ),
    stalePageIds: z.array(z.string().min(1).max(80)).max(200),
    currentManifestHash: z.string().min(8).max(160).optional(),
    currentReview: CurrentCourseReviewSchema.optional(),
    replanRound: z.number().int().nonnegative(),
    courseRevisionRound: z.number().int().nonnegative(),
    error: CourseRunErrorSchema.optional(),
  })
  .strict()
  .superRefine((run, context) => {
    if (Boolean(run.leaseOwner) !== Boolean(run.leaseExpiresAt)) {
      context.addIssue({
        code: "custom",
        message: "CourseRun leaseOwner 与 leaseExpiresAt 必须同时存在或同时为空",
        path: ["leaseOwner"],
      });
    }

    if (
      run.activeArchitecture &&
      run.activeArchitecture.architectureRef.courseId !== run.courseId
    ) {
      context.addIssue({
        code: "custom",
        message: "当前课程架构 Artifact 必须属于当前课程",
        path: ["activeArchitecture", "architectureRef", "courseId"],
      });
    }

    for (const [pageId, page] of Object.entries(run.currentPages)) {
      for (const [field, artifact] of [
        ["contentRef", page.contentRef],
        ["assetsRef", page.assetsRef],
        ["htmlRef", page.htmlRef],
        ["qualityRef", page.qualityRef],
        ["summaryRef", page.summaryRef],
      ] as const) {
        if (!artifact) continue;
        if (artifact.courseId !== run.courseId || artifact.pageId !== pageId) {
          context.addIssue({
            code: "custom",
            message: "currentPages 的 Artifact 必须属于记录键对应的课程页面",
            path: ["currentPages", pageId, field],
          });
        }
      }
    }

    if (new Set(run.stalePageIds).size !== run.stalePageIds.length) {
      context.addIssue({
        code: "custom",
        message: "stalePageIds 不能包含重复页面",
        path: ["stalePageIds"],
      });
    }

    if (run.currentReview) {
      if (run.currentReview.artifactRef.courseId !== run.courseId) {
        context.addIssue({
          code: "custom",
          message: "当前 Review Artifact 必须属于当前课程",
          path: ["currentReview", "artifactRef", "courseId"],
        });
      }
      if (
        !run.currentManifestHash ||
        run.currentReview.inputManifestHash !== run.currentManifestHash
      ) {
        context.addIssue({
          code: "custom",
          message: "当前 Review 必须固定引用当前 manifest hash",
          path: ["currentReview", "inputManifestHash"],
        });
      }
    }

    if (
      run.phase === "completed" &&
      (!run.activeArchitecture ||
        !run.currentReview ||
        !run.currentManifestHash ||
        run.stalePageIds.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "completed CourseRun 必须具备架构、当前 Review、manifest 且没有 stale 页面",
        path: ["phase"],
      });
    }
    if (run.phase === "failed" && !run.error) {
      context.addIssue({
        code: "custom",
        message: "failed CourseRun 必须包含 error",
        path: ["error"],
      });
    }
  });

const RunSummaryBlueprintSchema = z
  .object({
    workOrderId: z.string().min(1).max(160),
    status: WorkOrderStatusSchema,
    artifactRef: ArtifactRefSchema.optional(),
    summary: z.string().min(1).max(1_000).optional(),
    issues: z.array(z.string().min(1).max(1_000)).max(100),
  })
  .strict();

const RunSummaryPageSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    order: z.number().int().positive(),
    workOrderId: z.string().min(1).max(160).optional(),
    status: z.union([WorkOrderStatusSchema, z.literal("not_created")]),
    artifactRefs: z.array(ArtifactRefSchema).max(100),
    qualitySummary: z.string().min(1).max(1_000).optional(),
    issues: z.array(z.string().min(1).max(1_000)).max(100),
  })
  .strict();

const RunSummaryReviewSchema = z
  .object({
    workOrderId: z.string().min(1).max(160),
    status: WorkOrderStatusSchema,
    artifactRef: ArtifactRefSchema.optional(),
    decision: CourseReviewDecisionSchema.optional(),
    issueIds: z.array(z.string().min(1).max(160)).max(200),
  })
  .strict();

export const RunSummarySchema = z
  .object({
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    phase: CourseRunPhaseSchema,
    blueprint: RunSummaryBlueprintSchema.optional(),
    pages: z.array(RunSummaryPageSchema).max(200),
    review: RunSummaryReviewSchema.optional(),
    remainingBudget: z
      .object({
        architectureRevisionRounds: z.number().int().nonnegative(),
        replanRounds: z.number().int().nonnegative(),
        courseRevisionRounds: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((summary, context) => {
    const pageIds = summary.pages.map(({ pageId }) => pageId);
    const pageOrders = summary.pages.map(({ order }) => order);
    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "RunSummary 不能包含重复 pageId",
        path: ["pages"],
      });
    }
    if (new Set(pageOrders).size !== pageOrders.length) {
      context.addIssue({
        code: "custom",
        message: "RunSummary 不能包含重复页面顺序",
        path: ["pages"],
      });
    }
  });

function requireArtifactKind(
  actual: ArtifactKind,
  expected: ArtifactKind,
  path: Array<string | number>,
  context: z.RefinementCtx,
) {
  if (actual !== expected) {
    context.addIssue({
      code: "custom",
      message: `Artifact kind 必须为 ${expected}`,
      path,
    });
  }
}

export type CourseRunPhase = z.infer<typeof CourseRunPhaseSchema>;
export type ActiveArchitecture = z.infer<typeof ActiveArchitectureSchema>;
export type CurrentPageArtifacts = z.infer<
  typeof CurrentPageArtifactsSchema
>;
export type CurrentCourseReview = z.infer<typeof CurrentCourseReviewSchema>;
export type CourseRunError = z.infer<typeof CourseRunErrorSchema>;
export type CourseRun = z.infer<typeof CourseRunSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
