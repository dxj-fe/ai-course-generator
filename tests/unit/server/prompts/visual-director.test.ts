import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
} from "../../../fixtures/course-design";
import { buildVisualDirectorPrompts } from "../../../../src/server/prompts/visual-director";

describe("Visual Director prompts", () => {
  it("states array cardinalities and the exact page guidance count", async () => {
    const prompts = await buildVisualDirectorPrompts({
      courseIntent: courseDesignIntent,
      coursePlan: courseDesignOutline,
      pageCount: courseDesignOutline.pages.length,
      pedagogyPlan,
      storyArc,
      styleTemplate: { id: "sci-fi" },
    });

    expect(prompts.version).toBe("2.0.0/2.0.0");
    expect(prompts.systemPrompt).toContain("layoutPrinciples 必须包含 2–10 条");
    expect(prompts.systemPrompt).toContain("accessibilityRules 必须包含 2–12 条");
    expect(prompts.userPrompt).toContain("pageGuidance 必须恰好输出 3 项");
  });
});
