import { describe, expect, it } from "vitest";

import {
  parseCourseTaskStreamMessage,
  reduceCourseTaskStreamState,
  shouldCloseCourseTaskStream,
  type CourseTaskStreamState,
} from "../../../src/features/course-planner/hooks/use-sse-task";
import {
  CourseTaskStreamMessageSchema,
  type CourseGenerationState,
  type CourseTaskStreamMessage,
} from "../../../src/shared/course-schema";

const taskId = "task-123e4567-e89b-42d3-a456-426614174000";
const courseId = "course-123e4567-e89b-42d3-a456-426614174000";
const traceId = "trace-sse-task";

function createState(
  overrides: Partial<CourseGenerationState> = {},
): CourseGenerationState {
  return {
    version: 1,
    courseId,
    traceId,
    userPrompt: "生成三页太阳系课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: "2026-07-15T02:00:00.000Z",
    updatedAt: "2026-07-15T02:00:00.000Z",
    ...overrides,
  };
}

function reduceMessage(
  state: CourseTaskStreamState,
  message: CourseTaskStreamMessage,
) {
  return reduceCourseTaskStreamState(state, { type: "message", message });
}

describe("course task SSE client state", () => {
  it("parses a public snapshot and rejects private data", () => {
    const snapshot = {
      type: "snapshot",
      taskId,
      courseId,
      state: createState(),
    };

    expect(parseCourseTaskStreamMessage(JSON.stringify(snapshot))).toEqual(
      snapshot,
    );

    expect(() =>
      parseCourseTaskStreamMessage(
        JSON.stringify({
          type: "event",
          taskId,
          courseId,
          event: {
            id: "event-1",
            sequence: 1,
            type: "agent_start",
            traceId,
            timestamp: "2026-07-15T02:00:01.000Z",
            step: 1,
            summary: "Intent Agent 开始理解课程需求。",
            stage: "intent",
            agent: "intent",
            data: { systemPrompt: "private" },
          },
        }),
      ),
    ).toThrow("课程任务事件不符合协议");
  });

  it("replaces state from snapshot and appends one ordered event", () => {
    const snapshot = CourseTaskStreamMessageSchema.parse({
      type: "snapshot",
      taskId,
      courseId,
      state: createState(),
    });
    const eventMessage = CourseTaskStreamMessageSchema.parse({
      type: "event",
      taskId,
      courseId,
      event: {
        id: "event-1",
        sequence: 1,
        type: "agent_start",
        traceId,
        timestamp: "2026-07-15T02:00:01.000Z",
        step: 1,
        summary: "Intent Agent 开始理解课程需求。",
        stage: "intent",
        agent: "intent",
      },
    }) as Extract<CourseTaskStreamMessage, { type: "event" }>;
    const connecting = reduceCourseTaskStreamState(
      { connectionStatus: "idle", messages: [] },
      { type: "reset", enabled: true },
    );
    const withSnapshot = reduceMessage(connecting, snapshot);
    const withEvent = reduceMessage(withSnapshot, eventMessage);

    expect(withSnapshot.taskStatus).toBe("running");
    expect(withEvent.latestState?.events).toEqual([eventMessage.event]);
    expect(withEvent.latestState?.updatedAt).toBe(eventMessage.event.timestamp);
    expect(withEvent.messages).toEqual([snapshot, eventMessage]);
  });

  it("deduplicates a replayed sequence and reports a sequence gap", () => {
    const event = {
      id: "event-1",
      sequence: 1,
      type: "agent_start" as const,
      traceId,
      timestamp: "2026-07-15T02:00:01.000Z",
      step: 1,
      summary: "Intent Agent 开始理解课程需求。",
      stage: "intent" as const,
      agent: "intent",
    };
    const state: CourseTaskStreamState = {
      connectionStatus: "open",
      taskStatus: "running",
      messages: [],
      latestState: createState({ events: [event] }),
    };
    const duplicate = CourseTaskStreamMessageSchema.parse({
      type: "event",
      taskId,
      courseId,
      event,
    });
    const gap = CourseTaskStreamMessageSchema.parse({
      type: "event",
      taskId,
      courseId,
      event: {
        ...event,
        id: "event-3",
        sequence: 3,
      },
    });

    expect(reduceMessage(state, duplicate)).toBe(state);

    const invalid = reduceMessage(state, gap);
    expect(invalid.connectionStatus).toBe("closed");
    expect(invalid.error?.message).toContain("期望 2，收到 3");
    expect(invalid.latestState?.events).toHaveLength(1);
    expect(shouldCloseCourseTaskStream(state, invalid)).toBe(true);
  });

  it("does not roll state back when route initialization buffers an older snapshot", () => {
    const event = {
      id: "event-2",
      sequence: 2,
      type: "agent_done" as const,
      traceId,
      timestamp: "2026-07-15T02:00:02.000Z",
      step: 1,
      summary: "Intent Agent 已完成课程需求解析。",
      stage: "intent" as const,
      agent: "intent",
    };
    const current: CourseTaskStreamState = {
      connectionStatus: "open",
      taskStatus: "running",
      messages: [],
      latestState: createState({ events: [
        { ...event, id: "event-1", sequence: 1, type: "agent_start" },
        event,
      ] }),
    };
    const stale = CourseTaskStreamMessageSchema.parse({
      type: "snapshot",
      taskId,
      courseId,
      state: createState({
        events: [
          { ...event, id: "event-1", sequence: 1, type: "agent_start" },
        ],
      }),
    });

    expect(reduceMessage(current, stale)).toBe(current);
  });

  it("keeps a network reconnect separate from task failure and accepts terminal state", () => {
    const current: CourseTaskStreamState = {
      connectionStatus: "open",
      taskStatus: "running",
      messages: [],
      latestState: createState(),
    };
    const reconnecting = reduceCourseTaskStreamState(current, {
      type: "reconnecting",
    });

    expect(reconnecting.connectionStatus).toBe("reconnecting");
    expect(reconnecting.taskStatus).toBe("running");

    const terminal = CourseTaskStreamMessageSchema.parse({
      type: "terminal",
      taskId,
      courseId,
      status: "failed",
      state: createState({ status: "failed" }),
    });
    const finished = reduceMessage(reconnecting, terminal);

    expect(finished.connectionStatus).toBe("closed");
    expect(finished.taskStatus).toBe("failed");
    expect(finished.latestState?.status).toBe("failed");
  });
});
