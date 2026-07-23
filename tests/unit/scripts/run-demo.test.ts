import { describe, expect, it } from "vitest";

import { parseCourseTaskSseFrame } from "../../../scripts/run-demo";

describe("Day 36 Demo SSE parser", () => {
  it("ignores heartbeat frames", () => {
    expect(parseCourseTaskSseFrame(": ping")).toBeUndefined();
  });

  it("parses and validates a strict terminal frame", () => {
    const state = {
      version: 1,
      courseId: "course-demo-terminal",
      traceId: "trace-demo-terminal",
      userPrompt: "生成一门固定 Demo 课程",
      status: "cancelled",
      currentStage: "intent",
      pages: [],
      events: [],
      errors: [
        {
          stage: "intent",
          code: "COURSE_TASK_CANCELLED",
          message: "课程生成已取消。",
        },
      ],
      startedAt: "2026-07-23T01:00:00.000Z",
      updatedAt: "2026-07-23T01:01:00.000Z",
      completedAt: "2026-07-23T01:01:00.000Z",
      durationMs: 60_000,
    };
    const message = {
      type: "terminal",
      taskId: "task-demo-terminal",
      courseId: state.courseId,
      source: "langgraph",
      status: "cancelled",
      state,
    };

    expect(
      parseCourseTaskSseFrame(
        `id: 0\nevent: terminal\ndata: ${JSON.stringify(message)}`,
      ),
    ).toEqual(message);
  });
});
