import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import { runPageQAAgent } from "@/server/agents/page-qa-agent";
import { runRepairAgent } from "@/server/agents/repair-agent";
import { runSupervisorAgent } from "@/server/agents/supervisor-agent";
import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { createCourseStore } from "@/server/storage/course-store";
import { runCourseDesignWorkflow } from "@/server/workflows/course-design-workflow";
import {
  CourseGenerationNodeError,
  createCourseDesignNode,
  createIntentNode,
  createPlannerNode,
  type CourseGenerationNode,
  type CourseGenerationNodeContext,
  type CourseGenerationNodeDependencies,
  type CourseGenerationNodeEvent,
  type CourseGenerationNodeName,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-nodes";
import { runCourseWorkersWorkflow } from "@/server/workflows/course-workers-workflow";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import { generatePageWorker } from "@/server/workflows/page-worker";
import {
  runSequentialWorkflow,
  type SequentialWorkflowResult,
  type WorkflowNodeError,
} from "@/server/workflows/sequential-workflow";
import { runSupervisedWorkflow } from "@/server/workflows/supervised-workflow";
import {
  CourseGenerationStateSchema,
  PageWorkerConfigSchema,
  targetKey,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
  type PageWorkerMode,
  type SupervisorDecision,
  type SupervisorNodeTarget,
} from "@/shared/course-schema";

export type { CourseMvpPageCount } from "@/server/workflows/course-generation-nodes";

export type CourseGenerationWorkflowInput = {
  courseId: string;
  userPrompt: string;
  pageCount?: CourseMvpPageCount;
  executionMode?: PageWorkerMode;
  concurrency?: number;
  existingState?: CourseGenerationState;
};

export type CourseGenerationWorkflowDependencies =
  CourseGenerationNodeDependencies & {
    runSupervisor: typeof runSupervisorAgent;
    runQA: typeof runPageQAAgent;
    runRepair: typeof runRepairAgent;
    generatePage: typeof generatePageWorker;
    checkpoint(state: CourseGenerationState): Promise<void>;
    now(): string;
  };

const courseStore = createCourseStore();
const defaultDependencies: CourseGenerationWorkflowDependencies = {
  generateIntent: generateCourseIntent,
  runPlanner: runCoursePlannerAgent,
  runDesign: runCourseDesignWorkflow,
  runPageWriter: runPageWriterAgent,
  runAssets: runImageAssetWorkflow,
  runHtml: runHtmlEngineerAgent,
  runQA: runPageQAAgent,
  runRepair: runRepairAgent,
  generatePage: generatePageWorker,
  runSupervisor: runSupervisorAgent,
  checkpoint: courseStore.save,
  now: () => new Date().toISOString(),
};

/**
 * 课程级兼容入口：Supervisor 负责全局 Specialist，页面产物交给隔离的
 * Page Worker 与受控 Promise Pool；checkpoint 和公开事件仍集中管理。
 */
export async function runCourseGenerationWorkflow(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
): Promise<CourseGenerationState> {
  const dependencies = { ...defaultDependencies, ...overrides };
  let state = initializeState(input, context, dependencies.now);

  if (state.status === "completed") return state;

  state = appendEvent(state, dependencies.now, {
    type: "start",
    stage: state.currentStage,
    summary: input.existingState
      ? "整课生成已从服务端检查点恢复。"
      : state.workerConfig?.mode === "parallel"
        ? `整课生成已开始，Page Worker 最大并发度为 ${state.workerConfig.concurrency}。`
        : "整课串行生成已开始。",
  });
  state = await checkpoint(state, dependencies);

  const supervisedResult = await runSupervisedWorkflow({
    state,
    context,
    listAvailableNodes: listAvailableGlobalNodes,
    isReadyToComplete: isGlobalWorkReady,
    decide: (supervisorInput) =>
      dependencies.runSupervisor(supervisorInput, context),
    execute: (current, node, retryFailure) =>
      runCourseNodes(
        current,
        [node],
        input,
        context,
        dependencies,
        getRetryFeedback(current, node, retryFailure),
      ),
    recordDecision: (current, decision, node) =>
      recordSupervisorDecision(current, decision, node, dependencies),
    checkpoint: (current) => checkpoint(current, dependencies),
  });

  if (supervisedResult.status === "failed") {
    return failNodeWorkflow(
      {
        status: "failed",
        state: supervisedResult.state,
        error: supervisedResult.error,
      },
      [supervisedResult.node],
      context,
      dependencies,
    );
  }
  if (supervisedResult.status === "stopped") {
    const node = supervisedResult.node;
    const stopReason = supervisedResult.decision.stopReason;
    const cancelled =
      supervisedResult.error?.code === "AGENT_ABORTED" ||
      supervisedResult.error?.code === "WORKFLOW_ABORTED";
    return failWorkflow(
      supervisedResult.state,
      {
        stage: node?.stage ?? supervisedResult.state.currentStage,
        pageId: node?.pageId,
        code: cancelled
          ? supervisedResult.error!.code
          : `SUPERVISOR_${stopReason.code.toUpperCase()}`,
        message: cancelled
          ? supervisedResult.error!.message
          : stopReason.message,
      },
      context,
      dependencies,
      { agent: node?.agent ?? "supervisor" },
    );
  }
  state = supervisedResult.state;

  const workersResult = await runCourseWorkersWorkflow(
    state,
    context,
    requireValue(state.workerConfig, "page worker config"),
    dependencies,
  );
  if (workersResult.status === "failed") {
    return failWorkflow(
      workersResult.state,
      workersResult.error,
      context,
      dependencies,
      { agent: "page-worker" },
    );
  }
  state = workersResult.state;

  const completedAt = dependencies.now();
  state = appendEvent(
    {
      ...state,
      status: "completed",
      currentStage: "complete",
      currentPageId: undefined,
      completedAt,
      durationMs: durationSince(state.startedAt, completedAt),
    },
    dependencies.now,
    {
      type: "finish",
      stage: "complete",
      summary: `整课生成完成，共交付 ${state.pages.length} 个 HTML 页面。`,
    },
  );
  return checkpoint(state, dependencies);
}

type CourseNodeRunResult = SequentialWorkflowResult<
  CourseGenerationState,
  CourseGenerationNode["name"]
>;

/** 统一执行节点生命周期，节点本身不能写 checkpoint 或发布 SSE。 */
async function runCourseNodes(
  state: CourseGenerationState,
  nodes: CourseGenerationNode[],
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
  retryFeedback?: CourseGenerationNodeContext["retryFeedback"],
): Promise<CourseNodeRunResult> {
  const result = await runSequentialWorkflow<
    CourseGenerationState,
    CourseGenerationNodeContext,
    CourseGenerationNodeEvent,
    CourseGenerationNodeName,
    CourseGenerationNode
  >({
    state,
    nodes,
    context: {
      runtime: context,
      pageCount: input.pageCount,
      dependencies,
      retryFeedback,
    },
    merge: (current, patch) =>
      CourseGenerationStateSchema.parse({ ...current, ...patch }),
    beforeNode: (current, node) => {
      let next: CourseGenerationState = {
        ...current,
        currentStage: node.stage,
        currentPageId: node.pageId,
      };

      if (node.pageId && isPageStage(node.stage)) {
        const pageStage = node.stage;
        next = updatePage(next, node.pageId, (page) => ({
          ...page,
          status: "running",
          currentStage: pageStage,
          error: undefined,
        }));
      }

      return beginAgent(next, dependencies, {
        stage: node.stage,
        pageId: node.pageId,
        agent: node.agent,
        summary: node.startSummary(next),
      });
    },
    afterNode: async (current, node, nodeResult) => {
      let next = appendNodeEvents(
        current,
        dependencies.now,
        node,
        nodeResult.events,
      );
      next = appendAgentDone(next, dependencies.now, {
        stage: node.stage,
        pageId: node.pageId,
        agent: node.agent,
        summary: node.doneSummary(next),
      });

      for (const event of node.afterDoneEvents?.(next) ?? []) {
        next = appendNodeEvent(next, dependencies.now, node, event, false);
      }

      return checkpoint(next, dependencies);
    },
  });

  if (
    result.status === "failed" &&
    result.error instanceof CourseGenerationNodeError
  ) {
    const failedNode = nodes.find(
      ({ name }) => name === result.error.nodeName,
    );
    if (failedNode) {
      return {
        ...result,
        state: appendNodeEvents(
          result.state,
          dependencies.now,
          failedNode,
          result.error.events,
        ),
      };
    }
  }

  return result;
}

function getRetryFeedback(
  state: CourseGenerationState,
  node: CourseGenerationNode,
  retryFailure?: WorkflowNodeError<CourseGenerationNodeName>,
): CourseGenerationNodeContext["retryFeedback"] {
  if (retryFailure) {
    return {
      nodeName: retryFailure.nodeName,
      code: retryFailure.code,
      message: retryFailure.message,
    };
  }

  const persistedError = node.pageId
    ? state.pages.find(({ pageId }) => pageId === node.pageId)?.error
    : undefined;
  return persistedError
    ? {
        nodeName: node.name,
        code: persistedError.code,
        message: persistedError.message,
      }
    : undefined;
}

function failNodeWorkflow(
  result: Extract<CourseNodeRunResult, { status: "failed" }>,
  nodes: CourseGenerationNode[],
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const node = nodes.find(({ name }) => name === result.error.nodeName);
  return failWorkflow(
    result.state,
    {
      stage: node?.stage ?? result.state.currentStage,
      pageId: node?.pageId,
      code: result.error.code,
      message: result.error.message,
    },
    context,
    dependencies,
    { agent: node?.agent ?? result.error.nodeName },
  );
}

function appendNodeEvents(
  state: CourseGenerationState,
  now: () => string,
  node: CourseGenerationNode,
  events: readonly CourseGenerationNodeEvent[],
) {
  return events.reduce(
    (next, event) => appendNodeEvent(next, now, node, event),
    state,
  );
}

function appendNodeEvent(
  state: CourseGenerationState,
  now: () => string,
  node: CourseGenerationNode,
  event: CourseGenerationNodeEvent,
  inheritNodeAgent = true,
) {
  return appendEvent(state, now, {
    type: event.type,
    stage: node.stage,
    pageId: node.pageId,
    agent: event.agent ?? (inheritNodeAgent ? node.agent : undefined),
    step: event.step,
    summary: event.summary,
    timestamp: event.timestamp,
  });
}

function initializeState(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  now: () => string,
): CourseGenerationState {
  if (input.existingState) {
    const existing = CourseGenerationStateSchema.parse(input.existingState);
    if (
      existing.courseId !== input.courseId ||
      existing.userPrompt !== input.userPrompt
    ) {
      throw new Error("恢复输入必须与持久化课程的 courseId 和 userPrompt 一致。");
    }
    if (existing.status === "completed") return existing;

    const workerConfig = resolveWorkerConfig(input, existing.workerConfig);
    return CourseGenerationStateSchema.parse({
      ...existing,
      status: "running",
      traceId: context.traceId,
      errors: [],
      completedAt: undefined,
      durationMs: undefined,
      supervisor: existing.supervisor ?? {
        decisionCount: 0,
        attempts: [],
      },
      workerConfig,
      pages: existing.pages.map((page) =>
        page.status === "failed"
          ? {
              ...page,
              attempts: page.attempts?.filter(
                ({ stage }) => stage !== page.currentStage,
              ),
            }
          : page,
      ),
      updatedAt: now(),
    });
  }

  const timestamp = now();
  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: input.courseId,
    traceId: context.traceId,
    userPrompt: input.userPrompt,
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    supervisor: { decisionCount: 0, attempts: [] },
    workerConfig: resolveWorkerConfig(input),
    startedAt: timestamp,
    updatedAt: timestamp,
  });
}

