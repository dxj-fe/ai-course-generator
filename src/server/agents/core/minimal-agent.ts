import { createAgentEvent } from "./events";
import type {
  Agent,
  AgentEventDraft,
  AgentRuntimeContext,
  AgentStateBase,
  AgentStateError,
  AgentStep,
} from "./types";

export type CreateMinimalAgentOptions<State extends AgentStateBase> = {
  isComplete(state: State): boolean;
  step: AgentStep<State>;
};

export function createMinimalAgent<State extends AgentStateBase>({
  isComplete,
  step,
}: CreateMinimalAgentOptions<State>): Agent<State> {
  return {
    async run(initialState, context) {
      let pendingEvents: AgentEventDraft[] = [];
      let state = appendEvents(
        {
          ...initialState,
          status: "running",
          error: undefined,
        },
        context,
        0,
        [{ type: "start", summary: "Agent 开始执行。" }],
      );

      try {
        while (!isComplete(state)) {
          if (context.abortSignal?.aborted) {
            throw new AgentRuntimeError("AGENT_ABORTED", "Agent 执行已取消。");
          }

          if (state.step >= state.maxSteps) {
            throw new AgentRuntimeError(
              "AGENT_STEP_LIMIT",
              `Agent 达到最大步骤数 ${state.maxSteps}，但任务尚未完成。`,
            );
          }

          pendingEvents = [];
          const nextState = await step(state, context, (event) => {
            pendingEvents.push(event);
          });
          const nextStep = state.step + 1;

          state = appendEvents(
            {
              ...nextState,
              status: "running",
              step: nextStep,
              events: state.events,
              error: undefined,
            },
            context,
            nextStep,
            pendingEvents,
          );
          pendingEvents = [];
        }

        return appendEvents(
          { ...state, status: "completed", error: undefined },
          context,
          state.step,
          [{ type: "finish", summary: "Agent 已完成任务。" }],
        );
      } catch (error) {
        const stateError = toAgentStateError(error);
        const failedStep =
          state.step >= state.maxSteps ? state.step : state.step + 1;

        return appendEvents(
          {
            ...state,
            status: "failed",
            step: failedStep,
            error: stateError,
          },
          context,
          failedStep,
          [
            ...pendingEvents,
            {
              type: "error",
              summary: stateError.message,
              data: { code: stateError.code },
            },
          ],
        );
      }
    },
  };
}

function appendEvents<State extends AgentStateBase>(
  state: State,
  context: AgentRuntimeContext,
  step: number,
  drafts: AgentEventDraft[],
): State {
  const events = drafts.map((draft, index) =>
    createAgentEvent(
      draft,
      context,
      state.events.length + index + 1,
      step,
    ),
  );

  return { ...state, events: [...state.events, ...events] };
}

class AgentRuntimeError extends Error {
  constructor(
    readonly code: AgentStateError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

function toAgentStateError(error: unknown): AgentStateError {
  if (error instanceof AgentRuntimeError) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "AGENT_EXECUTION_ERROR",
    message: error instanceof Error ? error.message : "未知 Agent 执行错误。",
  };
}
