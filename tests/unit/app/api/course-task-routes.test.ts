import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CourseGenerationPublicEvent,
  CourseGenerationState,
  CourseTaskRecord,
  CourseTaskStreamMessage,
} from "../../../../src/shared/course-schema";

const mocks = vi.hoisted(() => {
  const subscribers = new Map<
    string,
    Set<(message: CourseTaskStreamMessage) => void>
  >();

  return {
    after: vi.fn(),
    create: vi.fn(),
    run: vi.fn(),
    loadTask: vi.fn(),
    cancel: vi.fn(),
    loadCourse: vi.fn(),
    subscribers,
    subscribe: vi.fn(
      (taskId: string, subscriber: (message: CourseTaskStreamMessage) => void) => {
        const listeners = subscribers.get(taskId) ?? new Set();
        listeners.add(subscriber);
        subscribers.set(taskId, listeners);

        return () => {
          listeners.delete(subscriber);
          if (listeners.size === 0) subscribers.delete(taskId);
        };
      },
    ),
  };
});

vi.mock("next/server", () => ({ after: mocks.after }));

vi.mock("@/server/storage/course-store", () => ({
  createCourseStore: () => ({ load: mocks.loadCourse }),
}));

vi.mock("@/server/tasks/course-generation-task-service", () => ({
  courseGenerationTaskService: {
    create: mocks.create,
    run: mocks.run,
    load: mocks.loadTask,
    cancel: mocks.cancel,
  },
}));

vi.mock("@/server/tasks/course-task-event-bus", () => ({
  courseTaskEventBus: { subscribe: mocks.subscribe },
}));

import { DELETE } from "../../../../src/app/api/courses/tasks/[taskId]/route";
import { GET } from "../../../../src/app/api/courses/tasks/[taskId]/events/route";
import { POST } from "../../../../src/app/api/courses/tasks/route";

const timestamp = "2026-07-15T06:00:00.000Z";
const taskId = "task-day-19-route";
const courseId = "course-day-19-route";
const traceId = "trace-day-19-route";

