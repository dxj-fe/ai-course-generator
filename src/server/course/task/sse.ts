import {
  CourseTaskStreamMessageSchema,
  type CourseTaskStreamMessage,
} from "@/shared/course-schema";

export const COURSE_TASK_SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
} as const;

export type CourseTaskReplayCursor = {
  traceId: string;
  sequence: number;
};

/** 序列化单个已校验消息；traceId + sequence 共同组成 SSE 重放游标。 */
export function encodeCourseTaskSseMessage(
  input: CourseTaskStreamMessage,
  cursorOverride?: CourseTaskReplayCursor,
): string {
  const message = CourseTaskStreamMessageSchema.parse(input);
  const cursor = cursorOverride ?? courseTaskMessageCursor(message);
  const fields = [
    ...(cursor === undefined ? [] : [`id: ${encodeReplayCursor(cursor)}`]),
    `event: ${message.type}`,
    `data: ${JSON.stringify(message)}`,
  ];

  return `${fields.join("\n")}\n\n`;
}

export function courseTaskMessageCursor(
  message: CourseTaskStreamMessage,
): CourseTaskReplayCursor | undefined {
  if (message.type === "event") {
    return {
      traceId: message.event.traceId,
      sequence: message.event.sequence,
    };
  }
  const sequence = message.state.events.at(-1)?.sequence;
  return sequence === undefined
    ? undefined
    : { traceId: message.state.traceId, sequence };
}

export function parseLastEventId(
  value: string | null,
): CourseTaskReplayCursor | undefined {
  if (value === null || value.trim() === "") return undefined;
  const match = /^([^:]+):(\d+)$/.exec(value);
  if (!match) {
    throw new Error("Last-Event-ID 必须是有效的 trace 游标。");
  }
  let traceId: string;
  try {
    traceId = decodeURIComponent(match[1]);
  } catch {
    throw new Error("Last-Event-ID 包含无效的 trace 编码。");
  }
  if (!traceId.trim() || traceId.length > 120 || /[\r\n\0]/.test(traceId)) {
    throw new Error("Last-Event-ID 包含无效的 traceId。");
  }
  return { traceId, sequence: parseSequence(match[2]) };
}

function encodeReplayCursor(cursor: CourseTaskReplayCursor) {
  return `${encodeURIComponent(cursor.traceId)}:${cursor.sequence}`;
}

function parseSequence(value: string) {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) {
    throw new Error("Last-Event-ID 超出安全整数范围。");
  }
  return sequence;
}
