import { describe, expect, it } from "vitest";

import { PAGE_QUALITY_FAILURE_TAXONOMY } from "../../../../src/server/quality/failure-taxonomy";
import { buildPageQualityReport } from "../../../../src/server/quality/page-quality";
import type { QualityIssue } from "../../../../src/shared/course-schema";

const dimensions = {
  contentAccuracy: { score: 96, summary: "内容准确且适合学习目标。" },
  layoutQuality: { score: 94, summary: "页面层级和信息密度合理。" },
  courseCoherence: { score: 93, summary: "页面能够承接前后学习任务。" },
  styleConsistency: { score: 92, summary: "页面遵守统一视觉方向。" },
  htmlRuntime: { score: 100, summary: "HTML 合同和语义结构完整。" },
  assetUsability: { score: 95, summary: "素材用途和替代文本合理。" },
};

describe("page quality rules", () => {
  it("keeps the Day 15 failure taxonomy at exactly ten stable categories", () => {
    expect(PAGE_QUALITY_FAILURE_TAXONOMY).toHaveLength(10);
    expect(new Set(PAGE_QUALITY_FAILURE_TAXONOMY.map(({ code }) => code)).size).toBe(10);
  });

  it("computes a passing weighted report without delegating workflow decisions", () => {
    const report = buildPageQualityReport({
      id: "quality-page-02",
      createdAt: "2026-07-14T19:00:00+08:00",
      pageId: "page-02-knowledge",
      modelDimensions: dimensions,
      heuristicIssues: [],
      modelIssues: [],
    });

    expect(report.overallScore).toBe(95);
    expect(report.shouldRepair).toBe(false);
    expect(report.decision).toBe("pass");
  });

  it("caps the affected dimension and forces repair for an error", () => {
    const issue: QualityIssue = {
      code: "LAYOUT_CLIPPING",
      dimension: "layoutQuality",
      severity: "error",
      source: "heuristic",
      message: "主内容在窄屏被裁切。",
      location: {
        pageId: "page-02-knowledge",
        viewport: "375px",
        selector: "main",
        description: "页面主内容",
      },
      repairHint: "移除固定宽度并重新验证窄屏布局。",
    };
    const report = buildPageQualityReport({
      id: "quality-page-02-error",
      createdAt: "2026-07-14T19:00:00+08:00",
      pageId: "page-02-knowledge",
      modelDimensions: dimensions,
      heuristicIssues: [issue],
      modelIssues: [],
    });

    expect(report.dimensions.layoutQuality.score).toBe(69);
    expect(report.shouldRepair).toBe(true);
    expect(report.decision).toBe("revise");
    expect(report.dimensions.layoutQuality.issueCodes).toEqual([
      "LAYOUT_CLIPPING",
    ]);
    expect(report.dimensions.layoutQuality.repairHints).toEqual([
      "移除固定宽度并重新验证窄屏布局。",
    ]);
  });

  it("sorts content errors before visual errors and keeps deterministic ties", () => {
    const issue = (
      code: string,
      dimension: QualityIssue["dimension"],
      severity: QualityIssue["severity"],
    ): QualityIssue => ({
      code,
      dimension,
      severity,
      source: "model",
      message: `${code} 的具体问题。`,
      location: { description: `${code} 的位置` },
      repairHint: `${code} 的修订建议。`,
    });
    const report = buildPageQualityReport({
      id: "quality-priority",
      createdAt: "2026-07-16T10:00:00+08:00",
      pageId: "page-priority",
      modelDimensions: dimensions,
      heuristicIssues: [
        issue("STYLE_ERROR", "styleConsistency", "error"),
      ],
      modelIssues: [
        issue("CONTENT_ERROR", "contentAccuracy", "error"),
        issue("HTML_WARNING", "htmlRuntime", "warning"),
      ],
    });

    expect(report.issues.map(({ code }) => code)).toEqual([
      "CONTENT_ERROR",
      "STYLE_ERROR",
      "HTML_WARNING",
    ]);
  });
});
