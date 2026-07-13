export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AgentStatus = "idle" | "running" | "completed" | "failed";

export type AgentEventType =
  | "start"
  | "model_call"
  | "tool_call"
  | "finish"
  | "error";

export type AgentEvent = {
  id: string;
  sequence: number;
  type: AgentEventType;
  traceId: string;
  timestamp: string;
  step: number;
  summary: string;
  data?: Record<string, JsonValue>;
};

export type AgentEventDraft = Pick<AgentEvent, "type" | "summary" | "data">;

export type AgentStateError = {
  code: "AGENT_ABORTED" | "AGENT_EXECUTION_ERROR" | "AGENT_STEP_LIMIT";
  message: string;
};

export type AgentStateBase = {
  status: AgentStatus;
  step: number;
  maxSteps: number;
  events: AgentEvent[];
  error?: AgentStateError;
};

export type AgentRuntimeContext = {
  abortSignal?: AbortSignal;
  traceId: string;
};

export type EmitAgentEvent = (event: AgentEventDraft) => void;

export type Agent<State extends AgentStateBase> = {
  run(initialState: State, context: AgentRuntimeContext): Promise<State>;
};

export type AgentStep<State extends AgentStateBase> = (
  state: State,
  context: AgentRuntimeContext,
  emit: EmitAgentEvent,
) => Promise<State>;
