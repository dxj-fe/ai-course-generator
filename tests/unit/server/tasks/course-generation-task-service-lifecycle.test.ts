import { describe, expect, it, vi } from "vitest";

import {
  CourseRunLeaseUnavailableError,
  type runCourseGeneration,
} from "../../../../src/server/course/run/engine";
import { createCourseGenerationTaskService } from "../../../../src/server/course/task/service";
import type {
  CourseGenerationState,
  CourseTaskRecord,
  CourseTaskStreamMessage,
} from "../../../../src/shared/course-schema";

import {
  agentTaskInput,
  courseId,
  courseState,
  createSilentEventBus,
  createTaskServiceFixture as createFixture,
  creationBrief,
  runningCheckpoint,
  taskId,
  timestamp,
  traceId,
} from "./course-generation-task-service-test-support";

describe("course generation task service lifecycle", () => {
  it("persists and publishes a terminal failure when 课程生成 throws", async () => {
    const fixture = createFixture({
      runCourse: vi.fn(async () => {
        throw new Error("课程生成 crashed before its first checkpoint");
      }) as typeof runCourseGeneration,
    });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    await expect(fixture.service.run(taskId)).rejects.toThrow(
      "课程生成 crashed before its first checkpoint",
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
      "课程生成 crashed",
    );
    expect(messages.at(-1)).toMatchObject({
      type: "terminal",
      status: "failed",
    });
  });

  it("logs safe page and task metadata when 课程生成 resolves as failed", async () => {
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
      runCourse: vi.fn(async () => failed) as typeof runCourseGeneration,
      eventBus: createSilentEventBus(),
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    await fixture.service.run(taskId);

    expect(fixture.infoLogs).toContainEqual(
      expect.objectContaining({
        event: "task:start",
        traceId,
        taskId,
        courseId,
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
      runCourse: vi.fn(async () => {
        throw new Error("PRIVATE_PROVIDER_SECRET");
      }) as typeof runCourseGeneration,
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
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
      runCourse: vi.fn(async () => completed) as typeof runCourseGeneration,
      eventBus: createSilentEventBus(),
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
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

  it("keeps an active task cancelled when 课程生成 rejects on abort", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fixture = createFixture({
      runCourse: vi.fn(
        async (_input, context) =>
          new Promise<CourseGenerationState>((_resolve, reject) => {
            context.abortSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
            markStarted();
          }),
      ) as typeof runCourseGeneration,
    });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      ...agentTaskInput,
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

  it("pauses an active task without turning its checkpoint into cancellation", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const checkpoint = courseState("running", 1);
    const runCourse = vi.fn(
      async (_input, context, hooks) => {
        await hooks.checkpoint?.(checkpoint);
        markStarted();
        return new Promise<CourseGenerationState>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("paused", "AbortError")),
            { once: true },
          );
        });
      },
    ) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
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

  it("暂停复用 courseId 的新任务时不会继承上一 attempt 的终态", async () => {
    const fixture = createFixture();
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: creationBrief.originalRequest,
    });
    fixture.courses.set(courseId, {
      ...courseState("failed", 1),
      traceId: "trace-previous-paused-attempt",
    });

    const paused = await fixture.service.pause(taskId);

    expect(paused).toMatchObject({ status: "paused", traceId });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "failed",
      traceId: "trace-previous-paused-attempt",
    });
  });

  it("pause 后重查权威 CourseRun，并把已终态运行对齐到 Task/CourseStore", async () => {
    const authoritativeFailed = courseState("failed", 1);
    const fixture = createFixture({
      loadCourseState: () => authoritativeFailed,
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: creationBrief.originalRequest,
    });
    fixture.courses.set(
      courseId,
      runningCheckpoint(courseId, traceId, creationBrief.originalRequest),
    );

    const reconciled = await fixture.service.pause(taskId);

    expect(reconciled).toMatchObject({ status: "failed", traceId });
    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "failed",
      traceId,
    });
    expect(fixture.courses.get(courseId)).toEqual(authoritativeFailed);
  });

  it("跨进程 pause 会在持久化执行边界停止旧 runner，resume 抢不到旧 trace lease 时退回 queued", async () => {
    let markOldRunnerStarted: () => void = () => undefined;
    let releaseOldRunnerBoundary: () => void = () => undefined;
    const oldRunnerStarted = new Promise<void>((resolve) => {
      markOldRunnerStarted = resolve;
    });
    const oldRunnerMayCheckBoundary = new Promise<void>((resolve) => {
      releaseOldRunnerBoundary = resolve;
    });
    const firstCheckpoint = runningCheckpoint(
      courseId,
      traceId,
      "生成三页太阳系互动课程",
    );
    const runCourse = vi.fn(async (input, context, hooks) => {
      if (input.traceId !== "trace-cross-process-resumed") {
        await hooks.checkpoint?.(firstCheckpoint);
        markOldRunnerStarted();
        await oldRunnerMayCheckBoundary;
        await context.assertExecutionActive?.();
        return firstCheckpoint;
      }
      throw new CourseRunLeaseUnavailableError(
        "旧 CourseRun lease 尚未释放",
        "trace_adoption_blocked",
      );
    }) as typeof runCourseGeneration;
    const resumedTraceIds = vi
      .fn()
      .mockReturnValueOnce(traceId)
      .mockReturnValueOnce("trace-cross-process-resumed");
    const fixture = createFixture({
      runCourse,
      createTraceId: resumedTraceIds,
    });
    const controlService = createCourseGenerationTaskService({
      taskStore: fixture.taskStore,
      courseStore: fixture.courseStore,
      eventBus: fixture.eventBus,
      runCourse,
      cancelCourseRun: () => undefined,
      loadCourseState: () => undefined,
      now: () => timestamp,
      createTaskId: () => "task-unused-cross-process-control",
      createCourseId: () => "course-unused-cross-process-control",
      createTraceId: () => "trace-cross-process-resumed",
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
    });
    const oldRun = fixture.service.run(taskId);
    await oldRunnerStarted;

    await expect(controlService.pause(taskId)).resolves.toMatchObject({
      status: "paused",
      traceId,
    });
    await expect(controlService.resume(taskId)).resolves.toMatchObject({
      status: "queued",
      traceId: "trace-cross-process-resumed",
    });
    await expect(controlService.run(taskId)).resolves.toMatchObject({
      traceId,
      status: "running",
    });
    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "queued",
      traceId: "trace-cross-process-resumed",
    });

    releaseOldRunnerBoundary();
    await expect(oldRun).resolves.toMatchObject({
      traceId,
      status: "running",
    });
    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "queued",
      traceId: "trace-cross-process-resumed",
    });
  });

  it("does not keep a stale process-local claim while a paused runner unwinds", async () => {
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
    const runCourse = vi.fn(
      async (_input, context, hooks) => {
        await hooks.checkpoint?.(checkpoint);
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
    ) as typeof runCourseGeneration;
    const fixture = createFixture({
      runCourse,
      createTaskId: () => taskIds.shift()!,
    });
    const created = await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
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

    const replacement = await fixture.service.create({
      ...agentTaskInput,
      courseId: created.courseId,
    });
    expect(replacement.taskId).toBe("task-double-pause-blocked");

    finishAbort();
    await firstPause;
    await running;
    expect(fixture.tasks.get(replacement.taskId)?.status).toBe("queued");
  });

  it("resumes the same task and course from its checkpoint with a new trace", async () => {
    const createResumedTraceId = vi
      .fn()
      .mockReturnValueOnce(traceId)
      .mockReturnValueOnce("trace-fixture-19-resumed");
    const fixture = createFixture({
      createTraceId: createResumedTraceId,
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });
    const checkpointBeforeResume = courseState("running", 1);
    fixture.courses.set(courseId, checkpointBeforeResume);

    await fixture.service.pause(taskId);
    const resumed = await fixture.service.resume(taskId);

    expect(resumed).toMatchObject({
      taskId,
      courseId,
      traceId: "trace-fixture-19-resumed",
      status: "queued",
      completedAt: undefined,
      error: undefined,
    });
    expect(fixture.courses.get(courseId)).toEqual(checkpointBeforeResume);
  });

  it("runs a resumed 课程生成 task with the same task id and a new trace", async () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const checkpoint = courseState("running", 1);
    const runCourseMock = vi.fn(
      async (input, context, hooks) => {
        if (runCourseMock.mock.calls.length === 1) {
          await hooks.checkpoint?.(checkpoint);
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
          traceId: input.traceId,
          events: failed.events.map((event) => ({
            ...event,
            traceId: input.traceId,
          })),
        };
      },
    );
    const runCourse =
      runCourseMock as unknown as typeof runCourseGeneration;
    const createResumedTraceId = vi
      .fn()
      .mockReturnValueOnce(traceId)
      .mockReturnValueOnce("trace-fixture-19-resumed-run");
    const fixture = createFixture({
      runCourse,
      createTraceId: createResumedTraceId,
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });
    const firstRun = fixture.service.run(taskId);
    await started;
    await fixture.service.pause(taskId);
    await firstRun;
    await fixture.service.resume(taskId);

    await fixture.service.run(taskId);

    expect(runCourseMock).toHaveBeenCalledTimes(2);
    expect(runCourseMock.mock.calls[1]?.[0]).toMatchObject({
      taskId,
      courseId,
      traceId: "trace-fixture-19-resumed-run",
      creationBrief,
    });
    expect(fixture.tasks.get(taskId)).toMatchObject({
      taskId,
      courseId,
      traceId: "trace-fixture-19-resumed-run",
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
    const runCourse = vi.fn(
      async (input, _context, hooks) => {
        const firstCheckpoint = runningCheckpoint(
          input.courseId,
          input.traceId,
          input.creationBrief.originalRequest,
        );
        await hooks.checkpoint?.(firstCheckpoint);
        markStarted();
        await continueOldRunner;
        const staleCheckpoint = {
          ...firstCheckpoint,
          currentStage: "planner" as const,
        };
        await hooks.checkpoint?.(staleCheckpoint);
        return staleCheckpoint;
      },
    ) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成同一门太阳系课程",
    });
    const oldRun = fixture.service.run(taskId);
    await started;

    const secondService = createCourseGenerationTaskService({
      taskStore: fixture.taskStore,
      courseStore: fixture.courseStore,
      eventBus: fixture.eventBus,
      runCourse,
      loadCourseState: () => undefined,
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
    const runCourse = vi.fn(
      async (input, context, hooks) => {
        await hooks.checkpoint?.(
          runningCheckpoint(
            input.courseId,
            input.traceId,
            input.creationBrief.originalRequest,
          ),
        );
        winningTraceId = input.traceId;
        markStarted();
        return new Promise<CourseGenerationState>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("paused", "AbortError")),
            { once: true },
          );
        });
      },
    ) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    const taskBase = {
      courseId,
      userPrompt: "生成同一门太阳系课程",
      creationBrief,
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
    expect(runCourse).toHaveBeenCalledOnce();
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
      courseId,
      userPrompt: "生成同一门太阳系课程",
      creationBrief,
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
      taskId: pausedTaskId,
      courseId,
      traceId: "trace-before-resume-cancel-race",
      userPrompt: "生成同一门太阳系课程",
      creationBrief,
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
    const runCourse = vi.fn(
      async (input, context, hooks) => {
        signals.set(input.courseId, context.abortSignal);
        const checkpoint = runningCheckpoint(
          input.courseId,
          input.traceId,
          input.creationBrief.originalRequest,
        );
        await hooks.checkpoint?.(checkpoint);
        started.get(input.courseId)?.();
        return new Promise<CourseGenerationState>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("stopped", "AbortError")),
            { once: true },
          );
        });
      },
    ) as typeof runCourseGeneration;
    const fixture = createFixture({
      runCourse,
      createTaskId: () => taskIds.shift()!,
      createCourseId: () => courseIds.shift()!,
      createTraceId: () => traceIds.shift()!,
    });
    const first = await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成课程一",
    });
    const second = await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成课程二",
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
    await fixture.service.create({
      ...agentTaskInput,
      courseId,
    });

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
