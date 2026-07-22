import { describe, expect, it } from "vitest";

import type { ReferencePack } from "../../../../src/shared/course-schema";
import { createAgentRetrievalTools } from "../../../../src/server/tools/agent-retrieval-tools";
import { SkillRegistry } from "../../../../src/server/tools/skill-registry";
import {
  createRetrieveReferenceSkill,
  retrieveReferenceHits,
  retrieveSkillCards,
  retrieveSkillDocsSkill,
  retrieveTemplateCards,
} from "../../../../src/server/tools/retrieval-skills";

const solarPack: ReferencePack = {
  version: 1,
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

describe("Day 33 retrieval skills", () => {
  it("exposes all three retrieval skills as scoped AI SDK tools", () => {
    expect(
      Object.keys(createAgentRetrievalTools("retrieval-tools", [solarPack])),
    ).toEqual([
      "retrieveSkillDocsSkill",
      "retrieveTemplateCardsSkill",
      "retrieveReferenceSkill",
    ]);
  });

  it("retrieves only skills registered for the requested Agent", async () => {
    const direct = retrieveSkillCards({
      agentName: "planner",
      task: "规划课程模板和资料引用",
      limit: 3,
    });

    expect(direct.matches.map(({ card }) => card.id)).toEqual(["plan-course"]);
    const registry = new SkillRegistry(() => {}).register(
      retrieveSkillDocsSkill,
    );
    await expect(
      registry.execute(
        retrieveSkillDocsSkill.name,
        { agentName: "planner", task: "规划课程", limit: 1 },
        { traceId: "retrieve-skill-docs" },
      ),
    ).resolves.toMatchObject({
      matches: [{ card: { id: "plan-course" } }],
    });
  });

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

  it("returns traceable Reference Hits without raw chunk text", async () => {
    const result = retrieveReferenceHits(
      { query: "太阳风 带电粒子", limit: 2 },
      [solarPack],
    );

    expect(result.hits).toEqual([
      expect.objectContaining({
        referencePackId: solarPack.id,
        chunkIds: ["chunk-01"],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("RAW_REFERENCE_SENTINEL");

    const registry = new SkillRegistry(() => {}).register(
      createRetrieveReferenceSkill([solarPack]),
    );
    await expect(
      registry.execute(
        "retrieveReferenceSkill",
        { query: "不存在的主题", limit: 1 },
        { traceId: "retrieve-reference" },
      ),
    ).resolves.toEqual({ hits: [] });
  });
});
