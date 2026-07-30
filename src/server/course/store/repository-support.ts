import type { DatabaseSync } from "node:sqlite";

import { CourseTaskRecordSchema } from "@/shared/course-schema";
import type { PageTask } from "@/shared/course-schema/course-architecture";
import {
  ArtifactRefSchema,
  type ArtifactRef,
  type CourseArtifact,
} from "@/shared/course-schema/course-artifact";
import type { CourseRun } from "@/shared/course-schema/course-run";
import type { WorkOrder } from "@/shared/course-schema/work-order";

export function requiredMapValue(map: Map<string, string>, key: string) {
  const value = map.get(key);
  if (!value) throw new Error(`缺少页面 WorkOrder 映射：${key}`);
  return value;
}

export function requiredRef(
  refs: Map<string, ArtifactRef>,
  kind: ArtifactRef["kind"],
) {
  const ref = refs.get(kind);
  if (!ref) throw new Error(`页面 Submission 缺少 ${kind} Artifact`);
  return ref;
}

export function toArtifactRef(artifact: CourseArtifact) {
  return ArtifactRefSchema.parse({
    id: artifact.id,
    kind: artifact.kind,
    courseId: artifact.courseId,
    pageId: artifact.pageId,
    scopeKey: artifact.scopeKey,
    version: artifact.version,
    contentHash: artifact.contentHash,
  });
}

export function pageAcceptance(pageTask: PageTask) {
  return [
    `学习结果：${pageTask.acceptance.expectedLearnerOutcome}`,
    ...pageTask.acceptance.requiredConcepts.map(
      (concept) => `必须讲清：${concept}`,
    ),
    ...pageTask.acceptance.pageSpecific,
    ...(pageTask.acceptance.requiresInteraction
      ? ["页面必须包含可验证的学习互动"]
      : []),
  ];
}

export function bootstrapEventId(taskId: string) {
  return `run-event-bootstrap-${taskId}`;
}

export function assertRunExecutionFence(
  database: DatabaseSync,
  run: CourseRun,
  traceId: string,
  leaseOwner: string,
) {
  assertCourseRunTaskExecutionActive(database, run);
  if (run.traceId !== traceId || run.leaseOwner !== leaseOwner) {
    throw new Error("CourseRun trace 或 lease 围栏失效");
  }
  if (!run.leaseExpiresAt) {
    throw new Error("CourseRun 未持有有效 lease");
  }
}

/**
 * CourseRun 业务事务的统一控制面围栏。
 *
 * 调用方必须已经开启 BEGIN IMMEDIATE。这样 TaskRecord、cancel intent 的读取
 * 与后续 Run/WorkOrder/Artifact/Event 写入共享同一把 SQLite 写锁：取消先
 * 提交时旧命令必然失败；旧命令先提交时取消再根据已经落库的终态收口。
 */
export function assertCourseRunTaskExecutionActive(
  database: DatabaseSync,
  binding: Pick<CourseRun, "taskId" | "courseId" | "traceId">,
) {
  const row = database
    .prepare(`
      SELECT course_id AS courseId, payload
      FROM course_tasks
      WHERE id = ?
    `)
    .get(binding.taskId) as
    | { courseId: string; payload: string }
    | undefined;
  if (!row) {
    throw executionInactive("CourseRun 找不到对应的 TaskRecord");
  }

  const parsed = CourseTaskRecordSchema.safeParse(JSON.parse(row.payload));
  if (!parsed.success) {
    throw executionInactive("CourseRun 对应的 TaskRecord 无法解析");
  }
  const task = parsed.data;
  if (
    row.courseId !== binding.courseId ||
    task.taskId !== binding.taskId ||
    task.courseId !== binding.courseId ||
    task.traceId !== binding.traceId ||
    task.status !== "running"
  ) {
    throw executionInactive("CourseRun 与当前 TaskRecord 执行权不一致");
  }

  const cancelIntent = database
    .prepare(`
      SELECT 1
      FROM course_task_control_intents
      WHERE task_id = ?
        AND course_id = ?
        AND action = 'cancel'
      LIMIT 1
    `)
    .get(binding.taskId, binding.courseId);
  if (cancelIntent) {
    throw executionInactive("课程取消意图已提交，旧 CourseRun 命令已停止");
  }
}

function executionInactive(message: string) {
  return new DOMException(message, "AbortError");
}

export function requiredRun(
  run: CourseRun | undefined,
  id: string,
) {
  if (!run) throw new Error(`CourseRun 不存在：${id}`);
  return run;
}

export function requiredWorkOrder(
  workOrder: WorkOrder | undefined,
  id: string,
) {
  if (!workOrder) throw new Error(`WorkOrder 不存在：${id}`);
  return workOrder;
}

export function requiredArtifact(
  artifact: CourseArtifact | undefined,
  id: string,
) {
  if (!artifact) throw new Error(`Artifact 不存在：${id}`);
  return artifact;
}
