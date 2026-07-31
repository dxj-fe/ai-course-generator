import {
  CourseArchitectureSchema,
  CourseManifestSchema,
  PageSummarySchema,
  QualityReportSchema,
  WorkOrderSchema,
  type AgentBudget,
  type ArtifactRef,
  type CourseArchitecture,
  type CourseArtifact,
  type CourseManifest,
  type PageSummary,
  type QualityReport,
  type Submission,
  type WorkOrder,
} from "@/shared/course-schema";
import {
  buildCurrentCourseManifest,
  computeCourseManifestHash,
  type CourseGateIssue,
} from "@/server/course/gate/review";
import {
  FatalAgentRuntimeError,
  throwIfAgentAborted,
} from "@/server/agent/runtime";
import {
  AgentIds,
  ToolIds,
} from "@/server/agent/ids";
import { getAgentWorkOrderDefaults } from "@/server/agent/plugins/agents/catalog";
import type { CourseRunRepository } from "@/server/course/store/repository";

const REVIEWER_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CourseReviewer,
);

/**
 * Reviewer 的证据工具一次最多返回 20 页。课程和 manifest 的 Schema
 * 都允许 200 页，因此预算必须按批次数增长，不能写死成只够小课程的常量。
 */
export const COURSE_REVIEWER_PAGE_BATCH_LIMIT = 20;

export function createCourseReviewerBudget(
  pageCount: number,
): AgentBudget {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 200) {
    throw new Error("Reviewer 页面数必须是 1 到 200 的整数。");
  }

  const evidenceBatchCount = Math.ceil(
    pageCount / COURSE_REVIEWER_PAGE_BATCH_LIMIT,
  );
  // 必需调用：课程矩阵 1 次、摘要/质量各 N 批、校验 1 次、终态 1 次。
  const requiredToolCalls = 2 * evidenceBatchCount + 3;
  // 每批额外留 1 次定向核对，再留 6 次修正/重试；最大课程仍只有 35 次。
  const boundedToolCalls =
    requiredToolCalls + evidenceBatchCount + 6;

  return {
    maxSteps: Math.min(
      boundedToolCalls,
      REVIEWER_DEFAULTS.budget.maxSteps,
    ),
    maxToolCalls: Math.min(
      boundedToolCalls,
      REVIEWER_DEFAULTS.budget.maxToolCalls,
    ),
    timeoutMs: Math.min(
      180_000 + (evidenceBatchCount - 1) * 30_000,
      REVIEWER_DEFAULTS.budget.timeoutMs,
    ),
    maxOutputTokens: REVIEWER_DEFAULTS.budget.maxOutputTokens,
  };
}

export const COURSE_REVIEWER_TOOL_NAMES =
  REVIEWER_DEFAULTS.allowedTools;

export type CourseReviewerToolName =
  (typeof COURSE_REVIEWER_TOOL_NAMES)[number];

export type CourseReviewerExecutionInput = {
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
  repository: CourseRunRepository;
  runLeaseOwner: string;
  traceId: string;
  workOrder: WorkOrder;
  workOrderLeaseOwner: string;
};

export type CourseReviewerExecution = {
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
  architecture: CourseArchitecture;
  evidenceReadProgress: {
    courseMatrixRead: boolean;
    qualityPageIds: Set<string>;
    qualityReachedEnd: boolean;
    summaryPageIds: Set<string>;
    summaryReachedEnd: boolean;
  };
  frozenManifest: CourseManifest;
  frozenManifestHash: string;
  initialWorkOrder: WorkOrder;
  repository: CourseRunRepository;
  runLeaseOwner: string;
  traceId: string;
  workOrderLeaseOwner: string;
};

export type CourseReviewerSnapshot = {
  architecture: CourseArchitecture;
  manifest: CourseManifest;
  pageQualities: Map<string, QualityReport>;
  pageSummaries: Map<string, PageSummary>;
  workOrder: WorkOrder;
};

