import { MAX_REPAIR_ROUNDS } from "@/shared/course-schema";
import {
  SupervisorDecisionSchema,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
  type SupervisorDecision,
} from "@/shared/course-schema";
import {
  isPageWorkerRetryableError,
  PAGE_WORKER_MAX_STAGE_ATTEMPTS,
} from "@/server/workflows/page-worker";
import { retrieveSkillCards } from "@/server/tools/retrieval-skills";

export const COURSE_GRAPH_ROUTES = [
  "intent-node",
  "planner-node",
  "briefs-node",
  "page-workers-node",
  "repair-page-node",
  "retry-page-node",
  "finalize-node",
  "mark-failed-node",
] as const;

export type CourseGraphRoute = (typeof COURSE_GRAPH_ROUTES)[number];

const MAX_GRAPH_SUPERVISOR_DECISIONS = 63;

/**
 * Rule-first Graph Supervisor. Specialist outputs, budgets and stop conditions
 * are facts from validated state; no model call is needed when only one route is legal.
 */
export function decideCourseGraphSupervisor(
  state: CourseGenerationState,
): SupervisorDecision {
  if ((state.supervisor?.decisionCount ?? 0) >= MAX_GRAPH_SUPERVISOR_DECISIONS) {
    return stop(
      "decision_limit",
      "LangGraph Supervisor 已达到全局决策上限。",
      false,
    );
  }

  if (state.status === "cancelled") {
    return stop("requested", "课程生成已取消。", true);
  }
  if (state.status === "failed") {
    return stop(
      "non_retryable_error",
      state.errors.at(-1)?.message ?? "课程生成已经失败。",
      true,
    );
  }
  if (state.status === "completed") {
    return complete("课程已经完成，LangGraph 不再调度节点。");
  }

  if (!state.intent) {
    return run("intent", undefined, "课程意图尚未生成，执行 Intent Specialist。");
  }
  if (!state.outline) {
    return run("planner", undefined, "课程意图已校验，执行 Planner Specialist。");
  }
  if (!state.briefs || !state.pageWorkerBriefs || !state.workerConfig) {
    return run(
      "course-design",
      undefined,
      "课程规划已校验，生成专业 briefs 与 Page Worker handoff。",
    );
  }

  const repairPage = state.pages.find(
    (page) => page.qualityReport?.shouldRepair && page.status !== "completed",
  );
  if (repairPage) {
    const rounds = repairPage.repairHistory?.length ?? 0;
    if (rounds >= MAX_REPAIR_ROUNDS) {
      return stop(
        "retry_exhausted",
        `页面 ${repairPage.pageId} 已达到 ${MAX_REPAIR_ROUNDS} 轮 Repair 预算。`,
        true,
      );
    }
    return run(
      "repair",
      repairPage.pageId,
      `页面 ${repairPage.pageId} 的 QA 要求修订，执行第 ${rounds + 1} 轮定向 Repair。`,
    );
  }

  const failedPage = state.pages.find(({ status }) => status === "failed");
  if (failedPage) {
    return retryOrStopPage(state, failedPage);
  }

  const nextPage = state.pages.find(({ status }) => status !== "completed");
  if (nextPage) {
    return run(
      "page-worker",
      nextPage.pageId,
      `页面依赖已满足，继续执行以 ${nextPage.pageId} 为首的 Page Worker 批次。`,
    );
  }

  if (state.pages.length > 0 && state.pages.every(({ status }) => status === "completed")) {
    return complete("全部规划页面均已完成，进入课程 Finalize。");
  }

  return stop(
    "no_available_node",
    "当前状态没有满足输入合同的 LangGraph 节点。",
    true,
  );
}

/** 条件边只读取已持久化并通过 Schema 的最后决策。 */
export function routeBySupervisor(state: CourseGenerationState): CourseGraphRoute {
  const decision = SupervisorDecisionSchema.parse(
    state.supervisor?.lastDecision,
  );
  if (decision.action === "complete") return "finalize-node";
  if (decision.action === "stop") return "mark-failed-node";
  if (decision.action === "retry") return "retry-page-node";

  switch (decision.nextNode.nodeName) {
    case "intent":
      return "intent-node";
    case "planner":
      return "planner-node";
    case "course-design":
      return "briefs-node";
    case "repair":
      return "repair-page-node";
    case "page-worker":
    case "page-writer":
    case "assets":
    case "html-engineer":
    case "page-qa":
      return "page-workers-node";
  }
}

