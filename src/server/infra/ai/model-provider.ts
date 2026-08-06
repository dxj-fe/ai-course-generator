import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  getHtmlModelConfig,
  getImageModelConfig,
  getModelConfig,
} from "@/config/env";
import type { ModelTier } from "./model-router";

export function getLanguageModel(tier: ModelTier) {
  return createLanguageModel(getModelConfig(tier));
}

export function getHtmlLanguageModel() {
  const config = getHtmlModelConfig();
  return config ? createLanguageModel(config) : undefined;
}

export function getHtmlLanguageModelIdentity() {
  const config = getHtmlModelConfig();
  return config ? getModelIdentity(config) : undefined;
}

function createLanguageModel(config: ReturnType<typeof getModelConfig>) {
  const { apiKey, baseURL, modelName, providerName } = config;

  const provider = createOpenAICompatible({
    name: providerName,
    apiKey,
    baseURL,
    transformRequestBody: enforceSequentialToolCalls,
  });

  return provider(modelName);
}

export function getLanguageModelIdentity(tier: ModelTier) {
  return getModelIdentity(getModelConfig(tier));
}

function getModelIdentity(
  config: Pick<ReturnType<typeof getModelConfig>, "modelName" | "providerName">,
) {
  const { modelName, providerName } = config;
  return `${providerName}/${modelName}`;
}

export function getImageModel() {
  const { apiKey, baseURL, modelName, providerName } = getImageModelConfig();
  const provider = createOpenAICompatible({
    name: providerName,
    apiKey,
    baseURL,
  });

  return provider.imageModel(modelName);
}

/**
 * 课程 Agent 的工具会修改同一份 WorkOrder 状态，不能让 Provider 在一次响应中
 * 并行猜测多个后续动作。创作自由保留在每一步的工具选择和工具内部模型调用中。
 */
export function enforceSequentialToolCalls(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return Array.isArray(body.tools) && body.tools.length > 0
    ? { ...body, parallel_tool_calls: false }
    : body;
}
