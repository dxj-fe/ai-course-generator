import { describe, expect, it } from "vitest";

import {
  computeCourseManifestHash,
  runCourseReviewGate,
} from "../../../../src/server/course/gate/review";
import {
  CourseReviewIssueSchema,
  type ArtifactKind,
  type ArtifactRef,
  type CourseArchitecture,
  type CourseManifest,
  type PageSummary,
} from "../../../../src/shared/course-schema";
import { createAgentV2Architecture } from "../../../fixtures/agent-v2-course-architecture";

describe("Course Review Gate 目标证据", () => {
  it("页面 issue 必须显式给出机器可判定的修订目标，课程 issue 禁止该字段", () => {
    const prepared = prepareGateInput();
    const evidence = prepared.manifest.pages[0]!.summaryRef;
    const base = {
      id: "issue-target-contract",
      code: "TARGET_CONTRACT",
      severity: "error" as const,
      message: "测试修订目标合同。",
      evidenceArtifactRefs: [evidence],
      suggestedAction: "测试不能依赖这段文案推断目标。",
    };

    expect(
      CourseReviewIssueSchema.safeParse({
        ...base,
        scope: "page",
        pageId: prepared.manifest.pages[0]!.pageId,
      }).success,
    ).toBe(false);
    expect(
      CourseReviewIssueSchema.safeParse({
        ...base,
        scope: "page",
        pageId: prepared.manifest.pages[0]!.pageId,
        targetArtifact: "page_content",
      }).success,
    ).toBe(true);
    expect(
      CourseReviewIssueSchema.safeParse({
        ...base,
        scope: "course",
        targetArtifact: "page_html",
        evidenceArtifactRefs: [prepared.manifest.architectureRef],
      }).success,
    ).toBe(false);
  });

  it("Schema 拒绝没有任何 ArtifactRef 的 issue", () => {
    const prepared = prepareGateInput();
    const issue = {
      id: "issue-empty-evidence",
      scope: "page" as const,
      pageId: "page-concept",
      code: "NO_EVIDENCE",
      severity: "error",
      message: "没有证据的页面结论。",
      targetArtifact: "page_content",
      evidenceArtifactRefs: [],
      suggestedAction: "补充当前页面证据。",
    };
    const result = CourseReviewIssueSchema.safeParse(issue);

    expect(result.success).toBe(false);
    expect(
      runCourseReviewGate({
        architecture: prepared.architecture,
        manifest: prepared.manifest,
        pageSummaries: prepared.pageSummaries,
        candidate: {
          ...reviewCandidate(
            prepared.architecture,
            prepared.manifest,
            {
              teachingPageIds: ["page-concept"],
              assessmentPageIds: ["page-practice"],
            },
          ),
          decision: "revise_pages",
          issues: [issue],
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("Schema 拒绝用其他页面证据支撑当前页面 issue", () => {
    const prepared = prepareGateInput();
    const wrongPageEvidence = prepared.manifest.pages.find(
      ({ pageId }) => pageId === "page-practice",
    )!.qualityRef;
    const issue = {
      id: "issue-wrong-page-evidence",
      scope: "page" as const,
      pageId: "page-concept",
      code: "WRONG_PAGE_EVIDENCE",
      severity: "error",
      message: "概念页存在问题。",
      targetArtifact: "page_content",
      evidenceArtifactRefs: [wrongPageEvidence],
      suggestedAction: "修复概念页。",
    };
    const result = CourseReviewIssueSchema.safeParse(issue);

    expect(result.success).toBe(false);
    expect(
      runCourseReviewGate({
        architecture: prepared.architecture,
        manifest: prepared.manifest,
        pageSummaries: prepared.pageSummaries,
        candidate: {
          ...reviewCandidate(
            prepared.architecture,
            prepared.manifest,
            {
              teachingPageIds: ["page-concept"],
              assessmentPageIds: ["page-practice"],
            },
          ),
          decision: "revise_pages",
          issues: [issue],
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("跨页问题可以附带其他页证据，但必须同时包含当前页摘要或质量证据", () => {
    const prepared = prepareGateInput();
    const currentPage = prepared.manifest.pages.find(
      ({ pageId }) => pageId === "page-concept",
    )!;
    const otherPage = prepared.manifest.pages.find(
      ({ pageId }) => pageId === "page-practice",
    )!;
    const result = CourseReviewIssueSchema.safeParse({
      id: "issue-cross-page-evidence",
      scope: "page",
      pageId: "page-concept",
      code: "CROSS_PAGE_DUPLICATE",
      severity: "error",
      message: "概念页和练习页内容重复。",
      targetArtifact: "page_content",
      evidenceArtifactRefs: [
        currentPage.summaryRef,
        otherPage.summaryRef,
      ],
      suggestedAction: "保留练习页职责，重写概念页。",
    });

    expect(result.success).toBe(true);
  });

  it("assessmentPageIds 不能用没有计划考核和实际考核证据的页面冒充", () => {
    const prepared = prepareGateInput();
    const result = runCourseReviewGate({
      architecture: prepared.architecture,
      manifest: prepared.manifest,
      pageSummaries: prepared.pageSummaries,
      candidate: reviewCandidate(
        prepared.architecture,
        prepared.manifest,
        {
          teachingPageIds: ["page-concept"],
          assessmentPageIds: ["page-cover"],
        },
      ),
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("测试预期 Course Review Gate 失败");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COURSE_REVIEW_ASSESSMENT_PAGE_MISMATCH",
          path: "coverage.0.assessmentPageIds.0",
        }),
      ]),
    );
  });

  it("teachingPageIds 必须同时得到 PageTask 和当前 PageSummary 的目标映射支持", () => {
    const prepared = prepareGateInput();
    const pageSummaries = prepared.pageSummaries.map((summary) =>
      summary.pageId === "page-concept"
        ? { ...summary, objectiveIds: ["objective-forged"] }
        : summary,
    );
    const result = runCourseReviewGate({
      architecture: prepared.architecture,
      manifest: prepared.manifest,
      pageSummaries,
      candidate: reviewCandidate(
        prepared.architecture,
        prepared.manifest,
        {
          teachingPageIds: ["page-concept"],
          assessmentPageIds: ["page-practice"],
        },
      ),
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("测试预期 Course Review Gate 失败");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COURSE_REVIEW_OBJECTIVE_PAGE_MISMATCH",
          path: "coverage.0.teachingPageIds.0",
        }),
      ]),
    );
  });

  it("Review 证据不能只复用当前 ID 并伪造版本或内容哈希", () => {
    const prepared = prepareGateInput();
    const qualityRef = prepared.manifest.pages[1]!.qualityRef;
    const candidate = {
      ...reviewCandidate(
        prepared.architecture,
        prepared.manifest,
        {
          teachingPageIds: ["page-concept"],
          assessmentPageIds: ["page-practice"],
        },
      ),
      decision: "revise_pages",
      issues: [
        {
          id: "issue-forged-evidence",
          scope: "page",
          pageId: "page-concept",
          code: "FORGED_EVIDENCE",
          severity: "error",
          message: "测试伪造证据引用。",
          targetArtifact: "page_content",
          evidenceArtifactRefs: [
            {
              ...qualityRef,
              version: qualityRef.version + 1,
              contentHash: "forged-content-hash",
            },
          ],
          suggestedAction: "拒绝伪造证据。",
        },
      ],
      summary: "测试证据引用必须精确匹配。",
    };
    const result = runCourseReviewGate({
      architecture: prepared.architecture,
      manifest: prepared.manifest,
      pageSummaries: prepared.pageSummaries,
      candidate,
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("测试预期 Course Review Gate 失败");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COURSE_REVIEW_EVIDENCE_REF_MISMATCH",
        }),
      ]),
    );
  });

  it("课程级 issue 只有历史或越界引用时 Gate 判定为没有当前证据", () => {
    const prepared = prepareGateInput();
    const candidate = {
      ...reviewCandidate(
        prepared.architecture,
        prepared.manifest,
        {
          teachingPageIds: ["page-concept"],
          assessmentPageIds: ["page-practice"],
        },
      ),
      decision: "replan",
      issues: [
        {
          id: "issue-stale-course-evidence",
          scope: "course",
          code: "COURSE_STRUCTURE_STALE",
          severity: "error",
          message: "课程结构证据已经过期。",
          evidenceArtifactRefs: [
            {
              ...prepared.manifest.architectureRef,
              id: "historical-course-architecture",
              version: prepared.manifest.architectureRef.version + 1,
              contentHash: "historical-content-hash",
            },
          ],
          suggestedAction: "重新检查当前整课结构。",
        },
      ],
      summary: "课程级结论必须有当前证据。",
    };
    const result = runCourseReviewGate({
      architecture: prepared.architecture,
      manifest: prepared.manifest,
      pageSummaries: prepared.pageSummaries,
      candidate,
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("测试预期 Course Review Gate 失败");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COURSE_REVIEW_CURRENT_EVIDENCE_REQUIRED",
        }),
      ]),
    );
  });

  it("课程级 issue 不能只引用当前 PageHTML", () => {
    const prepared = prepareGateInput();
    const htmlRef = prepared.manifest.pages.find(
      ({ pageId }) => pageId === "page-concept",
    )!.htmlRef;
    const issue = {
      id: "issue-html-only-course-evidence",
      scope: "course" as const,
      code: "COURSE_FLOW_WEAK",
      severity: "error" as const,
      message: "仅凭 HTML 不能证明课程架构问题。",
      evidenceArtifactRefs: [htmlRef],
      suggestedAction: "读取当前架构、摘要或质量证据。",
    };

    expect(CourseReviewIssueSchema.safeParse(issue).success).toBe(false);
    expect(
      runCourseReviewGate({
        architecture: prepared.architecture,
        manifest: prepared.manifest,
        pageSummaries: prepared.pageSummaries,
        candidate: {
          ...reviewCandidate(
            prepared.architecture,
            prepared.manifest,
            {
              teachingPageIds: ["page-concept"],
              assessmentPageIds: ["page-practice"],
            },
          ),
          decision: "replan",
          issues: [issue],
        },
      }),
    ).toMatchObject({ ok: false });
  });
});

