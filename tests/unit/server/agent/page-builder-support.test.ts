import { describe, expect, it } from "vitest";

import { FatalAgentRuntimeError } from "../../../../src/server/agent/runtime";
import {
  PageBuilderModelStepError,
  recoverableModelStep,
} from "../../../../src/server/agent/plugins/tools/course/page-builder-support";

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

  it("保留已序列化 ModelStep 的可重试错误码和校验反馈", async () => {
    const result = await recoverableModelStep(
      async () => {
        throw new PageBuilderModelStepError(
          "MODEL_ERROR",
          "模型服务未返回有效结果，请稍后重试。",
        );
      },
      undefined,
      "PAGE_CONTENT_GENERATION_FAILED",
      "页面内容生成失败。",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PAGE_CONTENT_GENERATION_FAILED",
      retryable: true,
      feedback: ["模型服务未返回有效结果，请稍后重试。"],
    });
  });

  it("认证等不可恢复 ModelStep 错误仍立即终止", async () => {
    await expect(
      recoverableModelStep(
        async () => {
          throw new PageBuilderModelStepError(
            "AUTH_ERROR",
            "模型服务认证失败。",
          );
        },
        undefined,
        "PAGE_CONTENT_GENERATION_FAILED",
        "页面内容生成失败。",
      ),
    ).rejects.toMatchObject({
      code: "PAGE_CONTENT_GENERATION_FAILED",
      originalError: expect.objectContaining({
        code: "AUTH_ERROR",
        retryable: false,
      }),
    });
  });
});
