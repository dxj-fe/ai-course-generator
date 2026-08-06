import {
  convertToModelMessages,
  generateText,
  Output,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { z } from "zod";

import {
  AiSchemaValidationError,
  serializeErrorForLog,
  toAiErrorPayload,
} from "./error";
import {
  getHtmlLanguageModel,
  getHtmlLanguageModelIdentity,
  getLanguageModel,
  getLanguageModelIdentity,
} from "./model-provider";
import {
  isRetryableModelError,
  resolveModelRoute,
  type AiCapability,
  type ModelTier,
} from "./model-router";
import {
  aiResultCache,
  createAiResultCacheKey,
} from "./result-cache";

const DEFAULT_TEXT_TIMEOUT_MS = 30_000;
const DEFAULT_STRUCTURED_TIMEOUT_MS = 60_000;

type AiCacheRequest = {
  input: unknown;
  namespace: string;
  schemaFingerprint: string;
};

export type AiClientRequest = {
  abortSignal?: AbortSignal;
  capability?: AiCapability;
  fallbackTimeoutMs?: number;
  maxTokens?: number;
  messages: UIMessage[];
  model?: LanguageModel;
  promptFingerprint?: string;
  systemPrompt?: string;
  temperature?: number;
  timeoutMs?: number;
  traceId: string;
};

export type StructuredAiClientRequest<T> = {
  abortSignal?: AbortSignal;
  cache?: AiCacheRequest;
  capability?: AiCapability;
  fallbackTimeoutMs?: number;
  includeSchemaInPrompt?: boolean;
  maxTokens?: number;
  /**
   * Optional multimodal UI messages. When present they replace `prompt` as the
   * model input while `prompt` remains the text-only fingerprint/logging source.
   */
  messages?: UIMessage[];
  model?: LanguageModel;
  normalizeOutput?: (output: unknown) => unknown;
  prompt: string;
  promptFingerprint?: string;
  schema: z.ZodType<T>;
  schemaDescription?: string;
  schemaName: string;
  systemPrompt?: string;
  temperature?: number;
  timeoutMs?: number;
  traceId: string;
};

type ModelCandidate = {
  identity: string;
  model: LanguageModel;
  tier: ModelTier | "custom";
};

export async function generateTextSafe(request: AiClientRequest) {
  const { traceId } = request;
  const startedAt = Date.now();

  try {
    logAiEvent("generate:start", request);
    throwIfAborted(request.abortSignal);
    const messages = await convertToModelMessages(request.messages);
    const { result, selected } = await executeWithFallback(
      request,
      (model, candidateIndex) =>
        generateText({
          model,
          messages,
          instructions: request.systemPrompt,
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          timeout:
            candidateIndex > 0
              ? request.fallbackTimeoutMs ??
                request.timeoutMs ??
                DEFAULT_TEXT_TIMEOUT_MS
              : request.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
          abortSignal: request.abortSignal,
        }),
    );

    logAiFinish("generate:finish", traceId, startedAt, {
      model: selected.identity,
      modelTier: selected.tier,
      usage: result.usage,
    });
    return result;
  } catch (error) {
    logAiError("generate:error", error, traceId, startedAt);
    throw error;
  }
}

export async function streamTextSafe(request: AiClientRequest) {
  const { traceId } = request;
  const startedAt = Date.now();

  try {
    logAiEvent("stream:start", request);
    throwIfAborted(request.abortSignal);
    const selected = resolveModelCandidates(request)[0]!;

    return streamText({
      model: selected.model,
      messages: await convertToModelMessages(request.messages),
      instructions: request.systemPrompt,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      timeout: request.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
      abortSignal: request.abortSignal,
      onError: ({ error }) =>
        logAiError("stream:error", error, traceId, startedAt),
      onFinish: ({ usage }) =>
        logAiFinish("stream:finish", traceId, startedAt, {
          model: selected.identity,
          modelTier: selected.tier,
          usage,
        }),
    });
  } catch (error) {
    logAiError("stream:error", error, traceId, startedAt);
    throw error;
  }
}

export async function generateStructuredObjectSafe<T>(
  request: StructuredAiClientRequest<T>,
) {
  const { traceId } = request;
  const startedAt = Date.now();

  try {
    logStructuredAiEvent("generate-object:start", request);
    throwIfAborted(request.abortSignal);
    const candidates = resolveModelCandidates(request);
    const cacheKey = createRequestCacheKey(request, candidates[0]);
    if (cacheKey) {
      const cached = aiResultCache.lookup(cacheKey, request.schema);
      if (cached.status === "hit") {
        throwIfAborted(request.abortSignal);
        logAiFinish("generate-object:finish", traceId, startedAt, {
          cacheStatus: "hit",
          model: candidates[0]!.identity,
          modelTier: candidates[0]!.tier,
        });
        return cached.value;
      }
    }

    const { result, selected } = await executeWithFallback(
      request,
      async (model, candidateIndex) => {
        const modelInput = request.messages
          ? {
              messages: await convertToModelMessages(request.messages),
            }
          : { prompt: request.prompt };
        const generated = await generateText({
          model,
          instructions: structuredOutputInstructions(request),
          ...modelInput,
          output: Output.json({
            name: request.schemaName,
            description: request.schemaDescription,
          }),
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          // 课程规划类结构化响应比普通文本更长，30 秒会在模型仍正常输出时误杀请求。
          timeout:
            candidateIndex > 0
              ? request.fallbackTimeoutMs ??
                request.timeoutMs ??
                DEFAULT_STRUCTURED_TIMEOUT_MS
              : request.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS,
          abortSignal: request.abortSignal,
        });
        const normalizedOutput = request.normalizeOutput
          ? request.normalizeOutput(generated.output)
          : generated.output;
        const parsed = request.schema.safeParse(normalizedOutput);

        if (!parsed.success) {
          throw new AiSchemaValidationError(
            `结构化输出校验失败：${formatZodIssues(parsed.error)}`,
          );
        }

        return { data: parsed.data, usage: generated.usage };
      },
      candidates,
      isRetryableModelError,
    );

    throwIfAborted(request.abortSignal);
    const storedCacheKey = createRequestCacheKey(request, selected);
    const cacheStored = storedCacheKey
      ? aiResultCache.store(storedCacheKey, result.data, request.schema)
      : false;
    logAiFinish("generate-object:finish", traceId, startedAt, {
      cacheStatus: cacheStored ? "stored" : request.cache ? "skipped" : "bypassed",
      model: selected.identity,
      modelTier: selected.tier,
      usage: result.usage,
    });
    return result.data;
  } catch (error) {
    logAiError("generate-object:error", error, traceId, startedAt, {
      capability: request.capability ?? "general",
      promptFingerprint: request.promptFingerprint,
      schemaName: request.schemaName,
    });
    throw error;
  }
}

function structuredOutputInstructions<T>(
  request: StructuredAiClientRequest<T>,
) {
  if (!request.includeSchemaInPrompt) return request.systemPrompt;

  const schemaInstruction = [
    "# 输出 JSON Schema",
    "返回值必须严格满足下面由服务端生成的 JSON Schema；不要把 Schema 本身返回。",
    JSON.stringify(z.toJSONSchema(request.schema)),
  ].join("\n\n");

  return request.systemPrompt
    ? `${request.systemPrompt}\n\n${schemaInstruction}`
    : schemaInstruction;
}

async function executeWithFallback<T>(
  request: Pick<AiClientRequest, "abortSignal" | "capability" | "model" | "traceId">,
  execute: (model: LanguageModel, candidateIndex: number) => Promise<T>,
  resolvedCandidates?: ModelCandidate[],
  canFallback: (error: unknown) => boolean = isRetryableModelError,
) {
  const candidates = resolvedCandidates ?? resolveModelCandidates(request);
  let latestError: unknown;

  for (const [index, candidate] of candidates.entries()) {
    if (request.abortSignal?.aborted) {
      throw request.abortSignal.reason ?? new DOMException("aborted", "AbortError");
    }
    try {
      const result = await execute(candidate.model, index);
      throwIfAborted(request.abortSignal);
      return { result, selected: candidate };
    } catch (error) {
      latestError = error;
      const fallback = candidates[index + 1];
      if (
        !fallback ||
        request.abortSignal?.aborted ||
        !canFallback(error)
      ) {
        throw error;
      }
      console.warn("[ai]", {
        event: "model:fallback",
        traceId: request.traceId,
        fromModel: candidate.identity,
        fromTier: candidate.tier,
        toModel: fallback.identity,
        toTier: fallback.tier,
        reason: toAiErrorPayload(error, request.traceId).code,
      });
    }
  }

  throw latestError;
}

function resolveModelCandidates(
  request: Pick<AiClientRequest, "capability" | "model">,
): ModelCandidate[] {
  if (request.model) {
    return [{ identity: "custom-model", model: request.model, tier: "custom" }];
  }

  const route = resolveModelRoute(request.capability ?? "general");
  const tiers = route.fallback
    ? [route.primary, route.fallback]
    : [route.primary];
  const candidates: ModelCandidate[] = tiers.map((tier) => ({
    identity: getLanguageModelIdentity(tier),
    model: getLanguageModel(tier),
    tier,
  }));

  if (request.capability === "html") {
    const htmlModel = getHtmlLanguageModel();
    const htmlIdentity = htmlModel
      ? getHtmlLanguageModelIdentity()
      : undefined;

    if (htmlModel && htmlIdentity) {
      candidates.unshift({
        identity: htmlIdentity,
        model: htmlModel,
        tier: "custom",
      });
    }
  }

  return candidates.filter(
    ({ identity }, index) =>
      candidates.findIndex((candidate) => candidate.identity === identity) ===
      index,
  );
}

function createRequestCacheKey<T>(
  request: StructuredAiClientRequest<T>,
  candidate: ModelCandidate | undefined,
) {
  if (!request.cache || !request.promptFingerprint || !candidate) return undefined;
  if (candidate.tier === "custom") return undefined;

  try {
    return createAiResultCacheKey({
      input: request.cache.input,
      model: candidate.identity,
      namespace: request.cache.namespace,
      promptFingerprint: request.promptFingerprint,
      schemaFingerprint: request.cache.schemaFingerprint,
    });
  } catch {
    return undefined;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("aborted", "AbortError");
  }
}

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const field = issue.path.length ? issue.path.join(".") : "root";
      return `${field}: ${issue.message}`;
    })
    .join("; ");
}

