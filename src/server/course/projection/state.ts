import { z } from "zod";

import { ToolIds } from "@/server/agent/ids";
import { projectCourseArchitecture } from "@/server/course/projection/architecture";
import {
  sanitizePublicDiagnosticText,
  sanitizePublicErrorCode,
} from "@/server/course/projection/public-error";
import {
  createCoursePublicEventProjectionContext,
  projectCoursePublicEvents,
} from "@/server/course/projection/public-events";
import type { CourseRunEvent } from "@/server/course/store/run-event";
import {
  AssetGenerationResultSchema,
  CourseArchitectureSchema,
  CourseArtifactSchema,
  CourseCreationBriefSchema,
  CourseGenerationStateSchema,
  CourseReviewSchema,
  CourseRunSchema,
  HtmlOutputSchema,
  PageContentDSLSchema,
  PageSummarySchema,
  PageWorkerConfigSchema,
  QualityReportSchema,
  ReferencePackSchema,
  WorkOrderSchema,
  type ArtifactRef,
  type CourseArchitecture,
  type CourseArtifact,
  type CourseCreationBrief,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type CourseRun,
  type PageGenerationError,
  type PageGenerationStage,
  type PageGenerationState,
  type PageWorkerConfig,
  type ReferencePack,
  type WorkOrder,
} from "@/shared/course-schema";

const AssetResultsSchema = z.array(AssetGenerationResultSchema).max(12);
const TERMINAL_RUN_PHASES = new Set(["completed", "failed", "cancelled"]);
const PAGE_STAGES = new Set<PageGenerationStage>([
  "page_writer",
  "assets",
  "html",
  "qa",
  "repair",
  "complete",
]);
export type CourseStateProjectorInput = {
  run: CourseRun;
  creationBrief: CourseCreationBrief;
  referencePacks?: readonly ReferencePack[];
  /**
   * 调用方已经读取 active Architecture 时可直接传入；未传时从 artifacts 中的
   * activeArchitecture 引用读取。两者同时存在时必须内容一致。
   */
  architecture?: CourseArchitecture;
  workOrders: readonly WorkOrder[];
  artifacts: readonly CourseArtifact[];
  events: readonly CourseRunEvent[];
  workerConfig?: PageWorkerConfig;
};
/**
 * 把多 Agent 的执行真相重建成旧 UI 可读的 CourseGenerationState。
 *
 * 该函数不读数据库、不取当前时间，也不修改传入对象。页面只读取 CourseRun 的 current
 * pointer；非当前 WorkOrder 和 Artifact 不会被投影成当前结果。
 */
