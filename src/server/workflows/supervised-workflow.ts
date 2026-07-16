import type { AgentRuntimeContext } from "@/server/agents/core/types";
import type {
  SupervisorInput,
  SupervisorRecentFailure,
} from "@/server/agents/supervisor-agent";
import type {
  CourseGenerationNode,
  CourseGenerationNodeName,
} from "@/server/workflows/course-generation-nodes";
import type {
  SequentialWorkflowResult,
  WorkflowNodeError,
} from "@/server/workflows/sequential-workflow";
import {
  targetKey,
  type CourseGenerationState,
  type SupervisorDecision,
  type SupervisorNodeTarget,
} from "@/shared/course-schema";

const MAX_ATTEMPTS_PER_TARGET = 3;
// 第 64 条保留给确定性停止决策，避免达到上限后无法持久化 stopReason。
const MAX_SUPERVISOR_DECISIONS = 63;

type NodeExecutionResult = SequentialWorkflowResult<
  CourseGenerationState,
  CourseGenerationNodeName
>;

export type SupervisedWorkflowResult =
  | { status: "completed"; state: CourseGenerationState }
  | {
      status: "failed";
      state: CourseGenerationState;
      node: CourseGenerationNode;
      error: WorkflowNodeError<CourseGenerationNodeName>;
    }
  | {
      status: "stopped";
      state: CourseGenerationState;
      decision: Extract<SupervisorDecision, { action: "stop" }>;
      node?: CourseGenerationNode;
      error?: WorkflowNodeError<CourseGenerationNodeName>;
    };

export type RunSupervisedWorkflowOptions = {
  state: CourseGenerationState;
  context: AgentRuntimeContext;
  listAvailableNodes(state: CourseGenerationState): CourseGenerationNode[];
  isReadyToComplete(state: CourseGenerationState): boolean;
  decide(input: SupervisorInput): Promise<SupervisorDecision>;
  execute(
    state: CourseGenerationState,
    node: CourseGenerationNode,
  ): Promise<NodeExecutionResult>;
  recordDecision(
    state: CourseGenerationState,
    decision: SupervisorDecision,
    node?: CourseGenerationNode,
  ): Promise<CourseGenerationState>;
  checkpoint(state: CourseGenerationState): Promise<CourseGenerationState>;
};

/**
 * 有限 Supervisor 循环：模型只能在确定性候选节点中选择，预算和终止由代码控制。
 */
