import { z } from "zod";

import {
  AgentToolSets,
  ToolIds,
} from "@/server/agent/ids";
import type { LocalResourceSession } from "@/server/agent/skill";
import { projectCourseArchitecture } from "@/server/course/projection/architecture";
import {
  FatalAgentRuntimeError,
  throwIfAgentAborted,
} from "@/server/agent/runtime";
import type { CourseRunRepository } from "@/server/course/store/repository";
import {
  AssetGenerationResultSchema,
  CourseArchitectureSchema,
  CourseCreationBriefSchema,
  CourseReviewSchema,
  HtmlOutputSchema,
  PageContentDSLSchema,
  PageSummarySchema,
  QualityReportSchema,
  ReferencePackSchema,
  WorkOrderSchema,
  validateReferenceUsages,
  type ArtifactKind,
  type CourseArchitecture,
  type CourseArtifact,
  type CourseCreationBrief,
  type PageContentDSL,
  type QualityReport,
  type ReferencePack,
  type Submission,
  type WorkOrder,
} from "@/shared/course-schema";
import { transitiveDependentPageIds } from "@/server/course/policy/run";

const PageAssetsSchema = z.array(AssetGenerationResultSchema).max(12);

export const PAGE_BUILDER_TOOL_NAMES =
  AgentToolSets.CoursePageBuilder;

export type PageBuilderToolName =
  (typeof PAGE_BUILDER_TOOL_NAMES)[number];

export type PageBuilderExecutionInput = {
  repository: CourseRunRepository;
  workOrder: WorkOrder;
  workOrderLeaseOwner: string;
  runLeaseOwner: string;
  traceId: string;
  creationBrief: CourseCreationBrief;
  referencePacks: ReferencePack[];
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
};

export type PageBuilderExecution = {
  repository: CourseRunRepository;
  initialWorkOrder: WorkOrder;
  architecture: CourseArchitecture;
  creationBrief: CourseCreationBrief;
  referencePacks: ReferencePack[];
  projection: ReturnType<typeof projectCourseArchitecture>;
  pageId: string;
  pageTask: CourseArchitecture["pageTasks"][number];
  pagePlan: ReturnType<
    typeof projectCourseArchitecture
  >["outline"]["pages"][number];
  pageBrief: ReturnType<
    typeof projectCourseArchitecture
  >["pageWorkerBriefs"][number];
  dependencySummaries: ReturnType<typeof PageSummarySchema.parse>[];
  baseline?: PageBuilderBaselineSnapshot;
  fixPlan?: PageBuilderFixPlan;
  traceId: string;
  workOrderLeaseOwner: string;
  runLeaseOwner: string;
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
  localResourceSession?: LocalResourceSession;
  currentLockVersion: number;
  progress: {
    contentGenerationFailures: number;
    contextRead: boolean;
    repairGenerationFailures: number;
    repairDeclinedTools: Set<string>;
  };
};

export type PageBuilderCheckpointSnapshot = {
  workOrder: WorkOrder;
  content?: PageContentDSL;
  assets?: ReturnType<typeof PageAssetsSchema.parse>;
  html?: ReturnType<typeof HtmlOutputSchema.parse>;
  quality?: QualityReport;
};

export type PageBuilderBaselineSnapshot = {
  content: PageContentDSL;
  assets?: ReturnType<typeof PageAssetsSchema.parse>;
  html: ReturnType<typeof HtmlOutputSchema.parse>;
  quality: QualityReport;
  summary: ReturnType<typeof PageSummarySchema.parse>;
};

export type PageBuilderFixPlan = {
  kind: "review_issue" | "dependency_refresh";
  targetArtifact: "page_content" | "page_html";
  issueIds: string[];
  feedback: string[];
};

