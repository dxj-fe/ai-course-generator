import type { cancelCourseGenerationRun } from "@/server/course/run/engine";
import type { CourseStore } from "@/server/course/store/course";
import type {
  CourseTaskControlIntent,
  CourseTaskStore,
} from "@/server/course/store/task";
import type { CourseTaskEventBus } from "@/server/course/task/event-bus";
import {
  CourseGenerationStateSchema,
  CourseTaskRecordSchema,
  type CourseGenerationCauseCode,
  type CourseGenerationState,
  type CourseTaskRecord,
  type PageGenerationState,
} from "@/shared/course-schema";

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
  status?: CourseTaskRecord["status"];
};

export type CourseGenerationLogSink = {
  info(entry: CourseGenerationLogEntry): void;
  error(entry: CourseGenerationLogEntry): void;
};

export const defaultCourseGenerationLogSink: CourseGenerationLogSink = {
  info: (entry) => console.info("[course-task]", entry),
  error: (entry) => console.error("[course-task]", entry),
};

/** 每个 Engine/Agent 边界都从 TaskStore 重读控制态，不依赖进程内 Map。 */
export function createPersistedTaskExecutionGuard(input: {
  controller: AbortController;
  taskId: string;
  taskStore: Pick<CourseTaskStore, "load" | "loadControlIntent">;
  traceId: string;
}) {
  return async () => {
    const [currentTask, controlIntent] = await Promise.all([
      input.taskStore.load(input.taskId),
      input.taskStore.loadControlIntent(input.taskId),
    ]);
    if (
      !controlIntent &&
      currentTask?.status === "running" &&
      currentTask.traceId === input.traceId
    ) {
      return;
    }
    const reason =
      controlIntent?.action === "cancel"
        ? "课程生成已取消。"
        : currentTask?.status === "paused"
        ? "课程生成已暂停。"
        : currentTask?.status === "cancelled"
          ? "课程生成已取消。"
          : "课程任务执行权已变更。";
    const error = new DOMException(reason, "AbortError");
    input.controller.abort(error);
    throw error;
  };
}

/**
 * 控制面先提交课程终态、再提交 TaskRecord 终态。每次课程写入都同时核对
 * TaskRecord 的 trace/status，旧 runner 无法在两次写入之间复活 running。
 */
export async function persistControlTerminalState(input: {
  courseStore: CourseStore;
  taskStore: CourseTaskStore;
  desiredState: CourseGenerationState & {
    status: "completed" | "failed" | "cancelled";
  };
  initialCourseState: CourseGenerationState | undefined;
  initialTask: CourseTaskRecord;
}) {
  let currentState = input.initialCourseState;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (currentState && isCourseTerminalStatus(currentState.status)) {
      if (
        currentState.traceId === input.desiredState.traceId &&
        currentState.status === input.desiredState.status
      ) {
        return currentState as CourseGenerationState & {
          status: "completed" | "failed" | "cancelled";
        };
      }
      // cancel intent 已在 TaskStore 写锁内固定当前 task/trace。已有终态可能
      // 属于上一 attempt，或是当前 CourseRun 终态投影前的兜底状态；两者都
      // 必须由本次权威 desiredState 通过 CAS 对齐。
    }

    const saved = await input.courseStore.save(input.desiredState, {
      expected: currentState,
      taskFence: {
        taskId: input.initialTask.taskId,
        traceId: input.initialTask.traceId,
        statuses: ["queued", "running", "paused"],
        controlIntent: "cancel",
      },
    });
    if (saved) return input.desiredState;

    const [latestTask, latestState] = await Promise.all([
      input.taskStore.load(input.initialTask.taskId),
      input.courseStore.load(input.initialTask.courseId),
    ]);
    if (
      latestTask?.traceId !== input.initialTask.traceId ||
      (latestTask && isTerminalStatus(latestTask.status))
    ) {
      if (
        latestState &&
        isCourseTerminalStatus(latestState.status) &&
        latestTask &&
        isTerminalStatus(latestTask.status) &&
        latestState.traceId === latestTask.traceId &&
        latestState.status === latestTask.status
      ) {
        return latestState as CourseGenerationState & {
          status: "completed" | "failed" | "cancelled";
        };
      }
      throw new Error("课程终态写入时任务控制权已变更");
    }
    currentState = latestState;
  }

  throw new Error("课程终态写入发生连续并发冲突");
}

