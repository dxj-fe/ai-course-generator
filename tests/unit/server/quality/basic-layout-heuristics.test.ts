import { describe, expect, it } from "vitest";

import { basicLayoutHeuristics } from "../../../../src/server/course/page/quality/basic-layout";
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

  it("不把平台约定的 1920×1080 固定舞台误报成窄屏溢出", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      "body { margin: 0; }",
      "body { margin: 0; overflow: hidden; } main { width: 1920px; height: 1080px; overflow: hidden; }",
    );
    const codes = basicLayoutHeuristics({ content: pageContentDsl, html }).map(
      ({ code }) => code,
    );

    expect(codes).not.toContain("LAYOUT_FIXED_WIDTH_RISK");
    expect(codes).not.toContain("LAYOUT_CLIPPING_RISK");
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

  it("accepts an approved background bound through a unique slot class", () => {
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
    const html = buildValidGeneratedHtml(content)
      .replace(
        "</style>",
        ".hero-asset { background-image: url('/api/assets/asset-01'); background-size: cover; }</style>",
      )
      .replace(
        '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示课程主题视觉标识</figcaption></figure>',
        '<div data-asset-slot-id="asset-slot-01" class="hero-asset" role="img" aria-label="课程主题视觉"></div>',
      );
    const assets = [
      AssetGenerationResultSchema.parse({
        request: {
          assetSlotId: "asset-slot-01" as const,
          assetType: "background",
          usage: "展示课程主题视觉标识",
          prompt: "A calm educational course hero image without text.",
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
          generationPrompt: "A calm educational course hero image without text.",
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

  it("accepts an approved asset URI without requiring a unique DSL slot binding", () => {
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
    const html = buildValidGeneratedHtml(content)
      .replace(
        "</style>",
        ".hero-asset { background-image: url('/api/assets/asset-01'); background-size: cover; }</style>",
      )
      .replace(
        '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示课程主题视觉标识</figcaption></figure>',
        '<div data-asset-slot-id="asset-slot-01" class="hero-asset" role="img" aria-label="课程主题视觉"></div><div class="hero-asset"></div>',
      );

    expect(
      basicLayoutHeuristics({
        content,
        html,
        assets: [readyBackgroundAsset(content.pageId)],
      }).map(({ code }) => code),
    ).not.toContain("ASSET_REQUIRED_SLOT_EMPTY");
  });

  it("does not turn a safely contained opaque fallback into a repair loop", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "展示课程主题视觉标识",
          required: true,
          altTextGuidance: "描述课程主题视觉",
        },
      ],
    };
    const html = buildValidGeneratedHtml(content).replace(
      '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示课程主题视觉标识</figcaption></figure>',
      '<figure data-asset-slot-id="asset-slot-01"><img src="/api/assets/asset-01" alt="课程主题视觉"></figure>',
    );

    expect(
      basicLayoutHeuristics({
        content,
        html,
        assets: [readyTransparentFallbackAsset(content.pageId)],
      }).map(({ code }) => code),
    ).not.toContain("ASSET_TRANSPARENCY_UNAVAILABLE");
  });

  it("accepts an empty standalone background container as an opaque fallback", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "展示课程主题视觉标识",
          required: true,
          altTextGuidance: "描述课程主题视觉",
        },
      ],
    };
    const html = buildValidGeneratedHtml(content).replace(
      '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示课程主题视觉标识</figcaption></figure>',
      '<div data-asset-slot-id="asset-slot-01" role="img" aria-label="课程主题视觉" style="background-image:url(\'/api/assets/asset-01\'); background-size:cover"></div>',
    );

    expect(
      basicLayoutHeuristics({
        content,
        html,
        assets: [readyTransparentFallbackAsset(content.pageId)],
      }).map(({ code }) => code),
    ).not.toContain("ASSET_TRANSPARENCY_UNAVAILABLE");
  });

  it("does not require an opaque image to carry a DSL slot wrapper", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "展示课程主题视觉标识",
          required: true,
          altTextGuidance: "描述课程主题视觉",
        },
      ],
    };
    const html = buildValidGeneratedHtml(content).replace(
      '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示课程主题视觉标识</figcaption></figure>',
      '<img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-01" alt="课程主题视觉">',
    );

    expect(
      basicLayoutHeuristics({
        content,
        html,
        assets: [readyTransparentFallbackAsset(content.pageId)],
      }).map(({ code }) => code),
    ).not.toContain("ASSET_TRANSPARENCY_UNAVAILABLE");
  });
});

function readyBackgroundAsset(pageId: string) {
  return AssetGenerationResultSchema.parse({
    request: {
      assetSlotId: "asset-slot-01",
      assetType: "background",
      usage: "展示课程主题视觉标识",
      prompt: "A calm educational course hero image without text.",
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
      generationPrompt: "A calm educational course hero image without text.",
      mimeType: "image/png",
      dimensions: { width: 1280, height: 720 },
      usedByPageIds: [pageId],
    },
    warnings: [],
    durationMs: 12,
  });
}

function readyTransparentFallbackAsset(pageId: string) {
  return AssetGenerationResultSchema.parse({
    request: {
      assetSlotId: "asset-slot-01",
      assetType: "character_sticker",
      usage: "展示课程主题视觉标识",
      prompt: "A transparent educational course illustration without text.",
      transparentBackground: true,
      safeArea: {
        position: "none",
        coveragePercent: 0,
        description: "独立素材不承载文字",
      },
      aspectRatio: "3:4",
    },
    status: "ready",
    asset: {
      id: "asset-01",
      type: "illustration",
      role: "inline",
      source: "generated",
      status: "ready",
      uri: "/api/assets/asset-01",
      altText: "课程主题视觉",
      generationPrompt:
        "A transparent educational course illustration without text.",
      mimeType: "image/jpeg",
      dimensions: { width: 768, height: 1024 },
      usedByPageIds: [pageId],
    },
    warnings: ["TRANSPARENCY_UNAVAILABLE"],
    durationMs: 12,
  });
}
