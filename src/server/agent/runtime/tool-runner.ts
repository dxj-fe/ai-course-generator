import type { ToolSet } from "@ai-sdk/provider-utils";

import { AtomicBudgetMeter } from "./budget";
import {
  AgentRunnerConfigurationError,
  AgentToolAuthorizationError,
  FatalAgentRuntimeError,
  throwIfAgentAborted,
} from "./errors";
import {
  boundAgentToolResult,
  DEFAULT_MAX_TOOL_RESULT_BYTES,
} from "./tool-result";

type ToolExecutionOptions = {
  abortSignal?: AbortSignal;
  [key: string]: unknown;
};

type RuntimeToolExecute = (
  input: unknown,
  options: ToolExecutionOptions,
) => AsyncIterable<unknown> | PromiseLike<unknown> | unknown;

export type AuthorizeAgentToolCall = (input: {
  input: unknown;
  toolName: string;
}) => boolean | void | PromiseLike<boolean | void>;

export type RuntimeToolGuardOptions = {
  authorizeToolCall: AuthorizeAgentToolCall;
  beforeToolCall?: () => void | PromiseLike<void>;
  budgetMeter: AtomicBudgetMeter;
  maxToolResultBytes?: number;
  resolveToolCost?: (toolName: string, input: unknown) => number;
};

/**
 * activeTools 只负责少给模型看工具；这里才是执行前的权限边界。
 * 所有课程 Agent 工具必须是本地 execute 工具，禁止 Provider 代执行绕过策略检查。
 */
export function wrapToolsWithRuntimeGuards<Tools extends ToolSet>(
  tools: Tools,
  options: RuntimeToolGuardOptions,
): Tools {
  const guardedEntries = Object.entries(tools).map(([toolName, tool]) => {
    const definition = tool as unknown as Record<string, unknown>;
    const execute = definition.execute;

    if (typeof execute !== "function") {
      throw new AgentRunnerConfigurationError(
        `课程 Agent 工具 ${toolName} 缺少本地 execute，无法执行权限检查。`,
      );
    }

    return [
      toolName,
      {
        ...definition,
        execute: createGuardedExecute(
          toolName,
          execute as RuntimeToolExecute,
          definition,
          options,
        ),
      },
    ];
  });

  return Object.fromEntries(guardedEntries) as Tools;
}

function createGuardedExecute(
  toolName: string,
  execute: RuntimeToolExecute,
  receiver: Record<string, unknown>,
  options: RuntimeToolGuardOptions,
): RuntimeToolExecute {
  return (input, executionOptions) => {
    const costUnits = options.resolveToolCost?.(toolName, input) ?? 1;

    // 必须在任何 await 之前 reserve，避免同一步多个 tool call 超卖。
    options.budgetMeter.reserve(toolName, costUnits);

    return executeAuthorizedTool({
      authorizeToolCall: options.authorizeToolCall,
      beforeToolCall: options.beforeToolCall,
      execute,
      executionOptions,
      input,
      maxToolResultBytes:
        options.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES,
      receiver,
      toolName,
    });
  };
}

async function* executeAuthorizedTool(input: {
  authorizeToolCall: AuthorizeAgentToolCall;
  beforeToolCall?: () => void | PromiseLike<void>;
  execute: RuntimeToolExecute;
  executionOptions: ToolExecutionOptions;
  input: unknown;
  maxToolResultBytes: number;
  receiver: Record<string, unknown>;
  toolName: string;
}) {
  throwIfAgentAborted(input.executionOptions.abortSignal);
  await input.beforeToolCall?.();
  throwIfAgentAborted(input.executionOptions.abortSignal);

  let authorized: boolean | void;
  try {
    authorized = await input.authorizeToolCall({
      input: input.input,
      toolName: input.toolName,
    });
  } catch (error) {
    if (error instanceof FatalAgentRuntimeError) {
      throw error;
    }
    throw new AgentToolAuthorizationError(input.toolName, error);
  }

  if (authorized === false) {
    throw new AgentToolAuthorizationError(input.toolName);
  }

  throwIfAgentAborted(input.executionOptions.abortSignal);
  const result = input.execute.call(
    input.receiver,
    input.input,
    input.executionOptions,
  );

  if (isAsyncIterable(result)) {
    let yielded = false;
    for await (const output of result) {
      yielded = true;
      yield boundAgentToolResult(output, input.maxToolResultBytes);
    }
    if (!yielded) {
      yield boundAgentToolResult(undefined, input.maxToolResultBytes);
    }
    return;
  }

  yield boundAgentToolResult(
    await result,
    input.maxToolResultBytes,
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}
