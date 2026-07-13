import { describe, expect, it } from "vitest";

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
      code: "AGENT_EXECUTION_ERROR",
      message: "model failed",
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
