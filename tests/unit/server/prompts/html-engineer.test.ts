import { describe, expect, it } from "vitest";

import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildHtmlEngineerPrompts } from "../../../../src/server/agent/plugins/prompts/course/model-steps/html-engineer";
import { getStyleTemplate } from "../../../../src/shared/templates/style";

describe("HTML Engineer prompts", () => {
  it("只渲染紧凑 page brief、设计方向、样式变量与必要合同", async () => {
    const styleTemplate = getStyleTemplate(visualBrief.styleTemplateId);
    const pageGuidance = visualBrief.pageGuidance.find(
      ({ pageId }) => pageId === pageContentDsl.pageId,
    );
    expect(styleTemplate && pageGuidance).toBeTruthy();

    const prompts = await buildHtmlEngineerPrompts({
      pageContentDsl,
      styleTemplate: styleTemplate!,
      visualBrief,
      pageGuidance: pageGuidance!,
      pageDesignGuidance: [
        {
          logicalPath:
            "agent/skills/course-page-design/references/fixed-canvas-composition.md",
          digest: "a".repeat(64),
          content: "Keep the learning action inside the main composition.",
        },
      ],
    });

    expect(prompts.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(prompts.systemPrompt).toContain("HTML Page Designer");
    expect(prompts.systemPrompt).toContain("而不是组件演示页");
    expect(prompts.systemPrompt).toContain(
      "由主题和学习动作决定的视觉主角",
    );
    expect(prompts.systemPrompt).toContain(
      "视觉编码必须与结论一致",
    );
    expect(prompts.systemPrompt).toContain(
      "关键关系在缩略图尺度也清楚可辨",
    );
    expect(prompts.systemPrompt).toContain(
      "互动应成为画面核心的一部分",
    );
    expect(prompts.systemPrompt).toContain(
      "操作会改变什么",
    );
    expect(prompts.systemPrompt).toContain(
      "避免把无关模板组件、后台面板或等权卡片当作设计",
    );
    expect(prompts.systemPrompt).toContain(
      "DOM 内联 SVG 表达精确关系",
    );
    expect(prompts.systemPrompt).toContain(
      "位图只使用输入中的 ready 素材",
    );
    expect(prompts.systemPrompt).toContain(
      "1280×720 是首要舞台",
    );
    expect(prompts.systemPrompt).toContain(
      "960×540 与 640×360 必须保持同一 16:9 构图并完整单屏",
    );
    expect(prompts.systemPrompt).toContain(
      "640×360 必须保持同一 16:9 构图并完整单屏",
    );
    expect(prompts.systemPrompt).toContain(
      "标题、核心证据和主要动作必须可见",
    );
    expect(prompts.systemPrompt).toContain(
      "主要控件至少 44×44px",
    );
    expect(prompts.systemPrompt).toContain(
      "每个 block 在 `main` 内有一个根节点",
    );
    expect(prompts.systemPrompt).toContain("禁止 script");
    expect(prompts.systemPrompt).toContain(
      "`src`、`srcset`、`poster`、CSS `url()`",
    );
    expect(prompts.systemPrompt).not.toContain("观察者必须位于该支路末端");
    expect(prompts.systemPrompt).not.toContain("2×2 判断区");
    expect(prompts.systemPrompt).not.toContain("max-width: 520px");
    expect(prompts.systemPrompt).not.toContain("FunctionalTemplate");
    expect(prompts.userPrompt).toContain(pageContentDsl.pageId);
    expect(prompts.userPrompt).toContain("--course-color-background");
    expect(prompts.userPrompt).not.toContain("--course-color-surface");
    expect(prompts.userPrompt).not.toContain("--course-color-surface-alt");
    expect(prompts.userPrompt).not.toContain("--course-color-border");
    expect(prompts.userPrompt).toContain("--course-font-size-base");
    expect(prompts.userPrompt).toContain("--course-line-height-body");
    expect(prompts.userPrompt).toContain("--course-spacing-unit");
    expect(prompts.userPrompt).toContain("--course-radius-control");
    expect(prompts.userPrompt).toContain("--course-decoration-background");
    expect(prompts.userPrompt).toContain("--course-motion-reduced-duration");
    expect(prompts.userPrompt).not.toContain("--course-spacing-section");
    expect(prompts.userPrompt).not.toContain("--course-spacing-card");
    expect(prompts.userPrompt).not.toContain("--course-content-max-width");
    expect(prompts.userPrompt).not.toContain("--course-radius-card");
    expect(prompts.userPrompt).not.toContain("--course-border-width-card");
    expect(prompts.userPrompt).not.toContain("--course-shadow-card");
    expect(prompts.userPrompt).not.toContain("--course-layout-density");
    expect(prompts.userPrompt).toContain(visualBrief.visualConcept);
    expect(prompts.userPrompt).toContain('"globalGuardrails":{');
    expect(prompts.userPrompt).toContain(
      visualBrief.layoutPrinciples[0],
    );
    expect(prompts.userPrompt).toContain(
      visualBrief.layoutPrinciples[1],
    );
    expect(prompts.userPrompt).toContain(
      visualBrief.typographyGuidance,
    );
    expect(prompts.userPrompt).toContain(visualBrief.colorUsage);
    expect(prompts.userPrompt).toContain(
      visualBrief.assetDirection.medium,
    );
    expect(prompts.userPrompt).toContain(
      visualBrief.assetDirection.composition,
    );
    expect(prompts.userPrompt).toContain(
      visualBrief.motionGuidance.strategy,
    );
    expect(prompts.userPrompt).toContain(
      visualBrief.accessibilityRules[0],
    );
    expect(prompts.userPrompt).toContain(
      visualBrief.assetDirection.negativeConstraints[0],
    );
    expect(prompts.userPrompt).toContain(
      "避免通用后台面板、等权白卡网格和组件展示页",
    );
    expect(prompts.userPrompt).toContain(pageGuidance!.theme);
    expect(prompts.userPrompt).toContain(pageGuidance!.composition);
    expect(prompts.userPrompt).toContain(pageGuidance!.graphicMotif);
    expect(prompts.userPrompt).toContain(pageGuidance!.focalPoint);
    expect(prompts.userPrompt).toContain(pageGuidance!.assetPurpose);
    expect(prompts.userPrompt).not.toContain(
      pageContentDsl.layoutHints.visualPriority,
    );
    expect(prompts.userPrompt).not.toContain(
      pageContentDsl.layoutHints.groupingStrategy,
    );
    expect(prompts.userPrompt).toContain(styleTemplate!.goal);
    expect(prompts.userPrompt).toContain(
      styleTemplate!.decoration.shapeLanguage,
    );
    expect(prompts.userPrompt).not.toContain('"paletteRoles"');
    expect(prompts.userPrompt).not.toContain('"density"');
    expect(prompts.userPrompt).not.toContain('"assetLanguage"');
    expect(prompts.userPrompt).toContain(
      "A retro-futuristic pixel-art presentation system",
    );
    expect(prompts.userPrompt).toContain(
      "Keep the learning action inside the main composition",
    );
    expect(prompts.userPrompt).not.toContain("pixel-stack-cyan-yellow");
    expect(prompts.userPrompt).not.toMatch(/1920\s*(?:×|x)\s*1080/i);
    expect(prompts.userPrompt).not.toMatch(/deck[-_\s]?(?:runtime|viewport|stage)/i);
    expect(prompts.userPrompt).not.toContain("viewport-base.css");
    expect(prompts.userPrompt).not.toContain("functionalTemplateId");
    expect(prompts.userPrompt).toContain("null");
  });

  it("只把 HTML 消费素材所需的槽位、URI 与无障碍信息注入 prompt", async () => {
    const styleTemplate = getStyleTemplate(visualBrief.styleTemplateId)!;
    const pageGuidance = visualBrief.pageGuidance.find(
      ({ pageId }) => pageId === pageContentDsl.pageId,
    )!;
    const prompts = await buildHtmlEngineerPrompts({
      pageContentDsl,
      styleTemplate,
      visualBrief,
      pageGuidance,
      assets: [
        {
          request: {
            assetSlotId: "asset-slot-01",
            assetType: "background",
            usage: "解释课程主题",
            prompt: "这段很长的生图构图指令不应进入 HTML prompt。",
            transparentBackground: false,
            safeArea: {
              position: "left",
              coveragePercent: 40,
              description: "左侧保留文字安全区",
            },
            aspectRatio: "16:9",
          },
          status: "ready",
          asset: {
            id: "asset-01",
            type: "illustration",
            role: "inline",
            source: "generated",
            status: "ready",
            uri: "/api/assets/asset-01",
            altText: "主题关系插图",
            generationPrompt: "重复的完整生图指令",
            mimeType: "image/png",
            dimensions: { width: 1600, height: 900 },
            usedByPageIds: [pageContentDsl.pageId],
          },
          provider: "provider-name",
          model: "image-model-name",
          durationMs: 1200,
        },
      ],
    });

    expect(prompts.userPrompt).toContain('"assetSlotId":"asset-slot-01"');
    expect(prompts.userPrompt).toContain('"uri":"/api/assets/asset-01"');
    expect(prompts.userPrompt).toContain('"altText":"主题关系插图"');
    expect(prompts.userPrompt).not.toContain("这段很长的生图构图指令");
    expect(prompts.userPrompt).not.toContain("重复的完整生图指令");
    expect(prompts.userPrompt).not.toContain("provider-name");
    expect(prompts.userPrompt).not.toContain("image-model-name");
  });

  it("renders deterministic validation feedback only as retry data", async () => {
    const styleTemplate = getStyleTemplate(visualBrief.styleTemplateId);
    const pageGuidance = visualBrief.pageGuidance.find(
      ({ pageId }) => pageId === pageContentDsl.pageId,
    );
    expect(styleTemplate && pageGuidance).toBeTruthy();

    const prompts = await buildHtmlEngineerPrompts({
      pageContentDsl,
      styleTemplate: styleTemplate!,
      visualBrief,
      pageGuidance: pageGuidance!,
      validationFeedback: {
        code: "AGENT_EXECUTION_ERROR",
        issues: ["页面正文缺少 DSL 文本：课程总结与后续展望"],
      },
    });

    expect(prompts.userPrompt).toContain(
      '"issues":["页面正文缺少 DSL 文本：课程总结与后续展望"]',
    );
  });

  it.each([
    ["sci-fi", "A retro-futuristic pixel-art presentation system"],
    ["kids-playful", "A cheerful, childlike presentation system"],
    [
      "minimal",
      "A literary editorial system rendered in black ink on cream paper",
    ],
  ])(
    "injects the %s style contract and bounded recipe description for the same DSL",
    async (styleId, recipeDescription) => {
      const styleTemplate = getStyleTemplate(styleId);
      const pageGuidance = visualBrief.pageGuidance.find(
        ({ pageId }) => pageId === pageContentDsl.pageId,
      );
      expect(styleTemplate && pageGuidance).toBeTruthy();

      const prompts = await buildHtmlEngineerPrompts({
        pageContentDsl,
        styleTemplate: styleTemplate!,
        visualBrief: { ...visualBrief, styleTemplateId: styleId },
        pageGuidance: pageGuidance!,
      });

      expect(prompts.userPrompt).toContain(styleTemplate!.goal);
      expect(prompts.userPrompt).toContain(
        styleTemplate!.decoration.shapeLanguage,
      );
      expect(prompts.userPrompt).toContain(styleTemplate!.colorTokens.primary);
      expect(prompts.userPrompt).toContain(recipeDescription);
      expect(prompts.userPrompt).not.toContain(styleTemplate!.name);
      expect(prompts.userPrompt).not.toContain("--course-radius-card");
      expect(prompts.userPrompt).not.toContain("--course-layout-density");
      expect(prompts.userPrompt).not.toContain(`\"id\":\"${styleId}\"`);
    },
  );
});