export function createCourseReviewerExecution(
  input: CourseReviewerExecutionInput,
): CourseReviewerExecution {
  const workOrder = WorkOrderSchema.parse(input.workOrder);
  if (
    workOrder.kind !== "review_course" ||
    workOrder.scope.type !== "course" ||
    workOrder.status !== "running" ||
    workOrder.leaseOwner !== input.workOrderLeaseOwner ||
    !workOrder.inputSealedAt
  ) {
    throw fatal(
      "REVIEWER_WORK_ORDER_INVALID",
      "Course Reviewer 只能执行已封口并由当前 worker claim 的 review_course WorkOrder。",
    );
  }
  if (
    !workOrder.allowedTools.includes(ToolIds.SubmitCourseReview)
  ) {
    throw fatal(
      "REVIEWER_SUBMIT_TOOL_MISSING",
      "Reviewer WorkOrder 没有提交整课审查的权限。",
    );
  }

  const architectureRef = requiredInputRef(
    workOrder,
    "course_architecture",
  );
  const manifestRef = requiredInputRef(workOrder, "course_manifest");
  const architecture = CourseArchitectureSchema.parse(
    loadExactArtifact(input.repository, architectureRef).payload,
  );
  const frozenManifest = CourseManifestSchema.parse(
    loadExactArtifact(input.repository, manifestRef).payload,
  );
  const frozenManifestHash = computeCourseManifestHash(frozenManifest);
  if (
    architecture.courseId !== workOrder.courseId ||
    frozenManifest.courseId !== workOrder.courseId ||
    !sameArtifactRef(frozenManifest.architectureRef, architectureRef)
  ) {
    throw fatal(
      "REVIEWER_INPUT_SCOPE_INVALID",
      "Reviewer 的 Architecture、manifest 与 WorkOrder 课程范围不一致。",
    );
  }

  const execution: CourseReviewerExecution = {
    abortSignal: input.abortSignal,
    beforeToolCall: input.beforeToolCall,
    architecture,
    evidenceReadProgress: {
      courseMatrixRead: false,
      qualityPageIds: new Set(),
      qualityReachedEnd: false,
      summaryPageIds: new Set(),
      summaryReachedEnd: false,
    },
    frozenManifest,
    frozenManifestHash,
    initialWorkOrder: workOrder,
    repository: input.repository,
    runLeaseOwner: input.runLeaseOwner,
    traceId: input.traceId,
    workOrderLeaseOwner: input.workOrderLeaseOwner,
  };
  loadCourseReviewerSnapshot(execution);
  return execution;
}

export function authorizeCourseReviewerToolCall(
  execution: CourseReviewerExecution,
  input: {
    input: unknown;
    toolName: string;
  },
  now: string,
) {
  throwIfAgentAborted(execution.abortSignal);
  if (
    !COURSE_REVIEWER_TOOL_NAMES.includes(
      input.toolName as CourseReviewerToolName,
    ) ||
    !execution.initialWorkOrder.allowedTools.includes(input.toolName)
  ) {
    return false;
  }

  const current = assertCurrentReviewerState(execution, now, true);
  if (!current.allowedTools.includes(input.toolName)) return false;
  if (
    input.toolName === ToolIds.BlockCourseReview &&
    !isCourseReviewerBlockEligible(execution)
  ) {
    return false;
  }

  const pageId = readPageId(input.input);
  if (
    pageId &&
    !execution.frozenManifest.pages.some(
      (page) => page.pageId === pageId,
    )
  ) {
    throw fatal(
      "REVIEWER_PAGE_OUT_OF_SCOPE",
      `页面 ${pageId} 不在当前 Reviewer manifest 中。`,
    );
  }

  return true;
}

