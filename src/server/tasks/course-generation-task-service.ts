import { z } from "zod";

import {
  AiRequestError,
  createTraceId,
  toAiErrorPayload,
} from "@/server/ai/error";
import { streamCourseGenerationGraphWorkflow } from "@/server/langgraph/course-generation/run-course-graph";
import {
  createCourseStore,
  type CourseStore,
} from "@/server/storage/course-store";
import {
  createCourseTaskStore,
  type CourseTaskStore,
} from "@/server/storage/course-task-store";
import {
  courseTaskEventBus,
  type CourseTaskEventBus,
} from "@/server/tasks/course-task-event-bus";
import {
  runCourseGenerationWorkflow,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-workflow";
import {
  CourseIdSchema,
  CoursePageCountSchema,
  CourseTaskCreateResponseSchema,
  CourseTaskIdSchema,
  CourseTaskRecordSchema,
  CourseTaskRuntimeSourceSchema,
  CourseGenerationStateSchema,
  REFERENCE_MAX_PACKS,
  ReferencePackSchema,
  type CourseGenerationState,
  type CourseGenerationCauseCode,
  type CourseTaskCreateResponse,
  type CourseTaskRecord,
  type PageGenerationState,
} from "@/shared/course-schema";

const CourseTaskCreateInputSchema = z
  .object({
    courseId: CourseIdSchema.optional(),
    userPrompt: z.string().trim().min(2).max(4_000).optional(),
    referencePacks: z.array(ReferencePackSchema).max(REFERENCE_MAX_PACKS).optional(),
    pageCount: CoursePageCountSchema.optional(),
    executionMode: z.enum(["serial", "parallel"]).optional(),
    concurrency: z.number().int().min(1).max(5).optional(),
    source: CourseTaskRuntimeSourceSchema.optional(),
    traceId: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.courseId || value.userPrompt), {
    message: "userPrompt 或 courseId 至少提供一个",
  });

export type CourseGenerationTaskService = {
  create(input: unknown): Promise<CourseTaskCreateResponse>;
  run(taskId: string): Promise<CourseGenerationState | undefined>;
  pause(taskId: string): Promise<CourseTaskRecord | undefined>;
  resume(taskId: string): Promise<CourseTaskRecord | undefined>;
  cancel(taskId: string): Promise<CourseTaskRecord | undefined>;
  load(taskId: string): Promise<CourseTaskRecord | undefined>;
};

export type CourseGenerationLogEntry = {
  event:
    | "task:start"
    | "page:failed"
    | "task:failed"
    | "task:completed"
    | "task:error";
  traceId: string;
  taskId: string;
  courseId: string;
  pageId?: string;
  stage?: CourseGenerationState["currentStage"];
  attempt?: number;
  errorCode?: string;
  errorMessage?: string;
  causeCode?: CourseGenerationCauseCode;
  issueCodes?: string[];
  durationMs?: number;
  completedPages?: number;
  totalPages?: number;
  source?: CourseTaskRecord["source"];
  status?: CourseTaskRecord["status"];
};

export type CourseGenerationLogSink = {
  info(entry: CourseGenerationLogEntry): void;
  error(entry: CourseGenerationLogEntry): void;
};

type CourseGenerationTaskServiceDependencies = {
  taskStore: CourseTaskStore;
  courseStore: CourseStore;
  eventBus: CourseTaskEventBus;
  runWorkflow: typeof runCourseGenerationWorkflow;
  runGraph: typeof streamCourseGenerationGraphWorkflow;
  now(): string;
  createTaskId(): string;
  createCourseId(): string;
  createTraceId(): string;
  logSink: CourseGenerationLogSink;
};

type ActiveTask = {
  controller: AbortController;
  promise: Promise<CourseGenerationState | undefined>;
  stopIntent?: "pause" | "cancel";
};

const defaultLogSink: CourseGenerationLogSink = {
  info: (entry) => console.info("[course-generation]", entry),
  error: (entry) => console.error("[course-generation]", entry),
};

const defaultDependencies: CourseGenerationTaskServiceDependencies = {
  taskStore: createCourseTaskStore(),
  courseStore: createCourseStore(),
  eventBus: courseTaskEventBus,
  runWorkflow: runCourseGenerationWorkflow,
  runGraph: streamCourseGenerationGraphWorkflow,
  now: () => new Date().toISOString(),
  createTaskId: () => `task-${crypto.randomUUID()}`,
  createCourseId: () => `course-${crypto.randomUUID()}`,
  createTraceId,
  logSink: defaultLogSink,
};

/**
 * Day 19 的任务生命周期所有者。EventSource 只订阅；只有本服务持有的
 * AbortController 才能取消实际工作流。
 */
export function createCourseGenerationTaskService(
  overrides: Partial<CourseGenerationTaskServiceDependencies> = {},
): CourseGenerationTaskService {
  const dependencies = { ...defaultDependencies, ...overrides };
  const activeTasks = new Map<string, ActiveTask>();
  const courseClaims = new Map<string, string>();

  const releaseCourseClaim = (courseId: string, taskId: string) => {
    if (courseClaims.get(courseId) === taskId) {
      courseClaims.delete(courseId);
    }
  };

  const assertCourseIsAvailable = async (
    courseId: string,
    taskId: string,
    blockingStatuses: ReadonlySet<CourseTaskRecord["status"]>,
  ) => {
    const claimedTaskId = courseClaims.get(courseId);
    if (claimedTaskId && claimedTaskId !== taskId) {
      throw new AiRequestError(
        `课程 ${courseId} 已由任务 ${claimedTaskId} 处理，请先暂停或等待该任务完成。`,
      );
    }

    const { items } = await dependencies.taskStore.list();
    const concurrentlyClaimedTaskId = courseClaims.get(courseId);
    if (
      concurrentlyClaimedTaskId &&
      concurrentlyClaimedTaskId !== taskId
    ) {
      throw new AiRequestError(
        `课程 ${courseId} 已由任务 ${concurrentlyClaimedTaskId} 处理，请先暂停或等待该任务完成。`,
      );
    }
    const conflicting = items.find(
      (record) =>
        record.courseId === courseId &&
        record.taskId !== taskId &&
        blockingStatuses.has(record.status),
    );
    if (conflicting) {
      throw new AiRequestError(
        `课程 ${courseId} 已有任务 ${conflicting.taskId} 处于 ${conflicting.status} 状态，不能并发写入同一检查点。`,
      );
    }

    courseClaims.set(courseId, taskId);
  };

  return {
    async create(input) {
      const parsed = CourseTaskCreateInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new AiRequestError(
          `请求必须包含有效的课程提示或 courseId：${parsed.error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "root"}: ${issue.message}`,
            )
            .join("; ")}`,
        );
      }

      const courseId = parsed.data.courseId ?? dependencies.createCourseId();
      const existingState = await dependencies.courseStore.load(courseId);
      const userPrompt = parsed.data.userPrompt ?? existingState?.userPrompt;

      if (!userPrompt) {
        throw new AiRequestError(`找不到课程 ${courseId} 的可恢复检查点。`);
      }
      if (
        existingState &&
        parsed.data.userPrompt &&
        parsed.data.userPrompt !== existingState.userPrompt
      ) {
        throw new AiRequestError("恢复课程时不能更换原始 userPrompt。");
      }
      if (
        existingState &&
        parsed.data.referencePacks &&
        JSON.stringify(parsed.data.referencePacks) !==
          JSON.stringify(existingState.referencePacks ?? [])
      ) {
        throw new AiRequestError("恢复课程时不能更换原始 Reference Pack。");
      }
      if (
        existingState?.intent &&
        parsed.data.pageCount &&
        parsed.data.pageCount !== existingState.intent.courseLength
      ) {
        throw new AiRequestError("恢复课程时不能更改已确定的页面数量。");
      }
      if (
        existingState?.workerConfig &&
        ((parsed.data.executionMode &&
          parsed.data.executionMode !== existingState.workerConfig.mode) ||
          (parsed.data.concurrency &&
            parsed.data.concurrency !==
              existingState.workerConfig.concurrency))
      ) {
        throw new AiRequestError("恢复课程时不能更改 Page Worker 配置。");
      }

      const timestamp = dependencies.now();
      const taskId = CourseTaskIdSchema.parse(dependencies.createTaskId());
      const traceId = parsed.data.traceId ?? dependencies.createTraceId();
      const pageCount = existingState?.intent
        ? (existingState.intent.courseLength as CourseMvpPageCount)
        : parsed.data.pageCount;
      const referencePacks =
        existingState?.referencePacks ?? parsed.data.referencePacks;
      const record = CourseTaskRecordSchema.parse({
        version: 1,
        taskId,
        courseId,
        traceId,
        userPrompt,
        referencePacks,
        pageCount,
        executionMode:
          existingState?.workerConfig?.mode ?? parsed.data.executionMode,
        concurrency:
          existingState?.workerConfig?.concurrency ?? parsed.data.concurrency,
        source: parsed.data.source ?? "langgraph",
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await assertCourseIsAvailable(
        courseId,
        taskId,
        new Set(["queued", "running", "paused"]),
      );
      try {
        await dependencies.taskStore.save(record);
      } catch (error) {
        releaseCourseClaim(courseId, taskId);
        throw error;
      }
      return CourseTaskCreateResponseSchema.parse({
        taskId,
        courseId,
        traceId,
        status: "queued",
        source: record.source,
      });
    },

    run(taskId) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const current = activeTasks.get(safeTaskId);
      if (current) return current.promise;

      const controller = new AbortController();
      const active: ActiveTask = {
        controller,
        promise: Promise.resolve(undefined),
      };
      const promise = (async () => {
        const record = await dependencies.taskStore.load(safeTaskId);
        if (
          !record ||
          isTerminalStatus(record.status) ||
          record.status === "paused"
        ) {
          if (record) releaseCourseClaim(record.courseId, safeTaskId);
          return record
            ? dependencies.courseStore.load(record.courseId)
            : undefined;
        }

        try {
          await assertCourseIsAvailable(
            record.courseId,
            safeTaskId,
            new Set(["running"]),
          );
          return await executeTask(
            safeTaskId,
            controller,
            dependencies,
            () => active.stopIntent,
          );
        } finally {
          releaseCourseClaim(record.courseId, safeTaskId);
        }
      })().finally(() => {
        if (activeTasks.get(safeTaskId)?.promise === promise) {
          activeTasks.delete(safeTaskId);
        }
      });

      active.promise = promise;
      activeTasks.set(safeTaskId, active);
      return promise;
    },

    async pause(taskId) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const record = await dependencies.taskStore.load(safeTaskId);
      const active = activeTasks.get(safeTaskId);
      if (
        !record ||
        isTerminalStatus(record.status) ||
        record.status === "paused"
      ) {
        if (record && !active) {
          releaseCourseClaim(record.courseId, record.taskId);
        }
        return record;
      }
      if (active) active.stopIntent = "pause";

      const paused = CourseTaskRecordSchema.parse({
        ...record,
        status: "paused",
        updatedAt: dependencies.now(),
        completedAt: undefined,
        error: undefined,
      });
      await dependencies.taskStore.save(paused);

      const state = await dependencies.courseStore.load(paused.courseId);
      if (state && !isCourseTerminalStatus(state.status)) {
        publishTaskSnapshot(dependencies.eventBus, paused, state);
      }

      active?.controller.abort(
        new DOMException("课程生成已暂停。", "AbortError"),
      );
      // pause 返回时当前 taskId 的 runner 已退出，随后 resume 才能安全地
      // 以同一 checkpoint 和新的 traceId 启动，不会与旧调用并行写入。
      await active?.promise;

      const [settled, settledState] = await Promise.all([
        dependencies.taskStore.load(safeTaskId),
        dependencies.courseStore.load(paused.courseId),
      ]);
      if (!settled || isTerminalStatus(settled.status)) return settled;
      if (settledState && isCourseTerminalStatus(settledState.status)) {
        const terminalState = settledState as CourseGenerationState & {
          status: "completed" | "failed" | "cancelled";
        };
        const terminal = createTerminalTaskRecord(
          settled,
          terminalState,
          dependencies.now(),
        );
        await dependencies.taskStore.save(terminal);
        dependencies.eventBus.publish({
          type: "terminal",
          taskId: terminal.taskId,
          courseId: terminal.courseId,
          source: terminal.source,
          status: terminalState.status,
          state: terminalState,
        });
        return terminal;
      }
      if (settled.status === "paused") {
        releaseCourseClaim(settled.courseId, settled.taskId);
        return settled;
      }

      // 覆盖 run() 刚读取 queued、随后才尝试写 running 的窄竞态。
      await dependencies.taskStore.save(paused);
      releaseCourseClaim(paused.courseId, paused.taskId);
      return paused;
    },

    async resume(taskId) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const record = await dependencies.taskStore.load(safeTaskId);
      if (!record || isTerminalStatus(record.status)) return record;
      if (record.status !== "paused") return record;

      // 跨请求的重复 resume 仍只恢复这个 taskId。pause 正常会先等待旧
      // runner 收敛；这里额外等待，覆盖服务内并发调用。
      await activeTasks.get(safeTaskId)?.promise;

      const settled = await dependencies.taskStore.load(safeTaskId);
      if (!settled || isTerminalStatus(settled.status)) return settled;
      if (settled.status !== "paused") return settled;

      await assertCourseIsAvailable(
        settled.courseId,
        settled.taskId,
        new Set(["queued", "running"]),
      );
      // assertCourseIsAvailable 内部需要读取持久化任务列表；期间 cancel 或
      // 另一控制请求可能已经改写状态。保存 queued 前最后复验一次，避免
      // 用调用开始时的 paused 快照复活终态任务。
      const resumable = await dependencies.taskStore.load(safeTaskId);
      if (!resumable || isTerminalStatus(resumable.status)) {
        releaseCourseClaim(settled.courseId, settled.taskId);
        return resumable;
      }
      if (resumable.status !== "paused") {
        releaseCourseClaim(settled.courseId, settled.taskId);
        return resumable;
      }
      const queued = CourseTaskRecordSchema.parse({
        ...resumable,
        traceId: dependencies.createTraceId(),
        status: "queued",
        updatedAt: dependencies.now(),
        completedAt: undefined,
        error: undefined,
      });
      try {
        await dependencies.taskStore.save(queued);
      } catch (error) {
        releaseCourseClaim(resumable.courseId, resumable.taskId);
        throw error;
      }

      const state = await dependencies.courseStore.load(queued.courseId);
      if (state && !isCourseTerminalStatus(state.status)) {
        publishTaskSnapshot(dependencies.eventBus, queued, state);
      }
      return queued;
    },

    async cancel(taskId) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const record = await dependencies.taskStore.load(safeTaskId);
      if (!record || isTerminalStatus(record.status)) return record;
      const active = activeTasks.get(safeTaskId);
      if (active) active.stopIntent = "cancel";

      const timestamp = dependencies.now();
      const persistedState = await dependencies.courseStore.load(record.courseId);
      const state = createTerminalCourseState(
        record,
        persistedState,
        "cancelled",
        timestamp,
        {
          code: "COURSE_TASK_CANCELLED",
          message: "课程生成已取消。",
        },
      );
      const cancelled = createTerminalTaskRecord(record, state, timestamp);

      // 先写课程终态再写任务映射，刷新订阅不会观察到缺少 checkpoint
      // 的 terminal task。
      if (state !== persistedState) {
        await dependencies.courseStore.save(state);
      }
      await dependencies.taskStore.save(cancelled);
      active?.controller.abort();
      // 终态与 trace fencing 已经阻止旧 runner 再写 checkpoint；立即释放
      // course claim，覆盖 cancel 发生在 run() 首次 load 完成前的竞态。
      releaseCourseClaim(cancelled.courseId, cancelled.taskId);
      dependencies.eventBus.publish({
        type: "terminal",
        taskId: cancelled.taskId,
        courseId: cancelled.courseId,
        source: cancelled.source,
        status: state.status,
        state,
      });
      return cancelled;
    },

    load(taskId) {
      return dependencies.taskStore.load(CourseTaskIdSchema.parse(taskId));
    },
  };
}

async function executeTask(
  taskId: string,
  controller: AbortController,
  dependencies: CourseGenerationTaskServiceDependencies,
  stopIntent: () => ActiveTask["stopIntent"],
) {
  const queued = await dependencies.taskStore.load(taskId);
  if (
    !queued ||
    isTerminalStatus(queued.status) ||
    queued.status === "paused"
  ) {
    return queued
      ? dependencies.courseStore.load(queued.courseId)
      : undefined;
  }

  const running = CourseTaskRecordSchema.parse({
    ...queued,
    status: "running",
    updatedAt: dependencies.now(),
    completedAt: undefined,
    error: undefined,
  });
  try {
    await dependencies.taskStore.save(running);
    if (stopIntent() === "pause") {
      const paused = CourseTaskRecordSchema.parse({
        ...running,
        status: "paused",
        updatedAt: dependencies.now(),
        completedAt: undefined,
        error: undefined,
      });
      await dependencies.taskStore.save(paused);
      return dependencies.courseStore.load(running.courseId);
    }

    const existingState = await dependencies.courseStore.load(running.courseId);
    dependencies.logSink.info(
      createTaskLogEntry("task:start", running, existingState, {
        status: "running",
      }),
    );
    const loggedFailedPages = new Set<string>();
    const pageStatuses = new Map(
      existingState?.pages.map(
        (page) => [page.pageId, page.status] as const,
      ) ?? [],
    );
    const logPageFailures = (
      checkpoint: CourseGenerationState,
      includeExisting = false,
    ) => {
      for (const page of checkpoint.pages) {
        const previousStatus = pageStatuses.get(page.pageId);
        if (
          page.status === "failed" &&
          (includeExisting || previousStatus !== "failed") &&
          !loggedFailedPages.has(page.pageId)
        ) {
          dependencies.logSink.error(
            createPageFailureLogEntry(running, page, checkpoint),
          );
          loggedFailedPages.add(page.pageId);
        }
        pageStatuses.set(page.pageId, page.status);
      }
    };
    let lastPublishedSequence =
      existingState?.events.at(-1)?.sequence ?? 0;
    let sentSnapshot = false;
    const persistCheckpoint = async (checkpoint: CourseGenerationState) => {
      const currentTask = await dependencies.taskStore.load(running.taskId);
      if (stopIntent() === "pause") {
        controller.abort(
          new DOMException("课程生成已暂停。", "AbortError"),
        );
        throw new DOMException("课程生成已暂停。", "AbortError");
      }
      if (
        currentTask?.status === "cancelled" &&
        checkpoint.status !== "cancelled"
      ) {
        controller.abort();
        throw new Error("课程任务已取消。");
      }
      if (currentTask?.status === "paused") {
        controller.abort(
          new DOMException("课程生成已暂停。", "AbortError"),
        );
        throw new DOMException("课程生成已暂停。", "AbortError");
      }
      if (
        !currentTask ||
        currentTask.status !== "running" ||
        currentTask.traceId !== running.traceId
      ) {
        controller.abort(
          new DOMException("课程任务执行权已变更。", "AbortError"),
        );
        throw new DOMException("课程任务执行权已变更。", "AbortError");
      }
      await dependencies.courseStore.save(checkpoint);
      logPageFailures(checkpoint);
    };
    const publishCheckpoint = (checkpoint: CourseGenerationState) => {
      const newEvents = checkpoint.events.filter(
        (event) =>
          event.sequence > lastPublishedSequence &&
          event.traceId === running.traceId,
      );

      if (!sentSnapshot) {
        dependencies.eventBus.publish({
          type: "snapshot",
          taskId: running.taskId,
          courseId: running.courseId,
          source: running.source,
          state: checkpoint,
        });
        sentSnapshot = true;
      } else {
        for (const event of newEvents) {
          dependencies.eventBus.publish({
            type: "event",
            taskId: running.taskId,
            courseId: running.courseId,
            source: running.source,
            event,
          });
        }

        if (shouldPublishSnapshot(newEvents)) {
          dependencies.eventBus.publish({
            type: "snapshot",
            taskId: running.taskId,
            courseId: running.courseId,
            source: running.source,
            state: checkpoint,
          });
        }
      }

      lastPublishedSequence = Math.max(
        lastPublishedSequence,
        checkpoint.events.at(-1)?.sequence ?? 0,
      );
    };
    const workflowInput = {
      courseId: running.courseId,
      userPrompt: running.userPrompt,
      referencePacks: running.referencePacks,
      pageCount: running.pageCount,
      executionMode: running.executionMode,
      concurrency: running.concurrency,
      existingState,
    };
    const runtimeContext = {
      abortSignal: controller.signal,
      traceId: running.traceId,
    };
    const state =
      running.source === "langgraph"
        ? await dependencies.runGraph(
            workflowInput,
            runtimeContext,
            { checkpoint: persistCheckpoint },
            ({ state: checkpoint }) => publishCheckpoint(checkpoint),
          )
        : await dependencies.runWorkflow(workflowInput, runtimeContext, {
            checkpoint: async (checkpoint) => {
              await persistCheckpoint(checkpoint);
              publishCheckpoint(checkpoint);
            },
          });
    const latestTask = await dependencies.taskStore.load(running.taskId);
    if (
      stopIntent() === "pause" ||
      !latestTask ||
      latestTask.status !== "running" ||
      latestTask.traceId !== running.traceId
    ) {
      return dependencies.courseStore.load(running.courseId);
    }
    if (!isCourseTerminalStatus(state.status)) {
      throw new Error("课程工作流返回了非终态结果。");
    }
    logPageFailures(state, true);
    const completedAt = dependencies.now();
    const terminalRecord = CourseTaskRecordSchema.parse({
      ...running,
      status: state.status,
      updatedAt: completedAt,
      completedAt,
      error:
        state.status === "failed" || state.status === "cancelled"
          ? state.errors.at(-1)
            ? {
                code: state.errors.at(-1)!.code,
                causeCode: state.errors.at(-1)!.causeCode,
                message: state.errors.at(-1)!.message,
              }
            : {
                code: "COURSE_TASK_INCOMPLETE",
                message: "课程任务未完成。",
              }
          : undefined,
    });

    await dependencies.taskStore.save(terminalRecord);
    if (state.status === "completed") {
      dependencies.logSink.info(
        createTaskLogEntry("task:completed", running, state, {
          status: state.status,
        }),
      );
    } else if (state.status === "failed") {
      dependencies.logSink.error(
        createTaskLogEntry("task:failed", running, state, {
          status: state.status,
        }),
      );
    }
    dependencies.eventBus.publish({
      type: "terminal",
      taskId: running.taskId,
      courseId: running.courseId,
      source: running.source,
      status: state.status,
      state,
    });
    return state;
  } catch (error) {
    const completedAt = dependencies.now();
    const classified = toAiErrorPayload(error, running.traceId);
    const currentTask = await dependencies.taskStore.load(running.taskId);
    const currentState = await dependencies.courseStore.load(running.courseId);
    // 暂停只终止当前进程内的调用，持久化课程仍保持最近一次 running
    // checkpoint。它不是失败/取消，不写 error/completedAt，也不发 terminal。
    if (stopIntent() === "pause" || currentTask?.status === "paused") {
      return currentState;
    }
    // 另一 service/HMR 实例已经为同一 taskId 分配了新 trace，旧 runner
    // 失去 checkpoint 写权限后只退出，不能把新 queued/running 任务终态化。
    if (
      currentTask &&
      (currentTask.traceId !== running.traceId ||
        currentTask.status === "queued")
    ) {
      return currentState;
    }
    dependencies.logSink.error({
      event: "task:error",
      traceId: running.traceId,
      taskId: running.taskId,
      courseId: running.courseId,
      pageId: currentState?.currentPageId,
      stage: currentState?.currentStage,
      errorCode: classified.code,
      errorMessage: classified.message,
      causeCode: toCourseGenerationCauseCode(classified.code),
      durationMs: durationBetween(running.createdAt, completedAt),
      completedPages: countCompletedPages(currentState),
      totalPages: resolveTotalPages(running, currentState),
      source: running.source,
      status:
        controller.signal.aborted || currentTask?.status === "cancelled"
          ? "cancelled"
          : "failed",
    });

    // cancel()（或另一执行者）可能已经先完成了“课程终态 -> 任务终态”
    // 的持久化与发布。此处只收敛当前 runner，避免重复 error/terminal。
    if (
      currentTask &&
      isTerminalStatus(currentTask.status) &&
      currentState &&
      isCourseTerminalStatus(currentState.status) &&
      currentTask.status === currentState.status
    ) {
      return currentState;
    }

    const status =
      controller.signal.aborted || currentTask?.status === "cancelled"
        ? "cancelled"
        : "failed";
    const terminalState = createTerminalCourseState(
      running,
      currentState,
      status,
      completedAt,
      {
        code:
          status === "cancelled"
            ? "COURSE_TASK_CANCELLED"
            : "COURSE_TASK_EXECUTION_ERROR",
        causeCode:
          status === "cancelled"
            ? undefined
            : toCourseGenerationCauseCode(classified.code),
        message:
          status === "cancelled" ? "课程生成已取消。" : classified.message,
      },
    );
    const terminalRecord = createTerminalTaskRecord(
      running,
      terminalState,
      completedAt,
    );

    if (terminalState !== currentState) {
      await dependencies.courseStore.save(terminalState);
    }
    await dependencies.taskStore.save(terminalRecord);
    if (terminalState.status === "failed") {
      dependencies.logSink.error(
        createTaskLogEntry("task:failed", running, terminalState, {
          status: terminalState.status,
        }),
      );
    }
    dependencies.eventBus.publish({
      type: "terminal",
      taskId: running.taskId,
      courseId: running.courseId,
      source: running.source,
      status: terminalState.status,
      state: terminalState,
    });

    if (status === "cancelled") return terminalState;
    throw error;
  }
}

function createTaskLogEntry(
  event: "task:start" | "task:failed" | "task:completed",
  record: CourseTaskRecord,
  state: CourseGenerationState | undefined,
  overrides: Pick<CourseGenerationLogEntry, "status">,
): CourseGenerationLogEntry {
  const latestError = event === "task:failed" ? state?.errors.at(-1) : undefined;

  return {
    event,
    traceId: record.traceId,
    taskId: record.taskId,
    courseId: record.courseId,
    pageId: latestError?.pageId,
    stage: latestError?.stage ?? state?.currentStage,
    errorCode: latestError?.code,
    errorMessage: latestError?.message,
    causeCode: latestError?.causeCode,
    durationMs:
      event === "task:start"
        ? undefined
        : state?.durationMs ??
          (state?.completedAt
            ? durationBetween(record.createdAt, state.completedAt)
            : undefined),
    completedPages: countCompletedPages(state),
    totalPages: resolveTotalPages(record, state),
    source: record.source,
    status: overrides.status,
  };
}

function createPageFailureLogEntry(
  record: CourseTaskRecord,
  page: PageGenerationState,
  state: CourseGenerationState,
): CourseGenerationLogEntry {
  const matchingError = [...state.errors]
    .reverse()
    .find((error) => error.pageId === page.pageId);
  const issueCodes = [
    ...(page.repairHistory?.at(-1)?.issueCodes ?? []),
    ...(page.qualityReport?.issues.map(({ code }) => code) ?? []),
  ].filter((code, index, codes) => codes.indexOf(code) === index);

  return {
    event: "page:failed",
    traceId: record.traceId,
    taskId: record.taskId,
    courseId: record.courseId,
    pageId: page.pageId,
    stage: matchingError?.stage ?? page.currentStage,
    attempt: resolvePageAttempt(page),
    errorCode: page.error?.code ?? matchingError?.code,
    errorMessage: (page.error?.message ?? matchingError?.message)?.slice(
      0,
      4_000,
    ),
    causeCode: page.error?.causeCode ?? matchingError?.causeCode,
    issueCodes: issueCodes.length > 0 ? issueCodes.slice(0, 20) : undefined,
    durationMs: state.durationMs,
    completedPages: countCompletedPages(state),
    totalPages: resolveTotalPages(record, state),
    source: record.source,
    status: state.status,
  };
}

function resolvePageAttempt(page: PageGenerationState) {
  if (page.currentStage === "repair") {
    return page.repairHistory?.at(-1)?.round;
  }

  return [...(page.attempts ?? [])]
    .reverse()
    .find(({ stage }) => stage === page.currentStage)?.attempts;
}

function countCompletedPages(state: CourseGenerationState | undefined) {
  return state?.pages.filter(({ status }) => status === "completed").length ?? 0;
}

function resolveTotalPages(
  record: CourseTaskRecord,
  state: CourseGenerationState | undefined,
) {
  return state?.intent?.courseLength ?? record.pageCount ?? state?.pages.length;
}

function durationBetween(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function createTerminalTaskRecord(
  record: CourseTaskRecord,
  state: CourseGenerationState & {
    status: "completed" | "failed" | "cancelled";
  },
  timestamp: string,
) {
  const latestError = state.errors.at(-1);

  return CourseTaskRecordSchema.parse({
    ...record,
    status: state.status,
    updatedAt: timestamp,
    completedAt: state.completedAt ?? timestamp,
    error:
      state.status === "completed"
        ? undefined
        : latestError
          ? {
              code: latestError.code,
              causeCode: latestError.causeCode,
              message: latestError.message,
            }
          : {
              code: "COURSE_TASK_INCOMPLETE",
              message: "课程任务未完成。",
            },
  });
}

function createTerminalCourseState(
  record: CourseTaskRecord,
  existingState: CourseGenerationState | undefined,
  requestedStatus: "failed" | "cancelled",
  timestamp: string,
  error: {
    code: string;
    causeCode?: CourseGenerationCauseCode;
    message: string;
  },
): CourseGenerationState & {
  status: "completed" | "failed" | "cancelled";
} {
  if (existingState && isCourseTerminalStatus(existingState.status)) {
    return existingState as CourseGenerationState & {
      status: "completed" | "failed" | "cancelled";
    };
  }

  const base: CourseGenerationState = existingState ?? {
    version: 1,
    courseId: record.courseId,
    traceId: record.traceId,
    userPrompt: record.userPrompt,
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: record.createdAt,
    updatedAt: timestamp,
  };
  const courseError = {
    stage: base.currentStage,
    pageId: base.currentPageId,
    code: error.code,
    causeCode: error.causeCode,
    message: error.message,
  };
  const pages =
    base.currentPageId && isPageGenerationStage(base.currentStage)
      ? base.pages.map((page) =>
          page.pageId === base.currentPageId
            ? {
                ...page,
                status: "failed" as const,
                currentStage: base.currentStage,
                error: {
                  code: error.code,
                  causeCode: error.causeCode,
                  message: error.message,
                },
              }
            : page,
        )
      : base.pages;
  const events =
    base.events.length >= 1_000
      ? base.events
      : [
          ...base.events,
          {
            id: crypto.randomUUID(),
            sequence: base.events.length + 1,
            type: "error" as const,
            traceId: record.traceId,
            timestamp,
            step: 0,
            summary: error.message,
            stage: base.currentStage,
            pageId: base.currentPageId,
          },
        ];

  return CourseGenerationStateSchema.parse({
    ...base,
    traceId: record.traceId,
    status: requestedStatus,
    pages,
    events,
    errors:
      base.errors.length >= 30 ? base.errors : [...base.errors, courseError],
    updatedAt: timestamp,
    completedAt: timestamp,
    durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(base.startedAt)),
  }) as CourseGenerationState & {
    status: "failed" | "cancelled";
  };
}

function isPageGenerationStage(
  stage: CourseGenerationState["currentStage"],
): stage is "page_writer" | "assets" | "html" {
  return stage === "page_writer" || stage === "assets" || stage === "html";
}

function shouldPublishSnapshot(
  events: CourseGenerationState["events"],
) {
  return events.some(
    ({ type, stage }) =>
      type === "page_done" ||
      type === "error" ||
      (type === "agent_done" &&
        (stage === "intent" || stage === "planner" || stage === "design")),
  );
}

function publishTaskSnapshot(
  eventBus: CourseTaskEventBus,
  task: CourseTaskRecord,
  state: CourseGenerationState,
) {
  eventBus.publish({
    type: "snapshot",
    taskId: task.taskId,
    courseId: task.courseId,
    source: task.source,
    taskStatus: task.status,
    state,
  });
}

function toCourseGenerationCauseCode(
  code: string,
): CourseGenerationCauseCode | undefined {
  switch (code) {
    case "SCHEMA_ERROR":
    case "TIMEOUT_ERROR":
    case "RATE_LIMIT_ERROR":
    case "QUOTA_ERROR":
    case "AUTH_ERROR":
    case "CONFIG_ERROR":
    case "MODEL_ERROR":
      return code;
    default:
      return undefined;
  }
}

function isTerminalStatus(status: CourseTaskRecord["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isCourseTerminalStatus(
  status: CourseGenerationState["status"],
): status is "completed" | "failed" | "cancelled" {
  return status === "completed" || status === "failed" || status === "cancelled";
}

const globalCourseGenerationTaskService = globalThis as typeof globalThis & {
  __keyaCourseGenerationTaskService?: CourseGenerationTaskService;
};

/**
 * 默认后台任务服务必须跨 Next dev HMR 保持同一实例；否则旧模块中的 runner
 * 仍会执行，而新 route 会创建另一份 activeTasks/courseClaims 并发写同一课程。
 * 测试与定制调用继续使用 factory，彼此保持隔离。
 */
export const courseGenerationTaskService =
  (globalCourseGenerationTaskService.__keyaCourseGenerationTaskService ??=
    createCourseGenerationTaskService());
