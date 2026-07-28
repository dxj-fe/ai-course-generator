import { describe, expect, it } from "vitest";

import { buildRepairPrompts } from "../../../../src/server/prompts/repair";

describe("Repair prompts", () => {
  it("uses the active bounded and report-only Repair contract", async () => {
    const prompts = await buildRepairPrompts({ pageId: "page-02" });

    expect(prompts.version).toBe("1.6.0/1.0.1");
    expect(prompts.systemPrompt).toContain("安全熔断");
    expect(prompts.systemPrompt).not.toContain("最多两轮");
    expect(prompts.systemPrompt).toContain("禁止返回完整重写文档");
    expect(prompts.systemPrompt).toContain("insert_after_open_tag");
    expect(prompts.systemPrompt).toContain("缺少 main");
    expect(prompts.systemPrompt).toContain("Repair 不能决定最终质量状态");
    expect(prompts.systemPrompt).toContain("changeSummary 始终是 JSON 字符串数组");
    expect(prompts.systemPrompt).toContain("不得返回 `.class`");
    expect(prompts.systemPrompt).toContain(
      "allowedContentFields 中明确列出的根内容字段",
    );
    expect(prompts.systemPrompt).toContain(
      "禁止输出名为 `dsl_candidate` 或 `dsl` 的根字段",
    );
    expect(prompts.systemPrompt).toContain(
      '"kind":"dsl_candidate","pageId":"page-01"',
    );
    expect(prompts.systemPrompt).toContain(
      "sourceReport.issues` 已被服务端裁剪",
    );
    expect(prompts.systemPrompt).toContain(
      "不得把 issue code 当作 selector 或 search",
    );
    expect(prompts.systemPrompt).toContain(
      "`BROWSER_VIEWPORT_SCALE_TOO_SMALL`",
    );
    expect(prompts.systemPrompt).toContain(
      "每个 HTML patch 都必须提供 `summary` 字符串",
    );
    expect(prompts.systemPrompt).toContain(
      "`html, body`、`.class` 或属性定位只描述原问题",
    );
    expect(prompts.systemPrompt).toContain(
      "禁止继续只增大按钮",
    );
    expect(prompts.userPrompt).toContain(
      "sourceReport 中没有出现的 issue code 不属于本轮任务",
    );
    expect(prompts.userPrompt).toContain('"pageId":"page-02"');
  });
});
