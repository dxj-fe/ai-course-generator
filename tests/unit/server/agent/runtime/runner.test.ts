import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  AgentRunner,
  createCommittedTerminalStopCondition,
  type PersistedAgentTerminal,
  type RuntimeAgentFactory,
} from "../../../../../src/server/agent/runtime/runner";
import {
  AgentTerminalNotCommittedError,
  FatalAgentRuntimeError,
} from "../../../../../src/server/agent/runtime/errors";

const tools = {
  inspect: tool({
    inputSchema: z.object({}),
    execute: () => ({
      committed: false,
      data: { inspected: true },
      ok: true as const,
      summary: "已检查。",
      terminal: false,
    }),
  }),
  submit_result: tool({
    inputSchema: z.object({}),
    execute: () => ({
      committed: true,
      data: { artifactId: "artifact-1" },
      ok: true as const,
      summary: "已提交。",
      terminal: true,
    }),
  }),
};

type TestTools = typeof tools;
type TestSubmission = { artifactId: string };

describe("AgentRunner", () => {
  it("提交工具校验失败或没有 commit 时不会触发停止", async () => {
    const stop = createCommittedTerminalStopCondition(["submit_result"]);

    expect(
      await stop({
        steps: [
          {
            toolResults: [
              {
                output: {
                  code: "INVALID_SUBMISSION",
                  committed: false,
                  message: "缺少 Artifact。",
                  ok: false,
                  retryable: true,
                  terminal: false,
                },
                toolName: "submit_result",
              },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(
      await stop({
        steps: [
          {
            toolResults: [
              {
                output: {
                  committed: false,
                  data: {},
                  ok: true,
                  summary: "还没有写入。",
                  terminal: true,
                },
                toolName: "submit_result",
              },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(
      await stop({
        steps: [
          {
            toolResults: [
              {
                output: {
                  committed: true,
                  data: {},
                  ok: true,
                  summary: "伪造终态。",
                  terminal: true,
                },
                toolName: "inspect",
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("普通文本不算完成，并在 generate 后重读 Repository", async () => {
    const load = vi.fn(async () => ({ status: "running" }));
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async () => ({ text: "任务完成了。" })),
      terminalStateLoader: {
        load,
        parse: () => null,
      },
    });

    await expect(runner.run(createRequest())).rejects.toBeInstanceOf(
      AgentTerminalNotCommittedError,
    );
    expect(load).toHaveBeenCalledWith({
      traceId: "trace-1",
      workOrderId: "work-order-1",
    });
  });

  it("tool-error 命中 fatal side-channel 后立即停止并重抛原错误", async () => {
    const fatalError = new FatalAgentRuntimeError(
      "TRACE_FENCING_FAILED",
      "trace 已过期。",
    );
    let fatalStopObserved = false;
    const load = vi.fn();
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        await settings.onToolExecutionEnd({
          toolOutput: {
            error: fatalError,
            type: "tool-error",
          },
        });
        fatalStopObserved = (
          await Promise.all(
            settings.stopWhen.map((stop) =>
              stop({ steps: [{ toolResults: [] }] }),
            ),
          )
        ).some(Boolean);
        return {};
      }),
      terminalStateLoader: {
        load,
        parse: () => null,
      },
    });

    await expect(runner.run(createRequest())).rejects.toBe(fatalError);
    expect(fatalStopObserved).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("终态工具的普通异常也会立即停止，不交回模型反复重试", async () => {
    const rawError = new Error("提交时的内部结构错误");
    let fatalStopObserved = false;
    const load = vi.fn();
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        await settings.onToolExecutionEnd({
          toolCall: {
            input: {},
            toolCallId: "tool-call-submit",
            toolName: "submit_result",
          },
          toolOutput: {
            error: rawError,
            type: "tool-error",
          },
        });
        fatalStopObserved = (
          await Promise.all(
            settings.stopWhen.map((stop) =>
              stop({ steps: [{ toolResults: [] }] }),
            ),
          )
        ).some(Boolean);
        return {};
      }),
      terminalStateLoader: {
        load,
        parse: () => null,
      },
    });

    await expect(runner.run(createRequest())).rejects.toMatchObject({
      code: "AGENT_FATAL_TOOL_ERROR",
      originalError: rawError,
    });
    expect(fatalStopObserved).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("把 abort 和显式超时交给 generate，并读取刚提交的终态", async () => {
    const abortController = new AbortController();
    let persisted: PersistedAgentTerminal<TestSubmission> | null = null;
    const generate = vi.fn(async (input: unknown) => {
      void input;
      persisted = {
        status: "submitted",
        submission: { artifactId: "artifact-after-generate" },
      };
      return {};
    });
    const load = vi.fn(async () => persisted);
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory((_settings, input) => generate(input)),
      terminalStateLoader: {
        load,
        parse: (value) =>
          isPersistedTerminal(value) ? value : null,
      },
    });
    const request = createRequest({
      abortSignal: abortController.signal,
      budget: {
        maxOutputTokens: 1_000,
        maxSteps: 5,
        maxToolCalls: 8,
        timeout: {
          stepMs: 4_000,
          toolMs: 5_000,
          totalMs: 12_000,
        },
      },
    });

    const result = await runner.run(request);

    expect(generate).toHaveBeenCalledWith({
      abortSignal: abortController.signal,
      prompt: request.prompt,
      timeout: request.budget.timeout,
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "submitted",
      submission: { artifactId: "artifact-after-generate" },
    });
  });

  it("为只有总预算的 Agent Loop 补充单步 Provider 超时并关闭 SDK 隐式重试", async () => {
    let persisted: PersistedAgentTerminal<TestSubmission> | null = null;
    let configuredMaxRetries: number | undefined;
    const generate = vi.fn(async () => {
      persisted = {
        status: "submitted",
        submission: { artifactId: "artifact-timeout-guarded" },
      };
      return {};
    });
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory((settings, input) => {
        configuredMaxRetries = settings.maxRetries;
        return generate(input);
      }),
      terminalStateLoader: {
        load: async () => persisted,
        parse: (value) =>
          isPersistedTerminal(value) ? value : null,
      },
    });

    await runner.run(
      createRequest({
        budget: {
          maxOutputTokens: 1_000,
          maxSteps: 5,
          maxToolCalls: 8,
          timeout: 900_000,
        },
      }),
    );

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: {
          stepMs: 150_000,
          totalMs: 900_000,
        },
      }),
    );
    expect(configuredMaxRetries).toBe(0);
  });

  it("内存 ToolResult 即使声称 terminal，也不能代替 Repository 终态", async () => {
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        const terminalStop = await settings.stopWhen[1]!({
          steps: [
            {
              toolResults: [
                {
                  output: {
                    committed: true,
                    data: { artifactId: "memory-only" },
                    ok: true,
                    summary: "仅存在于内存。",
                    terminal: true,
                  },
                  toolName: "submit_result",
                },
              ],
            },
          ],
        });
        expect(terminalStop).toBe(true);
        return {};
      }),
      terminalStateLoader: {
        load: async () => ({ status: "running" }),
        parse: () => null,
      },
    });

    await expect(runner.run(createRequest())).rejects.toMatchObject({
      code: "AGENT_TERMINAL_NOT_COMMITTED",
    });
  });

  it("把真实工具开始和结果写入可注入的持久化台账", async () => {
    const handle = { operationId: "operation-1" };
    const begin = vi.fn(() => handle);
    const complete = vi.fn();
    let persisted: PersistedAgentTerminal<TestSubmission> | null = null;
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        await settings.prepareStep({
          messages: [],
          stepNumber: 2,
          steps: [],
        });
        await settings.onToolExecutionStart({
          callId: "call-1",
          toolCall: {
            input: {},
            toolCallId: "tool-call-1",
            toolName: "submit_result",
          },
        });
        await settings.onToolExecutionEnd({
          callId: "call-1",
          toolCall: {
            input: {},
            toolCallId: "tool-call-1",
            toolName: "submit_result",
          },
          toolOutput: {
            output: {
              committed: true,
              data: { artifactId: "artifact-1" },
              ok: true,
              summary: "已提交。",
              terminal: true,
            },
            type: "tool-result",
          },
        });
        persisted = {
          status: "submitted",
          submission: { artifactId: "artifact-1" },
        };
        return {};
      }),
      terminalStateLoader: {
        load: async () => persisted,
        parse: (value) =>
          isPersistedTerminal(value) ? value : null,
      },
    });

    await runner.run(
      createRequest({
        toolLedger: {
          begin,
          complete,
          fail: vi.fn(),
        },
      }),
    );

    expect(begin).toHaveBeenCalledWith({
      agentStepNumber: 3,
      input: {},
      toolCallId: "tool-call-1",
      toolName: "submit_result",
      toolOrdinal: 1,
    });
    expect(complete).toHaveBeenCalledWith({
      handle,
      output: expect.objectContaining({
        committed: true,
        terminal: true,
      }),
    });
  });

  it("checkpoint 后 Harness 已提交终态时不再发起下一次模型调用", async () => {
    let persisted: PersistedAgentTerminal<TestSubmission> | null = null;
    let stopObserved = false;
    const afterToolExecution = vi.fn(async () => {
      persisted = {
        status: "submitted",
        submission: { artifactId: "artifact-by-harness" },
      };
      return true;
    });
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        await settings.onToolExecutionEnd({
          toolCall: {
            input: {},
            toolCallId: "tool-call-inspect",
            toolName: "inspect",
          },
          toolOutput: {
            output: {
              committed: false,
              data: { inspected: true },
              ok: true,
              summary: "已检查。",
              terminal: false,
            },
            type: "tool-result",
          },
        });
        stopObserved = (
          await Promise.all(
            settings.stopWhen.map((stop) =>
              stop({ steps: [{ toolResults: [] }] }),
            ),
          )
        ).some(Boolean);
        return {};
      }),
      terminalStateLoader: {
        load: async () => persisted,
        parse: (value) =>
          isPersistedTerminal(value) ? value : null,
      },
    });

    await expect(
      runner.run(createRequest({ afterToolExecution })),
    ).resolves.toMatchObject({
      status: "submitted",
      submission: { artifactId: "artifact-by-harness" },
    });
    expect(afterToolExecution).toHaveBeenCalledTimes(1);
    expect(stopObserved).toBe(true);
  });

  it("允许 Harness 在当前 activeTools 中指定唯一工具", async () => {
    let persisted: PersistedAgentTerminal<TestSubmission> | null = null;
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        await expect(
          settings.prepareStep({
            messages: [],
            stepNumber: 0,
            steps: [],
          }),
        ).resolves.toMatchObject({
          activeTools: ["submit_result"],
          toolChoice: {
            type: "tool",
            toolName: "submit_result",
          },
        });
        persisted = {
          status: "submitted",
          submission: { artifactId: "artifact-directed" },
        };
        return {};
      }),
      terminalStateLoader: {
        load: async () => persisted,
        parse: (value) =>
          isPersistedTerminal(value) ? value : null,
      },
    });

    await expect(
      runner.run(
        createRequest({
          activeTools: ["submit_result"],
          prepareStep: () => ({
            activeTools: ["submit_result"],
            toolChoice: {
              type: "tool",
              toolName: "submit_result",
            },
          }),
        }),
      ),
    ).resolves.toMatchObject({
      status: "submitted",
      submission: { artifactId: "artifact-directed" },
    });
  });

  it("拒绝 Harness 指定当前未开放的工具", async () => {
    const runner = new AgentRunner<TestTools, TestSubmission>({
      createAgent: createFakeFactory(async (settings) => {
        await settings.prepareStep({
          messages: [],
          stepNumber: 0,
          steps: [],
        });
        return {};
      }),
      terminalStateLoader: {
        load: async () => null,
        parse: () => null,
      },
    });

    await expect(
      runner.run(
        createRequest({
          activeTools: ["inspect"],
          prepareStep: () => ({
            activeTools: ["inspect"],
            toolChoice: {
              type: "tool",
              toolName: "submit_result",
            },
          }),
        }),
      ),
    ).rejects.toMatchObject({
      name: "AgentRunnerConfigurationError",
    });
  });
});

