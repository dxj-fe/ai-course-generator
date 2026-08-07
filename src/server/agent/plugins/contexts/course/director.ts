import {
  CourseArchitectureSchema,
  CourseCreationBriefSchema,
  CourseReviewSchema,
  RunSummarySchema,
  WorkOrderSchema,
  type ArtifactRef,
  type CourseArchitecture,
  type CourseCreationBrief,
  type CourseReview,
  type CourseRun,
  type RunSummary,
  type WorkOrder,
} from "@/shared/course-schema";
import type { CourseRunRepository } from "@/server/course/store/repository";
import {
  countArchitectureRevisionRounds,
  MAX_ARCHITECTURE_REVISION_ROUNDS,
  MAX_COURSE_REVISION_ROUNDS,
  MAX_REPLAN_ROUNDS,
} from "@/server/course/run/revision-commands";
import {
  FatalAgentRuntimeError,
  throwIfAgentAborted,
} from "@/server/agent/runtime";
import {
  AgentToolSets,
  ToolIds,
} from "@/server/agent/ids";

export const COURSE_DIRECTOR_TOOL_NAMES =
  AgentToolSets.CourseDirector;

export const COURSE_DIRECTOR_TERMINAL_TOOLS =
  AgentToolSets.CourseDirectorTerminal;

export type CourseDirectorToolName =
  (typeof COURSE_DIRECTOR_TOOL_NAMES)[number];

export type DirectorRoundKind =
  | "review_architecture"
  | "decide_course_review"
  | "recover_page_block";

export type CourseDirectorExecutionInput = {
  creationBrief: CourseCreationBrief;
  repository: CourseRunRepository;
  workOrder: WorkOrder;
  workOrderLeaseOwner: string;
  runLeaseOwner: string;
  traceId: string;
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
};

export type CourseDirectorExecution = {
  creationBrief: CourseCreationBrief;
  repository: CourseRunRepository;
  initialWorkOrder: WorkOrder;
  initialRun: CourseRun;
  roundKind: DirectorRoundKind;
  architectureRef: ArtifactRef & { kind: "course_architecture" };
  architecture: CourseArchitecture;
  architectWorkOrder: WorkOrder;
  reviewRef?: ArtifactRef & { kind: "course_review" };
  review?: CourseReview;
  reviewWorkOrder?: WorkOrder;
  blockedPageRef?: ArtifactRef & { kind: "page_quality" };
  blockedPageWorkOrder?: WorkOrder;
  inspections: {
    architecture: boolean;
    courseReview: boolean;
    pageBlock: boolean;
  };
  failCourseAuthorization?: {
    code: string;
    message: string;
  };
  workOrderLeaseOwner: string;
  runLeaseOwner: string;
  traceId: string;
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
};

