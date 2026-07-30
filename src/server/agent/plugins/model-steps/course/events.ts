import type {
  ModelStepContext,
  ModelStepEvent,
  ModelStepEventDraft,
} from "./types";

export function createModelStepEvent(
  draft: ModelStepEventDraft,
  context: ModelStepContext,
  sequence: number,
  step: number,
): ModelStepEvent {
  return {
    ...draft,
    id: crypto.randomUUID(),
    sequence,
    traceId: context.traceId,
    timestamp: new Date().toISOString(),
    step,
  };
}