export function loadCourseReviewerSnapshot(
  execution: CourseReviewerExecution,
): CourseReviewerSnapshot {
  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  if (!workOrder) {
    throw fatal("REVIEWER_STATE_MISSING", "Reviewer WorkOrder 已不存在。");
  }

  const pageSummaries = new Map<string, PageSummary>();
  const pageQualities = new Map<string, QualityReport>();
  for (const page of execution.frozenManifest.pages) {
    assertRefIsSealedByManifest(execution.frozenManifest, page.summaryRef);
    assertRefIsSealedByManifest(execution.frozenManifest, page.qualityRef);
    const summary = PageSummarySchema.parse(
      loadExactArtifact(execution.repository, page.summaryRef).payload,
    );
    const quality = QualityReportSchema.parse(
      loadExactArtifact(execution.repository, page.qualityRef).payload,
    );
    if (
      summary.pageId !== page.pageId ||
      quality.target.type !== "page" ||
      quality.target.pageId !== page.pageId
    ) {
      throw fatal(
        "REVIEWER_PAGE_EVIDENCE_INVALID",
        `页面 ${page.pageId} 的摘要或质量证据 scope 不一致。`,
      );
    }
    pageSummaries.set(page.pageId, summary);
    pageQualities.set(page.pageId, quality);
  }

  return {
    architecture: execution.architecture,
    manifest: execution.frozenManifest,
    pageQualities,
    pageSummaries,
    workOrder,
  };
}

export function collectUnreadCourseReviewerEvidenceIssues(
  execution: CourseReviewerExecution,
): CourseGateIssue[] {
  const expectedPageIds = execution.frozenManifest.pages.map(
    ({ pageId }) => pageId,
  );
  const progress = execution.evidenceReadProgress;
  const issues: CourseGateIssue[] = [];
  if (!progress.courseMatrixRead) {
    issues.push({
      code: "REVIEWER_COURSE_MATRIX_NOT_READ",
      path: ToolIds.ReadCourseMatrix,
      message: "课程目标、事实底稿和页面职责矩阵尚未读取。",
    });
  }
  const checks = [
    {
      code: "REVIEWER_SUMMARY_NOT_FULLY_READ",
      path: ToolIds.ReadPageSummary,
      readPageIds: progress.summaryPageIds,
      reachedEnd: progress.summaryReachedEnd,
      label: "页面摘要",
    },
    {
      code: "REVIEWER_QUALITY_NOT_FULLY_READ",
      path: ToolIds.ReadPageQuality,
      readPageIds: progress.qualityPageIds,
      reachedEnd: progress.qualityReachedEnd,
      label: "页面质量报告",
    },
  ] as const;

  issues.push(
    ...checks.flatMap((check) => {
      const unreadPageIds = expectedPageIds.filter(
        (pageId) => !check.readPageIds.has(pageId),
      );
      if (unreadPageIds.length === 0 && check.reachedEnd) return [];
      return [
        {
          code: check.code,
          path: check.path,
          message: `${check.label}尚未按分页游标读到末尾；未读页面：${
            unreadPageIds.join("、") ||
            "无（但 nextOffset 尚未到 null）"
          }`,
        },
      ];
    }),
  );
  return issues;
}

/**
 * blocked 只处理 Reviewer 无权修复的封口合同矛盾。
 * 内容质量、跨页重复或 PageTask 漂移都能写成 revise/replan，不能借此阻塞。
 */
export function collectCourseReviewerEvidenceContractConflicts(
  execution: CourseReviewerExecution,
): CourseGateIssue[] {
  const snapshot = loadCourseReviewerSnapshot(execution);
  const conflicts: CourseGateIssue[] = [];
  for (const manifestPage of snapshot.manifest.pages) {
    const summary = snapshot.pageSummaries.get(manifestPage.pageId)!;
    const quality = snapshot.pageQualities.get(manifestPage.pageId)!;
    if (
      summary.courseId !== snapshot.manifest.courseId ||
      summary.order !== manifestPage.order
    ) {
      conflicts.push({
        code: "REVIEWER_EVIDENCE_CONTRACT_CONFLICT",
        path: `pages.${manifestPage.pageId}.summary`,
        message: `页面 ${manifestPage.pageId} 的 PageSummary 课程或顺序与封口 manifest 矛盾。`,
      });
    }

    const qualityIssueCodes = quality.issues.map(({ code }) => code);
    if (
      summary.quality.overallScore !== quality.overallScore ||
      summary.quality.decision !== quality.decision ||
      !sameStringValues(summary.quality.issueCodes, qualityIssueCodes)
    ) {
      conflicts.push({
        code: "REVIEWER_EVIDENCE_CONTRACT_CONFLICT",
        path: `pages.${manifestPage.pageId}.quality`,
        message: `页面 ${manifestPage.pageId} 的 PageSummary 质量投影与封口 PageQuality 矛盾。`,
      });
    }
  }
  return conflicts;
}

