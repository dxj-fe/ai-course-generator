import { getImageModelConfig } from "@/config/env";
import { createModelStepEvent } from "@/server/agent/plugins/model-steps/course/events";
import type {
  ModelStepContext,
  ModelStepEvent,
} from "@/server/agent/plugins/model-steps/course/types";
import {
  runImagePromptModelStep,
  type ImagePromptModelStepState,
} from "@/server/agent/plugins/model-steps/course/image-prompt-model-step";
import {
  assetCache,
  type AssetCache,
  type AssetCacheKeyInput,
} from "@/server/agent/plugins/tools/course/image-cache";
import { buildImagePromptPrompts } from "@/server/agent/plugins/prompts/course/model-steps/image-prompt";
import { ExecutableToolRegistry } from "@/server/agent/runtime/executable-tool-registry";
import {
  generateImageTool,
  type createGenerateImageTool,
} from "@/server/agent/plugins/tools/course/generate-image";
import {
  AssetGenerationResultSchema,
  type AssetGenerationResult,
  type AssetRequest,
  type PageContentDSL,
  type VisualBrief,
} from "@/shared/course-schema";

type GenerateImageTool = ReturnType<typeof createGenerateImageTool>;

export type ImageAssetWorkflowState = {
  status: "completed" | "failed";
  events: ModelStepEvent[];
  requests?: NonNullable<ImagePromptModelStepState["requests"]>;
  results?: AssetGenerationResult[];
  error?: { code: string; message: string };
};

type ImageModelIdentity = Pick<AssetCacheKeyInput, "provider" | "model">;

export type ImageAssetWorkflowDependencies = {
  runImagePrompt: typeof runImagePromptModelStep;
  imageTool: GenerateImageTool;
  cache: AssetCache;
  getImageModelIdentity(): ImageModelIdentity | undefined;
};

const defaultDependencies: ImageAssetWorkflowDependencies = {
  runImagePrompt: runImagePromptModelStep,
  imageTool: generateImageTool,
  cache: assetCache,
  getImageModelIdentity: getConfiguredImageModelIdentity,
};

