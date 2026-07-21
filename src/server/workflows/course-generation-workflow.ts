import type { AgentRuntimeContext } from "@/server/agents/core/types";
import {
  createCourseDesignNode,
  createIntentNode,
  createPlannerNode,
  type CourseGenerationNode,
} from "@/server/workflows/course-generation-nodes";
import {
  appendCourseGenerationEvent,
  checkpointCourseGenerationState,
  completeCourseGeneration,
  failCourseGeneration,
  failCourseGenerationNode,
  getCourseNodeRetryFeedback,
  initializeCourseGenerationState,
  requireCourseGenerationValue,
  resolveCourseGenerationDependencies,
  runCourseGenerationNodes,
  startCourseGeneration,
  type CourseGenerationWorkflowDependencies,
  type CourseGenerationWorkflowInput,
} from "@/server/workflows/course-generation-runtime";
import { runCourseWorkersWorkflow } from "@/server/workflows/course-workers-workflow";
import { runSupervisedWorkflow } from "@/server/workflows/supervised-workflow";
import {
  targetKey,
  type CourseGenerationState,
  type SupervisorDecision,
  type SupervisorNodeTarget,
} from "@/shared/course-schema";

export type { CourseMvpPageCount } from "@/server/workflows/course-generation-nodes";
export type {
  CourseGenerationWorkflowDependencies,
  CourseGenerationWorkflowInput,
} from "@/server/workflows/course-generation-runtime";

/**
 * 手写兼容入口：Supervisor 负责全局 Specialist，页面产物交给隔离的
 * Page Worker 与受控 Promise Pool；LangGraph 迁移期间它仍是显式 fallback。
 */
export async function runCourseGenerationWorkflow(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
): Promise<CourseGenerationState> {
  const dependencies = resolveCourseGenerationDependencies(overrides);
  let state = initializeCourseGenerationState(input, context, dependencies.now);

  if (state.status === "completed") return state;

  state = await startCourseGeneration(state, input, dependencies);

  const supervisedResult = await runSupervisedWorkflow({
    state,
    context,
    listAvailableNodes: listAvailableGlobalNodes,
    isReadyToComplete: isGlobalWorkReady,
    decide: (supervisorInput) =>
      dependencies.runSupervisor(supervisorInput, context),
    execute: (current, node, retryFailure) =>
      runCourseGenerationNodes(
        current,
        [node],
        input,
        context,
        dependencies,
        getCourseNodeRetryFeedback(current, node, retryFailure),
      ),
    recordDecision: (current, decision, node) =>
      recordSupervisorDecision(current, decision, node, dependencies),
    checkpoint: (current) =>
      checkpointCourseGenerationState(current, dependencies),
  });

  if (supervisedResult.status === "failed") {
    return failCourseGenerationNode(
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
    return failCourseGeneration(
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
    requireCourseGenerationValue(state.workerConfig, "page worker config"),
    dependencies,
  );
  if (workersResult.status === "failed") {
    return failCourseGeneration(
      workersResult.state,
      workersResult.error,
      context,
      dependencies,
      { agent: "page-worker" },
    );
  }

  return completeCourseGeneration(workersResult.state, dependencies);
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
  const next = appendCourseGenerationEvent(
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
  return checkpointCourseGenerationState(next, dependencies);
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
