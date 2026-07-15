import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { hasGeneratedAsset } from "@/server/assets/generated-asset-store";
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
const ASSET_CACHE_PATH = path.join(process.cwd(), ".data", "asset-cache.json");
const ASSET_ID_PATTERN =
  /^asset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_KEY_PATTERN = /^[0-9a-f]{64}$/;

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

const AssetCacheFileSchema = z
  .object({
    version: z.literal(ASSET_CACHE_VERSION),
    entries: z.record(
      z.string().regex(CACHE_KEY_PATTERN),
      CachedGeneratedAssetSchema,
    ),
    requestSets: z
      .record(z.string().regex(CACHE_KEY_PATTERN), CachedAssetRequestSetSchema)
      .default({}),
  })
  .strict();

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
  filePath?: string;
  assetExists?: (id: string) => Promise<boolean>;
};

type CacheFileReadResult =
  | { status: "ready"; value: z.infer<typeof AssetCacheFileSchema> }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "failed" };

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
  const filePath = options.filePath ?? ASSET_CACHE_PATH;
  const assetExists = options.assetExists ?? hasGeneratedAsset;
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async lookup(input) {
      let key: string;
      try {
        key = createAssetCacheKey(input);
      } catch {
        return { status: "unavailable", reason: "invalid-input" };
      }

      const cached = await readCacheFile(filePath);
      if (cached.status === "missing") return { status: "miss" };
      if (cached.status === "invalid") {
        return { status: "unavailable", reason: "invalid-cache" };
      }
      if (cached.status === "failed") {
        return { status: "unavailable", reason: "read-failed" };
      }

      const value = cached.value.entries[key];
      if (!value) return { status: "miss" };

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

      const operation = writeQueue.then(async (): Promise<AssetCacheStoreResult> => {
        const cached = await readCacheFile(filePath);
        if (cached.status === "failed") {
          return { status: "unavailable", reason: "read-failed" };
        }

        const entries =
          cached.status === "ready" ? { ...cached.value.entries } : {};
        entries[key] = record.value;

        try {
          await writeCacheFileAtomically(filePath, {
            version: ASSET_CACHE_VERSION,
            entries,
            requestSets:
              cached.status === "ready" ? cached.value.requestSets : {},
          });
          return { status: "stored" };
        } catch {
          return { status: "unavailable", reason: "write-failed" };
        }
      });

      writeQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },

    async lookupRequestSet(input) {
      let key: string;
      try {
        key = createAssetRequestSetCacheKey(input);
      } catch {
        return { status: "unavailable", reason: "invalid-input" };
      }

      const cached = await readCacheFile(filePath);
      if (cached.status === "missing") return { status: "miss" };
      if (cached.status === "invalid") {
        return { status: "unavailable", reason: "invalid-cache" };
      }
      if (cached.status === "failed") {
        return { status: "unavailable", reason: "read-failed" };
      }

      const requests = cached.value.requestSets[key];
      if (!requests) return { status: "miss" };
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

      const operation = writeQueue.then(
        async (): Promise<AssetRequestSetCacheStoreResult> => {
          const cached = await readCacheFile(filePath);
          if (cached.status === "failed") {
            return { status: "unavailable", reason: "read-failed" };
          }

          const requestSets =
            cached.status === "ready" ? { ...cached.value.requestSets } : {};
          requestSets[key] = parsed.data;

          try {
            await writeCacheFileAtomically(filePath, {
              version: ASSET_CACHE_VERSION,
              entries: cached.status === "ready" ? cached.value.entries : {},
              requestSets,
            });
            return { status: "stored" };
          } catch {
            return { status: "unavailable", reason: "write-failed" };
          }
        },
      );

      writeQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
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

async function readCacheFile(filePath: string): Promise<CacheFileReadResult> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "missing" }
      : { status: "failed" };
  }

  try {
    const parsed = AssetCacheFileSchema.safeParse(JSON.parse(source));
    return parsed.success
      ? { status: "ready", value: parsed.data }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

async function writeCacheFileAtomically(
  filePath: string,
  value: z.infer<typeof AssetCacheFileSchema>,
) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}-${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // 临时文件可能尚未创建或已被 rename；保留原始写入错误。
    }
    throw error;
  }
}
