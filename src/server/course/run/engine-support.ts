import type {
  CourseGenerationCauseCode,
  WorkOrder,
} from "@/shared/course-schema";
import {
  AgentIds,
  type AgentId,
} from "@/server/agent/ids";
import {
  classifyPublicAgentError,
  toCourseGenerationCauseCode,
} from "@/server/course/projection/public-error";

export const RUN_LEASE_MS = 15 * 60_000;
export const AGENT_ATTEMPT_LEASE_GRACE_MS = 60_000;

const WORK_ORDER_LEASE_MS = 10 * 60_000;

export function normalizeConcurrency(value: number | undefined) {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError("agent-v2 concurrency 必须在 1 到 5 之间");
  }
  return value;
}

export function workOrderLeaseDuration(workOrder: WorkOrder) {
  return Math.max(
    WORK_ORDER_LEASE_MS,
    workOrder.budget.timeoutMs + AGENT_ATTEMPT_LEASE_GRACE_MS,
  );
}

export function errorCode(error: unknown) {
  return classifyPublicAgentError({ error }).code;
}

export function safeErrorMessage(error: unknown) {
  return classifyPublicAgentError({ error }).message;
}

export function toCauseCode(
  code: string,
): CourseGenerationCauseCode | undefined {
  return toCourseGenerationCauseCode(code);
}

export function stageForOrder(workOrder: WorkOrder) {
  if (workOrder.kind === "architect_course") return "planning";
  if (workOrder.kind === "review_course") return "course_review";
  if (workOrder.kind === "fix_page") return "repair";
  if (workOrder.kind === "build_page") return "page_writer";
  return "course_review";
}

export function agentForOrder(workOrder: WorkOrder): AgentId {
  if (workOrder.agentId) {
    if (
      (Object.values(AgentIds) as string[]).includes(workOrder.agentId)
    ) {
      return workOrder.agentId as AgentId;
    }
    throw new Error(
      `WorkOrder ${workOrder.id} 引用了未知 Agent：${workOrder.agentId}`,
    );
  }

  // 只兼容迁移前已经持久化、尚未包含 agentId 的 WorkOrder。
  if (workOrder.kind === "architect_course") {
    return AgentIds.CourseArchitect;
  }
  if (workOrder.kind === "review_course") {
    return AgentIds.CourseReviewer;
  }
  if (workOrder.kind === "director_round") {
    return AgentIds.CourseDirector;
  }
  return AgentIds.CoursePageBuilder;
}

export function isAbortError(
  error: unknown,
  signal: AbortSignal | undefined,
) {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("课程生成已取消。", "AbortError");
}
