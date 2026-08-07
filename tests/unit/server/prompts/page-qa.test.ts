import { describe, expect, it } from "vitest";

import { buildPageQAPrompts } from "../../../../src/server/agent/plugins/prompts/course/model-steps/page-qa";

describe("Page QA prompts", () => {
  it("keeps QA report-only and renders the structured input", async () => {
    const prompts = await buildPageQAPrompts({ pageId: "page-02" });

    expect(prompts.fingerprint).toMatch(/^[a-f0-9]{64}$/);
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
    expect(prompts.systemPrompt).toContain(
      "courseContext.facts 与 courseContext.terms 是本页可信事实边界",
    );
    expect(prompts.systemPrompt).toContain("styleConsistency 82");
    expect(prompts.systemPrompt).toContain(
      "任何文档纵向或横向溢出、根页面滚动、嵌套正文滚动",
    );
    expect(prompts.systemPrompt).toContain("VISUAL_GENERIC_UI");
    expect(prompts.systemPrompt).toContain("VISUAL_NO_FOCAL_POINT");
    expect(prompts.systemPrompt).toContain("不得仅凭分数或风格喜好");
    expect(prompts.userPrompt).toContain('"pageId":"page-02"');
  });
});
