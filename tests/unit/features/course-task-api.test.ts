import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelCourseTask,
  createCourseTask,
  pauseCourseTask,
  resumeCourseTask,
} from "../../../src/features/course-planner/lib/course-task-api";

describe("course task API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a task and validates the strict shared response", async () => {
    const payload = {
      taskId: "task-123e4567-e89b-42d3-a456-426614174000",
      courseId: "course-123e4567-e89b-42d3-a456-426614174000",
      traceId: "trace-task-create",
      status: "queued",
      source: "langgraph",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createCourseTask(
        {
          userPrompt: "生成三页太阳系课程",
          pageCount: 3,
        },
        { signal: controller.signal, traceId: payload.traceId },
      ),
    ).resolves.toEqual(payload);

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("/api/courses/tasks");
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-trace-id": payload.traceId,
    });
    expect(JSON.parse(String(init.body))).toEqual({
      userPrompt: "生成三页太阳系课程",
      pageCount: 3,
      traceId: payload.traceId,
    });
  });

  it("rejects unknown fields before a create response reaches the controller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            taskId: "task-123e4567-e89b-42d3-a456-426614174000",
            courseId: "course-123e4567-e89b-42d3-a456-426614174000",
            traceId: "trace-task-create",
            status: "queued",
            internalPrompt: "should-not-cross-the-boundary",
          }),
          { status: 202 },
        ),
      ),
    );

    await expect(
      createCourseTask(
        { userPrompt: "生成课程" },
        { traceId: "trace-task-create" },
      ),
    ).rejects.toThrow("课程任务接口返回了无效状态");
  });

  it("cancels through the task route without coupling cancellation to SSE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetchMock);

    await cancelCourseTask("task-123e4567-e89b-42d3-a456-426614174000", {
      signal: controller.signal,
      traceId: "trace-task-cancel",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/courses/tasks/task-123e4567-e89b-42d3-a456-426614174000",
      {
        method: "DELETE",
        headers: { "x-trace-id": "trace-task-cancel" },
        signal: controller.signal,
      },
    );
  });

  it("turns a failed cancellation payload into a readable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "TASK_NOT_FOUND",
            message: "任务不存在",
            traceId: "trace-missing",
          }),
          { status: 404 },
        ),
      ),
    );

    await expect(
      cancelCourseTask("task-missing", { traceId: "trace-missing" }),
    ).rejects.toThrow("[TASK_NOT_FOUND] 任务不存在 traceId: trace-missing");
  });

  it.each([
    ["pause", pauseCourseTask, "paused", 200],
    ["resume", resumeCourseTask, "queued", 202],
  ] as const)(
    "controls only the addressed task with action %s",
    async (action, controlTask, status, responseStatus) => {
      const payload = {
        taskId: "task-123e4567-e89b-42d3-a456-426614174000",
        courseId: "course-123e4567-e89b-42d3-a456-426614174000",
        traceId: `trace-task-${action}`,
        status,
        source: "langgraph",
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: responseStatus,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const controller = new AbortController();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        controlTask(payload.taskId, {
          signal: controller.signal,
          traceId: payload.traceId,
        }),
      ).resolves.toEqual(payload);

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/courses/tasks/${payload.taskId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-trace-id": payload.traceId,
          },
          body: JSON.stringify({ action }),
          signal: controller.signal,
        },
      );
    },
  );
});
