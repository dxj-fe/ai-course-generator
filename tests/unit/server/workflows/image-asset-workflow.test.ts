import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runImageAssetWorkflow,
  type ImageAssetWorkflowDependencies,
} from "../../../../src/server/agent/plugins/tools/course/image-assets";
import {
  createAssetCache,
  type AssetCache,
} from "../../../../src/server/agent/plugins/tools/course/image-cache";
import { createGenerateImageTool } from "../../../../src/server/agent/plugins/tools/course/generate-image";
import type {
  AssetRequest,
  PageContentDSL,
} from "../../../../src/shared/course-schema";
import { visualBrief } from "../../../fixtures/course-design";

const directories: string[] = [];
const modelIdentity = {
  provider: "test-provider",
  model: "test-image-model",
};

const content: PageContentDSL = {
  pageId: "page-02-knowledge",
  functionalTemplateId: "knowledge-card-grid",
  title: "恒星与行星观察任务",
  runtime: {
    sceneKind: "explain",
    visualPrimitive: "concept-map",
    motionPlan: { intensity: "none", cuePoints: [] },
    completionRule: { type: "view" },
  },
  narration: ["先观察背景，再跟随宇航员完成任务卡。"],
  blocks: [
    {
      id: "block-01",
      kind: "instruction",
      heading: "任务卡",
      body: "比较恒星与行星是否会自己发光。",
      supportingPoints: ["将结论写成一句完整的话。"],
    },
  ],
  interaction: { type: "none" },
  assetSlots: [
    {
      id: "asset-slot-01",
      type: "image",
      role: "background",
      purpose: "建立低细节太空观察场景。",
      required: true,
      altTextGuidance: "左侧留有文字安全区的太空背景。",
    },
    {
      id: "asset-slot-02",
      type: "illustration",
      role: "inline",
      purpose: "提示学习者完成任务卡。",
      required: true,
      altTextGuidance: "指向任务卡的小小宇航员。",
    },
  ],
  layoutHints: {
    contentDensity: "balanced",
    visualPriority: "任务卡文字优先",
    groupingStrategy: "背景、任务卡和角色贴纸形成清晰层级",
    readingOrder: ["block-01"],
  },
};

