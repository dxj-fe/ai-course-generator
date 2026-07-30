import { z } from "zod";

import { ArtifactRefSchema } from "./course-artifact";
import { CourseIdSchema } from "./course-generation-state";

export const CourseReviewDecisionSchema = z.enum([
  "pass",
  "revise_pages",
  "replan",
]);

export const CourseReviewIssueTargetArtifactSchema = z.enum([
  "page_content",
  "page_html",
]);

export const CourseReviewCoverageStatusSchema = z.enum([
  "covered",
  "weak",
  "missing",
]);

export const CourseReviewCoverageSchema = z
  .object({
    objectiveId: z.string().min(1).max(80),
    teachingPageIds: z.array(z.string().min(1).max(80)).max(200),
    assessmentPageIds: z.array(z.string().min(1).max(80)).max(200),
    status: CourseReviewCoverageStatusSchema,
  })
  .strict()
  .superRefine((coverage, context) => {
    for (const field of ["teachingPageIds", "assessmentPageIds"] as const) {
      if (new Set(coverage[field]).size !== coverage[field].length) {
        context.addIssue({
          code: "custom",
          message: `${field} 不能包含重复页面`,
          path: [field],
        });
      }
    }
    if (
      coverage.status === "covered" &&
      (coverage.teachingPageIds.length === 0 ||
        coverage.assessmentPageIds.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "covered 目标必须同时有教学页面和证据页面",
        path: ["status"],
      });
    }
  });

export const CourseReviewIssueSchema = z
  .object({
    id: z.string().min(1).max(160),
    scope: z.enum(["course", "page"]),
    pageId: z.string().min(1).max(80).optional(),
    code: z.string().min(1).max(100),
    severity: z.enum(["warning", "error"]),
    message: z.string().trim().min(1).max(1_000),
    targetArtifact: CourseReviewIssueTargetArtifactSchema.optional(),
    evidenceArtifactRefs: z.array(ArtifactRefSchema).min(1).max(100),
    suggestedAction: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((issue, context) => {
    if (issue.scope === "page" && !issue.pageId) {
      context.addIssue({
        code: "custom",
        message: "页面问题必须包含 pageId",
        path: ["pageId"],
      });
    }
    if (issue.scope === "course" && issue.pageId) {
      context.addIssue({
        code: "custom",
        message: "课程级问题不能包含 pageId",
        path: ["pageId"],
      });
    }
    if (issue.scope === "page" && !issue.targetArtifact) {
      context.addIssue({
        code: "custom",
        message:
          "页面问题必须明确指定 page_content 或 page_html 修订目标",
        path: ["targetArtifact"],
      });
    }
    if (issue.scope === "course" && issue.targetArtifact) {
      context.addIssue({
        code: "custom",
        message: "课程级问题不能指定页面 Artifact 修订目标",
        path: ["targetArtifact"],
      });
    }
    if (
      issue.scope === "course" &&
      issue.evidenceArtifactRefs.some(
        (artifact) =>
          artifact.kind !== "course_architecture" &&
          artifact.kind !== "page_summary" &&
          artifact.kind !== "page_quality",
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "课程级问题只能引用 CourseArchitecture、PageSummary 或 PageQuality",
        path: ["evidenceArtifactRefs"],
      });
    }
    if (
      issue.scope === "page" &&
      !issue.evidenceArtifactRefs.some(
        (artifact) =>
          artifact.pageId === issue.pageId &&
          (artifact.kind === "page_summary" ||
            artifact.kind === "page_quality"),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "页面问题必须包含当前页面的 PageSummary 或 PageQuality 证据",
        path: ["evidenceArtifactRefs"],
      });
    }
  });

export const CourseReviewSchema = z
  .object({
    version: z.literal(1),
    courseId: CourseIdSchema,
    inputManifestHash: z.string().min(8).max(160),
    decision: CourseReviewDecisionSchema,
    coverage: z.array(CourseReviewCoverageSchema).min(1).max(100),
    issues: z.array(CourseReviewIssueSchema).max(200),
    summary: z.string().trim().min(2).max(2_000),
  })
  .strict()
  .superRefine((review, context) => {
    if (
      new Set(review.coverage.map(({ objectiveId }) => objectiveId)).size !==
      review.coverage.length
    ) {
      context.addIssue({
        code: "custom",
        message: "同一学习目标只能出现一条 coverage",
        path: ["coverage"],
      });
    }
    if (
      new Set(review.issues.map(({ id }) => id)).size !== review.issues.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Review issue ID 不能重复",
        path: ["issues"],
      });
    }

    review.issues.forEach((issue, issueIndex) => {
      issue.evidenceArtifactRefs.forEach((artifact, artifactIndex) => {
        if (artifact.courseId !== review.courseId) {
          context.addIssue({
            code: "custom",
            message: "Review 证据必须属于当前课程",
            path: [
              "issues",
              issueIndex,
              "evidenceArtifactRefs",
              artifactIndex,
              "courseId",
            ],
          });
        }
      });
    });

    if (
      review.decision === "pass" &&
      (review.issues.some(({ severity }) => severity === "error") ||
        review.coverage.some(({ status }) => status !== "covered"))
    ) {
      context.addIssue({
        code: "custom",
        message: "存在错误或目标缺口时不能给出 pass",
        path: ["decision"],
      });
    }
    if (
      review.decision === "revise_pages" &&
      !review.issues.some(({ scope }) => scope === "page")
    ) {
      context.addIssue({
        code: "custom",
        message: "revise_pages 必须指出至少一个具体页面问题",
        path: ["issues"],
      });
    }
    if (
      review.decision === "replan" &&
      !review.issues.some(({ scope }) => scope === "course")
    ) {
      context.addIssue({
        code: "custom",
        message: "replan 必须指出至少一个课程级架构问题",
        path: ["issues"],
      });
    }
  });

export type CourseReviewDecision = z.infer<
  typeof CourseReviewDecisionSchema
>;
export type CourseReviewIssueTargetArtifact = z.infer<
  typeof CourseReviewIssueTargetArtifactSchema
>;
export type CourseReviewCoverageStatus = z.infer<
  typeof CourseReviewCoverageStatusSchema
>;
export type CourseReviewCoverage = z.infer<typeof CourseReviewCoverageSchema>;
export type CourseReviewIssue = z.infer<typeof CourseReviewIssueSchema>;
export type CourseReview = z.infer<typeof CourseReviewSchema>;
