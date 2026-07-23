export type ModelTier = "cheap" | "balanced" | "strong";

export type AiCapability =
  | "general"
  | "html"
  | "image-prompt"
  | "intent"
  | "page-qa"
  | "page-writer"
  | "pedagogy"
  | "planner"
  | "reference-summary"
  | "repair"
  | "single-page"
  | "story"
  | "supervisor"
  | "template-selector"
  | "visual";

export type ModelRoute = {
  primary: ModelTier;
  fallback?: ModelTier;
};

const STRONG_CAPABILITIES = new Set<AiCapability>([
  "html",
  "page-qa",
  "planner",
  "repair",
]);
const CHEAP_CAPABILITIES = new Set<AiCapability>([
  "intent",
  "reference-summary",
  "supervisor",
  "template-selector",
]);

/** 路由规则是服务端业务配置，模型和前端都不能自行选择档位。 */
export function resolveModelRoute(capability: AiCapability): ModelRoute {
  if (STRONG_CAPABILITIES.has(capability)) {
    return { primary: "strong", fallback: "balanced" };
  }
  if (CHEAP_CAPABILITIES.has(capability)) {
    return { primary: "cheap", fallback: undefined };
  }
  return { primary: "balanced", fallback: "cheap" };
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
  const status = readStatus(record);
  if (status === 429 || (status !== undefined && status >= 500 && status <= 504)) {
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
