import type {
  AgentEvent,
  AgentEventDraft,
  AgentRuntimeContext,
} from "./types";

export function createAgentEvent(
  draft: AgentEventDraft,
  context: AgentRuntimeContext,
  sequence: number,
  step: number,
): AgentEvent {
  return {
    ...draft,
    id: crypto.randomUUID(),
    sequence,
    traceId: context.traceId,
    timestamp: new Date().toISOString(),
    step,
  };
}
