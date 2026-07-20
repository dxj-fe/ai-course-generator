import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(),
  generateText: generateTextMock,
  Output: { json: vi.fn((options) => options) },
  streamText: vi.fn(),
}));

import {
  generateStructuredObjectSafe,
  generateTextSafe,
} from "../../../../src/server/ai/client";

describe("AI client", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
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
