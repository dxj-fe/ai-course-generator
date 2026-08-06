import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { generateTextSafe } from "../../../../src/server/infra/ai/client";
import {
  createHtmlEngineerModelStep,
  createHtmlEngineerModelStepState,
  normalizeChoiceInteractionRoot,
  normalizeChoiceRuntimeMarkers,
  normalizeConditionalFeedbackVisibility,
  normalizeGeneratedActiveContent,
  normalizeGeneratedCanvasRoot,
  normalizeGeneratedHtmlEnvelope,
  normalizeNativeInteractionMarker,
  normalizeRevealRuntimeMarkers,
  normalizeSubmissionRuntimeMarker,
  normalizeTrustedPlayerLayout,
  normalizeWideSingleColumnBreakpoints,
  normalizeUniqueReadyAssetSlotRoots,
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
    interaction,
    runtime: {
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
        fallbackTimeoutMs: 150_000,
        timeoutMs: 180_000,
      }),
    );
  });

  it("merges the selected style recipe description with explicit page guidance in the production prompt", async () => {
    vi.mocked(generateTextSafe).mockResolvedValueOnce({
      text: buildValidGeneratedHtml(pageContentDsl),
    } as Awaited<ReturnType<typeof generateTextSafe>>);

    const result = await createHtmlEngineerModelStep().run(
      createHtmlEngineerModelStepState({
        ...input,
        pageDesignGuidance: [
          {
            logicalPath:
              "agent/skills/course-page-design/references/fixed-canvas-composition.md",
            digest: "b".repeat(64),
            content: "Keep the learning action inside the main composition.",
          },
        ],
      }),
      { traceId: "html-engineer-style-recipe-test" },
    );

    expect(result.status).toBe("completed");
    const request = vi.mocked(generateTextSafe).mock.calls[0]?.[0];
    const promptText = request?.messages
      .flatMap(({ parts }) => parts)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");

    expect(promptText).toContain(
      "A retro-futuristic pixel-art presentation system",
    );
    expect(promptText).toContain(
      "Keep the learning action inside the main composition",
    );
    expect(promptText).not.toContain("pixel-stack-cyan-yellow");
    expect(promptText).not.toMatch(/1920\s*(?:×|x)\s*1080/i);
    expect(promptText).not.toMatch(/deck[-_\s]?(?:runtime|viewport|stage)/i);
    expect(promptText).not.toContain("viewport-base.css");
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
        pageGuidance: expect.objectContaining({ pageId: pageContentDsl.pageId }),
        styleTemplate: expect.objectContaining({ id: visualBrief.styleTemplateId }),
      }),
    );
    expect(generateHtml.mock.calls[0]?.[0]).not.toHaveProperty(
      "functionalTemplate",
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
    });
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).not.toHaveProperty("fallbackApplied");
  });

  it("retries one HTML contract failure and returns the revised model document", async () => {
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
    });
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).not.toHaveProperty("fallbackApplied");
  });

  it("fails explicitly when the one contract retry is still invalid", async () => {
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
    const incompleteHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}</style></head><body><main data-page-id="${content.pageId}"><p>模型遗漏了任务标题与评价标准</p></main></body></html>`;
    const generateHtml = vi.fn().mockResolvedValue(incompleteHtml);
    const result = await createHtmlEngineerModelStep({ generateHtml }).run(
      createHtmlEngineerModelStepState({
        content,
        visualBrief,
      }),
      { traceId: "achievement-input-contract-failure-test" },
    );

    expect(generateHtml).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("failed");
    expect(result.htmlOutput).toBeUndefined();
    expect(result.error).toMatchObject({ code: "SCHEMA_ERROR" });
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "model_call",
      "error",
    ]);
    expect(result.events).not.toContainEqual(
      expect.objectContaining({ type: "validation" }),
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

  it("injects a visual-neutral trusted player guard exactly once", () => {
    const generated =
      "<!doctype html><html><head><style>main{gap:3rem}</style></head><body><main data-page-id=\"page-01\"></main></body></html>";

    const normalized = normalizeTrustedPlayerLayout(
      normalizeTrustedPlayerLayout(generated),
    );

    expect(normalized).toContain('data-keya-layout-guard="current"');
    expect(normalized).toContain(
      "html,body{width:100%!important;height:100%!important;margin:0!important;overflow:visible!important",
    );
    expect(normalized).not.toContain("padding:0!important");
    expect(normalized).toContain(
      "main[data-page-id]>*{min-width:0}",
    );
    expect(normalized).toContain("max-width:none!important");
    expect(normalized).toContain(
      "@media (max-width:520px)",
    );
    expect(normalized).toContain(
      "main[data-page-id]{height:auto!important;min-height:100%!important}",
    );
    expect(normalized).toContain(
      ':where(button,[role="button"],summary,select,input:not([type="hidden"]),textarea){min-width:44px;min-height:44px}',
    );
    expect(normalized).toContain(
      "@media (prefers-reduced-motion:reduce)",
    );
    expect(normalized).not.toContain("font-size:clamp(");
    expect(normalized).not.toContain("grid-template-columns:");
    expect(normalized).not.toContain(':has(>[data-block-id])');
    expect(String(normalized).match(/data-keya-layout-guard=/g)).toHaveLength(1);
    expect(String(normalized).indexOf('data-keya-layout-guard="current"')).toBeLessThan(
      String(normalized).indexOf("</head>"),
    );
  });

  it("delays only wide single-column breakpoints until the narrow viewport", () => {
    const generated = `<!doctype html><html><head><style>
      @media (max-width: 900px) { main { grid-template-columns: 1fr 1fr; } }
      @media (max-width: 712px) { main { grid-template-columns: 1fr; } }
      @media (max-width: 768px) { h1 { font-size: 2rem; } }
    </style></head><body></body></html>`;

    const normalized = normalizeWideSingleColumnBreakpoints(generated);

    expect(normalized).toContain("@media (max-width: 520px) { main");
    expect(normalized).toContain("@media (max-width: 900px) { main");
    expect(normalized).toContain("@media (max-width: 768px) { h1");
    expect(normalized).not.toContain("@media (max-width: 712px)");
  });

  it("delays compound wide single-column breakpoints without leaving an impossible range", () => {
    const generated = `<!doctype html><html><head><style>
      @media (max-width: 921px) and (min-width: 521px) {
        main { grid-template-columns: 1fr; }
      }
    </style></head><body></body></html>`;

    const normalized = normalizeWideSingleColumnBreakpoints(generated);

    expect(normalized).toContain("@media (max-width: 520px) {");
    expect(normalized).not.toContain("max-width: 921px");
    expect(normalized).not.toContain("min-width: 521px");
  });

  it("adds choice runtime markers only to uniquely provable native controls", () => {
    const choice = getChoiceContent();
    const content = {
      ...choice,
      runtime: {
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

  it("normalizes a single-question form without forcing a full HTML regeneration", () => {
    const choice = getChoiceContent();
    const question = choice.interaction.questions[0]!;
    const content = {
      ...choice,
      interaction: {
        ...choice.interaction,
        questions: [question],
      },
    } satisfies ChoiceContent;
    const options = question.options
      .map(
        (option) =>
          `<label><input type="radio" name="${question.id}" value="${option.id}">${option.label}</label>`,
      )
      .join("");
    const generated =
      `<!doctype html><html><head><title>${choice.title}</title></head><body>` +
      `<main data-page-id="${choice.pageId}"><form>${question.prompt}${options}` +
      `<button type="button" disabled>提交答案</button></form></main></body></html>`;

    const normalizedRoot = normalizeChoiceInteractionRoot(generated, {
      content,
    });
    const normalized = normalizeChoiceRuntimeMarkers(normalizedRoot, {
      content,
      visualBrief,
    });

    expect(normalized).toContain('data-interaction-type="choice"');
    expect(normalized).toContain(
      `data-interaction-id="interaction-${choice.pageId}"`,
    );
    expect(normalized).toContain(`data-question-id="${question.id}"`);
    expect(normalized).toContain('data-runtime-submit="true"');
    expect(normalized).not.toContain(" disabled");
    expect(normalized).toContain('data-feedback-kind="success" hidden');
    expect(normalized).toContain('data-feedback-kind="retry" hidden');
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
      normalizeSubmissionRuntimeMarker(generated, content),
      content,
    );

    expect(normalized).toContain(
      'class="check-order" data-runtime-submit="true"',
    );
    expect(normalized).toContain(
      '<div data-interaction-item-id="item-earth">地球 第三颗行星</div>',
    );
    expect(normalized).not.toContain("keya-trusted-sort-card");
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
      runtime: {
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
      runtime: {
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
      runtime: {
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
      runtime: {
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
      runtime: {
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
      runtime: {
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
      runtime: {
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

  it("moves a misplaced single-question marker to the scope that contains its options", () => {
    const choice = getChoiceContent();
    const question = choice.interaction.questions[0];
    const content = {
      ...choice,
      interaction: {
        ...choice.interaction,
        questions: [question],
      },
      runtime: {
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

  it("preserves the model-authored heading hierarchy while canonicalizing asset alt text", async () => {
    const generatedHtml = buildAssetRichHtml()
      .replace(
        `<h1>${assetRichContent.title}</h1>`,
        `<p class="course-kicker">${assetRichContent.title}</p><h1>从光源档案开始观察</h1>`,
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
      '<h1>从光源档案开始观察</h1>',
    );
    expect(result.htmlOutput?.html).toContain(
      `<p class="course-kicker">${assetRichContent.title}</p>`,
    );
    expect(result.htmlOutput?.html).not.toContain(
      `data-keya-trusted-page-title="true"`,
    );
    expect(result.htmlOutput?.html).toContain(
      'alt="保留左侧文字安全区的太空观察背景。"',
    );
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
    });
    expect(
      result.events.find(({ type }) => type === "validation")?.data,
    ).not.toHaveProperty("fallbackApplied");
  });

  it("rejects a page without a unique main content region", () => {
    const html = buildValidGeneratedHtml(pageContentDsl)
      .replace(`<main data-page-id="${pageContentDsl.pageId}">`, "")
      .replace("</main>", "");

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      "页面必须包含且只能包含一个 main 主内容区域",
    );
  });

  it("rejects frontend-slides fixed deck scaffolding before browser QA", () => {
    const html = buildValidGeneratedHtml(pageContentDsl)
      .replace(
        "<body>",
        '<body><div class="deck-viewport"><div class="deck-stage">',
      )
      .replace(
        "</body>",
        "</div></div><style>.deck-stage{width:1920px;height:1080px}</style></body>",
      );

    expect(() => validateHtmlEngineerOutput(html, input)).toThrow(
      "不得复制 frontend-slides 的 deck 脚手架",
    );
  });

  it("rejects disabled choice controls before Page QA", () => {
    const content = getChoiceContent();
    const html = buildValidGeneratedHtml(content).replace(
      '<input type="radio"',
      '<input type="radio" disabled',
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

  it("accepts a creative block DOM order when every stable runtime pair remains intact", () => {
    const generated = buildValidGeneratedHtml(pageContentDsl);
    const blocks = generated.match(
      /<article data-block-id="[^"]+"[\s\S]*?<\/article>/g,
    );
    if (!blocks || blocks.length < 2) {
      throw new Error("测试夹具必须至少包含两个完整内容块");
    }
    const html = generated
      .replace(blocks[0], "__FIRST_BLOCK__")
      .replace(blocks[1], blocks[0])
      .replace("__FIRST_BLOCK__", blocks[1]);

    expect(() => validateHtmlEngineerOutput(html, input)).not.toThrow();
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
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const details = pageContentDsl.blocks
      .map(
        (block, index) =>
          `<details data-interaction-item-id="${interaction.items[index]!.id}"><summary>${block.heading}</summary><p>${block.body}</p></details>`,
      )
      .join("");
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      /<section class="interaction-panel"[^>]*data-interaction-type="reveal"[^>]*>[\s\S]*?<\/section>/,
      `<section>${pageContentDsl.interaction.type === "reveal" ? pageContentDsl.interaction.prompt : ""}${details}</section>`,
    );

    const normalized = normalizeNativeInteractionMarker(html, input);

    expect(normalized).toContain(
      `<section data-interaction-type="reveal" data-interaction-id="interaction-${pageContentDsl.pageId}">`,
    );
    expect(() => validateHtmlEngineerOutput(normalized, input)).not.toThrow();
  });

  it("restores reveal item ids only on uniquely matching complete controls", () => {
    const interaction = pageContentDsl.interaction;
    if (interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const content = withTrustedRuntime(interaction);
    const html = interaction.items.reduce(
      (document, item) =>
        document.replace(` data-interaction-item-id="${item.id}"`, ""),
      buildValidGeneratedHtml(content),
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

    expect(() =>
      validateHtmlEngineerOutput(html, { content, visualBrief }),
    ).not.toThrow();
  });

  it("does not invent a reveal marker for an incomplete native interaction", () => {
    const block = pageContentDsl.blocks[0];
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      /<section class="interaction-panel"[^>]*data-interaction-type="reveal"[^>]*>[\s\S]*?<\/section>/,
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

  it("does not require reveal item detail copy when the prompt and labels are present", () => {
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
          content: `第${index + 1}个知识点的渐进讲解`,
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

  it("accepts trusted narration as the visible reveal instruction", () => {
    const content = {
      ...pageContentDsl,
      narration: ["先观察两种光路，再比较散射方向。"],
    };
    const html = buildValidGeneratedHtml(content).replaceAll(
      content.interaction.type === "reveal"
        ? content.interaction.prompt
        : "",
      "",
    );

    expect(() =>
      validateHtmlEngineerOutput(html, { content, visualBrief }),
    ).not.toThrow();

    expect(() =>
      validateHtmlEngineerOutput(
        html.replaceAll(content.narration[0]!, ""),
        { content, visualBrief },
      ),
    ).toThrow("页面正文缺少 DSL 文本");
  });

  it("does not require conditional choice feedback in the static document", () => {
    const content = getChoiceContent();
    const htmlWithoutFeedback = content.interaction.questions.reduce(
      (html, question) =>
        html
          .replace(question.feedback.success, "")
          .replace(question.feedback.retry, ""),
      buildValidGeneratedHtml(content),
    );

    expect(() =>
      validateHtmlEngineerOutput(htmlWithoutFeedback, {
        content,
        visualBrief,
      }),
    ).not.toThrow();
  });

  it("still requires choice prompts and option labels", () => {
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

  it("treats an input placeholder as optional while keeping the task prompt core", () => {
    const example = getFunctionalTemplateDslExample("achievement-task");
    if (!example || example.interaction.type !== "input") {
      throw new Error("achievement-task 测试夹具必须使用 input interaction");
    }
    const interaction = example.interaction;
    const content: PageContentDSL = {
      ...example,
      runtime: {
        sceneKind: "practice",
        visualPrimitive: "none",
        motionPlan: { intensity: "subtle", cuePoints: [] },
        completionRule: {
          type: "interaction-complete",
          interactionId: `interaction-${example.pageId}`,
        },
      },
    };
    const html = buildValidGeneratedHtml(content);

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
    ).not.toThrow();
    expect(() =>
      validateHtmlEngineerOutput(
        html.replaceAll(interaction.prompt, ""),
        { content, visualBrief },
      ),
    ).toThrow(`页面正文缺少 DSL 文本：${interaction.prompt}`);
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

  it("keeps DOM SVG available while rejecting encoded SVG assets with a short instruction", () => {
    const domSvgHtml = buildValidGeneratedHtml(pageContentDsl).replace(
      "</main>",
      '<svg aria-label="光路关系" viewBox="0 0 100 40"><path d="M0 20h100" /></svg></main>',
    );
    const encodedPayload =
      "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3Cpath%20d='M0%200h10'/%3E%3C/svg%3E";
    const dataSvgHtml = buildValidGeneratedHtml(pageContentDsl).replace(
      "</body>",
      `<img src="${encodedPayload}" alt="光路图标"></body>`,
    );

    expect(() =>
      validateHtmlEngineerOutput(domSvgHtml, {
        content: pageContentDsl,
        visualBrief,
        assets: [],
      }),
    ).not.toThrow();

    let validationError: unknown;
    try {
      validateHtmlEngineerOutput(dataSvgHtml, {
        content: pageContentDsl,
        visualBrief,
        assets: [],
      });
    } catch (error) {
      validationError = error;
    }

    expect(String(validationError)).toContain(
      "代码原生 SVG 必须直接使用文档内 <svg>",
    );
    expect(String(validationError)).not.toContain(encodedPayload);
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
