import { describe, expect, it } from "vitest";

import { buildPageQAPrompts } from "../../../../src/server/prompts/page-qa";

describe("Page QA prompts", () => {
  it("keeps QA report-only and renders the structured input", async () => {
    const prompts = await buildPageQAPrompts({ pageId: "page-02" });

    expect(prompts.version).toBe("2.3.1/2.1.0");
    expect(prompts.systemPrompt).toContain("不负责修改 HTML");
    expect(prompts.systemPrompt).toContain("contentAccuracy");
    expect(prompts.systemPrompt).toContain("Playwright 浏览器证据");
    expect(prompts.systemPrompt).toContain("低优先级高分不能抵消");
    expect(prompts.systemPrompt).toContain("severity 只能是");
    expect(prompts.systemPrompt).toContain("description");
    expect(prompts.systemPrompt).toContain("禁止输出复数键 viewports");
    expect(prompts.systemPrompt).toContain("choice 反馈必须初始隐藏");
    expect(prompts.systemPrompt).toContain("不得要求整个互动项初始隐藏");
    expect(prompts.systemPrompt).toContain("readingOrder 只比较");
    expect(prompts.systemPrompt).toContain("不构成内容冗余");
    expect(prompts.systemPrompt).toContain("styleConsistency 82");
    expect(prompts.systemPrompt).toContain(
      "文档纵向溢出、根页面滚动、嵌套正文滚动",
    );
    expect(prompts.userPrompt).toContain('"pageId":"page-02"');
  });
});
