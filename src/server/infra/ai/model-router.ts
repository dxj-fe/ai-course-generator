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

const STRONG_CAPABILITIES = new Set<AiCapability>([
  "html-repair",
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
  // 课程架构是多步工具循环；平衡档能在单次预算内完成 Gate 修复，
  // 强档只在供应商瞬时失败时兜底，避免主档耗尽整个 WorkOrder。
  if (capability === "course-architecture") {
    return { primary: "balanced", fallback: "strong" };
  }
  // 整课审查要综合页面证据与教学目标，保持质量优先；供应商瞬时失败时
  // 才降级，不能默认让较弱模型决定整课是否可发布。
  if (capability === "course-review") {
    return { primary: "strong", fallback: "balanced" };
  }
  // 专用代码模型失败后仍优先保住教学图示与构图质量；只有强档也遇到
  // 瞬时供应商故障时才降级到平衡档。
  if (capability === "html") {
    return { primary: "strong", fallback: undefined };
  }
  if (capability === "html-repair") {
    return { primary: "strong", fallback: undefined };
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
