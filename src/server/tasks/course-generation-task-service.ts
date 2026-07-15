import { z } from "zod";

import { AiRequestError, createTraceId } from "@/server/ai/error";
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
  CourseTaskCreateResponseSchema,
  CourseTaskIdSchema,
  CourseTaskRecordSchema,
  CourseGenerationStateSchema,
  type CourseGenerationState,
  type CourseTaskCreateResponse,
  type CourseTaskRecord,
} from "@/shared/course-schema";

const CourseTaskCreateInputSchema = z
  .object({
    courseId: CourseIdSchema.optional(),
    userPrompt: z.string().trim().min(2).max(4_000).optional(),
    pageCount: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
    traceId: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.courseId || value.userPrompt), {
    message: "userPrompt 或 courseId 至少提供一个",
  });

export type CourseTaskCreateInput = z.input<
  typeof CourseTaskCreateInputSchema
>;

export type CourseGenerationTaskService = {
  create(input: unknown): Promise<CourseTaskCreateResponse>;
  run(taskId: string): Promise<CourseGenerationState | undefined>;
  cancel(taskId: string): Promise<CourseTaskRecord | undefined>;
  load(taskId: string): Promise<CourseTaskRecord | undefined>;
};

type CourseGenerationTaskServiceDependencies = {
  taskStore: CourseTaskStore;
  courseStore: CourseStore;
  eventBus: CourseTaskEventBus;
  runWorkflow: typeof runCourseGenerationWorkflow;
  now(): string;
  createTaskId(): string;
  createCourseId(): string;
  createTraceId(): string;
};

type ActiveTask = {
  controller: AbortController;
  promise: Promise<CourseGenerationState | undefined>;
};

const defaultDependencies: CourseGenerationTaskServiceDependencies = {
  taskStore: createCourseTaskStore(),
  courseStore: createCourseStore(),
  eventBus: courseTaskEventBus,
  runWorkflow: runCourseGenerationWorkflow,
  now: () => new Date().toISOString(),
  createTaskId: () => `task-${crypto.randomUUID()}`,
  createCourseId: () => `course-${crypto.randomUUID()}`,
  createTraceId,
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
        existingState?.intent &&
        !isMvpPageCount(existingState.intent.courseLength)
      ) {
        throw new AiRequestError("持久化课程的页面数量不属于 Day 19 的 3–5 页范围。");
      }
      if (
        existingState?.intent &&
        parsed.data.pageCount &&
        parsed.data.pageCount !== existingState.intent.courseLength
      ) {
        throw new AiRequestError("恢复课程时不能更改已确定的页面数量。");
      }

      const timestamp = dependencies.now();
      const taskId = CourseTaskIdSchema.parse(dependencies.createTaskId());
      const traceId = parsed.data.traceId ?? dependencies.createTraceId();
      const pageCount = existingState?.intent
        ? (existingState.intent.courseLength as CourseMvpPageCount)
        : parsed.data.pageCount;
      const record = CourseTaskRecordSchema.parse({
        version: 1,
        taskId,
        courseId,
        traceId,
        userPrompt,
        pageCount,
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await dependencies.taskStore.save(record);
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
      const promise = executeTask(
        safeTaskId,
        controller,
        dependencies,
      ).finally(() => {
        if (activeTasks.get(safeTaskId)?.promise === promise) {
          activeTasks.delete(safeTaskId);
        }
      });

      activeTasks.set(safeTaskId, { controller, promise });
      return promise;
    },

    async cancel(taskId) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const record = await dependencies.taskStore.load(safeTaskId);
      if (!record || isTerminalStatus(record.status)) return record;

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
      activeTasks.get(safeTaskId)?.controller.abort();
      dependencies.eventBus.publish({
        type: "terminal",
        taskId: cancelled.taskId,
        courseId: cancelled.courseId,
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
) {
  const queued = await dependencies.taskStore.load(taskId);
  if (!queued || isTerminalStatus(queued.status)) {
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

    const existingState = await dependencies.courseStore.load(running.courseId);
    let lastPublishedSequence = existingState?.events.length ?? 0;
    let sentSnapshot = false;

    const state = await dependencies.runWorkflow(
      {
        courseId: running.courseId,
        userPrompt: running.userPrompt,
        pageCount: running.pageCount,
        existingState,
      },
      { abortSignal: controller.signal, traceId: running.traceId },
      {
        checkpoint: async (checkpoint) => {
          const currentTask = await dependencies.taskStore.load(running.taskId);
          if (
            currentTask?.status === "cancelled" &&
            checkpoint.status !== "cancelled"
          ) {
            controller.abort();
            throw new Error("课程任务已取消。");
          }

          await dependencies.courseStore.save(checkpoint);
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
              state: checkpoint,
            });
            sentSnapshot = true;
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
              dependencies.eventBus.publish({
                type: "snapshot",
                taskId: running.taskId,
                courseId: running.courseId,
                state: checkpoint,
              });
            }
          }

          lastPublishedSequence = checkpoint.events.length;
        },
      },
    );
    if (!isCourseTerminalStatus(state.status)) {
      throw new Error("课程工作流返回了非终态结果。");
    }
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
                message: state.errors.at(-1)!.message,
              }
            : {
                code: "COURSE_TASK_INCOMPLETE",
                message: "课程任务未完成。",
              }
          : undefined,
    });

    await dependencies.taskStore.save(terminalRecord);
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
    const message =
      error instanceof Error ? error.message : "课程任务执行失败。";
    const currentTask = await dependencies.taskStore.load(running.taskId);
    const currentState = await dependencies.courseStore.load(running.courseId);

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
        message: status === "cancelled" ? "课程生成已取消。" : message,
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
          ? { code: latestError.code, message: latestError.message }
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
  error: { code: string; message: string },
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
                error: { code: error.code, message: error.message },
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
      (type === "agent_done" &&
        (stage === "intent" || stage === "planner" || stage === "design")),
  );
}

function isTerminalStatus(status: CourseTaskRecord["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isCourseTerminalStatus(
  status: CourseGenerationState["status"],
): status is "completed" | "failed" | "cancelled" {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isMvpPageCount(value: number): value is CourseMvpPageCount {
  return value === 3 || value === 4 || value === 5;
}

export const courseGenerationTaskService =
  createCourseGenerationTaskService();