/**
 * 把当前 taskId 的权威 CourseRun 终态对齐到 CourseStore/TaskStore。
 * 没有终态 CourseRun 时，只接受与 Task 同 trace 的 CourseStore 终态，避免
 * 同 courseId 的新 attempt 误继承上一任务结果。
 */
export async function reconcileCourseGenerationTaskTerminal(input: {
  taskId: string;
  taskStore: CourseTaskStore;
  courseStore: CourseStore;
  eventBus: CourseTaskEventBus;
  loadAuthoritativeState(
    record: CourseTaskRecord,
  ): CourseGenerationState | undefined | PromiseLike<CourseGenerationState | undefined>;
  now(): string;
}) {
  let currentTask = await input.taskStore.load(input.taskId);
  if (!currentTask || isTerminalStatus(currentTask.status)) return currentTask;

  const authoritativeState = await input.loadAuthoritativeState(currentTask);
  const initialCourseState = await input.courseStore.load(currentTask.courseId);
  const desiredState =
    authoritativeState && isCourseTerminalStatus(authoritativeState.status)
      ? authoritativeState
      : initialCourseState &&
          initialCourseState.traceId === currentTask.traceId &&
          isCourseTerminalStatus(initialCourseState.status)
        ? initialCourseState
        : undefined;
  if (!desiredState) return currentTask;

  const terminalState = desiredState as CourseGenerationState & {
    status: "completed" | "failed" | "cancelled";
  };
  let currentCourseState = initialCourseState;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (JSON.stringify(currentCourseState) === JSON.stringify(terminalState)) {
      break;
    }
    const saved = await input.courseStore.save(terminalState, {
      expected: currentCourseState,
      taskFence: {
        taskId: currentTask.taskId,
        traceId: currentTask.traceId,
        statuses: ["queued", "running", "paused"],
      },
    });
    if (saved) {
      currentCourseState = terminalState;
      break;
    }
    const [latestTask, latestState, controlIntent]: [
      CourseTaskRecord | undefined,
      CourseGenerationState | undefined,
      CourseTaskControlIntent | undefined,
    ] = await Promise.all([
      input.taskStore.load(currentTask.taskId),
      input.courseStore.load(currentTask.courseId),
      input.taskStore.loadControlIntent(currentTask.taskId),
    ]);
    if (
      !latestTask ||
      isTerminalStatus(latestTask.status) ||
      latestTask.traceId !== currentTask.traceId ||
      controlIntent
    ) {
      return latestTask;
    }
    currentTask = latestTask;
    currentCourseState = latestState;
  }
  if (JSON.stringify(currentCourseState) !== JSON.stringify(terminalState)) {
    throw new Error("课程终态对齐发生连续并发冲突");
  }

  const terminalTask = createTerminalTaskRecord(
    currentTask,
    terminalState,
    input.now(),
  );
  if (
    !(await input.taskStore.save(terminalTask, {
      expected: currentTask,
    }))
  ) {
    return input.taskStore.load(currentTask.taskId);
  }
  input.eventBus.publish({
    type: "terminal",
    taskId: terminalTask.taskId,
    courseId: terminalTask.courseId,
    status: terminalState.status,
    state: terminalState,
  });
  return terminalTask;
}

