import { describe, expect, it } from "vitest";

import {
  isRetryableModelError,
  resolveModelRoute,
} from "../../../../src/server/ai/model-router";

describe("model router", () => {
  it("routes course-content capabilities through the quality-first tier", () => {
    expect(resolveModelRoute("intent")).toEqual({
      primary: "strong",
      fallback: "balanced",
    });
    expect(resolveModelRoute("page-writer")).toEqual({
      primary: "strong",
      fallback: "balanced",
    });
    expect(resolveModelRoute("planner")).toEqual({
      primary: "strong",
      fallback: "balanced",
    });
    expect(resolveModelRoute("page-qa").primary).toBe("strong");
  });

  it("retries only transient provider failures and never user cancellation", () => {
    expect(isRetryableModelError({ statusCode: 429 })).toBe(true);
    expect(isRetryableModelError({ statusCode: 402 })).toBe(true);
    expect(isRetryableModelError({ status: 503 })).toBe(true);
    expect(isRetryableModelError(new Error("request timed out"))).toBe(true);
    expect(
      isRetryableModelError(new Error("insufficient_quota")),
    ).toBe(true);
    expect(
      isRetryableModelError(new DOMException("aborted", "AbortError")),
    ).toBe(false);
    expect(isRetryableModelError(new Error("schema validation failed"))).toBe(
      false,
    );
  });
});
