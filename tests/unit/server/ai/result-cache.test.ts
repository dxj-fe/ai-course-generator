import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createAiResultCache,
  createAiResultCacheKey,
} from "../../../../src/server/infra/ai/result-cache";

const schema = z.object({ value: z.string() }).strict();

describe("AI result cache", () => {
  it("normalizes object key order and invalidates every contract identity field", () => {
    const base = {
      namespace: "intent",
      promptFingerprint: "intent-current",
      model: "provider/model-a",
      schemaFingerprint: "course-intent-current",
      input: { b: 2, a: "same" },
    };
    const key = createAiResultCacheKey(base);

    expect(
      createAiResultCacheKey({ ...base, input: { a: "same", b: 2 } }),
    ).toBe(key);
    expect(
      createAiResultCacheKey({ ...base, promptFingerprint: "intent-changed" }),
    ).not.toBe(key);
    expect(
      createAiResultCacheKey({ ...base, model: "provider/model-b" }),
    ).not.toBe(key);
    expect(
      createAiResultCacheKey({ ...base, schemaFingerprint: "course-intent-changed" }),
    ).not.toBe(key);
  });

  it("stores only schema-valid results and evicts expired or oldest entries", () => {
    let now = 1_000;
    const cache = createAiResultCache({
      maxEntries: 1,
      ttlMs: 100,
      now: () => now,
    });
    const first = createAiResultCacheKey({
      namespace: "intent",
      promptFingerprint: "intent-current",
      model: "provider/model-a",
      schemaFingerprint: "course-intent-current",
      input: { topic: "stars" },
    });
    const second = createAiResultCacheKey({
      namespace: "planner",
      promptFingerprint: "planner-current",
      model: "provider/model-a",
      schemaFingerprint: "course-plan-current",
      input: { topic: "planets" },
    });

    expect(cache.store(first, { value: "ready" }, schema)).toBe(true);
    expect(cache.lookup(first, schema)).toEqual({
      status: "hit",
      value: { value: "ready" },
    });
    expect(cache.store(second, { value: "next" }, schema)).toBe(true);
    expect(cache.lookup(first, schema)).toEqual({ status: "miss" });
    expect(cache.store(second, { value: 3 }, schema)).toBe(false);

    now += 101;
    expect(cache.lookup(second, schema)).toEqual({ status: "miss" });
  });

  it("returns cloned values so callers cannot mutate cached state", () => {
    const cache = createAiResultCache();
    const key = "a".repeat(64);
    cache.store(key, { value: "original" }, schema);
    const hit = cache.lookup(key, schema);
    if (hit.status !== "hit") throw new Error("expected cache hit");
    hit.value.value = "changed";

    expect(cache.lookup(key, schema)).toEqual({
      status: "hit",
      value: { value: "original" },
    });
    expect(vi.isMockFunction(cache.lookup)).toBe(false);
  });
});