function listAvailableGlobalNodes(
  state: CourseGenerationState,
): CourseGenerationNode[] {
  let nodes: CourseGenerationNode[];

  if (!state.intent) {
    nodes = [createIntentNode()];
  } else if (!state.outline) {
    nodes = [createPlannerNode()];
  } else if (!state.briefs || !state.pageWorkerBriefs) {
    nodes = [createCourseDesignNode()];
  } else nodes = [];

  return nodes.filter((node) =>
    node.requiredInputs.every(({ select }) => select(state) !== undefined),
  );
}

function isGlobalWorkReady(state: CourseGenerationState) {
  return Boolean(
    state.intent && state.outline && state.briefs && state.pageWorkerBriefs,
  );
}

async function recordSupervisorDecision(
  state: CourseGenerationState,
  decision: SupervisorDecision,
  node: CourseGenerationNode | undefined,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const currentSupervisor = state.supervisor ?? {
    decisionCount: 0,
    attempts: [],
  };
  const target = decisionTarget(decision);
  const attempts = target
    ? incrementAttempt(currentSupervisor.attempts, target)
    : currentSupervisor.attempts;
  const attemptCount = target
    ? attempts.find((attempt) => targetKey(attempt) === targetKey(target))
        ?.attempts
    : undefined;
  const summary = attemptCount
    ? `${decision.reasonSummary}（第 ${attemptCount} 次执行）`
    : decision.reasonSummary;
  const next = appendEvent(
    {
      ...state,
      supervisor: {
        decisionCount: currentSupervisor.decisionCount + 1,
        attempts,
        lastDecision: decision,
      },
    },
    dependencies.now,
    {
      type: "supervisor_decision",
      stage: node?.stage ?? state.currentStage,
      pageId: node?.pageId,
      agent: "supervisor",
      summary,
    },
  );
  return checkpoint(next, dependencies);
}

