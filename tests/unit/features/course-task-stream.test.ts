import { describe, expect, it } from "vitest";

import {
  parseCourseTaskStreamMessage,
  reduceCourseTaskStreamState,
  shouldCloseCourseTaskStream,
  type CourseTaskStreamState,
} from "../../../src/features/keya/use-course-task-stream";
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

  it("keeps the paused task control state separate from its running checkpoint", () => {
    const snapshot = CourseTaskStreamMessageSchema.parse({
      type: "snapshot",
      taskId,
      courseId,
      taskStatus: "paused",
      state: createState({ status: "running" }),
    });

    const next = reduceMessage(
      { connectionStatus: "connecting", messages: [] },
      snapshot,
    );

    expect(next.taskStatus).toBe("paused");
    expect(next.latestState?.status).toBe("running");
  });

  it("按 durable sequence 去重，并接受 revision 过滤造成的序号间隔", () => {
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

    const accepted = reduceMessage(state, gap);
    expect(accepted.connectionStatus).toBe("open");
    expect(accepted.error).toBeUndefined();
    expect(accepted.lastEventSequence).toBe(3);
    expect(accepted.latestState?.events.map(({ sequence }) => sequence)).toEqual(
      [1, 3],
    );
    expect(shouldCloseCourseTaskStream(state, accepted)).toBe(false);
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

  it("接受更新时间更晚但 revision 已裁掉旧事件的 snapshot，并保留 durable cursor", () => {
    const event = {
      id: "event-7",
      sequence: 7,
      type: "agent_done" as const,
      traceId,
      timestamp: "2026-07-15T02:00:07.000Z",
      step: 7,
      summary: "旧 revision 已完成。",
      stage: "planner" as const,
      agent: "curriculum-architect",
    };
    const current: CourseTaskStreamState = {
      connectionStatus: "open",
      taskStatus: "running",
      lastEventSequence: 7,
      messages: [],
      latestState: createState({
        events: [event],
        updatedAt: "2026-07-15T02:00:07.000Z",
      }),
    };
    const newRevision = CourseTaskStreamMessageSchema.parse({
      type: "snapshot",
      taskId,
      courseId,
      state: createState({
        currentStage: "planner",
        events: [],
        updatedAt: "2026-07-15T02:00:08.000Z",
      }),
    });

    const next = reduceMessage(current, newRevision);

    expect(next.latestState?.events).toEqual([]);
    expect(next.lastEventSequence).toBe(7);
    expect(next.connectionStatus).toBe("open");
  });

  it("resume 新 trace 先接收 snapshot 后，可安全合并新页面事件", () => {
    const resumedTraceId = "trace-sse-task-resumed";
    const previous: CourseTaskStreamState = {
      connectionStatus: "open",
      taskStatus: "running",
      lastEventSequence: 10,
      messages: [],
      latestState: createState({
        traceId,
        currentStage: "planner",
        pages: [],
        events: [
          {
            id: "event-old-10",
            sequence: 10,
            type: "agent_done",
            traceId,
            timestamp: "2026-07-15T02:00:10.000Z",
            step: 10,
            summary: "旧 trace 已暂停。",
            stage: "planner",
          },
        ],
      }),
    };
    const resumedSnapshot = CourseTaskStreamMessageSchema.parse({
      type: "snapshot",
      taskId,
      courseId,
      taskStatus: "running",
      state: createState({
        traceId: resumedTraceId,
        currentStage: "page_writer",
        pages: [
          {
            pageId: "page-new",
            order: 1,
            status: "running",
            currentStage: "page_writer",
            assets: [],
          },
        ],
        events: [],
        updatedAt: "2026-07-15T02:01:00.000Z",
      }),
    });
    const resumedPageEvent = CourseTaskStreamMessageSchema.parse({
      type: "event",
      taskId,
      courseId,
      event: {
        id: "event-new-11",
        sequence: 11,
        type: "agent_start",
        traceId: resumedTraceId,
        timestamp: "2026-07-15T02:01:01.000Z",
        step: 11,
        summary: "新 trace 页面 Agent 已领取任务。",
        stage: "page_writer",
        pageId: "page-new",
        agent: "page-builder",
      },
    });

    const withSnapshot = reduceMessage(previous, resumedSnapshot);
    const withEvent = reduceMessage(withSnapshot, resumedPageEvent);

    expect(withSnapshot.latestState?.traceId).toBe(resumedTraceId);
    expect(withEvent.connectionStatus).toBe("open");
    expect(withEvent.error).toBeUndefined();
    expect(withEvent.latestState?.events.at(-1)).toMatchObject({
      sequence: 11,
      pageId: "page-new",
      traceId: resumedTraceId,
    });
    expect(shouldCloseCourseTaskStream(withSnapshot, withEvent)).toBe(false);
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
