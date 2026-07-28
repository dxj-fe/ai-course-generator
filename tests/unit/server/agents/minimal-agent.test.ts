import { describe, expect, it } from "vitest";

import { AiSchemaValidationError } from "../../../../src/server/ai/error";
import { createMinimalAgent } from "../../../../src/server/agents/core/minimal-agent";
import type { AgentStateBase } from "../../../../src/server/agents/core/types";

type TestState = AgentStateBase & {
  value: number;
};

function createState(maxSteps = 2): TestState {
  return {
    status: "idle",
    step: 0,
    maxSteps,
    events: [],
    value: 0,
  };
}

describe("createMinimalAgent", () => {
  it("runs until complete and emits ordered serializable events", async () => {
    const agent = createMinimalAgent<TestState>({
      isComplete: (state) => state.value === 1,
      step: async (state, _context, emit) => {
        emit({ type: "model_call", summary: "Increment value." });
        return { ...state, value: state.value + 1 };
      },
    });

    const result = await agent.run(createState(), { traceId: "trace-success" });

    expect(result.status).toBe("completed");
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "finish",
    ]);
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("fails when the step budget is exhausted", async () => {
    const agent = createMinimalAgent<TestState>({
      isComplete: () => false,
      step: async (state) => state,
    });

    const result = await agent.run(createState(1), { traceId: "trace-limit" });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AGENT_STEP_LIMIT");
    expect(result.events.at(-1)?.type).toBe("error");
  });

  it("converts thrown errors into serializable failed state", async () => {
    const agent = createMinimalAgent<TestState>({
      isComplete: () => false,
      step: async () => {
        throw new Error("model failed");
      },
    });

    const result = await agent.run(createState(), { traceId: "trace-error" });

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "MODEL_ERROR",
      message: "模型服务未返回有效结果，请稍后重试。",
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("preserves structured validation feedback internally but emits a safe public summary", async () => {
    const agent = createMinimalAgent<TestState>({
      isComplete: () => false,
      step: async () => {
        throw new AiSchemaValidationError(
          "choice.prompts: expected 2 items but received 1",
        );
      },
    });

    const result = await agent.run(createState(), { traceId: "trace-schema" });

    expect(result.error).toEqual({
      code: "SCHEMA_ERROR",
      message: "choice.prompts: expected 2 items but received 1",
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "error",
      summary: "模型返回的内容格式不完整。",
      data: { code: "SCHEMA_ERROR" },
    });
  });

  it("preserves transient provider error categories", async () => {
    const agent = createMinimalAgent<TestState>({
      isComplete: () => false,
      step: async () => {
        throw { statusCode: 429, message: "too many requests" };
      },
    });

    const result = await agent.run(createState(), { traceId: "trace-rate" });

    expect(result.error).toEqual({
      code: "RATE_LIMIT_ERROR",
      message: "模型服务当前请求较多，请稍后重试。",
    });
  });
});
