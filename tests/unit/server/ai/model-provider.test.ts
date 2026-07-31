import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enforceSequentialToolCalls,
  getLanguageModelIdentity,
} from "../../../../src/server/infra/ai/model-provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("model provider", () => {
  it("disables parallel tool calls for stateful Agent tools", () => {
    expect(
      enforceSequentialToolCalls({
        model: "test-model",
        tools: [{ type: "function" }],
      }),
    ).toEqual({
      model: "test-model",
      tools: [{ type: "function" }],
      parallel_tool_calls: false,
    });

    const body = { model: "test-model" };
    expect(enforceSequentialToolCalls(body)).toBe(body);
  });

  it("keeps strong and balanced fallback identities distinct across providers", () => {
    vi.stubEnv("MODEL_PROVIDER_STRONG", "generic");
    vi.stubEnv("MODEL_PROVIDER_BALANCED", "ark");
    vi.stubEnv("MODEL_API_KEY", "generic-test-key");
    vi.stubEnv("MODEL_BASE_URL", "https://models.example.test/v1");
    vi.stubEnv("MODEL_NAME", "gpt-5.5");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID", "doubao-mini");

    expect(getLanguageModelIdentity("strong")).toBe(
      "model-provider/gpt-5.5",
    );
    expect(getLanguageModelIdentity("balanced")).toBe(
      "volcengine-ark/doubao-mini",
    );
    expect(getLanguageModelIdentity("strong")).not.toBe(
      getLanguageModelIdentity("balanced"),
    );
  });
});
