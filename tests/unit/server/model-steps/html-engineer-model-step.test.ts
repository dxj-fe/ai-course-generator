import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { generateTextSafe } from "../../../../src/server/infra/ai/client";
import { renderDeterministicPageFallback } from "../../../../src/server/course/page/deterministic-fallback";
import {
  createHtmlEngineerModelStep,
  createHtmlEngineerModelStepState,
  normalizeChoiceInteractionRoot,
  normalizeChoiceRuntimeMarkers,
  normalizeConditionalFeedbackVisibility,
  normalizeExploreCardInteraction,
  normalizeGeneratedActiveContent,
  normalizeGeneratedCanvasRoot,
  normalizeGeneratedHtmlEnvelope,
  normalizeNativeInteractionMarker,
  normalizeRevealCardInteraction,
  normalizeRevealRuntimeMarkers,
  normalizeSortCardInteraction,
  normalizeSubmissionRuntimeMarker,
  normalizeTrustedDslMarkup,
  normalizeTrustedPageTitle,
  normalizeTrustedPlayerLayout,
  normalizeUniqueReadyAssetSlotRoots,
  normalizeVisualPrimitiveMarker,
  removeRedundantRestoredDslMarkup,
  resolveHtmlEngineerInput,
  validateHtmlEngineerOutput,
} from "../../../../src/server/agent/plugins/model-steps/course/html-engineer-model-step";
import type {
  AssetGenerationResult,
  PageContentDSL,
} from "../../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";

vi.mock("../../../../src/server/infra/ai/client", () => ({
  generateTextSafe: vi.fn(),
}));

const input = { content: pageContentDsl, visualBrief };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const assetRichContent = {
  ...pageContentDsl,
  blocks: [
    ...pageContentDsl.blocks,
    {
      id: "block-03",
      kind: "instruction" as const,
      heading: "任务卡：完成观察报告",
      body: "先比较恒星与行星，再写下一条最重要的观察结论。",
      supportingPoints: ["课程文字必须保持为可选择、可朗读的 HTML。"],
    },
  ],
  assetSlots: [
    {
      id: "asset-slot-01" as const,
      type: "image" as const,
      role: "background" as const,
      purpose: "为观察任务建立低细节太空背景。",
      required: true,
      altTextGuidance: "保留左侧文字安全区的太空观察背景。",
    },
    {
      id: "asset-slot-02" as const,
      type: "illustration" as const,
      role: "inline" as const,
      purpose: "用宇航员贴纸提示学习者完成任务卡。",
      required: true,
      altTextGuidance: "指向任务卡的小小宇航员。",
    },
  ],
  layoutHints: {
    ...pageContentDsl.layoutHints,
    readingOrder: [...pageContentDsl.layoutHints.readingOrder, "block-03"],
  },
};

const readyAssetResults: AssetGenerationResult[] = [
  {
    request: {
      assetSlotId: "asset-slot-01",
      assetType: "background",
      usage: "为观察任务建立低细节太空背景。",
      prompt:
        "A low-detail educational space background with a clear text-safe area and no words.",
      transparentBackground: false,
      safeArea: {
        position: "left",
        coveragePercent: 40,
        description: "为 HTML 任务卡保留左侧低细节区域。",
      },
      aspectRatio: "16:9",
    },
    status: "ready",
    asset: {
      id: "asset-background",
      type: "image",
      role: "background",
      source: "generated",
      status: "ready",
      uri: "/api/assets/asset-background",
      altText: "保留左侧文字安全区的太空观察背景。",
      generationPrompt: "A low-detail educational space background.",
      mimeType: "image/png",
      dimensions: { width: 1600, height: 900 },
      usedByPageIds: [assetRichContent.pageId],
    },
    provider: "test-provider",
    model: "test-image-model",
    durationMs: 10,
  },
  {
    request: {
      assetSlotId: "asset-slot-02",
      assetType: "character_sticker",
      usage: "用宇航员贴纸提示学习者完成任务卡。",
      prompt:
        "A friendly astronaut sticker with a complete silhouette, transparent background, and no text.",
      transparentBackground: true,
      safeArea: {
        position: "none",
        coveragePercent: 0,
        description: "独立贴纸不承载 HTML 文本。",
      },
      aspectRatio: "3:4",
    },
    status: "ready",
    asset: {
      id: "asset-character",
      type: "illustration",
      role: "inline",
      source: "generated",
      status: "ready",
      uri: "/api/assets/asset-character",
      altText: "指向任务卡的小小宇航员。",
      generationPrompt: "A friendly astronaut sticker with no text.",
      mimeType: "image/png",
      dimensions: { width: 768, height: 1024 },
      usedByPageIds: [assetRichContent.pageId],
    },
    provider: "test-provider",
    model: "test-image-model",
    durationMs: 10,
  },
];

function buildAssetRichHtml() {
  return buildValidGeneratedHtml(assetRichContent)
    .replace(
      '<figure data-asset-slot-id="asset-slot-01">',
      '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
    )
    .replace(
      '<figure data-asset-slot-id="asset-slot-02">',
      '<figure><img data-asset-slot-id="asset-slot-02" src="/api/assets/asset-character" alt="指向任务卡的小小宇航员。">',
    );
}

type ChoiceContent = Omit<PageContentDSL, "interaction"> & {
  interaction: Extract<PageContentDSL["interaction"], { type: "choice" }>;
};

function getChoiceContent(): ChoiceContent {
  const content = getFunctionalTemplateDslExample("interactive-quiz");
  if (!content || content.interaction.type !== "choice") {
    throw new Error("interactive-quiz 测试夹具必须使用 choice interaction");
  }

  return {
    ...content,
    interaction: content.interaction,
  };
}

function withTrustedRuntime(
  interaction: PageContentDSL["interaction"],
  base: PageContentDSL = pageContentDsl,
): PageContentDSL {
  return {
    ...base,
    version: 2,
    interaction,
    runtime: {
      runtimeVersion: 1,
      sceneKind: interaction.type === "none" ? "explain" : "practice",
      visualPrimitive: "comparison",
      motionPlan: {
        intensity: "none",
        cuePoints: [],
      },
      completionRule:
        interaction.type === "none" || interaction.type === "navigate"
          ? { type: "view" }
          : {
              type:
                interaction.type === "choice"
                  ? "correct-answer"
                  : "interaction-complete",
              interactionId: `interaction-${base.pageId}`,
            },
    },
  };
}

function countBodyText(html: string, text: string) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(escaped, "g"))?.length ?? 0;
}

