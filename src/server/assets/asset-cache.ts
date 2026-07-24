import { createHash } from "node:crypto";
import { z } from "zod";

import { hasGeneratedAsset } from "@/server/assets/generated-asset-store";
import { getAppDatabase } from "@/server/storage/database";
import {
  AssetGenerationResultSchema,
  AssetGenerationWarningSchema,
  AssetRequestSchema,
  AssetRoleSchema,
  AssetTypeSchema,
  PageContentDSLSchema,
  VisualBriefSchema,
  type AssetGenerationResult,
  type AssetRequest,
  type PageContentDSL,
  type VisualBrief,
} from "@/shared/course-schema";

const ASSET_CACHE_VERSION = 1;
const ASSET_ID_PATTERN =
  /^asset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AssetCacheKeyInputSchema = z
  .object({
    request: AssetRequestSchema,
    styleTemplateId: z.string().trim().min(1).max(80),
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(160),
  })
  .strict();

const AssetRequestSetCacheInputSchema = z
  .object({
    content: PageContentDSLSchema,
    visualBrief: VisualBriefSchema,
    promptVersion: z.string().trim().min(1).max(80),
  })
  .strict();

const CachedAssetRequestSetSchema = z.array(AssetRequestSchema).max(12);

const CachedGeneratedAssetSchema = z
  .object({
    asset: z
      .object({
        id: z.string().regex(ASSET_ID_PATTERN),
        type: AssetTypeSchema,
        role: AssetRoleSchema,
        source: z.literal("generated"),
        status: z.literal("ready"),
        uri: z.string().regex(
          /^\/api\/assets\/asset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
        dimensions: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(160),
    warnings: z.array(AssetGenerationWarningSchema).max(4).optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.asset.uri !== `/api/assets/${record.asset.id}`) {
      context.addIssue({
        code: "custom",
        message: "缓存素材 URI 必须与内部素材 ID 一致",
        path: ["asset", "uri"],
      });
    }
  });

export type AssetCacheKeyInput = {
  request: AssetRequest;
  styleTemplateId: string;
  provider: string;
  model: string;
};

export type AssetRequestSetCacheInput = {
  content: PageContentDSL;
  visualBrief: VisualBrief;
  promptVersion: string;
};

export type CachedGeneratedAsset = z.infer<
  typeof CachedGeneratedAssetSchema
>;

export type AssetCacheLookupResult =
  | { status: "hit"; value: CachedGeneratedAsset }
  | { status: "miss" }
  | { status: "stale" }
  | {
      status: "unavailable";
      reason:
        | "invalid-input"
        | "invalid-cache"
        | "read-failed"
        | "asset-check-failed";
    };

export type AssetCacheStoreResult =
  | { status: "stored" }
  | {
      status: "skipped";
      reason: "not-ready" | "invalid-result" | "identity-mismatch";
    }
  | { status: "unavailable"; reason: "read-failed" | "write-failed" };

export type AssetRequestSetCacheLookupResult =
  | { status: "hit"; value: AssetRequest[] }
  | { status: "miss" }
  | {
      status: "unavailable";
      reason: "invalid-input" | "invalid-cache" | "read-failed";
    };

export type AssetRequestSetCacheStoreResult =
  | { status: "stored" }
  | { status: "skipped"; reason: "invalid-input" | "invalid-requests" }
  | { status: "unavailable"; reason: "read-failed" | "write-failed" };

export type AssetCache = {
  lookup(input: AssetCacheKeyInput): Promise<AssetCacheLookupResult>;
  store(
    input: AssetCacheKeyInput,
    result: AssetGenerationResult,
  ): Promise<AssetCacheStoreResult>;
  lookupRequestSet(
    input: AssetRequestSetCacheInput,
  ): Promise<AssetRequestSetCacheLookupResult>;
  storeRequestSet(
    input: AssetRequestSetCacheInput,
    requests: AssetRequest[],
  ): Promise<AssetRequestSetCacheStoreResult>;
};

type AssetCacheOptions = {
  databasePath?: string;
  /** 兼容旧调用方；该路径现在是 SQLite 数据库文件。 */
  filePath?: string;
  assetExists?: (id: string) => Promise<boolean>;
};

/** 只使用会影响像素结果的稳定输入生成内容寻址键。 */
export function createAssetCacheKey(input: AssetCacheKeyInput) {
  const parsed = AssetCacheKeyInputSchema.parse(input);
  const keyMaterial = {
    version: ASSET_CACHE_VERSION,
    provider: parsed.provider,
    model: parsed.model,
    styleTemplateId: parsed.styleTemplateId,
    assetType: parsed.request.assetType,
    prompt: normalizePrompt(parsed.request.prompt),
    transparentBackground: parsed.request.transparentBackground,
    safeArea: {
      position: parsed.request.safeArea.position,
      coveragePercent: parsed.request.safeArea.coveragePercent,
    },
    aspectRatio: parsed.request.aspectRatio,
  };

  return createHash("sha256")
    .update(JSON.stringify(keyMaterial))
    .digest("hex");
}

/** 缓存同一页的结构化生图请求，避免模型措辞漂移破坏素材命中。 */
export function createAssetRequestSetCacheKey(
  input: AssetRequestSetCacheInput,
) {
  const parsed = AssetRequestSetCacheInputSchema.parse(input);

  return createHash("sha256")
    .update(
      JSON.stringify({
        version: ASSET_CACHE_VERSION,
        promptVersion: parsed.promptVersion,
        content: parsed.content,
        visualBrief: parsed.visualBrief,
      }),
    )
    .digest("hex");
}

/** 创建可注入路径和存在性检查的持久化素材缓存。 */
export function createAssetCache(
  options: AssetCacheOptions = {},
): AssetCache {
  const database = getAppDatabase(options.databasePath ?? options.filePath);
  const assetExists = options.assetExists ?? hasGeneratedAsset;
  const loadEntry = database.prepare(
    "SELECT payload FROM asset_cache_entries WHERE cache_key = ?",
  );
  const saveEntry = database.prepare(`
    INSERT INTO asset_cache_entries (cache_key, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  const loadRequestSet = database.prepare(
    "SELECT payload FROM asset_request_sets WHERE cache_key = ?",
  );
  const saveRequestSet = database.prepare(`
    INSERT INTO asset_request_sets (cache_key, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);

  return {
    async lookup(input) {
      let key: string;
      try {
        key = createAssetCacheKey(input);
      } catch {
        return { status: "unavailable", reason: "invalid-input" };
      }

      let row: { payload: string } | undefined;
      try {
        row = loadEntry.get(key) as { payload: string } | undefined;
      } catch {
        return { status: "unavailable", reason: "read-failed" };
      }
      if (!row) return { status: "miss" };
      let value: CachedGeneratedAsset;
      try {
        value = CachedGeneratedAssetSchema.parse(JSON.parse(row.payload));
      } catch {
        return { status: "unavailable", reason: "invalid-cache" };
      }

      try {
        return (await assetExists(value.asset.id))
          ? { status: "hit", value }
          : { status: "stale" };
      } catch {
        return { status: "unavailable", reason: "asset-check-failed" };
      }
    },

    async store(input, result) {
      let key: string;
      try {
        key = createAssetCacheKey(input);
      } catch {
        return { status: "skipped", reason: "invalid-result" };
      }

      const record = createCacheRecord(input, result, key);
      if (record.status === "skipped") return record;

      try {
        saveEntry.run(key, JSON.stringify(record.value), new Date().toISOString());
        return { status: "stored" };
      } catch {
        return { status: "unavailable", reason: "write-failed" };
      }
    },

    async lookupRequestSet(input) {
      let key: string;
      try {
        key = createAssetRequestSetCacheKey(input);
      } catch {
        return { status: "unavailable", reason: "invalid-input" };
      }

      let row: { payload: string } | undefined;
      try {
        row = loadRequestSet.get(key) as { payload: string } | undefined;
      } catch {
        return { status: "unavailable", reason: "read-failed" };
      }
      if (!row) return { status: "miss" };
      let requests: AssetRequest[];
      try {
        requests = CachedAssetRequestSetSchema.parse(JSON.parse(row.payload));
      } catch {
        return { status: "unavailable", reason: "invalid-cache" };
      }
      return requestSetMatchesContent(requests, input.content)
        ? { status: "hit", value: requests }
        : { status: "unavailable", reason: "invalid-cache" };
    },

    async storeRequestSet(input, requests) {
      let key: string;
      try {
        key = createAssetRequestSetCacheKey(input);
      } catch {
        return { status: "skipped", reason: "invalid-input" };
      }

      const parsed = CachedAssetRequestSetSchema.safeParse(requests);
      if (
        !parsed.success ||
        !requestSetMatchesContent(parsed.data, input.content)
      ) {
        return { status: "skipped", reason: "invalid-requests" };
      }

      try {
        saveRequestSet.run(
          key,
          JSON.stringify(parsed.data),
          new Date().toISOString(),
        );
        return { status: "stored" };
      } catch {
        return { status: "unavailable", reason: "write-failed" };
      }
    },
  };
}

export const assetCache = createAssetCache();

function createCacheRecord(
  input: AssetCacheKeyInput,
  result: AssetGenerationResult,
  expectedKey: string,
):
  | { status: "ready"; value: CachedGeneratedAsset }
  | Extract<AssetCacheStoreResult, { status: "skipped" }> {
  const parsed = AssetGenerationResultSchema.safeParse(result);
  if (!parsed.success) {
    return { status: "skipped", reason: "invalid-result" };
  }
  if (parsed.data.status !== "ready") {
    return { status: "skipped", reason: "not-ready" };
  }

  if (
    createAssetCacheKey({ ...input, request: parsed.data.request }) !==
    expectedKey
  ) {
    return { status: "skipped", reason: "invalid-result" };
  }

  const asset = parsed.data.asset;
  if (
    !asset ||
    !asset.uri ||
    !asset.mimeType ||
    !parsed.data.provider ||
    !parsed.data.model
  ) {
    return { status: "skipped", reason: "invalid-result" };
  }
  if (
    parsed.data.provider.trim() !== input.provider.trim() ||
    parsed.data.model.trim() !== input.model.trim()
  ) {
    return { status: "skipped", reason: "identity-mismatch" };
  }

  const record = CachedGeneratedAssetSchema.safeParse({
    asset: {
      id: asset.id,
      type: asset.type,
      role: asset.role,
      source: asset.source,
      status: asset.status,
      uri: asset.uri,
      mimeType: asset.mimeType,
      dimensions: asset.dimensions,
    },
    provider: parsed.data.provider.trim(),
    model: parsed.data.model.trim(),
    warnings: parsed.data.warnings,
  });

  return record.success
    ? { status: "ready", value: record.data }
    : { status: "skipped", reason: "invalid-result" };
}

function normalizePrompt(prompt: string) {
  return prompt.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function requestSetMatchesContent(
  requests: AssetRequest[],
  content: PageContentDSL,
) {
  const slotIds = content.assetSlots.map(({ id }) => id);
  const requestIds = requests.map(({ assetSlotId }) => assetSlotId);

  return (
    requestIds.length === slotIds.length &&
    new Set(requestIds).size === requestIds.length &&
    requestIds.every((id) => slotIds.includes(id))
  );
}
