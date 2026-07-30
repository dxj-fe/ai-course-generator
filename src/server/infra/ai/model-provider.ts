import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getImageModelConfig, getModelConfig } from "@/config/env";
import type { ModelTier } from "./model-router";

export function getLanguageModel(tier?: ModelTier) {
  const { apiKey, baseURL, modelName, providerName } = getModelConfig(tier);

  const provider = createOpenAICompatible({
    name: providerName,
    apiKey,
    baseURL,
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
