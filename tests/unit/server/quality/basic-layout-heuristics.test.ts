import { describe, expect, it } from "vitest";

import { basicLayoutHeuristics } from "../../../../src/server/quality/basic-layout-heuristics";
import { AssetGenerationResultSchema } from "../../../../src/shared/course-schema";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

describe("basicLayoutHeuristics", () => {
  it("does not invent issues for the minimal valid fixture", () => {
    expect(
      basicLayoutHeuristics({
        content: pageContentDsl,
        html: buildValidGeneratedHtml(pageContentDsl),
      }),
    ).toEqual([]);
  });

  it("turns contract and safety failures into actionable error issues", () => {
    const issues = basicLayoutHeuristics({
      content: pageContentDsl,
      html: "<body><script>alert(1)</script></body>",
    });

    expect(issues.some(({ code }) => code === "HTML_CONTRACT_MISSING_DOCTYPE")).toBe(true);
    expect(issues.some(({ code }) => code === "HTML_SAFETY_INLINE_SCRIPT")).toBe(true);
    expect(issues.every(({ location, repairHint }) => location.description && repairHint)).toBe(true);
  });

  it("reports text, clipping, fixed-width, contrast, and image risks", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      "body { margin: 0; }",
      `body { margin: 0; width: 1200px; overflow: hidden; color: #777777; background: #888888; }
       p { width: 1200px; }`,
    ).replace(
      "</main>",
      `<p>${"很长的正文".repeat(90)}</p><img src="" /></main>`,
    );
    const codes = basicLayoutHeuristics({ content: pageContentDsl, html }).map(
      ({ code }) => code,
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        "PARAGRAPH_TOO_LONG",
        "LAYOUT_FIXED_WIDTH_RISK",
        "LAYOUT_CLIPPING_RISK",
        "CONTRAST_RISK",
        "ASSET_EMPTY_SRC",
        "ASSET_ALT_MISSING",
      ]),
    );
  });

  it("requires a real visual element inside each required asset slot", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "hero" as const,
          purpose: "解释恒星与行星的差异",
          required: true,
          altTextGuidance: "描述太阳与行星的视觉差异",
        },
      ],
    };
    const html = buildValidGeneratedHtml(content);

    expect(
      basicLayoutHeuristics({ content, html }).map(({ code }) => code),
    ).toContain("ASSET_REQUIRED_SLOT_EMPTY");
  });

  it("accepts an inline background image as a usable required asset", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "hero" as const,
          purpose: "展示课程主题视觉标识",
          required: true,
          altTextGuidance: "描述课程主题视觉",
        },
      ],
    };
    const html = buildValidGeneratedHtml(content).replace(
      '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示课程主题视觉标识</figcaption></figure>',
      '<div data-asset-slot-id="asset-slot-01" role="img" aria-label="课程主题视觉" style="background-image: url(\'/api/assets/asset-01\'); background-size: cover;"></div>',
    );
    const assets = [
      AssetGenerationResultSchema.parse({
        request: {
          assetSlotId: "asset-slot-01" as const,
          assetType: "background",
          usage: "展示课程主题视觉标识",
          prompt: "A calm educational course hero image without any embedded text.",
          transparentBackground: false,
          safeArea: {
            position: "center",
            coveragePercent: 40,
            description: "中央保留内容安全区",
          },
          aspectRatio: "16:9",
        },
        status: "ready",
        asset: {
          id: "asset-01",
          type: "image",
          role: "hero",
          source: "generated",
          status: "ready",
          uri: "/api/assets/asset-01",
          altText: "课程主题视觉",
          generationPrompt:
            "A calm educational course hero image without any embedded text.",
          mimeType: "image/png",
          dimensions: { width: 1280, height: 720 },
          usedByPageIds: [content.pageId],
        },
        warnings: [],
        durationMs: 12,
      }),
    ];

    expect(
      basicLayoutHeuristics({ content, html, assets }).map(({ code }) => code),
    ).not.toContain("ASSET_REQUIRED_SLOT_EMPTY");
  });
});
