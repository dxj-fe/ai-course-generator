import { createHash, randomUUID } from "node:crypto";

export function createStorageId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function hashStorageValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function addMilliseconds(timestamp: string, durationMs: number) {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) {
    throw new Error(`无效时间：${timestamp}`);
  }
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    throw new Error("lease 时长必须是正整数毫秒");
  }
  return new Date(time + durationMs).toISOString();
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return value;
}
