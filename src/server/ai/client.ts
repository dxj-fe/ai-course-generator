import {
  convertToModelMessages,
  generateText,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { getLanguageModel } from "./model-provider";
import { toAiErrorPayload } from "./error";

const DEFAULT_TIMEOUT_MS = 30_000;

export type AiClientRequest = {
  messages: UIMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  traceId: string;
  model?: LanguageModel;
  abortSignal?: AbortSignal;
};

export async function generateTextSafe(request: AiClientRequest) {
  const { traceId } = request;
  const startedAt = Date.now();

  try {
    logAiEvent("generate:start", request);

    const result = await generateText({
      model: request.model ?? getLanguageModel(),
      messages: await convertToModelMessages(request.messages),
      instructions: request.systemPrompt,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      timeout: DEFAULT_TIMEOUT_MS,
      abortSignal: request.abortSignal,
    });

    logAiFinish("generate:finish", traceId, startedAt);
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

    return streamText({
      model: request.model ?? getLanguageModel(),
      messages: await convertToModelMessages(request.messages),
      instructions: request.systemPrompt,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      timeout: DEFAULT_TIMEOUT_MS,
      abortSignal: request.abortSignal,
      onError: ({ error }) => logAiError("stream:error", error, traceId, startedAt),
      onFinish: () => logAiFinish("stream:finish", traceId, startedAt),
    });
  } catch (error) {
    logAiError("stream:error", error, traceId, startedAt);
    throw error;
  }
}

function logAiEvent(event: string, request: AiClientRequest) {
  console.info("[ai]", {
    event,
    traceId: request.traceId,
    messageCount: request.messages.length,
    hasSystemPrompt: Boolean(request.systemPrompt),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  });
}

function logAiFinish(event: string, traceId: string, startedAt: number) {
  console.info("[ai]", {
    event,
    traceId,
    durationMs: Date.now() - startedAt,
  });
}

function logAiError(
  event: string,
  error: unknown,
  traceId: string,
  startedAt: number,
) {
  console.error("[ai]", {
    event,
    ...toAiErrorPayload(error, traceId),
    durationMs: Date.now() - startedAt,
  });
}
