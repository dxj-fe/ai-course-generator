import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { compareCourseQuality } from "../../../../src/server/quality/course-quality-comparison";
import { buildPageQualityReport } from "../../../../src/server/quality/page-quality";
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
});

function course(courseId: string, score: number): CourseGenerationState {
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
      },
    ],
    events: [],
    errors: [],
    startedAt: "2026-07-24T09:59:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
  };
}
