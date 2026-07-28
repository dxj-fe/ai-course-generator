import { describe, expect, it } from "vitest";

import { buildCoursePlannerPrompts } from "../../../../src/server/prompts/course-planner";

describe("Course Planner prompts", () => {
  it("splits content before page generation to keep every canvas fixed", async () => {
    const prompts = await buildCoursePlannerPrompts({
      courseIntent: { topic: "太阳系", courseLength: 7 },
      allowedFunctionalTemplates: [
        { id: "knowledge-card-grid", pageType: "knowledge_card" },
      ],
      templateCards: [],
      styleTemplateCard: { id: "kids-playful" },
      referenceHits: [],
    });

    expect(prompts.version).toBe("2.4.0/2.2.0");
    expect(prompts.systemPrompt).toContain(
      "每个 pages item 对应一个无需滚动的固定课程画布",
    );
    expect(prompts.systemPrompt).toContain(
      "必须拆到相邻页面",
    );
    expect(prompts.systemPrompt).toContain(
      "单个固定画布完整承载",
    );
  });
});
