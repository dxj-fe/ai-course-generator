import { describe, expect, it, vi } from "vitest";

import {
  WorkflowNodeError,
  runSequentialWorkflow,
  type WorkflowNode,
  type WorkflowValue,
} from "../../../../src/server/workflows/sequential-workflow";

type TestState = {
  prompt?: string;
  intent?: string;
  plan?: string[];
  html?: string;
  rogue?: string;
};

type TestContext = {
  traceId: string;
};

type TestEvent = {
  summary: string;
};

type TestNodeName = "intent" | "planner" | "html";

const promptValue: WorkflowValue<TestState> = {
  name: "课程提示",
  key: "prompt",
  select: (state) => state.prompt,
};

const intentValue: WorkflowValue<TestState> = {
  name: "课程意图",
  key: "intent",
  select: (state) => state.intent,
};

const planValue: WorkflowValue<TestState> = {
  name: "课程规划",
  key: "plan",
  select: (state) => state.plan,
};

const htmlValue: WorkflowValue<TestState> = {
  name: "页面 HTML",
  key: "html",
  select: (state) => state.html,
};

const context: TestContext = { traceId: "trace-day-22" };

describe("runSequentialWorkflow", () => {
  it("runs nodes in declaration order and exposes each merged patch downstream", async () => {
    const order: string[] = [];
    const initialState: TestState = { prompt: "生成一门太阳系课程" };
    const merge = vi.fn((state: TestState, patch: Partial<TestState>) => ({
      ...state,
      ...patch,
    }));
    const nodes: WorkflowNode<
      TestState,
      TestContext,
      TestEvent,
      TestNodeName
    >[] = [
      {
        name: "intent",
        requiredInputs: [promptValue],
        produces: [intentValue],
        async run(state, runtimeContext) {
          order.push("intent");
          expect(runtimeContext).toBe(context);
          expect(state).toEqual(initialState);
          return {
            patch: { intent: "太阳系入门课程" },
            events: [{ summary: "Intent 完成" }],
          };
        },
      },
      {
        name: "planner",
        requiredInputs: [intentValue],
        produces: [planValue],
        async run(state) {
          order.push("planner");
          expect(state.intent).toBe("太阳系入门课程");
          return {
            patch: { plan: ["认识太阳", "认识行星"] },
            events: [{ summary: "Planner 完成" }],
          };
        },
      },
      {
        name: "html",
        requiredInputs: [planValue],
        produces: [htmlValue],
        async run(state) {
          order.push("html");
          expect(state.plan).toEqual(["认识太阳", "认识行星"]);
          return {
            patch: { html: "<!doctype html><html></html>" },
            events: [{ summary: "HTML 完成" }],
          };
        },
      },
    ];

    const result = await runSequentialWorkflow({
      state: initialState,
      nodes,
      context,
      merge,
    });

    expect(result).toEqual({
      status: "completed",
      state: {
        prompt: "生成一门太阳系课程",
        intent: "太阳系入门课程",
        plan: ["认识太阳", "认识行星"],
        html: "<!doctype html><html></html>",
      },
    });
    expect(order).toEqual(["intent", "planner", "html"]);
    expect(merge).toHaveBeenCalledTimes(3);
  });

  it("does not mutate the caller's original state", async () => {
    const initialState = Object.freeze<TestState>({
      prompt: "生成一门物理课程",
    });
    const node: WorkflowNode<
      TestState,
      TestContext,
      TestEvent,
      TestNodeName
    > = {
      name: "intent",
      requiredInputs: [promptValue],
      produces: [intentValue],
      async run() {
        return {
          patch: { intent: "物理入门课程" },
          events: [],
        };
      },
    };

    const result = await runSequentialWorkflow({
      state: initialState,
      nodes: [node],
      context,
      merge: (state, patch) => ({ ...state, ...patch }),
    });

    expect(result.status).toBe("completed");
    expect(initialState).toEqual({ prompt: "生成一门物理课程" });
    expect(initialState).not.toHaveProperty("intent");
    expect(result.state).not.toBe(initialState);
  });

  it("fails before execution when a required input is missing", async () => {
    const run = vi.fn();
    const successor = vi.fn();
    const nodes: WorkflowNode<
      TestState,
      TestContext,
      TestEvent,
      TestNodeName
    >[] = [
      {
        name: "planner",
        requiredInputs: [intentValue],
        produces: [planValue],
        run,
      },
      {
        name: "html",
        requiredInputs: [planValue],
        produces: [htmlValue],
        run: successor,
      },
    ];
    const initialState: TestState = { prompt: "缺少结构化意图" };

    const result = await runSequentialWorkflow({
      state: initialState,
      nodes,
      context,
      merge: (state, patch) => ({ ...state, ...patch }),
    });

    expectFailedResult(result, {
      nodeName: "planner",
      code: "WORKFLOW_NODE_INPUT_MISSING",
    });
    expect(result.state).toEqual(initialState);
    expect(run).not.toHaveBeenCalled();
    expect(successor).not.toHaveBeenCalled();
  });

  it("fails when a declared output is still missing after merge", async () => {
    const successor = vi.fn();
    const nodes: WorkflowNode<
      TestState,
      TestContext,
      TestEvent,
      TestNodeName
    >[] = [
      {
        name: "intent",
        requiredInputs: [promptValue],
        produces: [intentValue],
        async run() {
          return { patch: {}, events: [] };
        },
      },
      {
        name: "planner",
        requiredInputs: [intentValue],
        produces: [planValue],
        run: successor,
      },
    ];
    const initialState: TestState = { prompt: "生成课程" };

    const result = await runSequentialWorkflow({
      state: initialState,
      nodes,
      context,
      merge: (state, patch) => ({ ...state, ...patch }),
    });

    expectFailedResult(result, {
      nodeName: "intent",
      code: "WORKFLOW_NODE_OUTPUT_MISSING",
    });
    expect(result.state).toEqual(initialState);
    expect(successor).not.toHaveBeenCalled();
  });

  it("rejects patch keys that the node did not declare in produces", async () => {
    const merge = vi.fn((state: TestState, patch: Partial<TestState>) => ({
      ...state,
      ...patch,
    }));
    const successor = vi.fn();
    const nodes: WorkflowNode<
      TestState,
      TestContext,
      TestEvent,
      TestNodeName
    >[] = [
      {
        name: "intent",
        requiredInputs: [promptValue],
        produces: [intentValue],
        async run() {
          return {
            patch: { intent: "有效意图", rogue: "未声明产物" },
            events: [],
          };
        },
      },
      {
        name: "planner",
        requiredInputs: [intentValue],
        produces: [planValue],
        run: successor,
      },
    ];
    const initialState: TestState = { prompt: "生成课程" };

    const result = await runSequentialWorkflow({
      state: initialState,
      nodes,
      context,
      merge,
    });

    expectFailedResult(result, {
      nodeName: "intent",
      code: "WORKFLOW_NODE_UNDECLARED_OUTPUT",
    });
    expect(result.state).toEqual(initialState);
    expect(merge).not.toHaveBeenCalled();
    expect(successor).not.toHaveBeenCalled();
  });

  it("wraps node exceptions with nodeName and stops all successors", async () => {
    const successor = vi.fn();
    const nodes: WorkflowNode<
      TestState,
      TestContext,
      TestEvent,
      TestNodeName
    >[] = [
      {
        name: "intent",
        requiredInputs: [promptValue],
        produces: [intentValue],
        async run() {
          throw new Error("private provider failure");
        },
      },
      {
        name: "planner",
        requiredInputs: [intentValue],
        produces: [planValue],
        run: successor,
      },
    ];
    const initialState: TestState = { prompt: "生成课程" };

    const result = await runSequentialWorkflow({
      state: initialState,
      nodes,
      context,
      merge: (state, patch) => ({ ...state, ...patch }),
    });

    expectFailedResult(result, {
      nodeName: "intent",
      code: "WORKFLOW_NODE_EXECUTION_ERROR",
    });
    expect(result.state).toEqual(initialState);
    expect(successor).not.toHaveBeenCalled();
  });
});

function expectFailedResult(
  result: {
    status: string;
    state: TestState;
    error?: unknown;
  },
  expected: { nodeName: TestNodeName; code: string },
) {
  expect(result.status).toBe("failed");
  if (result.status !== "failed" || !result.error) {
    throw new Error("测试预期 Workflow 返回 failed 结果");
  }

  expect(result.error).toBeInstanceOf(WorkflowNodeError);
  expect(result.error).toMatchObject(expected);
}
