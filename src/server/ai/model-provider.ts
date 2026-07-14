import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getImageModelConfig, getModelConfig } from "@/config/env";

export function getLanguageModel() {
  const { apiKey, baseURL, modelName, providerName } = getModelConfig();

  const provider = createOpenAICompatible({
    name: providerName,
    apiKey,
    baseURL,
  });

  return provider(modelName);
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