/** 先复用或生成结构化请求，再按槽位解析缓存或生图；fallback 仍可继续。 */
export async function runImageAssetWorkflow(
  input: { content: PageContentDSL; visualBrief: VisualBrief },
  context: ModelStepContext,
  dependencies: ImageAssetWorkflowDependencies = defaultDependencies,
): Promise<ImageAssetWorkflowState> {
  throwIfAborted(context.abortSignal);
  const cacheSummary = {
    requestSetHitCount: 0,
    requestSetMissCount: 0,
    hitCount: 0,
    missCount: 0,
    staleCount: 0,
    generatedCount: 0,
    fallbackCount: 0,
    cacheErrorCount: 0,
    bypassCount: 0,
  };
  const { fingerprint: promptFingerprint } =
    await buildImagePromptPrompts(input);
  const requestSetCacheInput = {
    content: input.content,
    visualBrief: input.visualBrief,
    promptFingerprint,
  };
  let requests: AssetRequest[] | undefined;
  let events: ModelStepEvent[] = [];

  try {
    throwIfAborted(context.abortSignal);
    const cachedRequests =
      await dependencies.cache.lookupRequestSet(requestSetCacheInput);
    if (cachedRequests.status === "hit") {
      requests = cachedRequests.value;
      cacheSummary.requestSetHitCount += 1;
      events.push(
        createModelStepEvent(
          {
            type: "validation",
            summary: "已复用当前页面的结构化素材请求。",
            data: {
              pageId: input.content.pageId,
              requestCount: requests.length,
              cacheStatus: "hit",
            },
          },
          context,
          1,
          1,
        ),
      );
    } else if (cachedRequests.status === "miss") {
      cacheSummary.requestSetMissCount += 1;
    } else {
      cacheSummary.cacheErrorCount += 1;
    }
  } catch {
    cacheSummary.cacheErrorCount += 1;
  }

  if (!requests) {
    throwIfAborted(context.abortSignal);
    const promptState = await dependencies.runImagePrompt(input, context);
    throwIfAborted(context.abortSignal);
    events = [...promptState.events];

    if (promptState.status !== "completed" || !promptState.requests) {
      return {
        status: "failed",
        events,
        error: {
          code: promptState.error?.code ?? "IMAGE_PROMPT_FAILED",
          message:
            promptState.error?.message ?? "图片 Prompt 模型步骤未生成有效请求。",
        },
      };
    }

    requests = promptState.requests;
    try {
      const stored = await dependencies.cache.storeRequestSet(
        requestSetCacheInput,
        requests,
      );
      if (stored.status !== "stored") {
        cacheSummary.cacheErrorCount += 1;
      }
    } catch {
      cacheSummary.cacheErrorCount += 1;
    }
  }

  const registry = new ExecutableToolRegistry().register(
    dependencies.imageTool,
  );
  const results: AssetGenerationResult[] = [];
  const identity = dependencies.getImageModelIdentity();

  for (const request of requests) {
    throwIfAborted(context.abortSignal);
    const slot = input.content.assetSlots.find(
      ({ id }) => id === request.assetSlotId,
    );
    if (!slot) {
      return {
        status: "failed",
        events,
        requests,
        error: {
          code: "ASSET_SLOT_NOT_FOUND",
          message: `素材请求引用了不存在的槽位 ${request.assetSlotId}。`,
        },
      };
    }

    const altText = slot.role === "decorative" ? "" : slot.altTextGuidance;
    const cacheInput = identity
      ? {
          request,
          styleTemplateId: input.visualBrief.styleTemplateId,
          ...identity,
        }
      : undefined;
    let result: AssetGenerationResult | undefined;
    let resolutionSource: "cache" | "generated" | "fallback" = "generated";

    if (cacheInput) {
      const lookupStartedAt = Date.now();
      try {
        throwIfAborted(context.abortSignal);
        const lookup = await dependencies.cache.lookup(cacheInput);
        throwIfAborted(context.abortSignal);
        if (lookup.status === "hit") {
          try {
            result = AssetGenerationResultSchema.parse({
              request,
              status: "ready",
              asset: {
                ...lookup.value.asset,
                altText,
                generationPrompt: request.prompt,
                usedByPageIds: [input.content.pageId],
              },
              provider: lookup.value.provider,
              model: lookup.value.model,
              durationMs: Date.now() - lookupStartedAt,
              warnings: lookup.value.warnings,
            });
            resolutionSource = "cache";
            cacheSummary.hitCount += 1;
          } catch {
            cacheSummary.cacheErrorCount += 1;
          }
        } else if (lookup.status === "miss") {
          cacheSummary.missCount += 1;
        } else if (lookup.status === "stale") {
          cacheSummary.staleCount += 1;
        } else {
          cacheSummary.cacheErrorCount += 1;
        }
      } catch {
        cacheSummary.cacheErrorCount += 1;
      }
    } else {
      cacheSummary.bypassCount += 1;
    }

    if (!result) {
      throwIfAborted(context.abortSignal);
      cacheSummary.generatedCount += 1;
      result = await registry.execute<AssetGenerationResult>(
        dependencies.imageTool.name,
        {
          pageId: input.content.pageId,
          altText,
          request,
        },
        context,
      );
      throwIfAborted(context.abortSignal);

      if (result.status === "fallback") {
        resolutionSource = "fallback";
        cacheSummary.fallbackCount += 1;
      } else if (cacheInput) {
        try {
          const stored = await dependencies.cache.store(cacheInput, result);
          if (stored.status !== "stored") {
            cacheSummary.cacheErrorCount += 1;
          }
        } catch {
          cacheSummary.cacheErrorCount += 1;
        }
      }
    }

    results.push(result);
    events.push(
      createModelStepEvent(
        {
          type: resolutionSource === "cache" ? "validation" : "tool_call",
          summary:
            resolutionSource === "cache"
              ? `${request.assetSlotId} 已复用图片素材缓存。`
              : result.status === "ready"
                ? `${request.assetSlotId} 图片素材已生成。`
                : `${request.assetSlotId} 生图失败，已启用 ${result.fallback?.kind}。`,
          data: {
            assetSlotId: request.assetSlotId,
            assetType: request.assetType,
            resultStatus: result.status,
            resultUri: result.asset?.uri ?? null,
            errorCode: result.errorCode ?? null,
            cacheStatus: cacheInput ? resolutionSource : "bypassed",
          },
        },
        context,
        events.length + 1,
        2,
      ),
    );
  }

  events.push(
    createModelStepEvent(
      {
        type: "validation",
        summary: [
          `素材解析完成：请求集命中 ${cacheSummary.requestSetHitCount}`,
          `请求集未命中 ${cacheSummary.requestSetMissCount}`,
          `图片命中 ${cacheSummary.hitCount}`,
          `未命中 ${cacheSummary.missCount}`,
          `失效 ${cacheSummary.staleCount}`,
          `本次生图 ${cacheSummary.generatedCount}`,
          `降级 ${cacheSummary.fallbackCount}`,
          `缓存异常 ${cacheSummary.cacheErrorCount}`,
          `绕过 ${cacheSummary.bypassCount}。`,
        ].join("，"),
        data: cacheSummary,
      },
      context,
      events.length + 1,
      2,
    ),
  );

  return {
    status: "completed",
    events,
    requests,
    results,
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("aborted", "AbortError");
  }
}

function getConfiguredImageModelIdentity(): ImageModelIdentity | undefined {
  try {
    const config = getImageModelConfig();
    return { provider: config.providerName, model: config.modelName };
  } catch {
    return undefined;
  }
}
