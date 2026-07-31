import {
  createCourseRunStore,
  type CourseRunStore,
} from "@/server/course/store/run";
import {
  createCourseTaskStore,
  type CourseTaskStore,
} from "@/server/course/store/task";
import type {
  CourseRun,
  CourseTaskRecord,
} from "@/shared/course-schema";

const DEFAULT_MAX_TASKS = 20;
const DEFAULT_CONCURRENCY = 2;
const TERMINAL_RUN_PHASES = new Set(["completed", "failed", "cancelled"]);

export type CourseTaskRecoveryScanOptions = {
  /** 单次扫描最多领取多少个任务，避免服务启动时瞬间打满模型配额。 */
  maxTasks?: number;
  concurrency?: number;
};

export type CourseTaskRecoveryFailure = {
  taskId: string;
  message: string;
};

export type CourseTaskRecoveryScanReport = {
  scannedTaskCount: number;
  unavailableTaskCount: number;
  candidateTaskIds: string[];
  skippedActiveLeaseTaskIds: string[];
  /** 本批调用已正常返回；任务终态仍以持久化 TaskRecord 为准。 */
  processedTaskIds: string[];
  failures: CourseTaskRecoveryFailure[];
};

type CourseTaskRecoveryDependencies = {
  taskStore: Pick<CourseTaskStore, "list" | "loadControlIntent">;
  runStore: Pick<CourseRunStore, "loadByTaskId">;
  runTask(taskId: string): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  reconcileTask(taskId: string): Promise<unknown>;
  now(): string;
};

export type CourseTaskRecoveryScanner = {
  /**
   * 执行一次有限扫描并等待本批任务结束。它不创建定时器；常驻部署应由显式
   * worker 进程重复调用，Next 启动钩子只把它当作一次恢复快路径。
   */
  scanOnce(
    options?: CourseTaskRecoveryScanOptions,
  ): Promise<CourseTaskRecoveryScanReport>;
};

export function createCourseTaskRecoveryScanner(
  overrides: Partial<CourseTaskRecoveryDependencies> = {},
): CourseTaskRecoveryScanner {
  const dependencies: CourseTaskRecoveryDependencies = {
    taskStore: overrides.taskStore ?? createCourseTaskStore(),
    runStore: overrides.runStore ?? createCourseRunStore(),
    runTask:
      overrides.runTask ??
      missingTaskServiceMethod("runTask"),
    cancelTask:
      overrides.cancelTask ??
      missingTaskServiceMethod("cancelTask"),
    reconcileTask:
      overrides.reconcileTask ??
      missingTaskServiceMethod("reconcileTask"),
    now: overrides.now ?? (() => new Date().toISOString()),
  };
  let activeScan:
    | Promise<CourseTaskRecoveryScanReport>
    | undefined;

  return {
    scanOnce(options = {}) {
      if (activeScan) return activeScan;
      const scan = runRecoveryScan(options, dependencies).finally(() => {
        if (activeScan === scan) activeScan = undefined;
      });
      activeScan = scan;
      return scan;
    },
  };
}

async function runRecoveryScan(
  options: CourseTaskRecoveryScanOptions,
  dependencies: CourseTaskRecoveryDependencies,
): Promise<CourseTaskRecoveryScanReport> {
  const maxTasks = normalizePositiveInteger(
    options.maxTasks,
    DEFAULT_MAX_TASKS,
    100,
    "maxTasks",
  );
  const concurrency = normalizePositiveInteger(
    options.concurrency,
    DEFAULT_CONCURRENCY,
    5,
    "concurrency",
  );
  const listed = await dependencies.taskStore.list();
  const now = dependencies.now();
  type Candidate = {
    task: CourseTaskRecord;
    action: "run" | "cancel" | "reconcile";
  };
  const cancelCandidates: Candidate[] = [];
  const reconcileCandidates: Candidate[] = [];
  const runCandidates: Candidate[] = [];
  const skippedActiveLeaseTaskIds: string[] = [];

  const recoverableTasks = listed.items
    .filter(isActiveTask)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

  for (const task of recoverableTasks) {
    const controlIntent =
      await dependencies.taskStore.loadControlIntent(task.taskId);
    const run = dependencies.runStore.loadByTaskId(task.taskId);
    if (controlIntent?.action === "cancel") {
      cancelCandidates.push({ task, action: "cancel" });
      continue;
    }
    if (task.status === "paused") {
      if (run && TERMINAL_RUN_PHASES.has(run.phase)) {
        reconcileCandidates.push({ task, action: "reconcile" });
      }
      continue;
    }
    if (hasActiveLease(run, now)) {
      skippedActiveLeaseTaskIds.push(task.taskId);
      continue;
    }
    runCandidates.push({ task, action: "run" });
  }
  // cancel intent 永远排在普通恢复任务之前，不能被 maxTasks 配额挤出本批次。
  const candidates = [
    ...cancelCandidates,
    ...reconcileCandidates,
    ...runCandidates,
  ].slice(0, maxTasks);

  const outcomes = await runWithConcurrency(
    candidates,
    concurrency,
    async ({ task, action }) => {
      try {
        await (action === "cancel"
          ? dependencies.cancelTask(task.taskId)
          : action === "reconcile"
            ? dependencies.reconcileTask(task.taskId)
            : dependencies.runTask(task.taskId));
        return { taskId: task.taskId } as const;
      } catch (error) {
        return {
          taskId: task.taskId,
          message: safeErrorMessage(error),
        } as const;
      }
    },
  );

  return {
    scannedTaskCount: listed.items.length,
    unavailableTaskCount: listed.unavailableCount,
    candidateTaskIds: candidates.map(({ task }) => task.taskId),
    skippedActiveLeaseTaskIds,
    processedTaskIds: outcomes
      .filter(
        (
          outcome,
        ): outcome is { readonly taskId: string } =>
          !("message" in outcome),
      )
      .map(({ taskId }) => taskId),
    failures: outcomes.filter(
      (
        outcome,
      ): outcome is {
        readonly taskId: string;
        readonly message: string;
      } => "message" in outcome,
    ),
  };
}

function isActiveTask(task: CourseTaskRecord) {
  return (
    task.status === "queued" ||
      task.status === "running" ||
      task.status === "paused"
  );
}

function hasActiveLease(run: CourseRun | undefined, now: string) {
  if (!run || TERMINAL_RUN_PHASES.has(run.phase)) return false;
  if (!run.leaseOwner || !run.leaseExpiresAt) return false;
  return Date.parse(run.leaseExpiresAt) > Date.parse(now);
}

async function runWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  run: (item: Input) => Promise<Output>,
) {
  const outputs = new Array<Output>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        outputs[index] = await run(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return outputs;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
) {
  const normalized = value ?? fallback;
  if (
    !Number.isInteger(normalized) ||
    normalized < 1 ||
    normalized > maximum
  ) {
    throw new RangeError(`${name} 必须是 1 到 ${maximum} 的整数`);
  }
  return normalized;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function missingTaskServiceMethod(name: string) {
  return async (taskId: string): Promise<never> => {
    void taskId;
    throw new Error(
      `CourseTaskRecoveryScanner 缺少 ${name} 装配；请从 server/setup/worker 获取实例。`,
    );
  };
}
