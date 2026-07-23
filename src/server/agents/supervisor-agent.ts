import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { buildSupervisorPrompts } from "@/server/prompts/supervisor";
import {
  SupervisorDecisionSchema,
  formatZodIssues,
  targetKey,
  type CourseGenerationStage,
  type SkillCard,
  type SupervisorAttempt,
  type SupervisorDecision,
  type SupervisorNodeTarget,
} from "@/shared/course-schema";

export type SupervisorAvailableNode = {
  target: SupervisorNodeTarget;
  stage: CourseGenerationStage;
  agent: string;
  requiredInputs: readonly string[];
  produces: readonly string[];
  skills: SkillCard[];
};

export type SupervisorRecentFailure = {
  target: SupervisorNodeTarget;
  code: string;
  message: string;
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
};

export type SupervisorStateSummary = {
  status: "running" | "completed" | "failed" | "cancelled";
  currentStage: CourseGenerationStage;
  currentPageId?: string;
  readyToComplete: boolean;
  hasIntent: boolean;
  hasOutline: boolean;
  hasCourseDesign: boolean;
  pages: Array<{
    pageId: string;
    order: number;
    status: "pending" | "running" | "completed" | "failed";
    currentStage:
      | "page_writer"
      | "assets"
      | "html"
      | "qa"
      | "repair"
      | "complete";
    hasContent: boolean;
    hasHtml: boolean;
  }>;
};

export type SupervisorInput = {
  stateSummary: SupervisorStateSummary;
  availableNodes: SupervisorAvailableNode[];
  attempts: SupervisorAttempt[];
  recentFailure?: SupervisorRecentFailure;
};

export type SupervisorAgentDependencies = {
  generateDecision(input: {
    abortSignal?: AbortSignal;
    input: SupervisorInput;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: SupervisorAgentDependencies = {
  generateDecision,
};

/**
 * Supervisor 只返回调度提案；节点可用性、预算和停止条件仍由运行层确定性校验。
 */
export async function runSupervisorAgent(
  input: SupervisorInput,
  context: AgentRuntimeContext,
  dependencies: SupervisorAgentDependencies = defaultDependencies,
): Promise<SupervisorDecision> {
  let output: unknown;
  try {
    output = await dependencies.generateDecision({
      abortSignal: context.abortSignal,
      input,
      traceId: context.traceId,
    });
  } catch (error) {
    const fallback =
      error instanceof AiSchemaValidationError
        ? deterministicSchemaFallback(input)
        : undefined;
    if (fallback) return SupervisorDecisionSchema.parse(fallback);
    throw error;
  }
  const parsed = SupervisorDecisionSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `SupervisorDecision 结构校验失败：${formatZodIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

/**
 * OpenAI-compatible Provider 可能只保证 JSON object，而不执行 union schema。
 * 仅当运行层已经把合法动作压缩为唯一选择时，才允许确定性降级；存在多个
 * 候选时仍保留 Schema 错误，不能替模型猜测路由。
 */
function deterministicSchemaFallback(
  input: SupervisorInput,
): SupervisorDecision | undefined {
  if (
    input.stateSummary.readyToComplete &&
    input.availableNodes.length === 0
  ) {
    return {
      action: "complete",
      reasonSummary:
        "Supervisor 结构化输出无效；运行层确认全部必需产物已经完成。",
    };
  }

  if (input.availableNodes.length !== 1) return undefined;
  const available = input.availableNodes[0]!;
  const recentFailure = input.recentFailure;

  if (!recentFailure) {
    return {
      action: "run",
      nextNode: available.target,
      reasonSummary: `Supervisor 结构化输出无效；运行层确定当前仅有 ${available.target.nodeName} 节点可执行。`,
    };
  }

  if (
    recentFailure.retryable &&
    recentFailure.attempts < recentFailure.maxAttempts &&
    targetKey(recentFailure.target) === targetKey(available.target)
  ) {
    return {
      action: "retry",
      nextNode: available.target,
      retryTarget: available.target,
      reasonSummary: `Supervisor 结构化输出无效；${available.target.nodeName} 仍在页面级重试预算内。`,
    };
  }

  return undefined;
}

async function generateDecision(input: {
  abortSignal?: AbortSignal;
  input: SupervisorInput;
  traceId: string;
}) {
  const prompts = await buildSupervisorPrompts(input.input);

  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "supervisor",
    maxTokens: 800,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: SupervisorDecisionSchema,
    schemaDescription:
      "A bounded routing decision for the course generation supervisor.",
    schemaName: "supervisor_decision",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.1,
    traceId: input.traceId,
  });
}