export function createPageBuilderExecution(
  input: PageBuilderExecutionInput,
): PageBuilderExecution {
  const workOrder = WorkOrderSchema.parse(input.workOrder);
  const creationBrief = CourseCreationBriefSchema.parse(
    input.creationBrief,
  );
  const referencePacks = z
    .array(ReferencePackSchema)
    .max(3)
    .parse(input.referencePacks);
  assertInitialPageWorkOrder(workOrder, input);

  const architectureRef = workOrder.inputArtifactRefs.find(
    ({ kind }) => kind === "course_architecture",
  );
  if (!architectureRef) {
    throw new Error("Page WorkOrder 缺少 CourseArchitecture 输入");
  }
  const architectureArtifact = input.repository.artifacts.load(
    architectureRef.id,
  );
  assertArtifactMatchesRef(architectureArtifact, architectureRef);
  const architecture = CourseArchitectureSchema.parse(
    architectureArtifact.payload,
  );
  if (workOrder.scope.type !== "page") {
    throw new Error("Page WorkOrder 缺少 page scope");
  }
  const pageId = workOrder.scope.pageId;
  const pageTask = architecture.pageTasks.find(
    (candidate) => candidate.pageId === pageId,
  );
  if (!pageTask) {
    throw new Error(`课程架构中不存在页面 ${pageId}`);
  }
  const fixContext =
    workOrder.kind === "fix_page"
      ? loadPageBuilderFixContext({
          repository: input.repository,
          workOrder,
          architecture,
          pageId,
        })
      : undefined;
  const referenceInputIssues = validateReferenceUsages(
    pageTask.referenceUsages,
    referencePacks,
  );
  if (referenceInputIssues.length > 0) {
    throw new FatalAgentRuntimeError(
      "PAGE_REFERENCE_INPUT_INVALID",
      `PageTask 的封口资料引用不可用：${referenceInputIssues.join("；")}`,
    );
  }

  const projection = projectCourseArchitecture(
    architecture,
    creationBrief,
  );
  const pagePlan = projection.outline.pages.find(
    (page) => page.id === pageId,
  );
  const pageBrief = projection.pageWorkerBriefs.find(
    (brief) => brief.pageId === pageId,
  );
  if (!pagePlan || !pageBrief) {
    throw new Error(`页面 ${pageId} 无法投影为旧生成步骤输入`);
  }

  const dependencySummaryRefs = new Map(
    workOrder.inputArtifactRefs
      .filter(
        ({ kind, pageId: dependencyPageId }) =>
          kind === "page_summary" &&
          dependencyPageId !== undefined &&
          pageTask.buildDependsOnPageIds.includes(
            dependencyPageId,
          ),
      )
      .sort((left, right) => left.revision - right.revision)
      .map((ref) => [ref.pageId!, ref]),
  );
  const dependencySummaries = [
    ...dependencySummaryRefs.values(),
  ].map((ref) => {
      const artifact = input.repository.artifacts.load(ref.id);
      assertArtifactMatchesRef(artifact, ref);
      return PageSummarySchema.parse(artifact.payload);
    });
  const expectedDependencies = new Set(
    pageTask.buildDependsOnPageIds,
  );
  if (
    dependencySummaries.length !== expectedDependencies.size ||
    dependencySummaries.some(
      ({ pageId: dependencyPageId }) =>
        !expectedDependencies.has(dependencyPageId),
    )
  ) {
    throw new Error("Page WorkOrder 的前置 PageSummary 没有完整封口");
  }

  return {
    repository: input.repository,
    initialWorkOrder: workOrder,
    architecture,
    creationBrief,
    referencePacks,
    projection,
    pageId,
    pageTask,
    pagePlan,
    pageBrief,
    dependencySummaries,
    ...(fixContext
      ? {
          baseline: fixContext.baseline,
          fixPlan: fixContext.plan,
        }
      : {}),
    traceId: input.traceId,
    workOrderLeaseOwner: input.workOrderLeaseOwner,
    runLeaseOwner: input.runLeaseOwner,
    abortSignal: input.abortSignal,
    beforeToolCall: input.beforeToolCall,
    currentLockVersion: workOrder.lockVersion,
    progress: loadPageBuilderProgress(input.repository, workOrder),
  };
}

