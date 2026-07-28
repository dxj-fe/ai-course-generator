import {
  AiSchemaValidationError,
  toAiErrorPayload,
} from "@/server/ai/error";

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
        const stateError = toAgentStateError(error, context.traceId);
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
              summary: publicAgentErrorSummary(stateError),
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

function toAgentStateError(
  error: unknown,
  traceId: string,
): AgentStateError {
  if (error instanceof AgentRuntimeError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof AiSchemaValidationError) {
    return { code: error.code, message: error.message };
  }

  const classified = toAiErrorPayload(error, traceId);
  if (classified.code === "CANCELLED_ERROR") {
    return { code: "AGENT_ABORTED", message: classified.message };
  }
  if (
    classified.code === "AUTH_ERROR" ||
    classified.code === "CONFIG_ERROR" ||
    classified.code === "MODEL_ERROR" ||
    classified.code === "QUOTA_ERROR" ||
    classified.code === "RATE_LIMIT_ERROR" ||
    classified.code === "SCHEMA_ERROR" ||
    classified.code === "TIMEOUT_ERROR"
  ) {
    return { code: classified.code, message: classified.message };
  }

  return {
    code: "AGENT_EXECUTION_ERROR",
    message: "Agent 执行失败，请稍后重试。",
  };
}

function publicAgentErrorSummary(error: AgentStateError) {
  if (error.code === "SCHEMA_ERROR") {
    return "模型返回的内容格式不完整。";
  }
  return error.message;
}
