import { describe, expect, it } from "vitest";

import { FatalAgentRuntimeError } from "../../../../src/server/agent/runtime";
import { recoverableModelStep } from "../../../../src/server/agent/plugins/tools/course/page-builder-support";

describe("Page Builder Model Step 错误策略", () => {
  it("Schema 等确定性错误立即终止，不把同一错误交给 Agent 反复重试", async () => {
    const error = new Error("模型输出不符合 PageContentDSL");

    await expect(
      recoverableModelStep(
        async () => {
          throw error;
        },
        undefined,
        "PAGE_CONTENT_GENERATION_FAILED",
        "页面内容生成失败。",
      ),
    ).rejects.toMatchObject({
      code: "PAGE_CONTENT_GENERATION_FAILED",
      originalError: error,
    } satisfies Partial<FatalAgentRuntimeError>);
  });

  it("仅把瞬时供应商错误作为一次可恢复的工具失败返回", async () => {
    const result = await recoverableModelStep(
      async () => {
        throw Object.assign(new Error("rate limit"), { status: 429 });
      },
      undefined,
      "PAGE_CONTENT_GENERATION_FAILED",
      "页面内容生成失败。",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PAGE_CONTENT_GENERATION_FAILED",
      retryable: true,
    });
  });
});
