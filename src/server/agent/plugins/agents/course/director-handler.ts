import { getLanguageModel } from "@/server/infra/ai/model-provider";
import { resolveModelRoute } from "@/server/infra/ai/model-router";
import { AgentIds } from "@/server/agent/ids";
import { getAgentSystem } from "@/server/setup/agent";
import {
  assertCourseDirectorToolCall,
  buildCourseDirectorRunSummary,
  COURSE_DIRECTOR_TERMINAL_TOOLS,
  createCourseDirectorExecution,
  loadCourseDirectorTerminal,
  resolveCourseDirectorActiveTools,
  type CourseDirectorExecutionInput,
} from "@/server/agent/plugins/contexts/course/director";
import {
  createCourseDirectorTools,
  type CourseDirectorTools,
} from "@/server/agent/plugins/tools/course/director";
import {
  AgentRunner,
  type AgentRunnerResult,
  type RuntimeAgentFactory,
} from "@/server/agent/runtime";
import { createCourseToolLedger } from "@/server/course/run/tool-ledger";
import {
  WorkOrderSchema,
  type Submission,
} from "@/shared/course-schema";

export type RunCourseDirectorAgentInput =
  CourseDirectorExecutionInput;

export type CourseDirectorAgentDependencies = {
  createAgent?: RuntimeAgentFactory<CourseDirectorTools>;
  model?: unknown;
  now?: () => string;
};

/**
 * Course Director 只在架构提交和整课 Review 提交后运行短回合。
 * 每个 terminal 工具会把领域动作和 director_round 终态放进同一事务。
 */
export async function runCourseDirectorAgent(
  input: RunCourseDirectorAgentInput,
  dependencies: CourseDirectorAgentDependencies = {},
): Promise<AgentRunnerResult<Submission>> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const agentSystem = await getAgentSystem();
  const agentDefinition = agentSystem.agents.get(
    AgentIds.CourseDirector,
  );
  const instructions = await agentSystem.prompts.render(
    agentDefinition.prompt,
    {},
  );
  const execution = createCourseDirectorExecution(input);
  const tools = createCourseDirectorTools(execution, { now });
  const runner = new AgentRunner<CourseDirectorTools, Submission>({
    ...(dependencies.createAgent
      ? { createAgent: dependencies.createAgent }
      : {}),
    terminalStateLoader: {
      async load() {
        return loadCourseDirectorTerminal(execution);
      },
      parse: (value) => parseDirectorTerminal(execution.traceId, value),
    },
  });

  return runner.run({
    abortSignal: input.abortSignal,
    activeTools: resolveCourseDirectorActiveTools(execution),
    authorizeToolCall: (toolCall) =>
      assertCourseDirectorToolCall(execution, toolCall, now()),
    beforeToolCall: input.beforeToolCall,
    budget: {
      maxSteps: execution.initialWorkOrder.budget.maxSteps,
      maxToolCalls:
        execution.initialWorkOrder.budget.maxToolCalls,
      maxOutputTokens:
        execution.initialWorkOrder.budget.maxOutputTokens,
      maxToolResultBytes: 16 * 1024,
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
    prepareStep: () => ({
      activeTools: resolveCourseDirectorActiveTools(execution),
    }),
    prompt: buildCourseDirectorPrompt(execution),
    temperature: 0.1,
    terminalToolNames: [...COURSE_DIRECTOR_TERMINAL_TOOLS],
    toolLedger: createCourseToolLedger(
      execution.repository.toolOperations,
      execution.initialWorkOrder,
    ),
    tools,
    traceId: execution.traceId,
    workOrderId: execution.initialWorkOrder.id,
  });
}

function buildCourseDirectorPrompt(
  execution: ReturnType<typeof createCourseDirectorExecution>,
) {
  const summary = buildCourseDirectorRunSummary(execution);
  if (execution.roundKind === "review_architecture") {
    return [
      "当前是课程架构语义验收回合。",
      `验收要求：${JSON.stringify(execution.initialWorkOrder.acceptance)}`,
      `初始 RunSummary：${JSON.stringify(summary)}`,
      "请核对目标矩阵、页面职责、受众难度和真实生成依赖；合格就接受并派发，不合格就给出具体问题退回。",
    ].join("\n");
  }

  return [
    "当前是整课 Review 决策回合。",
    `验收要求：${JSON.stringify(execution.initialWorkOrder.acceptance)}`,
    `初始 RunSummary：${JSON.stringify(summary)}`,
    "请读取 Review 证据，确认发布、局部返工或重新规划。只能执行当前 Review 结论允许的领域动作。",
  ].join("\n");
}

function parseDirectorTerminal(
  traceId: string,
  value: unknown,
): {
  status: "accepted";
  submission: Submission;
} | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("run" in value) ||
    !("workOrder" in value)
  ) {
    return null;
  }
  const candidate = value as {
    run?: { traceId?: unknown };
    traceId?: unknown;
    workOrder?: unknown;
  };
  const parsed = WorkOrderSchema.safeParse(candidate.workOrder);
  if (
    !parsed.success ||
    candidate.traceId !== traceId ||
    candidate.run?.traceId !== traceId ||
    parsed.data.kind !== "director_round" ||
    parsed.data.status !== "accepted" ||
    parsed.data.submission?.status !== "done"
  ) {
    return null;
  }
  return {
    status: "accepted",
    submission: parsed.data.submission,
  };
}
