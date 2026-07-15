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

/** 序列化单个已校验消息；业务事件 sequence 同时作为 SSE 重放游标。 */
export function encodeCourseTaskSseMessage(
  input: CourseTaskStreamMessage,
): string {
  const message = CourseTaskStreamMessageSchema.parse(input);
  const cursor = courseTaskMessageCursor(message);
  const fields = [
    ...(cursor === undefined ? [] : [`id: ${cursor}`]),
    `event: ${message.type}`,
    `data: ${JSON.stringify(message)}`,
  ];

  return `${fields.join("\n")}\n\n`;
}

export function courseTaskMessageCursor(
  message: CourseTaskStreamMessage,
): number | undefined {
  if (message.type === "event") return message.event.sequence;
  return message.state.events.at(-1)?.sequence;
}

export function parseLastEventId(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error("Last-Event-ID 必须是非负整数。");

  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor)) {
    throw new Error("Last-Event-ID 超出安全整数范围。");
  }
  return cursor;
}
