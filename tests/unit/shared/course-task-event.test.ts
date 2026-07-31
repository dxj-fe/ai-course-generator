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
    courseId: "course-fixture-19",
    traceId: "trace-fixture-19",
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
    traceId: "trace-fixture-19",
    timestamp,
    step: 1,
    summary: `${type} summary`,
    stage: "intent" as const,
    agent: "intent",
  };
}

describe("course task protocol", () => {
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
      taskId: "task-fixture-19",
      courseId: "course-fixture-19",
      traceId: "trace-fixture-19",
      userPrompt: "生成三页太阳系互动课程",
      creationBrief,
      pageCount: 3,
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
      }),
    ).toEqual({
      taskId: "task-fixture-19",
      courseId: "course-fixture-19",
      traceId: "trace-fixture-19",
      status: "queued",
    });
  });

  it("requires a structured creation brief", () => {
    expect(
      CourseTaskRecordSchema.safeParse({
        taskId: "task-current",
        courseId: "course-current",
        traceId: "trace-current",
        userPrompt: "生成三页太阳系互动课程",
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);

    expect(
      CourseTaskRecordSchema.parse({
        taskId: "task-current",
        courseId: "course-current",
        traceId: "trace-current",
        userPrompt: "生成三页太阳系互动课程",
        creationBrief,
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({ creationBrief });
  });

  it("keeps pause as a non-terminal task control state", () => {
    expect(
      CourseTaskControlRequestSchema.parse({ action: "pause" }),
    ).toEqual({ action: "pause" });
    expect(
      CourseTaskControlResponseSchema.parse({
        taskId: "task-fixture-19",
        courseId: "course-fixture-19",
        traceId: "trace-fixture-19-resumed",
        status: "paused",
      }),
    ).toMatchObject({
      status: "paused",
      traceId: "trace-fixture-19-resumed",
    });
  });

  it("accepts snapshot, public event, and matching terminal messages", () => {
    const state = runningState();
    const event = publicEvent("agent_start");
    const failedState = runningState({ status: "failed" });

    expect(
      CourseTaskStreamMessageSchema.parse({
        type: "snapshot",
        taskId: "task-fixture-19",
        courseId: state.courseId,
        taskStatus: "paused",
        state,
      }).type,
    ).toBe("snapshot");
    expect(
      CourseTaskStreamMessageSchema.parse({
        type: "event",
        taskId: "task-fixture-19",
        courseId: state.courseId,
        event,
      }).type,
    ).toBe("event");
    expect(
      CourseTaskStreamMessageSchema.parse({
        type: "terminal",
        taskId: "task-fixture-19",
        courseId: failedState.courseId,
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
      taskId: "task-fixture-19",
      courseId: "course-fixture-19",
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
        taskId: "task-fixture-19",
        courseId: failedState.courseId,
        status: "completed",
        state: failedState,
      }).success,
    ).toBe(false);
    expect(
      CourseTaskStreamMessageSchema.safeParse({
        type: "snapshot",
        taskId: "task-fixture-19",
        courseId: "course-other",
        state: failedState,
      }).success,
    ).toBe(false);
  });
});
