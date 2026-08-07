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
    vi.stubEnv("IMAGE_BASE_URL", "https://images.example.test/api");
    vi.stubEnv("IMAGE_MODEL_ID", "image-model");
    vi.stubEnv("IMAGE_PROVIDER_NAME", "custom-images");

    expect(getImageModelConfig()).toEqual({
      apiKey: "image-test-key",
      baseURL: "https://images.example.test/api",
      modelName: "image-model",
      providerName: "custom-images",
    });
  });
});

describe("getModelConfig", () => {
  it("所有文本能力固定使用 doubao 2.0 pro", () => {
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_BASE_URL", "");

    expect(
      (["strong", "balanced", "cheap"] as const).map((tier) =>
        getModelConfig(tier),
      ),
    ).toEqual([
      expect.objectContaining({
        providerName: "volcengine-ark",
        modelName: "doubao-seed-2-0-pro-260215",
      }),
      expect.objectContaining({
        providerName: "volcengine-ark",
        modelName: "doubao-seed-2-0-pro-260215",
      }),
      expect.objectContaining({
        providerName: "volcengine-ark",
        modelName: "doubao-seed-2-0-pro-260215",
      }),
    ]);
  });

  it("只要求 Ark API Key，并忽略旧的分层与通用模型覆盖", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "generic");
    vi.stubEnv("MODEL_NAME_STRONG", "legacy-model");
    vi.stubEnv("ARK_MODEL_ID_STRONG", "legacy-mini");
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");

    expect(getModelConfig("strong").modelName).toBe(
      "doubao-seed-2-0-pro-260215",
    );
  });

  it("缺少 Ark API Key 时立即失败", () => {
    vi.stubEnv("ARK_API_KEY", "");

    expect(() => getModelConfig("strong")).toThrow(
      "Missing required environment variable: ARK_API_KEY",
    );
  });
});

describe("getHtmlEngineerTimeoutMs", () => {
  it("allows long HTML documents more time than ordinary text calls", () => {
    vi.stubEnv("AI_HTML_TIMEOUT_MS", "");

    expect(getHtmlEngineerTimeoutMs()).toBe(240_000);
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

    expect(getCoursePlannerTimeoutMs()).toBe(300_000);
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
