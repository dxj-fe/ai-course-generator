import { describe, expect, it } from "vitest";

import {
  didRepairQualityImprove,
  planRepairRound,
} from "../../../../src/server/workflows/qa-repair-loop";
import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../../fixtures/quality-report";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";

const base = {
  pageId: pageContentDsl.pageId,
  content: pageContentDsl,
  html: buildValidGeneratedHtml(pageContentDsl),
  visualBrief,
  assets: [],
  attemptCount: 0,
};

describe("QA repair planning", () => {
  it("routes located content issues to DSL and layout issues to HTML", () => {
    const dsl = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "CONTENT_FACT",
        dimension: "contentAccuracy",
        blockId: "block-01",
      }),
    });
    const html = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "LAYOUT_OVERFLOW",
        dimension: "layoutQuality",
        selector: "style",
      }),
    });

    expect(dsl).toMatchObject({
      targetArtifact: "dsl",
      allowedBlockIds: ["block-01"],
    });
    expect(html).toMatchObject({
      targetArtifact: "html",
      allowedSelectors: ["style"],
    });
  });

  it("routes selector-located interaction coherence issues to bounded HTML repair", () => {
    const request = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "INTERACTION_LABEL_MISMATCH",
        dimension: "courseCoherence",
        selector: ".interaction-items .interaction-item",
      }),
    });

    expect(request).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["INTERACTION_LABEL_MISMATCH"],
      allowedBlockIds: [],
      allowedSelectors: [".interaction-items .interaction-item"],
    });
  });

  it("routes an unlocated browser visual-dominance issue to bounded style repair", () => {
    const request = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
        dimension: "assetUsability",
      }),
    });

    expect(request).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["BROWSER_VISUAL_DOMINATES_VIEWPORT"],
      allowedBlockIds: [],
      allowedSelectors: ["style"],
    });
  });

  it("routes touch-target and below-fold presentation failures to the style boundary", () => {
    const touch = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "TOO_SMALL_TOUCH_TARGET",
        dimension: "htmlRuntime",
        selector: 'input[type="radio"], button[data-runtime-submit="true"]',
      }),
    });
    const belowFold = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "PRIMARY_ACTION_BELOW_FOLD",
        dimension: "layoutQuality",
        selector: '[data-interaction-type="navigate"]',
      }),
    });

    expect(touch).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["TOO_SMALL_TOUCH_TARGET"],
      allowedSelectors: ["style"],
    });
    expect(belowFold).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["PRIMARY_ACTION_BELOW_FOLD"],
      allowedSelectors: ["style"],
    });
  });

  it("routes duplicate CSS reports to the style boundary", () => {
    const request = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "DUPLICATE_CSS_RULE",
        dimension: "htmlRuntime",
        selector: "style > *:nth-child(1), style > *:nth-child(2)",
      }),
    });

    expect(request).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["DUPLICATE_CSS_RULE"],
      allowedSelectors: ["style"],
    });
  });

  it("routes an unsafe opaque-asset fallback to its HTML slot", () => {
    const request = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "ASSET_TRANSPARENCY_UNAVAILABLE",
        dimension: "assetUsability",
        selector: '[data-asset-slot-id="asset-slot-01"]',
      }),
    });

    expect(request).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["ASSET_TRANSPARENCY_UNAVAILABLE"],
      allowedSelectors: ['[data-asset-slot-id="asset-slot-01"]'],
    });
  });

  it("routes an incomplete objective check to the interaction DSL field", () => {
    const request = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "OBJECTIVE_CHECK_INCOMPLETE",
        dimension: "courseCoherence",
        selector: ".interaction",
      }),
    });

    expect(request).toMatchObject({
      targetArtifact: "dsl",
      issueCodes: ["OBJECTIVE_CHECK_INCOMPLETE"],
      allowedBlockIds: [],
      allowedContentFields: ["interaction"],
      allowedSelectors: [],
    });
  });

  it("routes a blockless cover objective gap to narration DSL repair", () => {
    const example = getFunctionalTemplateDslExample("course-cover");
    if (!example) throw new Error("course-cover fixture is required");
    const content = { ...example, pageId: pageContentDsl.pageId };
    const request = planRepairRound({
      ...base,
      content,
      html: buildValidGeneratedHtml(content),
      report: qualityReportWithIssue({
        code: "OBJECTIVE_COVERAGE_GAP",
        dimension: "courseCoherence",
        selector: "#page-narration",
      }),
    });

    expect(request).toMatchObject({
      targetArtifact: "dsl",
      issueCodes: ["OBJECTIVE_COVERAGE_GAP"],
      allowedBlockIds: [],
      allowedContentFields: ["narration"],
      allowedSelectors: [],
    });
  });

  it("does not add a non-blocking coherence warning to an error-driven repair", () => {
    const report = qualityReportWithIssue({
      code: "HTML_MAIN_MISSING",
      dimension: "htmlRuntime",
      selector: "body",
    });
    const request = planRepairRound({
      ...base,
      report: {
        ...report,
        issues: [
          ...report.issues,
          {
            code: "CONTENT_REDUNDANCY",
            dimension: "courseCoherence" as const,
            severity: "warning" as const,
            source: "model" as const,
            message: "知识卡与交互区域包含重复内容。",
            location: {
              pageId: pageContentDsl.pageId,
              selector: ".interaction-section",
              description: "DSL 要求的 reveal 交互区域",
            },
            repairHint: "移除知识卡或交互区域。",
          },
        ],
      },
    });

    expect(request).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["HTML_MAIN_MISSING"],
      allowedSelectors: ["body"],
    });
  });

  it("does not let an unlocatable semantic warning block a repairable HTML error", () => {
    const report = qualityReportWithIssue({
      code: "INTERACTION_CONTENT_NOT_HIDDEN",
      dimension: "htmlRuntime",
    });
    const request = planRepairRound({
      ...base,
      report: {
        ...report,
        dimensions: {
          ...report.dimensions,
          courseCoherence: {
            ...report.dimensions.courseCoherence,
            score: 84,
          },
        },
        issues: [
          ...report.issues,
          {
            code: "CONTENT_REDUNDANT",
            dimension: "courseCoherence" as const,
            severity: "warning" as const,
            source: "model" as const,
            message: "旁白与互动提示被误判为重复。",
            location: {
              pageId: pageContentDsl.pageId,
              description: "页面旁白与互动提示",
            },
            repairHint: "删除其中一项。",
          },
        ],
      },
    });

    expect(request).toMatchObject({
      targetArtifact: "html",
      issueCodes: ["INTERACTION_CONTENT_NOT_HIDDEN"],
      allowedSelectors: ["html"],
    });
  });

  it("still refuses semantic issues with neither a block nor a selector", () => {
    const request = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "CONTENT_FACT",
        dimension: "contentAccuracy",
      }),
    });

    expect(request).toMatchObject({
      status: "unavailable",
      failureClass: "unlocatable_issue",
    });
  });

  it("refuses upstream asset failures and applies only an emergency guard", () => {
    const asset = planRepairRound({
      ...base,
      report: qualityReportWithIssue({
        code: "ASSET_RESULT_MISSING",
        dimension: "assetUsability",
        selector: "figure",
      }),
    });
    const exhausted = planRepairRound({
      ...base,
      attemptCount: 24,
      report: qualityReportWithIssue({
        code: "LAYOUT_OVERFLOW",
        dimension: "layoutQuality",
        selector: "style",
      }),
    });

    expect(asset).toMatchObject({
      status: "unavailable",
      failureClass: "unsupported_asset_issue",
    });
    expect(exhausted).toMatchObject({
      status: "unavailable",
      failureClass: "safety_limit",
    });
  });

  it("allows a fourth quality iteration and compares deterministic progress", () => {
    const before = qualityReportWithIssue({
      code: "LAYOUT_OVERFLOW",
      dimension: "layoutQuality",
      selector: "style",
    });
    const improved = {
      ...before,
      id: "quality-layout-improved",
      overallScore: before.overallScore + 5,
    };

    expect(
      planRepairRound({
        ...base,
        attemptCount: 3,
        report: before,
      }),
    ).toMatchObject({ round: 4, maxRounds: 24 });
    expect(didRepairQualityImprove(before, improved)).toBe(true);
    expect(didRepairQualityImprove(before, before)).toBe(false);
  });
});
