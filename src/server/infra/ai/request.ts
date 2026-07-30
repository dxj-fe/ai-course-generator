import type { UIMessage } from "ai";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "./error";

type AiRequestBody = {
  maxTokens?: unknown;
  messages?: UIMessage[];
  prompt?: string;
  system?: unknown;
  systemPrompt?: unknown;
  temperature?: unknown;
  traceId?: unknown;
};

export type AiRequest = {
  maxTokens?: number;
  messages: UIMessage[];
  systemPrompt?: string;
  temperature?: number;
  traceId: string;
};

export async function readAiRequest(
  req: Request,
): Promise<AiRequest | Response> {
  const traceId = readTraceId(req);
  const body = await req.text();

  if (!body) {
    return createAiErrorResponse(
      new AiRequestError("请求体为空，请通过聊天页面发送消息。"),
      traceId,
    );
  }

  let requestBody: AiRequestBody;

  try {
    requestBody = JSON.parse(body);
  } catch {
    return createAiErrorResponse(
      new AiRequestError("请求体不是有效的 JSON。"),
      traceId,
    );
  }

  const requestTraceId =
    typeof requestBody.traceId === "string" && requestBody.traceId.trim()
      ? requestBody.traceId.trim()
      : traceId;
  const systemPrompt = readOptionalString(
    requestBody.systemPrompt ?? requestBody.system,
  );
  const temperature = readOptionalNumber(requestBody.temperature, {
    field: "temperature",
    min: 0,
    max: 2,
    traceId: requestTraceId,
  });
  const maxTokens = readOptionalInteger(requestBody.maxTokens, {
    field: "maxTokens",
    min: 1,
    max: 8_000,
    traceId: requestTraceId,
  });

  if (temperature instanceof Response) {
    return temperature;
  }

  if (maxTokens instanceof Response) {
    return maxTokens;
  }

  if (Array.isArray(requestBody.messages) && requestBody.messages.length > 0) {
    return {
      maxTokens,
      messages: requestBody.messages,
      systemPrompt,
      temperature,
      traceId: requestTraceId,
    };
  }

  const prompt = requestBody.prompt?.trim();

  if (prompt) {
    return {
      maxTokens,
      messages: [
        {
          id: "user-prompt",
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
      ] satisfies UIMessage[],
      systemPrompt,
      temperature,
      traceId: requestTraceId,
    };
  }

  return createAiErrorResponse(
    new AiRequestError("请求体缺少有效的 prompt 或 messages 数组。"),
    requestTraceId,
  );
}

function readTraceId(req: Request) {
  return req.headers.get("x-trace-id")?.trim() || createTraceId();
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalNumber(
  value: unknown,
  options: { field: string; min: number; max: number; traceId: string },
) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return createAiErrorResponse(
      new AiRequestError(`${options.field} 必须是数字。`),
      options.traceId,
    );
  }

  if (value < options.min || value > options.max) {
    return createAiErrorResponse(
      new AiRequestError(
        `${options.field} 必须在 ${options.min} 到 ${options.max} 之间。`,
      ),
      options.traceId,
    );
  }

  return value;
}

function readOptionalInteger(
  value: unknown,
  options: { field: string; min: number; max: number; traceId: string },
) {
  const numberValue = readOptionalNumber(value, options);

  if (numberValue instanceof Response || numberValue === undefined) {
    return numberValue;
  }

  if (!Number.isInteger(numberValue)) {
    return createAiErrorResponse(
      new AiRequestError(`${options.field} 必须是整数。`),
      options.traceId,
    );
  }

  return numberValue;
}
