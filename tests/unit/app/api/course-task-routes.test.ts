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
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    loadCourse: vi.fn(),
    listPublicEvents: vi.fn(),
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

vi.mock("@/server/setup/web", () => ({
  getWebServices: () => ({
    courseEvents: { subscribe: mocks.subscribe },
    coursePublicEvents: {
      listAfter: mocks.listPublicEvents,
    },
    courses: { load: mocks.loadCourse },
    courseTasks: {
      create: mocks.create,
      run: mocks.run,
      load: mocks.loadTask,
      pause: mocks.pause,
      resume: mocks.resume,
      cancel: mocks.cancel,
    },
  }),
}));

import {
  DELETE,
  PATCH,
} from "../../../../src/app/api/courses/tasks/[taskId]/route";
import { GET } from "../../../../src/app/api/courses/tasks/[taskId]/events/route";
import { POST } from "../../../../src/app/api/courses/tasks/route";

const timestamp = "2026-07-15T06:00:00.000Z";
const taskId = "task-day-19-route";
const courseId = "course-day-19-route";
const traceId = "trace-day-19-route";
const creationBrief = {
  originalRequest: "生成三页太阳系互动课程",
  topic: "太阳系",
  audience: "初学者",
  goal: "理解太阳系结构",
  sectionCount: 3,
  learningMode: "mixed" as const,
  language: "zh-CN" as const,
};

