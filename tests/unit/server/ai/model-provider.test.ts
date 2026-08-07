import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enforceSequentialToolCalls,
  getLanguageModelIdentity,
} from "../../../../src/server/infra/ai/model-provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("model provider", () => {
  it("externalizes reasoning to the loop and disables parallel stateful tool calls", () => {
    expect(
      enforceSequentialToolCalls({
        model: "test-model",
        tools: [{ type: "function" }],
      }),
    ).toEqual({
      model: "test-model",
      tools: [{ type: "function" }],
      thinking: { type: "disabled" },
      parallel_tool_calls: false,
    });

    const body = { model: "test-model" };
    expect(enforceSequentialToolCalls(body)).toEqual({
      model: "test-model",
      thinking: { type: "disabled" },
    });

    expect(
      enforceSequentialToolCalls({
        model: "test-model",
        thinking: { type: "disabled" },
      }),
    ).toEqual({
      model: "test-model",
      thinking: { type: "disabled" },
    });
  });

  it("所有旧 tier 都解析为同一个 doubao 2.0 pro 身份", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "generic");
    vi.stubEnv("MODEL_PROVIDER_BALANCED", "ark");
    vi.stubEnv("MODEL_API_KEY", "generic-test-key");
    vi.stubEnv("MODEL_BASE_URL", "https://models.example.test/api");
    vi.stubEnv("MODEL_NAME_STRONG", "gpt-5.5");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID_BALANCED", "doubao-mini");

    expect(getLanguageModelIdentity("strong")).toBe(
      "volcengine-ark/doubao-seed-2-0-pro-260215",
    );
    expect(getLanguageModelIdentity("balanced")).toBe(
      "volcengine-ark/doubao-seed-2-0-pro-260215",
    );
    expect(getLanguageModelIdentity("strong")).toBe(
      getLanguageModelIdentity("balanced"),
    );
  });
});