export async function runSupervisedWorkflow({
  state: initialState,
  context,
  listAvailableNodes,
  isReadyToComplete,
  decide,
  execute,
  recordDecision,
  checkpoint,
}: RunSupervisedWorkflowOptions): Promise<SupervisedWorkflowResult> {
  let state = initialState;
  let recentFailure:
    | {
        node: CourseGenerationNode;
        error: WorkflowNodeError<CourseGenerationNodeName>;
        retryable: boolean;
      }
    | undefined;

  while (true) {
    if (context.abortSignal?.aborted) {
      const decision = stopDecision(
        "non_retryable_error",
        "课程生成已取消，Supervisor 停止调度。",
        "取消信号不可自动重试。",
        true,
      );
      state = await recordDecision(state, decision, recentFailure?.node);
      return {
        status: "stopped",
        state,
        decision,
        node: recentFailure?.node,
        error: recentFailure?.error,
      };
    }

    if ((state.supervisor?.decisionCount ?? 0) >= MAX_SUPERVISOR_DECISIONS) {
      const decision = stopDecision(
        "decision_limit",
        "Supervisor 已达到全局决策上限，停止自动执行。",
        `最多允许 ${MAX_SUPERVISOR_DECISIONS} 次调度决策。`,
        true,
      );
      state = await recordDecision(state, decision, recentFailure?.node);
      return {
        status: "stopped",
        state,
        decision,
        node: recentFailure?.node,
        error: recentFailure?.error,
      };
    }

    const readyToComplete = isReadyToComplete(state);
    const allAvailableNodes = listAvailableNodes(state);
    const failedNode = recentFailure?.node;
    const failureScopedNodes = failedNode
      ? allAvailableNodes.filter(
          (node) => nodeTargetKey(node) === nodeTargetKey(failedNode),
        )
      : allAvailableNodes;
    const availableNodes = failureScopedNodes.filter(
      (node) =>
        getAttemptCount(state, targetFor(node)) < MAX_ATTEMPTS_PER_TARGET,
    );

    if (
      !readyToComplete &&
      failureScopedNodes.length > 0 &&
      availableNodes.length === 0
    ) {
      const exhaustedNode = failureScopedNodes[0]!;
      const decision = stopDecision(
        "retry_exhausted",
        `${targetLabel(exhaustedNode)} 已耗尽 2 次重试预算，停止自动执行。`,
        "持久化执行次数已达到 3 次。",
        true,
      );
      state = await recordDecision(state, decision, exhaustedNode);
      return {
        status: "stopped",
        state,
        decision,
        node: exhaustedNode,
        error: recentFailure?.error,
      };
    }

    if (!readyToComplete && availableNodes.length === 0) {
      const decision = stopDecision(
        "no_available_node",
        "当前状态没有满足输入合同的可用节点，停止自动执行。",
        "课程仍未完成，但运行层无法找到合法的下一节点。",
        true,
      );
      state = await recordDecision(state, decision, recentFailure?.node);
      return {
        status: "stopped",
        state,
        decision,
        node: recentFailure?.node,
        error: recentFailure?.error,
      };
    }

    if (recentFailure) {
      const attempts = getAttemptCount(state, targetFor(recentFailure.node));
      if (!recentFailure.retryable || attempts >= MAX_ATTEMPTS_PER_TARGET) {
        const exhausted = attempts >= MAX_ATTEMPTS_PER_TARGET;
        const decision = stopDecision(
          exhausted ? "retry_exhausted" : "non_retryable_error",
          exhausted
            ? `${targetLabel(recentFailure.node)} 已耗尽 2 次重试预算，停止自动执行。`
            : `${targetLabel(recentFailure.node)} 返回不可重试错误，停止自动执行。`,
          recentFailure.error.message,
          true,
        );
        state = await recordDecision(state, decision, recentFailure.node);
        return {
          status: "stopped",
          state,
          decision,
          node: recentFailure.node,
          error: recentFailure.error,
        };
      }
    }

    let proposal: SupervisorDecision;
    try {
      proposal = await decide(
        buildSupervisorInput(
          state,
          availableNodes,
          readyToComplete,
          recentFailure,
        ),
      );
    } catch (error) {
      const decision = stopDecision(
        "invalid_decision",
        "Supervisor 未返回有效结构化决策，停止自动执行。",
        error instanceof Error ? error.message : "Supervisor 决策失败。",
        true,
      );
      state = await recordDecision(state, decision, recentFailure?.node);
      return {
        status: "stopped",
        state,
        decision,
        node: recentFailure?.node,
        error: recentFailure?.error,
      };
    }

    const resolved = resolveDecision(
      proposal,
      availableNodes,
      readyToComplete,
      Boolean(recentFailure),
    );
    if (resolved.status === "invalid") {
      const decision = stopDecision(
        "invalid_decision",
        "Supervisor 决策未通过运行层校验，停止自动执行。",
        resolved.message,
        true,
      );
      state = await recordDecision(state, decision, recentFailure?.node);
      return {
        status: "stopped",
        state,
        decision,
        node: recentFailure?.node,
        error: recentFailure?.error,
      };
    }

    state = await recordDecision(state, proposal, resolved.node);

    if (proposal.action === "complete") {
      return { status: "completed", state };
    }
    if (proposal.action === "stop") {
      return {
        status: "stopped",
        state,
        decision: proposal,
        node: recentFailure?.node,
        error: recentFailure?.error,
      };
    }

    const node = resolved.node!;
    const progressBefore = progressFingerprint(state);
    const execution = await execute(state, node);
    state = execution.state;

    if (execution.status === "failed") {
      state = await checkpoint(state);
      recentFailure = {
        node,
        error: execution.error,
        retryable: isRetryableError(execution.error.code),
      };
      continue;
    }

    if (progressFingerprint(state) === progressBefore) {
      const decision = stopDecision(
        "no_progress",
        `${targetLabel(node)} 执行后没有产生新的有效状态，停止自动执行。`,
        "成功结果没有推进课程产物状态。",
        true,
      );
      state = await recordDecision(state, decision, node);
      return { status: "stopped", state, decision, node };
    }

    recentFailure = undefined;
  }
}

