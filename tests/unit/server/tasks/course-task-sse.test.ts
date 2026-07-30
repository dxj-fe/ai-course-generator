import { describe, expect, it } from "vitest";

import {
  encodeCourseTaskSseMessage,
  parseLastEventId,
} from "../../../../src/server/course/task/sse";
import { CourseGenerationStateSchema } from "../../../../src/shared/course-schema";

const state = CourseGenerationStateSchema.parse({
  version: 1,
  courseId: "course-123e4567-e89b-42d3-a456-426614174000",
  traceId: "trace-sse",
  userPrompt: "生成一门三页太阳系课程",
  status: "running",
  currentStage: "intent",
  pages: [],
  events: [
    {
      id: "event-1",
      sequence: 1,
      type: "agent_start",
      traceId: "trace-sse",
      timestamp: "2026-07-15T06:00:00.000Z",
      step: 0,
      summary: "Intent Agent 已开始。",
      stage: "intent",
      agent: "intent",
    },
  ],
  errors: [],
  startedAt: "2026-07-15T06:00:00.000Z",
  updatedAt: "2026-07-15T06:00:00.000Z",
});

describe("course task SSE codec", () => {
  it("encodes a named snapshot with the persisted sequence cursor", () => {
    const frame = encodeCourseTaskSseMessage({
      type: "snapshot",
      taskId: "task-123e4567-e89b-42d3-a456-426614174000",
      courseId: state.courseId,
      source: "langgraph",
      state,
    });

    expect(frame).toContain("id: v1:trace-sse:1\n");
    expect(frame).toContain("event: snapshot\n");
    expect(frame).toContain('"type":"snapshot"');
    expect(frame).toContain('"source":"langgraph"');
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("parses a valid replay cursor and rejects malformed values", () => {
    expect(parseLastEventId(null)).toBeUndefined();
    expect(parseLastEventId("0")).toEqual({ sequence: 0 });
    expect(parseLastEventId("17")).toEqual({ sequence: 17 });
    expect(parseLastEventId("v1:trace-sse:17")).toEqual({
      traceId: "trace-sse",
      sequence: 17,
    });
    expect(parseLastEventId("v1:trace%3Aresume:2")).toEqual({
      traceId: "trace:resume",
      sequence: 2,
    });
    expect(() => parseLastEventId("1.5")).toThrow(/有效的 trace 游标/);
    expect(() => parseLastEventId("-1")).toThrow(/有效的 trace 游标/);
  });
});
