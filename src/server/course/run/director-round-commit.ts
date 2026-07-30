import {
  WorkOrderSchema,
  type ArtifactRef,
  type WorkOrder,
} from "@/shared/course-schema";
import { AgentIds } from "@/server/agent/ids";
import type { CourseRunEventStore } from "@/server/course/store/run-event";
import type { CourseRunStore } from "@/server/course/store/run";
import type { WorkOrderStore } from "@/server/course/store/work-order";
import { assertCourseRunTaskExecutionActive } from "@/server/course/store/repository-support";

type DirectorRoundRepository = {
  runs: CourseRunStore;
  workOrders: WorkOrderStore;
  events: CourseRunEventStore;
};

export type DirectorRoundCommit = {
  workOrderId: string;
  expectedLockVersion: number;
  leaseOwner: string;
  action: string;
  summary: string;
  evidence?: string[];
  artifactRefs?: ArtifactRef[];
};

/**
 * Director 的领域动作与当前短回合必须在同一个外层事务里完成。
 * 调用方负责开启事务；这个函数只使用事务内 Store，不能单独提交。
 */
export function completeDirectorRoundInTransaction(
  repository: DirectorRoundRepository,
  input: DirectorRoundCommit,
  now: string,
): WorkOrder {
  const current = repository.workOrders.load(input.workOrderId);
  if (!current) {
    throw new Error(`Director WorkOrder 不存在：${input.workOrderId}`);
  }
  const run = repository.runs.loadByTaskId(current.taskId);
  if (!run) throw new Error(`CourseRun 不存在：${current.taskId}`);
  assertCourseRunTaskExecutionActive(repository.runs.database, run);
  if (current.status === "accepted") {
    if (
      current.kind !== "director_round" ||
      current.submission?.status !== "done"
    ) {
      throw new Error("Director WorkOrder 已结束但终态无效");
    }
    return current;
  }
  if (
    current.kind !== "director_round" ||
    current.scope.type !== "course" ||
    current.status !== "running" ||
    current.lockVersion !== input.expectedLockVersion ||
    current.leaseOwner !== input.leaseOwner ||
    !current.allowedTools.includes(input.action)
  ) {
    throw new Error("Director WorkOrder 动作、scope 或 lease 围栏失效");
  }

  const next = WorkOrderSchema.parse({
    ...current,
    lockVersion: current.lockVersion + 1,
    status: "accepted",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    submission: {
      workOrderId: current.id,
      status: "done",
      artifactRefs: input.artifactRefs ?? [],
      evidence: [
        `director_action:${input.action}`,
        ...(input.evidence ?? [input.summary]),
      ],
      issues: [],
    },
    updatedAt: now,
  });
  if (
    !repository.workOrders.compareAndSet(next, {
      expectedLockVersion: current.lockVersion,
      expectedStatus: "running",
      expectedLeaseOwner: input.leaseOwner,
    })
  ) {
    throw new Error("Director WorkOrder 完成发生并发冲突");
  }

  repository.events.appendInTransaction({
    taskId: current.taskId,
    traceId: run.traceId,
    type: "director_decision",
    stage: current.inputArtifactRefs.some(
      ({ kind }) => kind === "course_review",
    )
      ? "course_review"
      : "planning",
    agent: AgentIds.CourseDirector,
    safeSummary: input.summary,
    payload: {
      workOrderId: current.id,
      action: input.action,
    },
    createdAt: now,
  });
  return next;
}
