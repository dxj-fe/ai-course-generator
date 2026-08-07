import {
  AGENT_ATTEMPT_LEASE_GRACE_MS,
  RUN_LEASE_MS,
  workOrderLeaseDuration,
} from "@/server/course/run/engine-support";
import type { CourseRunRepository } from "@/server/course/store/repository";
import {
  assertCourseRunTaskExecutionActive,
  assertRunExecutionFence,
} from "@/server/course/store/repository-support";
import type { CourseRun, WorkOrder } from "@/shared/course-schema";

type LeaseDependencies = {
  repository: CourseRunRepository;
  now(): string;
};

export class CourseRunLeaseUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "lease_held"
      | "work_order_held"
      | "trace_adoption_blocked" = "lease_held",
  ) {
    super(message);
    this.name = "CourseRunLeaseUnavailableError";
  }
}

export function isCourseRunLeaseUnavailableError(
  error: unknown,
): error is CourseRunLeaseUnavailableError {
  return (
    error instanceof CourseRunLeaseUnavailableError ||
    (error instanceof Error &&
      error.name === "CourseRunLeaseUnavailableError")
  );
}

export function renewExecutionLeases(
  workOrder: WorkOrder,
  workOrderLeaseOwner: string,
  runLeaseOwner: string,
  traceId: string,
  dependencies: LeaseDependencies,
) {
  if (
    workOrder.status !== "running" ||
    workOrder.leaseOwner !== workOrderLeaseOwner
  ) {
    throw new CourseRunLeaseUnavailableError(
      `WorkOrder ${workOrder.id} 的执行权已变化`,
    );
  }
  const now = dependencies.now();
  // 父租约必须先于子租约续期；任何中途退出都只能留下“父长子短”，不能
  // 再制造恢复 Worker 可接管父运行但无法领取子工作单的窗口。
  renewOwnedRunLease(
    workOrder.taskId,
    traceId,
    runLeaseOwner,
    Math.max(
      RUN_LEASE_MS,
      workOrder.budget.timeoutMs + AGENT_ATTEMPT_LEASE_GRACE_MS,
    ),
    dependencies,
    now,
  );
  const renewedWorkOrder = dependencies.repository.workOrders.renewLease({
    workOrderId: workOrder.id,
    owner: workOrderLeaseOwner,
    expectedLockVersion: workOrder.lockVersion,
    now,
    durationMs: workOrderLeaseDuration(workOrder),
    authorize: () => {
      const currentRun = requiredRun(
        dependencies.repository.runs.loadByTaskId(workOrder.taskId),
        workOrder.taskId,
      );
      assertRunExecutionFence(
        dependencies.repository.runs.database,
        currentRun,
        traceId,
        runLeaseOwner,
      );
    },
  });
  if (!renewedWorkOrder) {
    throw new CourseRunLeaseUnavailableError(
      `WorkOrder ${workOrder.id} lease 续期失败`,
    );
  }

  return renewedWorkOrder;
}

/**
 * 领取子 WorkOrder 前先延长父 CourseRun。这样即使进程在子领取与 Agent
 * 启动之间退出，恢复 Worker 也不会在子租约仍有效时提前接管父运行。
 */
export function renewRunLeaseForWorkOrder(
  workOrder: WorkOrder,
  owner: string,
  traceId: string,
  dependencies: LeaseDependencies,
  now = dependencies.now(),
) {
  return renewOwnedRunLease(
    workOrder.taskId,
    traceId,
    owner,
    workOrderLeaseDuration(workOrder),
    dependencies,
    now,
  );
}

export function renewRunLease(
  run: CourseRun,
  owner: string,
  dependencies: LeaseDependencies,
) {
  const renewed = dependencies.repository.runs.renewLease({
    runId: run.id,
    owner,
    now: dependencies.now(),
    durationMs: RUN_LEASE_MS,
    expectedTraceId: run.traceId,
    authorize: () =>
      assertCourseRunTaskExecutionActive(
        dependencies.repository.runs.database,
        run,
      ),
  });
  if (!renewed) {
    throw new CourseRunLeaseUnavailableError("CourseRun lease 续期失败");
  }
  return renewed;
}

function renewOwnedRunLease(
  taskId: string,
  traceId: string,
  owner: string,
  durationMs: number,
  dependencies: LeaseDependencies,
  now: string,
) {
  const run = dependencies.repository.runs.loadByTaskId(taskId);
  if (
    !run ||
    run.traceId !== traceId ||
    run.leaseOwner !== owner
  ) {
    throw new CourseRunLeaseUnavailableError("CourseRun 执行权已变化");
  }
  const renewed = dependencies.repository.runs.renewLease({
    runId: run.id,
    owner,
    now,
    durationMs,
    expectedTraceId: traceId,
    authorize: () =>
      assertCourseRunTaskExecutionActive(
        dependencies.repository.runs.database,
        run,
      ),
  });
  if (!renewed) {
    throw new CourseRunLeaseUnavailableError("CourseRun lease 续期失败");
  }
  return renewed;
}

export function releaseRunningOrdersAfterTraceAdoption(
  taskId: string,
  repository: CourseRunRepository,
  now: string,
) {
  for (const workOrder of repository.workOrders.listByTask(taskId, [
    "running",
  ])) {
    if (!workOrder.leaseOwner) continue;
    repository.workOrders.release({
      workOrderId: workOrder.id,
      owner: workOrder.leaseOwner,
      expectedLockVersion: workOrder.lockVersion,
      now,
    });
  }
}

export function releaseOwnedWorkOrders(
  taskId: string,
  ownerPrefix: string,
  dependencies: LeaseDependencies,
) {
  for (const workOrder of dependencies.repository.workOrders.listByTask(
    taskId,
    ["running"],
  )) {
    if (!workOrder.leaseOwner?.startsWith(`${ownerPrefix}:`)) continue;
    releaseWorkOrder(
      workOrder.id,
      workOrder.leaseOwner,
      dependencies,
    );
  }
}

export function releaseWorkOrder(
  workOrderId: string,
  owner: string,
  dependencies: LeaseDependencies,
) {
  const current = dependencies.repository.workOrders.load(workOrderId);
  if (
    !current ||
    current.status !== "running" ||
    current.leaseOwner !== owner
  ) {
    return;
  }
  dependencies.repository.workOrders.release({
    workOrderId,
    owner,
    expectedLockVersion: current.lockVersion,
    now: dependencies.now(),
  });
}

export function releaseRunLease(
  runId: string,
  owner: string,
  dependencies: LeaseDependencies,
) {
  const current = dependencies.repository.runs.load(runId);
  if (!current || current.leaseOwner !== owner) return;
  dependencies.repository.runs.releaseLease({
    runId,
    owner,
    expectedLockVersion: current.lockVersion,
    expectedTraceId: current.traceId,
    now: dependencies.now(),
  });
}

function requiredRun(run: CourseRun | undefined, id: string) {
  if (!run) throw new Error(`CourseRun 不存在：${id}`);
  return run;
}
