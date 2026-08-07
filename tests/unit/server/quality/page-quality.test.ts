import { describe, expect, it } from "vitest";

import { PAGE_QUALITY_FAILURE_TAXONOMY } from "../../../../src/server/course/page/quality/failure-taxonomy";
import { buildPageQualityReport } from "../../../../src/server/course/page/quality/report";
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
  it("keeps the failure taxonomy at exactly ten stable categories", () => {
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
      requireScreenshotEvidence: false,
    });

    expect(report.overallScore).toBe(95);
    expect(report.shouldRepair).toBe(false);
    expect(report.decision).toBe("pass");
  });

  it("keeps non-browser layout heuristics observational", () => {
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
      requireScreenshotEvidence: false,
    });

    expect(report.dimensions.layoutQuality.score).toBe(84);
    expect(report.shouldRepair).toBe(false);
    expect(report.decision).toBe("pass");
    expect(report.dimensions.layoutQuality.issueCodes).toEqual([
      "LAYOUT_CLIPPING",
    ]);
    expect(report.dimensions.layoutQuality.repairHints).toEqual([
      "移除固定宽度并重新验证窄屏布局。",
    ]);
  });

  it("允许可用的多栏工作区保留独立滚动面板", () => {
    const report = buildPageQualityReport({
      id: "quality-scroll-panels",
      createdAt: "2026-08-06T18:50:00+08:00",
      pageId: "page-evidence-workbench",
      modelDimensions: dimensions,
      heuristicIssues: [],
      browserIssues: [
        {
          code: "BROWSER_NESTED_VERTICAL_OVERFLOW",
          dimension: "layoutQuality",
          severity: "warning",
          source: "browser",
          message: "3 个证据面板可独立滚动。",
          location: {
            pageId: "page-evidence-workbench",
            viewport: "922x460",
            description: "三栏证据工作台",
          },
          repairHint: "仅在裁切或操作不可达时改为自然滚动。",
        },
      ],
      modelIssues: [],
      requireScreenshotEvidence: false,
    });

    expect(report.shouldRepair).toBe(false);
    expect(report.decision).toBe("pass");
    expect(report.issues[0]).toMatchObject({
      code: "BROWSER_NESTED_VERTICAL_OVERFLOW",
      severity: "warning",
    });
  });

  it("没有可定位问题时把低分保留为观测信号，不自动启动 Repair", () => {
    const report = buildPageQualityReport({
      id: "quality-course-coherence",
      createdAt: "2026-07-14T19:00:00+08:00",
      pageId: "page-02-knowledge",
      modelDimensions: {
        ...dimensions,
        contentAccuracy: {
          score: 20,
          summary: "模型给出极低主观分，但没有提供任何可定位事实错误。",
        },
        courseCoherence: {
          score: 84,
          summary: "缺少与学习目标对齐的具体练习。",
        },
      },
      heuristicIssues: [],
      modelIssues: [],
      requireScreenshotEvidence: false,
    });

    expect(report.shouldRepair).toBe(false);
    expect(report.decision).toBe("pass");
  });

  it("视觉主观分数必须配合具体 issue 才能授权返工", () => {
    const report = buildPageQualityReport({
      id: "quality-visual-gate",
      createdAt: "2026-07-24T15:00:00+08:00",
      pageId: "page-02-knowledge",
      modelDimensions: {
        ...dimensions,
        layoutQuality: {
          score: 81,
          summary: "播放器视口内层级拥挤，主操作不够突出。",
        },
        styleConsistency: {
          score: 81,
          summary: "页面仍接近通用卡片面板，未形成课程视觉焦点。",
        },
      },
      heuristicIssues: [],
      modelIssues: [],
      requireScreenshotEvidence: false,
    });

    expect(report.shouldRepair).toBe(false);
    expect(report.decision).toBe("pass");
  });

  it("截图可定位的结构性视觉失败会触发一次 HTML 返工", () => {
    const report = buildPageQualityReport({
      id: "quality-visual-structure",
      createdAt: "2026-07-24T15:00:00+08:00",
      pageId: "page-visual-structure",
      modelDimensions: dimensions,
      heuristicIssues: [],
      modelIssues: [
        {
          code: "VISUAL_GENERIC_UI",
          dimension: "styleConsistency",
          severity: "error",
          source: "model",
          message: "首屏由等权白卡和通用面板组成，主题视觉缺席。",
          location: {
            pageId: "page-visual-structure",
            selector: "main",
            viewport: "922x460",
            description: "桌面首屏整体构图",
          },
          repairHint:
            "围绕本页知识关系重新构图，让证据图与学习动作形成一个主题专属画面。",
        },
      ],
      requireScreenshotEvidence: false,
    });

    expect(report.shouldRepair).toBe(true);
    expect(report.decision).toBe("revise");
    expect(report.issues[0]).toMatchObject({
      code: "VISUAL_GENERIC_UI",
      severity: "error",
    });
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
      requireScreenshotEvidence: false,
    });

    expect(report.issues.map(({ code }) => code)).toEqual([
      "CONTENT_ERROR",
      "HTML_WARNING",
      "STYLE_ERROR",
    ]);
  });

  it("accepts browser issue codes only from deterministic browser evidence", () => {
    const copiedBrowserIssue: QualityIssue = {
      code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
      dimension: "assetUsability",
      severity: "error",
      source: "model",
      message: "模型重复描述了浏览器指标。",
      location: {
        pageId: "page-browser-code-owner",
        description: "模型推测的首屏素材",
      },
      repairHint: "缩小首屏素材。",
    };
    const browserIssue: QualityIssue = {
      ...copiedBrowserIssue,
      source: "browser",
      location: {
        ...copiedBrowserIssue.location,
        viewport: "922x460",
        selector: '[data-asset-slot-id="asset-slot-01"]',
      },
    };
    const report = buildPageQualityReport({
      id: "quality-browser-code-owner",
      createdAt: "2026-07-24T15:00:00+08:00",
      pageId: "page-browser-code-owner",
      modelDimensions: dimensions,
      heuristicIssues: [],
      browserIssues: [browserIssue],
      modelIssues: [copiedBrowserIssue],
      requireScreenshotEvidence: false,
    });

    expect(report.issues).toMatchObject([
      {
        code: browserIssue.code,
        source: "browser",
        severity: "warning",
      },
    ]);
  });

  it("blocks delivery when required screenshot evidence is missing", () => {
    const report = buildPageQualityReport({
      id: "quality-screenshot-gate",
      createdAt: "2026-07-24T15:00:00+08:00",
      pageId: "page-screenshot-gate",
      modelDimensions: dimensions,
      heuristicIssues: [],
      modelIssues: [],
    });

    expect(report.shouldRepair).toBe(true);
    expect(report.decision).toBe("revise");
    expect(report.issues).toMatchObject([
      {
        code: "SCREENSHOT_EVIDENCE_MISSING",
        severity: "error",
        source: "browser",
      },
    ]);
  });

  it("blocks delivery when any required viewport capture fails", () => {
    const capturedAt = "2026-07-24T15:00:00+08:00";
    const metrics = {
      documentWidth: 922,
      documentHeight: 460,
      horizontalOverflowPx: 0,
      clippedElementCount: 0,
      zeroSizeInteractiveCount: 0,
    };
    const report = buildPageQualityReport({
      id: "quality-screenshot-partial",
      createdAt: capturedAt,
      pageId: "page-screenshot-partial",
      modelDimensions: dimensions,
      heuristicIssues: [],
      modelIssues: [],
      screenshotEvidence: {
        captures: [
          {
            status: "captured",
            artifactId: "desktop",
            viewport: { width: 922, height: 460 },
            metrics,
            capturedAt,
          },
          {
            status: "failed",
            viewport: { width: 712, height: 650 },
            reason: "浏览器不可用",
          },
          {
            status: "captured",
            artifactId: "mobile",
            viewport: { width: 366, height: 500 },
            metrics: { ...metrics, documentWidth: 366, documentHeight: 500 },
            capturedAt,
          },
        ],
      },
    });

    expect(report.shouldRepair).toBe(true);
    expect(report.decision).toBe("revise");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SCREENSHOT_CAPTURE_FAILED",
          severity: "error",
        }),
      ]),
    );
  });
});
