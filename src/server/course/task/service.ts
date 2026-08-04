import {
  AiRequestError,
  createTraceId,
  toAiErrorPayload,
} from "@/server/infra/ai/error";
import {
  cancelCourseGenerationRun,
  isCourseRunLeaseUnavailableError,
  runCourseGeneration,
} from "@/server/course/run/engine";
import { loadCourseGenerationState } from "@/server/course/run/state-loader";
import {
  createCourseStore,
  type CourseStore,
} from "@/server/course/store/course";
import {
  createCourseTaskStore,
  type CourseTaskStore,
} from "@/server/course/store/task";
import {
  createCourseTaskEventBus,
  type CourseTaskEventBus,
} from "@/server/course/task/event-bus";
import {
  CourseTaskCreateInputSchema,
  type CourseGenerationTaskService,
} from "@/server/course/task/input";
import {
  cancelCourseGenerationTask,
  countCompletedPages,
  createPageFailureLogEntry,
  createPersistedTaskExecutionGuard,
  createTaskLogEntry,
  createTerminalCourseState,
  createTerminalTaskRecord,
  defaultCourseGenerationLogSink,
  durationBetween,
  isCourseTerminalStatus,
  isTerminalStatus,
  publishTaskSnapshot,
  reconcileCourseGenerationTaskTerminal,
  resolveTotalPages,
  shouldPublishSnapshot,
  toCourseGenerationCauseCode,
  type CourseGenerationLogSink,
} from "@/server/course/task/support";
import {
  CourseTaskCreateResponseSchema,
  CourseTaskIdSchema,
  CourseTaskRecordSchema,
  type CourseGenerationState,
  type CourseTaskRecord,
} from "@/shared/course-schema";

export type { CourseGenerationTaskService };

export type {
  CourseGenerationLogEntry,
  CourseGenerationLogSink,
} from "@/server/course/task/support";

