import { describe, expect, it, vi } from "vitest";

import {
  createCourseTaskRecoveryScanner,
} from "../../../../src/server/course/task/recovery";
import type {
  CourseRun,
  CourseTaskRecord,
} from "../../../../src/shared/course-schema";

const NOW = "2026-07-29T08:00:00.000Z";

describe("course task recovery scanner", () => {
  it("只领取 queued 和 lease 已失效的课程任务", async () => {
    const queued = task("task-recover-queued", "queued");
    const stale = task("task-recover-stale", "running");
    const active = task("task-recover-active", "running");
    const paused = task("task-recover-paused", "paused");
    const runs = new Map<string, CourseRun>([
      [
        stale.taskId,
        run(stale, {
          leaseOwner: "stale-worker",
          leaseExpiresAt: "2026-07-29T07:59:59.000Z",
        }),
      ],
      [
        active.taskId,
        run(active, {
          leaseOwner: "active-worker",
          leaseExpiresAt: "2026-07-29T08:10:00.000Z",
        }),
      ],
    ]);
    const runTask = vi.fn(async (taskId: string) => {
      void taskId;
    });
    const scanner = createCourseTaskRecoveryScanner({
      taskStore: {
        list: async () => ({
          items: [active, paused, queued, stale],
          unavailableCount: 1,
        }),
        loadControlIntent: async () => undefined,
      },
      runStore: {
        loadByTaskId: (taskId) => runs.get(taskId),
      },
      runTask,
      now: () => NOW,
    });

    const report = await scanner.scanOnce({ concurrency: 2 });

    expect(report).toEqual({
      scannedTaskCount: 4,
      unavailableTaskCount: 1,
      candidateTaskIds: [queued.taskId, stale.taskId],
      skippedActiveLeaseTaskIds: [active.taskId],
      processedTaskIds: [queued.taskId, stale.taskId],
      failures: [],
    });
    expect(runTask.mock.calls.map(([taskId]) => taskId)).toEqual([
      queued.taskId,
      stale.taskId,
    ]);
  });

  it("并发 scanOnce 复用同一批次，单个失败不阻止其他任务恢复", async () => {
    const first = task("task-recover-first", "queued");
    const second = task("task-recover-second", "running");
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runTask = vi.fn(async (taskId: string) => {
      if (taskId === first.taskId) {
        await firstGate;
        throw new Error("供应商暂时不可用");
      }
    });
    const scanner = createCourseTaskRecoveryScanner({
      taskStore: {
        list: async () => ({
          items: [first, second],
          unavailableCount: 0,
        }),
        loadControlIntent: async () => undefined,
      },
      runStore: { loadByTaskId: () => undefined },
      runTask,
      now: () => NOW,
    });

    const firstScan = scanner.scanOnce({ concurrency: 2 });
    const duplicateScan = scanner.scanOnce({ concurrency: 2 });
    expect(duplicateScan).toBe(firstScan);
    releaseFirst();

    const report = await firstScan;
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(report.processedTaskIds).toEqual([second.taskId]);
    expect(report.failures).toEqual([
      {
        taskId: first.taskId,
        message: "供应商暂时不可用",
      },
    ]);
  });

  it("终态 CourseRun 仍会被领取，用于补齐外层 TaskRecord 终态", async () => {
    const record = task("task-recover-terminal-run", "running");
    const runTask = vi.fn(async () => undefined);
    const scanner = createCourseTaskRecoveryScanner({
      taskStore: {
        list: async () => ({ items: [record], unavailableCount: 0 }),
        loadControlIntent: async () => undefined,
      },
      runStore: {
        loadByTaskId: () => run(record, { phase: "failed" }),
      },
      runTask,
      now: () => NOW,
    });

    const report = await scanner.scanOnce();

    expect(report.candidateTaskIds).toEqual([record.taskId]);
    expect(runTask).toHaveBeenCalledWith(record.taskId);
  });

  it("启动扫描会优先收口遗留 cancel intent，包括 paused 和仍持有旧 lease 的任务", async () => {
    const paused = task("task-recover-cancel-paused", "paused");
    const running = task("task-recover-cancel-running", "running");
    const cancelTask = vi.fn(async (taskId: string) => {
      void taskId;
    });
    const runTask = vi.fn(async () => undefined);
    const scanner = createCourseTaskRecoveryScanner({
      taskStore: {
        list: async () => ({
          items: [paused, running],
          unavailableCount: 0,
        }),
        loadControlIntent: async (taskId) => ({
          action: "cancel",
          taskId,
          courseId:
            taskId === paused.taskId ? paused.courseId : running.courseId,
          traceId:
            taskId === paused.taskId ? paused.traceId : running.traceId,
          requestedAt: NOW,
        }),
      },
      runStore: {
        loadByTaskId: (taskId) =>
          run(taskId === paused.taskId ? paused : running, {
            leaseOwner: "old-worker",
            leaseExpiresAt: "2026-07-29T08:10:00.000Z",
          }),
      },
      runTask,
      cancelTask,
      now: () => NOW,
    });

    const report = await scanner.scanOnce();

    expect(report.candidateTaskIds).toEqual([
      paused.taskId,
      running.taskId,
    ]);
    expect(report.skippedActiveLeaseTaskIds).toEqual([]);
    expect(cancelTask.mock.calls.map(([id]) => id)).toEqual([
      paused.taskId,
      running.taskId,
    ]);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("paused Task 已有终态 CourseRun 时走独立 reconcile，不套用 cancel", async () => {
    const paused = task("task-recover-paused-terminal", "paused");
    const reconcileTask = vi.fn(async () => undefined);
    const cancelTask = vi.fn(async () => undefined);
    const runTask = vi.fn(async () => undefined);
    const scanner = createCourseTaskRecoveryScanner({
      taskStore: {
        list: async () => ({
          items: [paused],
          unavailableCount: 0,
        }),
        loadControlIntent: async () => undefined,
      },
      runStore: {
        loadByTaskId: () =>
          run(paused, {
            phase: "failed",
            error: {
              code: "COURSE_RUN_FAILED",
              message: "CourseRun 已终态。",
            },
          }),
      },
      runTask,
      cancelTask,
      reconcileTask,
      now: () => NOW,
    });

    const report = await scanner.scanOnce();

    expect(report.candidateTaskIds).toEqual([paused.taskId]);
    expect(reconcileTask).toHaveBeenCalledWith(paused.taskId);
    expect(cancelTask).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });

  it("cancel intent 优先于更旧的普通任务，不会被 maxTasks 配额挤出", async () => {
    const ordinary = {
      ...task("task-recover-priority-run", "queued"),
      updatedAt: "2026-07-29T06:00:00.000Z",
    };
    const cancelling = {
      ...task("task-recover-priority-cancel", "running"),
      updatedAt: "2026-07-29T07:00:00.000Z",
    };
    const runTask = vi.fn(async () => undefined);
    const cancelTask = vi.fn(async () => undefined);
    const scanner = createCourseTaskRecoveryScanner({
      taskStore: {
        list: async () => ({
          items: [ordinary, cancelling],
          unavailableCount: 0,
        }),
        loadControlIntent: async (taskId) =>
          taskId === cancelling.taskId
            ? {
                action: "cancel",
                taskId,
                courseId: cancelling.courseId,
                traceId: cancelling.traceId,
                requestedAt: NOW,
              }
            : undefined,
      },
      runStore: { loadByTaskId: () => undefined },
      runTask,
      cancelTask,
      now: () => NOW,
    });

    const report = await scanner.scanOnce({ maxTasks: 1 });

    expect(report.candidateTaskIds).toEqual([cancelling.taskId]);
    expect(cancelTask).toHaveBeenCalledWith(cancelling.taskId);
    expect(runTask).not.toHaveBeenCalled();
  });
});

function task(
  taskId: string,
  status: CourseTaskRecord["status"],
): CourseTaskRecord {
  return {
    taskId,
    courseId: `course-${taskId.slice(5)}`,
    traceId: `trace-${taskId.slice(5)}`,
    userPrompt: "生成一门太阳系课程",
    creationBrief: {
      originalRequest: "生成一门太阳系课程",
      topic: "太阳系",
      audience: "零基础学习者",
      goal: "理解恒星与行星的区别",
      sectionCount: 3,
      learningMode: "mixed",
      language: "zh-CN",
    },
    status,
    createdAt: "2026-07-29T07:00:00.000Z",
    updatedAt:
      taskId === "task-recover-stale"
        ? "2026-07-29T07:02:00.000Z"
        : "2026-07-29T07:01:00.000Z",
  };
}

function run(
  taskRecord: CourseTaskRecord,
  overrides: Partial<CourseRun> = {},
): CourseRun {
  return {
    id: `run-${taskRecord.taskId}`,
    taskId: taskRecord.taskId,
    courseId: taskRecord.courseId,
    lockVersion: 1,
    phase: "planning",
    traceId: taskRecord.traceId,
    planningRevision: 0,
    currentPages: {},
    stalePageIds: [],
    replanRound: 0,
    courseRevisionRound: 0,
    ...overrides,
  };
}
