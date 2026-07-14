import {
  convertToModelMessages,
  generateText,
  Output,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { z } from "zod";

import { getLanguageModel } from "./model-provider";
import { AiSchemaValidationError, toAiErrorPayload } from "./error";

const DEFAULT_TEXT_TIMEOUT_MS = 30_000;
const DEFAULT_STRUCTURED_TIMEOUT_MS = 60_000;

export type AiClientRequest = {
  messages: UIMessage[];
  systemPrompt?: string;
  promptVersion?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  traceId: string;
  model?: LanguageModel;
  abortSignal?: AbortSignal;
};

export type StructuredAiClientRequest<T> = {
  abortSignal?: AbortSignal;
  maxTokens?: number;
  model?: LanguageModel;
  prompt: string;
  promptVersion?: string;
  schema: z.ZodType<T>;
  schemaDescription?: string;
  schemaName: string;
  systemPrompt?: string;
  temperature?: number;
  traceId: string;
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
      timeout: request.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
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
      timeout: request.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
      abortSignal: request.abortSignal,
      onError: ({ error }) => logAiError("stream:error", error, traceId, startedAt),
      onFinish: () => logAiFinish("stream:finish", traceId, startedAt),
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

    const result = await generateText({
      model: request.model ?? getLanguageModel(),
      instructions: request.systemPrompt,
      prompt: request.prompt,
      output: Output.json({
        name: request.schemaName,
        description: request.schemaDescription,
      }),
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      // 课程规划类结构化响应比普通文本更长，30 秒会在模型仍正常输出时误杀请求。
      timeout: DEFAULT_STRUCTURED_TIMEOUT_MS,
      abortSignal: request.abortSignal,
    });
    const parsed = request.schema.safeParse(result.output);

    if (!parsed.success) {
      throw new AiSchemaValidationError(
        `结构化输出校验失败：${formatZodIssues(parsed.error)}`,
      );
    }

    logAiFinish("generate-object:finish", traceId, startedAt);
    return parsed.data;
  } catch (error) {
    logAiError("generate-object:error", error, traceId, startedAt);
    throw error;
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
    messageCount: request.messages.length,
    hasSystemPrompt: Boolean(request.systemPrompt),
    temperature: request.temperature,
      maxTokens: request.maxTokens,
      promptVersion: request.promptVersion,
      timeoutMs: request.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
  });
}

function logStructuredAiEvent<T>(
  event: string,
  request: StructuredAiClientRequest<T>,
) {
  console.info("[ai]", {
    event,
    traceId: request.traceId,
    promptLength: request.prompt.length,
    promptVersion: request.promptVersion,
    schemaName: request.schemaName,
    hasSystemPrompt: Boolean(request.systemPrompt),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    timeoutMs: DEFAULT_STRUCTURED_TIMEOUT_MS,
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
