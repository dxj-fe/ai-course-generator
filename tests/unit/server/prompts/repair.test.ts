import { describe, expect, it } from "vitest";

import { buildRepairPrompts } from "../../../../src/server/prompts/repair";

describe("Repair prompts", () => {
  it("uses the active bounded and report-only Repair contract", async () => {
    const prompts = await buildRepairPrompts({ pageId: "page-02" });

    expect(prompts.version).toBe("1.0.1/1.0.0");
    expect(prompts.systemPrompt).toContain("最多两轮");
    expect(prompts.systemPrompt).toContain("禁止返回完整重写文档");
    expect(prompts.systemPrompt).toContain("insert_after_open_tag");
    expect(prompts.systemPrompt).toContain("缺少 main");
    expect(prompts.systemPrompt).toContain("Repair 不能决定最终质量状态");
    expect(prompts.userPrompt).toContain('"pageId":"page-02"');
  });
});