describe("course task Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribers.clear();
  });

  it("POST validates JSON, returns 202, and schedules the workflow after the response", async () => {
    mocks.create.mockResolvedValue({
      taskId,
      courseId,
      traceId,
      status: "queued",
      source: "langgraph",
    });
    mocks.run.mockResolvedValue(runningState());

    const response = await POST(
      new Request("http://localhost/api/courses/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": "trace-from-header",
        },
        body: JSON.stringify({
          userPrompt: "生成三页太阳系互动课程",
          pageCount: 3,
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      taskId,
      courseId,
      traceId,
      status: "queued",
      source: "langgraph",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      traceId: "trace-from-header",
    });
    expect(mocks.run).not.toHaveBeenCalled();

    const scheduled = mocks.after.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduled).toBeTypeOf("function");
    await scheduled?.();
    expect(mocks.run).toHaveBeenCalledWith(taskId);
  });

  it("POST rejects malformed JSON without creating a task", async () => {
    const response = await POST(
      new Request("http://localhost/api/courses/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "请求体必须是有效的 JSON。",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("GET returns 404 for a missing task", async () => {
    mocks.loadTask.mockResolvedValue(undefined);

    const response = await GET(
      new Request(`http://localhost/api/courses/tasks/${taskId}/events`),
      routeContext(taskId),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "课程任务不存在。",
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("GET and DELETE reject an unsafe taskId before touching storage", async () => {
    const invalidTaskId = "../private";
    const getResponse = await GET(
      new Request("http://localhost/api/courses/tasks/invalid/events"),
      routeContext(invalidTaskId),
    );
    const deleteResponse = await DELETE(
      new Request("http://localhost/api/courses/tasks/invalid", {
        method: "DELETE",
      }),
      routeContext(invalidTaskId),
    );

    expect(getResponse.status).toBe(400);
    expect(deleteResponse.status).toBe(400);
    await expect(getResponse.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "taskId 格式无效。",
    });
    await expect(deleteResponse.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "taskId 格式无效。",
    });
    expect(mocks.loadTask).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("GET sends the initial snapshot and then a live public event", async () => {
    const task = taskRecord();
    const state = runningState({ events: [publicEvent(1)] });
    mocks.loadTask.mockResolvedValue(task);
    mocks.loadCourse.mockResolvedValue(state);

    const response = await GET(
      new Request(`http://localhost/api/courses/tasks/${taskId}/events`),
      routeContext(taskId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const first = await readSseChunk(reader!);
    expect(first).toContain("id: 1\nevent: snapshot\n");
    expect(first).toContain('"type":"snapshot"');

    publish({
      type: "event",
      taskId,
      courseId,
      source: "workflow",
      event: publicEvent(2, "agent_done"),
    });
    const second = await readSseChunk(reader!);
    expect(second).toContain("id: 2\nevent: event\n");
    expect(second).toContain('"type":"agent_done"');

    await reader?.cancel();
    expect(mocks.subscribers.has(taskId)).toBe(false);
  });

  it("GET replays events after Last-Event-ID and closes with the persisted terminal state", async () => {
    const events = [
      publicEvent(1),
      publicEvent(2, "agent_done"),
      publicEvent(3, "page_done"),
    ];
    const state = runningState({
      status: "failed",
      events,
      errors: [
        {
          stage: "intent",
          code: "COURSE_TASK_EXECUTION_ERROR",
          message: "生成失败。",
        },
      ],
    });
    mocks.loadTask.mockResolvedValue(taskRecord({ status: "failed" }));
    mocks.loadCourse.mockResolvedValue(state);

    const response = await GET(
      new Request(`http://localhost/api/courses/tasks/${taskId}/events`, {
        headers: { "last-event-id": "1" },
      }),
      routeContext(taskId),
    );
    const payload = await response.text();
    const replayedEvents = payload
      .split("\n\n")
      .filter((frame) => frame.includes("event: event\n"));

    expect(replayedEvents).toHaveLength(2);
    expect(replayedEvents[0]).toContain('"sequence":2');
    expect(replayedEvents[1]).toContain('"sequence":3');
    expect(payload).toContain("id: 2\nevent: event\n");
    expect(payload).toContain("id: 3\nevent: event\n");
    expect(payload).toContain("id: 3\nevent: terminal\n");
    expect(payload).toContain('"status":"failed"');
    expect(mocks.subscribers.has(taskId)).toBe(false);
  });

  it("GET rejects an invalid replay cursor before subscribing", async () => {
    const response = await GET(
      new Request(`http://localhost/api/courses/tasks/${taskId}/events`, {
        headers: { "last-event-id": "1.5" },
      }),
      routeContext(taskId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "Last-Event-ID 必须是非负整数。",
    });
    expect(mocks.loadTask).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("DELETE returns the cancelled task and returns 404 when it does not exist", async () => {
    mocks.cancel.mockResolvedValueOnce(taskRecord({ status: "cancelled" }));

    const cancelled = await DELETE(
      new Request(`http://localhost/api/courses/tasks/${taskId}`, {
        method: "DELETE",
      }),
      routeContext(taskId),
    );

    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({
      taskId,
      status: "cancelled",
      traceId,
    });
    expect(mocks.cancel).toHaveBeenCalledWith(taskId);

    mocks.cancel.mockResolvedValueOnce(undefined);
    const missing = await DELETE(
      new Request(`http://localhost/api/courses/tasks/${taskId}`, {
        method: "DELETE",
      }),
      routeContext(taskId),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "课程任务不存在。",
    });
  });
});

function routeContext(id: string) {
  return { params: Promise.resolve({ taskId: id }) };
}

function taskRecord(
  overrides: Partial<CourseTaskRecord> = {},
): CourseTaskRecord {
  return {
    version: 1,
    taskId,
    courseId,
    traceId,
    userPrompt: "生成三页太阳系互动课程",
    pageCount: 3,
    status: "running",
    source: "workflow",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function runningState(
  overrides: Partial<CourseGenerationState> = {},
): CourseGenerationState {
  return {
    version: 1,
    courseId,
    traceId,
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
  sequence: number,
  type: "agent_start" | "agent_done" | "page_done" = "agent_start",
): CourseGenerationPublicEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    type,
    traceId,
    timestamp,
    step: sequence,
    summary: `${type} ${sequence}`,
    stage: "intent",
    agent: "intent",
  };
}

function publish(message: CourseTaskStreamMessage) {
  for (const subscriber of mocks.subscribers.get(message.taskId) ?? []) {
    subscriber(message);
  }
}

async function readSseChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { done, value } = await reader.read();
  expect(done).toBe(false);
  return new TextDecoder().decode(value);
}