describe("course task Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribers.clear();
    mocks.listPublicEvents.mockImplementation(
      ({ traceId: requestedTraceId, afterSequence }) => ({
        traceId: requestedTraceId,
        scannedThroughSequence: afterSequence,
        events: [],
      }),
    );
  });

  it("POST validates JSON, returns 202, and schedules the workflow after the response", async () => {
    mocks.create.mockResolvedValue({
      taskId,
      courseId,
      traceId,
      status: "queued",
      source: "agent-v2",
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
          creationBrief,
          pageCount: 3,
          source: "workflow",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      taskId,
      courseId,
      traceId,
      status: "queued",
      source: "agent-v2",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      userPrompt: "生成三页太阳系互动课程",
      creationBrief,
      pageCount: 3,
      source: "agent-v2",
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

  it("GET, PATCH and DELETE reject an unsafe taskId before touching storage", async () => {
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
    const patchResponse = await PATCH(
      new Request("http://localhost/api/courses/tasks/invalid", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      }),
      routeContext(invalidTaskId),
    );

    expect(getResponse.status).toBe(400);
    expect(patchResponse.status).toBe(400);
    expect(deleteResponse.status).toBe(400);
    await expect(getResponse.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "taskId 格式无效。",
    });
    await expect(deleteResponse.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "taskId 格式无效。",
    });
    await expect(patchResponse.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "taskId 格式无效。",
    });
    expect(mocks.loadTask).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
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
    expect(first).toContain(
      `id: v1:${traceId}:1\nevent: snapshot\n`,
    );
    expect(first).toContain('"type":"snapshot"');
    expect(first).toContain('"taskStatus":"running"');

    publish({
      type: "event",
      taskId,
      courseId,
      source: "workflow",
      event: publicEvent(2, "agent_done"),
    });
    const second = await readSseChunk(reader!);
    expect(second).toContain(`id: v1:${traceId}:2\nevent: event\n`);
    expect(second).toContain('"type":"agent_done"');

    await reader?.cancel();
    expect(mocks.subscribers.has(taskId)).toBe(false);
  });

  it("GET 在统一发送边界清洗 EventBus，并让落后游标的 terminal 仍能关闭连接", async () => {
    const task = taskRecord();
    const state = runningState({ events: [publicEvent(1)] });
    const privateText =
      "Authorization: Bearer sk-live-SECRET；`/opt/private/provider.ts`；file://localhost/etc/passwd";
    mocks.loadTask.mockResolvedValue(task);
    mocks.loadCourse.mockResolvedValue(state);

    const response = await GET(
      new Request(`http://localhost/api/courses/tasks/${taskId}/events`),
      routeContext(taskId),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await readSseChunk(reader!);

    publish({
      type: "event",
      taskId,
      courseId,
      source: "workflow",
      event: {
        ...publicEvent(2, "agent_done"),
        summary: privateText,
      },
    });
    const eventFrame = await readSseChunk(reader!);
    expect(eventFrame).toContain("课程生成进度已更新。");
    expect(eventFrame).not.toMatch(
      /sk-live|\/opt\/|file:\/\/|Authorization/i,
    );

    publish({
      type: "terminal",
      taskId,
      courseId,
      source: "workflow",
      status: "failed",
      state: runningState({
        status: "failed",
        events: [publicEvent(1)],
        errors: [
          {
            stage: "intent",
            code: "MODEL_ERROR",
            message: privateText,
          },
        ],
        completedAt: "2026-07-15T06:01:00.000Z",
        durationMs: 60_000,
      }),
    });
    const terminalFrame = await readSseChunk(reader!);
    expect(terminalFrame).toContain(
      `id: v1:${traceId}:2\nevent: terminal\n`,
    );
    expect(terminalFrame).toContain(
      "课程生成失败，请根据错误码排查后重试。",
    );
    expect(terminalFrame).not.toMatch(
      /sk-live|\/opt\/|file:\/\/|Authorization/i,
    );
    await expect(reader!.read()).resolves.toMatchObject({ done: true });
  });

  it("GET follows durable checkpoints without an in-process EventBus publish", async () => {
    vi.useFakeTimers();
    let durableTask = taskRecord();
    let durableState = runningState({ events: [publicEvent(1)] });
    mocks.loadTask.mockImplementation(async () => durableTask);
    mocks.loadCourse.mockImplementation(async () => durableState);

    try {
      const response = await GET(
        new Request(`http://localhost/api/courses/tasks/${taskId}/events`, {
          headers: { "last-event-id": "1" },
        }),
        routeContext(taskId),
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const initial = await readSseChunk(reader!);
      expect(initial).toContain(
        `id: v1:${traceId}:1\nevent: snapshot\n`,
      );
      expect(initial).not.toContain("\nevent: event\n");

      durableState = runningState({
        currentStage: "planner",
        events: [publicEvent(1), publicEvent(2, "agent_done")],
        updatedAt: "2026-07-15T06:00:01.000Z",
      });
      await vi.advanceTimersByTimeAsync(500);

      const newEvent = await readSseChunk(reader!);
      const refreshedSnapshot = await readSseChunk(reader!);
      expect(newEvent).toContain(
        `id: v1:${traceId}:2\nevent: event\n`,
      );
      expect(newEvent).toContain('"sequence":2');
      expect(refreshedSnapshot).toContain(
        `id: v1:${traceId}:2\nevent: snapshot\n`,
      );

      durableState = runningState({
        status: "failed",
        currentStage: "planner",
        events: [
          publicEvent(1),
          publicEvent(2, "agent_done"),
          publicEvent(3, "page_done"),
        ],
        errors: [
          {
            stage: "planner",
            code: "COURSE_TASK_EXECUTION_ERROR",
            message: "生成失败。",
          },
        ],
        updatedAt: "2026-07-15T06:00:02.000Z",
      });
      durableTask = taskRecord({
        status: "failed",
        updatedAt: "2026-07-15T06:00:02.000Z",
      });
      await vi.advanceTimersByTimeAsync(500);

      const terminalEvent = await readSseChunk(reader!);
      const terminal = await readSseChunk(reader!);
      expect(terminalEvent).toContain(
        `id: v1:${traceId}:3\nevent: event\n`,
      );
      expect(terminal).toContain(
        `id: v1:${traceId}:3\nevent: terminal\n`,
      );
      expect(terminal).toContain('"status":"failed"');
      await expect(reader!.read()).resolves.toMatchObject({ done: true });
      expect(mocks.subscribers.has(taskId)).toBe(false);
    } finally {
      mocks.loadTask.mockReset();
      mocks.loadCourse.mockReset();
      vi.useRealTimers();
    }
  });

  it("GET 直接轮询 durable events，并与当前进程 EventBus 按 sequence 去重", async () => {
    vi.useFakeTimers();
    const task = agentV2TaskRecord();
    const state = runningState({ events: [publicEvent(1)] });
    let eventAvailable = false;
    mocks.loadTask.mockResolvedValue(task);
    mocks.loadCourse.mockResolvedValue(state);
    mocks.listPublicEvents.mockImplementation(
      ({ afterSequence }: { afterSequence: number }) => ({
        traceId,
        scannedThroughSequence: eventAvailable ? 7 : afterSequence,
        events:
          eventAvailable && afterSequence < 7
            ? [publicEvent(7, "agent_done")]
            : [],
      }),
    );

    try {
      const response = await GET(
        new Request(`http://localhost/api/courses/tasks/${taskId}/events`, {
          headers: { "last-event-id": `v1:${traceId}:1` },
        }),
        routeContext(taskId),
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      expect(await readSseChunk(reader!)).toContain("event: snapshot");

      eventAvailable = true;
      await vi.advanceTimersByTimeAsync(500);
      const durableFrame = await readSseChunk(reader!);
      expect(durableFrame).toContain(
        `id: v1:${traceId}:7\nevent: event\n`,
      );
      expect(mocks.listPublicEvents).toHaveBeenLastCalledWith({
        taskId,
        traceId,
        afterSequence: 1,
      });

      publish({
        type: "event",
        taskId,
        courseId,
        source: "agent-v2",
        event: publicEvent(7, "agent_done"),
      });
      publish({
        type: "event",
        taskId,
        courseId,
        source: "agent-v2",
        event: publicEvent(8, "page_done"),
      });
      const busFrame = await readSseChunk(reader!);
      expect(busFrame).toContain(
        `id: v1:${traceId}:8\nevent: event\n`,
      );
      await reader?.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("GET 在 durable event 已领先旧 terminal checkpoint 时仍发送终态并关闭", async () => {
    vi.useFakeTimers();
    let durableTask = agentV2TaskRecord();
    let durableState = runningState({ events: [publicEvent(1)] });
    let eventAvailable = false;
    mocks.loadTask.mockImplementation(async () => durableTask);
    mocks.loadCourse.mockImplementation(async () => durableState);
    mocks.listPublicEvents.mockImplementation(
      ({ afterSequence }: { afterSequence: number }) => ({
        traceId,
        scannedThroughSequence: eventAvailable ? 7 : afterSequence,
        events:
          eventAvailable && afterSequence < 7
            ? [publicEvent(7, "agent_done")]
            : [],
      }),
    );

    try {
      const response = await GET(
        new Request(`http://localhost/api/courses/tasks/${taskId}/events`),
        routeContext(taskId),
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await readSseChunk(reader!);

      eventAvailable = true;
      await vi.advanceTimersByTimeAsync(500);
      expect(await readSseChunk(reader!)).toContain(
        `id: v1:${traceId}:7\nevent: event\n`,
      );

      durableTask = agentV2TaskRecord({
        status: "failed",
        completedAt: "2026-07-15T06:01:00.000Z",
        error: {
          code: "COURSE_TASK_EXECUTION_ERROR",
          message: "生成失败。",
        },
      });
      durableState = runningState({
        status: "failed",
        events: [publicEvent(1)],
        errors: [
          {
            stage: "intent",
            code: "COURSE_TASK_EXECUTION_ERROR",
            message: "生成失败。",
          },
        ],
        completedAt: "2026-07-15T06:01:00.000Z",
        durationMs: 60_000,
      });
      await vi.advanceTimersByTimeAsync(500);

      const terminalFrame = await readSseChunk(reader!);
      expect(terminalFrame).toContain(
        `id: v1:${traceId}:7\nevent: terminal\n`,
      );
      expect(terminalFrame).toContain('"status":"failed"');
      await expect(reader!.read()).resolves.toMatchObject({ done: true });
    } finally {
      mocks.loadTask.mockReset();
      mocks.loadCourse.mockReset();
      vi.useRealTimers();
    }
  });

  it("GET 在 resume 切换 trace 时先发新 snapshot，再发该 trace 的 durable events", async () => {
    vi.useFakeTimers();
    const resumedTraceId = "trace-day-19-resumed";
    let durableTask = agentV2TaskRecord();
    let durableState = runningState({ events: [publicEvent(1)] });
    mocks.loadTask.mockImplementation(async () => durableTask);
    mocks.loadCourse.mockImplementation(async () => durableState);
    mocks.listPublicEvents.mockImplementation(
      ({
        traceId: requestedTraceId,
        afterSequence,
      }: {
        traceId: string;
        afterSequence: number;
      }) => ({
        traceId: requestedTraceId,
        scannedThroughSequence:
          requestedTraceId === resumedTraceId ? 7 : afterSequence,
        events:
          requestedTraceId === resumedTraceId && afterSequence < 7
            ? [publicEvent(7, "agent_start", resumedTraceId)]
            : [],
      }),
    );

    try {
      const response = await GET(
        new Request(`http://localhost/api/courses/tasks/${taskId}/events`),
        routeContext(taskId),
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await readSseChunk(reader!);

      durableTask = agentV2TaskRecord({
        traceId: resumedTraceId,
        status: "running",
        updatedAt: "2026-07-15T06:00:01.000Z",
      });
      await vi.advanceTimersByTimeAsync(500);
      publish({
        type: "event",
        taskId,
        courseId,
        source: "agent-v2",
        event: publicEvent(6, "agent_start", resumedTraceId),
      });
      durableState = runningState({
        traceId: resumedTraceId,
        currentStage: "planner",
        events: [],
        updatedAt: "2026-07-15T06:00:01.000Z",
      });
      await vi.advanceTimersByTimeAsync(500);

      const resumedSnapshot = await readSseChunk(reader!);
      const resumedEvent = await readSseChunk(reader!);
      expect(resumedSnapshot).toContain("event: snapshot\n");
      expect(resumedSnapshot).toContain(`"traceId":"${resumedTraceId}"`);
      expect(resumedEvent).toContain(
        `id: v1:${resumedTraceId}:7\nevent: event\n`,
      );
      await reader?.cancel();
    } finally {
      mocks.loadTask.mockReset();
      mocks.loadCourse.mockReset();
      vi.useRealTimers();
    }
  });

  it("GET exposes paused as task status while preserving a running checkpoint", async () => {
    const task = taskRecord({ status: "paused" });
    const state = runningState({ events: [publicEvent(1)] });
    mocks.loadTask
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task);
    mocks.loadCourse.mockResolvedValue(state);

    const response = await GET(
      new Request(`http://localhost/api/courses/tasks/${taskId}/events`),
      routeContext(taskId),
    );
    const reader = response.body?.getReader();
    const first = await readSseChunk(reader!);

    expect(first).toContain('"taskStatus":"paused"');
    expect(first).toContain('"status":"running"');
    await reader?.cancel();
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
    expect(payload).toContain(`id: v1:${traceId}:2\nevent: event\n`);
    expect(payload).toContain(`id: v1:${traceId}:3\nevent: event\n`);
    expect(payload).toContain(`id: v1:${traceId}:3\nevent: terminal\n`);
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
      message: "Last-Event-ID 必须是非负整数或有效的 trace 游标。",
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

  it("PATCH pauses without scheduling work and resumes with a new trace", async () => {
    mocks.pause.mockResolvedValueOnce(taskRecord({ status: "paused" }));

    const paused = await PATCH(
      new Request(`http://localhost/api/courses/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      }),
      routeContext(taskId),
    );

    expect(paused.status).toBe(200);
    await expect(paused.json()).resolves.toEqual({
      taskId,
      courseId,
      traceId,
      status: "paused",
      source: "workflow",
    });
    expect(mocks.pause).toHaveBeenCalledWith(taskId);
    expect(mocks.after).not.toHaveBeenCalled();

    const resumedTraceId = "trace-day-19-route-resumed";
    mocks.resume.mockResolvedValueOnce(
      taskRecord({
        traceId: resumedTraceId,
        status: "queued",
      }),
    );
    const resumed = await PATCH(
      new Request(`http://localhost/api/courses/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      }),
      routeContext(taskId),
    );

    expect(resumed.status).toBe(202);
    await expect(resumed.json()).resolves.toEqual({
      taskId,
      courseId,
      traceId: resumedTraceId,
      status: "queued",
      source: "workflow",
    });
    expect(mocks.resume).toHaveBeenCalledWith(taskId);
    expect(mocks.run).not.toHaveBeenCalled();

    const scheduled = mocks.after.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    await scheduled?.();
    expect(mocks.run).toHaveBeenCalledWith(taskId);
  });

  it("PATCH rejects an unsupported control action", async () => {
    const response = await PATCH(
      new Request(`http://localhost/api/courses/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }),
      routeContext(taskId),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
      message: "action 必须是 pause 或 resume。",
    });
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});

function routeContext(id: string) {
  return { params: Promise.resolve({ taskId: id }) };
}

function taskRecord(
  overrides: Partial<LegacyCourseTaskRecord> = {},
): LegacyCourseTaskRecord {
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

type LegacyCourseTaskRecord = Extract<
  CourseTaskRecord,
  { source: "workflow" | "langgraph" }
>;

function agentV2TaskRecord(
  overrides: Partial<AgentV2CourseTaskRecord> = {},
): AgentV2CourseTaskRecord {
  return {
    version: 1,
    taskId,
    courseId,
    traceId,
    userPrompt: "生成三页太阳系互动课程",
    creationBrief,
    pageCount: 3,
    status: "running",
    source: "agent-v2",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

type AgentV2CourseTaskRecord = Extract<
  CourseTaskRecord,
  { source: "agent-v2" }
>;

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
  eventTraceId = traceId,
): CourseGenerationPublicEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    type,
    traceId: eventTraceId,
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