export function createCourseDirectorExecution(
  input: CourseDirectorExecutionInput,
): CourseDirectorExecution {
  const creationBrief = CourseCreationBriefSchema.parse(
    input.creationBrief,
  );
  const workOrder = WorkOrderSchema.parse(input.workOrder);
  if (
    workOrder.kind !== "director_round" ||
    workOrder.scope.type !== "course" ||
    workOrder.status !== "running" ||
    workOrder.leaseOwner !== input.workOrderLeaseOwner ||
    !workOrder.inputSealedAt
  ) {
    throw fatal(
      "DIRECTOR_WORK_ORDER_INVALID",
      "Course Director 只能执行已 claim 的课程级 director_round WorkOrder。",
    );
  }

  const run = input.repository.runs.loadByTaskId(workOrder.taskId);
  if (
    !run ||
    run.courseId !== workOrder.courseId ||
    run.traceId !== input.traceId ||
    run.leaseOwner !== input.runLeaseOwner
  ) {
    throw fatal(
      "DIRECTOR_RUN_FENCE_INVALID",
      "CourseRun 的课程、trace 或 lease 与 Director WorkOrder 不一致。",
    );
  }

  const sealedReviewRef = findInputRef(workOrder, "course_review");
  const sealedBlockedPageRef = findInputRef(workOrder, "page_quality");
  const roundKind: DirectorRoundKind = sealedReviewRef
    ? "decide_course_review"
    : sealedBlockedPageRef
      ? "recover_page_block"
      : "review_architecture";
  const architectureRef =
    findInputRef(workOrder, "course_architecture") ??
    run.activeArchitecture?.architectureRef;
  if (!architectureRef || architectureRef.kind !== "course_architecture") {
    throw fatal(
      "DIRECTOR_ARCHITECTURE_INPUT_MISSING",
      "Director 回合缺少封口的课程架构输入。",
    );
  }

  const architectureArtifact = input.repository.artifacts.load(
    architectureRef.id,
  );
  assertArtifactRef(architectureArtifact, architectureRef);
  if (
    architectureArtifact.taskId !== workOrder.taskId ||
    architectureArtifact.courseId !== workOrder.courseId
  ) {
    throw fatal(
      "DIRECTOR_ARCHITECTURE_SCOPE_INVALID",
      "课程架构 Artifact 不属于当前任务和课程。",
    );
  }
  const architecture = CourseArchitectureSchema.parse(
    architectureArtifact.payload,
  );
  const architectWorkOrder = requiredWorkOrder(
    input.repository.workOrders.load(
      architectureArtifact.createdByWorkOrderId,
    ),
    architectureArtifact.createdByWorkOrderId,
  );
  if (
    architectWorkOrder.kind !== "architect_course" ||
    !["submitted", "accepted"].includes(architectWorkOrder.status) ||
    !architectWorkOrder.submission?.artifactRefs.some(
      ({ id }) => id === architectureRef.id,
    )
  ) {
    throw fatal(
      "DIRECTOR_ARCHITECTURE_SUBMISSION_INVALID",
      "课程架构不是有效的 Architect Submission。",
    );
  }

  let review: CourseReview | undefined;
  let reviewWorkOrder: WorkOrder | undefined;
  let blockedPageWorkOrder: WorkOrder | undefined;
  if (sealedReviewRef) {
    if (
      run.activeArchitecture?.architectureRef.id !== architectureRef.id
    ) {
      throw fatal(
        "DIRECTOR_ACTIVE_ARCHITECTURE_CHANGED",
        "整课 Review 引用的课程架构已不是 CourseRun 当前版本。",
      );
    }
    const reviewArtifact = input.repository.artifacts.load(
      sealedReviewRef.id,
    );
    assertArtifactRef(reviewArtifact, sealedReviewRef);
    if (
      reviewArtifact.taskId !== workOrder.taskId ||
      reviewArtifact.courseId !== workOrder.courseId
    ) {
      throw fatal(
        "DIRECTOR_REVIEW_SCOPE_INVALID",
        "整课 Review Artifact 不属于当前任务和课程。",
      );
    }
    review = CourseReviewSchema.parse(reviewArtifact.payload);
    reviewWorkOrder = requiredWorkOrder(
      input.repository.workOrders.load(
        reviewArtifact.createdByWorkOrderId,
      ),
      reviewArtifact.createdByWorkOrderId,
    );
    if (
      reviewWorkOrder.kind !== "review_course" ||
      reviewWorkOrder.status !== "submitted" ||
      !reviewWorkOrder.submission?.artifactRefs.some(
        ({ id }) => id === sealedReviewRef.id,
      ) ||
      run.currentReview?.artifactRef.id !== sealedReviewRef.id ||
      run.currentReview.workOrderId !== reviewWorkOrder.id
    ) {
      throw fatal(
        "DIRECTOR_REVIEW_SUBMISSION_INVALID",
        "整课 Review 不是 CourseRun 当前 submitted 版本。",
      );
    }
  } else if (sealedBlockedPageRef) {
    if (
      run.activeArchitecture?.architectureRef.id !== architectureRef.id
    ) {
      throw fatal(
        "DIRECTOR_ACTIVE_ARCHITECTURE_CHANGED",
        "页面阻塞证据引用的课程架构已不是当前版本。",
      );
    }
    const qualityArtifact = input.repository.artifacts.load(
      sealedBlockedPageRef.id,
    );
    assertArtifactRef(qualityArtifact, sealedBlockedPageRef);
    blockedPageWorkOrder = requiredWorkOrder(
      input.repository.workOrders.load(
        qualityArtifact.createdByWorkOrderId,
      ),
      qualityArtifact.createdByWorkOrderId,
    );
    if (
      blockedPageWorkOrder.status !== "blocked" ||
      (blockedPageWorkOrder.kind !== "build_page" &&
        blockedPageWorkOrder.kind !== "fix_page") ||
      !blockedPageWorkOrder.submission?.artifactRefs.some(
        ({ id }) => id === sealedBlockedPageRef.id,
      ) ||
      !blockedPageWorkOrder.inputArtifactRefs.some(
        ({ id }) => id === architectureRef.id,
      )
    ) {
      throw fatal(
        "DIRECTOR_PAGE_BLOCK_INPUT_INVALID",
        "页面阻塞证据不是当前架构分支的有效 blocked Submission。",
      );
    }
    if (
      architectWorkOrder.status !== "accepted" ||
      (run.phase !== "building" && run.phase !== "revising")
    ) {
      throw fatal(
        "DIRECTOR_PAGE_BLOCK_STATE_INVALID",
        "页面阻塞恢复只能处理已接受架构的构建阶段。",
      );
    }
  } else if (
    architectWorkOrder.status !== "submitted" ||
    (run.phase !== "planning" && run.phase !== "revising")
  ) {
    throw fatal(
      "DIRECTOR_ARCHITECTURE_NOT_SUBMITTED",
      "架构验收回合只能读取 submitted Architect WorkOrder。",
    );
  }

  return {
    creationBrief,
    repository: input.repository,
    initialWorkOrder: workOrder,
    initialRun: run,
    roundKind,
    architectureRef: architectureRef as ArtifactRef & {
      kind: "course_architecture";
    },
    architecture,
    architectWorkOrder,
    reviewRef: sealedReviewRef as
      | (ArtifactRef & { kind: "course_review" })
      | undefined,
    review,
    reviewWorkOrder,
    blockedPageRef: sealedBlockedPageRef as
      | (ArtifactRef & { kind: "page_quality" })
      | undefined,
    blockedPageWorkOrder,
    inspections: {
      architecture: false,
      courseReview: false,
      pageBlock: false,
    },
    workOrderLeaseOwner: input.workOrderLeaseOwner,
    runLeaseOwner: input.runLeaseOwner,
    traceId: input.traceId,
    abortSignal: input.abortSignal,
    beforeToolCall: input.beforeToolCall,
  };
}

