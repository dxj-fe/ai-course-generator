import {
  CourseArchitectureSchema,
  type CourseArchitecture,
  type PageTask,
} from "@/shared/course-schema/course-architecture";
import type { ArtifactRef } from "@/shared/course-schema/course-artifact";
import type { CourseRun } from "@/shared/course-schema/course-run";
import type { WorkOrder } from "@/shared/course-schema/work-order";

export class CourseRunPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CourseRunPolicyError";
    this.code = code;
  }
}

export function assertCanAcceptArchitecture(input: {
  run: CourseRun;
  architectWorkOrder: WorkOrder;
  architectureArtifactRef: ArtifactRef;
  architecture: CourseArchitecture;
}) {
  const architecture = CourseArchitectureSchema.parse(input.architecture);
  if (input.run.taskId !== input.architectWorkOrder.taskId) {
    fail("TASK_MISMATCH", "Architect WorkOrder 不属于当前 CourseRun");
  }
  if (
    input.run.courseId !== architecture.courseId ||
    input.run.courseId !== input.architectWorkOrder.courseId
  ) {
    fail("COURSE_MISMATCH", "Architecture、WorkOrder 与 CourseRun 的课程不一致");
  }
  if (input.architectWorkOrder.kind !== "architect_course") {
    fail("WRONG_WORK_ORDER_KIND", "只有 Architect WorkOrder 能提交课程架构");
  }
  if (input.architectWorkOrder.status !== "submitted") {
    fail("ARCHITECT_NOT_SUBMITTED", "课程架构尚未进入 submitted");
  }
  if (
    !input.architectWorkOrder.submission?.artifactRefs.some(
      (ref) => ref.id === input.architectureArtifactRef.id,
    )
  ) {
    fail("ARTIFACT_NOT_SUBMITTED", "待接受的课程架构不在 Architect Submission 中");
  }
  if (input.architectureArtifactRef.kind !== "course_architecture") {
    fail("WRONG_ARTIFACT_KIND", "Architect 必须提交 course_architecture Artifact");
  }
  if (input.run.phase !== "planning" && input.run.phase !== "revising") {
    fail("WRONG_RUN_PHASE", "当前 CourseRun 阶段不能接受新版课程架构");
  }
}

export function assertCanCommitPage(input: {
  run: CourseRun;
  workOrder: WorkOrder;
  pageGatePassed: boolean;
}) {
  if (!input.run.activeArchitecture) {
    fail("ARCHITECTURE_NOT_ACCEPTED", "课程架构未接受前不能提交页面");
  }
  if (!input.pageGatePassed) {
    fail("PAGE_GATE_FAILED", "页面确定性 Gate 未通过，不能进入 current 页面");
  }
  if (
    input.workOrder.kind !== "build_page" &&
    input.workOrder.kind !== "fix_page"
  ) {
    fail("WRONG_WORK_ORDER_KIND", "只有页面 WorkOrder 能提交页面产物");
  }
  if (input.workOrder.status !== "running") {
    fail("PAGE_NOT_RUNNING", "页面 WorkOrder 不在 running 状态");
  }
  if (
    input.run.taskId !== input.workOrder.taskId ||
    input.run.courseId !== input.workOrder.courseId
  ) {
    fail("RUN_SCOPE_MISMATCH", "页面 WorkOrder 不属于当前 CourseRun");
  }
  const architectureRef = input.workOrder.inputArtifactRefs.find(
    (ref) => ref.kind === "course_architecture",
  );
  if (
    !architectureRef ||
    architectureRef.id !== input.run.activeArchitecture.architectureRef.id
  ) {
    fail("STALE_ARCHITECTURE", "页面 WorkOrder 引用了过期课程架构");
  }
}

export function pageDependenciesAreReady(input: {
  pageTask: PageTask;
  run: CourseRun;
}) {
  const stale = new Set(input.run.stalePageIds);
  return input.pageTask.buildDependsOnPageIds.every(
    (pageId) => input.run.currentPages[pageId] && !stale.has(pageId),
  );
}

export function transitiveDependentPageIds(
  architecture: CourseArchitecture,
  initialPageIds: readonly string[],
) {
  const parsed = CourseArchitectureSchema.parse(architecture);
  const selected = new Set(initialPageIds);
  const known = new Set(parsed.pageTasks.map(({ pageId }) => pageId));
  for (const pageId of selected) {
    if (!known.has(pageId)) {
      fail("UNKNOWN_PAGE", `课程架构中不存在页面 ${pageId}`);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const page of parsed.pageTasks) {
      if (
        !selected.has(page.pageId) &&
        page.buildDependsOnPageIds.some((pageId) => selected.has(pageId))
      ) {
        selected.add(page.pageId);
        changed = true;
      }
    }
  }
  return parsed.pageTasks
    .filter(({ pageId }) => selected.has(pageId))
    .sort((left, right) => left.order - right.order)
    .map(({ pageId }) => pageId);
}

export function assertAllCurrentPagesReady(input: {
  architecture: CourseArchitecture;
  run: CourseRun;
}) {
  const architecture = CourseArchitectureSchema.parse(input.architecture);
  if (input.run.stalePageIds.length > 0) {
    fail("STALE_PAGES", "仍有待返工页面，不能创建整课 Review");
  }
  for (const page of architecture.pageTasks) {
    const current = input.run.currentPages[page.pageId];
    if (!current) {
      fail("MISSING_CURRENT_PAGE", `页面 ${page.pageId} 尚无 current 版本`);
    }
  }
  if (
    Object.keys(input.run.currentPages).some(
      (pageId) =>
        !architecture.pageTasks.some((page) => page.pageId === pageId),
    )
  ) {
    fail("EXTRA_CURRENT_PAGE", "current 页面集合包含当前架构之外的页面");
  }
}

function fail(code: string, message: string): never {
  throw new CourseRunPolicyError(code, message);
}
