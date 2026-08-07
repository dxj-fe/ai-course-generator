import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  getImageModelConfig,
  getModelConfig,
} from "@/config/env";
import type { ModelTier } from "./model-router";

export function getLanguageModel(tier: ModelTier) {
  return createLanguageModel(getModelConfig(tier));
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
  return {
    ...body,
    // Seed 2.0 默认会对每个工具步骤进行深度思考。当前在线 Chat API 不支持
    // auto，而固定深思会把单步延迟放大到数分钟。这里关闭内部深思，把推理
    // 外化到可观察的 Agent Loop、工具反馈和检查点；模型仍统一使用 Pro。
    thinking:
      body.thinking ?? {
        type: "disabled",
      },
    ...(Array.isArray(body.tools) && body.tools.length > 0
      ? { parallel_tool_calls: false }
      : {}),
  };
}
