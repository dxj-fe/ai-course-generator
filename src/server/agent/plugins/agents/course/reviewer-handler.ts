import { getLanguageModel } from "@/server/infra/ai/model-provider";
import { resolveModelRoute } from "@/server/infra/ai/model-router";
import {
  AgentIds,
  ToolIds,
} from "@/server/agent/ids";
import { getAgentSystem } from "@/server/setup/agent";
import {
  authorizeCourseReviewerToolCall,
  createCourseReviewerExecution,
  loadCourseReviewerTerminal,
  parseCourseReviewerTerminal,
  resolveCourseReviewerActiveTools,
  type CourseReviewerExecutionInput,
} from "@/server/agent/plugins/contexts/course/reviewer";
import {
  createCourseReviewerTools,
  type CourseReviewerTools,
} from "@/server/agent/plugins/tools/course/reviewer";
import {
  AgentRunner,
  type AgentRunnerResult,
  type RuntimeAgentFactory,
} from "@/server/agent/runtime";
import { createCourseToolLedger } from "@/server/course/run/tool-ledger";
import type { Submission } from "@/shared/course-schema";

export type CourseReviewerAgentDependencies = {
  createAgent?: RuntimeAgentFactory<CourseReviewerTools>;
  model?: unknown;
  now?: () => string;
};

/**
 * Reviewer 只审查冻结 manifest 的实际产物，不修改页面，也不派发返工。
 * 只有 submit/block 工具成功写入 Repository 才算当前 Agent 回合结束。
 */
export async function runCourseReviewerAgent(
  input: CourseReviewerExecutionInput,
  dependencies: CourseReviewerAgentDependencies = {},
): Promise<AgentRunnerResult<Submission>> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const agentSystem = await getAgentSystem();
  const agentDefinition = agentSystem.agents.get(
    AgentIds.CourseReviewer,
  );
  const instructions = await agentSystem.prompts.render(
    agentDefinition.prompt,
    {},
  );
  const execution = createCourseReviewerExecution(input);
  const tools = createCourseReviewerTools(execution, { now });
  const runner = new AgentRunner<CourseReviewerTools, Submission>({
    createAgent: dependencies.createAgent,
    terminalStateLoader: {
      load: async () => loadCourseReviewerTerminal(execution),
      parse: (value) =>
        parseCourseReviewerTerminal(execution, value),
    },
  });
  return runner.run({
    abortSignal: execution.abortSignal,
    activeTools: resolveCourseReviewerActiveTools(execution),
    authorizeToolCall: (call) =>
      authorizeCourseReviewerToolCall(execution, call, now()),
    beforeToolCall: input.beforeToolCall,
    budget: {
      maxOutputTokens:
        execution.initialWorkOrder.budget.maxOutputTokens,
      maxSteps: execution.initialWorkOrder.budget.maxSteps,
      maxToolCalls:
        execution.initialWorkOrder.budget.maxToolCalls,
      timeout: {
        totalMs: execution.initialWorkOrder.budget.timeoutMs,
      },
    },
    instructions,
    model:
      dependencies.model ??
      getLanguageModel(
        resolveModelRoute(agentDefinition.modelCapability).primary,
      ),
    prompt: buildCourseReviewerPrompt(execution),
    prepareStep: () => ({
      activeTools: resolveCourseReviewerActiveTools(execution),
    }),
    temperature: 0.1,
    terminalToolNames: [
      ToolIds.SubmitCourseReview,
      ToolIds.BlockCourseReview,
    ],
    toolLedger: createCourseToolLedger(
      execution.repository.toolOperations,
      execution.initialWorkOrder,
    ),
    tools,
    traceId: execution.traceId,
    workOrderId: execution.initialWorkOrder.id,
  });
}

function buildCourseReviewerPrompt(
  execution: ReturnType<typeof createCourseReviewerExecution>,
) {
  return `请完成当前整课审查 WorkOrder。

courseId：${execution.initialWorkOrder.courseId}
revision：${execution.initialWorkOrder.revision}
manifestHash：${execution.frozenManifestHash}
页面顺序：${JSON.stringify(
    execution.frozenManifest.pages.map(({ pageId, order }) => ({
      pageId,
      order,
    })),
  )}
验收要求：${JSON.stringify(execution.initialWorkOrder.acceptance)}

必须基于这个 manifestHash 提交；任何页面版本变化都应停止旧审查。`;
}
