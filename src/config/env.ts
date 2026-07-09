const DEFAULT_MODEL_NAME = "xai/grok-build-0.1";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getModelConfig() {
  return {
    apiKey: requireEnv("MODEL_API_KEY"),
    baseURL: requireEnv("MODEL_BASE_URL"),
    modelName: process.env.MODEL_NAME?.trim() || DEFAULT_MODEL_NAME,
  };
}
