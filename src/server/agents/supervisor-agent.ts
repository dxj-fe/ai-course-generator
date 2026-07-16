import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { buildSupervisorPrompts } from "@/server/prompts/supervisor";
import {
  SupervisorDecisionSchema,
  formatZodIssues,
  type CourseGenerationStage,
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
    currentStage: "page_writer" | "assets" | "html" | "complete";
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
  const output = await dependencies.generateDecision({
    abortSignal: context.abortSignal,
    input,
    traceId: context.traceId,
  });
  const parsed = SupervisorDecisionSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `SupervisorDecision 结构校验失败：${formatZodIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

async function generateDecision(input: {
  abortSignal?: AbortSignal;
  input: SupervisorInput;
  traceId: string;
}) {
  const prompts = await buildSupervisorPrompts(input.input);

  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
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
