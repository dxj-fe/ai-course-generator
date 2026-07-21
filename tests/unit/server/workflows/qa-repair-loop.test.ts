import { describe, expect, it } from "vitest";

import { planRepairRound } from "../../../../src/server/workflows/qa-repair-loop";
import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../../fixtures/quality-report";

const base = {
  pageId: pageContentDsl.pageId,
  content: pageContentDsl,
  html: buildValidGeneratedHtml(pageContentDsl),
  visualBrief,
  assets: [],
  completedRounds: 0,
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

  it("refuses upstream asset failures and exhausted budgets", () => {
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
      completedRounds: 2,
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
      failureClass: "budget_exhausted",
    });
  });
});