function prepareGateInput() {
  const architecture = createAgentV2Architecture();
  const manifest: CourseManifest = {
    version: 1,
    courseId: architecture.courseId,
    architectureRef: artifactRef(
      architecture.courseId,
      "course_architecture",
    ),
    pages: architecture.pageTasks.map((pageTask) => ({
      pageId: pageTask.pageId,
      order: pageTask.order,
      sourceWorkOrderId: `work-order-${pageTask.pageId}`,
      contentRef: artifactRef(
        architecture.courseId,
        "page_content",
        pageTask.pageId,
      ),
      htmlRef: artifactRef(
        architecture.courseId,
        "page_html",
        pageTask.pageId,
      ),
      qualityRef: artifactRef(
        architecture.courseId,
        "page_quality",
        pageTask.pageId,
      ),
      summaryRef: artifactRef(
        architecture.courseId,
        "page_summary",
        pageTask.pageId,
      ),
    })),
  };
  const pageSummaries: PageSummary[] = architecture.pageTasks.map(
    (pageTask) => ({
      version: 1,
      courseId: architecture.courseId,
      pageId: pageTask.pageId,
      order: pageTask.order,
      title: pageTask.title,
      purpose: pageTask.purpose,
      objectiveIds: pageTask.objectiveIds,
      buildDependencyPageIds: pageTask.buildDependsOnPageIds,
      keyPoints: pageTask.teachingPoints,
      contentDigest: `${pageTask.title}：${pageTask.teachingPoints.join("；")}`,
      learnerAction: pageTask.learnerAction,
      assessment: pageTask.assessment,
      interactionType: pageTask.interactionType,
      usedReferences: pageTask.referenceUsages,
      quality: {
        overallScore: 96,
        decision: "pass",
        issueCodes: [],
      },
    }),
  );
  return { architecture, manifest, pageSummaries };
}

function reviewCandidate(
  architecture: CourseArchitecture,
  manifest: CourseManifest,
  coverage: {
    assessmentPageIds: string[];
    teachingPageIds: string[];
  },
) {
  return {
    version: 1,
    courseId: architecture.courseId,
    inputManifestHash: computeCourseManifestHash(manifest),
    decision: "pass",
    coverage: architecture.blueprint.objectives.map(({ id }) => ({
      objectiveId: id,
      ...coverage,
      status: "covered",
    })),
    issues: [],
    summary: "课程目标、教学内容和实际考核证据已经核对。",
  };
}

function artifactRef(
  courseId: string,
  kind: ArtifactKind,
  pageId?: string,
): ArtifactRef {
  const suffix = pageId ?? "course";
  return {
    id: `${kind}-${suffix}`,
    kind,
    courseId,
    pageId,
    scopeKey: pageId ? `page:${pageId}` : "course",
    version: 1,
    contentHash: `hash-${kind}-${suffix}`,
  };
}
