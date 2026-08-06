import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { convertToModelMessagesMock, generateTextMock } = vi.hoisted(() => ({
  convertToModelMessagesMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

const {
  getHtmlLanguageModelMock,
  getHtmlLanguageModelIdentityMock,
  getLanguageModelMock,
  getLanguageModelIdentityMock,
} = vi.hoisted(() => ({
    getHtmlLanguageModelMock: vi.fn(),
    getHtmlLanguageModelIdentityMock: vi.fn(),
    getLanguageModelMock: vi.fn((tier: string) => ({ tier })),
    getLanguageModelIdentityMock: vi.fn(
      (tier: string) => `test-provider/${tier}-model`,
    ),
  }));

vi.mock("ai", () => ({
  convertToModelMessages: convertToModelMessagesMock,
  generateText: generateTextMock,
  Output: { json: vi.fn((options) => options) },
  streamText: vi.fn(),
}));

vi.mock("../../../../src/server/infra/ai/model-provider", () => ({
  getHtmlLanguageModel: getHtmlLanguageModelMock,
  getHtmlLanguageModelIdentity: getHtmlLanguageModelIdentityMock,
  getLanguageModel: getLanguageModelMock,
  getLanguageModelIdentity: getLanguageModelIdentityMock,
}));

import {
  generateStructuredObjectSafe,
  generateTextSafe,
} from "../../../../src/server/infra/ai/client";
import { aiResultCache } from "../../../../src/server/infra/ai/result-cache";

describe("AI client", () => {
  beforeEach(() => {
    convertToModelMessagesMock
      .mockReset()
      .mockResolvedValue([{ role: "user", content: "converted" }]);
    generateTextMock.mockReset();
    getHtmlLanguageModelMock.mockReset().mockReturnValue(undefined);
    getHtmlLanguageModelIdentityMock.mockReset().mockReturnValue(undefined);
    aiResultCache.clear();
  });

  it(
    "routes HTML generation through the dedicated model before the strong tier",
    async () => {
      const htmlModel = { dedicated: "html" };
      getHtmlLanguageModelMock.mockReturnValue(htmlModel);
      getHtmlLanguageModelIdentityMock.mockReturnValue(
        "volcengine-ark/doubao-code-preview",
      );
      generateTextMock
        .mockRejectedValueOnce({ statusCode: 503 })
        .mockResolvedValueOnce({ text: "<!doctype html>", usage: {} });

      await expect(
        generateTextSafe({
          capability: "html",
          messages: [],
          traceId: "dedicated-html-test",
        }),
      ).resolves.toEqual({ text: "<!doctype html>", usage: {} });

      expect(generateTextMock.mock.calls.map(([input]) => input.model)).toEqual([
        htmlModel,
        { tier: "strong" },
      ]);
    },
  );

  it("routes HTML repair directly through the strong tier", async () => {
    getHtmlLanguageModelMock.mockReturnValue({ dedicated: "html" });
    getHtmlLanguageModelIdentityMock.mockReturnValue(
      "volcengine-ark/doubao-code-preview",
    );
    generateTextMock.mockResolvedValue({
      text: "<!doctype html>",
      usage: {},
    });

    await generateTextSafe({
      capability: "html-repair",
      messages: [],
      traceId: "html-repair-tier-test",
    });

    expect(generateTextMock).toHaveBeenCalledOnce();
    expect(generateTextMock.mock.calls[0]?.[0].model).toEqual({
      tier: "strong",
    });
  });

  it("logs the concrete dedicated HTML model identity", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    getHtmlLanguageModelMock.mockReturnValue({ dedicated: "html" });
    getHtmlLanguageModelIdentityMock.mockReturnValue(
      "volcengine-ark/doubao-code-preview",
    );
    generateTextMock.mockResolvedValue({
      text: "<!doctype html>",
      usage: {},
    });

    await generateTextSafe({
      capability: "html",
      messages: [],
      traceId: "dedicated-html-identity-test",
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "[ai]",
      expect.objectContaining({
        event: "generate:finish",
        model: "volcengine-ark/doubao-code-preview",
      }),
    );
    infoSpy.mockRestore();
  });

  it("does not leave the dedicated HTML model for a non-transient failure", async () => {
    getHtmlLanguageModelMock.mockReturnValue({ dedicated: "html" });
    getHtmlLanguageModelIdentityMock.mockReturnValue(
      "volcengine-ark/doubao-code-preview",
    );
    generateTextMock.mockRejectedValue({ statusCode: 400 });

    await expect(
      generateTextSafe({
        capability: "html",
        messages: [],
        traceId: "dedicated-html-request-error-test",
      }),
    ).rejects.toEqual({ statusCode: 400 });

    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("keeps the existing HTML tier route when no dedicated model is configured", async () => {
    generateTextMock.mockResolvedValue({
      text: "<!doctype html>",
      usage: {},
    });

    await generateTextSafe({
      capability: "html",
      messages: [],
      traceId: "html-tier-route-test",
    });

    expect(generateTextMock).toHaveBeenCalledOnce();
    expect(generateTextMock.mock.calls[0]?.[0].model).toEqual({
      tier: "strong",
    });
  });

  it("falls back once for a transient strong-model failure", async () => {
    generateTextMock
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ output: { value: "ok" }, usage: {} });

    await expect(
      generateStructuredObjectSafe({
        capability: "planner",
        fallbackTimeoutMs: 60_000,
        prompt: "Generate a course plan",
        schema: z.object({ value: z.string() }),
        schemaName: "course_plan",
        timeoutMs: 120_000,
        traceId: "model-fallback-test",
      }),
    ).resolves.toEqual({ value: "ok" });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls.map(([input]) => input.model)).toEqual([
      { tier: "strong" },
      { tier: "balanced" },
    ]);
    expect(generateTextMock.mock.calls.map(([input]) => input.timeout)).toEqual([
      120_000,
      60_000,
    ]);
    expect(getHtmlLanguageModelMock).not.toHaveBeenCalled();
  });

  it("passes multimodal UI messages to structured generation without logging them as a prompt", async () => {
    const messages = [
      {
        id: "page-qa-request",
        role: "user" as const,
        parts: [
          { type: "text" as const, text: "Evaluate this page" },
          {
            type: "file" as const,
            mediaType: "image/png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
    ];
    generateTextMock.mockResolvedValue({
      output: { value: "ok" },
      usage: {},
    });

    await expect(
      generateStructuredObjectSafe({
        capability: "page-qa",
        messages,
        prompt: "Evaluate this page",
        schema: z.object({ value: z.string() }),
        schemaName: "page_quality_assessment",
        traceId: "structured-multimodal-test",
      }),
    ).resolves.toEqual({ value: "ok" });

    expect(convertToModelMessagesMock).toHaveBeenCalledWith(messages);
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "converted" }],
      }),
    );
    expect(generateTextMock.mock.calls[0]?.[0]).not.toHaveProperty("prompt");
  });

  it("Schema 不合同时直接暴露上游质量问题，不用较弱模型重写整份结果", async () => {
    generateTextMock.mockResolvedValueOnce({
      output: { unexpected: "shape" },
      usage: { outputTokens: 10 },
    });

    await expect(
      generateStructuredObjectSafe({
        capability: "repair",
        prompt: "Repair one course page",
        schema: z.object({ value: z.string() }).strict(),
        schemaName: "page_repair_result",
        traceId: "schema-fallback-test",
      }),
    ).rejects.toThrow("结构化输出校验失败");

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls.map(([input]) => input.model)).toEqual([
      { tier: "strong" },
    ]);
  });

  it("logs the structured schema identity when validation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generateTextMock.mockResolvedValue({
      output: {
        issues: [{ location: { viewports: ["desktop"] } }],
      },
      usage: {},
    });

    await expect(
      generateStructuredObjectSafe({
        capability: "page-qa",
        model: {} as never,
        prompt: "Evaluate this page",
        promptFingerprint: "page-qa@diagnostic-test",
        schema: z
          .object({
            issues: z.array(
              z.object({
                location: z
                  .object({ viewport: z.string().optional() })
                  .strict(),
              }),
            ),
          })
          .strict(),
        schemaName: "page_quality_report",
        traceId: "schema-diagnostic-test",
      }),
    ).rejects.toThrow('Unrecognized key: "viewports"');

    expect(errorSpy).toHaveBeenCalledWith(
      "[ai]",
      expect.objectContaining({
        capability: "page-qa",
        errorMessage: expect.stringContaining(
          'issues.0.location: Unrecognized key: "viewports"',
        ),
        event: "generate-object:error",
        promptFingerprint: "page-qa@diagnostic-test",
        schemaName: "page_quality_report",
        traceId: "schema-diagnostic-test",
      }),
    );
    errorSpy.mockRestore();
  });

  it("reuses a schema-valid cached result without another model call", async () => {
    generateTextMock.mockResolvedValue({
      output: { value: "cached" },
      usage: {},
    });
    const request = {
      cache: {
        input: { topic: "solar wind" },
        namespace: "test-page-writer",
        schemaFingerprint: "test-schema-current",
      },
      capability: "page-writer" as const,
      prompt: "Generate page content",
      promptFingerprint: "test-prompt-current",
      schema: z.object({ value: z.string() }),
      schemaName: "test_intent",
      traceId: "result-cache-test",
    };

    await expect(generateStructuredObjectSafe(request)).resolves.toEqual({
      value: "cached",
    });
    await expect(generateStructuredObjectSafe(request)).resolves.toEqual({
      value: "cached",
    });
    expect(generateTextMock).toHaveBeenCalledOnce();

    const controller = new AbortController();
    controller.abort();
    await expect(
      generateStructuredObjectSafe({ ...request, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generateTextMock).toHaveBeenCalledOnce();
  });

  it("allows long structured course responses to run for 60 seconds", async () => {
    generateTextMock.mockResolvedValue({ output: { value: "ok" } });

    await generateStructuredObjectSafe({
      model: {} as never,
      prompt: "Generate a course brief",
      schema: z.object({ value: z.string() }),
      schemaName: "course_brief",
      traceId: "structured-timeout-test",
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("allows a specialized structured request to use a longer finite timeout", async () => {
    generateTextMock.mockResolvedValue({ output: { value: "ok" } });

    await generateStructuredObjectSafe({
      model: {} as never,
      prompt: "Generate a bounded repair candidate",
      schema: z.object({ value: z.string() }),
      schemaName: "repair_candidate",
      timeoutMs: 120_000,
      traceId: "structured-custom-timeout-test",
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("normalizes a provider JSON object before strict schema validation", async () => {
    generateTextMock.mockResolvedValue({
      output: { interactionType: "multiple-choice" },
    });
    const normalizeOutput = vi.fn(() => ({ interactionType: "choice" }));

    const result = await generateStructuredObjectSafe({
      model: {} as never,
      normalizeOutput,
      prompt: "Generate a course page",
      schema: z.object({ interactionType: z.literal("choice") }),
      schemaName: "course_page",
      traceId: "structured-normalization-test",
    });

    expect(normalizeOutput).toHaveBeenCalledWith({
      interactionType: "multiple-choice",
    });
    expect(result).toEqual({ interactionType: "choice" });
  });

  it("可把服务端 JSON Schema 注入结构化调用指令", async () => {
    generateTextMock.mockResolvedValue({
      output: { value: "ok" },
    });

    await generateStructuredObjectSafe({
      includeSchemaInPrompt: true,
      model: {} as never,
      prompt: "Generate a typed value",
      schema: z.object({ value: z.string() }).strict(),
      schemaName: "typed_value",
      systemPrompt: "只返回结果。",
      traceId: "structured-schema-prompt-test",
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringMatching(
          /只返回结果。[\s\S]*输出 JSON Schema[\s\S]*"value"/,
        ),
      }),
    );
  });

  it("allows a long raw HTML generation to request a 60 second timeout", async () => {
    generateTextMock.mockResolvedValue({ text: "<!doctype html>" });

    await generateTextSafe({
      messages: [],
      model: {} as never,
      timeoutMs: 60_000,
      traceId: "html-timeout-test",
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60_000 }),
    );
  });
});