function buildSupervisorInput(
  state: CourseGenerationState,
  availableNodes: CourseGenerationNode[],
  readyToComplete: boolean,
  recentFailure:
    | {
        node: CourseGenerationNode;
        error: WorkflowNodeError<CourseGenerationNodeName>;
        retryable: boolean;
      }
    | undefined,
): SupervisorInput {
  const failure = recentFailure
    ? ({
        target: targetFor(recentFailure.node),
        code: recentFailure.error.code,
        message: recentFailure.error.message,
        retryable: recentFailure.retryable,
        attempts: getAttemptCount(state, targetFor(recentFailure.node)),
        maxAttempts: MAX_ATTEMPTS_PER_TARGET,
      } satisfies SupervisorRecentFailure)
    : undefined;

  return {
    stateSummary: {
      status: state.status,
      currentStage: state.currentStage,
      currentPageId: state.currentPageId,
      readyToComplete,
      hasIntent: Boolean(state.intent),
      hasOutline: Boolean(state.outline),
      hasCourseDesign: Boolean(state.briefs && state.pageWorkerBriefs),
      pages: state.pages.map((page) => ({
        pageId: page.pageId,
        order: page.order,
        status: page.status,
        currentStage: page.currentStage,
        hasContent: Boolean(page.content),
        hasHtml: Boolean(page.htmlOutput),
      })),
    },
    availableNodes: availableNodes.map((node) => ({
      target: targetFor(node),
      stage: node.stage,
      agent: node.agent,
      requiredInputs: node.requiredInputs.map(({ name }) => name),
      produces: node.produces.map(({ name }) => name),
    })),
    attempts: state.supervisor?.attempts ?? [],
    recentFailure: failure,
  };
}

function resolveDecision(
  decision: SupervisorDecision,
  availableNodes: CourseGenerationNode[],
  readyToComplete: boolean,
  hasRecentFailure: boolean,
):
  | { status: "valid"; node?: CourseGenerationNode }
  | { status: "invalid"; message: string } {
  if (decision.action === "complete") {
    return readyToComplete
      ? { status: "valid" }
      : {
          status: "invalid",
          message: "课程产物尚未完整，不能结束工作流。",
        };
  }
  if (decision.action === "stop") return { status: "valid" };

  if (hasRecentFailure && decision.action !== "retry") {
    return {
      status: "invalid",
      message: "节点失败后只能选择 retry 或 stop。",
    };
  }
  if (!hasRecentFailure && decision.action !== "run") {
    return {
      status: "invalid",
      message: "没有最近失败时只能选择 run、complete 或 stop。",
    };
  }

  const node = availableNodes.find(
    (candidate) => nodeTargetKey(candidate) === targetKey(decision.nextNode),
  );
  return node
    ? { status: "valid", node }
    : {
        status: "invalid",
        message: "nextNode 不在运行层提供的 availableNodes 中。",
      };
}

function isRetryableError(code: string) {
  return new Set([
    "AGENT_EXECUTION_ERROR",
    "AGENT_STEP_LIMIT",
    "WORKFLOW_NODE_EXECUTION_ERROR",
    "MODEL_TIMEOUT",
    "MODEL_RATE_LIMITED",
    "MODEL_PROVIDER_ERROR",
    "PLANNER_FAILED",
    "COURSE_DESIGN_FAILED",
    "PAGE_WRITER_FAILED",
    "IMAGE_ASSETS_FAILED",
    "HTML_ENGINEER_FAILED",
  ]).has(code);
}

function stopDecision(
  code: Extract<SupervisorDecision, { action: "stop" }>["stopReason"]["code"],
  reasonSummary: string,
  message: string,
  recoverable: boolean,
): Extract<SupervisorDecision, { action: "stop" }> {
  return {
    action: "stop",
    reasonSummary,
    stopReason: { code, message, recoverable },
  };
}

function targetFor(node: CourseGenerationNode): SupervisorNodeTarget {
  return { nodeName: node.name, pageId: node.pageId };
}

function nodeTargetKey(node: CourseGenerationNode) {
  return targetKey(targetFor(node));
}

function getAttemptCount(
  state: CourseGenerationState,
  target: SupervisorNodeTarget,
) {
  const key = targetKey(target);
  return (
    state.supervisor?.attempts.find((attempt) => targetKey(attempt) === key)
      ?.attempts ?? 0
  );
}

function targetLabel(node: CourseGenerationNode) {
  return node.pageId ? `${node.name}（${node.pageId}）` : node.name;
}

function progressFingerprint(state: CourseGenerationState) {
  return JSON.stringify({
    intent: Boolean(state.intent),
    outline: state.outline?.pages.map(({ id }) => id),
    design: Boolean(state.briefs && state.pageWorkerBriefs),
    pages: state.pages.map((page) => ({
      pageId: page.pageId,
      status: page.status,
      currentStage: page.currentStage,
      hasContent: Boolean(page.content),
      assetCount: page.assets.length,
      hasHtml: Boolean(page.htmlOutput),
    })),
  });
}