export function assertCourseDirectorToolCall(
  execution: CourseDirectorExecution,
  input: { input: unknown; toolName: string },
  now: string,
) {
  throwIfAgentAborted(execution.abortSignal);
  if (
    !COURSE_DIRECTOR_TOOL_NAMES.includes(
      input.toolName as CourseDirectorToolName,
    ) ||
    !execution.initialWorkOrder.allowedTools.includes(input.toolName)
  ) {
    return false;
  }

  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  const run = execution.repository.runs.loadByTaskId(
    execution.initialWorkOrder.taskId,
  );
  if (!workOrder || !run) {
    throw fatal(
      "DIRECTOR_RUNTIME_STATE_MISSING",
      "CourseRun 或 Director WorkOrder 已不存在。",
    );
  }
  if (
    workOrder.taskId !== execution.initialWorkOrder.taskId ||
    workOrder.courseId !== execution.initialWorkOrder.courseId ||
    workOrder.kind !== "director_round" ||
    workOrder.scope.type !== "course" ||
    !workOrder.allowedTools.includes(input.toolName)
  ) {
    throw fatal(
      "DIRECTOR_SCOPE_CHANGED",
      "Director WorkOrder 的任务、课程、scope 或权限已变化。",
    );
  }
  if (
    run.id !== execution.initialRun.id ||
    run.taskId !== workOrder.taskId ||
    run.courseId !== workOrder.courseId ||
    run.traceId !== execution.traceId
  ) {
    throw fatal(
      "DIRECTOR_TRACE_FENCING_FAILED",
      "CourseRun trace 或课程范围已变化。",
    );
  }

  if (workOrder.status === "accepted") {
    return COURSE_DIRECTOR_TERMINAL_TOOLS.includes(
      input.toolName as (typeof COURSE_DIRECTOR_TERMINAL_TOOLS)[number],
    );
  }
  if (
    workOrder.status !== "running" ||
    workOrder.lockVersion !== execution.initialWorkOrder.lockVersion ||
    workOrder.leaseOwner !== execution.workOrderLeaseOwner ||
    !workOrder.leaseExpiresAt ||
    workOrder.leaseExpiresAt <= now
  ) {
    throw fatal(
      "DIRECTOR_WORK_ORDER_LEASE_INVALID",
      "Director WorkOrder lease 或版本围栏已失效。",
    );
  }
  if (
    run.lockVersion !== execution.initialRun.lockVersion ||
    run.leaseOwner !== execution.runLeaseOwner ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= now
  ) {
    throw fatal(
      "DIRECTOR_RUN_LEASE_INVALID",
      "CourseRun lease 或版本围栏已失效。",
    );
  }
  if (
    !resolveCourseDirectorActiveTools(execution).includes(
      input.toolName as CourseDirectorToolName,
    )
  ) {
    return false;
  }
  return true;
}