export function assertPageBuilderToolCall(
  execution: PageBuilderExecution,
  input: {
    input: unknown;
    toolName: string;
  },
  now = new Date().toISOString(),
) {
  throwIfAgentAborted(execution.abortSignal);
  if (
    !PAGE_BUILDER_TOOL_NAMES.includes(
      input.toolName as PageBuilderToolName,
    )
  ) {
    throw forbidden(input.toolName, "不是 Page Builder 工具");
  }
  const toolInput = input.input as {
    pageId?: unknown;
    referencePackId?: unknown;
    chunkIds?: unknown;
  };
  if (
    input.toolName !== ToolIds.ReadLocalResource &&
    toolInput?.pageId !== execution.pageId
  ) {
    throw forbidden(input.toolName, "pageId 超出 WorkOrder scope");
  }

  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  const run = execution.repository.runs.loadByTaskId(
    execution.initialWorkOrder.taskId,
  );
  if (!workOrder || !run) {
    throw staleFence("WorkOrder 或 CourseRun 已不存在");
  }
  if (
    workOrder.status !== "running" ||
    workOrder.kind !== execution.initialWorkOrder.kind ||
    workOrder.scope.type !== "page" ||
    workOrder.scope.pageId !== execution.pageId ||
    workOrder.lockVersion !== execution.currentLockVersion ||
    workOrder.leaseOwner !== execution.workOrderLeaseOwner ||
    !workOrder.inputSealedAt
  ) {
    throw staleFence("Page WorkOrder lease 或版本围栏失效");
  }
  if (
    run.traceId !== execution.traceId ||
    run.leaseOwner !== execution.runLeaseOwner ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= now
  ) {
    throw staleFence("CourseRun trace 或 lease 围栏失效");
  }
  if (!workOrder.allowedTools.includes(input.toolName)) {
    throw forbidden(input.toolName, "不在 allowedTools 中");
  }
  if (
    workOrder.kind === "fix_page" &&
    input.toolName !== ToolIds.ReadPageContext &&
    input.toolName !== ToolIds.SearchReferences &&
    input.toolName !== ToolIds.ReadLocalResource &&
    !execution.progress.contextRead
  ) {
    throw forbidden(
      input.toolName,
      "Fix WorkOrder 必须先读取本页 Review 原因和最新依赖上下文",
    );
  }
  if (
    workOrder.kind === "fix_page" &&
    execution.fixPlan?.targetArtifact === "page_html" &&
    ([
      ToolIds.GeneratePageContent,
      ToolIds.ResolvePageAssets,
      ToolIds.RepairPageContent,
    ] as string[]).includes(input.toolName)
  ) {
    throw forbidden(
      input.toolName,
      "HTML 定向返工只能复用 baseline 内容和素材，不能改写课程内容",
    );
  }
  if (
    !workOrder.leaseExpiresAt ||
    workOrder.leaseExpiresAt <= now
  ) {
    throw staleFence("Page WorkOrder lease 已过期");
  }

  if (input.toolName === ToolIds.SearchReferences) {
    assertAuthorizedReferenceInput(execution, toolInput);
  }
  return true;
}

export function loadPageBuilderSnapshot(
  execution: PageBuilderExecution,
): PageBuilderCheckpointSnapshot {
  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  if (!workOrder) throw staleFence("Page WorkOrder 已不存在");

  return {
    workOrder,
    content: parseCheckpoint(
      execution,
      workOrder,
      "page_content",
      PageContentDSLSchema,
    ),
    assets: parseCheckpoint(
      execution,
      workOrder,
      "page_assets",
      PageAssetsSchema,
    ),
    html: parseCheckpoint(
      execution,
      workOrder,
      "page_html",
      HtmlOutputSchema,
    ),
    quality: parseCheckpoint(
      execution,
      workOrder,
      "page_quality",
      QualityReportSchema,
    ),
  };
}

/**
 * 旧页面只能作为 Fix 的封口 baseline。只有 HTML 定向返工可以继续使用未改动的
 * baseline 内容和素材；旧 HTML、旧 Quality 永远不会冒充当前 checkpoint。
 */
export function loadPageBuilderWorkingSnapshot(
  execution: PageBuilderExecution,
): PageBuilderCheckpointSnapshot {
  const current = loadPageBuilderSnapshot(execution);
  if (
    execution.initialWorkOrder.kind !== "fix_page" ||
    execution.fixPlan?.targetArtifact !== "page_html" ||
    current.content ||
    !execution.baseline
  ) {
    return current;
  }
  return {
    ...current,
    content: execution.baseline.content,
    assets: execution.baseline.assets,
  };
}

