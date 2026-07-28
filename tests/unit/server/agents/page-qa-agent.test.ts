import { describe, expect, it, vi } from "vitest";

import {
  createPageQAAgent,
  createPageQAAgentState,
  validatePageQAInput,
} from "../../../../src/server/agents/page-qa-agent";
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
  status: "captured" as const,
  artifactId: "page-qa-test-desktop",
  viewport: { width: 922, height: 460 },
  metrics: {
    documentWidth: 922,
    documentHeight: 460,
    horizontalOverflowPx: 0,
    clippedElementCount: 0,
    zeroSizeInteractiveCount: 0,
  },
  capturedAt: "2026-07-24T10:00:00.000Z",
};

function createTestPageQAAgent(
  overrides: Parameters<typeof createPageQAAgent>[0] = {},
) {
  return createPageQAAgent({
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

describe("PageQAAgent", () => {
  it("merges deterministic checks with semantic evaluation without changing HTML", async () => {
    const evaluate = vi.fn().mockResolvedValue(modelOutput);
    const input = createInput();
    const state = await createTestPageQAAgent({ evaluate }).run(
      createPageQAAgentState(input),
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
    const state = await createTestPageQAAgent({
      evaluate: vi.fn().mockResolvedValue(modelOutput),
    }).run(createPageQAAgentState(input), { traceId: "trace-unsafe-qa" });

    expect(state.report?.shouldRepair).toBe(true);
    expect(state.report?.decision).toBe("fail");
    expect(state.report?.issues.some(({ code }) => code === "HTML_SAFETY_INLINE_SCRIPT")).toBe(true);
  });

  it("accepts a model location pageId but replaces it with the current page", async () => {
    const state = await createTestPageQAAgent({
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
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-page-id-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.issues[0]?.location.pageId).toBe(
      pageContentDsl.pageId,
    );
  });

  it("normalizes bounded QA text, common severity aliases, and missing location descriptions", async () => {
    const state = await createTestPageQAAgent({
      evaluate: vi.fn().mockResolvedValue({
        ...modelOutput,
        dimensions: {
          ...modelOutput.dimensions,
          contentAccuracy: {
            score: 72,
            summary: "内容结论需要进一步核对。".repeat(30),
          },
        },
        issues: [
          {
            code: "CONTENT_EVIDENCE_WEAK",
            dimension: "contentAccuracy",
            severity: "high",
            message: "正文中的结论缺少充分依据。",
            location: { blockId: "block-01" },
            repairHint: "补充与该结论直接相关的解释。",
          },
          {
            code: "LAYOUT_DENSITY",
            dimension: "layoutQuality",
            severity: "minor",
            message: "主要内容区域略显紧凑。",
            location: { selector: "main" },
            repairHint: "适当增加主要内容区域的留白。",
          },
        ],
      }),
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-normalized-page-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.dimensions.contentAccuracy.summary.length).toBe(300);
    expect(state.report?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONTENT_EVIDENCE_WEAK",
          severity: "error",
          location: expect.objectContaining({ description: "内容块 block-01" }),
        }),
        expect.objectContaining({
          code: "LAYOUT_DENSITY",
          severity: "warning",
          location: expect.objectContaining({ description: "页面元素 main" }),
        }),
      ]),
    );
  });

  it("still rejects unknown severity values instead of guessing workflow impact", async () => {
    const state = await createTestPageQAAgent({
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
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-invalid-page-qa-severity",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("issues.0.severity");
  });

  it("does not turn hard-contract HTML behavior into impossible Repair issues", async () => {
    const state = await createTestPageQAAgent({
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
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-contract-owned-page-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.issues).toEqual([]);
    expect(state.report?.decision).toBe("pass");
  });

  it("ignores stale reveal-visibility claims and unlocatable redundancy warnings", async () => {
    const state = await createTestPageQAAgent({
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
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-stale-reveal-qa",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.issues).toEqual([]);
    expect(state.report?.dimensions.htmlRuntime.score).toBe(92);
    expect(state.report?.dimensions.courseCoherence.score).toBe(88);
    expect(state.report?.decision).toBe("pass");
  });

  it("keeps below-fold failures on a balanced lesson", async () => {
    const state = await createTestPageQAAgent({
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
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-balanced-page-scroll",
    });

    expect(state.report?.issues).toMatchObject([
      {
        code: "PRIMARY_ACTION_BELOW_FOLD",
        severity: "error",
        source: "model",
      },
    ]);
    expect(state.report?.dimensions.layoutQuality.score).toBe(69);
    expect(state.report?.decision).toBe("revise");
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
    const state = await createTestPageQAAgent({ evaluate }).run(
      createPageQAAgentState({
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

  it("keeps a real opaque-asset presentation issue below the quality gate", async () => {
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
    const state = await createTestPageQAAgent({
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
      createPageQAAgentState({
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
    expect(state.report?.decision).toBe("revise");
  });

  it("keeps browser evidence and sends capture failures through repair", async () => {
    const failedEvidence = {
      status: "failed" as const,
      viewport: { width: 1440, height: 900 },
      reason: "截图 QA 超时。",
    };
    const state = await createTestPageQAAgent({
      evaluate: vi.fn().mockResolvedValue(modelOutput),
      captureScreenshot: vi.fn().mockResolvedValue({
        evidence: failedEvidence,
        issues: [],
      }),
    }).run(createPageQAAgentState(createInput()), {
      traceId: "trace-screenshot-failure",
    });

    expect(state.status).toBe("completed");
    expect(state.report?.screenshotEvidence).toEqual(failedEvidence);
    expect(state.report?.decision).toBe("revise");
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
