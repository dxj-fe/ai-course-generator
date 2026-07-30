import { describe, expect, it } from "vitest";

import {
  CourseGenerationPublicEventSchema,
  CourseTaskControlRequestSchema,
  CourseTaskControlResponseSchema,
  CourseTaskCreateResponseSchema,
  CourseTaskRecordSchema,
  CourseTaskStreamMessageSchema,
  type CourseGenerationState,
} from "../../../src/shared/course-schema";

const timestamp = "2026-07-15T03:00:00.000Z";
const creationBrief = {
  originalRequest: "生成三页太阳系互动课程",
  topic: "太阳系",
  audience: "初学者",
  goal: "理解行星特征与太阳系结构",
  sectionCount: 3,
  learningMode: "mixed" as const,
  language: "zh-CN" as const,
};

function runningState(
  overrides: Partial<CourseGenerationState> = {},
): CourseGenerationState {
  return {
    version: 1,
    courseId: "course-day-19",
    traceId: "trace-day-19",
    userPrompt: "生成三页太阳系互动课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function publicEvent(
  type:
    | "agent_start"
    | "agent_done"
    | "supervisor_decision"
    | "page_done",
) {
  return {
    id: `event-${type}`,
    sequence: 1,
    type,
    traceId: "trace-day-19",
    timestamp,
    step: 1,
    summary: `${type} summary`,
    stage: "intent" as const,
    agent: "intent",
  };
}

describe("Day 19 course task protocol", () => {
  it.each([
    "agent_start",
    "agent_done",
    "supervisor_decision",
    "page_done",
  ] as const)(
    "accepts the public %s event type",
    (type) => {
      expect(CourseGenerationPublicEventSchema.parse(publicEvent(type)).type).toBe(
        type,
      );
    },
  );

  it("validates a persisted task record and queued creation response", () => {
    const record = CourseTaskRecordSchema.parse({
      version: 1,
      taskId: "task-day-19",
      courseId: "course-day-19",
      traceId: "trace-day-19",
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "langgraph",
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(
      CourseTaskCreateResponseSchema.parse({
        taskId: record.taskId,
        courseId: record.courseId,
        traceId: record.traceId,
        status: record.status,
        source: record.source,
      }),
    ).toEqual({
      taskId: "task-day-19",
      courseId: "course-day-19",
      traceId: "trace-day-19",
      status: "queued",
      source: "langgraph",
    });
  });

  it("requires a structured creation brief only for agent-v2 records", () => {
    expect(
      CourseTaskRecordSchema.safeParse({
        version: 1,
        taskId: "task-agent-v2",
        courseId: "course-agent-v2",
        traceId: "trace-agent-v2",
        userPrompt: "生成三页太阳系互动课程",
        source: "agent-v2",
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);

    expect(
      CourseTaskRecordSchema.parse({
        version: 1,
        taskId: "task-agent-v2",
        courseId: "course-agent-v2",
        traceId: "trace-agent-v2",
        userPrompt: "生成三页太阳系互动课程",
        creationBrief,
        source: "agent-v2",
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({
      source: "agent-v2",
      creationBrief,
    });
  });

  it("keeps legacy records readable when source or creationBrief is absent", () => {
    expect(
      CourseTaskRecordSchema.parse({
        version: 1,
        taskId: "task-legacy-record",
        courseId: "course-legacy-record",
        traceId: "trace-legacy-record",
        userPrompt: "生成旧版课程",
        status: "completed",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({ source: "workflow" });
  });

  it("keeps pause as a non-terminal task control state", () => {
    expect(
      CourseTaskControlRequestSchema.parse({ action: "pause" }),
    ).toEqual({ action: "pause" });
    expect(
      CourseTaskControlResponseSchema.parse({
        taskId: "task-day-19",
        courseId: "course-day-19",
        traceId: "trace-day-19-resumed",
        status: "paused",
        source: "langgraph",
      }),
    ).toMatchObject({
      status: "paused",
      traceId: "trace-day-19-resumed",
    });
  });

  it("accepts snapshot, public event, and matching terminal messages", () => {
    const state = runningState();
    const event = publicEvent("agent_start");
    const failedState = runningState({ status: "failed" });

    expect(
      CourseTaskStreamMessageSchema.parse({
        type: "snapshot",
        taskId: "task-day-19",
        courseId: state.courseId,
        source: "langgraph",
        taskStatus: "paused",
        state,
      }).type,
    ).toBe("snapshot");
    expect(
      CourseTaskStreamMessageSchema.parse({
        type: "event",
        taskId: "task-day-19",
        courseId: state.courseId,
        source: "langgraph",
        event,
      }).type,
    ).toBe("event");
    expect(
      CourseTaskStreamMessageSchema.parse({
        type: "terminal",
        taskId: "task-day-19",
        courseId: failedState.courseId,
        source: "langgraph",
        status: "failed",
        state: failedState,
      }).type,
    ).toBe("terminal");
  });

  it.each([
    { payload: { reasoning: "private" } },
    { data: { systemPrompt: "private" } },
    { apiKey: "secret" },
  ])("rejects non-public stream fields: %j", (privateField) => {
    const result = CourseTaskStreamMessageSchema.safeParse({
      type: "event",
      taskId: "task-day-19",
      courseId: "course-day-19",
      event: publicEvent("agent_done"),
      ...privateField,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a terminal status or course id that differs from its state", () => {
    const failedState = runningState({ status: "failed" });

    expect(
      CourseTaskStreamMessageSchema.safeParse({
        type: "terminal",
        taskId: "task-day-19",
        courseId: failedState.courseId,
        status: "completed",
        state: failedState,
      }).success,
    ).toBe(false);
    expect(
      CourseTaskStreamMessageSchema.safeParse({
        type: "snapshot",
        taskId: "task-day-19",
        courseId: "course-other",
        state: failedState,
      }).success,
    ).toBe(false);
  });
});
