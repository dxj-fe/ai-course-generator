import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageQualityPanel } from "../../../src/features/seaca/page-quality-panel";
import { buildPageQualityReport } from "../../../src/server/quality/page-quality";

const dimensions = {
  contentAccuracy: { score: 96, summary: "事实准确，符合本页目标。" },
  layoutQuality: { score: 94, summary: "层级清楚，信息密度适中。" },
  courseCoherence: { score: 92, summary: "教学目标与前后页连贯。" },
  styleConsistency: { score: 93, summary: "遵守课程视觉 Brief。" },
  htmlRuntime: { score: 100, summary: "HTML 合同和运行结构完整。" },
  assetUsability: { score: 95, summary: "素材用途和替代文本合理。" },
};

describe("PageQualityPanel", () => {
  it("renders six grouped dimensions and non-sensitive screenshot metrics", () => {
    const report = buildPageQualityReport({
      id: "quality-panel",
      createdAt: "2026-07-16T10:00:00+08:00",
      pageId: "page-panel",
      modelDimensions: dimensions,
      heuristicIssues: [],
      modelIssues: [
        {
          code: "STYLE_DRIFT",
          dimension: "styleConsistency",
          severity: "warning",
          source: "model",
          message: "卡片间距偏离课程视觉规范。",
          location: { description: "知识卡区域" },
          repairHint: "使用 VisualBrief 指定的紧凑间距。",
        },
      ],
      screenshotEvidence: {
        status: "captured",
        artifactId: "private-artifact-id",
        viewport: { width: 1440, height: 900 },
        metrics: {
          documentWidth: 1440,
          documentHeight: 900,
          horizontalOverflowPx: 0,
          clippedElementCount: 0,
          zeroSizeInteractiveCount: 0,
        },
        capturedAt: "2026-07-16T10:00:00+08:00",
      },
    });
    const markup = renderToStaticMarkup(<PageQualityPanel report={report} />);

    expect(markup).toContain('aria-label="六维质量检查结果"');
    expect(markup.match(/role="listitem"/g)).toHaveLength(6);
    expect(markup).toContain("内容正确性");
    expect(markup).toContain("教学有效性");
    expect(markup).toContain("Playwright 截图");
    expect(markup).toContain("横向溢出 0px");
    expect(markup).toContain("使用 VisualBrief 指定的紧凑间距。");
    expect(markup).not.toContain("private-artifact-id");
  });
});
