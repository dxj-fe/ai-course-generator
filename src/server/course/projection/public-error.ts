import { toAiErrorPayload } from "@/server/infra/ai/error";
import { PUBLIC_COURSE_ERROR_CODES } from "@/server/course/projection/public-error-codes";
import type {
  CourseGenerationCauseCode,
  CourseGenerationState,
  CourseTaskStreamMessage,
} from "@/shared/course-schema";

const DIAGNOSTIC_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
const PRIVATE_FIELD_PATTERN =
  /(["']?)(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;，；]+)/gi;
const PRIVATE_CONTEXT_PATTERN =
  /(["']?)(private[_-]?prompt|system[_-]?prompt|prompt|request[_-]?body|requestBodyValues|messages?)\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;，；]+)/gi;
const PRIVATE_MATERIAL_MARKER =
  /(?:\b(?:authorization|api(?:[_ -]?key)|access[_ -]?token|refresh[_ -]?token|token|secret|password|private[_ -]?prompt|system[_ -]?prompt|prompt|request[_ -]?body|requestBodyValues|messages?)\b\s*[:=]|\bBearer\s+\S+|\b(?:sk|ak)-[A-Za-z0-9._~+/=-]{6,})/i;
const FILE_URL_PATH_PATTERN =
  /\bfile:\/\/[^\s，。；,;)\]}"'`]+/gi;
const UNIX_ABSOLUTE_PATH_PATTERN =
  /(^|[\s([{"'`=：:，。；,;])\/(?!\/)[^\s，。；,;)\]}"'`]+/g;

export type PublicAgentError = {
  code: string;
  causeCode?: CourseGenerationCauseCode;
  message: string;
};

/**
 * Agent 与 Provider 异常在进入持久化层前统一收敛。原始异常只用于进程内日志，
 * WorkOrder、CourseRun 和公开事件只保存稳定错误码与固定公开文案。
 */
export function classifyPublicAgentError(input: {
  error?: unknown;
  code?: unknown;
  fallbackCode?: string;
}): PublicAgentError {
  const classifiedCode = input.error
    ? toAiErrorPayload(input.error, "public-error").code
    : undefined;
  const code = sanitizePublicErrorCode(
    input.code ?? readErrorCode(input.error),
    classifiedCode ??
      input.fallbackCode ??
      "AGENT_EXECUTION_FAILED",
  );
  const causeCode =
    toCourseGenerationCauseCode(code) ??
    toCourseGenerationCauseCode(classifiedCode);

  return {
    code,
    causeCode,
    message: publicMessageFor(classifiedCode ?? causeCode, code),
  };
}

/** 清洗公开诊断文本；错误仍应优先经过固定文案分类。 */
export function sanitizePublicDiagnosticText(
  value: unknown,
  options: {
    fallback: string;
    maxLength: number;
  },
) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (PRIVATE_MATERIAL_MARKER.test(normalized)) {
    return options.fallback.slice(0, options.maxLength);
  }
  const redacted = normalized
    .replace(/<[^>]*>/g, " ")
    .replace(FILE_URL_PATH_PATTERN, "[路径已隐藏]")
    .replace(
      UNIX_ABSOLUTE_PATH_PATTERN,
      (_match, prefix: string) => `${prefix}[路径已隐藏]`,
    )
    .replace(/[A-Za-z]:\\[^\s，。；,;]+/g, "[路径已隐藏]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [凭据已隐藏]")
    .replace(
      /\b(?:sk|ak)-[A-Za-z0-9._~+/=-]{6,}\b/gi,
      "[凭据已隐藏]",
    )
    .replace(PRIVATE_FIELD_PATTERN, "[凭据已隐藏]")
    .replace(PRIVATE_CONTEXT_PATTERN, "[私有内容已隐藏]")
    .replace(/\s+/g, " ")
    .trim();

  return (redacted || options.fallback).slice(0, options.maxLength);
}

export function sanitizePublicErrorCode(
  value: unknown,
  fallback = "AGENT_EXECUTION_FAILED",
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const safeFallback =
    typeof fallback === "string" &&
    DIAGNOSTIC_CODE_PATTERN.test(fallback) &&
    PUBLIC_COURSE_ERROR_CODES.has(fallback)
      ? fallback
      : "AGENT_EXECUTION_FAILED";
  if (
    !DIAGNOSTIC_CODE_PATTERN.test(normalized) ||
    PRIVATE_MATERIAL_MARKER.test(normalized) ||
    !PUBLIC_COURSE_ERROR_CODES.has(normalized)
  ) {
    return safeFallback;
  }
  return normalized;
}

/** SSE 出口的最后一层公开信息安全防线。 */
export function sanitizePublicCourseState(
  state: CourseGenerationState,
): CourseGenerationState {
  return {
    ...state,
    pages: state.pages.map((page) => ({
      ...page,
      error: page.error
        ? {
            ...page.error,
            code: sanitizePublicErrorCode(
              page.error.code,
              "PAGE_GENERATION_FAILED",
            ),
            message: sanitizePublicDiagnosticText(page.error.message, {
              fallback: "页面生成失败，请根据错误码排查后重试。",
              maxLength: 1_000,
            }),
          }
        : undefined,
    })),
    events: state.events.map((event) => ({
      ...event,
      summary: sanitizePublicDiagnosticText(event.summary, {
        fallback: "课程生成进度已更新。",
        maxLength: 500,
      }),
    })),
    errors: state.errors.map((error) => ({
      ...error,
      code: sanitizePublicErrorCode(error.code, "COURSE_GENERATION_FAILED"),
      message: sanitizePublicDiagnosticText(error.message, {
        fallback: "课程生成失败，请根据错误码排查后重试。",
        maxLength: 1_000,
      }),
    })),
  };
}

/** EventBus、durable reader 与 checkpoint 在统一 SSE 出口再次收敛。 */
export function sanitizePublicCourseTaskStreamMessage(
  message: CourseTaskStreamMessage,
): CourseTaskStreamMessage {
  if (message.type === "event") {
    return {
      ...message,
      event: {
        ...message.event,
        summary: sanitizePublicDiagnosticText(message.event.summary, {
          fallback: "课程生成进度已更新。",
          maxLength: 500,
        }),
      },
    };
  }

  return {
    ...message,
    state: sanitizePublicCourseState(message.state),
  };
}

export function toCourseGenerationCauseCode(
  value: unknown,
): CourseGenerationCauseCode | undefined {
  return [
    "SCHEMA_ERROR",
    "TIMEOUT_ERROR",
    "RATE_LIMIT_ERROR",
    "QUOTA_ERROR",
    "AUTH_ERROR",
    "CONFIG_ERROR",
    "MODEL_ERROR",
  ].includes(String(value))
    ? (value as CourseGenerationCauseCode)
    : undefined;
}

function readErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof Error && error.name
    ? error.name
    : "AGENT_EXECUTION_FAILED";
}

function publicMessageFor(
  classifiedCode: string | undefined,
  diagnosticCode: string,
) {
  switch (classifiedCode) {
    case "CONFIG_ERROR":
      return "模型配置不可用，请检查服务配置后重试。";
    case "AUTH_ERROR":
      return "模型服务认证失败，请检查访问权限后重试。";
    case "QUOTA_ERROR":
      return "模型服务额度不足，请检查额度后重试。";
    case "RATE_LIMIT_ERROR":
      return "模型服务当前请求较多，请稍后重试。";
    case "TIMEOUT_ERROR":
      return "模型调用超时，请稍后重试。";
    case "SCHEMA_ERROR":
      return "模型返回内容未通过结构校验，请重新生成。";
    case "CANCELLED_ERROR":
      return "Agent 执行已取消。";
    case "REQUEST_ERROR":
      return "Agent 输入不符合执行要求。";
    case "MODEL_ERROR":
      return "模型服务未返回有效结果，请稍后重试。";
    default:
      return diagnosticCode.includes("BUDGET")
        ? "Agent 已达到执行预算，未能完成当前任务。"
        : "Agent 执行失败，请根据错误码排查后重试。";
  }
}
