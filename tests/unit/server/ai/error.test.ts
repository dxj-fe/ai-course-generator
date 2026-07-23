import { describe, expect, it } from "vitest";

import { toAiErrorPayload } from "../../../../src/server/ai/error";

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
});
