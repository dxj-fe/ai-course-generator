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
  materializeInteractionItems,
  normalizePageContentDensity,
  normalizePageNavigationDestination,
  validatePageWriterOutput,
} from "../../../../src/server/agents/page-writer-agent";
import type {
  PageWorkerBrief,
  ReferencePack,
} from "../../../../src/shared/course-schema";

const page = courseDesignOutline.pages[1];
const brief: PageWorkerBrief = {
  pageId: page.id,
  styleTemplateId: visualBrief.styleTemplateId,
  pedagogy: pedagogyPlan.pageGuidance[1],
  story: storyArc.pageBeats[1],
  visual: visualBrief.pageGuidance[1],
};
const input = { intent: courseDesignIntent, page, brief };
const referencePack: ReferencePack = {
  version: 1,
  id: "ref-1234567890abcdef12345678",
  sourceName: "solar.txt",
  sourceType: "txt",
  byteSize: 80,
  summary: "太阳风资料。",
  keyFacts: [{ text: "太阳风包含带电粒子。", chunkIds: ["chunk-01"] }],
  chunks: [{ id: "chunk-01", index: 1, text: "太阳风包含带电粒子。" }],
  truncated: false,
};

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

  it("accepts only PagePlan-authorized Reference chunks", () => {
    const referencedPage = {
      ...page,
      usedReferences: [
        { referencePackId: referencePack.id, chunkIds: ["chunk-01"] },
      ],
    };
    const referencedInput = {
      ...input,
      page: referencedPage,
      referencePacks: [referencePack],
    };

    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          usedReferences: referencedPage.usedReferences,
        },
        referencedInput,
      ),
    ).not.toThrow();
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          usedReferences: [
            { referencePackId: referencePack.id, chunkIds: ["chunk-02"] },
          ],
        },
        referencedInput,
      ),
    ).toThrow("Page Writer 的资料引用必须是 PagePlan 引用的子集");
  });

  it.each([
    ["low", "cover", "sparse"],
    ["medium", "knowledge_card", "balanced"],
    ["平衡", "knowledge_card", "balanced"],
    ["comfortable", "story_intro", "balanced"],
    ["spacious", "cover", "sparse"],
    ["high", "knowledge_card", "dense"],
    ["紧凑", "knowledge_card", "dense"],
    ["Medium_Density", "knowledge_card", "balanced"],
  ] as const)(
    "normalizes model density alias %s for %s to %s",
    (modelValue, pageType, expected) => {
      expect(normalizePageContentDensity(modelValue, pageType)).toBe(expected);
    },
  );

  it("uses a template-safe density when the model returns an unknown label", () => {
    expect(normalizePageContentDensity("concise", "cover")).toBe("sparse");
    expect(normalizePageContentDensity("regular", "story_intro")).toBe(
      "balanced",
    );
  });

  it("uses concise interaction content as the learner-facing item label", () => {
    expect(materializeInteractionItems(["增函数", "减函数"])).toEqual([
      { id: "item-01", label: "增函数", content: "增函数" },
      { id: "item-02", label: "减函数", content: "减函数" },
    ]);
  });

  it.each([
    ["next", "next"],
    ["nextPage", "next"],
    ["previous-page", "previous"],
    ["home", "course-home"],
    ["unused choice placeholder", "next"],
  ] as const)(
    "normalizes model navigation placeholder %s to %s",
    (modelValue, expected) => {
      expect(normalizePageNavigationDestination(modelValue)).toBe(expected);
    },
  );
});
