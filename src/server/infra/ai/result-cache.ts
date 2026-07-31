import { createHash } from "node:crypto";
import type { z } from "zod";

const CACHE_KEY_PATTERN = /^[0-9a-f]{64}$/;

export type AiResultCacheKeyInput = {
  namespace: string;
  promptFingerprint: string;
  model: string;
  schemaFingerprint: string;
  input: unknown;
};

export type AiResultCache = {
  lookup<T>(
    key: string,
    schema: z.ZodType<T>,
  ): { status: "hit"; value: T } | { status: "miss" };
  store<T>(key: string, value: unknown, schema: z.ZodType<T>): boolean;
  clear(): void;
};

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type AiResultCacheOptions = {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
};

/** 缓存键明确绑定 Prompt、模型与 Schema 契约，防止静默复用旧结果。 */
export function createAiResultCacheKey(input: AiResultCacheKeyInput) {
  for (const [name, value] of Object.entries({
    namespace: input.namespace,
    promptFingerprint: input.promptFingerprint,
    model: input.model,
    schemaFingerprint: input.schemaFingerprint,
  })) {
    if (!value.trim()) throw new Error(`AI cache ${name} 不能为空。`);
  }

  return createHash("sha256")
    .update(
      JSON.stringify({
        namespace: input.namespace,
        promptFingerprint: input.promptFingerprint,
        model: input.model,
        schemaFingerprint: input.schemaFingerprint,
        input: canonicalize(input.input),
      }),
    )
    .digest("hex");
}

/** 单进程、有限容量、短 TTL 的简单缓存；多实例部署需换共享缓存。 */
export function createAiResultCache(
  options: AiResultCacheOptions = {},
): AiResultCache {
  const maxEntries = options.maxEntries ?? 128;
  const ttlMs = options.ttlMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("AI result cache maxEntries 必须是正整数。");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 1) {
    throw new Error("AI result cache ttlMs 必须是正数。");
  }

  return {
    lookup(key, schema) {
      if (!CACHE_KEY_PATTERN.test(key)) return { status: "miss" };
      const entry = entries.get(key);
      if (!entry) return { status: "miss" };
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return { status: "miss" };
      }
      const parsed = schema.safeParse(structuredClone(entry.value));
      if (!parsed.success) {
        entries.delete(key);
        return { status: "miss" };
      }
      entries.delete(key);
      entries.set(key, entry);
      return { status: "hit", value: parsed.data };
    },

    store(key, value, schema) {
      if (!CACHE_KEY_PATTERN.test(key)) return false;
      const parsed = schema.safeParse(value);
      if (!parsed.success) return false;
      entries.delete(key);
      entries.set(key, {
        expiresAt: now() + ttlMs,
        value: structuredClone(parsed.data),
      });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return true;
    },

    clear() {
      entries.clear();
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new Error("AI cache input 必须是可序列化的 JSON 数据。");
}

export const aiResultCache = createAiResultCache();
