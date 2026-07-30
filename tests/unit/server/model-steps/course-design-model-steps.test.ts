import { describe, expect, it, vi } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import {
  createPedagogyModelStep,
  createPedagogyModelStepState,
  normalizePedagogyModelOutput,
} from "../../../../src/server/agent/plugins/model-steps/course/pedagogy-model-step";
import {
  createStoryModelStep,
  createStoryModelStepState,
  normalizeStoryCharacters,
  normalizeStoryModelOutput,
} from "../../../../src/server/agent/plugins/model-steps/course/story-model-step";
import {
  createVisualBriefModelStep,
  createVisualBriefModelStepState,
  normalizeVisualLayoutPrinciples,
} from "../../../../src/server/agent/plugins/model-steps/course/visual-brief-model-step";

describe("course design model steps", () => {
  it("generates a PedagogyPlan in one bounded step", async () => {
    const generatePlan = vi.fn().mockResolvedValue(pedagogyPlan);
    const result = await createPedagogyModelStep({ generatePlan }).run(
      createPedagogyModelStepState(courseDesignIntent, courseDesignOutline),
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

  it("completes one valid learning progression from the trusted course order", () => {
    const normalized = normalizePedagogyModelOutput(
      { learningProgression: ["先理解太阳系的基本组成。"] },
      courseDesignOutline,
    );

    expect(normalized).toMatchObject({
      learningProgression: [
        "先理解太阳系的基本组成。",
        expect.stringContaining("太阳系探索启程"),
      ],
    });
    expect(
      (normalized as { learningProgression: string[] }).learningProgression[1],
    ).toContain("太阳系探索总结");
  });

  it("keeps an empty learning progression invalid", () => {
    const output = { learningProgression: [] };

    expect(normalizePedagogyModelOutput(output, courseDesignOutline)).toBe(
      output,
    );
  });

  it("passes validated pedagogy into StoryModelStep", async () => {
    const generateArc = vi.fn().mockResolvedValue(storyArc);
    const result = await createStoryModelStep({ generateArc }).run(
      createStoryModelStepState({
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

  it("completes a missing story mission from the trusted course order", () => {
    const normalized = normalizeStoryModelOutput(
      {
        premise: "学习者通过连续观察任务理解太阳系。",
        learnerRole: "观察者",
      },
      courseDesignOutline,
    );

    expect(normalized).toMatchObject({
      mission: expect.stringContaining("太阳系探索启程"),
    });
    expect((normalized as { mission: string }).mission).toContain(
      "太阳系探索总结",
    );
  });

  it("keeps an explicitly empty story mission invalid", () => {
    const output = {
      premise: "学习者通过连续观察任务理解太阳系。",
      learnerRole: "观察者",
      mission: "",
    };

    expect(normalizeStoryModelOutput(output, courseDesignOutline)).toBe(output);
  });

  it("produces a VisualBrief that references a StyleTemplate", async () => {
    const generateBrief = vi.fn().mockResolvedValue(visualBrief);
    const result = await createVisualBriefModelStep({ generateBrief }).run(
      createVisualBriefModelStepState({
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