export function isCourseReviewerBlockEligible(
  execution: CourseReviewerExecution,
) {
  return (
    collectUnreadCourseReviewerEvidenceIssues(execution).length === 0 &&
    collectCourseReviewerEvidenceContractConflicts(execution).length > 0
  );
}

export function resolveCourseReviewerActiveTools(
  execution: CourseReviewerExecution,
): CourseReviewerToolName[] {
  const current = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  if (!current || current.status !== "running") return [];
  return COURSE_REVIEWER_TOOL_NAMES.filter(
    (toolName) =>
      current.allowedTools.includes(toolName) &&
      (toolName !== ToolIds.BlockCourseReview ||
        isCourseReviewerBlockEligible(execution)),
  );
}

export function loadCourseReviewerTerminal(
  execution: CourseReviewerExecution,
) {
  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  const run = workOrder
    ? execution.repository.runs.loadByTaskId(workOrder.taskId)
    : undefined;
  return { run, workOrder };
}

export function parseCourseReviewerTerminal(
  execution: CourseReviewerExecution,
  value: unknown,
): {
  status: "blocked" | "submitted";
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
    run?: { currentManifestHash?: unknown; traceId?: unknown };
    workOrder?: unknown;
  };
  const parsed = WorkOrderSchema.safeParse(candidate.workOrder);
  if (
    !parsed.success ||
    parsed.data.id !== execution.initialWorkOrder.id ||
    candidate.run?.traceId !== execution.traceId ||
    !parsed.data.submission ||
    (parsed.data.status !== "submitted" &&
      parsed.data.status !== "blocked")
  ) {
    return null;
  }
  if (
    parsed.data.status === "submitted" &&
    (candidate.run.currentManifestHash !== execution.frozenManifestHash ||
      !parsed.data.submission.artifactRefs.some(
        ({ kind }) => kind === "course_review",
      ))
  ) {
    return null;
  }
  return {
    status: parsed.data.status,
    submission: parsed.data.submission,
  };
}

function assertCurrentReviewerState(
  execution: CourseReviewerExecution,
  now: string,
  allowCommitted: boolean,
) {
  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  const run = execution.repository.runs.loadByTaskId(
    execution.initialWorkOrder.taskId,
  );
  if (!workOrder || !run) {
    throw fatal(
      "REVIEWER_RUNTIME_STATE_MISSING",
      "找不到当前 Reviewer WorkOrder 或 CourseRun。",
    );
  }
  if (
    workOrder.taskId !== execution.initialWorkOrder.taskId ||
    workOrder.courseId !== execution.initialWorkOrder.courseId ||
    workOrder.kind !== "review_course" ||
    workOrder.scope.type !== "course" ||
    !workOrder.inputSealedAt
  ) {
    throw fatal(
      "REVIEWER_WORK_ORDER_SCOPE_CHANGED",
      "Reviewer WorkOrder 的任务、课程或 scope 已变化。",
    );
  }
  if (
    run.taskId !== workOrder.taskId ||
    run.courseId !== workOrder.courseId ||
    run.traceId !== execution.traceId
  ) {
    throw fatal(
      "REVIEWER_TRACE_FENCING_FAILED",
      "CourseRun trace 或课程范围已变化，拒绝旧 Reviewer 继续执行。",
    );
  }
  if (
    run.leaseOwner !== execution.runLeaseOwner ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= now
  ) {
    throw fatal(
      "REVIEWER_RUN_LEASE_INVALID",
      "CourseRun lease 已失效。",
    );
  }

  const committed =
    workOrder.status === "submitted" || workOrder.status === "blocked";
  if (!allowCommitted || !committed) {
    if (
      workOrder.status !== "running" ||
      workOrder.leaseOwner !== execution.workOrderLeaseOwner ||
      !workOrder.leaseExpiresAt ||
      workOrder.leaseExpiresAt <= now
    ) {
      throw fatal(
        "REVIEWER_WORK_ORDER_LEASE_INVALID",
        "Reviewer WorkOrder lease 已失效。",
      );
    }
  }

  const activeArchitectureId =
    run.activeArchitecture?.architectureRef.id;
  let currentManifestHash: string;
  try {
    currentManifestHash = computeCourseManifestHash(
      buildCurrentCourseManifest({
        run,
        architecture: execution.architecture,
      }),
    );
  } catch (error) {
    throw fatal(
      "REVIEWER_MANIFEST_STALE",
      "CourseRun 当前页面集合已经变化，旧 Reviewer 不能继续提交。",
      error,
    );
  }
  if (
    activeArchitectureId !==
      execution.frozenManifest.architectureRef.id ||
    run.currentManifestHash !== execution.frozenManifestHash ||
    currentManifestHash !== execution.frozenManifestHash
  ) {
    throw fatal(
      "REVIEWER_MANIFEST_STALE",
      "Reviewer 的冻结 manifest 已经过期。",
    );
  }

  return workOrder;
}