function createFakeFactory(
  generate: (
    settings: Parameters<RuntimeAgentFactory<TestTools>>[0],
    input: Parameters<
      ReturnType<RuntimeAgentFactory<TestTools>>["generate"]
    >[0],
  ) => PromiseLike<unknown>,
): RuntimeAgentFactory<TestTools> {
  return (settings) => ({
    generate: (input) => generate(settings, input),
  });
}

function createRequest(
  overrides: Partial<Parameters<AgentRunner<TestTools, TestSubmission>["run"]>[0]> = {},
): Parameters<AgentRunner<TestTools, TestSubmission>["run"]>[0] {
  return {
    authorizeToolCall: () => true,
    budget: {
      maxOutputTokens: 1_000,
      maxSteps: 5,
      maxToolCalls: 8,
      timeout: 10_000,
    },
    instructions: "必须使用工具。",
    model: {},
    prompt: "完成测试任务。",
    terminalToolNames: ["submit_result"],
    tools,
    traceId: "trace-1",
    workOrderId: "work-order-1",
    ...overrides,
  };
}

function isPersistedTerminal(
  value: unknown,
): value is PersistedAgentTerminal<TestSubmission> {
  if (!value || typeof value !== "object") return false;

  const terminal = value as Partial<PersistedAgentTerminal<TestSubmission>>;
  return (
    terminal.status === "submitted" &&
    typeof terminal.submission?.artifactId === "string"
  );
}
