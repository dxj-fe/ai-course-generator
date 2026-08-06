import { describe, expect, it, vi } from "vitest";

import {
  buildPageQAModelMessages,
  createPageQAModelStep,
  createPageQAModelStepState,
  validatePageQAInput,
} from "../../../../src/server/agent/plugins/model-steps/course/page-qa-model-step";
import { AssetGenerationResultSchema } from "../../../../src/shared/course-schema";
import {
  courseDesignOutline,
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const modelOutput = {
  dimensions: {
    contentAccuracy: { score: 96, summary: "内容准确且符合本页目标。" },
    layoutQuality: { score: 94, summary: "层级清楚且信息密度适中。" },
    courseCoherence: { score: 92, summary: "承接封面并引向总结页面。" },
    styleConsistency: { score: 93, summary: "遵守太空视觉方向和排版约束。" },
    htmlRuntime: { score: 100, summary: "静态 HTML 结构完整。" },
    assetUsability: { score: 95, summary: "当前页面没有未满足的素材用途。" },
  },
  issues: [],
};
const capturedEvidence = {
  captures: [
    { width: 922, height: 460, name: "desktop" },
    { width: 712, height: 650, name: "tablet" },
    { width: 366, height: 500, name: "mobile" },
  ].map(({ width, height, name }) => ({
    status: "captured" as const,
    artifactId: `page-qa-test-${name}`,
    viewport: { width, height },
    metrics: {
      documentWidth: width,
      documentHeight: height,
      horizontalOverflowPx: 0,
      clippedElementCount: 0,
      zeroSizeInteractiveCount: 0,
    },
    capturedAt: "2026-07-24T10:00:00.000Z",
  })),
};

function createTestPageQAModelStep(
  overrides: Parameters<typeof createPageQAModelStep>[0] = {},
) {
  return createPageQAModelStep({
    captureScreenshot: vi.fn().mockResolvedValue({
      evidence: capturedEvidence,
      issues: [],
    }),
    ...overrides,
  });
}

function createInput() {
  return {
    page: courseDesignOutline.pages[1]!,
    content: pageContentDsl,
    html: buildValidGeneratedHtml(pageContentDsl),
    visualBrief,
    courseContext: {
      learningObjectives: courseDesignOutline.learningObjectives,
      previousPage: courseDesignOutline.pages[0],
      nextPage: courseDesignOutline.pages[2],
    },
  };
}

describe("PageQAModelStep", () => {
  it("passes ephemeral viewport PNGs to semantic evaluation without persisting them", async () => {
    const evaluate = vi.fn().mockResolvedValue(modelOutput);
    const modelImages = [
      {
        viewport: { width: 922, height: 460 },
        png: new Uint8Array([137, 80, 78, 71]),
      },
      {
        viewport: { width: 366, height: 500 },
        png: new Uint8Array([1, 2, 3]),
      },
    ];
    const state = await createTestPageQAModelStep({
      evaluate,
      captureScreenshot: vi.fn().mockResolvedValue({
        evidence: capturedEvidence,
        issues: [],
        modelImages,
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-page-qa-images",
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ screenshotImages: modelImages }),
    );
    expect(state.report?.screenshotEvidence).toEqual(capturedEvidence);
    expect(JSON.stringify(state.report)).not.toContain("137,80,78,71");
    expect(state.report).not.toHaveProperty("modelImages");
  });

  it("builds actual PNG file parts for each captured viewport", () => {
    const messages = buildPageQAModelMessages("评估页面", [
      {
        viewport: { width: 922, height: 460 },
        png: new Uint8Array([137, 80, 78, 71]),
      },
      {
        viewport: { width: 366, height: 500 },
        png: new Uint8Array([1, 2, 3]),
      },
    ]);

    expect(messages).toEqual([
      {
        id: "page-qa-request",
        role: "user",
        parts: [
          { type: "text", text: "评估页面" },
          {
            type: "text",
            text: "\nPlaywright 首屏截图（视口 922x460）：",
          },
          {
            type: "file",
            mediaType: "image/png",
            filename: "page-qa-922x460.png",
            url: "data:image/png;base64,iVBORw==",
          },
          {
            type: "text",
            text: "\nPlaywright 首屏截图（视口 366x500）：",
          },
          {
            type: "file",
            mediaType: "image/png",
            filename: "page-qa-366x500.png",
            url: "data:image/png;base64,AQID",
          },
        ],
      },
    ]);
  });

  it("merges deterministic checks with semantic evaluation without changing HTML", async () => {
    const evaluate = vi.fn().mockResolvedValue(modelOutput);
    const input = createInput();
    const state = await createTestPageQAModelStep({ evaluate }).run(
      createPageQAModelStepState(input),
      { traceId: "trace-page-qa" },
    );

    expect(state.status).toBe("completed");
    expect(state.report?.decision).toBe("pass");
    expect(state.task.html).toBe(input.html);
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ html: input.html, heuristicIssues: [] }),
    );
    expect(state.events.map(({ type }) => type)).toEqual([
      "start",
      "validation",
      "validation",
      "model_call",
      "validation",
      "finish",
    ]);
  });

  it("forces shouldRepair when deterministic HTML safety checks fail", async () => {
    const input = {
      ...createInput(),
      html: buildValidGeneratedHtml(pageContentDsl).replace(
        "</body>",
        "<script>alert(1)</script></body>",
      ),
    };
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue(modelOutput),
    }).run(createPageQAModelStepState(input), { traceId: "trace-unsafe-qa" });

    expect(state.report?.shouldRepair).toBe(true);
    expect(state.report?.decision).toBe("fail");
    expect(state.report?.issues.some(({ code }) => code === "HTML_SAFETY_INLINE_SCRIPT")).toBe(true);
  });

  it("accepts a model location pageId but replaces it with the current page", async () => {
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        issues: [
          {
            code: "COURSE_DISCONTINUITY",
            dimension: "courseCoherence",
            severity: "warning",
            message: "本页与前一页之间缺少明确承接。",
            location: {
              pageId: "model-invented-page",
              description: "页面开场说明",
            },
            repairHint: "补充一句承接上一页结论的开场说明。",
          },
        ],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-page-id-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.issues[0]?.location.pageId).toBe(
      pageContentDsl.pageId,
    );
  });

  it("拒绝 location 中不属于当前合同的字段", async () => {
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        issues: [
          {
            code: "CONTENT_HIERARCHY_WEAK",
            dimension: "layoutQuality",
            severity: "warning",
            message: "主要内容层级不够清晰。",
            location: {
              description: "页面主要内容",
              repairHint: "强化标题与正文之间的视觉层级。",
              visualRegion: "hero",
            },
          },
        ],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-unknown-location-field-page-qa",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("issues.0.location");
    expect(state.error?.message).toContain("Unrecognized key");
  });

  it("still rejects unknown severity values instead of guessing workflow impact", async () => {
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        issues: [
          {
            code: "UNKNOWN_SEVERITY",
            dimension: "layoutQuality",
            severity: "sometimes",
            message: "该问题使用了未知严重度。",
            location: { description: "页面主体" },
            repairHint: "返回受支持的严重度。",
          },
        ],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-invalid-page-qa-severity",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("issues.0.severity");
  });

  it("does not turn hard-contract HTML behavior into impossible Repair issues", async () => {
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        issues: [
          {
            code: "INTERACTION_FEEDBACK_VISIBLE_BY_DEFAULT",
            dimension: "htmlRuntime",
            severity: "error",
            message: "成功反馈在静态预览中可见。",
            location: {
              selector: ".feedback.success",
              description: "成功反馈",
            },
            repairHint: "使用脚本隐藏反馈。",
          },
          {
            code: "ASSET_ALT_TEXT_INVALID",
            dimension: "styleConsistency",
            severity: "warning",
            message: "建议重新改写已批准素材的 alt 文本。",
            location: {
              selector: "[data-asset-slot-id] img",
              description: "素材图片",
            },
            repairHint: "改写 alt 文本。",
          },
          {
            code: "LAYOUT_READING_ORDER_MISMATCH",
            dimension: "layoutQuality",
            severity: "warning",
            message: "素材节点出现在内容块之前。",
            location: { description: "页面主体" },
            repairHint: "移动素材节点。",
          },
        ],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-contract-owned-page-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.issues).toEqual([]);
    expect(state.report?.decision).toBe("pass");
  });

  it("ignores stale reveal-visibility claims and unlocatable redundancy warnings", async () => {
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        dimensions: {
          ...modelOutput.dimensions,
          courseCoherence: {
            score: 84,
            summary: "旁白和互动提示被误判为重复。",
          },
          htmlRuntime: {
            score: 69,
            summary: "错误地要求 reveal 互动项初始隐藏。",
          },
        },
        issues: [
          {
            code: "INTERACTION_CONTENT_NOT_HIDDEN",
            dimension: "htmlRuntime",
            severity: "error",
            message: "reveal 互动项内容初始可见。",
            location: {
              description: "可信 reveal runtime 的可见互动项",
            },
            repairHint: "隐藏全部互动项。",
          },
          {
            code: "CONTENT_REDUNDANT",
            dimension: "courseCoherence",
            severity: "warning",
            message: "旁白与互动提示重复。",
            location: {
              description: "页面旁白与互动提示",
            },
            repairHint: "删除其中一项。",
          },
        ],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-stale-reveal-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.issues).toEqual([]);
    expect(state.report?.dimensions.htmlRuntime.score).toBe(92);
    expect(state.report?.dimensions.courseCoherence.score).toBe(88);
    expect(state.report?.decision).toBe("pass");
  });

  it("uses deterministic browser touch evidence instead of a duplicate model alias", async () => {
    const input = createInput();
    const browserTouchIssue = {
      code: "BROWSER_TOUCH_TARGET_UNDER_44",
      dimension: "htmlRuntime" as const,
      severity: "info" as const,
      source: "browser" as const,
      message: "一个可见交互控件小于建议的 44×44px。",
      location: {
        pageId: input.page.id,
        viewport: "922x460",
        description: "Playwright 固定视口渲染结果",
      },
      repairHint: "优先扩大主要操作的触控区域。",
    };
    const output = {
      ...modelOutput,
      dimensions: {
        ...modelOutput.dimensions,
        htmlRuntime: {
          score: 69,
          summary: "模型重复报告了浏览器已测量的触控尺寸。",
        },
      },
      issues: [
        {
          code: "TOUCH_TARGET_TOO_SMALL",
          dimension: "htmlRuntime",
          severity: "error",
          message: "互动控件尺寸不足。",
          location: {
            selector: "[data-interaction-type]",
            description: "课程互动控件",
          },
          repairHint: "扩大互动控件。",
        },
      ],
    };
    const withBrowserEvidence = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue(output),
      captureScreenshot: vi.fn().mockResolvedValue({
        evidence: capturedEvidence,
        issues: [browserTouchIssue],
      }),
    }).run(createPageQAModelStepState(input), {
      traceId: "trace-browser-touch-authority",
    });
    const withoutBrowserEvidence = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue(output),
    }).run(createPageQAModelStepState(input), {
      traceId: "trace-model-touch-fallback",
    });

    expect(withBrowserEvidence.report?.issues).toEqual([
      browserTouchIssue,
    ]);
    expect(
      withBrowserEvidence.report?.dimensions.htmlRuntime.score,
    ).toBeGreaterThanOrEqual(92);
    expect(withBrowserEvidence.report?.decision).toBe("pass");
    expect(withoutBrowserEvidence.report?.issues[0]?.code).toBe(
      "TOUCH_TARGET_TOO_SMALL",
    );
    expect(withoutBrowserEvidence.report?.decision).toBe("revise");
  });

  it("ignores restored-content redundancy only for the located restored block", async () => {
    const input = createInput();
    const html = input.html.replace(
      "</article>",
      '<div data-course-contract-restored="block"><p>平台恢复的必需正文</p></div></article>',
    );
    const outputForBlock = (blockId: string) => ({
      ...modelOutput,
      dimensions: {
        ...modelOutput.dimensions,
        courseCoherence: {
          score: 69,
          summary: "模型把平台合同恢复节点误判为正文重复。",
        },
      },
      issues: [
        {
          code: "CONTENT_REDUNDANT",
          dimension: "courseCoherence",
          severity: "error",
          message: "内容块出现重复正文。",
          location: {
            blockId,
            description: `内容块 ${blockId}`,
          },
          repairHint: "删除重复正文。",
        },
      ],
    });
    const restoredBlock = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue(outputForBlock("block-01")),
    }).run(createPageQAModelStepState({ ...input, html }), {
      traceId: "trace-restored-block-redundancy",
    });
    const differentBlock = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue(outputForBlock("block-02")),
    }).run(createPageQAModelStepState({ ...input, html }), {
      traceId: "trace-real-block-redundancy",
    });

    expect(restoredBlock.report?.issues).toEqual([]);
    expect(restoredBlock.report?.decision).toBe("pass");
    expect(differentBlock.report?.issues[0]?.code).toBe(
      "CONTENT_REDUNDANT",
    );
    expect(differentBlock.report?.decision).toBe("revise");
  });

  it("keeps model-only below-fold claims as non-blocking observations", async () => {
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        dimensions: {
          ...modelOutput.dimensions,
          layoutQuality: {
            score: 69,
            summary: "导航操作位于长正文之后。",
          },
        },
        issues: [
          {
            code: "PRIMARY_ACTION_BELOW_FOLD",
            dimension: "layoutQuality",
            severity: "error",
            message: "导航操作未出现在首屏。",
            location: {
              selector: '[data-interaction-type="navigate"]',
              description: "长知识页末尾的导航操作",
            },
            repairHint: "压缩所有正文。",
          },
        ],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-balanced-page-scroll",
    });

    expect(state.report?.issues).toMatchObject([
      {
        code: "PRIMARY_ACTION_BELOW_FOLD",
        severity: "warning",
        source: "model",
      },
    ]);
    expect(state.report?.dimensions.layoutQuality.score).toBe(69);
    expect(state.report?.decision).toBe("pass");
  });

  it("treats a safely contained opaque fallback as provider metadata instead of a repair failure", async () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "展示当前知识点",
          required: true,
          altTextGuidance: "知识点插图",
        },
      ],
    };
    const asset = transparentFallbackAsset(content.pageId);
    const html = buildValidGeneratedHtml(content).replace(
      '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示当前知识点</figcaption></figure>',
      '<figure data-asset-slot-id="asset-slot-01"><img src="/api/assets/asset-opaque" alt="知识点插图"></figure>',
    );
    const evaluate = vi.fn().mockResolvedValue({
      ...modelOutput,
      dimensions: {
        ...modelOutput.dimensions,
        assetUsability: {
          score: 75,
          summary: "供应商未返回透明通道。",
        },
      },
      issues: [
        {
          code: "ASSET_TRANSPARENCY_UNAVAILABLE",
          dimension: "assetUsability",
          severity: "warning",
          message: "素材没有透明通道。",
          location: {
            selector: '[data-asset-slot-id="asset-slot-01"]',
            description: "知识点插图",
          },
          repairHint: "把素材放入独立容器。",
        },
      ],
    });
    const state = await createTestPageQAModelStep({ evaluate }).run(
      createPageQAModelStepState({
        ...createInput(),
        content,
        html,
        assets: [asset],
      }),
      { traceId: "trace-safe-opaque-fallback" },
    );

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [
          expect.objectContaining({
            warnings: [],
          }),
        ],
      }),
    );
    expect(state.report?.issues).toEqual([]);
    expect(state.report?.dimensions.assetUsability.score).toBe(80);
    expect(state.report?.decision).toBe("pass");
  });

  it("保留不透明素材 warning 作为观测信号，但不自动触发返工", async () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "展示当前知识点",
          required: true,
          altTextGuidance: "知识点插图",
        },
      ],
    };
    const html = buildValidGeneratedHtml(content).replace(
      '<figure data-asset-slot-id="asset-slot-01"><figcaption>展示当前知识点</figcaption></figure>',
      '<figure data-asset-slot-id="asset-slot-01"><img src="/api/assets/asset-opaque" alt="知识点插图"></figure>',
    );
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        dimensions: {
          ...modelOutput.dimensions,
          assetUsability: {
            score: 75,
            summary: "不透明素材与页面背景发生实际冲突。",
          },
        },
        issues: [
          {
            code: "OPAQUE_ASSET_BACKGROUND_CLASH",
            dimension: "assetUsability",
            severity: "warning",
            message: "不透明素材与相邻背景发生实际视觉冲突。",
            location: {
              selector: '[data-asset-slot-id="asset-slot-01"]',
              description: "知识点插图",
            },
            repairHint: "调整素材容器的背景和边界。",
          },
        ],
      }),
    }).run(
      createPageQAModelStepState({
        ...createInput(),
        content,
        html,
        assets: [transparentFallbackAsset(content.pageId)],
      }),
      { traceId: "trace-opaque-presentation-issue" },
    );

    expect(state.report?.dimensions.assetUsability.score).toBe(75);
    expect(state.report?.issues[0]?.code).toBe(
      "OPAQUE_ASSET_BACKGROUND_CLASH",
    );
    expect(state.report?.shouldRepair).toBe(false);
    expect(state.report?.decision).toBe("pass");
  });

  it("keeps browser capture failures as non-blocking infrastructure evidence", async () => {
    const failedEvidence = {
      captures: [
        { width: 922, height: 460 },
        { width: 712, height: 650 },
        { width: 366, height: 500 },
      ].map(({ width, height }) => ({
        status: "failed" as const,
        viewport: { width, height },
        reason: "截图 QA 超时。",
      })),
    };
    const state = await createTestPageQAModelStep({
      evaluate: vi.fn().mockResolvedValue(modelOutput),
      captureScreenshot: vi.fn().mockResolvedValue({
        evidence: failedEvidence,
        issues: [],
      }),
    }).run(createPageQAModelStepState(createInput()), {
      traceId: "trace-screenshot-failure",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.screenshotEvidence).toEqual(failedEvidence);
    expect(state.report?.decision).toBe("pass");
    expect(state.report?.issues[0]?.code).toBe("SCREENSHOT_CAPTURE_FAILED");
  });

  it("rejects a page and DSL that do not describe the same artifact", () => {
    expect(() =>
      validatePageQAInput({
        ...createInput(),
        content: { ...pageContentDsl, pageId: "page-other" },
      }),
    ).toThrow("PagePlan.id 必须与 PageContentDSL.pageId 一致");
  });
});

function transparentFallbackAsset(pageId: string) {
  return AssetGenerationResultSchema.parse({
    request: {
      assetSlotId: "asset-slot-01",
      assetType: "character_sticker",
      usage: "展示当前知识点",
      prompt: "A transparent educational illustration without text.",
      transparentBackground: true,
      safeArea: {
        position: "none",
        coveragePercent: 0,
        description: "独立插图不承载文字",
      },
      aspectRatio: "3:4",
    },
    status: "ready",
    asset: {
      id: "asset-opaque",
      type: "illustration",
      role: "inline",
      source: "generated",
      status: "ready",
      uri: "/api/assets/asset-opaque",
      altText: "知识点插图",
      generationPrompt: "A transparent educational illustration without text.",
      mimeType: "image/jpeg",
      dimensions: { width: 768, height: 1024 },
      usedByPageIds: [pageId],
    },
    warnings: ["TRANSPARENCY_UNAVAILABLE"],
    durationMs: 12,
  });
}
