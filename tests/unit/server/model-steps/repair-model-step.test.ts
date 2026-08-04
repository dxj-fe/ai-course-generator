import { describe, expect, it, vi } from "vitest";

import {
  buildRepairModelInput,
  createRepairModelStep,
  createRepairModelStepState,
} from "../../../../src/server/agent/plugins/model-steps/course/repair-model-step";
import { planRepairRound } from "../../../../src/server/course/page/repair-plan";
import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../../fixtures/quality-report";
import { RepairRequestSchema } from "../../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";

function htmlRequest() {
  const request = planRepairRound({
    pageId: pageContentDsl.pageId,
    content: pageContentDsl,
    html: buildValidGeneratedHtml(pageContentDsl),
    visualBrief,
    assets: [],
    attemptCount: 0,
    report: qualityReportWithIssue({
      code: "LAYOUT_OVERFLOW",
      dimension: "layoutQuality",
      selector: "style",
    }),
  });
  if ("status" in request) throw new Error(request.message);
  return request;
}

describe("Repair model step", () => {
  it("only exposes the issues authorized for the current repair round", () => {
    const request = htmlRequest();
    const unrelatedIssue = {
      ...request.sourceReport.issues[0]!,
      code: "UNRELATED_WARNING",
      severity: "warning" as const,
    };
    const requestWithUnrelatedWarning = RepairRequestSchema.parse({
      ...request,
      sourceReport: {
        ...request.sourceReport,
        issues: [...request.sourceReport.issues, unrelatedIssue],
      },
    });

    const modelInput = buildRepairModelInput(requestWithUnrelatedWarning);

    expect(modelInput.sourceReport.issues.map(({ code }) => code)).toEqual(
      request.issueCodes,
    );
    expect(JSON.stringify(modelInput)).not.toContain("UNRELATED_WARNING");
  });

  it("does not send HTML and visual payloads to a DSL-only repair call", () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "OBJECTIVE_CHECK_INCOMPLETE",
        dimension: "courseCoherence",
        selector: ".interaction",
      }),
    });
    if ("status" in request) throw new Error(request.message);

    const modelInput = buildRepairModelInput(request);

    expect(modelInput).not.toHaveProperty("html");
    expect(modelInput).not.toHaveProperty("visualBrief");
    expect(modelInput).not.toHaveProperty("assets");
    expect(modelInput).toMatchObject({
      targetArtifact: "dsl",
      allowedContentFields: ["interaction"],
      content: pageContentDsl,
    });
  });

  it("applies one exact HTML patch and preserves the original HTML contract", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["限制页面宽度。"],
        patches: [
          {
            issueCode: request.issueCodes[0],
            search: "body { margin: 0; }",
            replacement: "body { margin: 0; max-width: 100%; }",
            summary: "限制 body 宽度。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), { traceId: "trace-repair-html" });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain("max-width: 100%");
    expect(state.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "validation",
      "finish",
    ]);
  });

  it("applies a CSS presentation patch at the authorized style boundary", async () => {
    const request = htmlRequest();
    const generateCandidate = vi.fn().mockResolvedValue({
      kind: "html_patch_candidate",
      pageId: request.pageId,
      targetArtifact: "html",
      addressedIssueCodes: request.issueCodes,
      unresolvedIssueCodes: [],
      changeSummary: ["限制全局裁切并保持固定画布适配。"],
      patches: [
        {
          issueCode: request.issueCodes[0],
          operation: "insert_before_close_tag",
          selector: "style",
          replacement:
            "\nhtml, body { width: 100%; height: 100%; box-sizing: border-box; }\n",
          summary: "在授权样式边界修正固定画布裁切。",
        },
      ],
    });

    const state = await createRepairModelStep({ generateCandidate }).run(
      createRepairModelStepState(request),
      { traceId: "trace-repair-html-body-css-scope" },
    );

    expect(generateCandidate).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(
      "html, body { width: 100%; height: 100%; box-sizing: border-box; }\n</style>",
    );
    expect(state.result).toMatchObject({
      kind: "html_patch_candidate",
      patches: [
        {
          selector: "style",
          summary: "在授权样式边界修正固定画布裁切。",
        },
      ],
    });
  });

  it.each([
    "html, body { overflow: auto; }",
    ".course-content { overflow-y: scroll; }",
    "[data-interaction-type] { overflow-x: auto; }",
  ])(
    "rejects a Repair candidate that makes a lesson container scroll: %s",
    async (replacement) => {
      const request = htmlRequest();
      const state = await createRepairModelStep({
        generateCandidate: vi.fn().mockResolvedValue({
          kind: "html_patch_candidate",
          pageId: request.pageId,
          targetArtifact: "html",
          addressedIssueCodes: request.issueCodes,
          unresolvedIssueCodes: [],
          changeSummary: ["尝试通过滚动容纳内容。"],
          patches: [
            {
              issueCode: request.issueCodes[0],
              operation: "insert_before_close_tag",
              selector: "style",
              replacement: `\n${replacement}\n`,
              summary: "尝试建立滚动区。",
            },
          ],
        }),
      }).run(createRepairModelStepState(request), {
        traceId: "trace-repair-scroll-rejected",
      });

      expect(state.status).toBe("failed");
      expect(state.error).toMatchObject({
        code: "SCHEMA_ERROR",
        message: expect.stringContaining("不得在课程根、正文或互动容器"),
      });
      expect(state.repairedHtml).toBeUndefined();
    },
  );

  it("does not reject overflow on a pure decorative region", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["限制装饰胶片的内部视觉区域。"],
        patches: [
          {
            issueCode: request.issueCodes[0],
            operation: "insert_before_close_tag",
            selector: "style",
            replacement: "\nmain .decorative-filmstrip { overflow-x: auto; }\n",
            summary: "仅调整纯装饰胶片区域。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-decorative-overflow",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(
      "main .decorative-filmstrip { overflow-x: auto; }",
    );
  });

  it("repairs touch-target sizing deterministically without another model call", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "TOO_SMALL_TOUCH_TARGET",
        dimension: "htmlRuntime",
        selector: 'input[type="radio"], button',
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const generateCandidate = vi.fn();
    const state = await createRepairModelStep({ generateCandidate }).run(
      createRepairModelStepState(request),
      { traceId: "trace-repair-touch-target" },
    );

    expect(state.status).toBe("completed");
    expect(generateCandidate).not.toHaveBeenCalled();
    expect(state.repairedHtml).toContain("min-height: 44px !important");
    expect(state.repairedHtml).toContain("min-width: 24px !important");
    expect(state.repairedHtml).toContain(
      "[data-interaction-type] [data-interaction-item-id]",
    );
    expect(state.events.map(({ type }) => type)).toEqual([
      "start",
      "validation",
      "validation",
      "finish",
    ]);

    const baseline = state.repairedHtml?.match(
      /\/\* keya-touch-target-baseline \*\/[\s\S]*?(?=<\/style>)/,
    )?.[0];
    if (!state.repairedHtml || !baseline) {
      throw new Error("deterministic touch baseline is required");
    }
    const duplicatedHtml = state.repairedHtml.replace(
      "</style>",
      `${baseline}</style>`,
    );
    const duplicateRequest = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: duplicatedHtml,
      visualBrief,
      assets: [],
      attemptCount: 1,
      report: qualityReportWithIssue({
        code: "BROWSER_TOUCH_TARGET_UNDER_44",
        dimension: "htmlRuntime",
      }),
    });
    if ("status" in duplicateRequest) {
      throw new Error(duplicateRequest.message);
    }
    const deduplicated = await createRepairModelStep({
      generateCandidate: vi.fn(),
    }).run(createRepairModelStepState(duplicateRequest), {
      traceId: "trace-repair-touch-target-deduplicate",
    });

    expect(deduplicated.status).toBe("completed");
    expect(
      deduplicated.repairedHtml?.match(
        /keya-touch-target-baseline/g,
      ),
    ).toHaveLength(1);
  });

  it("repairs desktop vertical overflow deterministically without scrolling or hiding content", async () => {
    const htmlWithTrustedLayoutGuard = buildValidGeneratedHtml(
      pageContentDsl,
    ).replace(
      "</head>",
      '<style data-keya-layout-guard="current">main[data-page-id] { height: 100%; }</style></head>',
    );
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: htmlWithTrustedLayoutGuard,
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "BROWSER_VERTICAL_OVERFLOW",
        dimension: "layoutQuality",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const generateCandidate = vi.fn();

    const state = await createRepairModelStep({ generateCandidate }).run(
      createRepairModelStepState(request),
      { traceId: "trace-repair-vertical-fit" },
    );

    expect(state.status).toBe("completed");
    expect(generateCandidate).not.toHaveBeenCalled();
    expect(state.repairedHtml).toContain("keya-vertical-fit-baseline");
    expect(state.repairedHtml).toContain("max-height: 520px");
    expect(state.repairedHtml).toContain(
      'main[data-page-id] { height: 100%; }\n/* keya-vertical-fit-baseline */',
    );
    expect(state.repairedHtml).not.toMatch(
      /keya-vertical-fit-baseline[\s\S]*overflow\s*:\s*(?:auto|scroll|hidden)/,
    );
    expect(state.repairedHtml).not.toMatch(
      /keya-vertical-fit-baseline[\s\S]*display\s*:\s*none/,
    );
    expect(state.result).toMatchObject({
      kind: "html_patch_candidate",
      addressedIssueCodes: ["BROWSER_VERTICAL_OVERFLOW"],
      patches: [{ selector: "style" }],
    });
  });

  it("contains an opaque provider fallback deterministically", async () => {
    const asset = {
      request: {
        assetSlotId: "asset-slot-01",
        assetType: "character_sticker" as const,
        usage: "展示当前知识点",
        prompt: "A transparent educational illustration.",
        transparentBackground: true,
        safeArea: {
          position: "none" as const,
          coveragePercent: 0,
          description: "独立插图不承载文字",
        },
        aspectRatio: "1:1" as const,
      },
      status: "ready" as const,
      asset: {
        id: "asset-opaque",
        type: "illustration" as const,
        role: "inline" as const,
        source: "generated" as const,
        status: "ready" as const,
        uri: "/api/assets/asset-opaque",
        mimeType: "image/jpeg",
        dimensions: { width: 1024, height: 1024 },
        generationPrompt: "A transparent educational illustration.",
        altText: "知识点插图",
        usedByPageIds: [pageContentDsl.pageId],
      },
      warnings: ["TRANSPARENCY_UNAVAILABLE" as const],
      durationMs: 12,
    };
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      "</main>",
      '<img data-asset-slot-id="asset-slot-01" src="/api/assets/asset-opaque" alt="知识点插图"></main>',
    );
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: {
        ...pageContentDsl,
        assetSlots: [
          {
            id: "asset-slot-01",
            type: "illustration" as const,
            role: "inline" as const,
            purpose: "知识点插图",
            required: true,
            altTextGuidance: "知识点插图",
          },
        ],
      },
      html,
      visualBrief,
      assets: [asset],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "ASSET_TRANSPARENCY_UNAVAILABLE",
        dimension: "assetUsability",
        selector: '[data-asset-slot-id="asset-slot-01"]',
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const generateCandidate = vi.fn();
    const state = await createRepairModelStep({ generateCandidate }).run(
      createRepairModelStepState(request),
      { traceId: "trace-repair-opaque-fallback" },
    );

    expect(state.status).toBe("completed");
    expect(generateCandidate).not.toHaveBeenCalled();
    expect(state.repairedHtml).toContain(
      '<figure data-asset-slot-id="asset-slot-01" data-course-opaque-fallback="true"',
    );
    expect(state.repairedHtml).toContain(
      '<img src="/api/assets/asset-opaque" alt="知识点插图">',
    );
    expect(
      state.repairedHtml?.match(/data-asset-slot-id="asset-slot-01"/g),
    ).toHaveLength(1);
  });

  it("拒绝字符串形式的 changeSummary", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: "限制页面宽度。",
        patches: [
          {
            issueCode: request.issueCodes[0],
            search: "body { margin: 0; }",
            replacement: "body { margin: 0; max-width: 100%; }",
            summary: "限制 body 宽度。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-scalar-summary",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("changeSummary");
  });

  it("derives addressed and unresolved HTML issues from the patches that were actually supplied", async () => {
    const base = htmlRequest();
    const secondIssue = {
      ...base.sourceReport.issues[0]!,
      code: "SECOND_LAYOUT_ISSUE",
    };
    const request = RepairRequestSchema.parse({
      ...base,
      issueCodes: [base.issueCodes[0], secondIssue.code],
      sourceReport: {
        ...base.sourceReport,
        issues: [...base.sourceReport.issues, secondIssue],
      },
    });
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: ["UNRELATED_WARNING"],
        changeSummary: ["限制页面宽度。"],
        patches: [
          {
            issueCode: request.issueCodes[0],
            search: "body { margin: 0; }",
            replacement: "body { margin: 0; max-width: 100%; }",
            summary: "限制 body 宽度。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-derived-issues",
    });

    expect(state.status).toBe("completed");
    expect(state.result).toMatchObject({
      addressedIssueCodes: [request.issueCodes[0]],
      unresolvedIssueCodes: [secondIssue.code],
    });
  });

  it("still rejects an actual HTML patch that references an unauthorized issue", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["错误地引用未授权问题。"],
        patches: [
          {
            issueCode: "UNAUTHORIZED_ISSUE",
            search: "body { margin: 0; }",
            replacement: "body { margin: 0; max-width: 100%; }",
            summary: "限制 body 宽度。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-unauthorized-patch",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain(
      "HTML patch 引用了未授权 issue UNAUTHORIZED_ISSUE",
    );
  });

  it("inserts a missing main at unique body boundaries without searching for absent markup", async () => {
    const htmlWithoutMain = buildValidGeneratedHtml(pageContentDsl)
      .replace(`<main data-page-id="${pageContentDsl.pageId}">`, "")
      .replace("</main>", "");
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: htmlWithoutMain,
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "HTML_MAIN_MISSING",
        dimension: "htmlRuntime",
        selector: "body",
      }),
    });
    if ("status" in request) throw new Error(request.message);

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["使用 main 包裹页面主体。"],
        patches: [
          {
            issueCode: "HTML_MAIN_MISSING",
            operation: "insert_after_open_tag",
            selector: "body",
            replacement: `\n    <main data-page-id="${pageContentDsl.pageId}">`,
            summary: "插入 main 开标签。",
          },
          {
            issueCode: "HTML_MAIN_MISSING",
            operation: "insert_before_close_tag",
            selector: "body",
            replacement: "\n    </main>",
            summary: "插入 main 闭标签。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-missing-main",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(
      `<main data-page-id="${pageContentDsl.pageId}">`,
    );
    expect(state.repairedHtml).toMatch(/<body>\s*<main[\s\S]*<\/main>\s*<\/body>/);
  });

  it("拒绝复杂 HTML 边界选择器", async () => {
    const htmlWithoutMain = buildValidGeneratedHtml(pageContentDsl)
      .replace(`<main data-page-id="${pageContentDsl.pageId}">`, "")
      .replace("</main>", "");
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: htmlWithoutMain,
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "HTML_MAIN_MISSING",
        dimension: "htmlRuntime",
        selector: "body",
      }),
    });
    if ("status" in request) throw new Error(request.message);

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["使用 main 包裹页面主体。"],
        patches: [
          {
            issueCode: "HTML_MAIN_MISSING",
            operation: "insert_after_open_tag",
            selector: "body > .container",
            replacement: `\n    <main data-page-id="${pageContentDsl.pageId}">`,
            summary: "插入 main 开标签。",
          },
          {
            issueCode: "HTML_MAIN_MISSING",
            operation: "insert_before_close_tag",
            selector: "body > .container",
            replacement: "\n    </main>",
            summary: "插入 main 闭标签。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-rooted-selector",
    });

    expect(state.status).toBe("failed");
    expect(state.repairedHtml).toBeUndefined();
    expect(state.error?.message).toContain("patches.0.selector");
  });

  it("rejects changes to DSL blocks outside the authorized issue location", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "CONTENT_FACT",
        dimension: "contentAccuracy",
        blockId: "block-01",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const candidate = structuredClone(pageContentDsl);
    candidate.blocks[1]!.body = "未授权修改。";
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "dsl_candidate",
        pageId: request.pageId,
        targetArtifact: "dsl",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["修改事实。"],
        candidate,
      }),
    }).run(createRepairModelStepState(request), { traceId: "trace-repair-scope" });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("未授权 block block-02");
  });

  it("repairs only narration when a blockless cover misses its page objective", async () => {
    const example = getFunctionalTemplateDslExample("course-cover");
    if (!example) throw new Error("course-cover fixture is required");
    const content = { ...example, pageId: pageContentDsl.pageId };
    const request = planRepairRound({
      pageId: content.pageId,
      content,
      html: buildValidGeneratedHtml(content),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "OBJECTIVE_COVERAGE_GAP",
        dimension: "courseCoherence",
        selector: "#page-narration",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const candidate = {
      ...content,
      narration: [
        "《唐诗三百首》是广为流传的唐诗选本，适合用来建立唐诗阅读的入门路径。",
      ],
    };

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "dsl_candidate",
        pageId: request.pageId,
        targetArtifact: "dsl",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["补足选本定位与学习路径。"],
        candidate,
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-cover-narration",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedContent?.narration).toEqual(candidate.narration);
    expect(state.repairedContent?.title).toBe(content.title);
    expect(state.repairedContent?.blocks).toEqual([]);
  });

  it("拒绝 DSL 别名和跨分支字段", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "OBJECTIVE_CHECK_INCOMPLETE",
        dimension: "courseCoherence",
        selector: ".interaction",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const candidate = {
      ...pageContentDsl,
      interaction: {
        ...pageContentDsl.interaction,
        prompt: "逐项揭示后，说出恒星与行星是否会自己发光。",
      },
    };

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "dsl_candidate",
        pageId: request.pageId,
        targetArtifact: "dsl",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["让揭示任务直接检查本页学习目标。"],
        dsl: candidate,
        patches: [
          {
            issueCode: request.issueCodes[0],
            operation: "replace",
            search: "unused",
            replacement: "unused",
            summary: "Provider 误带的 HTML 分支字段。",
          },
        ],
        issueCodes: request.issueCodes,
        failureClass: "agent_failed",
        reasonSummary: "Provider 误带的拒绝分支字段。",
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-interaction-alias",
    });

    expect(state.status).toBe("failed");
    expect(state.repairedContent).toBeUndefined();
    expect(state.error?.message).toContain("Unrecognized keys");
  });

  it("拒绝嵌套的 declined 别名", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "declined",
        pageId: request.pageId,
        targetArtifact: request.targetArtifact,
        addressedIssueCodes: [],
        unresolvedIssueCodes: request.issueCodes,
        changeSummary: ["当前选择器不足以安全完成布局重构。"],
        candidate: pageContentDsl,
        patches: [],
        declined: {
          issueCodes: request.issueCodes,
          failureClass: "unlocatable_issue",
          reasonSummary: "当前授权范围不足以安全修改该布局。",
        },
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-nested-decline",
    });

    expect(state.status).toBe("failed");
    expect(state.result).toBeUndefined();
    expect(state.error?.message).toContain("Unrecognized keys");
  });

  it("rejects changing the interaction type during an authorized interaction repair", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "OBJECTIVE_CHECK_INCOMPLETE",
        dimension: "courseCoherence",
        selector: ".interaction",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const candidate = {
      ...pageContentDsl,
      interaction: {
        type: "choice" as const,
        questions: [
          {
            id: "question-01",
            prompt: "哪一个会自己发光？",
            options: [
              { id: "option-star", label: "恒星" },
              { id: "option-planet", label: "行星" },
            ],
            correctOptionId: "option-star",
            feedback: {
              success: "正确，恒星能够自己发光。",
              retry: "再比较两者的发光特点。",
            },
            maxAttempts: 2,
          },
        ],
      },
    };

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "dsl_candidate",
        pageId: request.pageId,
        targetArtifact: "dsl",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["更换互动形式。"],
        candidate,
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-interaction-type",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("必须保留原互动类型");
  });

  it("rejects changing interaction technical IDs during an authorized repair", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "OBJECTIVE_CHECK_INCOMPLETE",
        dimension: "courseCoherence",
        selector: ".interaction",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    if (pageContentDsl.interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const candidate = {
      ...pageContentDsl,
      interaction: {
        ...pageContentDsl.interaction,
        items: pageContentDsl.interaction.items.map((item, index) => ({
          ...item,
          id: index === 0 ? "item-renamed" : item.id,
        })),
      },
    };

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "dsl_candidate",
        pageId: request.pageId,
        targetArtifact: "dsl",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["错误地修改互动 ID。"],
        candidate,
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-interaction-id",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("必须保留原技术 ID");
  });

  it("rejects an HTML patch outside the authorized selector scope", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["错误地修改标题。"],
        patches: [
          {
            issueCode: request.issueCodes[0],
            search: `<h1>${pageContentDsl.title}</h1>`,
            replacement: `<h1 class="wide">${pageContentDsl.title}</h1>`,
            summary: "修改标题。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), { traceId: "trace-repair-selector" });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("超出允许 selector scope");
  });

  it("applies a unique patch inside the terminal class of a descendant selector", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "INTERACTION_LABEL_MISMATCH",
        dimension: "courseCoherence",
        selector: ".interaction .interaction-item",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const source = '<button class="interaction-item">项目 1</button>';
    const requestWithInteraction = {
      ...request,
      html: request.html.replace("</main>", `${source}</main>`),
    };
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["将通用标签替换为教学语义标签。"],
        patches: [
          {
            issueCode: "INTERACTION_LABEL_MISMATCH",
            search: source,
            replacement: '<button class="interaction-item">增函数</button>',
            summary: "修正交互项标签。",
          },
        ],
      }),
    }).run(createRepairModelStepState(requestWithInteraction), {
      traceId: "trace-repair-descendant-selector",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(">增函数</button>");
  });

  it("applies a text-only patch inside an authorized id selector", async () => {
    const narration = pageContentDsl.narration[0]!;
    const htmlWithNarrationId = buildValidGeneratedHtml(pageContentDsl).replace(
      narration,
      `<p id="page-narration">${narration}</p>`,
    );
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: htmlWithNarrationId,
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "NARRATION_EMPHASIS",
        dimension: "layoutQuality",
        selector: "#page-narration",
      }),
    });
    if ("status" in request) throw new Error(request.message);

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["突出显示页面旁白。"],
        patches: [
          {
            issueCode: "NARRATION_EMPHASIS",
            search: narration,
            replacement: `<strong>${narration}</strong>`,
            summary: "在旁白容器内增加语义强调。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-id-descendant-text",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(
      `<p id="page-narration"><strong>${narration}</strong></p>`,
    );
  });

  it("rejects a text-only patch outside an authorized id selector", async () => {
    const narration = pageContentDsl.narration[0]!;
    const htmlWithNarrationId = buildValidGeneratedHtml(pageContentDsl).replace(
      narration,
      `<p id="page-narration">${narration}</p>`,
    );
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: htmlWithNarrationId,
      visualBrief,
      assets: [],
      attemptCount: 0,
      report: qualityReportWithIssue({
        code: "NARRATION_EMPHASIS",
        dimension: "layoutQuality",
        selector: "#page-narration",
      }),
    });
    if ("status" in request) throw new Error(request.message);

    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["错误地修改页面标题。"],
        patches: [
          {
            issueCode: "NARRATION_EMPHASIS",
            search: `<h1>${pageContentDsl.title}</h1>`,
            replacement: `<h1><strong>${pageContentDsl.title}</strong></h1>`,
            summary: "修改旁白容器之外的标题。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-id-outside-text",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("超出允许 selector scope");
  });

  it("rejects a boundary insertion outside the authorized selector scope", async () => {
    const request = htmlRequest();
    const state = await createRepairModelStep({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "html_patch_candidate",
        pageId: request.pageId,
        targetArtifact: "html",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["错误地插入页面结构。"],
        patches: [
          {
            issueCode: request.issueCodes[0],
            operation: "insert_after_open_tag",
            selector: "body",
            replacement: "<aside>未授权内容</aside>",
            summary: "修改 body。",
          },
        ],
      }),
    }).run(createRepairModelStepState(request), {
      traceId: "trace-repair-boundary-scope",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("超出允许 selector scope");
  });
});