const requests: AssetRequest[] = [
  {
    assetSlotId: "asset-slot-01",
    assetType: "background",
    usage: "建立低细节太空观察场景。",
    prompt:
      "A calm educational space background with a left text-safe area and no text.",
    transparentBackground: false,
    safeArea: {
      position: "left",
      coveragePercent: 40,
      description: "为 HTML 任务卡保留左侧低细节区域。",
    },
    aspectRatio: "16:9",
  },
  {
    assetSlotId: "asset-slot-02",
    assetType: "character_sticker",
    usage: "提示学习者完成任务卡。",
    prompt:
      "A friendly astronaut sticker with a complete silhouette, transparent background, and no text.",
    transparentBackground: true,
    safeArea: {
      position: "none",
      coveragePercent: 0,
      description: "独立贴纸不承载 HTML 文本。",
    },
    aspectRatio: "3:4",
  },
];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("image asset workflow", () => {
  it("does not start another image or cache write after cancellation", async () => {
    const controller = new AbortController();
    const cache: AssetCache = {
      lookup: vi.fn().mockResolvedValue({ status: "miss" }),
      store: vi.fn(),
      lookupRequestSet: vi.fn().mockResolvedValue({ status: "miss" }),
      storeRequestSet: vi.fn().mockResolvedValue({ status: "stored" }),
    };
    const generate = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const dependencies = createDependencies({
      cache,
      generate,
      store: vi.fn(),
    });

    await expect(
      runImageAssetWorkflow(
        { content, visualBrief },
        { abortSignal: controller.signal, traceId: "asset-cancelled" },
        dependencies,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).toHaveBeenCalledOnce();
    expect(cache.store).not.toHaveBeenCalled();
  });

  it("reuses same-page requests and cross-page ready assets without another image call", async () => {
    const cache = await temporaryCache();
    const generate = vi.fn().mockResolvedValue({
      bytes: transparentPng(),
      mediaType: "image/png",
      ...modelIdentity,
    });
    const store = vi
      .fn()
      .mockResolvedValueOnce({
        id: "asset-123e4567-e89b-42d3-a456-426614174000",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174000",
      })
      .mockResolvedValueOnce({
        id: "asset-123e4567-e89b-42d3-a456-426614174001",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174001",
      });
    const runImagePrompt = successfulPromptRunner();
    const dependencies = createDependencies({
      cache,
      generate,
      store,
      runImagePrompt,
    });

    const first = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "asset-cache-first" },
      dependencies,
    );
    const repeated = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "asset-cache-repeat" },
      dependencies,
    );
    const reusedContent: PageContentDSL = {
      ...content,
      pageId: "page-04-reuse",
      assetSlots: content.assetSlots.map((slot) =>
        slot.id === "asset-slot-02"
          ? { ...slot, altTextGuidance: "再次出现并指向任务卡的宇航员。" }
          : slot,
      ),
    };
    const crossPage = await runImageAssetWorkflow(
      { content: reusedContent, visualBrief },
      { traceId: "asset-cache-second" },
      dependencies,
    );

    expect(first.status).toBe("completed");
    expect(repeated.status).toBe("completed");
    expect(crossPage.status).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(store).toHaveBeenCalledTimes(2);
    expect(runImagePrompt).toHaveBeenCalledTimes(2);
    expect(repeated.results?.map(({ asset }) => asset?.uri)).toEqual(
      first.results?.map(({ asset }) => asset?.uri),
    );
    expect(crossPage.results?.map(({ asset }) => asset?.uri)).toEqual(
      first.results?.map(({ asset }) => asset?.uri),
    );
    expect(crossPage.results?.[1]?.asset).toMatchObject({
      altText: "再次出现并指向任务卡的宇航员。",
      usedByPageIds: ["page-04-reuse"],
    });
    expect(summaryData(repeated.events)).toMatchObject({
      requestSetHitCount: 1,
      hitCount: 2,
      missCount: 0,
      generatedCount: 0,
      fallbackCount: 0,
    });
  });

  it("does not cache fallback results and retries only that slot", async () => {
    const cache = await temporaryCache();
    const generate = vi.fn(
      async ({ request }: { request: AssetRequest }) => {
        if (request.assetSlotId === "asset-slot-02") {
          throw new Error("provider unavailable");
        }
        return {
          bytes: transparentPng(),
          mediaType: "image/png",
          ...modelIdentity,
        };
      },
    );
    const store = vi.fn().mockResolvedValue({
      id: "asset-123e4567-e89b-42d3-a456-426614174002",
      uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174002",
    });
    const dependencies = createDependencies({ cache, generate, store });

    const first = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "asset-fallback-first" },
      dependencies,
    );
    const second = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "asset-fallback-second" },
      dependencies,
    );

    expect(first.status).toBe("completed");
    expect(first.results?.map(({ status }) => status)).toEqual([
      "ready",
      "fallback",
    ]);
    expect(second.results?.map(({ status }) => status)).toEqual([
      "ready",
      "fallback",
    ]);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(store).toHaveBeenCalledOnce();
    expect(summaryData(second.events)).toMatchObject({
      hitCount: 1,
      missCount: 1,
      generatedCount: 1,
      fallbackCount: 1,
    });
  });

  it("regenerates a stale entry and keeps the workflow completed", async () => {
    const cache: AssetCache = {
      lookup: vi.fn().mockResolvedValue({ status: "stale" }),
      store: vi.fn().mockResolvedValue({ status: "stored" }),
      lookupRequestSet: vi.fn().mockResolvedValue({ status: "miss" }),
      storeRequestSet: vi.fn().mockResolvedValue({ status: "stored" }),
    };
    const generate = vi.fn().mockResolvedValue({
      bytes: transparentPng(),
      mediaType: "image/png",
      ...modelIdentity,
    });
    const store = vi
      .fn()
      .mockResolvedValueOnce({
        id: "asset-123e4567-e89b-42d3-a456-426614174003",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174003",
      })
      .mockResolvedValueOnce({
        id: "asset-123e4567-e89b-42d3-a456-426614174004",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174004",
      });

    const state = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "asset-cache-stale" },
      createDependencies({ cache, generate, store }),
    );

    expect(state.status).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(summaryData(state.events)).toMatchObject({
      staleCount: 2,
      generatedCount: 2,
    });
  });

  it("treats cache read and write errors as non-blocking observability events", async () => {
    const cache: AssetCache = {
      lookup: vi.fn().mockRejectedValue(new Error("cache read failed")),
      store: vi.fn().mockRejectedValue(new Error("cache write failed")),
      lookupRequestSet: vi
        .fn()
        .mockRejectedValue(new Error("request cache read failed")),
      storeRequestSet: vi
        .fn()
        .mockRejectedValue(new Error("request cache write failed")),
    };
    const generate = vi.fn().mockResolvedValue({
      bytes: transparentPng(),
      mediaType: "image/png",
      ...modelIdentity,
    });
    const store = vi
      .fn()
      .mockResolvedValueOnce({
        id: "asset-123e4567-e89b-42d3-a456-426614174005",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174005",
      })
      .mockResolvedValueOnce({
        id: "asset-123e4567-e89b-42d3-a456-426614174006",
        uri: "/api/assets/asset-123e4567-e89b-42d3-a456-426614174006",
      });

    const state = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "asset-cache-errors" },
      createDependencies({ cache, generate, store }),
    );

    expect(state.status).toBe("completed");
    expect(state.results?.every(({ status }) => status === "ready")).toBe(true);
    expect(summaryData(state.events)).toMatchObject({
      generatedCount: 2,
      cacheErrorCount: 6,
    });
    expect(JSON.stringify(state.events)).not.toContain(requests[0]?.prompt);
    expect(JSON.stringify(state.events)).not.toContain("cache read failed");
  });

  it("does not access the asset cache or image generation when Image Prompt fails", async () => {
    const cache: AssetCache = {
      lookup: vi.fn(),
      store: vi.fn(),
      lookupRequestSet: vi.fn().mockResolvedValue({ status: "miss" }),
      storeRequestSet: vi.fn(),
    };
    const generate = vi.fn();
    const dependencies = createDependencies({
      cache,
      generate,
      store: vi.fn(),
      runImagePrompt: vi.fn().mockResolvedValue({
        status: "failed",
        step: 1,
        maxSteps: 1,
        events: [],
        task: { content, visualBrief },
        error: {
          code: "AGENT_EXECUTION_ERROR",
          message: "Image Prompt failed",
        },
      }),
    });

    const state = await runImageAssetWorkflow(
      { content, visualBrief },
      { traceId: "image-prompt-failed" },
      dependencies,
    );

    expect(state.status).toBe("failed");
    expect(cache.lookupRequestSet).toHaveBeenCalledOnce();
    expect(cache.lookup).not.toHaveBeenCalled();
    expect(cache.storeRequestSet).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

function createDependencies({
  cache,
  generate,
  store,
  runImagePrompt = successfulPromptRunner(),
}: {
  cache: AssetCache;
  generate: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
  runImagePrompt?: ImageAssetWorkflowDependencies["runImagePrompt"];
}): ImageAssetWorkflowDependencies {
  return {
    cache,
    getImageModelIdentity: () => modelIdentity,
    imageTool: createGenerateImageTool({ generate, store }),
    runImagePrompt,
  };
}

function successfulPromptRunner(): ImageAssetWorkflowDependencies["runImagePrompt"] {
  return vi.fn().mockImplementation(async (input) => ({
    status: "completed",
    step: 1,
    maxSteps: 1,
    events: [],
    task: input,
    requests,
  }));
}

async function temporaryCache() {
  const directory = await mkdtemp(path.join(tmpdir(), "asset-workflow-test-"));
  directories.push(directory);
  return createAssetCache({
    databasePath: path.join(directory, "asset-cache.json"),
    assetExists: vi.fn().mockResolvedValue(true),
  });
}

function transparentPng() {
  const bytes = new Uint8Array(26);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(16, 320);
  new DataView(bytes.buffer).setUint32(20, 180);
  bytes[25] = 6;
  return bytes;
}

function summaryData(events: Awaited<ReturnType<typeof runImageAssetWorkflow>>["events"]) {
  return events.at(-1)?.data;
}
