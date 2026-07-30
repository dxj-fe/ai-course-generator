import {
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAssetCache,
  createAssetCacheKey,
  createAssetRequestSetCacheKey,
  type AssetCacheKeyInput,
} from "../../../../src/server/agent/plugins/tools/course/image-cache";
import type {
  AssetGenerationResult,
  AssetRequest,
  PageContentDSL,
} from "../../../../src/shared/course-schema";
import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";

const directories: string[] = [];

const request: AssetRequest = {
  assetSlotId: "asset-slot-01",
  assetType: "background",
  usage: "课程标题背景",
  prompt: "A calm educational astronomy background with subtle stars and no text.",
  transparentBackground: false,
  safeArea: {
    position: "left",
    coveragePercent: 40,
    description: "为左侧 HTML 标题保留低细节区域。",
  },
  aspectRatio: "16:9",
};

const input: AssetCacheKeyInput = {
  request,
  styleTemplateId: "sci-fi",
  provider: "test-provider",
  model: "test-image-model",
};

const requestSetContent: PageContentDSL = {
  ...pageContentDsl,
  assetSlots: [
    {
      id: "asset-slot-01",
      type: "image",
      role: "background",
      purpose: "课程标题背景",
      required: true,
      altTextGuidance: "星空背景",
    },
  ],
};

const requestSetInput = {
  content: requestSetContent,
  visualBrief,
  promptVersion: "1.0.0/1.0.0",
};

function readyResult(
  overrides: Partial<AssetGenerationResult> = {},
): AssetGenerationResult {
  return {
    request,
    status: "ready",
    asset: {
      id: "asset-123e4567-e89b-42d3-a456-426614174000",
      type: "image",
      role: "background",
      source: "generated",
      status: "ready",
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174000",
      altText: "星空背景",
      generationPrompt: request.prompt,
      mimeType: "image/png",
      dimensions: { width: 320, height: 180 },
      usedByPageIds: ["page-02-knowledge"],
    },
    provider: "test-provider",
    model: "test-image-model",
    durationMs: 25,
    ...overrides,
  };
}

