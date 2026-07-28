import { describe, expect, it } from "vitest";

import { buildIntentPrompts } from "../../../../src/server/prompts/intent";

describe("Intent prompts", () => {
  it("budgets automatic course length for fixed, non-scrolling canvases", async () => {
    const prompts = await buildIntentPrompts("为初学者生成一门太阳系互动课");

    expect(prompts.version).toBe("1.3.0/1.0.0");
    expect(prompts.systemPrompt).toContain(
      "每一节对应一个无需滚动的固定课程画布",
    );
    expect(prompts.systemPrompt).toContain(
      "单页放不下时预先增加章节并拆分内容",
    );
    expect(prompts.userPrompt).toContain(
      JSON.stringify("为初学者生成一门太阳系互动课"),
    );
  });
});