export function supervisorEventTarget(
  state: CourseGenerationState,
  decision: SupervisorDecision,
): { stage: CourseGenerationStage; pageId?: string } {
  if (decision.action === "complete") return { stage: "complete" };
  if (decision.action === "stop") {
    const page = state.pages.find(({ status }) => status === "failed") ??
      state.pages.find(({ qualityReport }) => qualityReport?.shouldRepair);
    return { stage: page?.currentStage ?? state.currentStage, pageId: page?.pageId };
  }

  const { nodeName, pageId } = decision.nextNode;
  const stage: CourseGenerationStage =
    nodeName === "intent"
      ? "intent"
      : nodeName === "planner"
        ? "planner"
        : nodeName === "course-design"
          ? "design"
          : nodeName === "assets"
            ? "assets"
            : nodeName === "html-engineer"
              ? "html"
              : nodeName === "page-qa"
                ? "qa"
                : nodeName === "repair"
                  ? "repair"
                  : "page_writer";
  return { stage, pageId };
}

function retryOrStopPage(
  state: CourseGenerationState,
  page: PageGenerationState,
): SupervisorDecision {
  const stageAttempts =
    page.attempts?.find(({ stage }) => stage === page.currentStage)?.attempts ??
    0;
  const graphAttempts =
    state.supervisor?.attempts.find(
      (attempt) =>
        attempt.nodeName === "page-worker" && attempt.pageId === page.pageId,
    )?.attempts ?? 0;
  const attempts = Math.max(stageAttempts, graphAttempts);
  const code = page.error?.code ?? "PAGE_WORKER_FAILED";
  const retryable =
    isPageWorkerRetryableError(code) ||
    isLegacyGraphRecursionFailure(page.error);
  if (
    page.currentStage !== "repair" &&
    retryable &&
    attempts < PAGE_WORKER_MAX_STAGE_ATTEMPTS
  ) {
    const target = { nodeName: "page-worker" as const, pageId: page.pageId };
    return SupervisorDecisionSchema.parse({
      action: "retry",
      nextNode: target,
      retryTarget: target,
      reasonSummary: `页面 ${page.pageId} 的 ${page.currentStage} 阶段仍在重试预算内。`,
    });
  }

  return stop(
    attempts >= PAGE_WORKER_MAX_STAGE_ATTEMPTS
      ? "retry_exhausted"
      : "non_retryable_error",
    page.error?.message ?? `页面 ${page.pageId} 无法继续执行。`,
    true,
  );
}

/** Day 31 默认 25-step 上限曾覆盖具体页面错误；只为该旧 checkpoint 开放恢复。 */
function isLegacyGraphRecursionFailure(
  error: PageGenerationState["error"],
) {
  return (
    error?.code === "COURSE_TASK_EXECUTION_ERROR" &&
    error.message.startsWith("Recursion limit of 25 reached")
  );
}

function run(
  nodeName: "intent" | "planner" | "course-design" | "page-worker" | "repair",
  pageId: string | undefined,
  reasonSummary: string,
) {
  const capability = retrieveSkillCards({
    agentName: supervisorAgentName(nodeName),
    task: reasonSummary,
    limit: 1,
  }).matches[0]?.card;
  return SupervisorDecisionSchema.parse({
    action: "run",
    nextNode: { nodeName, pageId },
    reasonSummary: summarizeSupervisorReason(
      capability
        ? `${reasonSummary} 可用能力：${capability.name}。`
        : reasonSummary,
    ),
  });
}

function supervisorAgentName(
  nodeName: "intent" | "planner" | "course-design" | "page-worker" | "repair",
) {
  return nodeName;
}

function complete(reasonSummary: string) {
  return SupervisorDecisionSchema.parse({
    action: "complete",
    reasonSummary: summarizeSupervisorReason(reasonSummary),
  });
}

function stop(
  code:
    | "requested"
    | "retry_exhausted"
    | "non_retryable_error"
    | "no_available_node"
    | "decision_limit",
  message: string,
  recoverable: boolean,
) {
  return SupervisorDecisionSchema.parse({
    action: "stop",
    reasonSummary: summarizeSupervisorReason(message),
    stopReason: {
      code,
      message: truncateWithEllipsis(message, 500),
      recoverable,
    },
  });
}

function summarizeSupervisorReason(message: string) {
  return truncateWithEllipsis(message, 300);
}

function truncateWithEllipsis(message: string, maximum: number) {
  const normalized = message.trim() || "课程生成无法继续。";
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}
