export type AiErrorCode =
  | "CANCELLED_ERROR"
  | "CONFIG_ERROR"
  | "MODEL_ERROR"
  | "REQUEST_ERROR"
  | "SCHEMA_ERROR"
  | "TIMEOUT_ERROR"
  | "UNKNOWN_ERROR";

export type AiErrorPayload = {
  code: AiErrorCode;
  message: string;
  traceId: string;
};

type ClassifiedAiError = {
  code: AiErrorCode;
  message: string;
  status: number;
};

export class AiRequestError extends Error {
  readonly code = "REQUEST_ERROR" as const;
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "AiRequestError";
  }
}

export class AiSchemaValidationError extends Error {
  readonly code = "SCHEMA_ERROR" as const;
  readonly status = 502;

  constructor(message: string) {
    super(message);
    this.name = "AiSchemaValidationError";
  }
}

export function createTraceId() {
  return crypto.randomUUID();
}

export function toAiErrorPayload(
  error: unknown,
  traceId: string,
): AiErrorPayload {
  const classified = classifyAiError(error);

  return {
    code: classified.code,
    message: classified.message,
    traceId,
  };
}

export function createAiErrorResponse(error: unknown, traceId: string) {
  const classified = classifyAiError(error);

  return Response.json(
    {
      code: classified.code,
      message: classified.message,
      traceId,
    } satisfies AiErrorPayload,
    { status: classified.status },
  );
}

function classifyAiError(error: unknown): ClassifiedAiError {
  if (error instanceof AiRequestError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  if (error instanceof AiSchemaValidationError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  if (error instanceof Error) {
    if (isConfigError(error)) {
      return {
        code: "CONFIG_ERROR",
        message:
          "模型配置缺失，请优先检查 ARK_API_KEY、ARK_MODEL_ID 和可选 ARK_BASE_URL；或检查通用 MODEL_API_KEY、MODEL_BASE_URL、MODEL_NAME。",
        status: 500,
      };
    }

    if (isAbortError(error)) {
      return {
        code: "CANCELLED_ERROR",
        message: "模型调用已取消。",
        status: 499,
      };
    }

    if (isTimeoutError(error)) {
      return {
        code: "TIMEOUT_ERROR",
        message: "模型调用超时，请稍后重试或降低输出长度。",
        status: 504,
      };
    }

    return {
      code: "MODEL_ERROR",
      message: error.message || "模型调用失败。",
      status: 500,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "未知 AI 调用错误。",
    status: 500,
  };
}

function isConfigError(error: Error) {
  return error.message.startsWith("Missing required environment variable:");
}

function isTimeoutError(error: Error) {
  const normalizedName = error.name.toLowerCase();
  const normalizedMessage = error.message.toLowerCase();

  return (
    normalizedName.includes("timeout") ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out")
  );
}

function isAbortError(error: Error) {
  return error.name === "AbortError" || error.message.toLowerCase() === "aborted";
}
