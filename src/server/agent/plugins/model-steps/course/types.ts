export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ModelStepStatus = "idle" | "running" | "completed" | "failed";

export type ModelStepEventType =
  | "start"
  | "model_call"
  | "tool_call"
  | "validation"
  | "finish"
  | "error";

export type ModelStepEvent = {
  id: string;
  sequence: number;
  type: ModelStepEventType;
  traceId: string;
  timestamp: string;
  step: number;
  summary: string;
  data?: Record<string, JsonValue>;
};

export type ModelStepEventDraft = Pick<
  ModelStepEvent,
  "type" | "summary" | "data"
>;

export type ModelStepError = {
  code:
    | "MODEL_STEP_ABORTED"
    | "MODEL_STEP_EXECUTION_ERROR"
    | "MODEL_STEP_OUTPUT_MISSING"
    | "AUTH_ERROR"
    | "CONFIG_ERROR"
    | "MODEL_ERROR"
    | "QUOTA_ERROR"
    | "RATE_LIMIT_ERROR"
    | "SCHEMA_ERROR"
    | "TIMEOUT_ERROR";
  message: string;
};

export type ModelStepStateBase = {
  status: ModelStepStatus;
  step: number;
  maxSteps: 1;
  events: ModelStepEvent[];
  error?: ModelStepError;
};

export type ModelStepContext = {
  abortSignal?: AbortSignal;
  traceId: string;
};

export type EmitModelStepEvent = (event: ModelStepEventDraft) => void;

export type ModelStep<State extends ModelStepStateBase> = {
  run(initialState: State, context: ModelStepContext): Promise<State>;
};

