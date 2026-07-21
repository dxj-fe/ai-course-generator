import { describe, expect, it, vi } from "vitest";

import type { CourseStore } from "../../../../src/server/storage/course-store";
import type { CourseTaskStore } from "../../../../src/server/storage/course-task-store";
import { createCourseTaskEventBus } from "../../../../src/server/tasks/course-task-event-bus";
import { createCourseGenerationTaskService } from "../../../../src/server/tasks/course-generation-task-service";
import type { streamCourseGenerationGraphWorkflow } from "../../../../src/server/langgraph/course-generation/run-course-graph";
import type { runCourseGenerationWorkflow } from "../../../../src/server/workflows/course-generation-workflow";
import type {
  CourseGenerationState,
  CourseTaskRecord,
  CourseTaskStreamMessage,
} from "../../../../src/shared/course-schema";

const timestamp = "2026-07-15T06:00:00.000Z";
const taskId = "task-day-19-service";
const courseId = "course-day-19-service";
const traceId = "trace-day-19-service";

describe("course generation task service", () => {
  it("persists the Page Worker execution mode and concurrency", async () => {
    const fixture = createFixture();

    await fixture.service.create({
      userPrompt: "并行生成三页太阳系互动课程",
      pageCount: 3,
      executionMode: "parallel",
      concurrency: 2,
    });

    expect(fixture.tasks.get(taskId)).toMatchObject({
      executionMode: "parallel",
      concurrency: 2,
    });
  });

  it("persists the LangGraph source and publishes only mapped product messages", async () => {
    const running = courseState("running", 1);
    const failed = courseState("failed", 2);
    const runGraph = vi.fn(async (_input, _context, overrides, observe) => {
      await overrides.checkpoint?.(running);
      await observe?.({ state: running, events: running.events, cursor: 1 });
      await overrides.checkpoint?.(failed);
      await observe?.({
        state: failed,
        events: [failed.events[1]!],
        cursor: 2,
      });
      return failed;
    }) as typeof streamCourseGenerationGraphWorkflow;
    const fixture = createFixture({ runGraph });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));

    const created = await fixture.service.create({
      userPrompt: "生成五页太阳系互动课程",
      pageCount: 5,
      source: "langgraph",
    });
    await fixture.service.run(taskId);

    expect(created.source).toBe("langgraph");
    expect(fixture.tasks.get(taskId)?.source).toBe("langgraph");
    expect(fixture.runWorkflow).not.toHaveBeenCalled();
    expect(runGraph).toHaveBeenCalledOnce();
    expect(messages.map(({ type }) => type)).toEqual([
      "snapshot",
      "event",
      "terminal",
    ]);
    expect(messages.every(({ source }) => source === "langgraph")).toBe(true);
    expect(JSON.stringify(messages)).not.toContain("private");
  });

  it("persists and publishes a queued cancellation before the runner starts", async () => {
    const fixture = createFixture();
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    const cancelled = await fixture.service.cancel(taskId);

    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(fixture.tasks.get(taskId)).toMatchObject({ status: "cancelled" });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "cancelled",
      errors: [expect.objectContaining({ code: "COURSE_TASK_CANCELLED" })],
    });
    expect(messages).toEqual([
      expect.objectContaining({
        type: "terminal",
        status: "cancelled",
      }),
    ]);

    await expect(fixture.service.run(taskId)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(fixture.runWorkflow).not.toHaveBeenCalled();
  });

  it("persists and publishes a terminal failure when the workflow throws", async () => {
    const fixture = createFixture({
      runWorkflow: vi.fn(async () => {
        throw new Error("workflow crashed before its first checkpoint");
      }) as typeof runCourseGenerationWorkflow,
    });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    await expect(fixture.service.run(taskId)).rejects.toThrow(
      "workflow crashed before its first checkpoint",
    );

    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "failed",
      error: { code: "COURSE_TASK_EXECUTION_ERROR" },
    });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "failed",
      errors: [
        expect.objectContaining({ code: "COURSE_TASK_EXECUTION_ERROR" }),
      ],
    });
    expect(messages.at(-1)).toMatchObject({
      type: "terminal",
      status: "failed",
    });
  });

  it("keeps an active task cancelled when its workflow rejects on abort", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fixture = createFixture({
      runWorkflow: vi.fn(
        async (_input, context) =>
          new Promise<CourseGenerationState>((_resolve, reject) => {
            context.abortSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
            markStarted();
          }),
      ) as typeof runCourseGenerationWorkflow,
    });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    const running = fixture.service.run(taskId);
    await started;
    const cancelled = await fixture.service.cancel(taskId);

    expect(cancelled).toMatchObject({ status: "cancelled" });
    await expect(running).resolves.toMatchObject({ status: "cancelled" });
    expect(fixture.tasks.get(taskId)).toMatchObject({ status: "cancelled" });
    expect(
      messages
        .filter((message) => message.type === "terminal")
        .every((message) => message.status === "cancelled"),
    ).toBe(true);
    expect(messages.filter((message) => message.type === "terminal")).toHaveLength(1);
  });

  it("marks the active page failed when cancellation happens in a page stage", async () => {
    const fixture = createFixture();
    fixture.courses.set(courseId, {
      version: 1,
      courseId,
      traceId: "trace-previous-run",
      userPrompt: "生成三页太阳系互动课程",
      status: "running",
      currentStage: "html",
      currentPageId: "page-01",
      pages: [
        {
          pageId: "page-01",
          order: 1,
          status: "running",
          currentStage: "html",
          assets: [],
        },
      ],
      events: [],
      errors: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    });
    await fixture.service.create({ courseId });

    await fixture.service.cancel(taskId);

    expect(fixture.courses.get(courseId)?.pages[0]).toMatchObject({
      status: "failed",
      currentStage: "html",
      error: {
        code: "COURSE_TASK_CANCELLED",
        message: "课程生成已取消。",
      },
    });
  });
});