export function resolveCourseDirectorActiveTools(
  execution: CourseDirectorExecution,
): CourseDirectorToolName[] {
  const current = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  if (!current || current.status !== "running") return [];

  const tools: CourseDirectorToolName[] = [
    ToolIds.GetRunSummary,
    ToolIds.InspectArchitecture,
  ];
  if (execution.roundKind === "review_architecture") {
    tools.push(
      ToolIds.RequestArchitectureRevision,
      ToolIds.AcceptArchitectureAndDispatchPages,
    );
  } else if (execution.roundKind === "decide_course_review") {
    tools.push(ToolIds.InspectCourseReview);
    if (execution.review?.decision === "pass") {
      tools.push(ToolIds.AcceptCourseReviewAndPublish);
    } else if (execution.review?.decision === "revise_pages") {
      tools.push(ToolIds.AssignPageFixes);
    } else if (execution.review?.decision === "replan") {
      tools.push(ToolIds.RequestReplan);
    }
  } else {
    tools.push(ToolIds.RequestReplan);
  }
  if (
    requiredDirectorInspectionCompleted(execution) &&
    resolveCourseDirectorFailureEligibility(execution).eligible
  ) {
    tools.push(ToolIds.FailCourse);
  }

  return tools.filter((toolName) =>
    current.allowedTools.includes(toolName),
  );
}

