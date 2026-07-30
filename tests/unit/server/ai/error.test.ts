import { describe, expect, it } from "vitest";

import {
  AiSchemaValidationError,
  toAiErrorPayload,
} from "../../../../src/server/infra/ai/error";

describe("AI errors", () => {
  it("keeps user cancellation distinct from provider timeout", () => {
    expect(
      toAiErrorPayload(new DOMException("aborted", "AbortError"), "trace-abort"),
    ).toEqual({
      code: "CANCELLED_ERROR",
      message: "模型调用已取消。",
      traceId: "trace-abort",
    });
    expect(
      toAiErrorPayload(new Error("request timed out"), "trace-timeout"),
    ).toEqual({
      code: "TIMEOUT_ERROR",
      message: "模型调用超时，请稍后重试或降低输出长度。",
      traceId: "trace-timeout",
    });
  });

  it.each([
    [
      { statusCode: 429, message: "too many requests" },
      "RATE_LIMIT_ERROR",
      "模型服务当前请求较多，请稍后重试。",
    ],
    [
      Object.assign(new Error("insufficient_quota: secret provider detail"), {
        statusCode: 429,
      }),
      "QUOTA_ERROR",
      "模型服务额度不足，请检查账户额度或计费状态后重试。",
    ],
    [
      { statusCode: 402, message: "payment required" },
      "QUOTA_ERROR",
      "模型服务额度不足，请检查账户额度或计费状态后重试。",
    ],
    [
      Object.assign(new Error("invalid api key: sk-private"), {
        statusCode: 401,
      }),
      "AUTH_ERROR",
      "模型服务认证失败，请检查 API Key 或访问权限。",
    ],
  ])(
    "classifies provider failures without exposing their raw response",
    (error, code, message) => {
      expect(toAiErrorPayload(error, "trace-provider")).toEqual({
        code,
        message,
        traceId: "trace-provider",
      });
    },
  );

  it("keeps schema details internal to the Agent boundary", () => {
    expect(
      toAiErrorPayload(
        new AiSchemaValidationError("root.choice: private validation detail"),
        "trace-schema",
      ),
    ).toEqual({
      code: "SCHEMA_ERROR",
      message: "模型返回的内容格式不完整，请重新生成。",
      traceId: "trace-schema",
    });
  });

  it("classifies an invalid tier provider selector as configuration", () => {
    expect(
      toAiErrorPayload(
        new Error('MODEL_PROVIDER_STRONG must be either "ark" or "generic".'),
        "trace-config",
      ),
    ).toMatchObject({
      code: "CONFIG_ERROR",
    });
  });
});
