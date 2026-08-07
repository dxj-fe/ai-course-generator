import type { ToolSet } from "@ai-sdk/provider-utils";
import {
  isStepCount,
  ToolLoopAgent,
  type TimeoutConfiguration,
  type ToolLoopAgentSettings,
} from "ai";

import {
  AtomicBudgetMeter,
  type ToolBudgetSnapshot,
} from "./budget";
import {
  AgentRunnerConfigurationError,
  AgentTerminalNotCommittedError,
  FatalAgentRuntimeError,
  isFatalAgentToolError,
  throwIfAgentAborted,
} from "./errors";
import {
  wrapToolsWithRuntimeGuards,
  type AuthorizeAgentToolCall,
} from "./tool-runner";
import { isCommittedTerminalToolResult } from "./tool-result";

const DEFAULT_AGENT_STEP_TIMEOUT_MS = 240_000;

export type AgentTerminalStatus = "accepted" | "blocked" | "submitted";

export type PersistedAgentTerminal<Terminal> = {
  status: AgentTerminalStatus;
  submission: Terminal;
};

export type AgentTerminalStateLoader<Terminal> = {
  load(input: {
    traceId: string;
    workOrderId: string;
  }): PromiseLike<unknown>;
  parse(value: unknown): PersistedAgentTerminal<Terminal> | null;
};

export type RuntimeStep = {
  toolResults?: Array<{
    output?: unknown;
    toolName?: string;
  }>;
};

export type RuntimeStopCondition = (input: {
  steps: RuntimeStep[];
}) => boolean | PromiseLike<boolean>;

export type RuntimePrepareStepInput = {
  messages: unknown[];
  stepNumber: number;
  steps: RuntimeStep[];
  [key: string]: unknown;
};

export type RuntimePrepareStepResult = {
  activeTools?: string[];
  instructions?: unknown;
  messages?: unknown[];
  providerOptions?: unknown;
  toolChoice?:
    | "required"
    | {
        type: "tool";
        toolName: string;
      };
  [key: string]: unknown;
};

