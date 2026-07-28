import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCoursePlannerTimeoutMs,
  getHtmlEngineerTimeoutMs,
  getImageModelConfig,
  getModelConfig,
} from "../../../src/config/env";

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

describe("getModelConfig", () => {
  it("routes every product tier to Doubao when all selectors use Ark", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "ark");
    vi.stubEnv("MODEL_PROVIDER_BALANCED", "ark");
    vi.stubEnv("MODEL_PROVIDER_CHEAP", "ark");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID", "doubao-seed");
    vi.stubEnv("MODEL_API_KEY", "");

    expect(
      (["strong", "balanced", "cheap"] as const).map((tier) =>
        getModelConfig(tier),
      ),
    ).toEqual([
      expect.objectContaining({
        providerName: "volcengine-ark",
        modelName: "doubao-seed",
      }),
      expect.objectContaining({
        providerName: "volcengine-ark",
        modelName: "doubao-seed",
      }),
      expect.objectContaining({
        providerName: "volcengine-ark",
        modelName: "doubao-seed",
      }),
    ]);
  });

  it("uses a tier model when configured and falls back to the legacy model", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "");
    vi.stubEnv("MODEL_PROVIDER_CHEAP", "");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID", "balanced-default");
    vi.stubEnv("ARK_MODEL_ID_STRONG", "strong-model");
    vi.stubEnv("ARK_MODEL_ID_CHEAP", "");

    expect(getModelConfig("strong").modelName).toBe("strong-model");
    expect(getModelConfig("cheap").modelName).toBe("balanced-default");
  });

  it("selects Ark and generic providers independently for each tier", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "generic");
    vi.stubEnv("MODEL_PROVIDER_BALANCED", "ark");
    vi.stubEnv("MODEL_PROVIDER_CHEAP", "ark");
    vi.stubEnv("MODEL_API_KEY", "generic-test-key");
    vi.stubEnv("MODEL_BASE_URL", "https://models.example.test/v1");
    vi.stubEnv("MODEL_NAME", "gpt-5.5");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID", "doubao-mini");

    expect(getModelConfig("strong")).toEqual({
      apiKey: "generic-test-key",
      baseURL: "https://models.example.test/v1",
      modelName: "gpt-5.5",
      providerName: "model-provider",
    });
    expect(getModelConfig("balanced")).toEqual({
      apiKey: "ark-test-key",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      modelName: "doubao-mini",
      providerName: "volcengine-ark",
    });
    expect(getModelConfig("cheap").providerName).toBe("volcengine-ark");
  });

  it("keeps the legacy Ark-first behavior when no selector is configured", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID", "doubao-mini");
    vi.stubEnv("MODEL_API_KEY", "generic-test-key");
    vi.stubEnv("MODEL_BASE_URL", "https://models.example.test/v1");
    vi.stubEnv("MODEL_NAME", "gpt-5.5");

    expect(getModelConfig("strong").providerName).toBe("volcengine-ark");
  });

  it("does not silently switch providers when the selected provider is incomplete", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "generic");
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID", "doubao-mini");

    expect(() => getModelConfig("strong")).toThrow(
      "Missing required environment variable: MODEL_API_KEY",
    );
  });

  it.each(["ARK", "openai", "model-provider"])(
    "rejects an invalid tier provider selector: %s",
    (selector) => {
      vi.stubEnv("MODEL_PROVIDER_STRONG", selector);

      expect(() => getModelConfig("strong")).toThrow(
        'MODEL_PROVIDER_STRONG must be either "ark" or "generic".',
      );
    },
  );
});

describe("getHtmlEngineerTimeoutMs", () => {
  it("allows long HTML documents more time than ordinary text calls", () => {
    vi.stubEnv("AI_HTML_TIMEOUT_MS", "");

    expect(getHtmlEngineerTimeoutMs()).toBe(120_000);
  });

  it("accepts a bounded local override", () => {
    vi.stubEnv("AI_HTML_TIMEOUT_MS", "180000");

    expect(getHtmlEngineerTimeoutMs()).toBe(180_000);
  });

  it.each(["29999", "300001", "not-a-number"])(
    "rejects an invalid override: %s",
    (value) => {
      vi.stubEnv("AI_HTML_TIMEOUT_MS", value);

      expect(() => getHtmlEngineerTimeoutMs()).toThrow(
        "AI_HTML_TIMEOUT_MS must be an integer between 30000 and 300000",
      );
    },
  );
});

describe("getCoursePlannerTimeoutMs", () => {
  it("allows a complete multi-section plan more time than ordinary structured calls", () => {
    vi.stubEnv("AI_PLANNER_TIMEOUT_MS", "");

    expect(getCoursePlannerTimeoutMs()).toBe(180_000);
  });

  it("accepts a bounded local override", () => {
    vi.stubEnv("AI_PLANNER_TIMEOUT_MS", "240000");

    expect(getCoursePlannerTimeoutMs()).toBe(240_000);
  });

  it.each(["59999", "300001", "not-a-number"])(
    "rejects an invalid override: %s",
    (value) => {
      vi.stubEnv("AI_PLANNER_TIMEOUT_MS", value);

      expect(() => getCoursePlannerTimeoutMs()).toThrow(
        "AI_PLANNER_TIMEOUT_MS must be an integer between 60000 and 300000",
      );
    },
  );
});