export function buildCourseDirectorRunSummary(
  execution: CourseDirectorExecution,
): RunSummary {
  const run = requiredRun(
    execution.repository.runs.load(execution.initialRun.id),
    execution.initialRun.id,
  );
  const workOrders = execution.repository.workOrders.listByTask(run.taskId);
  const pages = [...execution.architecture.pageTasks]
    .sort((left, right) => left.order - right.order)
    .map((pageTask) => {
      const currentPointer = run.currentPages[pageTask.pageId];
      const candidates = workOrders.filter(
        (workOrder) =>
          workOrder.scope.type === "page" &&
          workOrder.scope.pageId === pageTask.pageId &&
          workOrder.inputArtifactRefs.some(
            ({ id }) => id === execution.architectureRef.id,
          ),
      );
      const workOrder = currentPointer
        ? workOrders.find(
            ({ id }) => id === currentPointer.sourceWorkOrderId,
          )
        : candidates.sort(
            (left, right) => right.revision - left.revision,
          )[0];
      const artifactRefs =
        workOrder?.submission?.artifactRefs ??
        workOrder?.checkpointArtifactRefs ??
        [];
      return {
        pageId: pageTask.pageId,
        order: pageTask.order,
        workOrderId: workOrder?.id,
        status: workOrder?.status ?? ("not_created" as const),
        artifactRefs,
        qualitySummary: qualitySummary(execution.repository, artifactRefs),
        issues:
          workOrder?.submission?.issues ??
          (workOrder?.error ? [workOrder.error.message] : []),
      };
    });
  const reviewWorkOrder = execution.reviewWorkOrder
    ? execution.repository.workOrders.load(execution.reviewWorkOrder.id)
    : undefined;

  return RunSummarySchema.parse({
    taskId: run.taskId,
    courseId: run.courseId,
    phase: run.phase,
    blueprint: {
      workOrderId: execution.architectWorkOrder.id,
      status:
        execution.repository.workOrders.load(
          execution.architectWorkOrder.id,
        )?.status ?? execution.architectWorkOrder.status,
      artifactRef: execution.architectureRef,
      summary: `${execution.architecture.blueprint.title}；${execution.architecture.blueprint.objectives.length} 个目标，${execution.architecture.pageTasks.length} 个页面`,
      issues:
        execution.repository.workOrders.load(
          execution.architectWorkOrder.id,
        )?.submission?.issues ?? [],
    },
    pages,
    review:
      reviewWorkOrder && execution.reviewRef && execution.review
        ? {
            workOrderId: reviewWorkOrder.id,
            status: reviewWorkOrder.status,
            artifactRef: execution.reviewRef,
            decision: execution.review.decision,
            issueIds: execution.review.issues.map(({ id }) => id),
          }
        : undefined,
    remainingBudget: {
      architectureRevisionRounds: Math.max(
        0,
        MAX_ARCHITECTURE_REVISION_ROUNDS -
          countArchitectureRevisionRounds(workOrders),
      ),
      replanRounds: Math.max(
        0,
        MAX_REPLAN_ROUNDS - run.replanRound,
      ),
      courseRevisionRounds: Math.max(
        0,
        MAX_COURSE_REVISION_ROUNDS - run.courseRevisionRound,
      ),
    },
  });
}

export type CourseDirectorFailureEligibility =
  | {
      code: string;
      eligible: true;
      message: string;
    }
  | {
      eligible: false;
      message: string;
    };

/**
 * 失败是受控领域动作，不接受模型自报“不可恢复”。
 * 只有持久化预算或前一条受控命令给出的机器授权可以开放 fail_course。
 */
export function resolveCourseDirectorFailureEligibility(
  execution: CourseDirectorExecution,
): CourseDirectorFailureEligibility {
  if (execution.failCourseAuthorization) {
    return {
      eligible: true,
      ...execution.failCourseAuthorization,
    };
  }
  const run = requiredRun(
    execution.repository.runs.load(execution.initialRun.id),
    execution.initialRun.id,
  );

  if (execution.roundKind === "review_architecture") {
    return {
      eligible: false,
      message:
        "当前课程架构合同完整；请接受架构，或给出具体问题并退回修改。",
    };
  }

  if (execution.roundKind === "recover_page_block") {
    if (run.replanRound >= MAX_REPLAN_ROUNDS) {
      return {
        code: "COURSE_REPLAN_BUDGET_EXHAUSTED",
        eligible: true,
        message: `页面阻塞后的重新规划已达到 ${MAX_REPLAN_ROUNDS} 轮上限。`,
      };
    }
    return {
      eligible: false,
      message:
        "当前页面阻塞仍可通过重新分配页面职责恢复，应先创建新版课程架构。",
    };
  }

  if (execution.review?.decision === "revise_pages") {
    if (run.courseRevisionRound >= MAX_COURSE_REVISION_ROUNDS) {
      return {
        code: "COURSE_REVISION_BUDGET_EXHAUSTED",
        eligible: true,
        message: `整课定向返工已达到 ${MAX_COURSE_REVISION_ROUNDS} 轮上限。`,
      };
    }
    return {
      eligible: false,
      message: "当前 Review 已给出可执行的页面返工方案，应先派发定向返工。",
    };
  }
  if (execution.review?.decision === "replan") {
    if (run.replanRound >= MAX_REPLAN_ROUNDS) {
      return {
        code: "COURSE_REPLAN_BUDGET_EXHAUSTED",
        eligible: true,
        message: `整课重新规划已达到 ${MAX_REPLAN_ROUNDS} 轮上限。`,
      };
    }
    return {
      eligible: false,
      message: "当前 Review 已确认需要重新规划，应先创建新版课程架构。",
    };
  }

  return {
    eligible: false,
    message: "当前 pass Review 必须进入 Final Gate，不能由模型主动终止课程。",
  };
}

