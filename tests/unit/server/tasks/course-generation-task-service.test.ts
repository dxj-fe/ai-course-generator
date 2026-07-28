import { describe, expect, it, vi } from "vitest";

import type { CourseStore } from "../../../../src/server/storage/course-store";
import type { CourseTaskStore } from "../../../../src/server/storage/course-task-store";
import {
  createCourseTaskEventBus,
  type CourseTaskEventBus,
} from "../../../../src/server/tasks/course-task-event-bus";
import {
  createCourseGenerationTaskService,
  type CourseGenerationLogEntry,
  type CourseGenerationLogSink,
} from "../../../../src/server/tasks/course-generation-task-service";
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
  it("persists Reference Packs and forwards them to the selected runtime", async () => {
    const terminal = courseState("failed", 2);
    const runGraph = vi.fn(async () => terminal) as typeof streamCourseGenerationGraphWorkflow;
    const fixture = createFixture({ runGraph });
    const referencePacks = [
      {
        version: 1 as const,
        id: "ref-1234567890abcdef12345678",
        sourceName: "solar.txt",
        sourceType: "txt" as const,
        byteSize: 80,
        summary: "太阳风资料。",
        keyFacts: [],
        chunks: [
          { id: "chunk-01", index: 1, text: "太阳风包含带电粒子。" },
        ],
        truncated: false,
      },
    ];

    await fixture.service.create({
      userPrompt: "生成三页太阳风课程",
      source: "langgraph",
      referencePacks,
    });
    await fixture.service.run(taskId);

    expect(fixture.tasks.get(taskId)?.referencePacks).toEqual(referencePacks);
    expect(runGraph).toHaveBeenCalledWith(
      expect.objectContaining({ referencePacks }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

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
      source: "langgraph",
    });
  });

  it.each([1, 20, 120])(
    "persists the positive course length %i without a fixed maximum",
    async (pageCount) => {
      const fixture = createFixture();

      await fixture.service.create({
        userPrompt: "系统讲清楚操作系统原理并穿插练习",
        pageCount,
      });

      expect(fixture.tasks.get(taskId)?.pageCount).toBe(pageCount);
    },
  );

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
      "snapshot",
      "terminal",
    ]);
    expect(messages[2]).toMatchObject({
      type: "snapshot",
      state: { status: "failed" },
    });
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
      source: "workflow",
    });

    await expect(fixture.service.run(taskId)).rejects.toThrow(
      "workflow crashed before its first checkpoint",
    );

    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "failed",
      error: {
        code: "COURSE_TASK_EXECUTION_ERROR",
        causeCode: "MODEL_ERROR",
        message: "模型服务未返回有效结果，请稍后重试。",
      },
    });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "failed",
      errors: [
        expect.objectContaining({
          code: "COURSE_TASK_EXECUTION_ERROR",
          causeCode: "MODEL_ERROR",
        }),
      ],
    });
    expect(JSON.stringify(fixture.courses.get(courseId))).not.toContain(
      "workflow crashed",
    );
    expect(messages.at(-1)).toMatchObject({
      type: "terminal",
      status: "failed",
    });
  });

  it("logs safe page and task metadata when a workflow resolves as failed", async () => {
    const failed = courseState("failed", 2);
    failed.currentStage = "qa";
    failed.currentPageId = "page-03";
    failed.pages = [
      {
        pageId: "page-03",
        order: 1,
        status: "failed",
        currentStage: "qa",
        assets: [],
        attempts: [{ stage: "qa", attempts: 2 }],
        qualityReport: {
          issues: [{ code: "HTML_RUNTIME_ERROR" }],
        } as CourseGenerationState["pages"][number]["qualityReport"],
        error: {
          code: "PAGE_QA_FAILED",
          causeCode: "SCHEMA_ERROR",
          message: "公开错误摘要。",
        },
      },
    ];
    failed.errors = [
      {
        stage: "qa",
        pageId: "page-03",
        code: "PAGE_QA_FAILED",
        causeCode: "SCHEMA_ERROR",
        message: "公开错误摘要。",
      },
    ];
    const fixture = createFixture({
      runWorkflow: vi.fn(async () => failed) as typeof runCourseGenerationWorkflow,
      eventBus: createSilentEventBus(),
    });
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "workflow",
    });

    await fixture.service.run(taskId);

    expect(fixture.infoLogs).toContainEqual(
      expect.objectContaining({
        event: "task:start",
        traceId,
        taskId,
        courseId,
        source: "workflow",
        status: "running",
      }),
    );
    expect(fixture.errorLogs).toContainEqual(
      expect.objectContaining({
        event: "page:failed",
        traceId,
        taskId,
        courseId,
        pageId: "page-03",
        stage: "qa",
        attempt: 2,
        errorCode: "PAGE_QA_FAILED",
        errorMessage: "公开错误摘要。",
        causeCode: "SCHEMA_ERROR",
        issueCodes: ["HTML_RUNTIME_ERROR"],
        completedPages: 0,
        totalPages: 3,
      }),
    );
    expect(fixture.errorLogs).toContainEqual(
      expect.objectContaining({
        event: "task:failed",
        pageId: "page-03",
        stage: "qa",
        errorCode: "PAGE_QA_FAILED",
        errorMessage: "公开错误摘要。",
        causeCode: "SCHEMA_ERROR",
        status: "failed",
      }),
    );
  });

  it("logs catch failures without leaking the raw provider error", async () => {
    const fixture = createFixture({
      runWorkflow: vi.fn(async () => {
        throw new Error("PRIVATE_PROVIDER_SECRET");
      }) as typeof runCourseGenerationWorkflow,
    });
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "workflow",
    });

    await expect(fixture.service.run(taskId)).rejects.toThrow(
      "PRIVATE_PROVIDER_SECRET",
    );

    expect(fixture.errorLogs).toContainEqual(
      expect.objectContaining({
        event: "task:error",
        errorCode: "MODEL_ERROR",
        errorMessage: "模型服务未返回有效结果，请稍后重试。",
        causeCode: "MODEL_ERROR",
        status: "failed",
      }),
    );
    expect(fixture.errorLogs).toContainEqual(
      expect.objectContaining({
        event: "task:failed",
        errorCode: "COURSE_TASK_EXECUTION_ERROR",
        errorMessage: "模型服务未返回有效结果，请稍后重试。",
        causeCode: "MODEL_ERROR",
        status: "failed",
      }),
    );
    expect(JSON.stringify(fixture.errorLogs)).not.toContain(
      "PRIVATE_PROVIDER_SECRET",
    );
  });

  it("logs task completion metadata", async () => {
    const completed = {
      ...courseState("running", 1),
      status: "completed",
      currentStage: "complete",
      completedAt: timestamp,
      durationMs: 0,
    } as CourseGenerationState;
    const fixture = createFixture({
      runWorkflow: vi.fn(async () => completed) as typeof runCourseGenerationWorkflow,
      eventBus: createSilentEventBus(),
    });
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "workflow",
    });

    await fixture.service.run(taskId);

    expect(fixture.infoLogs).toContainEqual(
      expect.objectContaining({
        event: "task:completed",
        status: "completed",
        durationMs: 0,
        completedPages: 0,
        totalPages: 3,
      }),
    );
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
      source: "workflow",
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

  it("pauses an active task without turning its checkpoint into cancellation", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const checkpoint = courseState("running", 1);
    const runWorkflow = vi.fn(
      async (_input, context, overrides) => {
        await overrides.checkpoint?.(checkpoint);
        markStarted();
        return new Promise<CourseGenerationState>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("paused", "AbortError")),
            { once: true },
          );
        });
      },
    ) as typeof runCourseGenerationWorkflow;
    const fixture = createFixture({ runWorkflow });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "workflow",
    });

    const running = fixture.service.run(taskId);
    await started;
    const paused = await fixture.service.pause(taskId);

    expect(paused).toMatchObject({
      taskId,
      courseId,
      status: "paused",
      completedAt: undefined,
      error: undefined,
    });
    await expect(running).resolves.toMatchObject({ status: "running" });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "running",
      errors: [],
    });
    expect(fixture.courses.get(courseId)).not.toHaveProperty("completedAt");
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "snapshot",
        taskId,
        taskStatus: "paused",
      }),
    );
    expect(messages.some(({ type }) => type === "terminal")).toBe(false);
    expect(fixture.errorLogs).toEqual([]);
  });

  it("resumes the same task and course from its checkpoint with a new trace", async () => {
    const createResumedTraceId = vi
      .fn()
      .mockReturnValueOnce(traceId)
      .mockReturnValueOnce("trace-day-19-resumed");
    const fixture = createFixture({
      createTraceId: createResumedTraceId,
    });
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "workflow",
    });
    const checkpointBeforeResume = courseState("running", 1);
    fixture.courses.set(courseId, checkpointBeforeResume);

    await fixture.service.pause(taskId);
    const resumed = await fixture.service.resume(taskId);

    expect(resumed).toMatchObject({
      taskId,
      courseId,
      traceId: "trace-day-19-resumed",
      status: "queued",
      completedAt: undefined,
      error: undefined,
    });
    expect(fixture.courses.get(courseId)).toEqual(checkpointBeforeResume);
  });

  it("runs a resumed task from the preserved checkpoint instead of starting over", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const checkpoint = courseState("running", 1);
    const runWorkflowMock = vi.fn(
      async (input, context, overrides) => {
        if (runWorkflowMock.mock.calls.length === 1) {
          await overrides.checkpoint?.(checkpoint);
          markStarted();
          return new Promise<CourseGenerationState>((_resolve, reject) => {
            context.abortSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("paused", "AbortError")),
              { once: true },
            );
          });
        }

        const failed = courseState("failed", 2);
        return {
          ...failed,
          traceId: context.traceId,
          events: failed.events.map((event) => ({
            ...event,
            traceId: context.traceId,
          })),
        };
      },
    );
    const runWorkflow =
      runWorkflowMock as unknown as typeof runCourseGenerationWorkflow;
    const createResumedTraceId = vi
      .fn()
      .mockReturnValueOnce(traceId)
      .mockReturnValueOnce("trace-day-19-resumed-run");
    const fixture = createFixture({
      runWorkflow,
      createTraceId: createResumedTraceId,
    });
    await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
      source: "workflow",
    });
    const firstRun = fixture.service.run(taskId);
    await started;
    await fixture.service.pause(taskId);
    await firstRun;
    await fixture.service.resume(taskId);

    await fixture.service.run(taskId);

    expect(runWorkflowMock).toHaveBeenCalledTimes(2);
    expect(runWorkflowMock.mock.calls[1]?.[0]).toMatchObject({
      courseId,
      existingState: checkpoint,
    });
    expect(runWorkflowMock.mock.calls[1]?.[1]).toMatchObject({
      traceId: "trace-day-19-resumed-run",
    });
    expect(fixture.tasks.get(taskId)).toMatchObject({
      taskId,
      courseId,
      traceId: "trace-day-19-resumed-run",
      status: "failed",
    });
  });

  it("isolates pause by taskId when two courses are running", async () => {
    const taskIds = ["task-course-one", "task-course-two"];
    const courseIds = ["course-course-one", "course-course-two"];
    const traceIds = ["trace-course-one", "trace-course-two"];
    const started = new Map<string, () => void>();
    const startPromises = new Map(
      courseIds.map((id) => [
        id,
        new Promise<void>((resolve) => {
          started.set(id, resolve);
        }),
      ]),
    );
    const signals = new Map<string, AbortSignal | undefined>();
    const runWorkflow = vi.fn(
      async (input, context, overrides) => {
        signals.set(input.courseId, context.abortSignal);
        const checkpoint = runningCheckpoint(
          input.courseId,
          context.traceId,
          input.userPrompt,
        );
        await overrides.checkpoint?.(checkpoint);
        started.get(input.courseId)?.();
        return new Promise<CourseGenerationState>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("stopped", "AbortError")),
            { once: true },
          );
        });
      },
    ) as typeof runCourseGenerationWorkflow;
    const fixture = createFixture({
      runWorkflow,
      createTaskId: () => taskIds.shift()!,
      createCourseId: () => courseIds.shift()!,
      createTraceId: () => traceIds.shift()!,
    });
    const first = await fixture.service.create({
      userPrompt: "生成课程一",
      source: "workflow",
    });
    const second = await fixture.service.create({
      userPrompt: "生成课程二",
      source: "workflow",
    });
    const firstRun = fixture.service.run(first.taskId);
    const secondRun = fixture.service.run(second.taskId);
    await Promise.all([
      startPromises.get(first.courseId),
      startPromises.get(second.courseId),
    ]);

    await fixture.service.pause(second.taskId);

    expect(fixture.tasks.get(second.taskId)?.status).toBe("paused");
    expect(signals.get(second.courseId)?.aborted).toBe(true);
    expect(fixture.courses.get(second.courseId)).toMatchObject({
      courseId: second.courseId,
      status: "running",
      errors: [],
    });
    expect(fixture.tasks.get(first.taskId)?.status).toBe("running");
    expect(signals.get(first.courseId)?.aborted).toBe(false);
    expect(fixture.courses.get(first.courseId)).toMatchObject({
      courseId: first.courseId,
      status: "running",
      errors: [],
    });

    await fixture.service.cancel(first.taskId);
    await expect(firstRun).resolves.toMatchObject({ status: "cancelled" });
    await expect(secondRun).resolves.toMatchObject({ status: "running" });
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
    logSink?: CourseGenerationLogSink;
    eventBus?: CourseTaskEventBus;
    createTaskId?: () => string;
    createCourseId?: () => string;
    createTraceId?: () => string;
  } = {},
) {
  const tasks = new Map<string, CourseTaskRecord>();
  const courses = new Map<string, CourseGenerationState>();
  const taskStore: CourseTaskStore = {
    list: async () => ({ items: [...tasks.values()], unavailableCount: 0 }),
    async load(id) {
      return tasks.get(id);
    },
    async save(record) {
      tasks.set(record.taskId, structuredClone(record));
    },
  };
  const courseStore: CourseStore = {
    list: async () => ({ items: [...courses.values()], unavailableCount: 0 }),
    async load(id) {
      return courses.get(id);
    },
    async save(state) {
      courses.set(state.courseId, structuredClone(state));
    },
  };
  const eventBus = overrides.eventBus ?? createCourseTaskEventBus();
  const runWorkflow =
    overrides.runWorkflow ??
    (vi.fn(async () => {
      throw new Error("runWorkflow should not have been called");
    }) as typeof runCourseGenerationWorkflow);
  const infoLogs: CourseGenerationLogEntry[] = [];
  const errorLogs: CourseGenerationLogEntry[] = [];
  const logSink: CourseGenerationLogSink = overrides.logSink ?? {
    info: (entry) => infoLogs.push(entry),
    error: (entry) => errorLogs.push(entry),
  };
  const service = createCourseGenerationTaskService({
    taskStore,
    courseStore,
    eventBus,
    runWorkflow,
    ...(overrides.runGraph ? { runGraph: overrides.runGraph } : {}),
    now: () => timestamp,
    createTaskId: overrides.createTaskId ?? (() => taskId),
    createCourseId: overrides.createCourseId ?? (() => courseId),
    createTraceId: overrides.createTraceId ?? (() => traceId),
    logSink,
  });

  return {
    service,
    taskStore,
    courseStore,
    eventBus,
    runWorkflow,
    tasks,
    courses,
    infoLogs,
    errorLogs,
  };
}

function createSilentEventBus(): CourseTaskEventBus {
  return {
    publish: () => undefined,
    subscribe: () => () => undefined,
  };
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

function runningCheckpoint(
  checkpointCourseId: string,
  checkpointTraceId: string,
  userPrompt: string,
): CourseGenerationState {
  return {
    version: 1,
    courseId: checkpointCourseId,
    traceId: checkpointTraceId,
    userPrompt,
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}