function createFixture(
  overrides: {
    runWorkflow?: typeof runCourseGenerationWorkflow;
    runGraph?: typeof streamCourseGenerationGraphWorkflow;
  } = {},
) {
  const tasks = new Map<string, CourseTaskRecord>();
  const courses = new Map<string, CourseGenerationState>();
  const taskStore: CourseTaskStore = {
    async load(id) {
      return tasks.get(id);
    },
    async save(record) {
      tasks.set(record.taskId, structuredClone(record));
    },
  };
  const courseStore: CourseStore = {
    async load(id) {
      return courses.get(id);
    },
    async save(state) {
      courses.set(state.courseId, structuredClone(state));
    },
  };
  const eventBus = createCourseTaskEventBus();
  const runWorkflow =
    overrides.runWorkflow ??
    (vi.fn(async () => {
      throw new Error("runWorkflow should not have been called");
    }) as typeof runCourseGenerationWorkflow);
  const service = createCourseGenerationTaskService({
    taskStore,
    courseStore,
    eventBus,
    runWorkflow,
    ...(overrides.runGraph ? { runGraph: overrides.runGraph } : {}),
    now: () => timestamp,
    createTaskId: () => taskId,
    createCourseId: () => courseId,
    createTraceId: () => traceId,
  });

  return { service, taskStore, courseStore, eventBus, runWorkflow, tasks, courses };
}

function courseState(
  status: "running" | "failed",
  eventCount: number,
): CourseGenerationState {
  return {
    version: 1,
    courseId,
    traceId,
    userPrompt: "生成五页太阳系互动课程",
    status,
    currentStage: "planner",
    pages: [],
    events: Array.from({ length: eventCount }, (_, index) => ({
      id: `event-day-30-${index + 1}`,
      sequence: index + 1,
      type: index === 0 ? ("agent_start" as const) : ("error" as const),
      traceId,
      timestamp,
      step: index + 1,
      summary: index === 0 ? "Planner 开始。" : "Planner 失败。",
      stage: "planner" as const,
      agent: "planner",
    })),
    errors:
      status === "failed"
        ? [
            {
              stage: "planner",
              code: "PLANNER_FAILED",
              message: "Planner 失败。",
            },
          ]
        : [],
    startedAt: timestamp,
    updatedAt: timestamp,
    ...(status === "failed"
      ? { completedAt: timestamp, durationMs: 0 }
      : {}),
  };
}
