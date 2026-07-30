import type { CourseRunEvent } from "@/server/course/store/run-event";
import { sanitizePublicDiagnosticText } from "@/server/course/projection/public-error";
import {
  CourseGenerationEventTypeSchema,
  CourseGenerationStageSchema,
  type CourseArchitecture,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseRun,
  type WorkOrder,
} from "@/shared/course-schema";

const INACTIVE_WORK_ORDER_STATUSES = new Set([
  "cancelled",
  "revision_requested",
  "superseded",
]);

export function projectCoursePublicEvents(input: {
  run: CourseRun;
  architecture?: CourseArchitecture;
  workOrdersById: Map<string, WorkOrder>;
  selectedArchitectWorkOrder?: WorkOrder;
  selectedReviewWorkOrder?: WorkOrder;
  selectedPageWorkOrders: Map<string, WorkOrder | undefined>;
  events: readonly CourseRunEvent[];
  /**
   * 完整 checkpoint 默认只保留最近 1000 条公开事件；SSE 增量读取传 null，
   * 由持久化 afterSequence 决定范围，不能再次裁剪而丢事件。
   */
  historyLimit?: number | null;
}): CourseGenerationPublicEvent[] {
  const pageIds = new Set(
    input.architecture?.pageTasks.map(({ pageId }) => pageId) ?? [],
  );
  const seenSequences = new Set<number>();
  const projected = [...input.events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => {
      if (
        event.taskId !== input.run.taskId ||
        event.traceId !== input.run.traceId ||
        seenSequences.has(event.sequence)
      ) {
        return false;
      }
      seenSequences.add(event.sequence);
      return eventBelongsToCurrentRevision(event, input, pageIds);
    })
    .flatMap((event) => {
      const type = mapEventType(event.type);
      const stage = mapEventStage(event, type, input.run);
      const summary = sanitizeSummary(event.safeSummary);
      if (!type || !stage || !summary || !isValidTimestamp(event.createdAt)) {
        return [];
      }
      return [
        {
          id: publicEventId(event),
          // 对外游标直接沿用 course_run_events 的持久化 sequence。筛掉旧
          // revision 或裁剪历史窗口后允许出现间隔，但绝不能重新从 1 编号，
          // 否则断线重连会把 Last-Event-ID 指向错误的数据库位置。
          sequence: event.sequence,
          type,
          traceId: input.run.traceId,
          timestamp: event.createdAt,
          step: event.sequence,
          summary,
          stage,
          pageId:
            event.pageId && pageIds.has(event.pageId)
              ? event.pageId
              : undefined,
          agent: sanitizeAgent(event.agent),
        },
      ];
    });

  const historyLimit =
    input.historyLimit === undefined ? 1_000 : input.historyLimit;
  return historyLimit === null ? projected : projected.slice(-historyLimit);
}

/**
 * SSE 增量读取和完整状态投影共用同一套 revision 选择规则。这里返回的
 * WorkOrder 都是当前 CourseRun 指针所指向的分支，调用方无需读取事件 payload。
 */
export function createCoursePublicEventProjectionContext(input: {
  run: CourseRun;
  architecture?: CourseArchitecture;
  workOrders: readonly WorkOrder[];
}) {
  const workOrders = [...input.workOrders];
  const selectedPageWorkOrders = new Map(
    (input.architecture?.pageTasks ?? []).map(({ pageId }) => [
      pageId,
      selectCurrentPageWorkOrder({
        run: input.run,
        pageId,
        workOrders,
      }),
    ]),
  );

  return {
    run: input.run,
    architecture: input.architecture,
    workOrdersById: new Map(
      workOrders.map((workOrder) => [workOrder.id, workOrder]),
    ),
    selectedArchitectWorkOrder: selectArchitectWorkOrder(
      input.run,
      workOrders,
    ),
    selectedReviewWorkOrder: selectReviewWorkOrder(input.run, workOrders),
    selectedPageWorkOrders,
  };
}

function eventBelongsToCurrentRevision(
  event: CourseRunEvent,
  input: Parameters<typeof projectCoursePublicEvents>[0],
  pageIds: Set<string>,
) {
  if (event.pageId && !pageIds.has(event.pageId)) return false;

  const payload = asRecord(event.payload);
  const workOrderId = stringField(payload, "workOrderId");
  const workOrder = workOrderId
    ? input.workOrdersById.get(workOrderId)
    : undefined;
  const architectureRef = asRecord(payload?.architectureRef);
  const architectureId = stringField(architectureRef, "id");
  const belongsToSelectedArchitect =
    workOrder?.kind === "architect_course" &&
    workOrder.id === input.selectedArchitectWorkOrder?.id;
  if (
    architectureId &&
    architectureId !== input.run.activeArchitecture?.architectureRef.id &&
    !belongsToSelectedArchitect
  ) {
    return false;
  }

  if (!workOrderId) {
    return !event.pageId || pageIds.has(event.pageId);
  }
  if (!workOrder || INACTIVE_WORK_ORDER_STATUSES.has(workOrder.status)) {
    return false;
  }
  if (workOrder.kind === "architect_course") {
    return workOrder.id === input.selectedArchitectWorkOrder?.id;
  }
  if (workOrder.kind === "review_course") {
    return workOrder.id === input.selectedReviewWorkOrder?.id;
  }
  if (workOrder.scope.type === "page") {
    return (
      workOrder.id ===
      input.selectedPageWorkOrders.get(workOrder.scope.pageId)?.id
    );
  }
  return true;
}