export function hasPageBuilderSubstantiveFix(
  execution: PageBuilderExecution,
  snapshot = loadPageBuilderSnapshot(execution),
) {
  if (execution.initialWorkOrder.kind !== "fix_page") return true;
  if (!execution.fixPlan) return false;
  return execution.fixPlan.targetArtifact === "page_content"
    ? Boolean(snapshot.content)
    : Boolean(snapshot.html);
}

export function loadPageBuilderTerminal(
  execution: PageBuilderExecution,
) {
  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  const run = execution.repository.runs.loadByTaskId(
    execution.initialWorkOrder.taskId,
  );
  return { workOrder, run };
}

export function parsePageBuilderTerminal(
  execution: PageBuilderExecution,
  value: unknown,
): {
  status: "accepted" | "blocked";
  submission: Submission;
} | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("workOrder" in value) ||
    !("run" in value)
  ) {
    return null;
  }
  const candidate = value as {
    workOrder?: unknown;
    run?: { traceId?: unknown };
  };
  const parsed = WorkOrderSchema.safeParse(candidate.workOrder);
  if (
    !parsed.success ||
    candidate.run?.traceId !== execution.traceId ||
    !parsed.data.submission ||
    (parsed.data.status !== "accepted" &&
      parsed.data.status !== "blocked")
  ) {
    return null;
  }
  return {
    status: parsed.data.status,
    submission: parsed.data.submission,
  };
}

export function countPageBuilderRepairs(
  execution: PageBuilderExecution,
) {
  return execution.repository.events
    .list(execution.initialWorkOrder.taskId)
    .filter((event) => {
      if (
        event.type !== "page_checkpoint_saved" ||
        typeof event.payload !== "object" ||
        event.payload === null
      ) {
        return false;
      }
      const payload = event.payload as {
        workOrderId?: unknown;
        toolName?: unknown;
      };
      return (
        payload.workOrderId === execution.initialWorkOrder.id &&
        (payload.toolName === ToolIds.RepairPageContent ||
          payload.toolName === ToolIds.RepairPageHtml)
      );
    }).length;
}

export function recordPageBuilderRepairDeclined(
  execution: PageBuilderExecution,
  toolName: PageBuilderToolName,
) {
  execution.progress.repairDeclinedTools.add(toolName);
}

export function clearPageBuilderRepairDeclined(
  execution: PageBuilderExecution,
) {
  execution.progress.repairDeclinedTools.clear();
}

export function hasPageBuilderRepairDeclined(
  execution: PageBuilderExecution,
) {
  return execution.progress.repairDeclinedTools.size > 0;
}

function loadPageBuilderProgress(
  repository: CourseRunRepository,
  workOrder: WorkOrder,
): PageBuilderExecution["progress"] {
  const repairDeclinedTools = new Set<string>();
  let contentGenerationFailures = 0;
  let contextRead = false;
  let repairGenerationFailures = 0;
  const operations = repository.toolOperations
    .listByWorkOrder(workOrder.id)
    .sort(
      (left, right) =>
        left.executionAttempt - right.executionAttempt ||
        left.toolOrdinal - right.toolOrdinal,
    );

  operations.forEach((operation) => {
    if (
      operation.executionAttempt === workOrder.executionAttempt &&
      operation.toolName === ToolIds.ReadPageContext &&
      operation.status === "completed"
    ) {
      contextRead = true;
    }
    if (
      operation.toolName === ToolIds.GeneratePageContent &&
      operation.status === "completed" &&
      operation.safeSummary?.startsWith(
        "PAGE_CONTENT_GENERATION_FAILED:",
      )
    ) {
      contentGenerationFailures += 1;
    }
    if (
      isRepairToolName(operation.toolName) &&
      operation.status === "completed"
    ) {
      repairGenerationFailures = operation.safeSummary?.startsWith(
        "PAGE_REPAIR_FAILED:",
      )
        ? repairGenerationFailures + 1
        : 0;
    }
  });

  loadRepairProgressFacts(repository, workOrder).forEach((fact) => {
    if (fact.outcome === "declined") {
      repairDeclinedTools.add(fact.toolName);
    } else {
      repairDeclinedTools.clear();
    }
  });

  return {
    contentGenerationFailures,
    contextRead,
    repairGenerationFailures,
    repairDeclinedTools,
  };
}