type CourseGenerationTaskServiceDependencies = {
  taskStore: CourseTaskStore;
  courseStore: CourseStore;
  eventBus: CourseTaskEventBus;
  runCourse: typeof runCourseGeneration;
  cancelCourseRun: typeof cancelCourseGenerationRun;
  loadCourseState: typeof loadCourseGenerationState;
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

const defaultDependencies: CourseGenerationTaskServiceDependencies = {
  taskStore: createCourseTaskStore(),
  courseStore: createCourseStore(),
  eventBus: createCourseTaskEventBus(),
  runCourse: runCourseGeneration,
  cancelCourseRun: cancelCourseGenerationRun,
  loadCourseState: loadCourseGenerationState,
  now: () => new Date().toISOString(),
  createTaskId: () => `task-${crypto.randomUUID()}`,
  createCourseId: () => `course-${crypto.randomUUID()}`,
  createTraceId,
  logSink: defaultCourseGenerationLogSink,
};

/**
 * 课程生成任务生命周期所有者。EventSource 只订阅；只有本服务持有的
 * AbortController 才能停止实际的课程生成运行。
 */
export function createCourseGenerationTaskService(
  overrides: Partial<CourseGenerationTaskServiceDependencies> = {},
): CourseGenerationTaskService {
  const dependencies = { ...defaultDependencies, ...overrides };
  const activeTasks = new Map<string, ActiveTask>();

  const assertCourseIsAvailable = async (
    courseId: string,
    taskId: string,
    blockingStatuses: ReadonlySet<CourseTaskRecord["status"]>,
  ) => {
    const durableClaimedTaskId =
      await dependencies.taskStore.loadCourseClaim(courseId);
    if (durableClaimedTaskId && durableClaimedTaskId !== taskId) {
      throw new AiRequestError(
        `课程 ${courseId} 已由任务 ${durableClaimedTaskId} 持有执行权，请先暂停或等待该任务完成。`,
      );
    }
    const { items } = await dependencies.taskStore.list();
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
      const creationBrief = parsed.data.creationBrief;

      if (!userPrompt) {
        throw new AiRequestError(`找不到课程 ${courseId} 的可恢复检查点。`);
      }
      if (!creationBrief) {
        throw new AiRequestError("课程任务必须提供结构化 creationBrief");
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
      const pageCount =
        existingState?.intent?.courseLength ?? parsed.data.pageCount;
      const referencePacks =
        existingState?.referencePacks ?? parsed.data.referencePacks;
      const record = CourseTaskRecordSchema.parse({
        taskId,
        courseId,
        traceId,
        userPrompt,
        creationBrief,
        referencePacks,
        pageCount,
        executionMode:
          existingState?.workerConfig?.mode ?? parsed.data.executionMode,
        concurrency:
          existingState?.workerConfig?.concurrency ?? parsed.data.concurrency,
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await assertCourseIsAvailable(
        courseId,
        taskId,
        new Set(["queued", "running", "paused"]),
      );
      const created = await dependencies.taskStore.save(record, {
        expected: undefined,
      });
      if (!created) {
        const ownerTaskId =
          await dependencies.taskStore.loadCourseClaim(courseId);
        throw new AiRequestError(
          ownerTaskId && ownerTaskId !== taskId
            ? `课程 ${courseId} 已由任务 ${ownerTaskId} 持有执行权，不能并发创建另一任务。`
            : `课程任务 ${taskId} 已存在，不能重复创建。`,
        );
      }
      return CourseTaskCreateResponseSchema.parse({
        taskId,
        courseId,
        traceId,
        status: "queued",
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
          return record
            ? dependencies.courseStore.load(record.courseId)
            : undefined;
        }

        await assertCourseIsAvailable(
          record.courseId,
          safeTaskId,
          new Set(["running"]),
        );
        return executeTask(
          safeTaskId,
          controller,
          dependencies,
          () => active.stopIntent,
        );
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
        return record;
      }
      if (active) active.stopIntent = "pause";

      let pauseExpected = record;
      let paused: CourseTaskRecord | undefined;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = CourseTaskRecordSchema.parse({
          ...pauseExpected,
          status: "paused",
          updatedAt: dependencies.now(),
          completedAt: undefined,
          error: undefined,
        });
        if (
          await dependencies.taskStore.save(candidate, {
            expected: pauseExpected,
          })
        ) {
          paused = candidate;
          break;
        }
        const latest = await dependencies.taskStore.load(safeTaskId);
        if (
          !latest ||
          isTerminalStatus(latest.status) ||
          latest.status === "paused" ||
          latest.traceId !== record.traceId
        ) {
          return latest;
        }
        pauseExpected = latest;
      }
      if (!paused) return dependencies.taskStore.load(safeTaskId);

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

      const reconciled = await reconcileTaskTerminal(
        safeTaskId,
        dependencies,
      );
      if (!reconciled || isTerminalStatus(reconciled.status)) return reconciled;

      const settled = await dependencies.taskStore.load(safeTaskId);
      if (!settled || isTerminalStatus(settled.status)) return settled;
      if (settled.status === "paused") {
        return settled;
      }

      // 覆盖 run() 刚读取 queued、随后才尝试写 running 的窄竞态。
      const repaused = CourseTaskRecordSchema.parse({
        ...settled,
        status: "paused",
        updatedAt: dependencies.now(),
        completedAt: undefined,
        error: undefined,
      });
      if (
        !(await dependencies.taskStore.save(repaused, {
          expected: settled,
        }))
      ) {
        return dependencies.taskStore.load(safeTaskId);
      }
      return repaused;
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
        return resumable;
      }
      if (resumable.status !== "paused") {
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
      const resumed = await dependencies.taskStore.save(queued, {
        expected: resumable,
      });
      if (!resumed) {
        return dependencies.taskStore.load(safeTaskId);
      }

      const state = await dependencies.courseStore.load(queued.courseId);
      if (state && !isCourseTerminalStatus(state.status)) {
        publishTaskSnapshot(dependencies.eventBus, queued, state);
      }
      return queued;
    },

    async cancel(taskId) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const active = activeTasks.get(safeTaskId);
      return cancelCourseGenerationTask({
        taskId: safeTaskId,
        taskStore: dependencies.taskStore,
        courseStore: dependencies.courseStore,
        eventBus: dependencies.eventBus,
        cancelCourseRun: dependencies.cancelCourseRun,
        now: dependencies.now,
        onCancellationWon: () => {
          if (active) active.stopIntent = "cancel";
        },
        abortRunner: () => active?.controller.abort(),
      });
    },

    reconcile(taskId) {
      return reconcileTaskTerminal(
        CourseTaskIdSchema.parse(taskId),
        dependencies,
      );
    },

    load(taskId) {
      return dependencies.taskStore.load(CourseTaskIdSchema.parse(taskId));
    },
  };
}

function reconcileTaskTerminal(
  taskId: string,
  dependencies: CourseGenerationTaskServiceDependencies,
) {
  return reconcileCourseGenerationTaskTerminal({
    taskId,
    taskStore: dependencies.taskStore,
    courseStore: dependencies.courseStore,
    eventBus: dependencies.eventBus,
    loadAuthoritativeState: (record) =>
      dependencies.loadCourseState({
        taskId: record.taskId,
        courseId: record.courseId,
        traceId: record.traceId,
        creationBrief: record.creationBrief,
        referencePacks: record.referencePacks,
        concurrency: record.concurrency,
      }),
    now: dependencies.now,
  });
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
    if (
      !(await dependencies.taskStore.save(running, {
        expected: queued,
      }))
    ) {
      return dependencies.courseStore.load(running.courseId);
    }
    if (stopIntent() === "pause") {
      const paused = CourseTaskRecordSchema.parse({
        ...running,
        status: "paused",
        updatedAt: dependencies.now(),
        completedAt: undefined,
        error: undefined,
      });
      await dependencies.taskStore.save(paused, {
        expected: running,
      });
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
      existingState?.traceId === running.traceId
        ? (existingState.events.at(-1)?.sequence ?? 0)
        : 0;
    let sentSnapshot = false;
    let publishedPageStructure = "";
    const persistCheckpoint = async (checkpoint: CourseGenerationState) => {
      const [currentTask, currentCourseState] = await Promise.all([
        dependencies.taskStore.load(running.taskId),
        dependencies.courseStore.load(running.courseId),
      ]);
      if (
        checkpoint.courseId !== running.courseId ||
        checkpoint.traceId !== running.traceId
      ) {
        controller.abort(
          new DOMException("课程运行时返回了其他 trace 的检查点。", "AbortError"),
        );
        throw new DOMException(
          "课程运行时返回了其他 trace 的检查点。",
          "AbortError",
        );
      }
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
      const saved = await dependencies.courseStore.save(checkpoint, {
        expected: currentCourseState,
        taskFence: {
          taskId: running.taskId,
          traceId: running.traceId,
          statuses: ["running"],
        },
      });
      if (!saved) {
        controller.abort(
          new DOMException("课程检查点写入围栏已失效。", "AbortError"),
        );
        throw new DOMException(
          "课程检查点写入围栏已失效。",
          "AbortError",
        );
      }
      logPageFailures(checkpoint);
    };
    const publishCheckpoint = (checkpoint: CourseGenerationState) => {
      const newEvents = checkpoint.events.filter(
        (event) =>
          event.sequence > lastPublishedSequence &&
          event.traceId === running.traceId,
      );
      const nextPageStructure = checkpoint.pages
        .map(({ pageId, order }) => `${order}:${pageId}`)
        .join("|");
      const publishSnapshot = () => {
        dependencies.eventBus.publish({
          type: "snapshot",
          taskId: running.taskId,
          courseId: running.courseId,
          state: checkpoint,
        });
        sentSnapshot = true;
        publishedPageStructure = nextPageStructure;
      };

      // Architecture 被接受时页面集合会从空变为完整计划。必须先发送包含
      // 新页面结构的快照，否则紧随其后的页面事件无法合并到旧客户端状态。
      if (
        !sentSnapshot ||
        nextPageStructure !== publishedPageStructure
      ) {
        publishSnapshot();
      } else {
        for (const event of newEvents) {
          dependencies.eventBus.publish({
            type: "event",
            taskId: running.taskId,
            courseId: running.courseId,
            event,
          });
        }

        if (shouldPublishSnapshot(newEvents)) {
          publishSnapshot();
        }
      }

      lastPublishedSequence = Math.max(
        lastPublishedSequence,
        checkpoint.events.at(-1)?.sequence ?? 0,
      );
    };
    const agentInput = {
      taskId: running.taskId,
      courseId: running.courseId,
      traceId: running.traceId,
      creationBrief: running.creationBrief,
      referencePacks: running.referencePacks,
      concurrency: running.concurrency,
    };
    const runtimeContext = {
      abortSignal: controller.signal,
      assertExecutionActive: createPersistedTaskExecutionGuard({
        controller,
        taskId: running.taskId,
        taskStore: dependencies.taskStore,
        traceId: running.traceId,
      }),
    };
    const state = await dependencies.runCourse(
      agentInput,
      runtimeContext,
      {
        checkpoint: async (checkpoint) => {
          await persistCheckpoint(checkpoint);
          publishCheckpoint(checkpoint);
        },
      },
    );
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
    await persistCheckpoint(state);
    publishCheckpoint(state);
    logPageFailures(state, true);
    const completedAt = dependencies.now();
    const terminalRecord = createTerminalTaskRecord(
      latestTask,
      state as CourseGenerationState & {
        status: "completed" | "failed" | "cancelled";
      },
      completedAt,
    );

    if (
      !(await dependencies.taskStore.save(terminalRecord, {
        expected: latestTask,
      }))
    ) {
      return dependencies.courseStore.load(running.courseId);
    }
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
    // 多进程 after()/恢复 worker 可能同时看到同一 queued/running 任务。
    // CourseRun lease 的输家只退出，不能把仍由赢家执行的课程误标为失败。
    if (isCourseRunLeaseUnavailableError(error)) {
      if (
        error.reason === "trace_adoption_blocked" &&
        currentTask?.status === "running" &&
        currentTask.traceId === running.traceId
      ) {
        const retryable = CourseTaskRecordSchema.parse({
          ...currentTask,
          status: "queued",
          updatedAt: dependencies.now(),
          completedAt: undefined,
          error: undefined,
        });
        await dependencies.taskStore.save(retryable, {
          expected: currentTask,
        });
      }
      return currentState;
    }
    if (!currentTask || isTerminalStatus(currentTask.status)) {
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
      status: controller.signal.aborted ? "cancelled" : "failed",
    });

    const status = controller.signal.aborted ? "cancelled" : "failed";
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
      currentTask,
      terminalState,
      completedAt,
    );

    if (
      terminalState !== currentState &&
      !(await dependencies.courseStore.save(terminalState, {
        expected: currentState,
        taskFence: {
          taskId: running.taskId,
          traceId: running.traceId,
          statuses: ["running"],
        },
      }))
    ) {
      return dependencies.courseStore.load(running.courseId);
    }
    if (
      !(await dependencies.taskStore.save(terminalRecord, {
        expected: currentTask,
      }))
    ) {
      return dependencies.courseStore.load(running.courseId);
    }
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
      status: terminalState.status,
      state: terminalState,
    });

    if (status === "cancelled") return terminalState;
    throw error;
  }
}
