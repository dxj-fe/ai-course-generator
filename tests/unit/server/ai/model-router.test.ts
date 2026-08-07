import { describe, expect, it } from "vitest";

import {
  isRetryableModelError,
  resolveModelRoute,
} from "../../../../src/server/infra/ai/model-router";
import { AiSchemaValidationError } from "../../../../src/server/infra/ai/error";

describe("model router", () => {
  it("routes course-content capabilities through the quality-first tier", () => {
    expect(resolveModelRoute("page-writer")).toEqual({ primary: "strong" });
    expect(resolveModelRoute("planner")).toEqual({ primary: "strong" });
    expect(resolveModelRoute("course-architecture")).toEqual({ primary: "strong" });
    expect(resolveModelRoute("page-qa").primary).toBe("strong");
    expect(resolveModelRoute("course-review")).toEqual({ primary: "strong" });
    expect(resolveModelRoute("html")).toEqual({ primary: "strong" });
    expect(resolveModelRoute("html-repair")).toEqual({ primary: "strong" });
  });

  it("retries only transient provider failures and never user cancellation", () => {
    expect(isRetryableModelError({ statusCode: 429 })).toBe(true);
    expect(isRetryableModelError({ statusCode: 402 })).toBe(false);
    expect(isRetryableModelError({ status: 503 })).toBe(true);
    expect(isRetryableModelError(new Error("request timed out"))).toBe(true);
    expect(
      isRetryableModelError(new Error("insufficient_quota")),
    ).toBe(false);
    expect(
      isRetryableModelError(new DOMException("aborted", "AbortError")),
    ).toBe(false);
    expect(isRetryableModelError(new Error("schema validation failed"))).toBe(
      false,
    );
    expect(
      isRetryableModelError(
        new AiSchemaValidationError("结构化输出校验失败"),
      ),
    ).toBe(false);
  });
});
