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
    expect(result.style[0]).toMatchObject({
      candidateRole: "best-match",
      score: expect.any(Number),
      confidence: expect.any(Number),
      scoreBreakdown: expect.any(Array),
    });
    expect(result.functional[0]?.card).not.toHaveProperty("slots");
    expect(result.style[0]?.card).not.toHaveProperty("colorTokens");
  });

  it("keeps alternatives when the best match is only narrowly ahead", () => {
    const result = retrieveTemplateCards(
      {
        pageNeeds: [
          {
            goal: "用可观察的光路和波长关系解释瑞利散射，帮助学习者理解天空呈蓝色的原因",
            pageType: "knowledge_card",
          },
          {
            goal: "通过一道选择题检验学习者对太阳高度与光程关系的理解，应用瑞利散射原理解释日落呈红色的原因",
            pageType: "quiz",
          },
        ],
        audience: "初中生",
        limit: 3,
      },
      {
        originalRequest:
          "为初中生生成2页互动微课，主题是“天空为什么是蓝的，日落为什么是红的”。第1页用可观察的光路和波长关系解释瑞利散射；第2页用一道选择题检验太阳高度与光程的关系。不要使用与知识关系无关的装饰，精确关系用 HTML/CSS/SVG 表达。",
        topic: "天空为什么是蓝的，日落为什么是红的",
        learningMode: "practice",
      },
    );

    expect(result.style).toHaveLength(3);
    expect(result.style[0]).toMatchObject({
      card: { id: "minimal" },
      candidateRole: "best-match",
      confidence: expect.any(Number),
    });
    expect(result.style[0]?.confidence).toBeLessThan(0.6);
    expect(
      result.style
        .find(({ card }) => card.id === "nature")
        ?.scoreBreakdown?.some(
          ({ key, label }) =>
            (key === "keyword" || key === "tone") &&
            label.includes("观察"),
        ) ?? false,
    ).toBe(false);
    expect(
      result.style.find(({ card }) => card.id === "nature")?.card
        .limitations,
    ).toContain("精密物理光路与几何推导");
  });

  it("不把 Architect 自行填写的视觉风格当成用户显式指定", () => {
    const originalRequest =
      "为初中生生成2页互动微课，主题是“天空为什么是蓝的，日落为什么是红的”。第1页用可观察的光路和波长关系解释瑞利散射；第2页用一道选择题检验太阳高度与光程的关系。不要使用与知识关系无关的装饰，精确关系用 HTML/CSS/SVG 表达。";
    const result = retrieveTemplateCards(
      {
        pageNeeds: [
          {
            goal: "用可观察的光路和波长关系解释瑞利散射",
            pageType: "knowledge_card",
          },
          {
            goal: "用选择题检验太阳高度与大气路径的关系",
            pageType: "quiz",
          },
        ],
        audience: "初中生",
        visualStyle: "nature",
        limit: 3,
      },
      {
        originalRequest,
        topic: "天空为什么是蓝的，日落为什么是红的",
        learningMode: "practice",
      },
    );

    expect(result.style[0]?.card.id).toBe("minimal");
    expect(result.style).toHaveLength(3);
    expect(result.style.map(({ card }) => card.id)).toContain("nature");
  });

  it("保留用户真正点名的自然观察风格", () => {
    const result = retrieveTemplateCards(
      {
        pageGoal: "解释植物生长",
        audience: "初中生",
        visualStyle: "nature",
        limit: 3,
      },
      {
        originalRequest: "请用自然观察风格解释植物如何生长。",
        topic: "植物生长",
        learningMode: "guided",
      },
    );

    expect(result.style).toHaveLength(1);
    expect(result.style[0]?.card.id).toBe("nature");
  });

  it("only exposes an explicit high-confidence standard best match", () => {
    const result = retrieveTemplateCards({
      pageGoal: "用观察与练习解释植物如何生长",
      audience: "初中生",
      visualStyle: "nature",
      limit: 3,
    });

    expect(result.style).toHaveLength(1);
    expect(result.style[0]).toMatchObject({
      card: { id: "nature" },
      candidateRole: "best-match",
      confidence: 1,
    });
  });

  it("keeps alternatives for a low-confidence style match", () => {
    const result = retrieveTemplateCards({
      pageGoal: "面向成人讲解一个尚未收录关键词的主题",
      audience: "成人",
      limit: 3,
    });

    expect(result.style[0]?.confidence).toBeLessThan(0.6);
    expect(result.style.map(({ candidateRole }) => candidateRole)).toEqual([
      "best-match",
      "safe",
      "explore",
    ]);
  });

  it("keeps risk-compatible alternatives in a care context", () => {
    const result = retrieveTemplateCards({
      pageGoal: "讲解患者健康与营养，并安排观察练习",
      audience: "护理人员",
      visualStyle: "minimal",
      limit: 3,
    });

    expect(result.style[0]?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.style.map(({ candidateRole }) => candidateRole)).toEqual([
      "best-match",
      "safe",
      "explore",
    ]);
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