describe("HtmlEngineerModelStep", () => {
  it("uses the bounded HTML-specific timeout for the default model call", async () => {
    vi.stubEnv("AI_HTML_TIMEOUT_MS", "180000");
    vi.mocked(generateTextSafe).mockResolvedValueOnce({
      text: buildValidGeneratedHtml(pageContentDsl),
    } as Awaited<ReturnType<typeof generateTextSafe>>);

    const result = await createHtmlEngineerModelStep().run(
      createHtmlEngineerModelStepState(input),
      { traceId: "html-engineer-timeout-test" },
    );

    expect(result.status).toBe("completed");
    expect(generateTextSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "html",
        timeoutMs: 180_000,
      }),
    );
  });

  it("generates and validates one HTML document in one bounded step", async () => {
    const generateHtml = vi
      .fn()
      .mockResolvedValue(buildValidGeneratedHtml(pageContentDsl));
    const result = await createHtmlEngineerModelStep({ generateHtml }).run(
      createHtmlEngineerModelStepState(input),
      { traceId: "html-engineer-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).toContain("<!doctype html>");
    expect(result.htmlOutput?.html).toContain(
      'data-keya-canvas-mode="fluid"',
    );
    expect(result.validation?.contract.valid).toBe(true);
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "validation",
      "finish",
    ]);
    expect(generateHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        content: pageContentDsl,
        functionalTemplate: expect.objectContaining({
          id: pageContentDsl.functionalTemplateId,
        }),
        pageGuidance: expect.objectContaining({ pageId: pageContentDsl.pageId }),
        styleTemplate: expect.objectContaining({ id: visualBrief.styleTemplateId }),
      }),
    );
    expect(generateHtml.mock.calls[0]?.[0]).not.toHaveProperty("userPrompt");
  });

  it("removes model-authored active content before contract validation", async () => {
    const unsafeHtml = buildValidGeneratedHtml(pageContentDsl).replace(
      "</body>",
      "<script>document.body.textContent = 'unsafe'</script><button onclick=\"alert('x')\">危险按钮</button></body>",
    );
    const generateHtml = vi.fn().mockResolvedValueOnce(unsafeHtml);

    const result = await createHtmlEngineerModelStep({ generateHtml }).run(
      createHtmlEngineerModelStepState(input),
      { traceId: "html-contract-retry-test" },
    );

    expect(result.status).toBe("completed");
    expect(generateHtml).toHaveBeenCalledTimes(1);
    expect(result.htmlOutput?.html).not.toContain("<script");
    expect(result.htmlOutput?.html).not.toContain("onclick=");
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).toMatchObject({
      contractRetryApplied: false,
      fallbackApplied: false,
    });
  });

  it("retries one deterministic HTML contract failure before using fallback", async () => {
    const generateHtml = vi
      .fn()
      .mockResolvedValueOnce("模型没有返回 HTML 文档")
      .mockResolvedValueOnce(buildValidGeneratedHtml(pageContentDsl));

    const result = await createHtmlEngineerModelStep({ generateHtml }).run(
      createHtmlEngineerModelStepState(input),
      { traceId: "html-contract-retry-test" },
    );

    expect(result.status).toBe("completed");
    expect(generateHtml).toHaveBeenCalledTimes(2);
    expect(generateHtml.mock.calls[1]?.[0]).toMatchObject({
      validationFeedback: {
        code: "HTML_CONTRACT_RETRY",
        issues: expect.arrayContaining([
          expect.stringContaining("HTML 必须以"),
        ]),
      },
    });
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).toMatchObject({
      contractRetryApplied: true,
      fallbackApplied: false,
    });
  });

  it("renders a strictly valid v2 fallback for every interaction type", () => {
    const interactions: PageContentDSL["interaction"][] = [
      { type: "none" },
      {
        type: "navigate",
        actionLabel: "继续学习",
        destination: "next",
      },
      pageContentDsl.interaction,
      {
        type: "explore",
        prompt: "探索两类天体的特点。",
        items: [
          { id: "item-star", label: "恒星线索", content: "观察它是否自行发光。" },
          { id: "item-planet", label: "行星线索", content: "观察它如何围绕恒星运行。" },
        ],
      },
      {
        type: "choice",
        questions: [
          {
            id: "question-01",
            prompt: "哪一种天体会自己发光？",
            options: [
              { id: "option-star", label: "恒星" },
              { id: "option-planet", label: "行星" },
            ],
            correctOptionId: "option-star",
            feedback: {
              success: "正确，恒星能够自行发光。",
              retry: "再比较恒星和行星的发光方式。",
            },
            maxAttempts: 2,
          },
        ],
      },
      {
        type: "sort",
        prompt: "按学习顺序排列观察步骤。",
        items: [
          { id: "item-observe", label: "先观察", content: "查看天体是否发光。" },
          { id: "item-compare", label: "再比较", content: "比较两类天体的差异。" },
        ],
        correctOrderIds: ["item-observe", "item-compare"],
        feedback: {
          success: "顺序正确，先观察再比较。",
          retry: "先寻找线索，再进行比较。",
        },
      },
      {
        type: "input",
        prompt: "写下恒星与行星的一项差异。",
        placeholder: "例如：是否会自己发光",
        evaluationCriteria: ["指出恒星特点", "指出行星特点"],
        feedback: {
          success: "回答已提交，比较结果清楚。",
          retry: "请同时说明两类天体的特点。",
        },
      },
    ];
    const styleTemplate = resolveHtmlEngineerInput(input).styleTemplate;

    for (const interaction of interactions) {
      const content = withTrustedRuntime(interaction);
      const html = renderDeterministicPageFallback({
        content,
        styleTemplate,
      });

      expect(() =>
        validateHtmlEngineerOutput(html, {
          content,
          visualBrief,
        }),
      ).not.toThrow();
      expect(html).toContain('data-visual-primitive="comparison"');
      for (const block of content.blocks) {
        expect(html).toContain(
          `data-block-id="${block.id}" data-runtime-target-id="${block.id}"`,
        );
      }
      if (interaction.type !== "none") {
        expect(html).toContain(
          `data-interaction-id="interaction-${content.pageId}"`,
        );
      }
    }
  });

  it("falls back from an incomplete achievement input page without duplicating trusted body copy", async () => {
    const example = getFunctionalTemplateDslExample("achievement-task");
    if (!example || example.interaction.type !== "input") {
      throw new Error("achievement-task 测试夹具必须使用 input interaction");
    }
    const interaction = {
      ...example.interaction,
      prompt: "请完成猴王小解说任务。",
      placeholder: "写下猴王出世的意义",
      evaluationCriteria: [
        "能说明猴王出世在开篇的意义",
        "能关联到后续取经情节",
      ],
      feedback: {
        success: "猴王小解说任务已提交。",
        retry: "请补充开篇意义与后续情节的关联。",
      },
    };
    const achievementBase = {
      ...example,
      pageId: pageContentDsl.pageId,
      title: "猴王小解说任务",
      interaction,
    };
    const content = withTrustedRuntime(interaction, achievementBase);
    const result = await createHtmlEngineerModelStep({
      generateHtml: vi.fn().mockResolvedValue(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}</style></head><body><main data-page-id="${content.pageId}"><p>模型遗漏了任务标题与评价标准</p></main></body></html>`,
      ),
    }).run(
      createHtmlEngineerModelStepState({
        content,
        visualBrief,
      }),
      { traceId: "achievement-input-fallback-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).toBeDefined();
    expect(() =>
      validateHtmlEngineerOutput(result.htmlOutput?.html, {
        content,
        visualBrief,
      }),
    ).not.toThrow();
    expect(
      result.htmlOutput!.html.match(
        new RegExp(`<h1>${content.title}</h1>`, "g"),
      ),
    ).toHaveLength(1);
    for (const block of content.blocks) {
      expect(countBodyText(result.htmlOutput!.html, block.body)).toBe(1);
    }
    for (const criterion of interaction.evaluationCriteria) {
      expect(countBodyText(result.htmlOutput!.html, criterion)).toBe(1);
    }
    expect(result.htmlOutput?.html).toContain('data-runtime-input="true"');
    expect(result.htmlOutput?.html).toContain('data-runtime-submit="true"');
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).toMatchObject({ fallbackApplied: true });
  });

  it("renders ready and fallback asset slots through the same strict contract", () => {
    const fallbackAsset: AssetGenerationResult = {
      request: readyAssetResults[1]!.request,
      status: "fallback",
      fallback: {
        kind: "css-gradient",
        description: "使用柔和渐变代替角色贴纸。",
      },
      durationMs: 10,
    };
    const assets = [readyAssetResults[0]!, fallbackAsset];
    const styleTemplate = resolveHtmlEngineerInput({
      content: assetRichContent,
      visualBrief,
      assets,
    }).styleTemplate;
    const html = renderDeterministicPageFallback({
      assets,
      content: assetRichContent,
      styleTemplate,
    });

    expect(() =>
      validateHtmlEngineerOutput(html, {
        assets,
        content: assetRichContent,
        visualBrief,
      }),
    ).not.toThrow();
    expect(html).toContain(
      'data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background"',
    );
    expect(html).toContain(
      'data-asset-slot-id="asset-slot-02" data-asset-fallback="css-gradient"',
    );
  });

  it("normalizes the generated document to the platform fluid canvas mode", () => {
    const generated =
      '<!doctype html><html data-keya-canvas-mode="fixed" style="width:1200px"><head></head><body></body></html>';

    const normalized = normalizeGeneratedCanvasRoot(generated);

    expect(normalized).toContain(
      '<html style="width:1200px" data-keya-canvas-mode="fluid">',
    );
    expect(normalized).not.toContain('data-keya-canvas-mode="fixed"');
    expect(String(normalized).match(/data-keya-canvas-mode=/g)).toHaveLength(1);
  });

  it("extracts fenced HTML and removes every model-authored active capability", () => {
    const generated = `说明文字
\`\`\`html
<!doctype html><html><head>
<meta name="viewport" content="width=device-width">
<meta http-equiv="refresh" content="0;url=https://example.com">
<link rel="stylesheet" href="https://example.com/a.css">
<style>@import "https://example.com/a.css";.hero{background:url(https://example.com/a.png)}</style>
</head><body onload="alert(1)">
<main data-page-id="page-01"><a href="javascript:alert(1)">继续</a>
<img src="https://example.com/a.png"><iframe src="https://example.com"></iframe>
<script src="https://example.com/a.js"></script><object></object><embed src="/x">
</main></body></html>
\`\`\`
尾部说明`;

    const normalized = normalizeGeneratedActiveContent(
      normalizeGeneratedHtmlEnvelope(generated),
    );

    expect(normalized).toMatch(/^<!doctype html>/);
    expect(normalized).toMatch(/<\/html>$/);
    expect(normalized).not.toMatch(
      /<script|onload=|http-equiv="refresh"|<link|https?:\/\/|<object|<embed/i,
    );
    expect(normalized).toContain('href="#"');
  });

  it("upgrades complete explore cards to native progressive details controls", () => {
    const interaction = {
      type: "explore" as const,
      prompt: "逐项探索三类环境挑战。",
      items: [
        {
          id: "item-01",
          label: "稀薄大气",
          content: "气压很低，液态水难以稳定存在。",
        },
        {
          id: "item-02",
          label: "极端低温",
          content: "平均温度远低于地球。",
        },
      ],
    };
    const content = withTrustedRuntime(interaction);
    const cards = interaction.items
      .map(
        (item) =>
          `<div class="explore-item" data-interaction-item-id="${item.id}"><h3>${item.label}</h3><div>${item.content}</div></div>`,
      )
      .join("");
    const html =
      `<!doctype html><html><head></head><body>` +
      `<main data-page-id="${content.pageId}">` +
      `<section data-interaction-type="explore" data-interaction-id="interaction-${content.pageId}">${cards}</section>` +
      `</main></body></html>`;

    const normalized = normalizeExploreCardInteraction(html, content);

    expect(normalized).toContain(
      '<details class="keya-trusted-explore-card" data-interaction-item-id="item-01"',
    );
    expect(normalized).toContain("<summary>稀薄大气</summary>");
    expect(normalized).toContain(
      'data-course-contract-restored="explore-control"',
    );
    expect(
      String(normalized).match(/data-interaction-item-id="item-01"/g),
    ).toHaveLength(1);
  });

  it("injects the trusted low-height player layout guard exactly once", () => {
    const generated =
      "<!doctype html><html><head><style>main{gap:3rem}</style></head><body><main data-page-id=\"page-01\"></main></body></html>";

    const normalized = normalizeTrustedPlayerLayout(
      normalizeTrustedPlayerLayout(generated),
    );

    expect(normalized).toContain('data-keya-layout-guard="v21"');
    expect(normalized).toContain(
      "html,body{width:100%!important;height:100%!important;margin:0!important;padding:0!important",
    );
    expect(normalized).toContain(
      "main[data-page-id]>*{min-width:0;box-sizing:border-box}",
    );
    expect(normalized).not.toContain(
      "main[data-page-id]>*{min-width:0;max-width:100%",
    );
    expect(normalized).toContain("@media (min-width:600px) and (max-height:520px)");
    expect(normalized).toContain("max-height:min(30vh,12rem)!important");
    expect(normalized).toContain(
      "[data-interaction-item-id]{width:auto!important;min-width:0!important;max-width:100%!important",
    );
    expect(normalized).toContain(
      ">details[data-block-id]:not([open]){min-height:44px!important;padding:0!important}",
    );
    expect(normalized).toContain(
      "[data-block-id]:has(>details){padding:0!important}",
    );
    expect(normalized).toContain(
      "[data-block-id]>details:not([open]){min-height:44px!important;padding:0!important}",
    );
    expect(normalized).toContain(
      '*:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])',
    );
    expect(normalized).toContain(
      ':has(>[data-block-id]):has(>[data-interaction-type="sort"])',
    );
    expect(normalized).toContain('data-keya-asset-type="icon"');
    expect(normalized).toContain("details>summary");
    expect(normalized).toContain(
      "[data-visual-primitive]:has([data-block-id]):has([data-interaction-type])",
    );
    expect(normalized).toContain("height:32%!important");
    expect(normalized).toContain(
      "grid-template-rows:auto repeat(6,minmax(44px,1fr))!important",
    );
    expect(normalized).toContain("grid-row:2/8!important");
    expect(String(normalized).match(/data-keya-layout-guard=/g)).toHaveLength(1);
    expect(String(normalized).indexOf('data-keya-layout-guard="v21"')).toBeLessThan(
      String(normalized).indexOf("</head>"),
    );
  });

  it("replaces a previous trusted player layout guard instead of stacking versions", () => {
    const generated =
      '<!doctype html><html><head><style data-keya-layout-guard="v19">old</style></head><body><main data-page-id="page-01"></main></body></html>';

    const normalized = normalizeTrustedPlayerLayout(generated);

    expect(normalized).toContain('data-keya-layout-guard="v21"');
    expect(normalized).not.toContain('data-keya-layout-guard="v19"');
    expect(String(normalized).match(/data-keya-layout-guard=/g)).toHaveLength(1);
  });

  it("restores the immutable page title when the model omits the h1", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      `<h1>${pageContentDsl.title}</h1>`,
      "",
    );

    const normalized = normalizeTrustedPageTitle(html, input);

    expect(normalized).toContain(
      `<h1 data-keya-trusted-page-title="true">${pageContentDsl.title}</h1>`,
    );
    expect(() => validateHtmlEngineerOutput(normalized, input)).not.toThrow();
  });

  it("marks a uniquely named code-native visual root with the trusted primitive", () => {
    const runtimeContent = {
      ...pageContentDsl,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "concept-map" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${pageContentDsl.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const generated = `<!doctype html><html><head><title>${runtimeContent.title}</title></head><body><main data-page-id="${runtimeContent.pageId}"><section class="course-concept-map"><article>${runtimeContent.blocks[0]?.heading}</article><article>${runtimeContent.blocks[1]?.heading}</article></section></main></body></html>`;

    const normalized = normalizeVisualPrimitiveMarker(generated, {
      content: runtimeContent,
      visualBrief,
    });

    expect(normalized).toContain(
      '<section class="course-concept-map" data-visual-primitive="concept-map">',
    );
  });

  it("uses the smallest complete block group as a code-native comparison visual", () => {
    const runtimeContent = {
      ...pageContentDsl,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "comparison" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${pageContentDsl.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const blocks = runtimeContent.blocks
      .map(
        ({ id, heading }) =>
          `<article data-block-id="${id}">${heading}</article>`,
      )
      .join("");
    const generated = `<!doctype html><html><head><title>${runtimeContent.title}</title></head><body><main data-page-id="${runtimeContent.pageId}"><div class="left-content"><div class="blocks-group">${blocks}</div></div></main></body></html>`;

    const normalized = normalizeVisualPrimitiveMarker(generated, {
      content: runtimeContent,
      visualBrief,
    });

    expect(normalized).toContain(
      '<div class="blocks-group" data-visual-primitive="comparison">',
    );
    expect(normalized).not.toContain(
      'data-course-contract-restored="visual-primitive"',
    );
  });

  it("restores a bounded code-native visual when the model omits the required primitive", () => {
    const runtimeContent = {
      ...pageContentDsl,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "concept-map" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${pageContentDsl.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const generated = buildValidGeneratedHtml(runtimeContent);

    const normalized = normalizeVisualPrimitiveMarker(generated, {
      content: runtimeContent,
      visualBrief,
    });

    expect(normalized).toContain('data-visual-primitive="concept-map"');
    expect(normalized).toContain(
      'data-course-contract-restored="visual-primitive"',
    );
  });

  it("allows a code-native primitive inside main when main only consumes a background asset", () => {
    const runtimeContent = {
      ...assetRichContent,
      assetSlots: [assetRichContent.assetSlots[0]!],
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "concept-map" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${assetRichContent.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const generated = buildValidGeneratedHtml(runtimeContent).replace(
      `<main data-page-id="${runtimeContent.pageId}">`,
      `<main data-page-id="${runtimeContent.pageId}" data-asset-slot-id="asset-slot-01">`,
    );

    const normalized = normalizeVisualPrimitiveMarker(generated, {
      content: runtimeContent,
      visualBrief,
    });

    expect(normalized).toContain('data-visual-primitive="concept-map"');
  });

  it("uses the smallest complete interaction-item container as a native timeline", () => {
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const runtimeContent = {
      ...pageContentDsl,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "timeline" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${pageContentDsl.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const items = interaction.items
      .map(
        ({ id, label }) =>
          `<details data-interaction-item-id="${id}"><summary>${label}</summary></details>`,
      )
      .join("");
    const generated = `<!doctype html><html><head><title>${runtimeContent.title}</title></head><body><main data-page-id="${runtimeContent.pageId}"><section data-interaction-type="reveal" data-interaction-id="interaction-${runtimeContent.pageId}"><div class="planet-cards">${items}</div></section></main></body></html>`;

    const normalized = normalizeVisualPrimitiveMarker(generated, {
      content: runtimeContent,
      visualBrief,
    });

    expect(normalized).toContain(
      '<div class="planet-cards" data-visual-primitive="timeline">',
    );
    expect(normalized).not.toContain(
      'data-course-contract-restored="visual-primitive"',
    );
  });

  it("does not relabel incompatible or out-of-main visual content", () => {
    const runtimeContent = {
      ...pageContentDsl,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "concept-map" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${pageContentDsl.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const incompatible = `<!doctype html><html><head><title>${runtimeContent.title}</title></head><body><main data-page-id="${runtimeContent.pageId}"><section class="course-concept-map" data-visual-primitive="timeline"><article>${runtimeContent.blocks[0]?.heading}</article><article>${runtimeContent.blocks[1]?.heading}</article></section></main></body></html>`;
    const outsideMain = `<!doctype html><html><head><title>${runtimeContent.title}</title></head><body><section class="course-concept-map"><article>${runtimeContent.blocks[0]?.heading}</article><article>${runtimeContent.blocks[1]?.heading}</article></section><main data-page-id="${runtimeContent.pageId}"></main></body></html>`;

    expect(
      normalizeVisualPrimitiveMarker(incompatible, {
        content: runtimeContent,
        visualBrief,
      }),
    ).toBe(incompatible);
    const normalizedOutside = normalizeVisualPrimitiveMarker(outsideMain, {
      content: runtimeContent,
      visualBrief,
    });
    if (typeof normalizedOutside !== "string") {
      throw new Error("visual primitive normalization must return HTML");
    }
    expect(normalizedOutside).toContain(
      '<section class="course-concept-map"><article>',
    );
    expect(normalizedOutside).toContain(
      'data-course-contract-restored="visual-primitive"',
    );
    expect(normalizedOutside.match(/data-visual-primitive="concept-map"/g))
      .toHaveLength(1);
  });

  it("removes an asset-bound primitive marker before restoring the code-native visual", () => {
    const runtimeContent = {
      ...assetRichContent,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "comparison" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "interaction-complete" as const,
          interactionId: `interaction-${assetRichContent.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const generated = buildValidGeneratedHtml(runtimeContent).replace(
      '<figure data-asset-slot-id="asset-slot-01">',
      '<figure data-asset-slot-id="asset-slot-01" data-visual-primitive="comparison">',
    );

    const normalized = normalizeVisualPrimitiveMarker(generated, {
      content: runtimeContent,
      visualBrief,
    });
    if (typeof normalized !== "string") {
      throw new Error("代码原生图示规范化必须返回 HTML 字符串");
    }

    expect(
      normalized.match(/data-visual-primitive="comparison"/g),
    ).toHaveLength(1);
    expect(normalized).toContain(
      'data-course-contract-restored="visual-primitive"',
    );
    expect(normalized).not.toContain(
      'data-asset-slot-id="asset-slot-01" data-visual-primitive',
    );
  });

  it("adds choice runtime markers only to uniquely provable native controls", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset class="question-card"><legend>${question.prompt}</legend>${question.options
            .map(
              (option) =>
                `<label><input type="radio" name="${question.id}" value="${option.id}">${option.label}</label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><head><title>${content.title}</title></head><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">${questions}<button class="check-answer">检查答案</button><p data-feedback-kind="success" hidden>正确</p><p data-feedback-kind="retry" hidden>再试一次</p></section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, {
      content,
      visualBrief,
    });

    for (const question of content.interaction.questions) {
      expect(normalized).toContain(
        `data-question-id="${question.id}"`,
      );
    }
    expect(normalized).toContain('data-runtime-submit="true"');
  });

  it("adds the sort submit marker to one unambiguous native button", () => {
    const interaction = {
      type: "sort" as const,
      prompt: "按离太阳由近到远排序。",
      items: [
        { id: "item-earth", label: "地球", content: "第三颗行星" },
        { id: "item-mars", label: "火星", content: "第四颗行星" },
      ],
      correctOrderIds: ["item-earth", "item-mars"],
      feedback: {
        success: "顺序正确。",
        retry: "再按距离太阳由近到远检查一次。",
      },
    };
    const content = withTrustedRuntime(interaction);
    const generated =
      `<!doctype html><html><body><main data-page-id="${content.pageId}">` +
      `<section data-interaction-type="sort" data-interaction-id="interaction-${content.pageId}">` +
      `<div data-interaction-item-id="item-earth">地球 第三颗行星</div>` +
      `<div data-interaction-item-id="item-mars">火星 第四颗行星</div>` +
      `<button type="button" class="check-order">检查顺序</button>` +
      `<div data-feedback-kind="success">顺序正确。</div>` +
      `</section></main></body></html>`;

    const normalized = normalizeConditionalFeedbackVisibility(
      normalizeSubmissionRuntimeMarker(
        normalizeSortCardInteraction(generated, content),
        content,
      ),
      content,
    );

    expect(normalized).toContain(
      'class="check-order" data-runtime-submit="true"',
    );
    expect(normalized).toContain(
      '<details class="keya-trusted-sort-card" data-interaction-item-id="item-earth"',
    );
    expect(normalized).toContain("<summary>地球</summary>");
    expect(normalized).toContain("<p>第三颗行星</p>");
    expect(normalized).toContain(
      'data-feedback-kind="success" hidden="hidden"',
    );
    expect(String(normalized).match(/data-runtime-submit="true"/g)).toHaveLength(
      1,
    );
  });

  it("adds the page-level submit button when complete choice controls omit it", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset data-question-id="${question.id}"><legend>${question.prompt}</legend>${question.options
            .map(
              (option) =>
                `<label><input type="radio" name="${question.id}" value="${option.id}">${option.label}</label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">${questions}</section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, { content });

    if (typeof normalized !== "string") {
      throw new Error("choice normalization must return HTML");
    }
    expect(normalized.match(/data-runtime-submit="true"/g)).toHaveLength(1);
    expect(normalized).toContain(">提交答案</button>");
  });

  it("collapses repeated per-question submit buttons into one page-level submit", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset data-question-id="${question.id}"><legend>${question.prompt}</legend>${question.options
            .map(
              (option) =>
                `<label><input type="radio" name="${question.id}" value="${option.id}">${option.label}</label>`,
            )
            .join("")}<button type="button">提交本题</button></fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">${questions}</section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, { content });

    if (typeof normalized !== "string") {
      throw new Error("choice normalization must return HTML");
    }
    expect(normalized.match(/<button\b/g)).toHaveLength(1);
    expect(normalized.match(/data-runtime-submit="true"/g)).toHaveLength(1);
    expect(normalized).toContain(">提交答案</button>");
  });

  it("collapses already marked per-question submit buttons into one page-level submit", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset data-question-id="${question.id}"><legend>${question.prompt}</legend>${question.options
            .map(
              (option) =>
                `<label><input type="radio" name="${question.id}" value="${option.id}">${option.label}</label>`,
            )
            .join("")}<button type="button" data-runtime-submit="true">提交本题</button></fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">${questions}</section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, { content });

    if (typeof normalized !== "string") {
      throw new Error("choice normalization must return HTML");
    }
    expect(normalized.match(/<button\b/g)).toHaveLength(1);
    expect(normalized.match(/data-runtime-submit="true"/g)).toHaveLength(1);
    expect(normalized).toContain(">提交答案</button>");
  });

  it("adds a missing choice interaction id to the uniquely bound root", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset>${question.options
            .map(
              (option) =>
                `<label><input type="radio" value="${option.id}">${option.label}</label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice">${questions}<button>提交答案</button></section></main></body></html>`;

    const normalized = normalizeChoiceInteractionRoot(generated, {
      content,
    });

    expect(normalized).toContain(
      `<section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">`,
    );
  });

  it("moves duplicated per-question choice markers to their unique common root", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset data-interaction-type="choice">${question.options
            .map(
              (option) =>
                `<label><input type="radio" value="${option.id}">${option.label}</label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><body><main data-page-id="${content.pageId}"><form>${questions}<button>提交答案</button></form></main></body></html>`;

    const normalized = normalizeChoiceInteractionRoot(generated, {
      content,
    });

    expect(normalized).toContain(
      `<form data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">`,
    );
    expect(
      String(normalized).match(/data-interaction-type="choice"/g),
    ).toHaveLength(1);
    expect(normalized).not.toContain(
      '<fieldset data-interaction-type="choice">',
    );
  });

  it("does not merge ambiguous duplicated choice roots", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset>${question.options
            .map(
              (option) =>
                `<input type="radio" value="${option.id}">`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const root = `<form data-interaction-type="choice">${questions}<button>提交答案</button></form>`;
    const generated = `<!doctype html><html><body><main data-page-id="${content.pageId}">${root}${root}</main></body></html>`;

    expect(
      normalizeChoiceInteractionRoot(generated, { content }),
    ).toBe(generated);
  });

  it("does not guess a choice submit target when multiple buttons exist", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const generated = `<!doctype html><html><head><title>${content.title}</title></head><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}"><button>上一题</button><button>提交答案</button></section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, {
      content,
      visualBrief,
    });

    expect(normalized).not.toContain('data-runtime-submit="true"');
  });

  it("moves a legacy single-question marker to the scope that contains its options", () => {
    const choice = getChoiceContent();
    const question = choice.interaction.questions[0];
    const content = {
      ...choice,
      version: 2 as const,
      interaction: {
        ...choice.interaction,
        questions: [question],
      },
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const options = question.options
      .map(
        (option) =>
          `<li><input type="radio" value="${option.id}">${option.label}</li>`,
      )
      .join("");
    const generated = `<!doctype html><html><head><title>${content.title}</title></head><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}"><div data-question-id="${question.id}">${question.prompt}</div><ul>${options}</ul><button data-runtime-submit="true">提交</button><p data-feedback-kind="success" hidden>${question.feedback.success}</p><p data-feedback-kind="retry" hidden>${question.feedback.retry}</p></section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, {
      content,
      visualBrief,
    });

    expect(normalized).toContain(
      `<section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}" data-question-id="${question.id}">`,
    );
    expect(normalized).not.toContain(
      `<div data-question-id="${question.id}">`,
    );
  });

  it("restores omitted multi-question prompts inside option-bound question scopes", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset>${question.options
            .map(
              (option) =>
                `<label><input type="radio" value="${option.id}">${option.label}</label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><head><title>${content.title}</title></head><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">${questions}<button data-runtime-submit="true">提交</button><p data-feedback-kind="success" hidden>正确</p><p data-feedback-kind="retry" hidden>再试一次</p></section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, {
      content,
      visualBrief,
    });

    for (const question of content.interaction.questions) {
      expect(normalized).toContain(
        `data-question-id="${question.id}"`,
      );
      expect(normalized).toContain(question.prompt);
    }
  });

  it("restores missing hidden choice feedback from the trusted DSL", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      version: 2 as const,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${choice.pageId}`,
        },
      },
    } satisfies PageContentDSL;
    const questions = content.interaction.questions
      .map(
        (question) =>
          `<fieldset data-question-id="${question.id}"><legend>${question.prompt}</legend>${question.options
            .map(
              (option) =>
                `<label><input type="radio" name="${question.id}" value="${option.id}">${option.label}</label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
    const generated = `<!doctype html><html><head><title>${content.title}</title></head><body><main data-page-id="${content.pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">${questions}<button data-runtime-submit="true">提交答案</button><p data-feedback-kind="success">${content.interaction.questions[0].feedback.success}</p></section></main></body></html>`;

    const normalized = normalizeChoiceRuntimeMarkers(generated, {
      content,
      visualBrief,
    });

    expect(normalized).toContain(
      'data-feedback-kind="success" hidden="hidden"',
    );
    expect(normalized).toContain('data-feedback-kind="retry" hidden>');
    expect(normalized).toContain(
      content.interaction.questions[0].feedback.retry,
    );
  });

  it("canonicalizes a uniquely bound CSS background to the approved alt text", async () => {
    const generatedHtml = buildAssetRichHtml()
      .replace(
        '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
        '<figure class="course-hero-asset" data-asset-slot-id="asset-slot-01" role="img" aria-label="模型改写的背景说明">',
      )
      .replace(
        "</style>",
        ".course-hero-asset { background-image: url('/api/assets/asset-background'); }</style>",
      );
    const task = {
      content: assetRichContent,
      visualBrief,
      assets: readyAssetResults,
    };

    expect(() => validateHtmlEngineerOutput(generatedHtml, task)).toThrow(
      "CSS 背景必须提供匹配的可访问说明",
    );

    const result = await createHtmlEngineerModelStep({
      generateHtml: vi.fn().mockResolvedValue(generatedHtml),
    }).run(createHtmlEngineerModelStepState(task), {
      traceId: "css-background-accessibility-normalization-test",
    });

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).toContain(
      'role="img" aria-label="保留左侧文字安全区的太空观察背景。"',
    );
    expect(result.htmlOutput?.html).not.toContain("模型改写的背景说明");
  });

  it("keeps one ready asset root when a wrapper duplicates its direct image marker", () => {
    const html = buildAssetRichHtml().replace(
      '<figure><img data-asset-slot-id="asset-slot-01"',
      '<figure data-asset-slot-id="asset-slot-01"><img data-asset-slot-id="asset-slot-01"',
    );
    const task = {
      content: assetRichContent,
      visualBrief,
      assets: readyAssetResults,
    };

    const normalized = normalizeUniqueReadyAssetSlotRoots(html, task);
    if (typeof normalized !== "string") {
      throw new Error("素材槽规范化必须返回 HTML 字符串");
    }

    expect(
      normalized.match(/data-asset-slot-id="asset-slot-01"/g),
    ).toHaveLength(1);
    expect(normalized).toContain(
      '<img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background"',
    );
    expect(normalized).toContain('data-keya-asset-role="background"');
    expect(normalized).toContain('data-keya-asset-type="image"');
    expect(() =>
      validateHtmlEngineerOutput(normalized, task),
    ).not.toThrow();
  });

  it("canonicalizes immutable page title and uniquely bound image alt text", async () => {
    const generatedHtml = buildAssetRichHtml()
      .replace(
        `<h1>${assetRichContent.title}</h1>`,
        "<h1>模型擅自改写的标题</h1>",
      )
      .replace(
        'alt="保留左侧文字安全区的太空观察背景。"',
        'alt="模型改写的图片说明"',
      );
    const result = await createHtmlEngineerModelStep({
      generateHtml: vi.fn().mockResolvedValue(generatedHtml),
    }).run(
      createHtmlEngineerModelStepState({
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
      { traceId: "trusted-title-and-alt-normalization-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).toContain(
      `<h1>${assetRichContent.title}</h1>`,
    );
    expect(result.htmlOutput?.html).toContain(
      'alt="保留左侧文字安全区的太空观察背景。"',
    );
    expect(result.htmlOutput?.html).not.toContain("模型擅自改写");
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).toMatchObject({ fallbackApplied: false });
  });

  it("discards unsafe model HTML without replacing the model layout", async () => {
    const unsafeHtml = buildValidGeneratedHtml(pageContentDsl).replace(
      "</body>",
      "<script>document.body.textContent = 'unsafe'</script></body>",
    );
    const result = await createHtmlEngineerModelStep({
      generateHtml: vi.fn().mockResolvedValue(unsafeHtml),
    }).run(createHtmlEngineerModelStepState(input), {
      traceId: "unsafe-html-test",
    });

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).not.toContain("<script");
    expect(() =>
      validateHtmlEngineerOutput(result.htmlOutput?.html, input),
    ).not.toThrow();
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "validation",
      "finish",
    ]);
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).toMatchObject({
      contractRetryApplied: false,
      fallbackApplied: false,
    });
  });

  it("rejects a page without a unique main content region", () => {
    const html = buildValidGeneratedHtml(pageContentDsl)
      .replace(`<main data-page-id="${pageContentDsl.pageId}">`, "")
      .replace("</main>", "");

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      "页面必须包含且只能包含一个 main 主内容区域",
    );
  });

  it("rejects disabled choice controls before Page QA", () => {
    const content = getChoiceContent();
    const html = buildValidGeneratedHtml(content).replace(
      `<section data-interaction-type="choice">`,
      `<section data-interaction-type="choice"><input type="radio" name="question-1" disabled>`,
    );

    expect(() =>
      validateHtmlEngineerOutput(html, { ...input, content }),
    ).toThrow("choice 互动的单选或复选控件不得包含 disabled 属性");
  });

  it("rejects output that drops a stable DSL block marker", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      ' data-block-id="block-02"',
      "",
    );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      '缺少 data-block-id="block-02"',
    );
  });

  it("rejects duplicate block markers even when all DSL text remains visible", () => {
    const duplicate = `<aside data-block-id="${pageContentDsl.blocks[0]!.id}">${pageContentDsl.blocks[0]!.heading}</aside>`;
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      "</main>",
      `${duplicate}</main>`,
    );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      `内容块 ${pageContentDsl.blocks[0]!.id} 必须且只能在 main 内有一个`,
    );
  });

  it("rejects a page marker placed outside the unique main element", () => {
    const html = buildValidGeneratedHtml(pageContentDsl)
      .replace(
        `<main data-page-id="${pageContentDsl.pageId}">`,
        "<main>",
      )
      .replace("<body>", `<body data-page-id="${pageContentDsl.pageId}">`);

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      "data-page-id 必须且只能标记唯一 main 主内容区域",
    );
  });

  it("rejects block markers whose DOM order differs from the DSL", () => {
    const firstId = pageContentDsl.blocks[0]!.id;
    const secondId = pageContentDsl.blocks[1]!.id;
    const html = buildValidGeneratedHtml(pageContentDsl)
      .replace(`data-block-id="${firstId}"`, 'data-block-id="swap-marker"')
      .replace(`data-block-id="${secondId}"`, `data-block-id="${firstId}"`)
      .replace('data-block-id="swap-marker"', `data-block-id="${secondId}"`);

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      "data-block-id 的 DOM 顺序必须与 PageContentDSL.blocks 一致",
    );
  });

  it("rejects an empty interaction marker separated from its teaching content", () => {
    const interactionType = pageContentDsl.interaction.type;
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      `data-interaction-type="${interactionType}"`,
      `data-interaction-type="detached"`,
    ).replace(
      "</main>",
      `<div data-interaction-type="${interactionType}"></div></main>`,
    );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      "真实互动区标记不能是与教学内容分离的空容器",
    );
  });

  it("does not require an interaction marker when the DSL explicitly uses none", () => {
    const content = {
      ...pageContentDsl,
      interaction: { type: "none" as const },
    };
    const html = buildValidGeneratedHtml(content);

    expect(html).not.toContain("data-interaction-type");
    expect(() =>
      validateHtmlEngineerOutput(html, {
        content,
        visualBrief,
      }),
    ).not.toThrow();
  });

  it("still requires an interaction marker for an interactive DSL", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      ` data-interaction-type="${pageContentDsl.interaction.type}"`,
      "",
    );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      `缺少 data-interaction-type="${pageContentDsl.interaction.type}"`,
    );
  });

  it("adds a missing reveal marker only to a complete DSL-aligned details structure", () => {
    const details = pageContentDsl.blocks
      .map(
        (block) =>
          `<details><summary>${block.heading}</summary><p>${block.body}</p></details>`,
      )
      .join("");
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      /<section data-interaction-type="reveal">[\s\S]*?<\/section>/,
      `<section>${pageContentDsl.interaction.type === "reveal" ? pageContentDsl.interaction.prompt : ""}${details}</section>`,
    );

    const normalized = normalizeNativeInteractionMarker(html, input);

    expect(normalized).toContain('<details data-interaction-type="reveal">');
    expect(() => validateHtmlEngineerOutput(normalized, input)).not.toThrow();
  });

  it("restores reveal item ids only on uniquely matching complete controls", () => {
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const content = withTrustedRuntime(interaction);
    const styleTemplate = resolveHtmlEngineerInput({
      content,
      visualBrief,
    }).styleTemplate;
    const html = interaction.items.reduce(
      (document, item) =>
        document.replace(` data-interaction-item-id="${item.id}"`, ""),
      renderDeterministicPageFallback({ content, styleTemplate }),
    );

    const normalized = normalizeRevealRuntimeMarkers(html, {
      content,
      visualBrief,
    });

    for (const item of interaction.items) {
      expect(normalized).toContain(
        `data-interaction-item-id="${item.id}"`,
      );
    }
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("restores uniquely bound trusted DSL content and escapes mathematical text", () => {
    const mathematicalBody =
      "不等式是用不等号（>、<、≥、≤等）连接两个表达式所形成的式子，表示两个量之间的大小关系";
    const interactionPrompt = "点击对应卡片查看详细内容";
    const draftContent = {
      ...pageContentDsl,
      title: "高一数学核心概念拆解",
      blocks: pageContentDsl.blocks.map((block, index) =>
        index === 1 ? { ...block, body: mathematicalBody } : block,
      ),
      interaction: {
        ...pageContentDsl.interaction,
        prompt: interactionPrompt,
      },
    };
    const content = withTrustedRuntime(
      draftContent.interaction,
      draftContent,
    );
    const styleTemplate = resolveHtmlEngineerInput({
      content,
      visualBrief,
    }).styleTemplate;
    const escapedMathematicalBody = mathematicalBody
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const html = renderDeterministicPageFallback({
      content,
      styleTemplate,
    })
      .replaceAll(content.title, "数学概念课程")
      .replaceAll(interactionPrompt, "")
      .replace(escapedMathematicalBody, "模型改写的数学正文");

    let normalized = normalizeTrustedPageTitle(html, { content });
    normalized = normalizeNativeInteractionMarker(normalized, {
      content,
      visualBrief,
    });
    normalized = normalizeRevealCardInteraction(normalized, {
      content,
      visualBrief,
    });
    normalized = normalizeRevealRuntimeMarkers(normalized, {
      content,
      visualBrief,
    });
    normalized = normalizeTrustedDslMarkup(normalized, {
      content,
      visualBrief,
    });

    expect(normalized).toContain("高一数学核心概念拆解");
    expect(normalized).toContain("点击对应卡片查看详细内容");
    expect(normalized).toContain("&gt;、&lt;、≥、≤");
    expect(normalized).toContain('data-interaction-type="reveal"');
    expect(normalized).toContain(
      'data-course-contract-restored="interaction-prompt"',
    );
    expect(normalized).toContain(
      'data-course-contract-restored="block"',
    );
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("restores omitted reveal item text only inside its unique stable item root", () => {
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const trustedInteraction = {
      ...interaction,
      items: interaction.items.map((item, index) => ({
        ...item,
        content: `第 ${index + 1} 张卡片的可信完整讲解正文`,
      })),
    };
    const content = withTrustedRuntime(trustedInteraction);
    const styleTemplate = resolveHtmlEngineerInput({
      content,
      visualBrief,
    }).styleTemplate;
    const html = trustedInteraction.items.reduce(
      (document, item, index) =>
        document.replace(item.content, `模型改写的第 ${index + 1} 项`),
      renderDeterministicPageFallback({ content, styleTemplate }),
    );

    const normalized = normalizeTrustedDslMarkup(html, {
      content,
      visualBrief,
    });
    if (typeof normalized !== "string") {
      throw new Error("可信 DSL 规范化必须返回 HTML 字符串");
    }

    for (const item of trustedInteraction.items) {
      expect(normalized).toContain(item.content);
    }
    expect(
      normalized.match(
        /data-course-contract-restored="interaction-item"/g,
      ),
    ).toHaveLength(trustedInteraction.items.length);
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("restores trusted sort item labels and content inside stable item roots", () => {
    const interaction = {
      type: "sort" as const,
      prompt: "按学习顺序排列观察步骤。",
      items: [
        {
          id: "item-observe",
          label: "先观察",
          content: "查看天体是否发光。",
        },
        {
          id: "item-compare",
          label: "再比较",
          content: "比较两类天体的差异。",
        },
      ],
      correctOrderIds: ["item-observe", "item-compare"],
      feedback: {
        success: "顺序正确，先观察再比较。",
        retry: "先寻找线索，再进行比较。",
      },
    };
    const content = withTrustedRuntime(interaction);
    const styleTemplate = resolveHtmlEngineerInput({
      content,
      visualBrief,
    }).styleTemplate;
    const html = interaction.items.reduce(
      (document, item, index) =>
        document
          .replace(item.label, `模型改写的步骤 ${index + 1}`)
          .replace(item.content, `模型改写的说明 ${index + 1}`),
      renderDeterministicPageFallback({ content, styleTemplate }),
    );

    const normalized = normalizeTrustedDslMarkup(html, {
      content,
      visualBrief,
    });
    if (typeof normalized !== "string") {
      throw new Error("可信 DSL 规范化必须返回 HTML 字符串");
    }

    for (const item of interaction.items) {
      expect(normalized).toContain(item.label);
      expect(normalized).toContain(item.content);
    }
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("preserves aligned block roots when a reveal item wraps its content block", () => {
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const trustedInteraction = {
      ...interaction,
      items: interaction.items.map((item, index) => ({
        ...item,
        content: `第 ${index + 1} 张卡片的独立可信讲解`,
      })),
    };
    const content = withTrustedRuntime(trustedInteraction);
    const blocks = content.blocks
      .map(
        (block, index) =>
          `<details data-interaction-item-id="${trustedInteraction.items[index]!.id}"><summary>${trustedInteraction.items[index]!.label}</summary><article data-block-id="${block.id}" data-runtime-target-id="${block.id}"><p>模型改写正文</p></article></details>`,
      )
      .join("");
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${content.title}</title><style>body{margin:0}</style></head><body><main data-page-id="${content.pageId}"><h1>${content.title}</h1>${content.narration.map((line) => `<p>${line}</p>`).join("")}<div data-visual-primitive="comparison"></div><section data-interaction-type="reveal" data-interaction-id="interaction-${content.pageId}"><p>${trustedInteraction.prompt}</p>${blocks}</section></main></body></html>`;

    const normalized = normalizeTrustedDslMarkup(html, {
      content,
      visualBrief,
    });
    if (typeof normalized !== "string") {
      throw new Error("可信 DSL 规范化必须返回 HTML 字符串");
    }

    for (const block of content.blocks) {
      expect(normalized).toContain(`data-block-id="${block.id}"`);
      expect(normalized).toContain(block.body);
    }
    for (const item of trustedInteraction.items) {
      expect(normalized).toContain(item.content);
    }
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("treats Markdown inline code and rendered code tags as the same trusted text", () => {
    const body = "变量`name`的数据类型是`str`。";
    const supportingPoint =
      "正确示例：`username`；错误示例：`1name`";
    const content = {
      ...pageContentDsl,
      blocks: pageContentDsl.blocks.map((block, index) =>
        index === 0
          ? { ...block, body, supportingPoints: [supportingPoint] }
          : block,
      ),
    };
    const html = buildValidGeneratedHtml(content)
      .replace(body, "变量<code>name</code>的数据类型是<code>str</code>。")
      .replace(
        supportingPoint,
        "正确示例：<code>username</code>；错误示例：<code>1name</code>",
      );

    const normalized = normalizeTrustedDslMarkup(html, {
      content,
      visualBrief,
    });

    expect(normalized).not.toContain(
      'data-course-contract-restored="block"',
    );
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("removes stale restored block copies when rendered code already contains the DSL", () => {
    const body = "变量`name`的数据类型是`str`。";
    const content = {
      ...pageContentDsl,
      blocks: pageContentDsl.blocks.map((block, index) =>
        index === 0 ? { ...block, body } : block,
      ),
    };
    const html = buildValidGeneratedHtml(content)
      .replace(body, "变量<code>name</code>的数据类型是<code>str</code>。")
      .replace(
        "</article>",
        `<div data-course-contract-restored="block"><p>${body}</p></div></article>`,
      );

    const normalized = removeRedundantRestoredDslMarkup(html, { content });

    expect(normalized).not.toContain(
      'data-course-contract-restored="block"',
    );
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
    ).not.toThrow();
  });

  it("does not append reveal item copies when aligned blocks already carry the content", () => {
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const originalInteraction = `<section data-interaction-type="reveal">${[
      interaction.prompt,
      ...interaction.items.flatMap((item) => [item.label, item.content]),
    ].join(" ")}</section>`;
    const incompleteInteraction = `<section data-interaction-type="reveal">${interaction.prompt}${interaction.items
      .map(
        (item) =>
          `<div data-interaction-item-id="${item.id}">${item.label}</div>`,
      )
      .join("")}</section>`;
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      originalInteraction,
      incompleteInteraction,
    );

    const normalized = normalizeTrustedDslMarkup(html, input);

    expect(normalized).not.toContain(
      'data-course-contract-restored="interaction-item"',
    );
    expect(() =>
      validateHtmlEngineerOutput(normalized, input),
    ).not.toThrow();
  });

  it("does not invent a reveal marker for an incomplete native interaction", () => {
    const block = pageContentDsl.blocks[0];
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      /<section data-interaction-type="reveal">[\s\S]*?<\/section>/,
      `<section><details><summary>${block.heading}</summary><p>${block.body}</p></details></section>`,
    );

    expect(normalizeNativeInteractionMarker(html, input)).toBe(html);
    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      '缺少 data-interaction-type="reveal"',
    );
  });

  it("rejects output that drops DSL teaching text", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      pageContentDsl.blocks[1].body,
      "被模型改写的内容",
    );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      `页面正文缺少 DSL 文本：${pageContentDsl.blocks[1].body}`,
    );
  });

  it("accepts reveal item references already represented by their aligned content blocks", () => {
    const content = {
      ...pageContentDsl,
      blocks: pageContentDsl.blocks.map((block, index) => ({
        ...block,
        label: `知识点${index + 1}`,
      })),
      interaction: {
        type: "reveal" as const,
        prompt: "点击任意知识点卡片，展开查看详细内容",
        items: pageContentDsl.blocks.map((_block, index) => ({
          id: `item-${String(index + 1).padStart(2, "0")}`,
          label: `知识点${index + 1}卡片`,
          content: `知识点${index + 1}卡片`,
        })),
      },
    };
    const html = content.interaction.items.reduce(
      (document, item) => document.replaceAll(item.content, ""),
      buildValidGeneratedHtml(content),
    );

    expect(() =>
      validateHtmlEngineerOutput(html, { content, visualBrief }),
    ).not.toThrow();
  });

  it("still rejects reveal teaching content that is not a block reference", () => {
    const item = pageContentDsl.interaction.type === "reveal"
      ? pageContentDsl.interaction.items[0]
      : undefined;
    if (!item) throw new Error("fixture must use reveal interaction");
    const html = buildValidGeneratedHtml(pageContentDsl).replaceAll(
      item.content,
      "",
    );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      `页面正文缺少 DSL 文本：${item.content}`,
    );
  });

  it("does not require retry-only feedback in a static choice preview", () => {
    const content = getChoiceContent();
    const htmlWithoutRetryFeedback = content.interaction.questions.reduce(
      (html, question) => html.replace(question.feedback.retry, ""),
      buildValidGeneratedHtml(content),
    );

    expect(() =>
      validateHtmlEngineerOutput(htmlWithoutRetryFeedback, {
        content,
        visualBrief,
      }),
    ).not.toThrow();
  });

  it("still requires choice prompts, options and reference feedback", () => {
    const content = getChoiceContent();
    const question = content.interaction.questions[0];
    const html = buildValidGeneratedHtml(content);

    expect(() =>
      validateHtmlEngineerOutput(html.replaceAll(question.prompt, ""), {
        content,
        visualBrief,
      }),
    ).toThrow(`页面正文缺少 DSL 文本：${question.prompt}`);
    expect(() =>
      validateHtmlEngineerOutput(
        html.replaceAll(question.options[0].label, ""),
        {
          content,
          visualBrief,
        },
      ),
    ).toThrow(`页面正文缺少 DSL 文本：${question.options[0].label}`);
    expect(() =>
      validateHtmlEngineerOutput(
        html.replaceAll(question.feedback.success, ""),
        {
          content,
          visualBrief,
        },
      ),
    ).toThrow(`页面正文缺少 DSL 文本：${question.feedback.success}`);
  });

  it("accepts a numbered choice prompt rendered as its trusted question block body", () => {
    const baseContent = getChoiceContent();
    const baseQuestions = baseContent.interaction.questions.slice(0, 2);
    const promptBodies = [
      "《论语》的体裁和定位是？",
      "《论语》的核心思想是？",
    ];
    const content = {
      ...baseContent,
      blocks: baseQuestions.map((question, index) => ({
        id: `block-question-${index + 1}`,
        kind: "question" as const,
        label: `第${index + 1}题`,
        heading: "理解检查",
        body: promptBodies[index]!,
        supportingPoints: [],
      })),
      interaction: {
        type: "choice" as const,
        questions: baseQuestions.map((question, index) => ({
          ...question,
          prompt: `${index + 1}. ${promptBodies[index]!}`,
        })),
      },
    };
    const html = content.blocks.reduce((document, _block, index) => {
      return document.replace(
        content.interaction.questions[index].prompt,
        "",
      );
    }, buildValidGeneratedHtml(content));

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content,
        visualBrief,
      }),
    ).not.toThrow();

    const firstBlock = content.blocks[0];
    expect(() =>
      validateHtmlEngineerOutput(html.replace(firstBlock.body, ""), {
        content,
        visualBrief,
      }),
    ).toThrow(
      `页面正文缺少 DSL 文本：${content.interaction.questions[0].prompt}`,
    );
  });

  it("rejects numbered choice prompts with a mismatched block or question number", () => {
    const baseContent = getChoiceContent();
    const baseQuestion = baseContent.interaction.questions[0];
    const mismatchedBlockContent = {
      ...baseContent,
      blocks: [
        {
          ...baseContent.blocks[0],
          body: "对应稳定区块中的另一道题干。",
        },
      ],
      interaction: {
        type: "choice" as const,
        questions: [
          {
            ...baseQuestion,
            prompt: `1. ${baseQuestion.prompt}`,
          },
        ],
      },
    };
    const mismatchedBlockHtml = buildValidGeneratedHtml(
      mismatchedBlockContent,
    )
      .replace(mismatchedBlockContent.interaction.questions[0].prompt, "")
      .replace(
        "</main>",
        `<p>${baseQuestion.prompt}</p></main>`,
      );

    expect(() =>
      validateHtmlEngineerOutput(mismatchedBlockHtml, {
        content: mismatchedBlockContent,
        visualBrief,
      }),
    ).toThrow(
      `页面正文缺少 DSL 文本：${mismatchedBlockContent.interaction.questions[0].prompt}`,
    );

    const mismatchedNumberContent = {
      ...mismatchedBlockContent,
      blocks: [
        {
          ...mismatchedBlockContent.blocks[0],
          body: baseQuestion.prompt,
        },
      ],
      interaction: {
        type: "choice" as const,
        questions: [
          {
            ...baseQuestion,
            prompt: `2. ${baseQuestion.prompt}`,
          },
        ],
      },
    };
    const mismatchedNumberHtml = buildValidGeneratedHtml(
      mismatchedNumberContent,
    ).replace(mismatchedNumberContent.interaction.questions[0].prompt, "");

    expect(() =>
      validateHtmlEngineerOutput(mismatchedNumberHtml, {
        content: mismatchedNumberContent,
        visualBrief,
      }),
    ).toThrow(
      `页面正文缺少 DSL 文本：${mismatchedNumberContent.interaction.questions[0].prompt}`,
    );
  });

  it("accepts input placeholder text on the unique runtime input without duplicating it in visible copy", () => {
    const example = getFunctionalTemplateDslExample("achievement-task");
    if (!example || example.interaction.type !== "input") {
      throw new Error("achievement-task 测试夹具必须使用 input interaction");
    }
    const interaction = example.interaction;
    const content: PageContentDSL = {
      ...example,
      version: 2,
      runtime: {
        runtimeVersion: 1,
        sceneKind: "practice",
        visualPrimitive: "none",
        motionPlan: { intensity: "subtle", cuePoints: [] },
        completionRule: {
          type: "interaction-complete",
          interactionId: `interaction-${example.pageId}`,
        },
      },
    };
    let html = buildValidGeneratedHtml(content)
      .replace(
        'data-interaction-type="input"',
        `data-interaction-type="input" data-interaction-id="interaction-${content.pageId}"`,
      )
      .replace(
        interaction.placeholder,
        `<textarea data-runtime-input="true" placeholder="${interaction.placeholder}"></textarea><button data-runtime-submit="true">提交</button>`,
      );
    for (const block of content.blocks) {
      html = html.replace(
        `data-block-id="${block.id}"`,
        `data-block-id="${block.id}" data-runtime-target-id="${block.id}"`,
      );
    }

    expect(() =>
      validateHtmlEngineerOutput(html, { content, visualBrief }),
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(
        html.replace(
          `placeholder="${interaction.placeholder}"`,
          'placeholder="请输入内容"',
        ),
        { content, visualBrief },
      ),
    ).toThrow(
      `页面正文缺少 DSL 文本：${interaction.placeholder}`,
    );
  });

  it("requires VisualBrief guidance for the current DSL page", () => {
    expect(() =>
      resolveHtmlEngineerInput({
        ...input,
        visualBrief: {
          ...visualBrief,
          pageGuidance: visualBrief.pageGuidance.filter(
            ({ pageId }) => pageId !== pageContentDsl.pageId,
          ),
        },
      }),
    ).toThrow("VisualBrief 缺少页面");
  });

  it("requires an auditable marker when an image result uses fallback", () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "image" as const,
          role: "background" as const,
          purpose: "课程背景",
          required: true,
          altTextGuidance: "柔和的课程背景",
        },
      ],
    };
    const fallbackResult: AssetGenerationResult = {
      request: {
        assetSlotId: "asset-slot-01",
        assetType: "background",
        usage: "课程背景",
        prompt: "A calm educational background with an open text-safe area and no words.",
        transparentBackground: false,
        safeArea: {
          position: "left",
          coveragePercent: 40,
          description: "为 HTML 标题保留左侧低细节区域。",
        },
        aspectRatio: "16:9",
      },
      status: "fallback",
      fallback: {
        kind: "css-gradient",
        description: "使用低细节 CSS 渐变背景。",
      },
      durationMs: 1,
      errorCode: "IMAGE_GENERATION_FAILED",
    };
    const html = buildValidGeneratedHtml(content).replace(
      'data-asset-slot-id="asset-slot-01"',
      'data-asset-slot-id="asset-slot-01" data-asset-fallback="css-gradient"',
    );

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content,
        visualBrief,
        assets: [fallbackResult],
      }),
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(buildValidGeneratedHtml(content), {
        content,
        visualBrief,
        assets: [fallbackResult],
      }),
    ).toThrow('data-asset-fallback="css-gradient"');
  });

  it("keeps task-card text in HTML while composing a background and character asset", () => {
    const html = buildAssetRichHtml();

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).not.toThrow();
    expect(html).toContain("任务卡：完成观察报告");
    expect(html).toContain("课程文字必须保持为可选择、可朗读的 HTML。");
  });

  it("rejects a missing or unapproved image in a two-asset page", () => {
    const html = buildAssetRichHtml();
    const withoutCharacter = html.replace(
      '<img data-asset-slot-id="asset-slot-02" src="/api/assets/asset-character" alt="指向任务卡的小小宇航员。">',
      "",
    );
    const withUnapprovedImage = html.replace(
      "</body>",
      '<img src="/api/assets/unapproved" alt="未批准素材"></body>',
    );

    expect(() =>
      validateHtmlEngineerOutput(withoutCharacter, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("素材槽 asset-slot-02");
    expect(() =>
      validateHtmlEngineerOutput(withUnapprovedImage, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("素材 URI 不在已批准素材清单中");
  });

  it.each([
    ["unquoted src", '<img src=/api/assets/unapproved alt="未批准素材">'],
    [
      "img srcset",
      '<img srcset="/api/assets/unapproved 1x" alt="未批准素材">',
    ],
    [
      "source srcset",
      '<picture><source srcset="/api/assets/unapproved 2x"></picture>',
    ],
    ["source src", "<source src=/api/assets/unapproved>"],
    ["video poster", '<video poster="/api/assets/unapproved"></video>'],
    [
      "SVG image href",
      '<svg><image href="/api/assets/unapproved"></image></svg>',
    ],
    [
      "SVG image xlink:href",
      '<svg><image xlink:href="/api/assets/unapproved"></image></svg>',
    ],
    [
      "CSS url",
      '<div style="background-image: url(/api/assets/unapproved)"></div>',
    ],
  ])("rejects an unapproved same-origin asset from %s", (_kind, fragment) => {
    const html = buildAssetRichHtml().replace("</body>", `${fragment}</body>`);

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("素材 URI 不在已批准素材清单中：/api/assets/unapproved");
  });

  it("accepts a ready asset bound through a wrapper or a unique CSS selector", () => {
    const directBackground =
      '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">';
    const wrappedBackground =
      '<figure data-asset-slot-id="asset-slot-01"><img src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">';
    const classBackground =
      '<figure class="course-hero-asset" data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">';
    const wrappedClassBackground =
      '<figure data-asset-slot-id="asset-slot-01"><div class="course-hero-asset" role="img" aria-label="保留左侧文字安全区的太空观察背景。"></div>';
    const attributeBackground =
      '<figure data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">';
    const idBackground =
      '<figure id="course-hero-asset" data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">';
    const wrappedHtml = buildAssetRichHtml().replace(
      directBackground,
      wrappedBackground,
    );
    const classBoundHtml = buildAssetRichHtml()
      .replace(directBackground, classBackground)
      .replace(
        "</style>",
        ".course-hero-asset { background-image: url('/api/assets/asset-background'); }</style>",
      );
    const wrappedClassBoundHtml = buildAssetRichHtml()
      .replace(directBackground, wrappedClassBackground)
      .replace(
        "</style>",
        ".course-hero-asset { background-image: url('/api/assets/asset-background'); }</style>",
      );
    const attributeBoundHtml = buildAssetRichHtml()
      .replace(directBackground, attributeBackground)
      .replace(
        "</style>",
        '[data-asset-slot-id="asset-slot-01"]::before { background-image: url(\'/api/assets/asset-background\'); }</style>',
      );
    const idBoundHtml = buildAssetRichHtml()
      .replace(directBackground, idBackground)
      .replace(
        "</style>",
        "#course-hero-asset { background-image: url('/api/assets/asset-background'); }</style>",
      );

    expect(() =>
      validateHtmlEngineerOutput(wrappedHtml, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(classBoundHtml, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(wrappedClassBoundHtml, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(attributeBoundHtml, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(idBoundHtml, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).not.toThrow();
  });

  it("rejects a stylesheet asset binding when its class is shared by another node", () => {
    const html = buildAssetRichHtml()
      .replace(
        '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
        '<figure class="course-hero-asset" data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">',
      )
      .replace(
        "</style>",
        ".course-hero-asset { background-image: url('/api/assets/asset-background'); }</style>",
      )
      .replace("</body>", '<div class="course-hero-asset"></div></body>');

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("URI 位于未绑定的 CSS url()");
  });

  it("rejects broad, cross-slot or duplicated stylesheet bindings", () => {
    const directBackground =
      '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">';
    const markedBackground =
      '<figure data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">';
    const broadSelectorHtml = buildAssetRichHtml()
      .replace(directBackground, markedBackground)
      .replace(
        "</style>",
        "[data-asset-slot-id] { background-image: url('/api/assets/asset-background'); }</style>",
      );
    const crossSlotHtml = buildAssetRichHtml()
      .replace(directBackground, markedBackground)
      .replace(
        "</style>",
        '[data-asset-slot-id="asset-slot-02"] { background-image: url(\'/api/assets/asset-background\'); }</style>',
      );
    const duplicatedIdHtml = buildAssetRichHtml()
      .replace(
        directBackground,
        '<figure id="course-hero-asset" data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">',
      )
      .replace(
        "</style>",
        "#course-hero-asset { background-image: url('/api/assets/asset-background'); }</style>",
      )
      .replace("</body>", '<div id="course-hero-asset"></div></body>');

    for (const html of [
      broadSelectorHtml,
      crossSlotHtml,
      duplicatedIdHtml,
    ]) {
      expect(() =>
        validateHtmlEngineerOutput(html, {
          content: assetRichContent,
          visualBrief,
          assets: readyAssetResults,
        }),
      ).toThrow("没有在对应节点引用已生成素材 URI");
    }
  });

  it.each([
    [
      "an absent ancestor",
      ".absent .course-hero-asset { background-image: url('/api/assets/asset-background'); }",
    ],
    [
      "an absent compound class",
      ".course-hero-asset.missing { background-image: url('/api/assets/asset-background'); }",
    ],
    [
      "a negated selector",
      ":not(.course-hero-asset) { background-image: url('/api/assets/asset-background'); }",
    ],
    [
      "an unused custom property",
      ".course-hero-asset { --unused-image: url('/api/assets/asset-background'); }",
    ],
    [
      "a non-background property",
      ".course-hero-asset { cursor: url('/api/assets/asset-background'), auto; }",
    ],
    [
      "a case-mismatched slot value",
      '[data-asset-slot-id="ASSET-SLOT-01"] { background-image: url(\'/api/assets/asset-background\'); }',
    ],
    [
      "a commented background declaration",
      ".course-hero-asset { /*; background-image: url('/api/assets/asset-background'); */ }",
    ],
  ])("rejects a stylesheet URI bound through %s", (_case, cssRule) => {
    const html = buildAssetRichHtml()
      .replace(
        '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
        '<figure class="course-hero-asset" data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。">',
      )
      .replace("</style>", `${cssRule}</style>`);

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("没有在对应节点引用已生成素材 URI");
  });

  it("rejects an inline URI that is not used as a background", () => {
    const html = buildAssetRichHtml().replace(
      '<figure><img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
      '<figure data-asset-slot-id="asset-slot-01" role="img" aria-label="保留左侧文字安全区的太空观察背景。" style="--unused-image: url(\'/api/assets/asset-background\');">',
    );

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("没有在对应节点引用已生成素材 URI");
  });

  it("requires every approved URI once and on its correctly marked direct node", () => {
    const html = buildAssetRichHtml();
    const duplicate = html.replace(
      "</body>",
      '<img src="/api/assets/asset-background" alt="重复素材"></body>',
    );
    const misplaced = html.replace(
      '<img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
      '<div data-asset-slot-id="asset-slot-01"></div><img src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
    );
    const wrongTag = html.replace(
      '<img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
      '<div data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。"></div>',
    );

    expect(() =>
      validateHtmlEngineerOutput(duplicate, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("必须恰好被对应的 1 个素材槽引用");
    expect(() =>
      validateHtmlEngineerOutput(misplaced, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("素材槽 asset-slot-01 没有在对应节点引用已生成素材 URI");
    expect(() =>
      validateHtmlEngineerOutput(wrongTag, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("素材槽 asset-slot-01 没有在对应节点引用已生成素材 URI");
  });

  it("allows two correctly marked slots to reuse one approved cached URI", () => {
    const sharedUriHtml = buildAssetRichHtml().replace(
      "/api/assets/asset-character",
      "/api/assets/asset-background",
    );
    const sharedUriResults = readyAssetResults.map((result, index) =>
      index === 1 && result.asset
        ? {
            ...result,
            asset: {
              ...result.asset,
              id: "asset-background",
              uri: "/api/assets/asset-background",
            },
          }
        : result,
    ) as AssetGenerationResult[];

    expect(() =>
      validateHtmlEngineerOutput(sharedUriHtml, {
        content: assetRichContent,
        visualBrief,
        assets: sharedUriResults,
      }),
    ).not.toThrow();
  });

  it("decodes named and numeric entities before exact alt and aria comparisons", () => {
    const html = buildAssetRichHtml()
      .replace(
        '<img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-background" alt="保留左侧文字安全区的太空观察背景。">',
        '<div data-asset-slot-id="asset-slot-01" style="background-image: url(/api/assets/asset-background)" role="img" aria-label="太空 &amp; &#35266;&#x5BDF; &#169;"></div>',
      )
      .replace(
        'alt="指向任务卡的小小宇航员。"',
        'alt="宇航员 &amp; &quot;任务&quot;"',
      );
    const assets = readyAssetResults.map((result, index) => ({
      ...result,
      asset: result.asset
        ? {
            ...result.asset,
            altText:
              index === 0 ? "太空 & 观察 ©" : '宇航员 & "任务"',
          }
        : undefined,
    })) as AssetGenerationResult[];

    expect(() =>
      validateHtmlEngineerOutput(html, {
        content: assetRichContent,
        visualBrief,
        assets,
      }),
    ).not.toThrow();
  });

  it("rejects swapped asset slots or an alt text that was not approved", () => {
    const html = buildAssetRichHtml();
    const swapped = html
      .replace("/api/assets/asset-background", "/api/assets/swap-placeholder")
      .replace("/api/assets/asset-character", "/api/assets/asset-background")
      .replace("/api/assets/swap-placeholder", "/api/assets/asset-character");
    const wrongAlt = html.replace(
      'alt="指向任务卡的小小宇航员。"',
      'alt="模型擅自改写的说明"',
    );
    const dataAttributesOnly = html.replace(
      'src="/api/assets/asset-character" alt="指向任务卡的小小宇航员。"',
      'data-src="/api/assets/asset-character" data-alt="指向任务卡的小小宇航员。"',
    );

    expect(() =>
      validateHtmlEngineerOutput(swapped, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("没有在对应节点引用已生成素材 URI");
    expect(() =>
      validateHtmlEngineerOutput(wrongAlt, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("alt 必须等于已批准的替代文本");
    expect(() =>
      validateHtmlEngineerOutput(dataAttributesOnly, {
        content: assetRichContent,
        visualBrief,
        assets: readyAssetResults,
      }),
    ).toThrow("没有在对应节点引用已生成素材 URI");
  });
});