function requiredDirectorInspectionCompleted(
  execution: CourseDirectorExecution,
) {
  if (execution.roundKind === "review_architecture") {
    return execution.inspections.architecture;
  }
  return execution.roundKind === "decide_course_review"
    ? execution.inspections.courseReview
    : execution.inspections.pageBlock;
}

export function inspectCourseArchitecture(
  execution: CourseDirectorExecution,
) {
  const { blueprint, coursePack, pageTasks } = execution.architecture;
  return {
    architectureRef: execution.architectureRef,
    immutableBrief: {
      originalRequest: execution.creationBrief.originalRequest,
      topic: execution.creationBrief.topic,
      audience: execution.creationBrief.audience,
      goal: execution.creationBrief.goal,
      sectionCount: execution.creationBrief.sectionCount,
      learningMode: execution.creationBrief.learningMode,
      language: execution.creationBrief.language,
    },
    title: blueprint.title,
    topic: coursePack.topic,
    audience: blueprint.audience,
    language: blueprint.language,
    courseRules: blueprint.courseRules,
    constraints: coursePack.constraints,
    facts: coursePack.facts.map(({ id, text, sourceUsages }) => ({
      id,
      text,
      sourceUsages,
    })),
    terms: coursePack.terms.map(({ term, definition, sourceUsages }) => ({
      term,
      definition,
      sourceUsages,
    })),
    objectives: blueprint.objectives.map((objective) => ({
      ...objective,
      teachingPageIds: pageTasks
        .filter(
          ({ objectiveIds, pageType }) =>
            pageType !== "cover" &&
            objectiveIds.includes(objective.id),
        )
        .map(({ pageId }) => pageId),
      assessmentPageIds: pageTasks
        .filter(
          ({ objectiveIds, assessment, pageType }) =>
            pageType !== "cover" &&
            objectiveIds.includes(objective.id) &&
            Boolean(assessment),
        )
        .map(({ pageId }) => pageId),
    })),
    pages: [...pageTasks]
      .sort((left, right) => left.order - right.order)
      .map(
        ({
          pageId,
          order,
          title,
          pageType,
          purpose,
          objectiveIds,
          buildDependsOnPageIds,
          learnerAction,
          assessment,
          teachingPoints,
          interactionType,
          functionalTemplateId,
          styleTemplateId,
          visualDesign,
          acceptance,
        }) => ({
          pageId,
          order,
          title,
          pageType,
          purpose,
          objectiveIds,
          buildDependsOnPageIds,
          teachingPoints,
          learnerAction,
          assessment,
          interactionType,
          functionalTemplateId,
          styleTemplateId,
          visualDesign,
          acceptance,
        }),
      ),
  };
}

export function inspectCurrentCourseReview(
  execution: CourseDirectorExecution,
) {
  if (!execution.review || !execution.reviewRef) {
    throw fatal(
      "DIRECTOR_REVIEW_INPUT_MISSING",
      "当前不是整课 Review 决策回合。",
    );
  }
  return {
    reviewRef: execution.reviewRef,
    decision: execution.review.decision,
    summary: execution.review.summary,
    coverage: execution.review.coverage,
    issues: execution.review.issues,
    currentManifestHash: execution.initialRun.currentManifestHash,
  };
}

