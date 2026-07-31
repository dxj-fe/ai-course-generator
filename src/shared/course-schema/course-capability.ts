import type { CourseGenerationState } from "./course-generation-state";

export type PublicAgentEvent = {
  id: string;
  sequence: number;
  type:
    | "start"
    | "agent_start"
    | "agent_done"
    | "model_call"
    | "tool_call"
    | "validation"
    | "repair_attempt"
    | "repair_success"
    | "page_done"
    | "finish"
    | "error";
  summary: string;
  traceId?: string;
  timestamp?: string;
  step?: number;
  data?: Record<string, unknown>;
};

export type CourseGenerationResponse = {
  courseId: string;
  traceId: string;
  state: CourseGenerationState;
};
