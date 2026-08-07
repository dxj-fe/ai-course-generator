import { vi } from "vitest";

import type {
  cancelCourseGenerationRun,
  runCourseGeneration,
} from "../../../../src/server/course/run/engine";
import type { loadCourseGenerationState } from "../../../../src/server/course/run/state-loader";
import type {
  CourseStore,
} from "../../../../src/server/course/store/course";
import type {
  CourseTaskStore,
} from "../../../../src/server/course/store/task";
import {
  createCourseTaskEventBus,
  type CourseTaskEventBus,
} from "../../../../src/server/course/task/event-bus";
import {
  createCourseGenerationTaskService,
  type CourseGenerationLogEntry,
  type CourseGenerationLogSink,
} from "../../../../src/server/course/task/service";
import type {
  CourseGenerationState,
  CourseTaskRecord,
} from "../../../../src/shared/course-schema";

export const timestamp = "2026-07-15T06:00:00.000Z";
export const taskId = "task-fixture-19-service";
export const courseId = "course-fixture-19-service";
export const traceId = "trace-fixture-19-service";
export const creationBrief = {
  originalRequest: "生成三页太阳系互动课程",
  topic: "太阳系",
  audience: "初学者",
  goal: "理解太阳系结构",
  sectionCount: 3,
  learningMode: "mixed" as const,
  language: "zh-CN" as const,
};
export const agentTaskInput = {
  creationBrief,
};

export function createTaskServiceFixture(
  overrides: {
    runCourse?: typeof runCourseGeneration;
    cancelCourseRun?: typeof cancelCourseGenerationRun;
    loadCourseState?: typeof loadCourseGenerationState;
    logSink?: CourseGenerationLogSink;
    eventBus?: CourseTaskEventBus;
    createTaskId?: () => string;
    createCourseId?: () => string;
    createTraceId?: () => string;
    ensureRuntimeReady?: () => PromiseLike<unknown>;
  } = {},
) {
  const tasks = new Map<string, CourseTaskRecord>();
  const courses = new Map<string, CourseGenerationState>();
  const controlIntents = new Map<
    string,
    {
      action: "cancel";
      courseId: string;
      taskId: string;
      traceId: string;
      requestedAt: string;
    }
  >();
  const taskStore: CourseTaskStore = {
    list: async () => ({ items: [...tasks.values()], unavailableCount: 0 }),
    async load(id) {
      return tasks.get(id);
    },
    async loadCourseClaim(requestedCourseId) {
      return [...tasks.values()].find(
        (task) =>
          task.courseId === requestedCourseId &&
          (task.status === "queued" ||
            task.status === "running" ||
            task.status === "paused"),
      )?.taskId;
    },
    async loadControlIntent(id) {
      return controlIntents.get(id);
    },
    async requestCancel(id, requestedAt) {
      const current = tasks.get(id);
      if (
        current &&
        (current.status === "queued" ||
          current.status === "running" ||
          current.status === "paused")
      ) {
        controlIntents.set(id, {
          action: "cancel",
          courseId: current.courseId,
          taskId: current.taskId,
          traceId: current.traceId,
          requestedAt,
        });
      }
      return current;
    },
    async save(record, condition) {
      const current = tasks.get(record.taskId);
      const controlIntent = controlIntents.get(record.taskId);
      if (
        condition.expected === undefined
          ? current !== undefined
          : JSON.stringify(current) !== JSON.stringify(condition.expected)
      ) {
        return false;
      }
      if (
        controlIntent &&
        (condition.controlIntent !== controlIntent.action ||
          !isTerminalTaskStatus(record.status))
      ) {
        return false;
      }
      if (condition.controlIntent && !controlIntent) return false;
      tasks.set(record.taskId, structuredClone(record));
      if (condition.controlIntent) controlIntents.delete(record.taskId);
      return true;
    },
  };
  const courseStore: CourseStore = {
    list: async () => ({ items: [...courses.values()], unavailableCount: 0 }),
    async load(id) {
      return courses.get(id);
    },
    async save(state, condition) {
      const current = courses.get(state.courseId);
      if (
        condition.expected === undefined
          ? current !== undefined
          : JSON.stringify(current) !== JSON.stringify(condition.expected)
      ) {
        return false;
      }
      if (condition.taskFence) {
        const task = tasks.get(condition.taskFence.taskId);
        const intent = controlIntents.get(condition.taskFence.taskId);
        if (
          !task ||
          task.courseId !== state.courseId ||
          task.traceId !== condition.taskFence.traceId ||
          !condition.taskFence.statuses.includes(task.status) ||
          (condition.taskFence.controlIntent === "cancel"
            ? intent?.action !== "cancel"
            : intent !== undefined)
        ) {
          return false;
        }
      }
      courses.set(state.courseId, structuredClone(state));
      return true;
    },
  };
  const eventBus = overrides.eventBus ?? createCourseTaskEventBus();
  const runCourse =
    overrides.runCourse ??
    (vi.fn(async () => {
      throw new Error("runCourse should not have been called");
    }) as typeof runCourseGeneration);
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
    runCourse,
    cancelCourseRun: overrides.cancelCourseRun ?? (() => undefined),
    loadCourseState: overrides.loadCourseState ?? (() => undefined),
    now: () => timestamp,
    createTaskId: overrides.createTaskId ?? (() => taskId),
    createCourseId: overrides.createCourseId ?? (() => courseId),
    createTraceId: overrides.createTraceId ?? (() => traceId),
    logSink,
    ensureRuntimeReady:
      overrides.ensureRuntimeReady ?? (async () => undefined),
  });

  return {
    service,
    taskStore,
    courseStore,
    eventBus,
    runCourse,
    tasks,
    courses,
    infoLogs,
    errorLogs,
  };
}

export function createSilentEventBus(): CourseTaskEventBus {
  return {
    publish: () => undefined,
    subscribe: () => () => undefined,
  };
}

export function courseState(
  status: "running" | "failed",
  eventCount: number,
): CourseGenerationState {
  return {
    courseId,
    traceId,
    userPrompt: "生成五页太阳系互动课程",
    status,
    currentStage: "planner",
    pages: [],
    events: Array.from({ length: eventCount }, (_, index) => ({
      id: `event-fixture-30-${index + 1}`,
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

export function runningCheckpoint(
  checkpointCourseId: string,
  checkpointTraceId: string,
  userPrompt: string,
): CourseGenerationState {
  return {
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

function isTerminalTaskStatus(status: CourseTaskRecord["status"]) {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}
