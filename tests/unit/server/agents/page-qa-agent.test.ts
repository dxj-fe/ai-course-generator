import { describe, expect, it, vi } from "vitest";

import {
  createPageQAAgent,
  createPageQAAgentState,
  validatePageQAInput,
} from "../../../../src/server/agents/page-qa-agent";
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
    const state = await createPageQAAgent({ evaluate }).run(
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
    const state = await createPageQAAgent({
      evaluate: vi.fn().mockResolvedValue(modelOutput),
    }).run(createPageQAAgentState(input), { traceId: "trace-unsafe-qa" });

    expect(state.report?.shouldRepair).toBe(true);
    expect(state.report?.decision).toBe("fail");
    expect(state.report?.issues.some(({ code }) => code === "HTML_SAFETY_INLINE_SCRIPT")).toBe(true);
  });

  it("accepts a model location pageId but replaces it with the current page", async () => {
    const state = await createPageQAAgent({
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

  it("keeps browser evidence in the report and does not block on capture failure", async () => {
    const failedEvidence = {
      status: "failed" as const,
      viewport: { width: 1440, height: 900 },
      reason: "截图 QA 超时。",
    };
    const state = await createPageQAAgent({
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
    expect(state.report?.decision).toBe("pass");
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