type RepairProgressFact = {
  executionAttempt: number;
  outcome: "applied" | "declined";
  sequence: number;
  toolName:
    | typeof ToolIds.RepairPageContent
    | typeof ToolIds.RepairPageHtml;
  toolOrdinal?: number;
};

function loadRepairProgressFacts(
  repository: CourseRunRepository,
  workOrder: WorkOrder,
) {
  // declined 和成功 checkpoint 都先写入同一条持久化事件序列；即使进程在
  // Tool ledger complete 前退出，也能按 executionAttempt + sequence 恢复。
  return repository.events
    .list(workOrder.taskId)
    .flatMap((event): RepairProgressFact[] => {
      if (
        typeof event.payload !== "object" ||
        event.payload === null
      ) {
        return [];
      }
      const payload = event.payload as {
        artifactRef?: { kind?: unknown };
        executionAttempt?: unknown;
        resultCode?: unknown;
        toolName?: unknown;
        toolOrdinal?: unknown;
        workOrderId?: unknown;
      };
      if (
        payload.workOrderId !== workOrder.id ||
        !isRepairToolName(payload.toolName) ||
        !Number.isSafeInteger(payload.executionAttempt) ||
        (payload.executionAttempt as number) < 1
      ) {
        return [];
      }
      const position = {
        executionAttempt: payload.executionAttempt as number,
        sequence: event.sequence,
        toolName: payload.toolName,
        ...(Number.isSafeInteger(payload.toolOrdinal) &&
        (payload.toolOrdinal as number) > 0
          ? { toolOrdinal: payload.toolOrdinal as number }
          : {}),
      };
      if (
        event.type === "page_repair_declined" &&
        payload.resultCode === "PAGE_REPAIR_DECLINED"
      ) {
        return [{ ...position, outcome: "declined" }];
      }
      if (
        event.type === "page_checkpoint_saved" &&
        payload.artifactRef?.kind ===
          (payload.toolName === ToolIds.RepairPageContent
            ? "page_content"
            : "page_html")
      ) {
        return [{ ...position, outcome: "applied" }];
      }
      return [];
    })
    .sort(
      (left, right) =>
        left.executionAttempt - right.executionAttempt ||
        left.sequence - right.sequence,
    );
}

function isRepairToolName(
  value: unknown,
): value is
  | typeof ToolIds.RepairPageContent
  | typeof ToolIds.RepairPageHtml {
  return (
    value === ToolIds.RepairPageContent ||
    value === ToolIds.RepairPageHtml
  );
}

function parseCheckpoint<Output>(
  execution: PageBuilderExecution,
  workOrder: WorkOrder,
  kind: ArtifactKind,
  schema: { parse(value: unknown): Output },
) {
  const ref = workOrder.checkpointArtifactRefs.find(
    (candidate) => candidate.kind === kind,
  );
  if (!ref) return undefined;
  const artifact = execution.repository.artifacts.load(ref.id);
  assertArtifactMatchesRef(artifact, ref);
  if (
    artifact.createdByWorkOrderId !== workOrder.id ||
    artifact.pageId !== execution.pageId
  ) {
    throw staleFence(`${kind} checkpoint 超出当前 WorkOrder scope`);
  }
  return schema.parse(artifact.payload);
}

