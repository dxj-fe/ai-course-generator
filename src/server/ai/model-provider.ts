import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getModelConfig } from "@/config/env";

export function getLanguageModel() {
  const { apiKey, baseURL, modelName, providerName } = getModelConfig();

  const provider = createOpenAICompatible({
    name: providerName,
    apiKey,
    baseURL,
  });

  return provider(modelName);
}
