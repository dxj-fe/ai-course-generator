const DEFAULT_MODEL_NAME = "xai/grok-build-0.1";
const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_ARK_IMAGE_MODEL_ID = "doubao-seedream-4-5-251128";

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

export function getModelConfig() {
  const arkApiKey = optionalEnv("ARK_API_KEY");

  if (arkApiKey) {
    return {
      apiKey: arkApiKey,
      baseURL: optionalEnv("ARK_BASE_URL") || DEFAULT_ARK_BASE_URL,
      modelName: requireEnv("ARK_MODEL_ID"),
      providerName: "volcengine-ark",
    };
  }

  return {
    apiKey: requireEnv("MODEL_API_KEY"),
    baseURL: requireEnv("MODEL_BASE_URL"),
    modelName: optionalEnv("MODEL_NAME") || DEFAULT_MODEL_NAME,
    providerName: "model-provider",
  };
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
