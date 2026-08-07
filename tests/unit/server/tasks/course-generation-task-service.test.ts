import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCourseStore,
  type CourseStore,
} from "../../../../src/server/course/store/course";
import {
  createCourseTaskStore,
  type CourseTaskStore,
} from "../../../../src/server/course/store/task";
import {
  createCourseGenerationTaskService,
} from "../../../../src/server/course/task/service";
import {
  CourseRunLeaseUnavailableError,
  CourseRunTransientExecutionError,
  type runCourseGeneration,
} from "../../../../src/server/course/run/engine";
import { BrowserHarnessUnavailableError } from "../../../../src/server/infra/browser/error";
import { createCourseRunRepository } from "../../../../src/server/course/store/repository";
import type {
  CourseGenerationState,
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("course generation task service", () => {
  it("运行时预检失败时保留 queued，且不启动 Agent Loop", async () => {
    const ensureRuntimeReady = vi.fn(async () => {
      throw new BrowserHarnessUnavailableError(new Error("launch failed"));
    });
    const fixture = createFixture({ ensureRuntimeReady });

    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    await expect(fixture.service.run(taskId)).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
    });
    expect(fixture.tasks.get(taskId)).toMatchObject({ status: "queued" });
    expect(fixture.runCourse).not.toHaveBeenCalled();
  });

  it("Provider 瞬态故障时把任务放回 queued 并保留 checkpoint", async () => {
    const runCourse = vi.fn(async () => {
      throw new CourseRunTransientExecutionError(
        Object.assign(new Error("provider timeout"), { status: 504 }),
      );
    }) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });

    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
      pageCount: 3,
    });

    await expect(fixture.service.run(taskId)).resolves.toBeUndefined();
    expect(fixture.tasks.get(taskId)).toMatchObject({ status: "queued" });
    expect(fixture.tasks.get(taskId)?.error).toBeUndefined();
    expect(runCourse).toHaveBeenCalledOnce();
  });

  it("persists Reference Packs and forwards them to the course run", async () => {
    const terminal = courseState("failed", 2);
    const runCourse = vi.fn(async () => terminal) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    const referencePacks = [
      {
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
      ...agentTaskInput,
      userPrompt: "生成三页太阳风课程",
      referencePacks,
      concurrency: 2,
    });
    await fixture.service.run(taskId);

    expect(fixture.tasks.get(taskId)?.referencePacks).toEqual(referencePacks);
    expect(runCourse).toHaveBeenCalledWith(
      {
        taskId,
        courseId,
        traceId,
        creationBrief,
        referencePacks,
        concurrency: 2,
      },
      {
        abortSignal: expect.any(AbortSignal),
        assertExecutionActive: expect.any(Function),
      },
      { checkpoint: expect.any(Function) },
    );
  });

  it("persists the Page Worker execution mode and concurrency", async () => {
    const fixture = createFixture();

    await fixture.service.create({
      ...agentTaskInput,
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

  it("persists creationBrief and rejects a missing brief", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.create({
        userPrompt: "生成三页太阳系互动课程",
      }),
    ).rejects.toThrow("课程任务必须提供结构化 creationBrief");

    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
    });

    expect(fixture.tasks.get(taskId)).toMatchObject({
      creationBrief,
    });
  });

  it("rejects creating a second non-terminal task for the same course", async () => {
    const taskIds = ["task-same-course-one", "task-same-course-two"];
    const fixture = createFixture({
      createTaskId: () => taskIds.shift()!,
    });
    const first = await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成同一门太阳系课程",
    });

    await expect(
      fixture.service.create({
        ...agentTaskInput,
        courseId: first.courseId,
        userPrompt: "生成同一门太阳系课程",
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
        ...agentTaskInput,
        userPrompt: "系统讲清楚操作系统原理并穿插练习",
        pageCount,
      });

      expect(fixture.tasks.get(taskId)?.pageCount).toBe(pageCount);
    },
  );

  it("persists tasks and publishes only mapped product messages", async () => {
    const running = courseState("running", 1);
    const failed = courseState("failed", 2);
    const runCourse = vi.fn(async (_input, _context, hooks) => {
      await hooks.checkpoint?.(running);
      await hooks.checkpoint?.(failed);
      return failed;
    }) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));

    const created = await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成五页太阳系互动课程",
      pageCount: 5,
    });
    await fixture.service.run(taskId);

    expect(created.status).toBe("queued");
    expect(fixture.tasks.get(taskId)?.creationBrief).toEqual(creationBrief);
    expect(runCourse).toHaveBeenCalledOnce();
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
    expect(JSON.stringify(messages)).not.toContain("private");
  });

  it("persists and publishes a queued cancellation before the runner starts", async () => {
    const fixture = createFixture();
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      ...agentTaskInput,
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
    expect(fixture.runCourse).not.toHaveBeenCalled();
  });

  it("页面集合首次出现时先发布结构快照，不让页面事件引用旧的空页面状态", async () => {
    const initial = courseState("running", 1);
    const pageEvent = {
      id: "event-fixture-page-2",
      sequence: 2,
      type: "agent_start" as const,
      traceId,
      timestamp,
      step: 2,
      summary: "Page Builder 已领取页面任务。",
      stage: "page_writer" as const,
      pageId: "page-01",
      agent: "page-builder",
    };
    const withPage: CourseGenerationState = {
      ...initial,
      currentStage: "page_writer",
      currentPageId: "page-01",
      pages: [
        {
          pageId: "page-01",
          order: 1,
          status: "running",
          currentStage: "page_writer",
          assets: [],
        },
      ],
      events: [...initial.events, pageEvent],
    };
    const failed: CourseGenerationState = {
      ...withPage,
      status: "failed",
      pages: [
        {
          ...withPage.pages[0]!,
          status: "failed",
          error: {
            code: "PAGE_CONTENT_GENERATION_FAILED",
            message: "页面内容生成失败。",
          },
        },
      ],
      errors: [
        {
          stage: "page_writer",
          pageId: "page-01",
          code: "PAGE_CONTENT_GENERATION_FAILED",
          message: "页面内容生成失败。",
        },
      ],
      completedAt: timestamp,
      durationMs: 0,
    };
    const runCourse = vi.fn(async (_input, _context, hooks) => {
      await hooks.checkpoint?.(initial);
      await hooks.checkpoint?.(withPage);
      return failed;
    }) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成五页太阳系互动课程",
    });

    await fixture.service.run(taskId);

    expect(messages.map(({ type }) => type)).toEqual([
      "snapshot",
      "snapshot",
      "terminal",
    ]);
    expect(messages[1]).toMatchObject({
      type: "snapshot",
      state: {
        pages: [expect.objectContaining({ pageId: "page-01" })],
        events: [expect.anything(), expect.objectContaining({ pageId: "page-01" })],
      },
    });
  });

  it("取消复用 courseId 的新任务时不会继承上一 attempt 的终态和 trace", async () => {
    const fixture = createFixture();
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: creationBrief.originalRequest,
    });
    fixture.courses.set(courseId, {
      ...courseState("failed", 1),
      traceId: "trace-previous-attempt",
    });

    const cancelled = await fixture.service.cancel(taskId);

    expect(cancelled).toMatchObject({
      status: "cancelled",
      traceId,
    });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "cancelled",
      traceId,
    });
  });

  it("cancel intent 会用权威 CourseRun 终态覆盖同 trace 的旧 CourseStore 终态", async () => {
    const authoritativeCancelled = {
      ...courseState("failed", 1),
      status: "cancelled" as const,
      errors: [
        {
          stage: "planner" as const,
          code: "COURSE_TASK_CANCELLED",
          message: "课程生成已取消。",
        },
      ],
    };
    const fixture = createFixture({
      cancelCourseRun: () => authoritativeCancelled,
    });
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: creationBrief.originalRequest,
    });
    fixture.courses.set(courseId, courseState("failed", 1));

    const cancelled = await fixture.service.cancel(taskId);

    expect(cancelled).toMatchObject({ status: "cancelled", traceId });
    expect(fixture.courses.get(courseId)).toMatchObject({
      status: "cancelled",
      traceId,
    });
  });

  it("跨进程 cancel 后，持有 queued 旧快照的 runner 不能把任务复活为 running", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "task-service-cas-race-"),
    );
    temporaryDirectories.push(directory);
    const durableStore = createCourseTaskStore({
      rootDir: path.join(directory, "storage"),
    });
    const courses = new Map<string, CourseGenerationState>();
    const courseStore: CourseStore = {
      list: async () => ({
        items: [...courses.values()],
        unavailableCount: 0,
      }),
      load: async (id) => courses.get(id),
      async save(state, condition) {
        const current = courses.get(state.courseId);
        if (
          condition.expected === undefined
            ? current !== undefined
            : JSON.stringify(current) !== JSON.stringify(condition.expected)
        ) {
          return false;
        }
        courses.set(state.courseId, structuredClone(state));
        return true;
      },
    };
    let markRunningSaveStarted: () => void = () => undefined;
    let releaseRunningSave: () => void = () => undefined;
    const runningSaveStarted = new Promise<void>((resolve) => {
      markRunningSaveStarted = resolve;
    });
    const continueRunningSave = new Promise<void>((resolve) => {
      releaseRunningSave = resolve;
    });
    let blockNextRunningSave = true;
    const staleRunnerStore: CourseTaskStore = {
      load: (id) => durableStore.load(id),
      loadCourseClaim: (id) => durableStore.loadCourseClaim(id),
      loadControlIntent: (id) => durableStore.loadControlIntent(id),
      requestCancel: (id, requestedAt) =>
        durableStore.requestCancel(id, requestedAt),
      list: () => durableStore.list(),
      async save(record, condition) {
        if (blockNextRunningSave && record.status === "running") {
          blockNextRunningSave = false;
          markRunningSaveStarted();
          await continueRunningSave;
        }
        return durableStore.save(record, condition);
      },
    };
    const runCourse = vi.fn(async () => {
      throw new Error("CAS 失败后不应启动 CourseRun");
    }) as typeof runCourseGeneration;
    const sharedDependencies = {
      courseStore,
      eventBus: createSilentEventBus(),
      runCourse,
      cancelCourseRun: () => undefined,
      now: () => timestamp,
      createTaskId: () => taskId,
      createCourseId: () => courseId,
      createTraceId: () => traceId,
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    };
    const runnerService = createCourseGenerationTaskService({
      ...sharedDependencies,
      taskStore: staleRunnerStore,
    });
    const controlService = createCourseGenerationTaskService({
      ...sharedDependencies,
      taskStore: durableStore,
    });
    await runnerService.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
    });

    const running = runnerService.run(taskId);
    await runningSaveStarted;
    const cancelled = await controlService.cancel(taskId);
    releaseRunningSave();

    await expect(running).resolves.toMatchObject({ status: "cancelled" });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    await expect(durableStore.load(taskId)).resolves.toMatchObject({
      status: "cancelled",
      traceId,
    });
    expect(runCourse).not.toHaveBeenCalled();
  });

  it("跨进程 cancel 与旧 checkpoint 写入交错时，课程终态不会被旧 running 覆盖", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "course-checkpoint-cas-race-"),
    );
    temporaryDirectories.push(directory);
    const rootDir = path.join(directory, "storage");
    const runnerTaskStore = createCourseTaskStore({ rootDir });
    const controlTaskStore = createCourseTaskStore({ rootDir });
    const durableRunnerCourseStore = createCourseStore({ rootDir });
    const controlCourseStore = createCourseStore({ rootDir });
    let markCheckpointSaveStarted: () => void = () => undefined;
    let releaseCheckpointSave: () => void = () => undefined;
    const checkpointSaveStarted = new Promise<void>((resolve) => {
      markCheckpointSaveStarted = resolve;
    });
    const checkpointMaySave = new Promise<void>((resolve) => {
      releaseCheckpointSave = resolve;
    });
    let blockNextSave = true;
    const staleRunnerCourseStore: CourseStore = {
      load: (id) => durableRunnerCourseStore.load(id),
      list: () => durableRunnerCourseStore.list(),
      async save(state, condition) {
        if (blockNextSave) {
          blockNextSave = false;
          markCheckpointSaveStarted();
          await checkpointMaySave;
        }
        return durableRunnerCourseStore.save(state, condition);
      },
    };
    const staleCheckpoint = runningCheckpoint(
      courseId,
      traceId,
      "生成三页太阳系互动课程",
    );
    const runCourse = vi.fn(async (_input, _context, hooks) => {
      await hooks.checkpoint?.(staleCheckpoint);
      return staleCheckpoint;
    }) as typeof runCourseGeneration;
    const sharedDependencies = {
      eventBus: createSilentEventBus(),
      runCourse,
      cancelCourseRun: () => undefined,
      now: () => timestamp,
      createTaskId: () => taskId,
      createCourseId: () => courseId,
      createTraceId: () => traceId,
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    };
    const runnerService = createCourseGenerationTaskService({
      ...sharedDependencies,
      taskStore: runnerTaskStore,
      courseStore: staleRunnerCourseStore,
    });
    const controlService = createCourseGenerationTaskService({
      ...sharedDependencies,
      taskStore: controlTaskStore,
      courseStore: controlCourseStore,
    });
    await runnerService.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
    });

    const oldRun = runnerService.run(taskId);
    await checkpointSaveStarted;
    const cancelled = await controlService.cancel(taskId);
    releaseCheckpointSave();

    await expect(oldRun).resolves.toMatchObject({ status: "cancelled" });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    await expect(controlCourseStore.load(courseId)).resolves.toMatchObject({
      status: "cancelled",
      traceId,
    });
    await expect(controlTaskStore.load(taskId)).resolves.toMatchObject({
      status: "cancelled",
      traceId,
    });
  });

  it("跨进程 cancel intent 与 resume 竞态时，取消完成前后都不会出现 queued 裂脑", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "course-control-intent-race-"),
    );
    temporaryDirectories.push(directory);
    const rootDir = path.join(directory, "storage");
    const seedTaskStore = createCourseTaskStore({ rootDir });
    const cancelDurableTaskStore = createCourseTaskStore({ rootDir });
    const resumeTaskStore = createCourseTaskStore({ rootDir });
    const cancelCourseStore = createCourseStore({ rootDir });
    const resumeCourseStore = createCourseStore({ rootDir });
    const repository = createCourseRunRepository({ rootDir });
    const seedService = createCourseGenerationTaskService({
      taskStore: seedTaskStore,
      courseStore: cancelCourseStore,
      eventBus: createSilentEventBus(),
      runCourse: vi.fn() as typeof runCourseGeneration,
      cancelCourseRun: () => undefined,
      now: () => timestamp,
      createTaskId: () => taskId,
      createCourseId: () => courseId,
      createTraceId: () => traceId,
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    });
    await seedService.create({
      ...agentTaskInput,
      userPrompt: creationBrief.originalRequest,
    });
    const queued = await seedTaskStore.load(taskId);
    if (!queued) throw new Error("测试任务未成功创建");
    const running = {
      ...queued,
      status: "running" as const,
      updatedAt: "2026-07-15T06:00:00.500Z",
    };
    await expect(
      seedTaskStore.save(running, { expected: queued }),
    ).resolves.toBe(true);
    repository.bootstrapCourseRun({
      taskId,
      courseId,
      traceId,
      now: timestamp,
    });
    const paused = {
      ...running,
      status: "paused" as const,
      updatedAt: "2026-07-15T06:00:01.000Z",
    };
    await expect(
      seedTaskStore.save(paused, { expected: running }),
    ).resolves.toBe(true);

    let markCancelIntentPersisted: () => void = () => undefined;
    let releaseCancel: () => void = () => undefined;
    const cancelIntentPersisted = new Promise<void>((resolve) => {
      markCancelIntentPersisted = resolve;
    });
    const cancelMayContinue = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const blockedCancelTaskStore: CourseTaskStore = {
      load: (id) => cancelDurableTaskStore.load(id),
      loadCourseClaim: (id) =>
        cancelDurableTaskStore.loadCourseClaim(id),
      loadControlIntent: (id) =>
        cancelDurableTaskStore.loadControlIntent(id),
      list: () => cancelDurableTaskStore.list(),
      async requestCancel(id, requestedAt) {
        const record = await cancelDurableTaskStore.requestCancel(
          id,
          requestedAt,
        );
        markCancelIntentPersisted();
        await cancelMayContinue;
        return record;
      },
      save: (record, condition) =>
        cancelDurableTaskStore.save(record, condition),
    };
    const sharedDependencies = {
      eventBus: createSilentEventBus(),
      runCourse: vi.fn() as typeof runCourseGeneration,
      now: () => "2026-07-15T06:00:02.000Z",
      createTaskId: () => "task-unused-control-race",
      createCourseId: () => "course-unused-control-race",
      createTraceId: () => "trace-resume-race",
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    };
    const cancelService = createCourseGenerationTaskService({
      ...sharedDependencies,
      taskStore: blockedCancelTaskStore,
      courseStore: cancelCourseStore,
      cancelCourseRun: (input) => {
        repository.cancelCourseRun({
          taskId: input.taskId,
          traceId: input.traceId,
          now: input.now,
        });
        return undefined;
      },
    });
    const resumeService = createCourseGenerationTaskService({
      ...sharedDependencies,
      taskStore: resumeTaskStore,
      courseStore: resumeCourseStore,
      cancelCourseRun: () => undefined,
    });

    const cancelling = cancelService.cancel(taskId);
    await cancelIntentPersisted;
    await expect(resumeService.resume(taskId)).resolves.toMatchObject({
      status: "paused",
      traceId,
    });
    releaseCancel();
    await expect(cancelling).resolves.toMatchObject({
      status: "cancelled",
      traceId,
    });

    expect(repository.runs.loadByTaskId(taskId)).toMatchObject({
      phase: "cancelled",
      traceId,
    });
    await expect(resumeTaskStore.load(taskId)).resolves.toMatchObject({
      status: "cancelled",
      traceId,
    });
    await expect(resumeCourseStore.load(courseId)).resolves.toMatchObject({
      status: "cancelled",
      traceId,
    });
    await expect(
      resumeTaskStore.loadControlIntent(taskId),
    ).resolves.toBeUndefined();
  });

  it("跨进程重复 run 输掉 CourseRun lease 时保持 running，不误标失败", async () => {
    const runCourse = vi.fn(async () => {
      throw new CourseRunLeaseUnavailableError(
        "CourseRun 已由另一个 worker 执行",
      );
    }) as typeof runCourseGeneration;
    const fixture = createFixture({ runCourse });
    const messages: CourseTaskStreamMessage[] = [];
    fixture.eventBus.subscribe(taskId, (message) => messages.push(message));
    await fixture.service.create({
      ...agentTaskInput,
      userPrompt: "生成三页太阳系互动课程",
    });

    await expect(fixture.service.run(taskId)).resolves.toBeUndefined();

    expect(fixture.tasks.get(taskId)).toMatchObject({
      status: "running",
      traceId,
    });
    expect(fixture.courses.has(courseId)).toBe(false);
    expect(fixture.errorLogs).toEqual([]);
    expect(messages).toEqual([]);
  });

  it("跨进程并发 create 时数据库只允许一张活动任务持有同一课程", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "task-service-course-claim-"),
    );
    temporaryDirectories.push(directory);
    const taskStore = createCourseTaskStore({
      rootDir: path.join(directory, "storage"),
    });
    const courseStore: CourseStore = {
      list: async () => ({ items: [], unavailableCount: 0 }),
      load: async () => undefined,
      save: async () => false,
    };
    const shared = {
      taskStore,
      courseStore,
      eventBus: createSilentEventBus(),
      runCourse: vi.fn() as typeof runCourseGeneration,
      cancelCourseRun: () => undefined,
      now: () => timestamp,
      createCourseId: () => courseId,
      createTraceId: () => traceId,
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    };
    const first = createCourseGenerationTaskService({
      ...shared,
      createTaskId: () => "task-course-claim-first",
    });
    const second = createCourseGenerationTaskService({
      ...shared,
      createTaskId: () => "task-course-claim-second",
    });
    const input = {
      ...agentTaskInput,
      courseId,
      userPrompt: creationBrief.originalRequest,
    };

    const results = await Promise.allSettled([
      first.create(input),
      second.create(input),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    const { items } = await taskStore.list();
    expect(items).toHaveLength(1);
    await expect(taskStore.loadCourseClaim(courseId)).resolves.toBe(
      items[0].taskId,
    );
  });

  it("另一 service 终态化后旧实例可创建新任务，旧 runner 仍被持久化围栏拒绝", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "task-service-stale-memory-claim-"),
    );
    temporaryDirectories.push(directory);
    const rootDir = path.join(directory, "storage");
    const taskStoreA = createCourseTaskStore({ rootDir });
    const taskStoreB = createCourseTaskStore({ rootDir });
    const courseStoreA = createCourseStore({ rootDir });
    const courseStoreB = createCourseStore({ rootDir });
    let markOldRunnerStarted: () => void = () => undefined;
    let releaseOldRunner: () => void = () => undefined;
    const oldRunnerStarted = new Promise<void>((resolve) => {
      markOldRunnerStarted = resolve;
    });
    const oldRunnerMayContinue = new Promise<void>((resolve) => {
      releaseOldRunner = resolve;
    });
    const firstTaskId = "task-stale-memory-claim-a";
    const secondTaskId = "task-stale-memory-claim-b";
    const sharedCourseId = "course-stale-memory-claim";
    const firstTraceId = "trace-stale-memory-claim-a";
    const secondTraceId = "trace-stale-memory-claim-b";
    const runCourse = vi.fn(async (input, _context, hooks) => {
      markOldRunnerStarted();
      await oldRunnerMayContinue;
      const checkpoint = runningCheckpoint(
        input.courseId,
        input.traceId,
        creationBrief.originalRequest,
      );
      await hooks.checkpoint?.(checkpoint);
      return checkpoint;
    }) as typeof runCourseGeneration;
    const taskIds = [firstTaskId, secondTaskId];
    const traceIds = [firstTraceId, secondTraceId];
    const common = {
      eventBus: createSilentEventBus(),
      runCourse,
      cancelCourseRun: () => undefined,
      loadCourseState: () => undefined,
      now: () => timestamp,
      createCourseId: () => sharedCourseId,
      logSink: {
        info: () => undefined,
        error: () => undefined,
      },
    };
    const serviceA = createCourseGenerationTaskService({
      ...common,
      taskStore: taskStoreA,
      courseStore: courseStoreA,
      createTaskId: () => taskIds.shift()!,
      createTraceId: () => traceIds.shift()!,
    });
    const serviceB = createCourseGenerationTaskService({
      ...common,
      taskStore: taskStoreB,
      courseStore: courseStoreB,
      createTaskId: () => "task-unused-stale-memory-claim",
      createTraceId: () => "trace-unused-stale-memory-claim",
    });
    const first = await serviceA.create({
      ...agentTaskInput,
      courseId: sharedCourseId,
      userPrompt: creationBrief.originalRequest,
    });
    const oldRun = serviceA.run(first.taskId);
    await oldRunnerStarted;

    await expect(serviceB.cancel(first.taskId)).resolves.toMatchObject({
      status: "cancelled",
      traceId: firstTraceId,
    });
    await expect(
      taskStoreA.loadCourseClaim(sharedCourseId),
    ).resolves.toBeUndefined();
    const second = await serviceA.create({
      ...agentTaskInput,
      courseId: sharedCourseId,
      userPrompt: creationBrief.originalRequest,
    });
    expect(second).toMatchObject({
      taskId: secondTaskId,
      traceId: secondTraceId,
      status: "queued",
    });

    releaseOldRunner();
    await expect(oldRun).resolves.toMatchObject({
      status: "cancelled",
      traceId: firstTraceId,
    });
    await expect(taskStoreA.load(secondTaskId)).resolves.toMatchObject({
      status: "queued",
      traceId: secondTraceId,
    });
    await expect(
      taskStoreA.loadCourseClaim(sharedCourseId),
    ).resolves.toBe(secondTaskId);
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
      ...agentTaskInput,
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
    const recovery = await fixture.service.create({
      ...agentTaskInput,
      courseId: first.courseId,
    });
    expect(recovery).toMatchObject({
      taskId: "task-cancel-load-race-two",
      courseId: first.courseId,
      status: "queued",
    });
  });

});
