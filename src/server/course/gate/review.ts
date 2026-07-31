import {
  CourseArchitectureSchema,
  CourseManifestSchema,
  CourseReviewSchema,
  PageSummarySchema,
  type CourseArchitecture,
  type CourseManifest,
  type CourseReview,
  type CourseRun,
  type PageSummary,
  type WorkOrder,
} from "@/shared/course-schema";
import { hashStorageValue } from "@/server/infra/database/codec";

export type CourseGateIssue = {
  code: string;
  path: string;
  message: string;
};

export type CourseGateResult =
  | { ok: true; manifest: CourseManifest; manifestHash: string }
  | { ok: false; issues: CourseGateIssue[] };

/** 从当前指针构造 Reviewer 唯一允许审查的页面版本集合。 */
export function buildCurrentCourseManifest(input: {
  run: CourseRun;
  architecture: CourseArchitecture;
}) {
  const architecture = CourseArchitectureSchema.parse(input.architecture);
  if (
    !input.run.activeArchitecture ||
    input.run.activeArchitecture.architectureRef.courseId !==
      architecture.courseId
  ) {
    throw new Error("CourseRun 当前架构与待构造 manifest 的架构不一致");
  }
  return CourseManifestSchema.parse({
    courseId: architecture.courseId,
    architectureRef: input.run.activeArchitecture.architectureRef,
    pages: [...architecture.pageTasks]
      .sort((left, right) => left.order - right.order)
      .map((page) => {
        const current = input.run.currentPages[page.pageId];
        if (!current) {
          throw new Error(`页面 ${page.pageId} 尚无 current accepted 版本`);
        }
        return {
          pageId: page.pageId,
          order: page.order,
          ...current,
        };
      }),
  });
}

export function computeCourseManifestHash(manifest: CourseManifest) {
  return hashStorageValue(CourseManifestSchema.parse(manifest));
}

/**
 * Reviewer 的结论必须覆盖当前 Blueprint 的全部目标，并且证据只能来自本次
 * manifest。这样旧页面或越权 Artifact 不能影响返工和发布决定。
 */
