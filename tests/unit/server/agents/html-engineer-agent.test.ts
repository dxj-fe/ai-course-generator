import { describe, expect, it, vi } from "vitest";

import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import {
  createHtmlEngineerAgent,
  createHtmlEngineerAgentState,
  normalizeNativeInteractionMarker,
  normalizeRevealCardInteraction,
  normalizeTrustedDslMarkup,
  resolveHtmlEngineerInput,
  validateHtmlEngineerOutput,
} from "../../../../src/server/agents/html-engineer-agent";
import type { AssetGenerationResult } from "../../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";

const input = { content: pageContentDsl, visualBrief };

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

function getChoiceContent() {
  const content = getFunctionalTemplateDslExample("interactive-quiz");
  if (!content || content.interaction.type !== "choice") {
    throw new Error("interactive-quiz 测试夹具必须使用 choice interaction");
  }

  return content;
}

describe("HtmlEngineerAgent", () => {
  it("generates and validates one HTML document in one bounded step", async () => {
    const generateHtml = vi
      .fn()
      .mockResolvedValue(buildValidGeneratedHtml(pageContentDsl));
    const result = await createHtmlEngineerAgent({ generateHtml }).run(
      createHtmlEngineerAgentState(input),
      { traceId: "html-engineer-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).toContain("<!doctype html>");
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

    const result = await createHtmlEngineerAgent({
      generateHtml: vi.fn().mockResolvedValue(generatedHtml),
    }).run(createHtmlEngineerAgentState(task), {
      traceId: "css-background-accessibility-normalization-test",
    });

    expect(result.status).toBe("completed");
    expect(result.htmlOutput?.html).toContain(
      'role="img" aria-label="保留左侧文字安全区的太空观察背景。"',
    );
    expect(result.htmlOutput?.html).not.toContain("模型改写的背景说明");
  });

  it("rejects model HTML that asks for script execution", async () => {
    const unsafeHtml = buildValidGeneratedHtml(pageContentDsl).replace(
      "</body>",
      "<script>document.body.textContent = 'unsafe'</script></body>",
    );
    const result = await createHtmlEngineerAgent({
      generateHtml: vi.fn().mockResolvedValue(unsafeHtml),
    }).run(createHtmlEngineerAgentState(input), {
      traceId: "unsafe-html-test",
    });

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("禁止任何内联脚本");
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "error",
    ]);
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

  it("escapes trusted mathematical text and restores omitted reveal content visibly", () => {
    const mathematicalBody =
      "不等式是用不等号（>、<、≥、≤等）连接两个表达式所形成的式子，表示两个量之间的大小关系";
    const content = {
      ...pageContentDsl,
      title: "高一数学核心概念拆解",
      blocks: pageContentDsl.blocks.map((block, index) =>
        index === 1 ? { ...block, body: mathematicalBody } : block,
      ),
      interaction: {
        ...pageContentDsl.interaction,
        prompt: "点击对应卡片查看详细内容",
      },
    };
    const html = buildValidGeneratedHtml(content)
      .replaceAll(content.title, "数学概念课程")
      .replaceAll(content.interaction.prompt, "")
      .replaceAll(mathematicalBody, "模型遗漏的公式说明")
      .replace(' data-interaction-type="reveal"', "");

    let normalized = normalizeTrustedDslMarkup(html, {
      content,
      visualBrief,
    });
    normalized = normalizeNativeInteractionMarker(normalized, {
      content,
      visualBrief,
    });
    normalized = normalizeRevealCardInteraction(normalized, {
      content,
      visualBrief,
    });

    expect(normalized).toContain("高一数学核心概念拆解");
    expect(normalized).toContain("点击对应卡片查看详细内容");
    expect(normalized).toContain("&gt;、&lt;、≥、≤");
    expect(normalized).toContain('data-interaction-type="reveal"');
    expect(() =>
      validateHtmlEngineerOutput(normalized, { content, visualBrief }),
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
