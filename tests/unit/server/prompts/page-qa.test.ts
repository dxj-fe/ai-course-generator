import { describe, expect, it } from "vitest";

import { buildPageQAPrompts } from "../../../../src/server/prompts/page-qa";

describe("Page QA prompts", () => {
  it("keeps QA report-only and renders the structured input", async () => {
    const prompts = await buildPageQAPrompts({ pageId: "page-02" });

    expect(prompts.version).toBe("2.1.2/2.1.0");
    expect(prompts.systemPrompt).toContain("不负责修改 HTML");
    expect(prompts.systemPrompt).toContain("contentAccuracy");
    expect(prompts.systemPrompt).toContain("Playwright 浏览器证据");
    expect(prompts.systemPrompt).toContain("低优先级高分不能抵消");
    expect(prompts.systemPrompt).toContain("severity 只能是");
    expect(prompts.systemPrompt).toContain("description");
    expect(prompts.systemPrompt).toContain("feedback.success");
    expect(prompts.systemPrompt).toContain("readingOrder 只比较");
    expect(prompts.userPrompt).toContain('"pageId":"page-02"');
  });
});