export type RuntimeToolExecutionEndEvent = {
  callId?: string;
  toolCall?: {
    input?: unknown;
    toolCallId?: string;
    toolName?: string;
  };
  toolOutput: {
    error?: unknown;
    output?: unknown;
    type: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type RuntimeToolExecutionStartEvent = {
  callId?: string;
  toolCall?: {
    input?: unknown;
    toolCallId?: string;
    toolName?: string;
  };
  [key: string]: unknown;
};

export type AgentToolLedger = {
  begin(input: {
    agentStepNumber: number;
    input: unknown;
    toolCallId?: string;
    toolName: string;
    toolOrdinal: number;
  }): unknown | PromiseLike<unknown>;
  complete(input: {
    handle: unknown;
    output: unknown;
  }): void | PromiseLike<void>;
  fail(input: {
    error: unknown;
    handle: unknown;
  }): void | PromiseLike<void>;
};

export type RuntimeAgentFactorySettings<Tools extends ToolSet> = {
  activeTools: string[];
  instructions: string;
  maxOutputTokens: number;
  model: unknown;
  onToolExecutionStart: (
    event: RuntimeToolExecutionStartEvent,
  ) => void | PromiseLike<void>;
  onToolExecutionEnd: (
    event: RuntimeToolExecutionEndEvent,
  ) => void | PromiseLike<void>;
  prepareStep: (
    input: RuntimePrepareStepInput,
  ) => RuntimePrepareStepResult | PromiseLike<RuntimePrepareStepResult>;
  stopWhen: RuntimeStopCondition[];
  temperature?: number;
  toolChoice: "required";
  tools: Tools;
};

export type RuntimeAgentLike<Tools extends ToolSet> = {
  generate(input: {
    abortSignal?: AbortSignal;
    prompt: string;
    timeout: TimeoutConfiguration<Tools>;
  }): PromiseLike<unknown>;
};

export type RuntimeAgentFactory<Tools extends ToolSet> = (
  settings: RuntimeAgentFactorySettings<Tools>,
) => RuntimeAgentLike<Tools>;

export type AgentRunnerBudget<Tools extends ToolSet> = {
  maxCostUnits?: number;
  maxOutputTokens: number;
  maxSteps: number;
  maxToolCalls: number;
  maxToolResultBytes?: number;
  timeout: TimeoutConfiguration<Tools>;
};

export type AgentRunnerRequest<Tools extends ToolSet> = {
  abortSignal?: AbortSignal;
  activeTools?: Array<keyof Tools & string>;
  authorizeToolCall: AuthorizeAgentToolCall;
  /** 在每次真实工具执行前重新核对持久化任务控制态。 */
  beforeToolCall?: () => void | PromiseLike<void>;
  budget: AgentRunnerBudget<Tools>;
  budgetMeter?: AtomicBudgetMeter;
  instructions: string;
  isFatalToolError?: (error: unknown) => boolean;
  model: unknown;
  prepareStep?: (
    input: RuntimePrepareStepInput,
  ) =>
    | RuntimePrepareStepResult
    | undefined
    | PromiseLike<RuntimePrepareStepResult | undefined>;
  prompt: string;
  resolveToolCost?: (toolName: string, input: unknown) => number;
  temperature?: number;
  terminalToolNames: Array<keyof Tools & string>;
  toolLedger?: AgentToolLedger;
  tools: Tools;
  traceId: string;
  workOrderId: string;
};

export type AgentRunnerResult<Terminal> = PersistedAgentTerminal<Terminal> & {
  budget: ToolBudgetSnapshot;
};

export type AgentRunnerDependencies<
  Tools extends ToolSet,
  Terminal,
> = {
  createAgent?: RuntimeAgentFactory<Tools>;
  terminalStateLoader: AgentTerminalStateLoader<Terminal>;
};

type ExecutionGuard = {
  fatalError?: Error;
};

export class AgentRunner<Tools extends ToolSet, Terminal> {
  private readonly createAgent: RuntimeAgentFactory<Tools>;

  constructor(
    private readonly dependencies: AgentRunnerDependencies<Tools, Terminal>,
  ) {
    this.createAgent =
      dependencies.createAgent ?? createAiSdkToolLoopAgent<Tools>;
  }

  async run(
    request: AgentRunnerRequest<Tools>,
  ): Promise<AgentRunnerResult<Terminal>> {
    validateRunnerRequest(request);
    throwIfAgentAborted(request.abortSignal);

    const executionGuard: ExecutionGuard = {};
    const runStartedAt = Date.now();
    let modelStepStartedAt = runStartedAt;
    let currentStepNumber = 1;
    let toolOrdinal = 0;
    const ledgerHandles = new Map<string, Promise<unknown>>();
    const toolStartedAt = new Map<string, number>();
    const budgetMeter =
      request.budgetMeter ??
      new AtomicBudgetMeter({
        maxCostUnits: request.budget.maxCostUnits,
        maxToolCalls: request.budget.maxToolCalls,
      });
    const guardedTools = wrapToolsWithRuntimeGuards(
      request.tools,
      {
        authorizeToolCall: request.authorizeToolCall,
        beforeToolCall: request.beforeToolCall,
        budgetMeter,
        maxToolResultBytes: request.budget.maxToolResultBytes,
        resolveToolCost: request.resolveToolCost,
      },
    );
    const configuredToolNames = Object.keys(guardedTools);
    const initialActiveTools = validateActiveTools(
      request.activeTools ?? configuredToolNames,
      configuredToolNames,
    );
    const terminalStop = createCommittedTerminalStopCondition(
      request.terminalToolNames,
    );
    const terminalToolNames = new Set<string>(
      request.terminalToolNames,
    );
    const fatalStop: RuntimeStopCondition = () =>
      executionGuard.fatalError !== undefined;
    const stepLimit = isStepCount(
      request.budget.maxSteps,
    ) as RuntimeStopCondition;
    const agent = this.createAgent({
      activeTools: initialActiveTools,
      instructions: request.instructions,
      maxOutputTokens: request.budget.maxOutputTokens,
      model: request.model,
      onToolExecutionStart: async (event) => {
        const toolName = event.toolCall?.toolName;
        if (!toolName) {
          throw new FatalAgentRuntimeError(
            "TOOL_LEDGER_EVENT_INVALID",
            "工具开始事件缺少 toolName，无法写入执行台账。",
          );
        }
        toolOrdinal += 1;
        const key = toolLedgerKey(event);
        toolStartedAt.set(key, Date.now());
        console.info("[agent-runner]", {
          event: "agent-step:tool-start",
          traceId: request.traceId,
          workOrderId: request.workOrderId,
          stepNumber: currentStepNumber,
          toolName,
          modelDurationMs: Date.now() - modelStepStartedAt,
        });
        if (!request.toolLedger) return;
        const handle = Promise.resolve(
          request.toolLedger.begin({
            agentStepNumber: currentStepNumber,
            input: event.toolCall?.input,
            toolCallId: event.toolCall?.toolCallId,
            toolName,
            toolOrdinal,
          }),
        );
        ledgerHandles.set(key, handle);
        await handle;
      },
      onToolExecutionEnd: async (event) => {
        const key = toolLedgerKey(event);
        const startedAt = toolStartedAt.get(key);
        console.info("[agent-runner]", {
          event: "agent-step:tool-end",
          traceId: request.traceId,
          workOrderId: request.workOrderId,
          stepNumber: currentStepNumber,
          toolName: event.toolCall?.toolName,
          toolDurationMs:
            startedAt === undefined ? undefined : Date.now() - startedAt,
          outcome: event.toolOutput.type,
        });
        toolStartedAt.delete(key);
        const terminalToolError =
          event.toolOutput.type === "tool-error" &&
          typeof event.toolCall?.toolName === "string" &&
          terminalToolNames.has(event.toolCall.toolName)
            ? toTerminalToolError(
                event.toolCall.toolName,
                event.toolOutput.error,
              )
            : undefined;
        if (request.toolLedger) {
          const handle = ledgerHandles.get(key);
          if (!handle) {
            throw new FatalAgentRuntimeError(
              "TOOL_LEDGER_START_MISSING",
              "工具结束时找不到对应的执行台账。",
            );
          }
          if (event.toolOutput.type === "tool-error") {
            await request.toolLedger.fail({
              error:
                terminalToolError ?? event.toolOutput.error,
              handle: await handle,
            });
          } else {
            await request.toolLedger.complete({
              handle: await handle,
              output: event.toolOutput.output,
            });
          }
        }
        if (
          event.toolOutput.type === "tool-error" &&
          (terminalToolError ||
            shouldStopForToolError(
              event.toolOutput.error,
              request.isFatalToolError,
            ))
        ) {
          executionGuard.fatalError ??=
            terminalToolError ?? toError(event.toolOutput.error);
        }
      },
      prepareStep: async (input) => {
        currentStepNumber = input.stepNumber + 1;
        const prepared = await request.prepareStep?.(input);
        const activeTools = validateActiveTools(
          prepared?.activeTools ?? initialActiveTools,
          configuredToolNames,
        );
        const toolChoice = validatePreparedToolChoice(
          prepared?.toolChoice,
          activeTools,
        );

        modelStepStartedAt = Date.now();
        return {
          ...prepared,
          activeTools,
          // 每一步都必须通过工具交活；普通文本永远不算完成。
          toolChoice,
        };
      },
      stopWhen: [fatalStop, terminalStop, stepLimit],
      temperature: request.temperature,
      toolChoice: "required",
      tools: guardedTools,
    });

    console.info("[agent-runner]", {
      event: "agent-run:start",
      traceId: request.traceId,
      workOrderId: request.workOrderId,
      maxSteps: request.budget.maxSteps,
      maxToolCalls: request.budget.maxToolCalls,
    });
    try {
      await agent.generate({
        abortSignal: request.abortSignal,
        prompt: request.prompt,
        timeout: withDefaultStepTimeout(request.budget.timeout),
      });
    } catch (error) {
      const runtimeError = executionGuard.fatalError ?? error;
      console.error("[agent-runner]", {
        event: "agent-run:error",
        traceId: request.traceId,
        workOrderId: request.workOrderId,
        errorName:
          runtimeError instanceof Error ? runtimeError.name : typeof runtimeError,
        errorMessage:
          runtimeError instanceof Error
            ? runtimeError.message.slice(0, 4_000)
            : String(runtimeError).slice(0, 4_000),
        errorStack:
          runtimeError instanceof Error
            ? runtimeError.stack?.slice(0, 8_000)
            : undefined,
        durationMs: Date.now() - runStartedAt,
      });
      throw runtimeError;
    }

    throwIfAgentAborted(request.abortSignal);
    if (executionGuard.fatalError) {
      throw executionGuard.fatalError;
    }

    // 不能相信模型文本或内存中的 ToolResult，必须重新读取持久化状态。
    const persisted = await this.dependencies.terminalStateLoader.load({
      traceId: request.traceId,
      workOrderId: request.workOrderId,
    });
    const terminal = this.dependencies.terminalStateLoader.parse(persisted);

    if (!terminal) {
      throw new AgentTerminalNotCommittedError(request.workOrderId);
    }

    console.info("[agent-runner]", {
      event: "agent-run:completed",
      traceId: request.traceId,
      workOrderId: request.workOrderId,
      status: terminal.status,
      durationMs: Date.now() - runStartedAt,
      budget: budgetMeter.snapshot(),
    });

    return {
      ...terminal,
      budget: budgetMeter.snapshot(),
    };
  }
}

export function createCommittedTerminalStopCondition(
  terminalToolNames: readonly string[],
): RuntimeStopCondition {
  const allowedNames = new Set(terminalToolNames);

  return ({ steps }) =>
    steps.at(-1)?.toolResults?.some(
      (result) =>
        typeof result.toolName === "string" &&
        allowedNames.has(result.toolName) &&
        isCommittedTerminalToolResult(result.output),
    ) ?? false;
}

function createAiSdkToolLoopAgent<Tools extends ToolSet>(
  settings: RuntimeAgentFactorySettings<Tools>,
): RuntimeAgentLike<Tools> {
  return new ToolLoopAgent(
    settings as unknown as ToolLoopAgentSettings<never, Tools>,
  ) as unknown as RuntimeAgentLike<Tools>;
}

function validatePreparedToolChoice(
  toolChoice: RuntimePrepareStepResult["toolChoice"],
  activeTools: string[],
): NonNullable<RuntimePrepareStepResult["toolChoice"]> {
  if (toolChoice === undefined || toolChoice === "required") {
    return "required";
  }
  if (
    toolChoice.type !== "tool" ||
    typeof toolChoice.toolName !== "string" ||
    !activeTools.includes(toolChoice.toolName)
  ) {
    throw new AgentRunnerConfigurationError(
      "prepareStep 的指定工具必须属于当前 activeTools。",
    );
  }

  return toolChoice;
}

function toolLedgerKey(
  event:
    | RuntimeToolExecutionStartEvent
    | RuntimeToolExecutionEndEvent,
) {
  return (
    event.toolCall?.toolCallId ??
    event.callId ??
    `${event.toolCall?.toolName ?? "unknown"}:${JSON.stringify(
      event.toolCall?.input ?? null,
    )}`
  );
}

function validateRunnerRequest<Tools extends ToolSet>(
  request: AgentRunnerRequest<Tools>,
) {
  assertPositiveInteger(request.budget.maxSteps, "maxSteps");
  assertPositiveInteger(request.budget.maxOutputTokens, "maxOutputTokens");
  assertPositiveInteger(request.budget.maxToolCalls, "maxToolCalls");

  if (request.terminalToolNames.length === 0) {
    throw new AgentRunnerConfigurationError(
      "terminalToolNames 至少要包含一个 submit_* 或 block_* 工具。",
    );
  }

  validateActiveTools(
    request.terminalToolNames,
    Object.keys(request.tools),
  );
  validateTimeout(request.budget.timeout);
}

function validateTimeout<Tools extends ToolSet>(
  timeout: TimeoutConfiguration<Tools>,
) {
  if (typeof timeout === "number") {
    assertPositiveInteger(timeout, "timeout");
    return;
  }

  if (
    timeout.totalMs === undefined ||
    !Number.isInteger(timeout.totalMs) ||
    timeout.totalMs <= 0
  ) {
    throw new AgentRunnerConfigurationError(
      "timeout 对象必须设置正整数 totalMs，保证整个 Agent run 有硬上限。",
    );
  }
}

/**
 * 总预算防止 Agent Loop 无限制运行；单步预算则防止某一次 Provider 请求
 * 独占整个任务预算。调用方显式设置 stepMs 时保持其选择。
 */
function withDefaultStepTimeout<Tools extends ToolSet>(
  timeout: TimeoutConfiguration<Tools>,
): TimeoutConfiguration<Tools> {
  if (typeof timeout === "number") {
    return {
      totalMs: timeout,
      stepMs: Math.min(timeout, DEFAULT_AGENT_STEP_TIMEOUT_MS),
    };
  }

  return {
    ...timeout,
    stepMs:
      timeout.stepMs ??
      Math.min(timeout.totalMs!, DEFAULT_AGENT_STEP_TIMEOUT_MS),
  };
}

function validateActiveTools(
  requested: readonly string[],
  configured: readonly string[],
) {
  const configuredNames = new Set(configured);
  const uniqueNames = [...new Set(requested)];
  const unknownNames = uniqueNames.filter(
    (toolName) => !configuredNames.has(toolName),
  );

  if (unknownNames.length > 0) {
    throw new AgentRunnerConfigurationError(
      `activeTools 包含未配置工具：${unknownNames.join(", ")}。`,
    );
  }

  return uniqueNames;
}

function shouldStopForToolError(
  error: unknown,
  customClassifier?: (error: unknown) => boolean,
) {
  return (
    isFatalAgentToolError(error) ||
    customClassifier?.(error) === true
  );
}

function toError(error: unknown) {
  if (error instanceof Error) return error;

  return new FatalAgentRuntimeError(
    "AGENT_FATAL_TOOL_ERROR",
    "Agent 工具发生不可恢复错误。",
    error,
  );
}

function toTerminalToolError(toolName: string, error: unknown) {
  if (isFatalAgentToolError(error)) return toError(error);

  return new FatalAgentRuntimeError(
    "AGENT_FATAL_TOOL_ERROR",
    `终态工具 ${toolName} 执行失败。`,
    error,
  );
}

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AgentRunnerConfigurationError(`${field} 必须是正整数。`);
  }
}
