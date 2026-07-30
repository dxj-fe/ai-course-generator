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
  /**
   * 旧版客户端只会回传数字游标，因此允许缺少 traceId。新版游标把 trace
   * 一起编码，任务 pause/resume 更换 trace 后不会误把新事件当成旧重复项。
   */
  traceId?: string;
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
  if (/^\d+$/.test(value)) {
    return { sequence: parseSequence(value) };
  }

  const match = /^v1:([^:]+):(\d+)$/.exec(value);
  if (!match) {
    throw new Error("Last-Event-ID 必须是非负整数或有效的 trace 游标。");
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
  return cursor.traceId
    ? `v1:${encodeURIComponent(cursor.traceId)}:${cursor.sequence}`
    : String(cursor.sequence);
}

function parseSequence(value: string) {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) {
    throw new Error("Last-Event-ID 超出安全整数范围。");
  }
  return sequence;
}