function decisionTarget(
  decision: SupervisorDecision,
): SupervisorNodeTarget | undefined {
  return decision.action === "run" || decision.action === "retry"
    ? decision.nextNode
    : undefined;
}

function incrementAttempt(
  attempts: NonNullable<CourseGenerationState["supervisor"]>["attempts"],
  target: SupervisorNodeTarget,
) {
  const key = targetKey(target);
  const existing = attempts.find((attempt) => targetKey(attempt) === key);

  if (!existing) return [...attempts, { ...target, attempts: 1 }];
  return attempts.map((attempt) =>
    targetKey(attempt) === key
      ? { ...attempt, attempts: attempt.attempts + 1 }
      : attempt,
  );
}

async function failWorkflow(
  state: CourseGenerationState,
  error: CourseGenerationError,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: { agent?: string } = {},
) {
  const cancelled =
    context.abortSignal?.aborted ||
    error.code === "AGENT_ABORTED" ||
    error.code === "WORKFLOW_ABORTED";
  const completedAt = dependencies.now();
  let failed: CourseGenerationState = {
    ...state,
    status: cancelled ? ("cancelled" as const) : ("failed" as const),
    currentStage: error.stage,
    currentPageId: error.pageId,
    completedAt,
    durationMs: durationSince(state.startedAt, completedAt),
    errors: sameError(state.errors.at(-1), error)
      ? state.errors
      : [...state.errors, error],
  };

  if (error.pageId && isPageStage(error.stage)) {
    const pageStage = error.stage;
    failed = updatePage(failed, error.pageId, (page) => ({
      ...page,
      status: "failed",
      currentStage: pageStage,
      error: { code: error.code, message: error.message },
    }));
  }

  failed = appendEvent(failed, dependencies.now, {
    type: "error",
    stage: error.stage,
    pageId: error.pageId,
    agent: metadata.agent,
    summary: error.message,
  });
  return checkpoint(failed, dependencies);
}

