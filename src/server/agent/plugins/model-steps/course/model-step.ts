import {
  AiSchemaValidationError,
  serializeErrorForLog,
  toAiErrorPayload,
} from "@/server/infra/ai/error";

import { createModelStepEvent } from "./events";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepError,
  ModelStepEventDraft,
  ModelStepStateBase,
} from "./types";

export type CreateModelStepOptions<State extends ModelStepStateBase> = {
  name: string;
  isComplete(state: State): boolean;
  step(
    state: State,
    context: ModelStepContext,
    emit: (event: ModelStepEventDraft) => void,
  ): Promise<State>;
};

/**
 * 运行一次有明确输入、输出和校验规则的模型调用。
 * 它没有自主循环、工具选择或任务分派能力，因此不把自己伪装成 Agent。
 */
export function createModelStep<State extends ModelStepStateBase>({
  name,
  isComplete,
  step,
}: CreateModelStepOptions<State>): ModelStep<State> {
  return {
    async run(initialState, context) {
      let pendingEvents: ModelStepEventDraft[] = [];
      let state = appendEvents(
        {
          ...initialState,
          status: "running",
          error: undefined,
        },
        context,
        0,
        [{ type: "start", summary: "模型步骤开始执行。" }],
      );

      try {
        throwIfAborted(context.abortSignal);
        if (isComplete(state)) {
          return appendEvents(
            { ...state, status: "completed", error: undefined },
            context,
            state.step,
            [{ type: "finish", summary: "模型步骤已完成。" }],
          );
        }

        const nextState = await step(state, context, (event) => {
          pendingEvents.push(event);
        });
        throwIfAborted(context.abortSignal);
        state = appendEvents(
          {
            ...nextState,
            status: "running",
            step: 1,
            maxSteps: 1,
            events: state.events,
            error: undefined,
          },
          context,
          1,
          pendingEvents,
        );
        pendingEvents = [];

        if (!isComplete(state)) {
          throw new ModelStepRuntimeError(
            "MODEL_STEP_OUTPUT_MISSING",
            "模型步骤执行结束，但没有生成有效产物。",
          );
        }

        return appendEvents(
          { ...state, status: "completed", error: undefined },
          context,
          1,
          [{ type: "finish", summary: "模型步骤已完成。" }],
        );
      } catch (error) {
        const stateError = toModelStepError(error, context.traceId);
        console.error("[model-step]", {
          event: "model-step:error",
          modelStep: name,
          traceId: context.traceId,
          errorCode: stateError.code,
          publicErrorMessage: stateError.message.slice(0, 4_000),
          ...serializeErrorForLog(error),
        });

        return appendEvents(
          {
            ...state,
            status: "failed",
            step: 1,
            maxSteps: 1,
            error: stateError,
          },
          context,
          1,
          [
            ...pendingEvents,
            {
              type: "error",
              summary: publicModelStepErrorSummary(stateError),
              data: { code: stateError.code },
            },
          ],
        );
      }
    },
  };
}

function appendEvents<State extends ModelStepStateBase>(
  state: State,
  context: ModelStepContext,
  step: number,
  drafts: ModelStepEventDraft[],
): State {
  const events = drafts.map((draft, index) =>
    createModelStepEvent(
      draft,
      context,
      state.events.length + index + 1,
      step,
    ),
  );
  return { ...state, events: [...state.events, ...events] };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ModelStepRuntimeError(
      "MODEL_STEP_ABORTED",
      "模型步骤执行已取消。",
    );
  }
}

class ModelStepRuntimeError extends Error {
  constructor(
    readonly code: ModelStepError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ModelStepRuntimeError";
  }
}

function toModelStepError(
  error: unknown,
  traceId: string,
): ModelStepError {
  if (error instanceof ModelStepRuntimeError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof AiSchemaValidationError) {
    return { code: error.code, message: error.message };
  }

  const classified = toAiErrorPayload(error, traceId);
  if (classified.code === "CANCELLED_ERROR") {
    return {
      code: "MODEL_STEP_ABORTED",
      message: classified.message,
    };
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
    code: "MODEL_STEP_EXECUTION_ERROR",
    message: "模型步骤执行失败，请稍后重试。",
  };
}

function publicModelStepErrorSummary(error: ModelStepError) {
  if (error.code === "SCHEMA_ERROR") {
    return "模型返回的内容格式不完整。";
  }
  return error.message;
}

