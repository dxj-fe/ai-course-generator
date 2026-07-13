import { describe, expect, it, vi } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import {
  createPageWriterAgent,
  createPageWriterAgentState,
  validatePageWriterOutput,
} from "../../../../src/server/agents/page-writer-agent";
import type { PageWorkerBrief } from "../../../../src/shared/course-schema";

const page = courseDesignOutline.pages[1];
const brief: PageWorkerBrief = {
  pageId: page.id,
  styleTemplateId: visualBrief.styleTemplateId,
  pedagogy: pedagogyPlan.pageGuidance[1],
  story: storyArc.pageBeats[1],
  visual: visualBrief.pageGuidance[1],
};
const input = { intent: courseDesignIntent, page, brief };

describe("PageWriterAgent", () => {
  it("generates one PageContentDSL in one bounded step", async () => {
    const generateContent = vi.fn().mockResolvedValue(pageContentDsl);
    const result = await createPageWriterAgent({ generateContent }).run(
      createPageWriterAgentState(input),
      { traceId: "page-writer-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.content).toEqual(pageContentDsl);
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "finish",
    ]);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ page, brief }),
    );
  });

  it("rejects a DSL whose pageId differs from PagePlan", () => {
    expect(() =>
      validatePageWriterOutput(
        { ...pageContentDsl, pageId: "invented-page" },
        input,
      ),
    ).toThrow("DSL pageId 必须是");
  });

  it("rejects content outside FunctionalTemplate slot bounds", () => {
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          blocks: [],
          layoutHints: { ...pageContentDsl.layoutHints, readingOrder: [] },
        },
        input,
      ),
    ).toThrow("blocks 数量 0 不在模板范围 2-6");
  });

  it("rejects a PageWorkerBrief whose nested IDs drift", () => {
    expect(() =>
      validatePageWriterOutput(pageContentDsl, {
        ...input,
        brief: {
          ...brief,
          story: { ...brief.story, pageId: "another-page" },
        },
      }),
    ).toThrow("PageWorkerBrief 必须完整引用当前 pageId");
  });
});
