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

  it("rejects creating a second non-terminal task for the same course", async () => {
    const taskIds = ["task-same-course-one", "task-same-course-two"];
    const fixture = createFixture({
      createTaskId: () => taskIds.shift()!,
    });
    const first = await fixture.service.create({
      userPrompt: "生成同一门太阳系课程",
      source: "workflow",
    });

    await expect(
      fixture.service.create({
        courseId: first.courseId,
        userPrompt: "生成同一门太阳系课程",
        source: "workflow",
      }),
    ).rejects.toThrow("请先暂停或等待该任务完成");

    expect(fixture.tasks.size).toBe(1);
    expect(fixture.tasks.get(first.taskId)?.status).toBe("queued");
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

  it("releases the course claim when cancel wins the runner initial-load race", async () => {
    const taskIds = [
      "task-cancel-load-race-one",
      "task-cancel-load-race-two",
    ];
    const fixture = createFixture({
      createTaskId: () => taskIds.shift()!,
    });
    const first = await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });
    const originalLoad = fixture.taskStore.load.bind(fixture.taskStore);
    let markLoadStarted: () => void = () => undefined;
    let releaseInitialLoad: () => void = () => undefined;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const continueInitialLoad = new Promise<void>((resolve) => {
      releaseInitialLoad = resolve;
    });
    let interceptNextLoad = true;
    fixture.taskStore.load = async (id) => {
      if (interceptNextLoad) {
        interceptNextLoad = false;
        markLoadStarted();
        await continueInitialLoad;
      }
      return originalLoad(id);
    };

    const running = fixture.service.run(first.taskId);
    await loadStarted;
    await fixture.service.cancel(first.taskId);
    releaseInitialLoad();

    await expect(running).resolves.toMatchObject({ status: "cancelled" });
    const recovery = await fixture.service.create({ courseId: first.courseId });
    expect(recovery).toMatchObject({
      taskId: "task-cancel-load-race-two",
      courseId: first.courseId,
      status: "queued",
    });
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

  it("keeps the course claimed when a second pause observes an unwinding runner", async () => {
    const taskIds = [
      "task-double-pause-one",
      "task-double-pause-blocked",
      "task-double-pause-recovery",
    ];
    let markStarted: () => void = () => undefined;
    let markAborted: () => void = () => undefined;
    let finishAbort: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const abortCanFinish = new Promise<void>((resolve) => {
      finishAbort = resolve;
    });
    const checkpoint = courseState("running", 1);
    const runWorkflow = vi.fn(
      async (_input, context, overrides) => {
        await overrides.checkpoint?.(checkpoint);
        markStarted();
        return new Promise<CourseGenerationState>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => {
              markAborted();
              void abortCanFinish.then(() =>
                reject(new DOMException("paused", "AbortError")),
              );
            },
            { once: true },
          );
        });
      },
    ) as typeof runCourseGenerationWorkflow;
    const fixture = createFixture({
      runWorkflow,
      createTaskId: () => taskIds.shift()!,
    });
    const created = await fixture.service.create({
      userPrompt: "生成三页太阳系互动课程",
      source: "workflow",
    });
    const running = fixture.service.run(created.taskId);
    await started;

    const firstPause = fixture.service.pause(created.taskId);
    await aborted;
    const secondPause = await fixture.service.pause(created.taskId);
    expect(secondPause?.status).toBe("paused");
    fixture.tasks.set(created.taskId, {
      ...secondPause!,
      status: "cancelled",
      completedAt: timestamp,
    });

    await expect(
      fixture.service.create({ courseId: created.courseId }),
    ).rejects.toThrow("请先暂停或等待该任务完成");

    finishAbort();
    await firstPause;
    await running;
    const recovery = await fixture.service.create({
      courseId: created.courseId,
    });
    expect(recovery.taskId).toBe("task-double-pause-recovery");
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

  it("fences an old runner after another service pauses and resumes the task", async () => {
    let markStarted: () => void = () => undefined;
    let releaseOldRunner: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const continueOldRunner = new Promise<void>((resolve) => {
      releaseOldRunner = resolve;
    });
    const runWorkflow = vi.fn(
      async (input, context, overrides) => {
        const firstCheckpoint = runningCheckpoint(
          input.courseId,
          context.traceId,
          input.userPrompt,
        );
        await overrides.checkpoint?.(firstCheckpoint);
        markStarted();
        await continueOldRunner;
        const staleCheckpoint = {
          ...firstCheckpoint,
          currentStage: "planner" as const,
        };
        await overrides.checkpoint?.(staleCheckpoint);
        return staleCheckpoint;
      },
    ) as typeof runCourseGenerationWorkflow;
    const fixture = createFixture({ runWorkflow });
    await fixture.service.create({
      userPrompt: "生成同一门太阳系课程",
      source: "workflow",
    });
    const oldRun = fixture.service.run(taskId);
    await started;

    const secondService = createCourseGenerationTaskService({
      taskStore: fixture.taskStore,
      courseStore: fixture.courseStore,
      eventBus: fixture.eventBus,
      runWorkflow,
      now: () => timestamp,
      createTaskId: () => "task-unused-second-service",
      createCourseId: () => "course-unused-second-service",
      createTraceId: () => "trace-second-service-resume",
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    });
    await secondService.pause(taskId);
    const resumed = await secondService.resume(taskId);
    expect(resumed).toMatchObject({
      status: "queued",
      traceId: "trace-second-service-resume",
    });

    releaseOldRunner();
    await expect(oldRun).resolves.toMatchObject({
      status: "running",
      currentStage: "intent",
    });
    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "queued",
      traceId: "trace-second-service-resume",
    });
    expect(fixture.courses.get(courseId)?.currentStage).toBe("intent");
  });

  it("allows only one runner to claim a course when duplicate queued tasks race", async () => {
    const firstTaskId = "task-same-course-run-one";
    const secondTaskId = "task-same-course-run-two";
    let markStarted: () => void = () => undefined;
    let winningTraceId: string | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const runWorkflow = vi.fn(
      async (input, context, overrides) => {
        await overrides.checkpoint?.(
          runningCheckpoint(input.courseId, context.traceId, input.userPrompt),
        );
        winningTraceId = context.traceId;
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
    const taskBase = {
      version: 1 as const,
      courseId,
      userPrompt: "生成同一门太阳系课程",
      source: "workflow" as const,
      status: "queued" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    fixture.tasks.set(firstTaskId, {
      ...taskBase,
      taskId: firstTaskId,
      traceId: "trace-same-course-run-one",
    });
    fixture.tasks.set(secondTaskId, {
      ...taskBase,
      taskId: secondTaskId,
      traceId: "trace-same-course-run-two",
    });

    const firstRun = fixture.service.run(firstTaskId);
    const secondRun = fixture.service.run(secondTaskId);

    await started;
    const firstWon = winningTraceId === "trace-same-course-run-one";
    const winnerTaskId = firstWon ? firstTaskId : secondTaskId;
    const loserTaskId = firstWon ? secondTaskId : firstTaskId;
    const winnerRun = firstWon ? firstRun : secondRun;
    const loserRun = firstWon ? secondRun : firstRun;
    await expect(loserRun).rejects.toThrow(
      "请先暂停或等待该任务完成",
    );
    expect(runWorkflow).toHaveBeenCalledOnce();
    expect(fixture.tasks.get(winnerTaskId)?.status).toBe("running");
    expect(fixture.tasks.get(loserTaskId)?.status).toBe("queued");

    await fixture.service.pause(winnerTaskId);
    await expect(winnerRun).resolves.toMatchObject({ status: "running" });
  });

  it("rejects resuming a paused task while another task owns the same course", async () => {
    const pausedTaskId = "task-same-course-paused";
    const runningTaskId = "task-same-course-running";
    const fixture = createFixture();
    const taskBase = {
      version: 1 as const,
      courseId,
      userPrompt: "生成同一门太阳系课程",
      source: "workflow" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    fixture.tasks.set(pausedTaskId, {
      ...taskBase,
      taskId: pausedTaskId,
      traceId: "trace-same-course-paused",
      status: "paused",
    });
    fixture.tasks.set(runningTaskId, {
      ...taskBase,
      taskId: runningTaskId,
      traceId: "trace-same-course-running",
      status: "running",
    });

    await expect(fixture.service.resume(pausedTaskId)).rejects.toThrow(
      "不能并发写入同一检查点",
    );
    expect(fixture.tasks.get(pausedTaskId)?.status).toBe("paused");
    expect(fixture.tasks.get(runningTaskId)?.status).toBe("running");
  });

  it("does not revive a task cancelled while resume is checking ownership", async () => {
    const pausedTaskId = "task-resume-cancel-race";
    const fixture = createFixture();
    const paused: CourseTaskRecord = {
      version: 1,
      taskId: pausedTaskId,
      courseId,
      traceId: "trace-before-resume-cancel-race",
      userPrompt: "生成同一门太阳系课程",
      source: "workflow",
      status: "paused",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    fixture.tasks.set(pausedTaskId, paused);
    fixture.taskStore.list = async () => {
      fixture.tasks.set(pausedTaskId, {
        ...paused,
        status: "cancelled",
        updatedAt: timestamp,
        completedAt: timestamp,
      });
      return { items: [...fixture.tasks.values()], unavailableCount: 0 };
    };

    const result = await fixture.service.resume(pausedTaskId);

    expect(result).toMatchObject({ status: "cancelled" });
    expect(fixture.tasks.get(pausedTaskId)).toMatchObject({
      status: "cancelled",
      traceId: "trace-before-resume-cancel-race",
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