export function projectCourseState(
  input: CourseStateProjectorInput,
): CourseGenerationState {
  const run = CourseRunSchema.parse(input.run);
  const creationBrief = CourseCreationBriefSchema.parse(input.creationBrief);
  const referencePacks = z
    .array(ReferencePackSchema)
    .parse(input.referencePacks ?? []);
  const workOrders = input.workOrders.map((workOrder) =>
    WorkOrderSchema.parse(workOrder),
  );
  const artifacts = input.artifacts.map((artifact) =>
    CourseArtifactSchema.parse(artifact),
  );
  assertProjectionScope(run, workOrders, artifacts, input.events);
  const artifactsById = new Map(
    artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const workOrdersById = new Map(
    workOrders.map((workOrder) => [workOrder.id, workOrder]),
  );
  const architecture = resolveActiveArchitecture({
    run,
    supplied: input.architecture,
    artifactsById,
  });
  validateActiveArchitectureSource({
    run,
    workOrdersById,
    artifactsById,
  });
  const pageTasks = architecture
    ? [...architecture.pageTasks].sort((left, right) => left.order - right.order)
    : [];
  const pageTaskById = new Map(
    pageTasks.map((pageTask) => [pageTask.pageId, pageTask]),
  );

  if (!architecture && Object.keys(run.currentPages).length > 0) {
    throw new Error("CourseRun 没有 active Architecture，却包含 current page");
  }
  for (const pageId of Object.keys(run.currentPages)) {
    if (!pageTaskById.has(pageId)) {
      throw new Error(`current page ${pageId} 不属于 active Architecture`);
    }
  }

  const publicEventContext = createCoursePublicEventProjectionContext({
    run,
    architecture,
    workOrders,
  });
  const {
    selectedPageWorkOrders,
    selectedArchitectWorkOrder,
    selectedReviewWorkOrder,
  } = publicEventContext;
  validateCurrentReview({
    run,
    workOrdersById,
    artifactsById,
  });
  const events = projectCoursePublicEvents({
    ...publicEventContext,
    events: input.events,
  });
  const pages = pageTasks.map((pageTask) =>
    projectPage({
      run,
      pageId: pageTask.pageId,
      order: pageTask.order,
      selectedWorkOrder: selectedPageWorkOrders.get(pageTask.pageId),
      workOrdersById,
      artifactsById,
      events,
      runEvents: input.events,
    }),
  );
  const currentPageId = selectCurrentPageId({
    run,
    pageTasks: pageTasks.map(({ pageId, order }) => ({ pageId, order })),
    selectedPageWorkOrders,
  });
  const currentStage = resolveCourseStage({
    run,
    currentPageId,
    pages,
    selectedArchitectWorkOrder,
    events,
  });
  const status = projectRunStatus(run);
  const errors = projectErrors({
    run,
    currentStage,
    selectedArchitectWorkOrder,
    selectedReviewWorkOrder,
    selectedPageWorkOrders,
    pages,
  });
  const timestamps = resolveProjectionTimestamps({
    workOrders,
    artifacts,
    events: input.events,
  });
  const terminal = TERMINAL_RUN_PHASES.has(run.phase);
  const architectureProjection = architecture
    ? projectCourseArchitecture(architecture, creationBrief)
    : undefined;
  const workerConfig = PageWorkerConfigSchema.parse(
    input.workerConfig ?? defaultWorkerConfig(pageTasks.length),
  );

  return CourseGenerationStateSchema.parse({
    courseId: run.courseId,
    traceId: run.traceId,
    userPrompt: creationBrief.originalRequest,
    referencePacks: referencePacks.length > 0 ? referencePacks : undefined,
    status,
    currentStage,
    currentPageId,
    intent: architectureProjection?.intent,
    outline: architectureProjection?.outline,
    briefs: architectureProjection?.briefs,
    pageWorkerBriefs: architectureProjection?.pageWorkerBriefs,
    workerConfig,
    generationMetrics: projectGenerationMetrics(run, workOrders),
    pages,
    events,
    errors,
    startedAt: timestamps.startedAt,
    updatedAt: timestamps.updatedAt,
    completedAt: terminal ? timestamps.updatedAt : undefined,
    durationMs: terminal
      ? Math.max(
          0,
          Date.parse(timestamps.updatedAt) - Date.parse(timestamps.startedAt),
        )
      : undefined,
  });
}

function projectGenerationMetrics(
  run: CourseRun,
  workOrders: readonly WorkOrder[],
) {
  const architectureAttemptCount = Math.max(
    run.planningRevision,
    new Set(
      workOrders
        .filter(({ kind }) => kind === "architect_course")
        .map(({ id }) => id),
    ).size,
  );
  return {
    architectureAttemptCount,
    architectureRevisionCount: Math.max(
      0,
      architectureAttemptCount - 1,
    ),
    replanCount: run.replanRound,
    courseRevisionCount: run.courseRevisionRound,
  };
}

function resolveActiveArchitecture(input: {
  run: CourseRun;
  supplied?: CourseArchitecture;
  artifactsById: Map<string, CourseArtifact>;
}) {
  const activeRef = input.run.activeArchitecture?.architectureRef;
  if (!activeRef) return undefined;

  const supplied = input.supplied
    ? CourseArchitectureSchema.parse(input.supplied)
    : undefined;
  const artifact = input.artifactsById.get(activeRef.id);
  const persisted = artifact
    ? CourseArchitectureSchema.parse(
        requireCurrentArtifact(artifact, activeRef, undefined).payload,
      )
    : undefined;
  const architecture = supplied ?? persisted;

  if (!architecture) {
    throw new Error(`找不到 active Architecture Artifact ${activeRef.id}`);
  }
  if (architecture.courseId !== input.run.courseId) {
    throw new Error("active Architecture 不属于当前课程");
  }
  if (
    supplied &&
    persisted &&
    JSON.stringify(supplied) !== JSON.stringify(persisted)
  ) {
    throw new Error("传入的 CourseArchitecture 与 active Artifact 内容不一致");
  }
  return architecture;
}

function projectPage(input: {
  run: CourseRun;
  pageId: string;
  order: number;
  selectedWorkOrder?: WorkOrder;
  workOrdersById: Map<string, WorkOrder>;
  artifactsById: Map<string, CourseArtifact>;
  events: CourseGenerationPublicEvent[];
  runEvents: readonly CourseRunEvent[];
}): PageGenerationState {
  const pointer = input.run.currentPages[input.pageId];
  const isStale = input.run.stalePageIds.includes(input.pageId);
  const currentStage = resolvePageStage({
    pageId: input.pageId,
    workOrder: input.selectedWorkOrder,
    events: input.events,
    isStale,
  });
  const pageError = projectPageError(input.selectedWorkOrder);

  if (!pointer || isStale) {
    if (input.selectedWorkOrder?.status === "accepted") {
      throw new Error(
        `页面 ${input.pageId} 的 accepted WorkOrder 尚未成为 current pointer`,
      );
    }
    return {
      pageId: input.pageId,
      order: input.order,
      status: pageError
        ? "failed"
        : input.selectedWorkOrder?.status === "running" ||
            input.selectedWorkOrder?.status === "submitted"
          ? "running"
          : "pending",
      currentStage,
      assets: [],
      error: pageError,
    };
  }

  const sourceWorkOrder = input.workOrdersById.get(pointer.sourceWorkOrderId);
  if (
    !sourceWorkOrder ||
    sourceWorkOrder.status !== "accepted" ||
    (sourceWorkOrder.kind !== "build_page" &&
      sourceWorkOrder.kind !== "fix_page") ||
    sourceWorkOrder.scope.type !== "page" ||
    sourceWorkOrder.scope.pageId !== input.pageId
  ) {
    throw new Error(`current page ${input.pageId} 的来源 WorkOrder 未被接受`);
  }
  if (!belongsToActiveArchitecture(sourceWorkOrder, input.run)) {
    throw new Error(`current page ${input.pageId} 混入了旧课程架构版本`);
  }

  const refs = [
    pointer.contentRef,
    pointer.assetsRef,
    pointer.htmlRef,
    pointer.qualityRef,
    pointer.summaryRef,
  ].filter((ref): ref is ArtifactRef => Boolean(ref));
  const submittedRefIds = new Set(
    sourceWorkOrder.submission?.artifactRefs.map(({ id }) => id) ?? [],
  );
  if (refs.some(({ id }) => !submittedRefIds.has(id))) {
    throw new Error(`current page ${input.pageId} 引用了未提交的 Artifact`);
  }

  const contentArtifact = requireArtifactByRef(
    pointer.contentRef,
    input.artifactsById,
    pointer.sourceWorkOrderId,
  );
  const assetsArtifact = pointer.assetsRef
    ? requireArtifactByRef(
        pointer.assetsRef,
        input.artifactsById,
        pointer.sourceWorkOrderId,
      )
    : undefined;
  const htmlArtifact = requireArtifactByRef(
    pointer.htmlRef,
    input.artifactsById,
    pointer.sourceWorkOrderId,
  );
  const qualityArtifact = requireArtifactByRef(
    pointer.qualityRef,
    input.artifactsById,
    pointer.sourceWorkOrderId,
  );
  const summaryArtifact = requireArtifactByRef(
    pointer.summaryRef,
    input.artifactsById,
    pointer.sourceWorkOrderId,
  );

  const content = PageContentDSLSchema.parse(contentArtifact.payload);
  const assets = assetsArtifact
    ? AssetResultsSchema.parse(assetsArtifact.payload)
    : [];
  const htmlOutput = HtmlOutputSchema.parse(htmlArtifact.payload);
  const qualityReport = QualityReportSchema.parse(qualityArtifact.payload);
  const summary = PageSummarySchema.parse(summaryArtifact.payload);

  if (
    content.pageId !== input.pageId ||
    summary.pageId !== input.pageId ||
    summary.courseId !== input.run.courseId ||
    summary.order !== input.order
  ) {
    throw new Error(`current page ${input.pageId} 的 Artifact payload 范围不一致`);
  }

  return {
    pageId: input.pageId,
    order: input.order,
    status: "completed",
    currentStage: "complete",
    content,
    assets,
    htmlOutput,
    qualityReport,
    repairAttemptCount: countPageRepairAttempts({
      run: input.run,
      pageId: input.pageId,
      sourceWorkOrder,
      workOrdersById: input.workOrdersById,
      events: input.runEvents,
    }),
  };
}

/**
 * 新运行时不伪造旧 RepairAttemptRecord，而是从 durable WorkOrder revision 和
 * Repair Tool checkpoint 直接投影次数，供质量 Harness 判断首轮通过率。
 */
function countPageRepairAttempts(input: {
  run: CourseRun;
  pageId: string;
  sourceWorkOrder: WorkOrder;
  workOrdersById: Map<string, WorkOrder>;
  events: readonly CourseRunEvent[];
}) {
  const localRepairCount = input.events.filter((event) => {
    if (
      event.type !== "page_checkpoint_saved" ||
      event.pageId !== input.pageId ||
      !event.payload ||
      typeof event.payload !== "object"
    ) {
      return false;
    }
    const payload = event.payload as {
      workOrderId?: unknown;
      toolName?: unknown;
    };
    if (
      typeof payload.workOrderId !== "string" ||
      (payload.toolName !== ToolIds.RepairPageContent &&
        payload.toolName !== ToolIds.RepairPageHtml)
    ) {
      return false;
    }
    const workOrder = input.workOrdersById.get(payload.workOrderId);
    return Boolean(
      workOrder &&
        workOrder.scope.type === "page" &&
        workOrder.scope.pageId === input.pageId &&
        belongsToActiveArchitecture(workOrder, input.run),
    );
  }).length;

  return Math.max(0, input.sourceWorkOrder.revision - 1) +
    localRepairCount;
}

function requireArtifactByRef(
  ref: ArtifactRef,
  artifactsById: Map<string, CourseArtifact>,
  sourceWorkOrderId: string,
) {
  const artifact = artifactsById.get(ref.id);
  if (!artifact) throw new Error(`找不到 current Artifact ${ref.id}`);
  return requireCurrentArtifact(artifact, ref, sourceWorkOrderId);
}

function requireCurrentArtifact(
  artifact: CourseArtifact,
  ref: ArtifactRef,
  sourceWorkOrderId: string | undefined,
) {
  if (
    artifact.id !== ref.id ||
    artifact.kind !== ref.kind ||
    artifact.courseId !== ref.courseId ||
    artifact.pageId !== ref.pageId ||
    artifact.scopeKey !== ref.scopeKey ||
    artifact.revision !== ref.revision ||
    artifact.contentHash !== ref.contentHash
  ) {
    throw new Error(`Artifact ${ref.id} 与 current ref 不一致`);
  }
  if (
    sourceWorkOrderId &&
    artifact.createdByWorkOrderId !== sourceWorkOrderId
  ) {
    throw new Error(`Artifact ${ref.id} 不是 current WorkOrder 的产物`);
  }
  return artifact;
}

function validateCurrentReview(input: {
  run: CourseRun;
  workOrdersById: Map<string, WorkOrder>;
  artifactsById: Map<string, CourseArtifact>;
}) {
  const pointer = input.run.currentReview;
  if (!pointer) return;

  const workOrder = input.workOrdersById.get(pointer.workOrderId);
  if (
    !workOrder ||
    workOrder.kind !== "review_course" ||
    !["submitted", "accepted"].includes(workOrder.status)
  ) {
    throw new Error("current Review 的来源 WorkOrder 尚未提交");
  }
  if (!belongsToActiveArchitecture(workOrder, input.run)) {
    throw new Error("current Review 混入了旧课程架构版本");
  }
  const artifact = requireArtifactByRef(
    pointer.artifactRef,
    input.artifactsById,
    pointer.workOrderId,
  );
  const review = CourseReviewSchema.parse(artifact.payload);
  if (
    review.courseId !== input.run.courseId ||
    review.inputManifestHash !== pointer.inputManifestHash
  ) {
    throw new Error("current Review payload 与 CourseRun 指针不一致");
  }
  if (
    !workOrder.submission?.artifactRefs.some(
      ({ id }) => id === pointer.artifactRef.id,
    )
  ) {
    throw new Error("current Review 引用了未提交的 Artifact");
  }
  if (input.run.phase === "completed" && review.decision !== "pass") {
    throw new Error("completed CourseRun 的 current Review 必须为 pass");
  }
  if (
    input.run.phase === "completed" &&
    workOrder.status !== "accepted"
  ) {
    throw new Error("completed CourseRun 的 current Review 必须已接受");
  }
}

function validateActiveArchitectureSource(input: {
  run: CourseRun;
  workOrdersById: Map<string, WorkOrder>;
  artifactsById: Map<string, CourseArtifact>;
}) {
  const pointer = input.run.activeArchitecture;
  if (!pointer) return;

  const workOrder = input.workOrdersById.get(pointer.submissionWorkOrderId);
  if (
    !workOrder ||
    workOrder.kind !== "architect_course" ||
    workOrder.status !== "accepted" ||
    !workOrder.submission?.artifactRefs.some(
      ({ id }) => id === pointer.architectureRef.id,
    )
  ) {
    throw new Error("active Architecture 的来源 WorkOrder 未被接受");
  }
  const artifact = input.artifactsById.get(pointer.architectureRef.id);
  if (
    artifact &&
    artifact.createdByWorkOrderId !== pointer.submissionWorkOrderId
  ) {
    throw new Error("active Architecture Artifact 不是来源 WorkOrder 的产物");
  }
}

function belongsToActiveArchitecture(workOrder: WorkOrder, run: CourseRun) {
  const architectureId = run.activeArchitecture?.architectureRef.id;
  return Boolean(
    architectureId &&
      workOrder.inputArtifactRefs.some(({ id }) => id === architectureId),
  );
}

function resolvePageStage(input: {
  pageId: string;
  workOrder?: WorkOrder;
  events: CourseGenerationPublicEvent[];
  isStale: boolean;
}): PageGenerationStage {
  const latestStage = [...input.events]
    .reverse()
    .find(
      (event) =>
        event.pageId === input.pageId &&
        PAGE_STAGES.has(event.stage as PageGenerationStage) &&
        event.stage !== "complete",
    )?.stage as PageGenerationStage | undefined;
  if (latestStage) return latestStage;
  if (input.isStale || input.workOrder?.kind === "fix_page") return "repair";
  return "page_writer";
}

function selectCurrentPageId(input: {
  run: CourseRun;
  pageTasks: Array<{ pageId: string; order: number }>;
  selectedPageWorkOrders: Map<string, WorkOrder | undefined>;
}) {
  if (input.run.phase !== "building" && input.run.phase !== "revising") {
    return undefined;
  }
  const priority = new Map([
    ["running", 0],
    ["failed", 1],
    ["blocked", 1],
    ["submitted", 2],
    ["queued", 3],
    ["waiting_dependencies", 4],
  ]);
  return input.pageTasks
    .flatMap(({ pageId, order }) => {
      const workOrder = input.selectedPageWorkOrders.get(pageId);
      const rank = workOrder ? priority.get(workOrder.status) : undefined;
      return rank === undefined ? [] : [{ pageId, order, rank }];
    })
    .sort((left, right) => left.rank - right.rank || left.order - right.order)[0]
    ?.pageId;
}

function resolveCourseStage(input: {
  run: CourseRun;
  currentPageId?: string;
  pages: PageGenerationState[];
  selectedArchitectWorkOrder?: WorkOrder;
  events: CourseGenerationPublicEvent[];
}): CourseGenerationStage {
  if (input.run.phase === "completed") return "complete";
  if (input.run.phase === "planning") {
    return input.selectedArchitectWorkOrder?.status === "submitted"
      ? "design"
      : "planner";
  }
  if (input.run.phase === "reviewing") return "course_review";
  if (input.run.phase === "revising") {
    return (
      input.pages.find(({ pageId }) => pageId === input.currentPageId)
        ?.currentStage ?? "repair"
    );
  }
  if (input.run.phase === "building") {
    return (
      input.pages.find(({ pageId }) => pageId === input.currentPageId)
        ?.currentStage ?? "qa"
    );
  }

  return (
    [...input.events]
      .reverse()
      .find(({ stage }) => stage !== "complete")?.stage ?? "intent"
  );
}

function projectRunStatus(run: CourseRun): CourseGenerationState["status"] {
  return TERMINAL_RUN_PHASES.has(run.phase)
    ? (run.phase as "completed" | "failed" | "cancelled")
    : "running";
}

function projectErrors(input: {
  run: CourseRun;
  currentStage: CourseGenerationStage;
  selectedArchitectWorkOrder?: WorkOrder;
  selectedReviewWorkOrder?: WorkOrder;
  selectedPageWorkOrders: Map<string, WorkOrder | undefined>;
  pages: PageGenerationState[];
}) {
  const errors: CourseGenerationError[] = [];
  if (input.run.error) {
    errors.push({
      stage: input.currentStage,
      code: sanitizePublicErrorCode(input.run.error.code, "COURSE_RUN_FAILED"),
      causeCode: input.run.error.causeCode,
      message: sanitizePublicDiagnosticText(input.run.error.message, {
        fallback: "课程生成失败，请根据错误码排查后重试。",
        maxLength: 1_000,
      }),
    });
  }

  const selectedOrders = [
    input.selectedArchitectWorkOrder,
    input.selectedReviewWorkOrder,
    ...input.selectedPageWorkOrders.values(),
  ].filter((workOrder): workOrder is WorkOrder => Boolean(workOrder));
  for (const workOrder of selectedOrders) {
    if (workOrder.status !== "failed" && workOrder.status !== "blocked") {
      continue;
    }
    const pageId =
      workOrder.scope.type === "page" ? workOrder.scope.pageId : undefined;
    const page = pageId
      ? input.pages.find((candidate) => candidate.pageId === pageId)
      : undefined;
    errors.push({
      stage:
        page?.currentStage ??
        (workOrder.scope.type === "course"
          ? input.currentStage
          : stageForWorkOrder(workOrder)),
      pageId,
      code: sanitizePublicErrorCode(
        workOrder.error?.code,
        "WORK_ORDER_BLOCKED",
      ),
      causeCode: workOrder.error?.causeCode,
      message: sanitizePublicDiagnosticText(
        workOrder.error?.message ??
          workOrder.submission?.issues.join("；"),
        {
          fallback: "Agent 无法完成当前任务。",
          maxLength: 1_000,
        },
      ),
    });
  }

  const unique = new Map(
    errors.map((error) => [
      [error.pageId, error.code, error.message].join(":"),
      error,
    ]),
  );
  return [...unique.values()].slice(0, 30);
}

function projectPageError(
  workOrder: WorkOrder | undefined,
): PageGenerationError | undefined {
  if (
    !workOrder ||
    (workOrder.status !== "failed" && workOrder.status !== "blocked")
  ) {
    return undefined;
  }
  return {
    code: sanitizePublicErrorCode(
      workOrder.error?.code,
      "WORK_ORDER_BLOCKED",
    ),
    causeCode: workOrder.error?.causeCode,
    message: sanitizePublicDiagnosticText(
      workOrder.error?.message ??
        workOrder.submission?.issues.join("；"),
      {
        fallback: "页面 Agent 无法完成当前任务。",
        maxLength: 1_000,
      },
    ),
  };
}

function stageForWorkOrder(workOrder: WorkOrder): CourseGenerationStage {
  if (workOrder.kind === "architect_course") return "design";
  if (workOrder.kind === "review_course") return "course_review";
  if (workOrder.kind === "fix_page") return "repair";
  return workOrder.kind === "build_page" ? "page_writer" : "course_review";
}

function resolveProjectionTimestamps(input: {
  workOrders: WorkOrder[];
  artifacts: CourseArtifact[];
  events: readonly CourseRunEvent[];
}) {
  const timestamps = [
    ...input.workOrders.flatMap(({ createdAt, updatedAt }) => [
      createdAt,
      updatedAt,
    ]),
    ...input.artifacts.map(({ createdAt }) => createdAt),
    ...input.events.map(({ createdAt }) => createdAt),
  ].filter(isValidTimestamp);
  if (timestamps.length === 0) {
    throw new Error("CourseStateProjector 缺少可用的持久化时间");
  }
  const sorted = timestamps.sort(
    (left, right) => Date.parse(left) - Date.parse(right),
  );
  return {
    startedAt: sorted[0]!,
    updatedAt: sorted[sorted.length - 1]!,
  };
}

function defaultWorkerConfig(pageCount: number): PageWorkerConfig {
  return {
    mode: "parallel",
    concurrency: Math.min(5, Math.max(1, pageCount)),
  };
}

function assertProjectionScope(
  run: CourseRun,
  workOrders: WorkOrder[],
  artifacts: CourseArtifact[],
  events: readonly CourseRunEvent[],
) {
  assertUniqueIds(workOrders, "WorkOrder");
  assertUniqueIds(artifacts, "Artifact");
  if (
    workOrders.some(
      (workOrder) =>
        workOrder.taskId !== run.taskId || workOrder.courseId !== run.courseId,
    )
  ) {
    throw new Error("CourseStateProjector 收到了其他任务的 WorkOrder");
  }
  if (
    artifacts.some(
      (artifact) =>
        artifact.taskId !== run.taskId || artifact.courseId !== run.courseId,
    )
  ) {
    throw new Error("CourseStateProjector 收到了其他任务的 Artifact");
  }
  if (events.some((event) => event.taskId !== run.taskId)) {
    throw new Error("CourseStateProjector 收到了其他任务的 Event");
  }
}

function assertUniqueIds(values: ReadonlyArray<{ id: string }>, label: string) {
  const ids = values.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`CourseStateProjector 收到了重复的 ${label}`);
  }
}

function isValidTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}
