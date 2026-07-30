import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  compareCourseQuality,
  summarizeCourseQuality,
} from "../../../../src/server/course/page/quality/comparison";
import { buildPageQualityReport } from "../../../../src/server/course/page/quality/report";
import type {
  CourseGenerationState,
  QualityScreenshotEvidence,
} from "../../../../src/shared/course-schema";

const screenshotEvidence: QualityScreenshotEvidence = {
  status: "captured",
  artifactId: "quality-comparison-desktop",
  viewport: { width: 922, height: 460 },
  metrics: {
    documentWidth: 922,
    documentHeight: 460,
    horizontalOverflowPx: 0,
    clippedElementCount: 0,
    zeroSizeInteractiveCount: 0,
  },
  capturedAt: "2026-07-24T10:00:00.000Z",
  captures: [
    {
      status: "captured",
      artifactId: "quality-comparison-desktop",
      viewport: { width: 922, height: 460 },
      metrics: {
        documentWidth: 922,
        documentHeight: 460,
        horizontalOverflowPx: 0,
        clippedElementCount: 0,
        zeroSizeInteractiveCount: 0,
      },
      capturedAt: "2026-07-24T10:00:00.000Z",
    },
  ],
};

describe("course quality comparison", () => {
  it("prefers the candidate with stronger visual scores and captured evidence", () => {
    const result = compareCourseQuality(course("baseline", 82), course("candidate", 94));

    expect(result.winner).toBe("candidate");
    expect(result.scoreDelta).toBeGreaterThan(1);
    expect(result.candidate.screenshotCaptureRate).toBe(1);
    expect(result.candidate.firstPassAcceptanceRate).toBe(1);
    expect(result.candidate.modelFirstPassAcceptanceRate).toBe(0);
    expect(result.candidate.averageRepairAttempts).toBe(0);
    expect(result.pageComparisons[0]?.winner).toBe("candidate");
  });

  it("keeps a diverse 20-case regression prompt manifest", async () => {
    const manifest = JSON.parse(
      await readFile("docs/demo/quality-benchmark-prompts.json", "utf8"),
    ) as { cases: Array<{ id: string; category: string; prompt: string }> };

    expect(manifest.cases).toHaveLength(20);
    expect(new Set(manifest.cases.map(({ id }) => id)).size).toBe(20);
    expect(new Set(manifest.cases.map(({ category }) => category)).size).toBeGreaterThanOrEqual(8);
  });

  it("优先使用新运行时投影的 durable Repair 次数", () => {
    const metrics = summarizeCourseQuality(course("repaired", 94, 2));

    expect(metrics.repairAttemptCount).toBe(2);
    expect(metrics.averageRepairAttempts).toBe(2);
    expect(metrics.firstPassAcceptanceRate).toBe(0);
  });

  it("separates provider-backed first-pass quality from graceful fallbacks", () => {
    const modelCourse = course("model-rendered", 94);
    modelCourse.pages[0]!.htmlOutput = {
      version: 1,
      html: "<!doctype html><html><body></body></html>",
      generatedAt: "2026-07-24T10:00:00.000Z",
    };
    const fallbackCourse = course("fallback-rendered", 94);
    fallbackCourse.pages[0]!.htmlOutput = {
      version: 1,
      html: '<!doctype html><html data-keya-renderer="deterministic"><body></body></html>',
      generatedAt: "2026-07-24T10:00:00.000Z",
    };

    const modelMetrics = summarizeCourseQuality(modelCourse);
    const fallbackMetrics = summarizeCourseQuality(fallbackCourse);

    expect(modelMetrics.modelFirstPassAcceptanceRate).toBe(1);
    expect(modelMetrics.modelRenderRate).toBe(1);
    expect(fallbackMetrics.firstPassAcceptanceRate).toBe(1);
    expect(fallbackMetrics.modelFirstPassAcceptanceRate).toBe(0);
    expect(fallbackMetrics.modelRenderRate).toBe(0);
    expect(modelMetrics.compositeScore).toBeGreaterThan(
      fallbackMetrics.compositeScore,
    );
  });

  it("penalizes architecture and whole-course revision rounds", () => {
    const firstPass = course("first-pass-course", 94);
    firstPass.status = "completed";
    firstPass.generationMetrics = {
      architectureAttemptCount: 1,
      architectureRevisionCount: 0,
      replanCount: 0,
      courseRevisionCount: 0,
    };
    firstPass.pages[0]!.htmlOutput = {
      version: 1,
      html: "<!doctype html><html><body></body></html>",
      generatedAt: "2026-07-24T10:00:00.000Z",
    };
    const revised = structuredClone(firstPass);
    revised.courseId = "revised-course";
    revised.generationMetrics = {
      architectureAttemptCount: 2,
      architectureRevisionCount: 1,
      replanCount: 1,
      courseRevisionCount: 1,
    };

    const firstPassMetrics = summarizeCourseQuality(firstPass);
    const revisedMetrics = summarizeCourseQuality(revised);

    expect(firstPassMetrics.courseFirstPassAccepted).toBe(true);
    expect(revisedMetrics.courseFirstPassAccepted).toBe(false);
    expect(firstPassMetrics.compositeScore).toBeGreaterThan(
      revisedMetrics.compositeScore,
    );
  });
});

function course(
  courseId: string,
  score: number,
  repairAttemptCount = 0,
): CourseGenerationState {
  const report = buildPageQualityReport({
    id: `quality-${courseId}`,
    createdAt: "2026-07-24T10:00:00.000Z",
    pageId: "page-01",
    modelDimensions: {
      contentAccuracy: { score, summary: "内容质量可比较。" },
      layoutQuality: { score, summary: "布局质量可比较。" },
      courseCoherence: { score, summary: "教学质量可比较。" },
      styleConsistency: { score, summary: "风格质量可比较。" },
      htmlRuntime: { score, summary: "运行质量可比较。" },
      assetUsability: { score, summary: "素材质量可比较。" },
    },
    heuristicIssues: [],
    modelIssues: [],
    screenshotEvidence,
  });
  return {
    version: 1,
    courseId,
    traceId: `trace-${courseId}`,
    userPrompt: "同一条质量基准提示词",
    status: "running",
    currentStage: "qa",
    pages: [
      {
        pageId: "page-01",
        order: 1,
        status: "running",
        currentStage: "qa",
        assets: [],
        qualityReport: report,
        repairAttemptCount,
      },
    ],
    events: [],
    errors: [],
    startedAt: "2026-07-24T09:59:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
  };
}
