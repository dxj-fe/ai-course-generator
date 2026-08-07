export type ModelTier = "cheap" | "balanced" | "strong";

export type AiCapability =
  | "course-architecture"
  | "course-review"
  | "general"
  | "html"
  | "html-repair"
  | "image-prompt"
  | "page-qa"
  | "page-writer"
  | "pedagogy"
  | "planner"
  | "reference-summary"
  | "repair"
  | "story"
  | "template-selector"
  | "visual";

export type ModelRoute = {
  primary: ModelTier;
  fallback?: ModelTier;
};

/** 路由规则是服务端业务配置，模型和前端都不能自行选择档位。 */
export function resolveModelRoute(capability: AiCapability): ModelRoute {
  void capability;
  // 当前质量收敛阶段统一使用 Doubao Seed 2.0 Pro。不做
  // mini/lite 降级，避免把模型差异与 Harness/Agent 故障混在一起。
  return { primary: "strong" };
}

/** 只允许一次瞬时供应商错误降级；取消、Schema 和业务错误不得重试。 */
export function isRetryableModelError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }

  const record = isRecord(error) ? error : undefined;
  if (
    record?.code === "SCHEMA_ERROR" ||
    record?.code === "REQUEST_ERROR"
  ) {
    return false;
  }
  const status = readStatus(record);
  if (
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 504)
  ) {
    return true;
  }

  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === "string"
        ? error.toLowerCase()
        : "";

  return (
    name.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("rate limit")
  );
}

function readStatus(record: Record<string, unknown> | undefined) {
  const direct = record?.statusCode ?? record?.status;
  if (typeof direct === "number") return direct;
  const response = isRecord(record?.response) ? record.response : undefined;
  return typeof response?.status === "number" ? response.status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
