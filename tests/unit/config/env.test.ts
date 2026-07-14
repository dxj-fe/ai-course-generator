import { afterEach, describe, expect, it, vi } from "vitest";

import { getImageModelConfig } from "../../../src/config/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getImageModelConfig", () => {
  it("reuses the existing Ark key for Seedream 4.5 by default", () => {
    vi.stubEnv("IMAGE_API_KEY", "");
    vi.stubEnv("IMAGE_BASE_URL", "");
    vi.stubEnv("IMAGE_MODEL_ID", "");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_BASE_URL", "");
    vi.stubEnv("ARK_IMAGE_MODEL_ID", "");

    expect(getImageModelConfig()).toEqual({
      apiKey: "ark-test-key",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      modelName: "doubao-seedream-4-5-251128",
      providerName: "volcengine-ark",
    });
  });

  it("allows a dedicated image provider to override Ark", () => {
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("IMAGE_API_KEY", "image-test-key");
    vi.stubEnv("IMAGE_BASE_URL", "https://images.example.test/v1");
    vi.stubEnv("IMAGE_MODEL_ID", "image-model");
    vi.stubEnv("IMAGE_PROVIDER_NAME", "custom-images");

    expect(getImageModelConfig()).toEqual({
      apiKey: "image-test-key",
      baseURL: "https://images.example.test/v1",
      modelName: "image-model",
      providerName: "custom-images",
    });
  });
});