function loadPageBuilderFixContext(input: {
  repository: CourseRunRepository;
  workOrder: WorkOrder;
  architecture: CourseArchitecture;
  pageId: string;
}): {
  baseline: PageBuilderBaselineSnapshot;
  plan: PageBuilderFixPlan;
} {
  const reviewRef = input.workOrder.inputArtifactRefs.find(
    ({ kind }) => kind === "course_review",
  );
  if (!reviewRef) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_REVIEW_MISSING",
      "Fix WorkOrder 缺少封口 CourseReview。",
    );
  }
  const reviewArtifact = input.repository.artifacts.load(reviewRef.id);
  assertArtifactMatchesRef(reviewArtifact, reviewRef);
  const review = CourseReviewSchema.parse(reviewArtifact.payload);
  if (
    review.courseId !== input.workOrder.courseId ||
    review.decision !== "revise_pages"
  ) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_REVIEW_INVALID",
      "Fix WorkOrder 只能引用当前课程的 revise_pages Review。",
    );
  }

  const causedIds = new Set(input.workOrder.causedByReviewIssueIds);
  if (causedIds.size === 0) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_CAUSE_MISSING",
      "Fix WorkOrder 必须明确引用 Review issue。",
    );
  }
  const causedIssues = review.issues.filter(({ id }) => causedIds.has(id));
  if (causedIssues.length !== causedIds.size) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_CAUSE_INVALID",
      "Fix WorkOrder 引用了不存在的 Review issue。",
    );
  }
  const directIssues = causedIssues.filter(
    (issue) =>
      issue.scope === "page" && issue.pageId === input.pageId,
  );

  let plan: PageBuilderFixPlan;
  if (directIssues.length > 0) {
    const targetArtifact = directIssues.some(
      (issue) => issue.targetArtifact === "page_content",
    )
      ? "page_content"
      : "page_html";
    plan = {
      kind: "review_issue",
      targetArtifact,
      issueIds: directIssues.map(({ id }) => id),
      feedback: directIssues.map(
        ({ code, message }) => `${code}: ${message}`,
      ),
    };
  } else {
    const sourcePageIds = causedIssues.flatMap((issue) =>
      issue.scope === "page" && issue.pageId ? [issue.pageId] : [],
    );
    const dependencyClosure = new Set(
      transitiveDependentPageIds(input.architecture, sourcePageIds),
    );
    if (!dependencyClosure.has(input.pageId)) {
      throw new FatalAgentRuntimeError(
        "PAGE_FIX_SCOPE_INVALID",
        "Fix WorkOrder 既没有本页 Review issue，也不在问题页的依赖失效闭包内。",
      );
    }
    plan = {
      kind: "dependency_refresh",
      targetArtifact: "page_content",
      issueIds: causedIssues.map(({ id }) => id),
      feedback: [
        "上游页面摘要已经变化，必须结合新的依赖上下文重新生成并验证本页。",
      ],
    };
  }

  const baseline = {
    content: loadBaselineArtifact(
      input,
      "page_content",
      PageContentDSLSchema,
    ),
    assets: loadOptionalBaselineArtifact(
      input,
      "page_assets",
      PageAssetsSchema,
    ),
    html: loadBaselineArtifact(input, "page_html", HtmlOutputSchema),
    quality: loadBaselineArtifact(
      input,
      "page_quality",
      QualityReportSchema,
    ),
    summary: loadBaselineArtifact(
      input,
      "page_summary",
      PageSummarySchema,
    ),
  };
  if (baseline.content.assetSlots.length > 0 && !baseline.assets) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_BASELINE_INVALID",
      "Fix WorkOrder 的 baseline 内容声明了素材槽，但缺少素材产物。",
    );
  }
  if (
    baseline.content.pageId !== input.pageId ||
    baseline.summary.pageId !== input.pageId ||
    baseline.quality.target.type !== "page" ||
    baseline.quality.target.pageId !== input.pageId
  ) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_BASELINE_SCOPE_INVALID",
      "Fix WorkOrder 的 baseline payload 与当前页面 scope 不一致。",
    );
  }
  return { baseline, plan };
}

function loadBaselineArtifact<Output>(
  input: {
    repository: CourseRunRepository;
    workOrder: WorkOrder;
    pageId: string;
  },
  kind: ArtifactKind,
  schema: { parse(value: unknown): Output },
) {
  const value = loadOptionalBaselineArtifact(input, kind, schema);
  if (value === undefined) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_BASELINE_MISSING",
      `Fix WorkOrder 缺少 ${kind} baseline。`,
    );
  }
  return value;
}

