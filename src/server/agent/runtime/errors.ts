import { AgentBudgetExceededError } from "./budget";

export class FatalAgentRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "FatalAgentRuntimeError";
  }
}

export class AgentToolAuthorizationError extends FatalAgentRuntimeError {
  constructor(toolName: string, originalError?: unknown) {
    super(
      "AGENT_TOOL_FORBIDDEN",
      `当前 WorkOrder 无权执行工具 ${toolName}。`,
      originalError,
    );
    this.name = "AgentToolAuthorizationError";
  }
}

export class AgentTerminalNotCommittedError extends Error {
  readonly code = "AGENT_TERMINAL_NOT_COMMITTED";

  constructor(readonly workOrderId: string) {
    super(`WorkOrder ${workOrderId} 没有持久化合法终态。`);
    this.name = "AgentTerminalNotCommittedError";
  }
}

export class AgentRunnerConfigurationError extends Error {
  readonly code = "AGENT_RUNNER_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "AgentRunnerConfigurationError";
  }
}

export function isFatalAgentToolError(error: unknown) {
  return (
    error instanceof FatalAgentRuntimeError ||
    error instanceof AgentBudgetExceededError ||
    isAbortError(error)
  );
}

export function throwIfAgentAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;

  throw (
    signal.reason ??
    new DOMException("Agent 执行已取消。", "AbortError")
  );
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