function selectArchitectWorkOrder(
  run: CourseRun,
  workOrders: readonly WorkOrder[],
) {
  const newestActiveArchitect = selectNewestWorkOrder(
    workOrders.filter(
      (workOrder) =>
        workOrder.kind === "architect_course" &&
        !INACTIVE_WORK_ORDER_STATUSES.has(workOrder.status),
    ),
  );
  if (newestActiveArchitect) return newestActiveArchitect;

  return run.activeArchitecture
    ? workOrders.find(
        ({ id }) => id === run.activeArchitecture?.submissionWorkOrderId,
      )
    : undefined;
}

function selectReviewWorkOrder(
  run: CourseRun,
  workOrders: readonly WorkOrder[],
) {
  if (run.currentReview) {
    return workOrders.find(({ id }) => id === run.currentReview?.workOrderId);
  }
  return selectNewestWorkOrder(
    workOrders.filter(
      (workOrder) =>
        workOrder.kind === "review_course" &&
        belongsToActiveArchitecture(workOrder, run) &&
        !INACTIVE_WORK_ORDER_STATUSES.has(workOrder.status),
    ),
  );
}

function selectCurrentPageWorkOrder(input: {
  run: CourseRun;
  pageId: string;
  workOrders: readonly WorkOrder[];
}) {
  const pointer = input.run.currentPages[input.pageId];
  if (pointer && !input.run.stalePageIds.includes(input.pageId)) {
    return input.workOrders.find(({ id }) => id === pointer.sourceWorkOrderId);
  }

  return selectNewestWorkOrder(
    input.workOrders.filter(
      (workOrder) =>
        (workOrder.kind === "build_page" || workOrder.kind === "fix_page") &&
        workOrder.scope.type === "page" &&
        workOrder.scope.pageId === input.pageId &&
        belongsToActiveArchitecture(workOrder, input.run) &&
        !INACTIVE_WORK_ORDER_STATUSES.has(workOrder.status) &&
        workOrder.id !== pointer?.sourceWorkOrderId,
    ),
  );
}

function selectNewestWorkOrder(workOrders: readonly WorkOrder[]) {
  return [...workOrders].sort((left, right) => {
    if (left.revision !== right.revision) return right.revision - left.revision;
    const updatedDifference =
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updatedDifference !== 0) return updatedDifference;
    return right.id.localeCompare(left.id);
  })[0];
}

function belongsToActiveArchitecture(workOrder: WorkOrder, run: CourseRun) {
  const architectureId = run.activeArchitecture?.architectureRef.id;
  return Boolean(
    architectureId &&
      workOrder.inputArtifactRefs.some(({ id }) => id === architectureId),
  );
}

function mapEventType(type: string) {
  const publicType = CourseGenerationEventTypeSchema.safeParse(type);
  if (publicType.success) return publicType.data;

  return {
    course_run_bootstrapped: "start",
    work_order_claimed: "agent_start",
    director_round_created: "agent_start",
    course_review_created: "agent_start",
    work_order_submitted: "agent_done",
    architecture_submitted: "agent_done",
    architecture_accepted: "director_decision",
    architecture_revision_requested: "director_decision",
    director_decision: "director_decision",
    page_checkpoint_saved: "tool_call",
    page_dependencies_unlocked: "validation",
    page_accepted: "page_done",
    page_blocked: "error",
    page_fixes_assigned: "director_decision",
    course_replan_requested: "director_decision",
    review_submitted: "agent_done",
    course_review_submitted: "agent_done",
    review_accepted: "director_decision",
    course_review_blocked: "error",
    course_published: "finish",
    course_completed: "finish",
    course_failed: "error",
    course_cancelled: "error",
    work_order_failed: "error",
  }[type] as CourseGenerationPublicEvent["type"] | undefined;
}

function mapEventStage(
  event: CourseRunEvent,
  type: CourseGenerationPublicEvent["type"] | undefined,
  run: CourseRun,
): CourseGenerationStage | undefined {
  const publicStage = CourseGenerationStageSchema.safeParse(event.stage);
  if (publicStage.success) return publicStage.data;

  if (type === "finish") return "complete";
  if (event.type === "course_run_bootstrapped") return "intent";
  if (
    event.type === "architecture_submitted" ||
    event.type === "architecture_accepted"
  ) {
    return "design";
  }
  if (event.type === "page_accepted") return "qa";
  if (event.type === "page_dependencies_unlocked") return "page_writer";
  if (event.type.includes("review")) return "course_review";
  if (event.stage === "planning") {
    return type === "start" ? "intent" : "planner";
  }
  if (event.stage === "building") {
    return type === "page_done" || type === "validation"
      ? "qa"
      : "page_writer";
  }
  if (event.stage === "reviewing") return "course_review";
  if (event.stage === "revising") return "repair";
  if (event.stage === "completed") return "complete";

  return {
    planning: "planner",
    building: type === "validation" ? "qa" : "page_writer",
    reviewing: "course_review",
    revising: "repair",
    completed: "complete",
    failed: "qa",
    cancelled: "qa",
  }[run.phase] as CourseGenerationStage;
}

function publicEventId(event: CourseRunEvent) {
  const trimmed = event.id.trim();
  return trimmed.length > 0 && trimmed.length <= 120
    ? trimmed
    : `${event.taskId}-event-${event.sequence}`.slice(0, 120);
}

function sanitizeSummary(value: string) {
  return sanitizePublicDiagnosticText(value, {
    fallback: "课程生成进度已更新。",
    maxLength: 500,
  });
}

function sanitizeAgent(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : undefined;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
) {
  return typeof value?.[field] === "string"
    ? (value[field] as string)
    : undefined;
}

function isValidTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}
