import { describe, expect, it, vi } from "vitest";

import { aiResultCache } from "../../../../src/server/infra/ai/result-cache";
import type { ReferencePack } from "../../../../src/shared/course-schema";
import {
  retrieveReferenceHits,
  retrieveTemplateCards,
} from "../../../../src/server/agent/plugins/tools/course/retrieval";

const solarPack: ReferencePack = {
  id: "ref-1234567890abcdef12345678",
  sourceName: "solar.md",
  sourceType: "md",
  byteSize: 120,
  summary: "太阳风会影响地球磁层。",
  keyFacts: [
    { text: "太阳风由带电粒子组成。", chunkIds: ["chunk-01"] },
  ],
  chunks: [
    {
      id: "chunk-01",
      index: 1,
      text: "太阳风由带电粒子组成。RAW_REFERENCE_SENTINEL",
    },
    { id: "chunk-02", index: 2, text: "无关的附录说明。" },
  ],
  truncated: false,
};

describe("course architecture retrieval", () => {
  it("returns bounded functional and style Template Cards", () => {
    const result = retrieveTemplateCards({
      pageGoal: "用互动问答检查儿童学习结果",
      audience: "8 岁儿童",
      visualStyle: "kids-playful",
      limit: 1,
    });

    expect(result.functional).toHaveLength(1);
    expect(result.functional[0]?.card.id).toBe("interactive-quiz");
    expect(result.style).toHaveLength(1);
    expect(result.style[0]?.card.visualStyle).toBe("kids-playful");
    expect(result.functional[0]?.card).not.toHaveProperty("slots");
    expect(result.style[0]?.card).not.toHaveProperty("colorTokens");
  });

  it("一次覆盖整课不同页面职责，不要求 Architect 为每页重复调用工具", () => {
    const result = retrieveTemplateCards({
      pageNeeds: [
        { goal: "解释三个核心概念", pageType: "knowledge_card" },
        { goal: "比较两种方法的异同", pageType: "comparison" },
        { goal: "让学习者完成选择题并获得反馈", pageType: "quiz" },
      ],
      audience: "大学新生",
      visualStyle: "minimal",
    });

    expect(result.functional.map(({ card }) => card.id)).toEqual(
      expect.arrayContaining([
        "knowledge-card-grid",
        "comparison-board",
        "interactive-quiz",
      ]),
    );
    expect(result.functional).toHaveLength(3);
    expect(result.style[0]?.card.visualStyle).toBe("minimal");
  });

  it("reuses a validated Template Card search result", () => {
    aiResultCache.clear();
    const lookup = vi.spyOn(aiResultCache, "lookup");
    const input = {
      pageGoal: "用时间线比较月相变化",
      audience: "初中生",
      visualStyle: "minimal" as const,
      limit: 2,
    };

    const first = retrieveTemplateCards(input);
    const second = retrieveTemplateCards(input);

    expect(second).toEqual(first);
    expect(lookup.mock.results[0]?.value).toEqual({ status: "miss" });
    expect(lookup.mock.results[1]?.value).toMatchObject({ status: "hit" });
    lookup.mockRestore();
  });

  it("返回可追溯且受长度限制的命中原文，不混入未命中的 chunk", () => {
    const result = retrieveReferenceHits(
      { query: "太阳风 带电粒子", limit: 2 },
      [solarPack],
    );

    expect(result.hits).toEqual([
      expect.objectContaining({
        referencePackId: solarPack.id,
        chunkIds: ["chunk-01"],
        excerpts: [
          expect.objectContaining({
            chunkId: "chunk-01",
            truncated: false,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(result)).toContain("RAW_REFERENCE_SENTINEL");
    expect(JSON.stringify(result)).not.toContain("无关的附录说明");
    expect(
      retrieveReferenceHits(
        { query: "不存在的主题", limit: 1 },
        [solarPack],
      ),
    ).toEqual({ hits: [] });
  });
});
