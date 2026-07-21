import { describe, expect, it, vi } from "vitest";

import {
  createRepairAgent,
  createRepairAgentState,
  normalizeRepairModelOutput,
} from "../../../../src/server/agents/repair-agent";
import { planRepairRound } from "../../../../src/server/workflows/qa-repair-loop";
import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../../fixtures/quality-report";

function htmlRequest() {
  const request = planRepairRound({
    pageId: pageContentDsl.pageId,
    content: pageContentDsl,
    html: buildValidGeneratedHtml(pageContentDsl),
    visualBrief,
    assets: [],
    completedRounds: 0,
    report: qualityReportWithIssue({
      code: "LAYOUT_OVERFLOW",
      dimension: "layoutQuality",
      selector: "style",
    }),
  });
  if ("status" in request) throw new Error(request.message);
  return request;
}

describe("RepairAgent", () => {
  it("normalizes a provider scalar change summary into the required array", () => {
    expect(
      normalizeRepairModelOutput({
        kind: "html_patch_candidate",
        changeSummary: "使用 main 包裹页面主体。",
      }),
    ).toEqual({
      kind: "html_patch_candidate",
      changeSummary: ["使用 main 包裹页面主体。"],
    });
  });

  it("applies one exact HTML patch and preserves the original HTML contract", async () => {
    const request = htmlRequest();
    const state = await createRepairAgent({
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
    }).run(createRepairAgentState(request), { traceId: "trace-repair-html" });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain("max-width: 100%");
    expect(state.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "validation",
      "finish",
    ]);
  });

  it("applies a candidate when the provider returns changeSummary as a string", async () => {
    const request = htmlRequest();
    const state = await createRepairAgent({
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
    }).run(createRepairAgentState(request), {
      traceId: "trace-repair-scalar-summary",
    });

    expect(state.status).toBe("completed");
    expect(state.result).toMatchObject({ changeSummary: ["限制页面宽度。"] });
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
      completedRounds: 0,
      report: qualityReportWithIssue({
        code: "HTML_MAIN_MISSING",
        dimension: "htmlRuntime",
        selector: "body",
      }),
    });
    if ("status" in request) throw new Error(request.message);

    const state = await createRepairAgent({
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
    }).run(createRepairAgentState(request), {
      traceId: "trace-repair-missing-main",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(
      `<main data-page-id="${pageContentDsl.pageId}">`,
    );
    expect(state.repairedHtml).toMatch(/<body>\s*<main[\s\S]*<\/main>\s*<\/body>/);
  });

  it("rejects changes to DSL blocks outside the authorized issue location", async () => {
    const request = planRepairRound({
      pageId: pageContentDsl.pageId,
      content: pageContentDsl,
      html: buildValidGeneratedHtml(pageContentDsl),
      visualBrief,
      assets: [],
      completedRounds: 0,
      report: qualityReportWithIssue({
        code: "CONTENT_FACT",
        dimension: "contentAccuracy",
        blockId: "block-01",
      }),
    });
    if ("status" in request) throw new Error(request.message);
    const candidate = structuredClone(pageContentDsl);
    candidate.blocks[1]!.body = "未授权修改。";
    const state = await createRepairAgent({
      generateCandidate: vi.fn().mockResolvedValue({
        kind: "dsl_candidate",
        pageId: request.pageId,
        targetArtifact: "dsl",
        addressedIssueCodes: request.issueCodes,
        unresolvedIssueCodes: [],
        changeSummary: ["修改事实。"],
        candidate,
      }),
    }).run(createRepairAgentState(request), { traceId: "trace-repair-scope" });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("未授权 block block-02");
  });

  it("rejects an HTML patch outside the authorized selector scope", async () => {
    const request = htmlRequest();
    const state = await createRepairAgent({
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
    }).run(createRepairAgentState(request), { traceId: "trace-repair-selector" });

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
      completedRounds: 0,
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
    const state = await createRepairAgent({
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
    }).run(createRepairAgentState(requestWithInteraction), {
      traceId: "trace-repair-descendant-selector",
    });

    expect(state.status).toBe("completed");
    expect(state.repairedHtml).toContain(">增函数</button>");
  });

  it("rejects a boundary insertion outside the authorized selector scope", async () => {
    const request = htmlRequest();
    const state = await createRepairAgent({
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
    }).run(createRepairAgentState(request), {
      traceId: "trace-repair-boundary-scope",
    });

    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("超出允许 selector scope");
  });
});