function requiredInputRef(
  workOrder: WorkOrder,
  kind: ArtifactRef["kind"],
) {
  const ref = workOrder.inputArtifactRefs.find(
    (candidate) => candidate.kind === kind,
  );
  if (!ref) {
    throw fatal(
      "REVIEWER_INPUT_MISSING",
      `Reviewer WorkOrder 缺少 ${kind} 输入。`,
    );
  }
  return ref;
}

function assertRefIsSealedByManifest(
  manifest: CourseManifest,
  ref: ArtifactRef,
) {
  const sealedRefs = manifest.pages.flatMap((page) => [
    page.contentRef,
    ...(page.assetsRef ? [page.assetsRef] : []),
    page.htmlRef,
    page.qualityRef,
    page.summaryRef,
  ]);
  if (!sealedRefs.some((candidate) => sameArtifactRef(candidate, ref))) {
    throw fatal(
      "REVIEWER_EVIDENCE_NOT_SEALED",
      `Artifact ${ref.id} 不在 Reviewer 封口 manifest 中。`,
    );
  }
}

function sameArtifactRef(left: ArtifactRef, right: ArtifactRef) {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.courseId === right.courseId &&
    left.pageId === right.pageId &&
    left.scopeKey === right.scopeKey &&
    left.version === right.version &&
    left.contentHash === right.contentHash
  );
}

function sameStringValues(
  left: readonly string[],
  right: readonly string[],
) {
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    [...left]
      .sort()
      .every((value, index) => value === sortedRight[index])
  );
}

function loadExactArtifact(
  repository: CourseRunRepository,
  ref: ArtifactRef,
) {
  const artifact = repository.artifacts.load(ref.id);
  assertArtifactMatchesRef(artifact, ref);
  return artifact;
}

function assertArtifactMatchesRef(
  artifact: CourseArtifact | undefined,
  ref: ArtifactRef,
): asserts artifact is CourseArtifact {
  if (
    !artifact ||
    artifact.id !== ref.id ||
    artifact.kind !== ref.kind ||
    artifact.courseId !== ref.courseId ||
    artifact.pageId !== ref.pageId ||
    artifact.scopeKey !== ref.scopeKey ||
    artifact.version !== ref.version ||
    artifact.contentHash !== ref.contentHash
  ) {
    throw fatal(
      "REVIEWER_ARTIFACT_FENCE_FAILED",
      `Artifact ${ref.id} 与 Reviewer 封口引用不一致。`,
    );
  }
}

function readPageId(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const pageId = (value as { pageId?: unknown }).pageId;
  return typeof pageId === "string" ? pageId : undefined;
}

function fatal(
  code: string,
  message: string,
  originalError?: unknown,
) {
  return new FatalAgentRuntimeError(code, message, originalError);
}
