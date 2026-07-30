export type AiErrorCode =
  | "CANCELLED_ERROR"
  | "CONFIG_ERROR"
  | "AUTH_ERROR"
  | "MODEL_ERROR"
  | "QUOTA_ERROR"
  | "RATE_LIMIT_ERROR"
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
  const diagnostic = serializeErrorForLog(error);

  console.error("[api]", {
    event: "request:error",
    traceId,
    code: classified.code,
    message: classified.message,
    ...diagnostic,
  });

  return Response.json(
    {
      code: classified.code,
      message: classified.message,
      traceId,
    } satisfies AiErrorPayload,
    { status: classified.status },
  );
}

/** 控制台只记录诊断字段，不回显 Prompt、HTML、请求体或 Provider 凭据。 */
export function serializeErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 4_000),
      errorStack: error.stack?.slice(0, 8_000),
    };
  }

  return {
    errorName: typeof error,
    errorMessage: String(error).slice(0, 4_000),
    errorStack: undefined,
  };
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
      message: "模型返回的内容格式不完整，请重新生成。",
      status: error.status,
    };
  }

  if (error instanceof Error || isRecord(error)) {
    if (error instanceof Error && isConfigError(error)) {
      return {
        code: "CONFIG_ERROR",
        message:
          "模型配置缺失，请优先检查 ARK_API_KEY、ARK_MODEL_ID 和可选 ARK_BASE_URL；或检查通用 MODEL_API_KEY、MODEL_BASE_URL、MODEL_NAME。",
        status: 500,
      };
    }

    if (error instanceof Error && isAbortError(error)) {
      return {
        code: "CANCELLED_ERROR",
        message: "模型调用已取消。",
        status: 499,
      };
    }

    const status = readStatus(error);
    const signature = readErrorSignature(error);

    if (isQuotaError(status, signature)) {
      return {
        code: "QUOTA_ERROR",
        message: "模型服务额度不足，请检查账户额度或计费状态后重试。",
        status: 402,
      };
    }

    if (isAuthError(status, signature)) {
      return {
        code: "AUTH_ERROR",
        message: "模型服务认证失败，请检查 API Key 或访问权限。",
        status: status === 403 ? 403 : 401,
      };
    }

    if (isRateLimitError(status, signature)) {
      return {
        code: "RATE_LIMIT_ERROR",
        message: "模型服务当前请求较多，请稍后重试。",
        status: 429,
      };
    }

    if (isTimeoutError(error, status, signature)) {
      return {
        code: "TIMEOUT_ERROR",
        message: "模型调用超时，请稍后重试或降低输出长度。",
        status: 504,
      };
    }

    return {
      code: "MODEL_ERROR",
      message: "模型服务未返回有效结果，请稍后重试。",
      status:
        status !== undefined && status >= 400 && status <= 599 ? status : 500,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "未知 AI 调用错误。",
    status: 500,
  };
}

function isConfigError(error: Error) {
  return (
    error.message.startsWith("Missing required environment variable:") ||
    /^MODEL_PROVIDER_(?:CHEAP|BALANCED|STRONG) must be/.test(error.message)
  );
}

function isQuotaError(status: number | undefined, signature: string) {
  return (
    status === 402 ||
    /insufficient[_ -]?quota|quota (?:is )?exceeded|billing|credit|balance/.test(
      signature,
    )
  );
}

function isAuthError(status: number | undefined, signature: string) {
  return (
    status === 401 ||
    status === 403 ||
    /authentication|unauthorized|forbidden|invalid[_ -]?(?:api[_ -]?)?key|incorrect[_ -]?(?:api[_ -]?)?key/.test(
      signature,
    )
  );
}

function isRateLimitError(status: number | undefined, signature: string) {
  return (
    status === 429 ||
    /rate[_ -]?limit|too many requests|requests per (?:minute|second)/.test(
      signature,
    )
  );
}

function isTimeoutError(
  error: Error | Record<string, unknown>,
  status: number | undefined,
  signature: string,
) {
  return (
    status === 408 ||
    status === 504 ||
    (error instanceof Error && error.name.toLowerCase().includes("timeout")) ||
    signature.includes("timeout") ||
    signature.includes("timed out") ||
    signature.includes("etimedout")
  );
}

function isAbortError(error: Error) {
  return error.name === "AbortError" || error.message.toLowerCase() === "aborted";
}

function readStatus(error: Error | Record<string, unknown>) {
  const record = error as {
    response?: { status?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const direct = record.statusCode ?? record.status;
  if (typeof direct === "number") return direct;
  return typeof record.response?.status === "number"
    ? record.response.status
    : undefined;
}

function readErrorSignature(error: Error | Record<string, unknown>) {
  const record = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    responseBody?: unknown;
    type?: unknown;
  };
  return [
    typeof record.name === "string" ? record.name : "",
    typeof record.message === "string" ? record.message : "",
    typeof record.code === "string" ? record.code : "",
    typeof record.type === "string" ? record.type : "",
    typeof record.responseBody === "string" ? record.responseBody : "",
  ]
    .join(" ")
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
