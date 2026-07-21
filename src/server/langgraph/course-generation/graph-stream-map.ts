import { z } from "zod";

import {
  CourseGenerationStateSchema,
  type CourseGenerationPublicEvent,
  type CourseGenerationState,
} from "@/shared/course-schema";

const CourseGenerationGraphNodeNameSchema = z.enum([
  "intent-node",
  "planner-node",
  "briefs-node",
  "page-workers-node",
  "repair-page-node",
  "retry-page-node",
  "supervisor-node",
  "mark-failed-node",
  "finalize-node",
]);

/** Graph 内部 custom channel 的唯一允许形态，不会直接发送给浏览器。 */
export const CourseGraphCheckpointEnvelopeSchema = z
  .object({
    type: z.literal("checkpoint"),
    state: CourseGenerationStateSchema,
  })
  .strict();

export type MappedCourseGraphChunk = {
  state: CourseGenerationState;
  events: CourseGenerationPublicEvent[];
  cursor: number;
};

type MapGraphChunkOptions = {
  cursor: number;
  traceId: string;
};

export function createCourseGraphCheckpointEnvelope(
  state: CourseGenerationState,
) {
  return CourseGraphCheckpointEnvelopeSchema.parse({
    type: "checkpoint",
    state,
  });
}

/**
 * 把 LangGraph 多模式 chunk 收敛为现有产品状态和公开事件。
 * 原生 node update、debug data 与框架元数据不会越过这个服务端边界。
 */
export function mapGraphChunkToAgentEvent(
  chunk: unknown,
  options: MapGraphChunkOptions,
): MappedCourseGraphChunk {
  if (!Number.isSafeInteger(options.cursor) || options.cursor < 0) {
    throw new Error("LangGraph stream cursor 必须是非负安全整数。");
  }
  if (!Array.isArray(chunk) || chunk.length !== 2) {
    throw new Error("LangGraph stream chunk 必须是 [mode, payload]。");
  }

  const [mode, payload] = chunk;
  let state: CourseGenerationState;

  if (mode === "custom") {
    state = CourseGraphCheckpointEnvelopeSchema.parse(payload).state;
  } else if (mode === "updates") {
    state = parseGraphUpdate(payload);
  } else {
    throw new Error(`LangGraph stream mode 不允许进入产品事件层：${String(mode)}`);
  }

  const events = state.events.filter(
    ({ sequence }) => sequence > options.cursor,
  );
  for (const [index, event] of events.entries()) {
    const expectedSequence = options.cursor + index + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `LangGraph 公开事件序号不连续：期望 ${expectedSequence}，收到 ${event.sequence}。`,
      );
    }
    if (event.traceId !== options.traceId) {
      throw new Error("LangGraph 公开事件引用了其他 traceId。");
    }
  }

  return {
    state,
    events,
    cursor: events.at(-1)?.sequence ?? options.cursor,
  };
}

function parseGraphUpdate(payload: unknown): CourseGenerationState {
  if (!isRecord(payload)) {
    throw new Error("LangGraph updates payload 必须是节点更新对象。");
  }

  const entries = Object.entries(payload);
  if (entries.length !== 1) {
    throw new Error("LangGraph updates payload 必须只包含一个节点结果。");
  }

  const [nodeName, update] = entries[0]!;
  CourseGenerationGraphNodeNameSchema.parse(nodeName);
  return CourseGenerationStateSchema.parse(update);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
