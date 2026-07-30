import { getLanguageModel } from "@/server/infra/ai/model-provider";
import { resolveModelRoute } from "@/server/infra/ai/model-router";
import {
  AgentIds,
  ToolIds,
} from "@/server/agent/ids";
import {
  type LocalResourceSession,
} from "@/server/agent/skill";
import { getAgentSystem } from "@/server/setup/agent";
import {
  assertPageBuilderToolCall,
  createPageBuilderExecution,
  loadPageBuilderTerminal,
  parsePageBuilderTerminal,
  type PageBuilderExecutionInput,
} from "@/server/agent/plugins/contexts/course/page-builder";
import {
  type PageBuilderModelSteps,
} from "@/server/agent/plugins/tools/course/page-builder-model-steps";
import {
  createPageBuilderTools,
  resolvePageBuilderActiveTools,
  type PageBuilderToolDependencies,
  type PageBuilderTools,
} from "@/server/agent/plugins/tools/course/page-builder";
import { prepareAgentSkillRuntime } from "@/server/agent/plugins/tools/system";
import {
  AgentRunner,
  type AgentRunnerResult,
  type RuntimeAgentFactory,
} from "@/server/agent/runtime";
import { createCourseToolLedger } from "@/server/course/run/tool-ledger";
import type { Submission } from "@/shared/course-schema";

export type PageBuilderAgentDependencies = {
  createAgent?: RuntimeAgentFactory<PageBuilderTools>;
  model?: unknown;
  modelSteps?: PageBuilderModelSteps;
  now?: () => string;
  pageGate?: PageBuilderToolDependencies["pageGate"];
};

export type RunPageBuilderAgentInput =
  PageBuilderExecutionInput;

const MODEL_GENERATION_TOOL_IDS = new Set<string>([
  ToolIds.GeneratePageContent,
  ToolIds.GeneratePageHtml,
  ToolIds.InspectPage,
  ToolIds.RepairPageContent,
  ToolIds.RepairPageHtml,
]);

/**
 * 每个页面只运行自己的 ToolLoopAgent。流程选择交给 Agent，所有读写仍由
 * WorkOrder scope、allowedTools、trace 和 lease 做硬约束。
 */
export async function runPageBuilderAgent(
  input: RunPageBuilderAgentInput,
  dependencies: PageBuilderAgentDependencies = {},
): Promise<AgentRunnerResult<Submission>> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const agentSystem = await getAgentSystem();
  const agentDefinition = agentSystem.agents.get(
    AgentIds.CoursePageBuilder,
  );
  const skillRuntime = await prepareAgentSkillRuntime({
    definition: agentDefinition,
    registry: agentSystem.skills,
    workOrderId: input.workOrder.id,
  });
  const localResourceSession: LocalResourceSession =
    skillRuntime.session;
  const execution = createPageBuilderExecution(input);
  execution.localResourceSession = localResourceSession;
  const instructions = await agentSystem.prompts.render(
    agentDefinition.prompt,
    {
      ...skillRuntime.promptContext,
      pageId: execution.pageId,
    },
  );
  const tools = createPageBuilderTools(execution, {
    modelSteps: dependencies.modelSteps,
    pageGate: dependencies.pageGate,
    readLocalResourceTool: skillRuntime.readLocalResourceTool,
  });
  const runner = new AgentRunner<PageBuilderTools, Submission>({
    ...(dependencies.createAgent
      ? { createAgent: dependencies.createAgent }
      : {}),
    terminalStateLoader: {
      load: async () => loadPageBuilderTerminal(execution),
      parse: (value) =>
        parsePageBuilderTerminal(execution, value),
    },
  });

  return runner.run({
    abortSignal: input.abortSignal,
    activeTools: resolvePageBuilderActiveTools(execution),
    authorizeToolCall: (toolCall) =>
      assertPageBuilderToolCall(execution, toolCall, now()),
    beforeToolCall: input.beforeToolCall,
    budget: {
      maxSteps: execution.initialWorkOrder.budget.maxSteps,
      maxToolCalls:
        execution.initialWorkOrder.budget.maxToolCalls,
      maxOutputTokens:
        execution.initialWorkOrder.budget.maxOutputTokens,
      maxToolResultBytes: 16 * 1024,
      timeout: execution.initialWorkOrder.budget.timeoutMs,
    },
    instructions,
    model:
      dependencies.model ??
      getLanguageModel(
        resolveModelRoute(agentDefinition.modelCapability).primary,
      ),
    prepareStep: () => ({
      activeTools: resolvePageBuilderActiveTools(execution),
    }),
    prompt: buildPageBuilderPrompt(execution),
    resolveToolCost: (toolName) =>
      toolName === ToolIds.ResolvePageAssets
        ? 4
        : MODEL_GENERATION_TOOL_IDS.has(toolName)
          ? 2
          : 1,
    temperature: 0.1,
    terminalToolNames: [ToolIds.SubmitPage, ToolIds.BlockPage],
    toolLedger: createCourseToolLedger(
      execution.repository.toolOperations,
      execution.initialWorkOrder,
    ),
    tools,
    traceId: execution.traceId,
    workOrderId: execution.initialWorkOrder.id,
  });
}

function buildPageBuilderPrompt(
  execution: ReturnType<typeof createPageBuilderExecution>,
) {
  return [
    `完成页面《${execution.pageTask.title}》。`,
    `页面职责：${execution.pageTask.purpose}`,
    `学习动作：${execution.pageTask.learnerAction}`,
    ...(execution.fixPlan
      ? [
          `返工类型：${execution.fixPlan.kind}`,
          `机器授权目标：${execution.fixPlan.targetArtifact}`,
          `返工反馈：${execution.fixPlan.feedback.join("；")}`,
        ]
      : []),
    `验收：${execution.initialWorkOrder.acceptance.join("；")}`,
    "现在开始读取上下文，并持续使用工具直到页面被接受或明确阻塞。",
  ].join("\n");
}
