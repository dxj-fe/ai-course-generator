import { describe, expect, it } from "vitest";

import {
  isRetryableModelError,
  resolveModelRoute,
} from "../../../../src/server/ai/model-router";

describe("model router", () => {
  it("maps bounded Agent capabilities to explicit cost tiers", () => {
    expect(resolveModelRoute("intent")).toEqual({
      primary: "cheap",
      fallback: undefined,
    });
    expect(resolveModelRoute("page-writer")).toEqual({
      primary: "balanced",
      fallback: "cheap",
    });
    expect(resolveModelRoute("planner")).toEqual({
      primary: "strong",
      fallback: "balanced",
    });
    expect(resolveModelRoute("page-qa").primary).toBe("strong");
  });

  it("retries only transient provider failures and never user cancellation", () => {
    expect(isRetryableModelError({ statusCode: 429 })).toBe(true);
    expect(isRetryableModelError({ status: 503 })).toBe(true);
    expect(isRetryableModelError(new Error("request timed out"))).toBe(true);
    expect(
      isRetryableModelError(new DOMException("aborted", "AbortError")),
    ).toBe(false);
    expect(isRetryableModelError(new Error("schema validation failed"))).toBe(
      false,
    );
  });
});
