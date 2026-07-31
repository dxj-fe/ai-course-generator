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
  PedagogyModelOutputSchema,
} from "../../../../src/server/agent/plugins/model-steps/course/pedagogy-model-step";
import {
  createStoryModelStep,
  createStoryModelStepState,
  StoryModelOutputSchema,
} from "../../../../src/server/agent/plugins/model-steps/course/story-model-step";
import {
  createVisualBriefModelStep,
  createVisualBriefModelStepState,
  VisualModelOutputSchema,
} from "../../../../src/server/agent/plugins/model-steps/course/visual-brief-model-step";

function omitKey<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const { [key]: omitted, ...rest } = value;
  void omitted;
  return rest;
}

describe("course design model steps", () => {
  it("只接受当前课程设计模型合同", () => {
    const pedagogyOutput = {
      ...pedagogyPlan,
      pageGuidance: pedagogyPlan.pageGuidance.map((guidance) =>
        omitKey(guidance, "pageId"),
      ),
    };
    const storyOutput = {
      ...storyArc,
      pageBeats: storyArc.pageBeats.map((beat) => omitKey(beat, "pageId")),
    };
    const visualOutputWithPageIds = omitKey(visualBrief, "styleTemplateId");
    const visualOutput = {
      ...visualOutputWithPageIds,
      pageGuidance: visualOutputWithPageIds.pageGuidance.map((guidance) =>
        omitKey(guidance, "pageId"),
      ),
    };

    expect(PedagogyModelOutputSchema.safeParse(pedagogyOutput).success).toBe(
      true,
    );
    expect(
      PedagogyModelOutputSchema.safeParse({
        ...pedagogyOutput,
        misconceptions: ["所有星星都是行星。"],
      }).success,
    ).toBe(false);
    expect(
      PedagogyModelOutputSchema.safeParse({
        ...pedagogyOutput,
        learningProgression: ["只提供一个步骤。"],
      }).success,
    ).toBe(false);

    expect(StoryModelOutputSchema.safeParse(storyOutput).success).toBe(true);
    expect(
      StoryModelOutputSchema.safeParse({
        ...storyOutput,
        characters: ["星星助手"],
      }).success,
    ).toBe(false);
    const storyWithoutMission = omitKey(storyOutput, "mission");
    expect(StoryModelOutputSchema.safeParse(storyWithoutMission).success).toBe(
      false,
    );

    expect(VisualModelOutputSchema.safeParse(visualOutput).success).toBe(true);
    expect(
      VisualModelOutputSchema.safeParse({
        ...visualOutput,
        layoutPrinciples: ["只提供一条原则。"],
      }).success,
    ).toBe(false);
  });

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
});