async function temporaryCacheFile() {
  const directory = await mkdtemp(path.join(tmpdir(), "asset-cache-test-"));
  directories.push(directory);
  return path.join(directory, "asset-cache.sqlite");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("asset cache", () => {
  it("builds a stable content key and invalidates pixel-affecting changes", () => {
    const decomposed = {
      ...request,
      prompt: "  A Cafe\u0301   learning scene with enough descriptive detail.  ",
    };
    const composed = {
      ...request,
      prompt: "A Caf\u00e9 learning scene with enough descriptive detail.",
    };

    expect(createAssetCacheKey({ ...input, request: decomposed })).toBe(
      createAssetCacheKey({ ...input, request: composed }),
    );
    expect(
      createAssetCacheKey({ ...input, styleTemplateId: "minimal" }),
    ).not.toBe(createAssetCacheKey(input));
    expect(
      createAssetCacheKey({
        ...input,
        request: { ...request, aspectRatio: "4:3" },
      }),
    ).not.toBe(createAssetCacheKey(input));
    expect(
      createAssetCacheKey({ ...input, model: "another-image-model" }),
    ).not.toBe(createAssetCacheKey(input));
  });

  it("reuses the compiled request set for the same page input", async () => {
    const filePath = await temporaryCacheFile();
    const cache = createAssetCache({
      filePath,
      assetExists: vi.fn().mockResolvedValue(true),
    });

    await expect(cache.store(input, readyResult())).resolves.toEqual({
      status: "stored",
    });
    await expect(
      cache.storeRequestSet(requestSetInput, [request]),
    ).resolves.toEqual({ status: "stored" });
    await expect(cache.lookupRequestSet(requestSetInput)).resolves.toEqual({
      status: "hit",
      value: [request],
    });
    await expect(
      cache.lookupRequestSet({
        ...requestSetInput,
        promptVersion: "1.1.0/1.0.0",
      }),
    ).resolves.toEqual({ status: "miss" });
    await expect(
      cache.lookupRequestSet({
        ...requestSetInput,
        content: { ...requestSetContent, title: "更新后的课程标题" },
      }),
    ).resolves.toEqual({ status: "miss" });
    await expect(cache.lookup(input)).resolves.toMatchObject({ status: "hit" });

    expect(createAssetRequestSetCacheKey(requestSetInput)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("rejects a compiled request set that does not cover every page slot", async () => {
    const filePath = await temporaryCacheFile();
    const cache = createAssetCache({ filePath });

    await expect(cache.storeRequestSet(requestSetInput, [])).resolves.toEqual({
      status: "skipped",
      reason: "invalid-requests",
    });
    await expect(cache.lookupRequestSet(requestSetInput)).resolves.toEqual({
      status: "miss",
    });
  });

  it("returns a validated hit without persisting page-specific metadata", async () => {
    const filePath = await temporaryCacheFile();
    const assetExists = vi.fn().mockResolvedValue(true);
    const cache = createAssetCache({ filePath, assetExists });

    await expect(cache.store(input, readyResult())).resolves.toEqual({
      status: "stored",
    });
    const lookup = await cache.lookup(input);

    expect(lookup).toMatchObject({
      status: "hit",
      value: {
        asset: {
          id: "asset-123e4567-e89b-42d3-a456-426614174000",
          uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174000",
        },
        provider: "test-provider",
        model: "test-image-model",
      },
    });
    if (lookup.status === "hit") {
      expect(lookup.value.asset).not.toHaveProperty("altText");
      expect(lookup.value.asset).not.toHaveProperty("generationPrompt");
      expect(lookup.value.asset).not.toHaveProperty("usedByPageIds");
    }
    expect(assetExists).toHaveBeenCalledWith(
      "asset-123e4567-e89b-42d3-a456-426614174000",
    );
    const database = new DatabaseSync(filePath);
    const rows = database
      .prepare("SELECT payload FROM asset_cache_entries")
      .all() as Array<{ payload: string }>;
    database.close();
    expect(rows.map(({ payload }) => payload).join("\n")).not.toContain(
      request.prompt,
    );
  });

  it("reports stale when the indexed internal asset file is missing", async () => {
    const filePath = await temporaryCacheFile();
    const assetExists = vi.fn().mockResolvedValue(true);
    const cache = createAssetCache({ filePath, assetExists });
    await cache.store(input, readyResult());
    assetExists.mockResolvedValue(false);

    await expect(cache.lookup(input)).resolves.toEqual({ status: "stale" });
  });

  it("recovers a damaged cache on the next successful ready write", async () => {
    const filePath = await temporaryCacheFile();
    const cache = createAssetCache({
      filePath,
      assetExists: vi.fn().mockResolvedValue(true),
    });
    const database = new DatabaseSync(filePath);
    database
      .prepare(
        `INSERT INTO asset_cache_entries (cache_key, payload, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(
        createAssetCacheKey(input),
        "{not valid json",
        new Date().toISOString(),
      );
    database.close();

    await expect(cache.lookup(input)).resolves.toEqual({
      status: "unavailable",
      reason: "invalid-cache",
    });
    await expect(cache.store(input, readyResult())).resolves.toEqual({
      status: "stored",
    });
    await expect(cache.lookup(input)).resolves.toMatchObject({ status: "hit" });
  });

  it("rejects a cached remote URI even when the remaining record is valid", async () => {
    const filePath = await temporaryCacheFile();
    const cache = createAssetCache({
      filePath,
      assetExists: vi.fn().mockResolvedValue(true),
    });
    await cache.store(input, readyResult());
    const database = new DatabaseSync(filePath);
    const key = createAssetCacheKey(input);
    const row = database
      .prepare("SELECT payload FROM asset_cache_entries WHERE cache_key = ?")
      .get(key) as { payload: string } | undefined;
    if (!row) throw new Error("expected one cache entry");
    const entry = JSON.parse(row.payload) as { asset: { uri: string } };
    entry.asset.uri = "https://example.com/untrusted.png";
    database
      .prepare(
        "UPDATE asset_cache_entries SET payload = ? WHERE cache_key = ?",
      )
      .run(JSON.stringify(entry), key);
    database.close();

    await expect(cache.lookup(input)).resolves.toEqual({
      status: "unavailable",
      reason: "invalid-cache",
    });
  });

  it("does not cache fallback or a result from another model identity", async () => {
    const filePath = await temporaryCacheFile();
    const cache = createAssetCache({
      filePath,
      assetExists: vi.fn().mockResolvedValue(true),
    });
    const fallback: AssetGenerationResult = {
      request,
      status: "fallback",
      fallback: {
        kind: "css-gradient",
        description: "使用低细节 CSS 渐变背景。",
      },
      durationMs: 1,
      errorCode: "IMAGE_GENERATION_FAILED",
    };

    await expect(cache.store(input, fallback)).resolves.toEqual({
      status: "skipped",
      reason: "not-ready",
    });
    await expect(
      cache.store(input, readyResult({ model: "another-image-model" })),
    ).resolves.toEqual({
      status: "skipped",
      reason: "identity-mismatch",
    });
    await expect(
      cache.store(
        input,
        readyResult({
          request: {
            ...request,
            prompt: "A different educational background that must not share this cache key.",
          },
        }),
      ),
    ).resolves.toEqual({
      status: "skipped",
      reason: "invalid-result",
    });
    await expect(cache.lookup(input)).resolves.toEqual({ status: "miss" });
  });

  it("serializes concurrent writes without losing either cache entry", async () => {
    const filePath = await temporaryCacheFile();
    const cache = createAssetCache({
      filePath,
      assetExists: vi.fn().mockResolvedValue(true),
    });
    const secondRequest: AssetRequest = {
      ...request,
      assetSlotId: "asset-slot-02",
      prompt: "A friendly educational planet illustration with no text or labels.",
    };
    const secondInput = { ...input, request: secondRequest };
    const secondResult = readyResult({
      request: secondRequest,
      asset: {
        ...readyResult().asset!,
        id: "asset-123e4567-e89b-42d3-a456-426614174001",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174001",
        generationPrompt: secondRequest.prompt,
      },
    });

    await expect(
      Promise.all([
        cache.store(input, readyResult()),
        cache.store(secondInput, secondResult),
      ]),
    ).resolves.toEqual([{ status: "stored" }, { status: "stored" }]);
    await expect(cache.lookup(input)).resolves.toMatchObject({ status: "hit" });
    await expect(cache.lookup(secondInput)).resolves.toMatchObject({
      status: "hit",
    });
    const directoryEntries = await readdir(path.dirname(filePath));
    expect(directoryEntries).toContain("asset-cache.sqlite");
  });
});