type AgentBoundaryMetadata = {
  stage: CourseGenerationStage;
  agent: string;
  pageId?: string;
  summary: string;
};

/** 在调用长耗时 Agent 前先落盘，SSE 才能即时展示真实的运行阶段。 */
function beginAgent(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: AgentBoundaryMetadata,
) {
  return checkpoint(
    appendEvent(state, dependencies.now, {
      type: "agent_start",
      ...metadata,
    }),
    dependencies,
  );
}

function appendAgentDone(
  state: CourseGenerationState,
  now: () => string,
  metadata: AgentBoundaryMetadata,
) {
  return appendEvent(state, now, {
    type: "agent_done",
    ...metadata,
  });
}

function appendEvent(
  state: CourseGenerationState,
  now: () => string,
  event: Pick<
    CourseGenerationPublicEvent,
    "type" | "stage" | "summary"
  > &
    Partial<
      Pick<
        CourseGenerationPublicEvent,
        "pageId" | "agent" | "step" | "timestamp"
      >
    >,
): CourseGenerationState {
  const nextEvent: CourseGenerationPublicEvent = {
    id: crypto.randomUUID(),
    sequence: state.events.length + 1,
    traceId: state.traceId,
    timestamp: event.timestamp ?? now(),
    step: event.step ?? 0,
    type: event.type,
    stage: event.stage,
    pageId: event.pageId,
    agent: event.agent,
    summary: event.summary,
  };

  return { ...state, events: [...state.events, nextEvent] };
}

async function checkpoint(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const parsed = CourseGenerationStateSchema.parse({
    ...state,
    updatedAt: dependencies.now(),
  });
  await dependencies.checkpoint(parsed);
  return parsed;
}

function updatePage(
  state: CourseGenerationState,
  pageId: string,
  updater: (page: PageGenerationState) => PageGenerationState,
): CourseGenerationState {
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.pageId === pageId ? updater(page) : page,
    ),
  };
}


function isPageStage(
  stage: CourseGenerationStage,
): stage is "page_writer" | "assets" | "html" | "qa" {
  return (
    stage === "page_writer" ||
    stage === "assets" ||
    stage === "html" ||
    stage === "qa"
  );
}

function resolveWorkerConfig(
  input: CourseGenerationWorkflowInput,
  persisted?: CourseGenerationState["workerConfig"],
) {
  if (
    persisted &&
    ((input.executionMode && input.executionMode !== persisted.mode) ||
      (input.concurrency && input.concurrency !== persisted.concurrency))
  ) {
    throw new Error("恢复课程时不能更改已持久化的 Page Worker 配置。");
  }
  return PageWorkerConfigSchema.parse(
    persisted ?? {
      mode: input.executionMode ?? "parallel",
      concurrency: input.concurrency ?? 2,
    },
  );
}

function requireValue<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`课程工作流缺少 ${name}。`);
  return value;
}

function sameError(
  left: CourseGenerationError | undefined,
  right: CourseGenerationError,
) {
  return Boolean(
    left &&
      left.stage === right.stage &&
      left.pageId === right.pageId &&
      left.code === right.code &&
      left.message === right.message,
  );
}

function durationSince(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
