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

// lease 只负责防止活跃 Worker 重复领取，不应变成进程崩溃后的固定 15 分钟
// 等待。真正执行 Agent 时会按该 WorkOrder 的总预算再续期。
export const RUN_LEASE_MS = 2 * 60_000;
export const AGENT_ATTEMPT_LEASE_GRACE_MS = 60_000;

const WORK_ORDER_LEASE_MS = 2 * 60_000;

export function normalizeConcurrency(value: number | undefined) {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError("课程生成并发数必须在 1 到 5 之间");
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
  if (
    (Object.values(AgentIds) as string[]).includes(workOrder.agentId)
  ) {
    return workOrder.agentId as AgentId;
  }
  throw new Error(
    `WorkOrder ${workOrder.id} 引用了未知 Agent：${workOrder.agentId}`,
  );
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
