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
  AgentTerminalNotCommittedError,
  AgentRunner,
  AtomicBudgetMeter,
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
  const budget = {
    maxSteps: execution.initialWorkOrder.budget.maxSteps,
    maxToolCalls:
      execution.initialWorkOrder.budget.maxToolCalls,
    maxOutputTokens:
      execution.initialWorkOrder.budget.maxOutputTokens,
    maxToolResultBytes: 16 * 1024,
    timeout: execution.initialWorkOrder.budget.timeoutMs,
  };
  const budgetMeter = new AtomicBudgetMeter({
    maxToolCalls: budget.maxToolCalls,
  });
  const request = {
    abortSignal: input.abortSignal,
    activeTools: resolvePageBuilderActiveTools(execution),
    authorizeToolCall: (toolCall) =>
      assertPageBuilderToolCall(execution, toolCall, now()),
    beforeToolCall: input.beforeToolCall,
    budget,
    budgetMeter,
    instructions,
    model:
      dependencies.model ??
      getLanguageModel(
        resolveModelRoute(agentDefinition.modelCapability).primary,
      ),
    prepareStep: () => preparePageBuilderStep(execution),
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
  } satisfies Parameters<typeof runner.run>[0];

  let checkpointCount =
    loadPageBuilderCheckpointCount(execution);
  for (let continuation = 0; continuation < 3; continuation += 1) {
    try {
      return await runner.run({
        ...request,
        prompt:
          continuation === 0
            ? buildPageBuilderPrompt(execution)
            : buildPageBuilderContinuationPrompt(execution),
      });
    } catch (error) {
      if (!(error instanceof AgentTerminalNotCommittedError)) {
        throw error;
      }
      const nextCheckpointCount =
        loadPageBuilderCheckpointCount(execution);
      if (
        nextCheckpointCount <= checkpointCount ||
        continuation === 2
      ) {
        throw error;
      }
      checkpointCount = nextCheckpointCount;
    }
  }

  throw new AgentTerminalNotCommittedError(
    execution.initialWorkOrder.id,
  );
}

function loadPageBuilderCheckpointCount(
  execution: ReturnType<typeof createPageBuilderExecution>,
) {
  return (
    execution.repository.workOrders.load(
      execution.initialWorkOrder.id,
    )?.checkpointArtifactRefs.length ?? 0
  );
}

function buildPageBuilderContinuationPrompt(
  execution: ReturnType<typeof createPageBuilderExecution>,
) {
  return [
    `继续完成页面《${execution.pageTask.title}》。`,
    "上一次 Agent Run 已保存了新的 checkpoint，但没有提交终态。",
    "读取当前持久化状态，只调用仍然开放的工具，直到 submit_page 或 block_page 成功。",
  ].join("\n");
}

const DIRECTED_PAGE_BUILDER_TOOL_IDS = new Set<string>([
  ToolIds.ResolvePageAssets,
  ToolIds.GeneratePageHtml,
  ToolIds.InspectPage,
  ToolIds.RepairPageContent,
  ToolIds.RepairPageHtml,
  ToolIds.SubmitPage,
]);

function preparePageBuilderStep(
  execution: ReturnType<typeof createPageBuilderExecution>,
) {
  const activeTools = resolvePageBuilderActiveTools(execution);
  const directedTools = activeTools.filter((toolName) =>
    DIRECTED_PAGE_BUILDER_TOOL_IDS.has(toolName),
  );
  const canDirect =
    directedTools.length === 1 &&
    !activeTools.includes(ToolIds.BlockPage);

  return {
    activeTools,
    ...(canDirect
      ? {
          toolChoice: {
            type: "tool" as const,
            toolName: directedTools[0]!,
          },
        }
      : {}),
  };
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