function loadOptionalBaselineArtifact<Output>(
  input: {
    repository: CourseRunRepository;
    workOrder: WorkOrder;
    pageId: string;
  },
  kind: ArtifactKind,
  schema: { parse(value: unknown): Output },
) {
  const refs = input.workOrder.inputArtifactRefs.filter(
    (candidate) =>
      candidate.kind === kind && candidate.pageId === input.pageId,
  );
  if (refs.length > 1) {
    throw new FatalAgentRuntimeError(
      "PAGE_FIX_BASELINE_AMBIGUOUS",
      `Fix WorkOrder 包含多份 ${kind} baseline。`,
    );
  }
  const ref = refs[0];
  if (!ref) return undefined;
  const artifact = input.repository.artifacts.load(ref.id);
  assertArtifactMatchesRef(artifact, ref);
  return schema.parse(artifact.payload);
}

function assertInitialPageWorkOrder(
  workOrder: WorkOrder,
  input: PageBuilderExecutionInput,
) {
  if (
    (workOrder.kind !== "build_page" &&
      workOrder.kind !== "fix_page") ||
    workOrder.scope.type !== "page" ||
    workOrder.status !== "running" ||
    workOrder.leaseOwner !== input.workOrderLeaseOwner ||
    !workOrder.inputSealedAt
  ) {
    throw new Error("Page Builder 只能执行已封口且持有 lease 的页面 WorkOrder");
  }
  if (
    workOrder.taskId.length === 0 ||
    input.traceId.length === 0 ||
    input.runLeaseOwner.length === 0
  ) {
    throw new Error("Page Builder 缺少 task、trace 或 CourseRun lease");
  }
}

function assertArtifactMatchesRef(
  artifact: CourseArtifact | undefined,
  ref: {
    id: string;
    contentHash: string;
    courseId: string;
    kind: ArtifactKind;
    pageId?: string;
    scopeKey: string;
    revision: number;
  },
): asserts artifact is CourseArtifact {
  if (
    !artifact ||
    artifact.id !== ref.id ||
    artifact.contentHash !== ref.contentHash ||
    artifact.courseId !== ref.courseId ||
    artifact.kind !== ref.kind ||
    artifact.pageId !== ref.pageId ||
    artifact.scopeKey !== ref.scopeKey ||
    artifact.revision !== ref.revision
  ) {
    throw staleFence(`Artifact ${ref.id} 与封口引用不一致`);
  }
}

function assertAuthorizedReferenceInput(
  execution: PageBuilderExecution,
  input: {
    referencePackId?: unknown;
    chunkIds?: unknown;
  },
) {
  const allowedByPack = new Map(
    execution.pageTask.referenceUsages.map((usage) => [
      usage.referencePackId,
      new Set(usage.chunkIds),
    ]),
  );
  if (
    typeof input.referencePackId === "string" &&
    !allowedByPack.has(input.referencePackId)
  ) {
    throw forbidden(
      ToolIds.SearchReferences,
      `资料 ${input.referencePackId} 未授权`,
    );
  }
  if (Array.isArray(input.chunkIds)) {
    const packId =
      typeof input.referencePackId === "string"
        ? input.referencePackId
        : undefined;
    if (!packId) {
      throw forbidden(
        ToolIds.SearchReferences,
        "指定 chunkIds 时必须同时指定 referencePackId",
      );
    }
    const allowedChunks = allowedByPack.get(packId);
    if (
      input.chunkIds.some(
        (chunkId) =>
          typeof chunkId !== "string" ||
          !allowedChunks?.has(chunkId),
      )
    ) {
      throw forbidden(
        ToolIds.SearchReferences,
        "请求了未授权的资料 chunk",
      );
    }
  }
}

function forbidden(toolName: string, detail: string) {
  return new FatalAgentRuntimeError(
    "AGENT_TOOL_FORBIDDEN",
    `当前 WorkOrder 无权执行工具 ${toolName}：${detail}。`,
  );
}

function staleFence(message: string) {
  return new FatalAgentRuntimeError(
    "TRACE_FENCING_FAILED",
    message,
  );
}