export async function cancelCourseGenerationTask(input: {
  taskId: string;
  taskStore: CourseTaskStore;
  courseStore: CourseStore;
  eventBus: CourseTaskEventBus;
  cancelCourseRun: typeof cancelCourseGenerationRun;
  now(): string;
  onCancellationWon(): void;
  abortRunner(): void;
}) {
  const initialRecord = await input.taskStore.load(input.taskId);
  if (!initialRecord || isTerminalStatus(initialRecord.status)) {
    return initialRecord;
  }
  const timestamp = input.now();
  const record = await input.taskStore.requestCancel(
    input.taskId,
    timestamp,
  );
  if (!record || isTerminalStatus(record.status)) return record;

  const authoritativeState = input.cancelCourseRun({
    taskId: record.taskId,
    courseId: record.courseId,
    traceId: record.traceId,
    creationBrief: record.creationBrief,
    referencePacks: record.referencePacks,
    concurrency: record.concurrency,
    now: timestamp,
  });
  const persistedState = await input.courseStore.load(record.courseId);
  const cancellationWon =
    !authoritativeState || authoritativeState.status === "cancelled";
  if (cancellationWon) input.onCancellationWon();
  const state =
    authoritativeState ??
    createTerminalCourseState(
      record,
      persistedState,
      "cancelled",
      timestamp,
      {
        code: "COURSE_TASK_CANCELLED",
        message: "课程生成已取消。",
      },
    );
  if (!isCourseTerminalStatus(state.status)) {
    throw new Error("取消 CourseRun 后得到非终态投影");
  }
  const terminalState = state as CourseGenerationState & {
    status: "completed" | "failed" | "cancelled";
  };
  const persistedTerminalState = await persistControlTerminalState({
    courseStore: input.courseStore,
    taskStore: input.taskStore,
    desiredState: terminalState,
    initialCourseState: persistedState,
    initialTask: record,
  });
  let cancellationExpected = record;
  let cancelled: CourseTaskRecord | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = createTerminalTaskRecord(
      cancellationExpected,
      persistedTerminalState,
      timestamp,
    );
    if (
      await input.taskStore.save(candidate, {
        expected: cancellationExpected,
        controlIntent: "cancel",
      })
    ) {
      cancelled = candidate;
      break;
    }
    const latest = await input.taskStore.load(input.taskId);
    if (
      !latest ||
      isTerminalStatus(latest.status) ||
      latest.traceId !== record.traceId
    ) {
      return latest;
    }
    cancellationExpected = latest;
  }
  if (!cancelled) return input.taskStore.load(input.taskId);
  if (cancellationWon) input.abortRunner();
  input.eventBus.publish({
    type: "terminal",
    taskId: cancelled.taskId,
    courseId: cancelled.courseId,
    status: persistedTerminalState.status,
    state: persistedTerminalState,
  });
  return cancelled;
}

export function createTaskLogEntry(
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
    status: overrides.status,
  };
}

export function createPageFailureLogEntry(
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

export function countCompletedPages(
  state: CourseGenerationState | undefined,
) {
  return state?.pages.filter(({ status }) => status === "completed").length ?? 0;
}

export function resolveTotalPages(
  record: CourseTaskRecord,
  state: CourseGenerationState | undefined,
) {
  return state?.intent?.courseLength ?? record.pageCount ?? state?.pages.length;
}

export function durationBetween(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

export function createTerminalTaskRecord(
  record: CourseTaskRecord,
  state: CourseGenerationState & {
    status: "completed" | "failed" | "cancelled";
  },
  timestamp: string,
) {
  const latestError = state.errors.at(-1);

  return CourseTaskRecordSchema.parse({
    ...record,
    // pause/resume 与 CourseRun 终态提交竞态时，数据库中已经完成的旧 trace
    // 是权威结果；不能让一次尚未真正执行的新 trace 覆盖它。
    traceId: state.traceId,
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

export function createTerminalCourseState(
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
  if (
    existingState &&
    existingState.traceId === record.traceId &&
    isCourseTerminalStatus(existingState.status)
  ) {
    return existingState as CourseGenerationState & {
      status: "completed" | "failed" | "cancelled";
    };
  }

  const reusableExistingState =
    existingState && isCourseTerminalStatus(existingState.status)
      ? undefined
      : existingState;
  const base: CourseGenerationState = reusableExistingState ?? {
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
            sequence: (base.events.at(-1)?.sequence ?? 0) + 1,
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

export function shouldPublishSnapshot(
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

export function publishTaskSnapshot(
  eventBus: CourseTaskEventBus,
  task: CourseTaskRecord,
  state: CourseGenerationState,
) {
  eventBus.publish({
    type: "snapshot",
    taskId: task.taskId,
    courseId: task.courseId,
    taskStatus: task.status,
    state,
  });
}

export function toCourseGenerationCauseCode(
  code: string,
): CourseGenerationCauseCode | undefined {
  if (
    code === "BROWSER_HARNESS_UNAVAILABLE" ||
    code === "SCREENSHOT_BROWSER_LAUNCH_FAILED" ||
    code === "SCREENSHOT_BROWSER_RUNTIME_FAILED"
  ) {
    return "RUNTIME_ERROR";
  }
  switch (code) {
    case "SCHEMA_ERROR":
    case "TIMEOUT_ERROR":
    case "RATE_LIMIT_ERROR":
    case "QUOTA_ERROR":
    case "AUTH_ERROR":
    case "CONFIG_ERROR":
    case "MODEL_ERROR":
    case "RUNTIME_ERROR":
      return code;
    default:
      return undefined;
  }
}

export function isTerminalStatus(status: CourseTaskRecord["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isCourseTerminalStatus(
  status: CourseGenerationState["status"],
): status is "completed" | "failed" | "cancelled" {
  return status === "completed" || status === "failed" || status === "cancelled";
}
