import type { ModelTier } from "@/server/infra/ai/model-router";

const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const DOUBAO_SEED_2_PRO_MODEL_ID =
  "doubao-seed-2-0-pro-260215";
const DEFAULT_ARK_IMAGE_MODEL_ID = "doubao-seedream-4-5-251128";
const DEFAULT_HTML_ENGINEER_TIMEOUT_MS = 240_000;
// Seed 2.0 Pro 的完整课程规划在真实 Provider 中可能超过 150 秒；Planner
// 本身已有 WorkOrder 级 5 分钟上限，因此默认直接使用完整预算，避免中途截断。
const DEFAULT_COURSE_PLANNER_TIMEOUT_MS = 300_000;
const MIN_HTML_ENGINEER_TIMEOUT_MS = 30_000;
const MAX_HTML_ENGINEER_TIMEOUT_MS = 300_000;
const MIN_COURSE_PLANNER_TIMEOUT_MS = 60_000;
const MAX_COURSE_PLANNER_TIMEOUT_MS = 300_000;

function optionalEnv(name: string) {
  return process.env[name]?.trim() || undefined;
}

function requireEnv(name: string) {
  const value = optionalEnv(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getModelConfig(tier: ModelTier) {
  void tier;
  // 保留 ModelTier 参数仅为了不破坏已持久的 Agent 运行协议；
  // 实际文本模型不再按档位分流。
  return {
    apiKey: requireEnv("ARK_API_KEY"),
    baseURL: optionalEnv("ARK_BASE_URL") || DEFAULT_ARK_BASE_URL,
    modelName: DOUBAO_SEED_2_PRO_MODEL_ID,
    providerName: "volcengine-ark",
  };
}

/**
 * HTML Engineer 返回完整文档，输出量显著高于普通文本调用。
 * 保持有限默认值，同时允许本地慢模型在明确边界内覆盖。
 */
export function getHtmlEngineerTimeoutMs() {
  const raw = optionalEnv("AI_HTML_TIMEOUT_MS");
  if (!raw) return DEFAULT_HTML_ENGINEER_TIMEOUT_MS;

  const timeoutMs = Number(raw);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_HTML_ENGINEER_TIMEOUT_MS ||
    timeoutMs > MAX_HTML_ENGINEER_TIMEOUT_MS
  ) {
    throw new Error(
      `AI_HTML_TIMEOUT_MS must be an integer between ${MIN_HTML_ENGINEER_TIMEOUT_MS} and ${MAX_HTML_ENGINEER_TIMEOUT_MS}.`,
    );
  }

  return timeoutMs;
}

/**
 * Planner 一次需要生成完整课程结构，因此允许独立设置较长超时。
 */
export function getCoursePlannerTimeoutMs() {
  const raw = optionalEnv("AI_PLANNER_TIMEOUT_MS");
  if (!raw) return DEFAULT_COURSE_PLANNER_TIMEOUT_MS;

  const timeoutMs = Number(raw);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_COURSE_PLANNER_TIMEOUT_MS ||
    timeoutMs > MAX_COURSE_PLANNER_TIMEOUT_MS
  ) {
    throw new Error(
      `AI_PLANNER_TIMEOUT_MS must be an integer between ${MIN_COURSE_PLANNER_TIMEOUT_MS} and ${MAX_COURSE_PLANNER_TIMEOUT_MS}.`,
    );
  }

  return timeoutMs;
}

/** 默认复用方舟鉴权调用 Seedream；独立图片供应商仍可用 IMAGE_* 覆盖。 */
export function getImageModelConfig() {
  const imageApiKey = optionalEnv("IMAGE_API_KEY");

  if (imageApiKey) {
    return {
      apiKey: imageApiKey,
      baseURL: requireEnv("IMAGE_BASE_URL"),
      modelName: requireEnv("IMAGE_MODEL_ID"),
      providerName: optionalEnv("IMAGE_PROVIDER_NAME") || "image-provider",
    };
  }

  const arkApiKey = optionalEnv("ARK_API_KEY");
  if (arkApiKey) {
    return {
      apiKey: arkApiKey,
      baseURL: optionalEnv("ARK_BASE_URL") || DEFAULT_ARK_BASE_URL,
      modelName:
        optionalEnv("ARK_IMAGE_MODEL_ID") || DEFAULT_ARK_IMAGE_MODEL_ID,
      providerName: "volcengine-ark",
    };
  }

  return {
    apiKey: requireEnv("IMAGE_API_KEY"),
    baseURL: requireEnv("IMAGE_BASE_URL"),
    modelName: requireEnv("IMAGE_MODEL_ID"),
    providerName: optionalEnv("IMAGE_PROVIDER_NAME") || "image-provider",
  };
}