export function inspectBlockedPage(
  execution: CourseDirectorExecution,
) {
  if (
    !execution.blockedPageRef ||
    !execution.blockedPageWorkOrder ||
    execution.blockedPageWorkOrder.scope.type !== "page"
  ) {
    throw fatal(
      "DIRECTOR_PAGE_BLOCK_INPUT_MISSING",
      "当前不是页面阻塞恢复回合。",
    );
  }
  const qualityArtifact = execution.repository.artifacts.load(
    execution.blockedPageRef.id,
  );
  const quality = qualityArtifact?.payload as
    | {
        decision?: unknown;
        overallScore?: unknown;
        issues?: Array<{
          code?: unknown;
          severity?: unknown;
          message?: unknown;
          repairHint?: unknown;
        }>;
      }
    | undefined;
  return {
    pageId: execution.blockedPageWorkOrder.scope.pageId,
    workOrderId: execution.blockedPageWorkOrder.id,
    error: execution.blockedPageWorkOrder.error,
    evidence: execution.blockedPageWorkOrder.submission?.evidence ?? [],
    qualityRef: execution.blockedPageRef,
    quality: quality
      ? {
          decision: quality.decision,
          overallScore: quality.overallScore,
          issues: quality.issues?.slice(0, 12),
        }
      : undefined,
  };
}

export function loadCourseDirectorTerminal(
  execution: CourseDirectorExecution,
) {
  const workOrder = execution.repository.workOrders.load(
    execution.initialWorkOrder.id,
  );
  const run = workOrder
    ? execution.repository.runs.loadByTaskId(workOrder.taskId)
    : undefined;
  return { run, traceId: execution.traceId, workOrder };
}

function findInputRef(
  workOrder: WorkOrder,
  kind: ArtifactRef["kind"],
) {
  return workOrder.inputArtifactRefs.find(
    (artifact) => artifact.kind === kind,
  );
}

function assertArtifactRef(
  artifact: ReturnType<CourseRunRepository["artifacts"]["load"]>,
  ref: ArtifactRef,
): asserts artifact is NonNullable<typeof artifact> {
  if (
    !artifact ||
    artifact.id !== ref.id ||
    artifact.kind !== ref.kind ||
    artifact.courseId !== ref.courseId ||
    artifact.pageId !== ref.pageId ||
    artifact.scopeKey !== ref.scopeKey ||
    artifact.revision !== ref.revision ||
    artifact.contentHash !== ref.contentHash
  ) {
    throw fatal(
      "DIRECTOR_ARTIFACT_FENCE_INVALID",
      `Artifact ${ref.id} 与 Director 封口输入不一致。`,
    );
  }
}

function qualitySummary(
  repository: CourseRunRepository,
  refs: ArtifactRef[],
) {
  const qualityRef = refs.find(({ kind }) => kind === "page_quality");
  if (!qualityRef) return undefined;
  const payload = repository.artifacts.load(qualityRef.id)?.payload;
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as {
    overallScore?: unknown;
    decision?: unknown;
    issues?: unknown[];
  };
  const score =
    typeof record.overallScore === "number"
      ? `${record.overallScore} 分`
      : undefined;
  const decision =
    typeof record.decision === "string" ? record.decision : undefined;
  const issueCount = Array.isArray(record.issues)
    ? `${record.issues.length} 个问题`
    : undefined;
  const parts = [score, decision, issueCount].filter(Boolean);
  return parts.length > 0 ? parts.join("，") : undefined;
}

function requiredRun(run: CourseRun | undefined, id: string) {
  if (!run) throw fatal("DIRECTOR_RUN_MISSING", `CourseRun 不存在：${id}`);
  return run;
}

function requiredWorkOrder(
  workOrder: WorkOrder | undefined,
  id: string,
) {
  if (!workOrder) {
    throw fatal(
      "DIRECTOR_WORK_ORDER_MISSING",
      `WorkOrder 不存在：${id}`,
    );
  }
  return workOrder;
}

function fatal(code: string, message: string) {
  return new FatalAgentRuntimeError(code, message);
}