export function runCourseReviewGate(input: {
  architecture: CourseArchitecture;
  manifest: CourseManifest;
  pageSummaries: readonly PageSummary[];
  candidate: unknown;
}):
  | { ok: true; review: CourseReview; manifestHash: string }
  | { ok: false; issues: CourseGateIssue[] } {
  const architecture = CourseArchitectureSchema.parse(input.architecture);
  const manifest = CourseManifestSchema.parse(input.manifest);
  const parsedPageSummaries = PageSummarySchema.array().safeParse(
    input.pageSummaries,
  );
  if (!parsedPageSummaries.success) {
    return {
      ok: false,
      issues: parsedPageSummaries.error.issues.map((issue) => ({
        code: "COURSE_REVIEW_PAGE_SUMMARY_INVALID",
        path: `pageSummaries.${issue.path.join(".")}`,
        message: issue.message,
      })),
    };
  }
  const parsed = CourseReviewSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "COURSE_REVIEW_SCHEMA_INVALID",
        path: issue.path.join(".") || "root",
        message: issue.message,
      })),
    };
  }

  const review = parsed.data;
  const pageSummaries = parsedPageSummaries.data;
  const manifestHash = computeCourseManifestHash(manifest);
  const issues: CourseGateIssue[] = [];
  if (
    review.courseId !== architecture.courseId ||
    manifest.courseId !== architecture.courseId
  ) {
    issues.push({
      code: "COURSE_REVIEW_SCOPE_MISMATCH",
      path: "courseId",
      message: "Architecture、manifest 和 Review 必须属于同一课程",
    });
  }
  if (review.inputManifestHash !== manifestHash) {
    issues.push({
      code: "COURSE_REVIEW_MANIFEST_STALE",
      path: "inputManifestHash",
      message: "Review 引用的页面版本集合已经过期",
    });
  }

  const expectedObjectives = new Set(
    architecture.blueprint.objectives.map(({ id }) => id),
  );
  const actualObjectives = new Set(
    review.coverage.map(({ objectiveId }) => objectiveId),
  );
  if (
    expectedObjectives.size !== actualObjectives.size ||
    [...expectedObjectives].some((id) => !actualObjectives.has(id))
  ) {
    issues.push({
      code: "COURSE_REVIEW_COVERAGE_INCOMPLETE",
      path: "coverage",
      message: "Review 必须逐一检查当前 Blueprint 的全部学习目标",
    });
  }

  const pageIds = new Set(manifest.pages.map(({ pageId }) => pageId));
  const pageTasksById = new Map(
    architecture.pageTasks.map((pageTask) => [
      pageTask.pageId,
      pageTask,
    ]),
  );
  const pageSummariesById = new Map<string, PageSummary>();
  pageSummaries.forEach((summary, summaryIndex) => {
    if (pageSummariesById.has(summary.pageId)) {
      issues.push({
        code: "COURSE_REVIEW_DUPLICATE_PAGE_SUMMARY",
        path: `pageSummaries.${summaryIndex}.pageId`,
        message: `页面 ${summary.pageId} 只能提供一份当前摘要`,
      });
    }
    pageSummariesById.set(summary.pageId, summary);
    if (
      !pageIds.has(summary.pageId) ||
      summary.courseId !== manifest.courseId
    ) {
      issues.push({
        code: "COURSE_REVIEW_PAGE_SUMMARY_OUT_OF_SCOPE",
        path: `pageSummaries.${summaryIndex}`,
        message: `页面摘要 ${summary.pageId} 不属于当前 manifest`,
      });
    }
  });
  manifest.pages.forEach((page, pageIndex) => {
    if (!pageSummariesById.has(page.pageId)) {
      issues.push({
        code: "COURSE_REVIEW_PAGE_SUMMARY_MISSING",
        path: `manifest.pages.${pageIndex}.summaryRef`,
        message: `当前 manifest 缺少页面 ${page.pageId} 的实际摘要`,
      });
    }
  });

  for (const [coverageIndex, coverage] of review.coverage.entries()) {
    for (const [field, ids] of [
      ["teachingPageIds", coverage.teachingPageIds],
      ["assessmentPageIds", coverage.assessmentPageIds],
    ] as const) {
      ids.forEach((pageId, pageIndex) => {
        if (!pageIds.has(pageId)) {
          issues.push({
            code: "COURSE_REVIEW_UNKNOWN_PAGE",
            path: `coverage.${coverageIndex}.${field}.${pageIndex}`,
            message: `Review 引用了不在当前 manifest 中的页面 ${pageId}`,
          });
          return;
        }

        const pageTask = pageTasksById.get(pageId);
        const pageSummary = pageSummariesById.get(pageId);
        if (
          !pageTask?.objectiveIds.includes(coverage.objectiveId) ||
          !pageSummary?.objectiveIds.includes(coverage.objectiveId)
        ) {
          issues.push({
            code: "COURSE_REVIEW_OBJECTIVE_PAGE_MISMATCH",
            path: `coverage.${coverageIndex}.${field}.${pageIndex}`,
            message: `页面 ${pageId} 的当前 PageTask 和 PageSummary 没有共同承载目标 ${coverage.objectiveId}`,
          });
          return;
        }

        if (
          field === "assessmentPageIds" &&
          (!pageTask.assessment || !pageSummary.assessment)
        ) {
          issues.push({
            code: "COURSE_REVIEW_ASSESSMENT_PAGE_MISMATCH",
            path: `coverage.${coverageIndex}.${field}.${pageIndex}`,
            message: `页面 ${pageId} 没有同时具备 PageTask 考核要求和 PageSummary 实际考核证据`,
          });
        }
      });
    }
  }

  const evidenceById = new Map(
    [
      manifest.architectureRef,
      ...manifest.pages.flatMap((page) => [
        page.contentRef,
        ...(page.assetsRef ? [page.assetsRef] : []),
        page.htmlRef,
        page.qualityRef,
        page.summaryRef,
      ]),
    ].map((ref) => [ref.id, ref]),
  );
  review.issues.forEach((issue, issueIndex) => {
    const exactCurrentEvidence = issue.evidenceArtifactRefs.filter(
      (ref) => {
        const currentRef = evidenceById.get(ref.id);
        return currentRef
          ? sameArtifactRef(currentRef, ref)
          : false;
      },
    );
    issue.evidenceArtifactRefs.forEach((ref, refIndex) => {
      const currentRef = evidenceById.get(ref.id);
      if (!currentRef) {
        issues.push({
          code: "COURSE_REVIEW_EVIDENCE_OUT_OF_SCOPE",
          path: `issues.${issueIndex}.evidenceArtifactRefs.${refIndex}`,
          message: "Review 证据不属于当前 manifest",
        });
      } else if (!sameArtifactRef(currentRef, ref)) {
        issues.push({
          code: "COURSE_REVIEW_EVIDENCE_REF_MISMATCH",
          path: `issues.${issueIndex}.evidenceArtifactRefs.${refIndex}`,
          message: "Review 证据引用的版本、类型或内容哈希与当前 manifest 不一致",
        });
      }
    });
    if (exactCurrentEvidence.length === 0) {
      issues.push({
        code: "COURSE_REVIEW_CURRENT_EVIDENCE_REQUIRED",
        path: `issues.${issueIndex}.evidenceArtifactRefs`,
        message: "每个 Review issue 至少要引用一个当前 manifest 的精确证据",
      });
    }
    if (issue.scope === "page") {
      const manifestPage = manifest.pages.find(
        ({ pageId }) => pageId === issue.pageId,
      );
      if (!manifestPage) {
        issues.push({
          code: "COURSE_REVIEW_ISSUE_PAGE_OUT_OF_SCOPE",
          path: `issues.${issueIndex}.pageId`,
          message: `Review issue 引用了不在当前 manifest 中的页面 ${issue.pageId}`,
        });
        return;
      }
      const requiredPageEvidence = [
        manifestPage.summaryRef,
        manifestPage.qualityRef,
      ];
      if (
        !exactCurrentEvidence.some((ref) =>
          requiredPageEvidence.some((required) =>
            sameArtifactRef(required, ref),
          ),
        )
      ) {
        issues.push({
          code: "COURSE_REVIEW_PAGE_EVIDENCE_REQUIRED",
          path: `issues.${issueIndex}.evidenceArtifactRefs`,
          message: `页面问题必须引用页面 ${issue.pageId} 当前的 PageSummary 或 PageQuality`,
        });
      }
    } else {
      const allowedCourseEvidenceKinds = new Set([
        "course_architecture",
        "page_summary",
        "page_quality",
      ]);
      if (
        exactCurrentEvidence.some(
          (ref) => !allowedCourseEvidenceKinds.has(ref.kind),
        )
      ) {
        issues.push({
          code: "COURSE_REVIEW_COURSE_EVIDENCE_KIND_INVALID",
          path: `issues.${issueIndex}.evidenceArtifactRefs`,
          message:
            "课程级问题不能由 PageContent、PageAssets 或 PageHTML 支撑",
        });
      }
      if (
        !exactCurrentEvidence.some((ref) =>
          allowedCourseEvidenceKinds.has(ref.kind),
        )
      ) {
        issues.push({
          code: "COURSE_REVIEW_COURSE_EVIDENCE_REQUIRED",
          path: `issues.${issueIndex}.evidenceArtifactRefs`,
          message:
            "课程级问题至少要引用当前 CourseArchitecture、PageSummary 或 PageQuality",
        });
      }
    }
  });

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, review, manifestHash };
}

