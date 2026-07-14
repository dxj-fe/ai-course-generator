import { describe, expect, it, vi } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import {
  createPedagogyAgent,
  createPedagogyAgentState,
} from "../../../../src/server/agents/pedagogy-agent";
import {
  createStoryAgent,
  createStoryAgentState,
  normalizeStoryCharacters,
} from "../../../../src/server/agents/story-agent";
import {
  createVisualDirectorAgent,
  createVisualDirectorAgentState,
  normalizeVisualLayoutPrinciples,
} from "../../../../src/server/agents/visual-director-agent";

describe("Day 11 professional agents", () => {
  it("generates a PedagogyPlan in one bounded step", async () => {
    const generatePlan = vi.fn().mockResolvedValue(pedagogyPlan);
    const result = await createPedagogyAgent({ generatePlan }).run(
      createPedagogyAgentState(courseDesignIntent, courseDesignOutline),
      { traceId: "pedagogy-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.plan).toEqual(pedagogyPlan);
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "finish",
    ]);
  });

  it("passes validated pedagogy into StoryAgent", async () => {
    const generateArc = vi.fn().mockResolvedValue(storyArc);
    const result = await createStoryAgent({ generateArc }).run(
      createStoryAgentState({
        intent: courseDesignIntent,
        outline: courseDesignOutline,
        pedagogy: pedagogyPlan,
      }),
      { traceId: "story-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.arc).toEqual(storyArc);
    expect(generateArc).toHaveBeenCalledWith(
      expect.objectContaining({ pedagogy: pedagogyPlan }),
    );
  });

  it("drops model-invented characters when narrative mode is none", () => {
    expect(
      normalizeStoryCharacters("none", [
        { name: "虚构导师", role: "推动故事情节" },
      ]),
    ).toEqual([]);
  });

  it("produces a VisualBrief that references a StyleTemplate", async () => {
    const generateBrief = vi.fn().mockResolvedValue(visualBrief);
    const result = await createVisualDirectorAgent({ generateBrief }).run(
      createVisualDirectorAgentState({
        intent: courseDesignIntent,
        outline: courseDesignOutline,
        pedagogy: pedagogyPlan,
        story: storyArc,
      }),
      { traceId: "visual-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.brief?.styleTemplateId).toBe("sci-fi");
    expect(result.brief?.pageGuidance).toHaveLength(3);
  });

  it("completes a single model layout principle before domain validation", () => {
    const principles = normalizeVisualLayoutPrinciples([
      "核心学习内容优先于装饰元素。",
    ]);

    expect(principles).toHaveLength(3);
    expect(new Set(principles).size).toBe(3);
    expect(principles[0]).toBe("核心学习内容优先于装饰元素。");
    expect(principles).toContain(
      "跨页保持一致的内容网格、间距层级与清晰阅读顺序。",
    );
    expect(principles).toContain(
      "核心学习内容和交互区域始终优先于装饰元素。",
    );
  });

  it("preserves two valid model layout principles", () => {
    const principles = ["规则一保持稳定。", "规则二保持清晰。"];

    expect(normalizeVisualLayoutPrinciples(principles)).toEqual(principles);
  });

  it("does not invent a visual brief when the model returns no principle", () => {
    expect(() => normalizeVisualLayoutPrinciples([])).toThrow(
      "至少包含一条布局原则",
    );
  });
});
