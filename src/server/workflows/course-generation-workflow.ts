import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import { runSupervisorAgent } from "@/server/agents/supervisor-agent";
import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { createCourseStore } from "@/server/storage/course-store";
import { runCourseDesignWorkflow } from "@/server/workflows/course-design-workflow";
import {
  CourseGenerationNodeError,
  createAssetsNode,
  createCourseDesignNode,
  createHtmlEngineerNode,
  createIntentNode,
  createPageWriterNode,
  createPlannerNode,
  type CourseGenerationNode,
  type CourseGenerationNodeContext,
  type CourseGenerationNodeDependencies,
  type CourseGenerationNodeEvent,
  type CourseGenerationNodeName,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-nodes";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import {
  runSequentialWorkflow,
  type SequentialWorkflowResult,
} from "@/server/workflows/sequential-workflow";
import { runSupervisedWorkflow } from "@/server/workflows/supervised-workflow";
import {
  CourseGenerationStateSchema,
  targetKey,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
  type SupervisorDecision,
  type SupervisorNodeTarget,
} from "@/shared/course-schema";

export type { CourseMvpPageCount } from "@/server/workflows/course-generation-nodes";

export type CourseGenerationWorkflowInput = {
  courseId: string;
  userPrompt: string;
  pageCount?: CourseMvpPageCount;
  existingState?: CourseGenerationState;
};

export type CourseGenerationWorkflowDependencies =
  CourseGenerationNodeDependencies & {
    runSupervisor: typeof runSupervisorAgent;
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
  runSupervisor: runSupervisorAgent,
  checkpoint: courseStore.save,
  now: () => new Date().toISOString(),
};

/**
 * Day 22 的兼容入口：用显式节点列表执行既有固定串行流程。
 * API、checkpoint、恢复和公开事件协议仍由这一课程级事实来源统一管理。
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
      : "整课串行生成已开始。",
  });
  state = await checkpoint(state, dependencies);

  const supervisedResult = await runSupervisedWorkflow({
    state,
    context,
    listAvailableNodes: listAvailableCourseNodes,
    isReadyToComplete: isCourseReadyToComplete,
    decide: (supervisorInput) =>
      dependencies.runSupervisor(supervisorInput, context),
    execute: (current, node) =>
      runCourseNodes(current, [node], input, context, dependencies),
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
    startedAt: timestamp,
    updatedAt: timestamp,
  });
}

function listAvailableCourseNodes(
  state: CourseGenerationState,
): CourseGenerationNode[] {
  let nodes: CourseGenerationNode[];

  if (!state.intent) {
    nodes = [createIntentNode()];
  } else if (!state.outline) {
    nodes = [createPlannerNode()];
  } else if (!state.briefs || !state.pageWorkerBriefs) {
    nodes = [createCourseDesignNode()];
  } else {
    nodes = state.outline.pages.flatMap((plan) => {
      const page = state.pages.find(({ pageId }) => pageId === plan.id);
      if (!page || page.status === "completed") return [];
      if (
        plan.dependsOnPageIds.some(
          (dependencyId) =>
            state.pages.find(({ pageId }) => pageId === dependencyId)
              ?.status !== "completed",
        )
      ) {
        return [];
      }
      if (!page.content) return [createPageWriterNode(plan.id)];
      if (page.currentStage === "assets") return [createAssetsNode(plan.id)];
      if (!page.htmlOutput && page.currentStage === "html") {
        return [createHtmlEngineerNode(plan.id)];
      }
      return [];
    });
  }

  return nodes.filter((node) =>
    node.requiredInputs.every(({ select }) => select(state) !== undefined),
  );
}

function isCourseReadyToComplete(state: CourseGenerationState) {
  return Boolean(
    state.intent &&
      state.outline &&
      state.briefs &&
      state.pageWorkerBriefs &&
      state.pages.length === state.outline.pages.length &&
      state.pages.every(({ status }) => status === "completed"),
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
    errors: [...state.errors, error],
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
): stage is "page_writer" | "assets" | "html" {
  return stage === "page_writer" || stage === "assets" || stage === "html";
}

function durationSince(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
