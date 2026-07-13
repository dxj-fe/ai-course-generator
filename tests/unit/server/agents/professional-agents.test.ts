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
} from "../../../../src/server/agents/story-agent";
import {
  createVisualDirectorAgent,
  createVisualDirectorAgentState,
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
});
