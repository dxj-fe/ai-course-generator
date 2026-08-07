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
  isAgentToolResult,
  type AgentToolLedger,
  type AgentRunnerResult,
  type RuntimeAgentFactory,
} from "@/server/agent/runtime";
import { createCourseToolLedger } from "@/server/course/run/tool-ledger";
import { buildCourseVisualReferences } from "@/server/course/page/visual-reference";
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
const HARNESS_PAGE_TOOL_IDS = new Set<string>([
  ToolIds.ReadPageContext,
  ToolIds.ReadPageWorkspace,
  ToolIds.RenderPage,
  ToolIds.InspectPage,
  ToolIds.SubmitPage,
  ToolIds.BlockPage,
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
  const toolLedger = createCourseToolLedger(
    execution.repository.toolOperations,
    execution.initialWorkOrder,
  );
  const request = {
    abortSignal: input.abortSignal,
    activeTools: resolvePageBuilderActiveTools(execution),
    authorizeToolCall: (toolCall) =>
      assertPageBuilderToolCall(execution, toolCall, now()),
    beforeToolCall: input.beforeToolCall,
    afterToolExecution: async () => {
      const advanced = await advanceDeterministicPageTransitions({
        budgetMeter,
        beforeToolCall: input.beforeToolCall,
        execution,
        now,
        toolLedger,
        tools,
      });
      return Boolean(advanced.terminal);
    },
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
    toolLedger,
    tools,
    traceId: execution.traceId,
    workOrderId: execution.initialWorkOrder.id,
  } satisfies Parameters<typeof runner.run>[0];

  let checkpointCount =
    loadPageBuilderCheckpointCount(execution);
  const agentLoopStartedAt = Date.now();
  for (let continuation = 0; continuation < 3; continuation += 1) {
    const alreadyAdvanced = await advanceDeterministicPageTransitions({
      budgetMeter,
      beforeToolCall: input.beforeToolCall,
      execution,
      now,
      toolLedger,
      tools,
    });
    if (alreadyAdvanced.terminal) return alreadyAdvanced.terminal;
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
      const advanced = await advanceDeterministicPageTransitions({
        budgetMeter,
        beforeToolCall: input.beforeToolCall,
        execution,
        now,
        toolLedger,
        tools,
      });
      if (advanced.terminal) return advanced.terminal;
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

async function advanceDeterministicPageTransitions(input: {
  budgetMeter: AtomicBudgetMeter;
  beforeToolCall?: () => void | PromiseLike<void>;
  execution: ReturnType<typeof createPageBuilderExecution>;
  now: () => string;
  toolLedger: AgentToolLedger;
  tools: PageBuilderTools;
}): Promise<{
  advanced: boolean;
  terminal?: AgentRunnerResult<Submission>;
}> {
  let advanced = false;
  for (let transition = 0; transition < 8; transition += 1) {
    const activeTools = resolvePageBuilderActiveTools(input.execution);
    const toolName = resolveHarnessPageTool(activeTools);
    if (!toolName) return { advanced };

    const toolInput = buildHarnessPageToolInput(
      input.execution,
      toolName,
    );
    await input.beforeToolCall?.();
    assertPageBuilderToolCall(
      input.execution,
      { toolName, input: toolInput },
      input.now(),
    );
    const reservation = input.budgetMeter.reserve(toolName);
    const toolCallId = [
      "harness-transition",
      input.execution.initialWorkOrder.executionAttempt,
      reservation.sequence,
      toolName,
    ].join(":");
    const handle = await input.toolLedger.begin({
      agentStepNumber: reservation.sequence,
      input: toolInput,
      toolCallId,
      toolName,
      toolOrdinal: reservation.sequence,
    });
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
    let output: unknown;
    try {
      output = await resolveToolOutput(
        candidate.execute(toolInput, {
          abortSignal: input.execution.abortSignal,
          messages: [],
          toolCallId,
        }),
      );
      await input.toolLedger.complete({ handle, output });
    } catch (error) {
      await input.toolLedger.fail({ error, handle });
      throw error;
    }
    advanced = true;

    const terminal = parsePageBuilderTerminal(
      input.execution,
      await loadPageBuilderTerminal(input.execution),
    );
    if (terminal) {
      return {
        advanced,
        terminal: {
          ...terminal,
          budget: input.budgetMeter.snapshot(),
        },
      };
    }
    if (!isAgentToolResult(output) || !output.ok) {
      return { advanced };
    }
  }

  throw new Error("页面 Harness 机械状态推进超过安全上限");
}

function resolveHarnessPageTool(
  activeTools: string[],
): (keyof PageBuilderTools & string) | undefined {
  if (
    activeTools.length === 1 &&
    (activeTools[0] === ToolIds.ReadPageContext ||
      activeTools[0] === ToolIds.ReadPageWorkspace)
  ) {
    return activeTools[0] as keyof PageBuilderTools & string;
  }
  const actionTools = activeTools.filter(
    (toolName) => !PASSIVE_PAGE_TOOL_IDS.has(toolName),
  );
  return actionTools.length === 1 &&
    HARNESS_PAGE_TOOL_IDS.has(actionTools[0]!)
    ? (actionTools[0] as keyof PageBuilderTools & string)
    : undefined;
}

function buildHarnessPageToolInput(
  execution: ReturnType<typeof createPageBuilderExecution>,
  toolName: keyof PageBuilderTools & string,
) {
  if (toolName === ToolIds.BlockPage) {
    return buildDeterministicBlockInput(execution);
  }
  if (toolName === ToolIds.ReadPageWorkspace) {
    return { pageId: execution.pageId, offset: 0, maxChars: 12_000 };
  }
  return { pageId: execution.pageId };
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
  const revisionMessages = shouldInject
    ? compactPageBuilderRevisionMessages(compactedMessages)
    : compactedMessages;
  const currentHtml = shouldInject
    ? loadPageBuilderWorkingSnapshot(execution).html?.html
    : undefined;
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
            ...revisionMessages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    `下面是刚刚渲染的页面 revision ${render.htmlRevision}。`,
                    `Browser Harness 报告 ${render.issues.length} 个问题。`,
                    ...render.issues.slice(0, 8).map((issue) =>
                      [
                        issue.code,
                        issue.location?.selector
                          ? `（${issue.location.selector}）`
                          : "",
                        `：${issue.message}`,
                        issue.repairHint
                          ? ` 修复方向：${issue.repairHint}`
                          : "",
                      ].join(""),
                    ),
                    currentHtml
                      ? `当前 workspace index.html（只基于这一版修订，不要复述历史版本）：\n${currentHtml}`
                      : "当前 HTML 已在 workspace；需要源码时调用 read_page_workspace。",
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

/**
 * 质量修订只保留系统消息和最初任务封口；旧 HTML tool call、tool result 和
 * 解释文本会随轮次线性膨胀。当前 HTML 与当前浏览器证据由 Harness 重新注入，
 * 因而无需把多个完整旧版本继续发给 Provider。
 */
export function compactPageBuilderRevisionMessages(
  messages: unknown[],
) {
  return messages.filter((message) => {
    if (typeof message !== "object" || message === null) return false;
    const candidate = message as { role?: unknown; content?: unknown };
    if (candidate.role === "system") return true;
    if (candidate.role !== "user") return false;
    const text = extractMessageText(candidate.content);
    return (
      text.includes("Harness 已预加载的封口上下文与 workspace") &&
      !text.includes(PAGE_RENDER_EVIDENCE_MARKER)
    );
  });
}

function extractMessageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function buildPageBuilderPrompt(
  execution: ReturnType<typeof createPageBuilderExecution>,
  workspace?: Awaited<
    ReturnType<typeof preloadPageBuilderWorkspace>
  >,
) {
  const visualReferences = buildCourseVisualReferences({
    architecture: execution.architecture,
    creationBrief: execution.creationBrief,
  });
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
    visualReferences,
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
    "运行时硬边界：只交付自包含 HTML 和内联 CSS/内联 SVG；禁止 script、Tailwind/CDN、link、@import、远程字体/图片、on* 事件和 iframe。请使用系统字体 fallback 与无脚本原生 HTML/CSS 互动，避免把安全返工浪费成第二次模型调用。",
    "结构硬边界：必须输出完整 HTML 文档，body 内必须有且只能有一个 main；首稿就满足该结构，不要等待 Harness 返工。",
    "画布硬边界：body/main 采用 1920×1080 固定画布并裁切装饰层，正文、控件和反馈必须全部落在画布内；计算 padding、标题、间距和内容区总高度，禁止用内部滚动条隐藏超量内容。交互控件或其关联 label 在 authored canvas 上至少 72px 高，以保证缩放后仍可操作。无可信原生行为时不要输出 button；无脚本选择题不得使用“checkbox + 假提交按钮 + 永不显示的反馈”，应改用 details/summary 或 input:checked + label/CSS 的真实反馈。range 的 value 属性不会随拖动更新，禁止用 CSS [value] 伪造滑块反馈。",
    ...(execution.pageTask.acceptance.requiresInteraction
      ? [
          "本页 requiresInteraction=true：首稿必须包含真实可操作的原生 DOM 控件。优先使用 details/summary，或 input 与 label 的组合；仅写“点击查看”、普通 div、悬停效果或视觉按钮不算互动。",
        ]
      : []),
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
