import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getImageModelConfig, getModelConfig } from "@/config/env";
import type { ModelTier } from "./model-router";

export function getLanguageModel(tier: ModelTier) {
  const { apiKey, baseURL, modelName, providerName } = getModelConfig(tier);

  const provider = createOpenAICompatible({
    name: providerName,
    apiKey,
    baseURL,
    transformRequestBody: enforceSequentialToolCalls,
  });

  return provider(modelName);
}

export function getLanguageModelIdentity(tier: ModelTier) {
  const { modelName, providerName } = getModelConfig(tier);
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