function sameArtifactRef(
  left: CourseManifest["architectureRef"],
  right: CourseManifest["architectureRef"],
) {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.courseId === right.courseId &&
    left.pageId === right.pageId &&
    left.scopeKey === right.scopeKey &&
    left.revision === right.revision &&
    left.contentHash === right.contentHash
  );
}

/**
 * Final Gate 只认 CourseRun 当前指针，不统计历史上曾 accepted 的页面单。
 */
export function runFinalCourseGate(input: {
  run: CourseRun;
  architecture: CourseArchitecture;
  review: CourseReview;
  pageSummaries: readonly PageSummary[];
  workOrders: readonly WorkOrder[];
}): CourseGateResult {
  let manifest: CourseManifest;
  try {
    manifest = buildCurrentCourseManifest({
      run: input.run,
      architecture: input.architecture,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: "FINAL_MANIFEST_INVALID",
          path: "run.currentPages",
          message:
            error instanceof Error ? error.message : "无法构造当前 manifest",
        },
      ],
    };
  }
  const manifestHash = computeCourseManifestHash(manifest);
  const issues: CourseGateIssue[] = [];
  const reviewGate = runCourseReviewGate({
    architecture: input.architecture,
    manifest,
    pageSummaries: input.pageSummaries,
    candidate: input.review,
  });
  if (!reviewGate.ok) issues.push(...reviewGate.issues);

  if (input.run.stalePageIds.length > 0) {
    issues.push({
      code: "FINAL_STALE_PAGES",
      path: "run.stalePageIds",
      message: "仍有过期页面，不能发布课程",
    });
  }
  if (
    input.run.currentManifestHash !== manifestHash ||
    input.run.currentReview?.inputManifestHash !== manifestHash
  ) {
    issues.push({
      code: "FINAL_REVIEW_STALE",
      path: "run.currentReview",
      message: "当前 Review 与 current 页面版本不一致",
    });
  }
  if (
    input.review.decision !== "pass" ||
    !input.run.currentReview ||
    input.run.currentReview.artifactRef.kind !== "course_review"
  ) {
    issues.push({
      code: "FINAL_REVIEW_NOT_PASSED",
      path: "review.decision",
      message: "只有当前整课 Review 明确通过才能发布",
    });
  }

  const workOrderById = new Map(
    input.workOrders.map((workOrder) => [workOrder.id, workOrder]),
  );
  if (
    input.run.activeArchitecture &&
    workOrderById.get(input.run.activeArchitecture.submissionWorkOrderId)
      ?.status !== "accepted"
  ) {
    issues.push({
      code: "FINAL_ARCHITECTURE_NOT_ACCEPTED",
      path: "run.activeArchitecture",
      message: "当前课程架构尚未由主 Agent 接受",
    });
  }
  manifest.pages.forEach((page, index) => {
    const workOrder = workOrderById.get(page.sourceWorkOrderId);
    if (
      workOrder?.status !== "accepted" ||
      !workOrder.inputArtifactRefs.some(
        (ref) => ref.id === manifest.architectureRef.id,
      )
    ) {
      issues.push({
        code: "FINAL_PAGE_NOT_CURRENT_ACCEPTED",
        path: `pages.${index}`,
        message: `页面 ${page.pageId} 的 current 版本不是当前架构下已接受的页面产物`,
      });
    }
  });

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, manifest, manifestHash };
}
