import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getModelConfig } from "@/config/env";

export function getLanguageModel() {
  const { apiKey, baseURL, modelName } = getModelConfig();

  const provider = createOpenAICompatible({
    name: "model-provider",
    apiKey,
    baseURL,
  });

  return provider(modelName);
}