function logAiEvent(event: string, request: AiClientRequest) {
  console.info("[ai]", {
    event,
    traceId: request.traceId,
    capability: request.capability ?? "general",
    messageCount: request.messages.length,
    hasSystemPrompt: Boolean(request.systemPrompt),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    promptFingerprint: request.promptFingerprint,
    timeoutMs: request.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
    fallbackTimeoutMs: request.fallbackTimeoutMs,
  });
}

function logStructuredAiEvent<T>(
  event: string,
  request: StructuredAiClientRequest<T>,
) {
  console.info("[ai]", {
    event,
    traceId: request.traceId,
    capability: request.capability ?? "general",
    promptLength: request.prompt.length,
    messageCount: request.messages?.length,
    promptFingerprint: request.promptFingerprint,
    schemaName: request.schemaName,
    hasSystemPrompt: Boolean(request.systemPrompt),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    timeoutMs: request.timeoutMs ?? DEFAULT_STRUCTURED_TIMEOUT_MS,
    fallbackTimeoutMs: request.fallbackTimeoutMs,
  });
}

function logAiFinish(
  event: string,
  traceId: string,
  startedAt: number,
  telemetry: {
    cacheStatus?: "bypassed" | "hit" | "skipped" | "stored";
    model?: string;
    modelTier?: ModelTier | "custom";
    usage?: unknown;
  } = {},
) {
  console.info("[ai]", {
    event,
    traceId,
    durationMs: Date.now() - startedAt,
    ...telemetry,
  });
}

function logAiError(
  event: string,
  error: unknown,
  traceId: string,
  startedAt: number,
  context: {
    capability?: AiCapability | "general";
    promptFingerprint?: string;
    schemaName?: string;
  } = {},
) {
  console.error("[ai]", {
    event,
    ...context,
    ...toAiErrorPayload(error, traceId),
    ...serializeErrorForLog(error),
    durationMs: Date.now() - startedAt,
  });
}
