import { describe, expect, it, vi } from "vitest";

import { createModelStep } from "../../../../src/server/agent/plugins/model-steps/course/model-step";
import type { ModelStepStateBase } from "../../../../src/server/agent/plugins/model-steps/course/types";

type TestState = ModelStepStateBase & {
  output?: string;
};

function createState(): TestState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
  };
}

describe("model step", () => {
  it("只执行一次明确的模型步骤并返回产物", async () => {
    const execute = vi.fn(async (state: TestState) => ({
      ...state,
      output: "done",
    }));
    const result = await createModelStep<TestState>({
      name: "test-model-step",
      isComplete: (state) => Boolean(state.output),
      step: execute,
    }).run(createState(), { traceId: "model-step-completed" });

    expect(execute).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "completed",
      step: 1,
      output: "done",
    });
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "finish",
    ]);
  });

  it("没有产物时直接失败，不伪装成会自主重试的 Agent", async () => {
    const execute = vi.fn(async (state: TestState) => state);
    const result = await createModelStep<TestState>({
      name: "test-model-step",
      isComplete: (state) => Boolean(state.output),
      step: execute,
    }).run(createState(), { traceId: "model-step-missing-output" });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("MODEL_STEP_OUTPUT_MISSING");
  });

  it("取消信号已触发时不启动模型调用", async () => {
    const execute = vi.fn(async (state: TestState) => ({
      ...state,
      output: "unexpected",
    }));
    const controller = new AbortController();
    controller.abort();
    const result = await createModelStep<TestState>({
      name: "test-model-step",
      isComplete: (state) => Boolean(state.output),
      step: execute,
    }).run(createState(), {
      abortSignal: controller.signal,
      traceId: "model-step-aborted",
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("MODEL_STEP_ABORTED");
  });
});

