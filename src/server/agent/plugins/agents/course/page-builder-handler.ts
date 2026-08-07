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
  loadPageBuilderWorkingSnapshot,
  parsePageBuilderTerminal,
  type PageBuilderExecutionInput,
} from "@/server/agent/plugins/contexts/course/page-builder";
import {
  type PageBuilderModelSteps,
} from "@/server/agent/plugins/tools/course/page-builder-model-steps";
import {
  createPageBuilderTools,
  preloadPageBuilderWorkspace,
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
import { isBrowserHarnessUnavailableError } from "@/server/infra/browser/error";
import type { Submission } from "@/shared/course-schema";

export type PageBuilderAgentDependencies = {
  captureScreenshot?: PageBuilderToolDependencies["captureScreenshot"];
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
  ToolIds.GeneratePageImage,
  ToolIds.InspectPage,
  ToolIds.RepairPageContent,
  ToolIds.RepairPageHtml,
]);
const PASSIVE_PAGE_TOOL_IDS = new Set<string>([
  ToolIds.ReadPageContext,
  ToolIds.ReadPageWorkspace,
  ToolIds.ReadLocalResource,
  ToolIds.SearchReferences,
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
  // 注入旧 Model Steps 只用于兼容历史恢复与对应测试；生产新页面默认走
  // workspace -> render -> inspect 的 Page Creator Loop。
  execution.legacyModelPipeline =
    Boolean(dependencies.modelSteps) ||
    !input.workOrder.allowedTools.includes(ToolIds.EditPageWorkspace) ||
    !input.workOrder.allowedTools.includes(ToolIds.RenderPage);
  execution.localResourceSession = localResourceSession;
  const preloadedWorkspace = execution.legacyModelPipeline
    ? undefined
    : await preloadPageBuilderWorkspace(execution);
  const instructions = await agentSystem.prompts.render(
    agentDefinition.prompt,
    {
      ...skillRuntime.promptContext,
      pageId: execution.pageId,
    },
  );
  const tools = createPageBuilderTools(execution, {
    captureScreenshot: dependencies.captureScreenshot,
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
    isFatalToolError: isBrowserHarnessUnavailableError,
    model:
      dependencies.model ??
      getLanguageModel(
        resolveModelRoute(agentDefinition.modelCapability).primary,
      ),
    prepareStep: (step) => preparePageBuilderStep(execution, step.messages),
    prompt: buildPageBuilderPrompt(execution, preloadedWorkspace),
    resolveToolCost: (toolName) =>
      toolName === ToolIds.ResolvePageAssets ||
      toolName === ToolIds.GeneratePageImage
        ? 4
        : MODEL_GENERATION_TOOL_IDS.has(toolName)
          ? 2
          : 1,
    temperature: 0.35,
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
  const agentLoopStartedAt = Date.now();
  for (let continuation = 0; continuation < 3; continuation += 1) {
    const alreadyFinalized = await finalizeDeterministicPageTerminal({
      budgetMeter,
      beforeToolCall: input.beforeToolCall,
      execution,
      now,
      tools,
    });
    if (alreadyFinalized) return alreadyFinalized;
    try {
      const remainingTimeoutMs = Math.max(
        1,
        budget.timeout - (Date.now() - agentLoopStartedAt),
      );
      return await runner.run({
        ...request,
        budget: {
          ...budget,
          timeout: remainingTimeoutMs,
        },
        prompt:
          continuation === 0
            ? buildPageBuilderPrompt(execution, preloadedWorkspace)
            : `${buildPageBuilderPrompt(execution, preloadedWorkspace)}\n\n${buildPageBuilderContinuationPrompt(execution)}`,
      });
    } catch (error) {
      if (!(error instanceof AgentTerminalNotCommittedError)) {
        throw error;
      }
      // submit/block 已由持久化状态唯一确定时，不值得再请求模型完成机械
      // 工具调用。真实任务证明 Provider 会在这里继续输出或等待到 300 秒，
      // 造成 checkpoint 已齐全却反复重试。Harness 直接执行相同受控终态工具。
      const finalized = await finalizeDeterministicPageTerminal({
        budgetMeter,
        beforeToolCall: input.beforeToolCall,
        execution,
        now,
        tools,
      });
      if (finalized) return finalized;
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

async function finalizeDeterministicPageTerminal(input: {
  budgetMeter: AtomicBudgetMeter;
  beforeToolCall?: () => void | PromiseLike<void>;
  execution: ReturnType<typeof createPageBuilderExecution>;
  now: () => string;
  tools: PageBuilderTools;
}): Promise<AgentRunnerResult<Submission> | undefined> {
  const activeTools = resolvePageBuilderActiveTools(input.execution);
  if (
    activeTools.length !== 1 ||
    (activeTools[0] !== ToolIds.SubmitPage &&
      activeTools[0] !== ToolIds.BlockPage)
  ) {
    return undefined;
  }

  const toolName = activeTools[0];
  const toolInput =
    toolName === ToolIds.SubmitPage
      ? { pageId: input.execution.pageId }
      : buildDeterministicBlockInput(input.execution);
  await input.beforeToolCall?.();
  assertPageBuilderToolCall(
    input.execution,
    { toolName, input: toolInput },
    input.now(),
  );
  input.budgetMeter.reserve(toolName);

  const candidate = input.tools[toolName] as unknown as {
    execute(
      value: unknown,
      options: {
        abortSignal?: AbortSignal;
        messages: [];
        toolCallId: string;
      },
    ): AsyncIterable<unknown> | PromiseLike<unknown> | unknown;
  };
  await resolveToolOutput(
    candidate.execute(toolInput, {
      abortSignal: input.execution.abortSignal,
      messages: [],
      toolCallId: [
        "harness-terminal",
        input.execution.initialWorkOrder.executionAttempt,
        toolName,
      ].join(":"),
    }),
  );

  const terminal = parsePageBuilderTerminal(
    input.execution,
    await loadPageBuilderTerminal(input.execution),
  );
  return terminal
    ? { ...terminal, budget: input.budgetMeter.snapshot() }
    : undefined;
}

function buildDeterministicBlockInput(
  execution: ReturnType<typeof createPageBuilderExecution>,
) {
  const quality = loadPageBuilderWorkingSnapshot(execution).quality;
  const issueSummary = quality?.issues
    .filter(({ severity }) => severity === "error")
    .slice(0, 2)
    .map(({ code, message }) => `${code}：${message}`)
    .join("；");
  return {
    pageId: execution.pageId,
    code: "PAGE_QUALITY_NOT_PASSED",
    message: (
      issueSummary
        ? `页面完成有证据的质量修订后仍未通过：${issueSummary}`
        : "页面完成有证据的质量修订后仍未通过确定性质量检查。"
    ).slice(0, 500),
  };
}

async function resolveToolOutput(
  output: AsyncIterable<unknown> | PromiseLike<unknown> | unknown,
) {
  const resolved = await output;
  if (!isAsyncIterable(resolved)) return resolved;
  let value: unknown;
  for await (const item of resolved) value = item;
  return value;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
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

export function preparePageBuilderStep(
  execution: ReturnType<typeof createPageBuilderExecution>,
  messages: unknown[],
) {
  const compactedMessages = prunePageBuilderRenderEvidenceMessages(messages);
  const activeTools = resolvePageBuilderActiveTools(execution);
  const actionTools = activeTools.filter(
    (toolName) => !PASSIVE_PAGE_TOOL_IDS.has(toolName),
  );
  const render = execution.latestRenderEvidence;
  const shouldInject =
    render &&
    render.images.length > 0 &&
    execution.injectedRenderRevision !== render.htmlRevision;
  if (shouldInject) {
    execution.injectedRenderRevision = render.htmlRevision;
  }
  const removedOldRenderEvidence =
    compactedMessages.length !== messages.length;

  return {
    activeTools,
    // render / inspect / submit / block 这类单一确定性下一步不需要模型重新
    // 选择工具；约束 ToolChoice 可显著减少 Pro 模型在机械过渡上的等待时间。
    ...(actionTools.length === 1
      ? {
          toolChoice: {
            type: "tool" as const,
            toolName: actionTools[0]!,
          },
        }
      : {}),
    ...(shouldInject
      ? {
          messages: [
            ...compactedMessages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    `下面是刚刚渲染的页面 revision ${render.htmlRevision}。`,
                    `Browser Harness 报告 ${render.issues.length} 个问题。`,
                    "请直接观察三视口截图，自主判断继续 edit_page_workspace，还是进入 inspect_page。",
                  ].join("\n"),
                },
                ...render.images.flatMap((item) => [
                  {
                    type: "text" as const,
                    text: `视口 ${item.viewport.width}x${item.viewport.height}`,
                  },
                  {
                    type: "file" as const,
                    data: item.png,
                    mediaType: "image/png",
                    filename: `page-${execution.pageId}-${item.viewport.width}x${item.viewport.height}.png`,
                  },
                ]),
              ],
            },
          ],
        }
      : removedOldRenderEvidence
        ? { messages: compactedMessages }
        : {}),
  };
}

const PAGE_RENDER_EVIDENCE_MARKER = "下面是刚刚渲染的页面 revision ";

/**
 * 只保留最新一轮三视口图片；历史 tool result 与修订记录继续留在对话中。
 * 否则每轮都累计三张 PNG，会快速挤占外部模型的多模态上下文并导致工具参数失效。
 */
export function prunePageBuilderRenderEvidenceMessages(
  messages: unknown[],
) {
  return messages.filter((message) => {
    if (typeof message !== "object" || message === null) return true;
    const candidate = message as { role?: unknown; content?: unknown };
    if (candidate.role !== "user" || !Array.isArray(candidate.content)) {
      return true;
    }
    return !candidate.content.some((part) => {
      if (typeof part !== "object" || part === null) return false;
      const text = (part as { type?: unknown; text?: unknown }).text;
      return (
        (part as { type?: unknown }).type === "text" &&
        typeof text === "string" &&
        text.startsWith(PAGE_RENDER_EVIDENCE_MARKER)
      );
    });
  });
}

function buildPageBuilderPrompt(
  execution: ReturnType<typeof createPageBuilderExecution>,
  workspace?: Awaited<
    ReturnType<typeof preloadPageBuilderWorkspace>
  >,
) {
  const sealedContext = {
    course: {
      title: execution.architecture.blueprint.title,
      objectives: execution.architecture.blueprint.objectives,
      rules: execution.architecture.blueprint.courseRules,
    },
    coursePack: execution.architecture.coursePack,
    pageTask: execution.pageTask,
    courseMap: execution.architecture.pageTasks.map(
      ({ pageId, order, title, purpose, objectiveIds }) => ({
        pageId,
        order,
        title,
        purpose,
        objectiveIds,
      }),
    ),
    dependencySummaries: execution.dependencySummaries,
    workspace: workspace
      ? {
          exists: workspace.exists,
          html:
            workspace.html.length <= 40_000
              ? workspace.html
              : `${workspace.html.slice(0, 40_000)}\n<!-- 已截断；需要完整内容时调用 read_page_workspace -->`,
          metadata: workspace.metadata,
        }
      : undefined,
  };
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
    `Harness 已预加载的封口上下文与 workspace：${JSON.stringify(sealedContext)}`,
    "直接开始创作或修订，并持续使用工具直到页面被接受或明确阻塞；需要细查时仍可调用读取工具。",
  ].join("\n");
}
