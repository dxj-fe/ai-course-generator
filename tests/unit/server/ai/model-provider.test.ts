import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enforceSequentialToolCalls,
  getHtmlLanguageModelIdentity,
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
    vi.stubEnv("MODEL_BASE_URL", "https://models.example.test/api");
    vi.stubEnv("MODEL_NAME_STRONG", "gpt-5.5");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");
    vi.stubEnv("ARK_MODEL_ID_BALANCED", "doubao-mini");

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

  it("preserves the concrete identity of the dedicated HTML model", () => {
    vi.stubEnv("ARK_HTML_MODEL_ID", "doubao-code-preview");
    vi.stubEnv("ARK_API_KEY", "ark-test-key");

    expect(getHtmlLanguageModelIdentity()).toBe(
      "volcengine-ark/doubao-code-preview",
    );
  });
});
