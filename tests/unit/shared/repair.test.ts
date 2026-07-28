import { describe, expect, it } from "vitest";

import {
  RepairRequestSchema,
  RepairResultSchema,
} from "../../../src/shared/course-schema";
import {
  pageContentDsl,
  visualBrief,
} from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../fixtures/quality-report";

describe("Repair schemas", () => {
  it("accepts a page-scoped request and a targeted HTML patch result", () => {
    const report = qualityReportWithIssue({
      code: "LAYOUT_OVERFLOW",
      dimension: "layoutQuality",
      selector: "style",
    });
    const request = RepairRequestSchema.parse({
      pageId: pageContentDsl.pageId,
      targetArtifact: "html",
      round: 1,
      maxRounds: 24,
      sourceReport: report,
      issueCodes: ["LAYOUT_OVERFLOW"],
      allowedBlockIds: [],
      allowedSelectors: ["style"],
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
    });
    const result = RepairResultSchema.parse({
      kind: "html_patch_candidate",
      pageId: pageContentDsl.pageId,
      targetArtifact: "html",
      addressedIssueCodes: ["LAYOUT_OVERFLOW"],
      unresolvedIssueCodes: [],
      changeSummary: ["限制页面宽度。"],
      patches: [
        {
          issueCode: "LAYOUT_OVERFLOW",
          search: "body { margin: 0; }",
          replacement: "body { margin: 0; max-width: 100%; }",
          summary: "限制 body 宽度。",
        },
      ],
    });

    expect(request.round).toBe(1);
    expect(result.kind).toBe("html_patch_candidate");
  });

  it("accepts later attempts and optional persisted quality progress", () => {
    const report = qualityReportWithIssue({
      code: "LAYOUT_OVERFLOW",
      dimension: "layoutQuality",
      selector: "style",
    });

    expect(
      RepairRequestSchema.safeParse({
        pageId: pageContentDsl.pageId,
        targetArtifact: "html",
        round: 4,
        maxRounds: 24,
        sourceReport: report,
        issueCodes: ["LAYOUT_OVERFLOW"],
        allowedBlockIds: [],
        allowedSelectors: ["style"],
        content: pageContentDsl,
        html: buildValidGeneratedHtml(pageContentDsl),
        visualBrief,
        assets: [],
      }).success,
    ).toBe(true);
  });

  it("requires a selector for tag-boundary insertion patches", () => {
    const result = RepairResultSchema.safeParse({
      kind: "html_patch_candidate",
      pageId: pageContentDsl.pageId,
      targetArtifact: "html",
      addressedIssueCodes: ["HTML_MAIN_MISSING"],
      unresolvedIssueCodes: [],
      changeSummary: ["插入 main。"],
      patches: [
        {
          issueCode: "HTML_MAIN_MISSING",
          operation: "insert_after_open_tag",
          replacement: "<main>",
          summary: "插入 main 开标签。",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects foreign issue codes and unscoped DSL repair", () => {
    const report = qualityReportWithIssue({
      code: "CONTENT_FACT",
      dimension: "contentAccuracy",
      blockId: "block-01",
    });
    const base = {
      pageId: pageContentDsl.pageId,
      targetArtifact: "dsl" as const,
      round: 1,
      maxRounds: 24,
      sourceReport: report,
      allowedBlockIds: ["block-01"],
      allowedSelectors: [],
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
    };

    expect(
      RepairRequestSchema.safeParse({ ...base, issueCodes: ["INVENTED"] }).success,
    ).toBe(false);
    expect(
      RepairRequestSchema.safeParse({
        ...base,
        issueCodes: ["CONTENT_FACT"],
        allowedBlockIds: [],
      }).success,
    ).toBe(false);
    expect(
      RepairRequestSchema.safeParse({
        ...base,
        issueCodes: ["CONTENT_FACT"],
        allowedBlockIds: [],
        allowedContentFields: ["narration"],
      }).success,
    ).toBe(true);
  });
});
