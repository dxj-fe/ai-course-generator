export type ModelTier = "cheap" | "balanced" | "strong";

export type AiCapability =
  | "course-architecture"
  | "course-review"
  | "general"
  | "html"
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

const STRONG_CAPABILITIES = new Set<AiCapability>([
  "page-qa",
  "page-writer",
  "pedagogy",
  "planner",
  "repair",
  "story",
  "visual",
]);
const CHEAP_CAPABILITIES = new Set<AiCapability>([
  "reference-summary",
  "template-selector",
]);

/** 路由规则是服务端业务配置，模型和前端都不能自行选择档位。 */
export function resolveModelRoute(capability: AiCapability): ModelRoute {
  // 课程架构需要长工具回合。当前平衡档在完整输出和终态工具提交上更稳定，
  // 强档作为失败升级；Blueprint Gate 与 Director 继续承担独立质量验收。
  if (capability === "course-architecture") {
    return { primary: "balanced", fallback: "strong" };
  }
  // 整课审查依赖多轮工具调用。平衡档在长工具回合中比强档更稳定，
  // 仅在供应商失败时再升级强档，避免整课已经生成却卡在发布 Gate。
  if (capability === "course-review") {
    return { primary: "balanced", fallback: "strong" };
  }
  // 当前强档 HTML 模型在固定 120s 窗口内频繁超时；平衡档能稳定完成长 HTML
  // 输出，失败时再升级强档，比每页先等待一次超时更可靠。
  if (capability === "html") {
    return { primary: "balanced", fallback: "strong" };
  }
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
