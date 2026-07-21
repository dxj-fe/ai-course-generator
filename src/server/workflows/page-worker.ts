import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import type { HtmlEngineerValidationFeedback } from "@/server/agents/html-engineer-agent";
import { runPageQAAgent } from "@/server/agents/page-qa-agent";
import type { PageQACourseContext } from "@/server/agents/page-qa-agent";
import { runRepairAgent } from "@/server/agents/repair-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import type {
  AgentEvent,
  AgentRuntimeContext,
} from "@/server/agents/core/types";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import { planRepairRound } from "@/server/workflows/qa-repair-loop";
import {
  CourseIntentSchema,
  HtmlOutputSchema,
  PageGenerationStateSchema,
  PagePlanSchema,
  PageWorkerBriefSchema,
  PageWorkerResultSchema,
  VisualBriefSchema,
  type CourseIntent,
  type PageGenerationError,
  type PageGenerationStage,
  type PageGenerationState,
  type PagePlan,
  type PageWorkerBrief,
  type PageWorkerEvent,
  type PageWorkerResult,
  type RepairAttemptRecord,
  type RepairFailureClass,
  type VisualBrief,
} from "@/shared/course-schema";

export const PAGE_WORKER_MAX_STAGE_ATTEMPTS = 3;
const HTML_VALIDATION_PREFIX = "生成 HTML 校验失败：";

export type PageWorkerDependencies = {
  runPageWriter: typeof runPageWriterAgent;
  runAssets: typeof runImageAssetWorkflow;
  runHtml: typeof runHtmlEngineerAgent;
  runQA: typeof runPageQAAgent;
  runRepair: typeof runRepairAgent;
  now(): string;
};

export type PageWorkerGlobalBriefs = {
  intent: CourseIntent;
  brief: PageWorkerBrief;
  visualBrief: VisualBrief;
  courseContext: PageQACourseContext;
};

export type PageWorkerUpdate = {
  state: PageGenerationState;
  events: readonly PageWorkerEvent[];
};

export type GeneratePageWorkerContext = {
  runtime: AgentRuntimeContext;
  initialState?: PageGenerationState;
  dependencies?: Partial<PageWorkerDependencies>;
  /** LangGraph 条件边每次最多推进的 Repair 轮数；省略时保持原有完整闭环。 */
  maxRepairRoundsPerRun?: number;
  onUpdate?(update: PageWorkerUpdate): void | Promise<void>;
};

const defaultDependencies: PageWorkerDependencies = {
  runPageWriter: runPageWriterAgent,
  runAssets: runImageAssetWorkflow,
  runHtml: runHtmlEngineerAgent,
  runQA: runPageQAAgent,
  runRepair: runRepairAgent,
  now: () => new Date().toISOString(),
};

type ActivePageStage = Exclude<PageGenerationStage, "complete">;
type WorkerStage = Exclude<ActivePageStage, "repair">;
type StageSuccess = {
  status: "completed";
  state: PageGenerationState;
  events?: readonly (AgentEvent & { agent?: string })[];
};
type StageFailure = {
  status: "failed";
  code: string;
  message: string;
  events?: readonly (AgentEvent & { agent?: string })[];
};

/**
 * 单页隔离执行边界。它只消费当前页合同并返回 PageWorkerResult；整课状态、
 * checkpoint、SSE 与跨页调度都由外层课程运行器持有。
 */
export async function generatePageWorker(
  pageInput: PagePlan,
  briefsInput: PageWorkerGlobalBriefs,
  context: GeneratePageWorkerContext,
): Promise<PageWorkerResult> {
  const page = PagePlanSchema.parse(pageInput);
  const briefs: PageWorkerGlobalBriefs = {
    intent: CourseIntentSchema.parse(briefsInput.intent),
    brief: PageWorkerBriefSchema.parse(briefsInput.brief),
    visualBrief: VisualBriefSchema.parse(briefsInput.visualBrief),
    courseContext: briefsInput.courseContext,
  };
  validateWorkerHandoff(page, briefs);

  const dependencies = { ...defaultDependencies, ...context.dependencies };
  let state = PageGenerationStateSchema.parse(
    context.initialState ?? {
      pageId: page.id,
      order: page.order,
      status: "pending",
      currentStage: "page_writer",
      assets: [],
      attempts: [],
    },
  );
  if (state.pageId !== page.id || state.order !== page.order) {
    throw new Error("Page Worker 恢复状态必须与当前 PagePlan 一致。");
  }

  const events: PageWorkerEvent[] = [];
  const publish = async (
    nextEvents: readonly PageWorkerEvent[],
    nextState = state,
  ) => {
    state = PageGenerationStateSchema.parse(nextState);
    events.push(...nextEvents);
    await context.onUpdate?.({
      state: structuredClone(state),
      events: structuredClone([...nextEvents]),
    });
  };

  if (state.status === "completed") {
    return PageWorkerResultSchema.parse({ pageId: page.id, state, events });
  }

  if (!state.content) {
    const completed = await runStage(
      "page_writer",
      "page-writer",
      `Page Writer 已开始生成第 ${page.order} 页内容。`,
      `第 ${page.order} 页 PageContentDSL 已生成。`,
      async () => {
        const writerState = await dependencies.runPageWriter(
          { intent: briefs.intent, page, brief: briefs.brief },
          context.runtime,
        );
        return writerState.status === "completed" && writerState.content
          ? {
              status: "completed" as const,
              state: {
                ...state,
                content: writerState.content,
                currentStage: "assets" as const,
              },
              events: writerState.events,
            }
          : {
              status: "failed" as const,
              code: writerState.error?.code ?? "PAGE_WRITER_FAILED",
              message:
                writerState.error?.message ??
                `页面 ${page.id} 未生成有效 PageContentDSL。`,
              events: writerState.events,
            };
      },
    );
    if (!completed) return result();
  }

  if (!state.htmlOutput && state.currentStage === "assets") {
    const completed = await runStage(
      "assets",
      "image-assets",
      `第 ${page.order} 页素材解析已开始。`,
      `第 ${page.order} 页素材解析已完成。`,
      async () => {
        const content = requireValue(state.content, "page content");
        if (content.assetSlots.length === 0) {
          return {
            status: "completed" as const,
            state: { ...state, assets: [], currentStage: "html" as const },
            events: [
              internalAgentEvent(
                dependencies.now,
                "当前页面没有素材槽，素材阶段已确定性跳过。",
              ),
            ],
          };
        }

        const assetState = await dependencies.runAssets(
          { content, visualBrief: briefs.visualBrief },
          context.runtime,
        );
        return assetState.status === "completed" && assetState.results
          ? {
              status: "completed" as const,
              state: {
                ...state,
                assets: assetState.results,
                currentStage: "html" as const,
              },
              events: assetState.events,
            }
          : {
              status: "failed" as const,
              code: assetState.error?.code ?? "IMAGE_ASSETS_FAILED",
              message:
                assetState.error?.message ??
                `页面 ${page.id} 的素材阶段未生成有效结果。`,
              events: assetState.events,
            };
      },
    );
    if (!completed) return result();
  }

  if (!state.htmlOutput) {
    const completed = await runStage(
      "html",
      "html-engineer",
      `HTML Engineer 已开始生成第 ${page.order} 页。`,
      `第 ${page.order} 页 HTML 已完成校验。`,
      async (failure) => {
        const htmlState = await dependencies.runHtml(
          {
            content: requireValue(state.content, "page content"),
            visualBrief: briefs.visualBrief,
            assets: state.assets,
            validationFeedback: toHtmlValidationFeedback(failure),
          },
          context.runtime,
        );
        return htmlState.status === "completed" && htmlState.htmlOutput
          ? {
              status: "completed" as const,
              state: {
                ...state,
                htmlOutput: htmlState.htmlOutput,
                currentStage: "qa" as const,
              },
              events: htmlState.events,
            }
          : {
              status: "failed" as const,
              code: htmlState.error?.code ?? "HTML_ENGINEER_FAILED",
              message:
                htmlState.error?.message ??
                `页面 ${page.id} 未生成有效 HTML。`,
              events: htmlState.events,
            };
      },
    );
    if (!completed) return result();
  }

  if (!state.qualityReport) {
    const completed = await runStage(
      "qa",
      "page-qa",
      `Page QA 已开始检查第 ${page.order} 页。`,
      `第 ${page.order} 页质量报告已生成。`,
      async () => {
        const qaState = await dependencies.runQA(
          {
            page,
            content: requireValue(state.content, "page content"),
            html: requireValue(state.htmlOutput, "page HTML").html,
            visualBrief: briefs.visualBrief,
            assets: state.assets,
            courseContext: briefs.courseContext,
          },
          context.runtime,
        );
        return qaState.status === "completed" && qaState.report
          ? {
              status: "completed" as const,
              state: {
                ...state,
                qualityReport: qaState.report,
                status: "running" as const,
                currentStage: "qa" as const,
                error: undefined,
              },
              events: qaState.events,
            }
          : {
              status: "failed" as const,
              code: qaState.error?.code ?? "PAGE_QA_FAILED",
              message:
                qaState.error?.message ??
                `页面 ${page.id} 未生成有效质量报告。`,
              events: qaState.events,
            };
      },
    );
    if (!completed) return result();
  }

  const interruptedRepair = getRepairHistory(state).findIndex(
    ({ status }) => status === "running",
  );
  if (interruptedRepair >= 0) {
    await publish(
      [
        workerEvent(
          dependencies.now,
          page.id,
          "repair",
          "repair-agent",
          "validation",
          "上一次 Repair 在 checkpoint 后中断，该轮预算已保留并标记失败。",
        ),
      ],
      {
        ...state,
        repairHistory: getRepairHistory(state).map((record, index) =>
          index === interruptedRepair
            ? {
                ...record,
                status: "failed" as const,
                failureClass: "agent_failed" as const,
                completedAt: dependencies.now(),
              }
            : record,
        ),
      },
    );
  }

  const maxRepairRoundsPerRun =
    context.maxRepairRoundsPerRun ?? Number.POSITIVE_INFINITY;
  if (
    maxRepairRoundsPerRun < 0 ||
    (!Number.isInteger(maxRepairRoundsPerRun) &&
      maxRepairRoundsPerRun !== Number.POSITIVE_INFINITY)
  ) {
    throw new Error("Page Worker 单次 Repair 轮数必须是非负整数。");
  }
  let repairRoundsRun = 0;

  while (state.qualityReport?.shouldRepair) {
    if (repairRoundsRun >= maxRepairRoundsPerRun) return result();

    if (context.runtime.abortSignal?.aborted) {
      await failStage(
        "repair",
        "repair-agent",
        "WORKFLOW_ABORTED",
        "课程生成已取消。",
      );
      return result();
    }
    const report = state.qualityReport;
    const planned = planRepairRound({
      pageId: page.id,
      content: requireValue(state.content, "page content"),
      html: requireValue(state.htmlOutput, "page HTML").html,
      visualBrief: briefs.visualBrief,
      assets: state.assets,
      report,
      completedRounds: getRepairHistory(state).length,
    });

    if ("status" in planned) {
      await failStage(
        "repair",
        "repair-agent",
        planned.failureClass === "budget_exhausted"
          ? "REPAIR_BUDGET_EXHAUSTED"
          : "REPAIR_TARGET_UNAVAILABLE",
        planned.message,
      );
      return result();
    }

    const repairIndex = getRepairHistory(state).length;
    const attempt: RepairAttemptRecord = {
      round: planned.round,
      sourceReport: report,
      targetArtifact: planned.targetArtifact,
      issueCodes: planned.issueCodes,
      status: "running",
      changeSummary: [],
      startedAt: dependencies.now(),
    };
    await publish(
      [
        workerEvent(
          dependencies.now,
          page.id,
          "repair",
          "repair-agent",
          "repair_attempt",
          `第 ${planned.round} 轮 Repair 开始：定向修复 ${planned.targetArtifact.toUpperCase()}，处理 ${planned.issueCodes.join("、")}。`,
          planned.round,
        ),
      ],
      {
        ...state,
        status: "running",
        currentStage: "repair",
        repairHistory: [...getRepairHistory(state), attempt],
        error: undefined,
      },
    );

    const repairState = await dependencies.runRepair(planned, context.runtime);
    const repairEvents = projectAgentEvents(
      repairState.events,
      page.id,
      "repair",
      "repair-agent",
      dependencies.now,
    );
    if (repairEvents.length > 0) await publish(repairEvents);

    if (repairState.status !== "completed" || !repairState.result) {
      const repairErrorMessage =
        repairState.error?.message ?? "Repair Agent 未返回有效候选。";
      const repairTimedOut = isTimeoutMessage(repairErrorMessage);
      await failRepairAttempt(
        repairIndex,
        "agent_failed",
        repairTimedOut
          ? "Repair 模型调用超时，请从断点继续重试。"
          : repairErrorMessage,
        repairState.error?.code === "AGENT_ABORTED"
          ? "WORKFLOW_ABORTED"
          : repairTimedOut
            ? "REPAIR_TIMEOUT"
            : "REPAIR_FAILED",
      );
      return result();
    }
    if (repairState.result.kind === "declined") {
      await failRepairAttempt(
        repairIndex,
        repairState.result.failureClass,
        repairState.result.reasonSummary,
      );
      return result();
    }

    let nextContent = requireValue(state.content, "page content");
    let nextHtmlOutput = requireValue(state.htmlOutput, "page HTML");
    if (repairState.repairedContent) {
      nextContent = repairState.repairedContent;
      const htmlState = await dependencies.runHtml(
        {
          content: nextContent,
          visualBrief: briefs.visualBrief,
          assets: state.assets,
        },
        context.runtime,
      );
      const htmlEvents = projectAgentEvents(
        htmlState.events,
        page.id,
        "repair",
        "html-engineer",
        dependencies.now,
      );
      if (htmlEvents.length > 0) await publish(htmlEvents);
      if (htmlState.status !== "completed" || !htmlState.htmlOutput) {
        await failRepairAttempt(
          repairIndex,
          htmlState.error?.code === "AGENT_ABORTED"
            ? "agent_failed"
            : "candidate_invalid",
          htmlState.error?.message ?? "修复后的 DSL 未生成有效 HTML。",
          htmlState.error?.code === "AGENT_ABORTED"
            ? "WORKFLOW_ABORTED"
            : "REPAIR_FAILED",
        );
        return result();
      }
      nextHtmlOutput = htmlState.htmlOutput;
    } else if (repairState.repairedHtml) {
      nextHtmlOutput = HtmlOutputSchema.parse({
        html: repairState.repairedHtml,
        generatedAt: dependencies.now(),
        version: nextHtmlOutput.version + 1,
      });
    } else {
      await failRepairAttempt(
        repairIndex,
        "candidate_invalid",
        "Repair 候选没有产生可应用的 DSL 或 HTML。",
      );
      return result();
    }

    const changeSummary = repairState.result.changeSummary;
    await publish(
      [
        workerEvent(
          dependencies.now,
          page.id,
          "repair",
          "repair-agent",
          "repair_success",
          `第 ${planned.round} 轮 Repair 候选已应用：${changeSummary.join("；")}`,
          planned.round,
        ),
      ],
      {
        ...state,
        content: nextContent,
        htmlOutput: nextHtmlOutput,
        qualityReport: undefined,
        status: "running",
        currentStage: "qa",
        repairHistory: getRepairHistory(state).map((record, index) =>
          index === repairIndex
            ? {
                ...record,
                status: "applied" as const,
                changeSummary,
                completedAt: dependencies.now(),
              }
            : record,
        ),
        error: undefined,
      },
    );

    await publish([
      workerEvent(
        dependencies.now,
        page.id,
        "qa",
        "page-qa",
        "agent_start",
        `Page QA 开始复验第 ${planned.round} 轮 Repair 结果。`,
      ),
    ]);
    const qaState = await dependencies.runQA(
      {
        page,
        content: nextContent,
        html: nextHtmlOutput.html,
        visualBrief: briefs.visualBrief,
        assets: state.assets,
        courseContext: briefs.courseContext,
      },
      context.runtime,
    );
    const qaEvents = projectAgentEvents(
      qaState.events,
      page.id,
      "qa",
      "page-qa",
      dependencies.now,
    );
    if (qaEvents.length > 0) await publish(qaEvents);
    if (qaState.status !== "completed" || !qaState.report) {
      await failStage(
        "qa",
        "page-qa",
        qaState.error?.code === "AGENT_ABORTED"
          ? "WORKFLOW_ABORTED"
          : "PAGE_REQA_FAILED",
        qaState.error?.message ?? "Repair 后重新 QA 失败。",
      );
      return result();
    }
    await publish(
      [
        workerEvent(
          dependencies.now,
          page.id,
          "qa",
          "page-qa",
          "agent_done",
          `第 ${planned.round} 轮 Repair 已完成重新 QA：${qaState.report.overallScore} 分。`,
        ),
      ],
      {
        ...state,
        qualityReport: qaState.report,
        repairHistory: getRepairHistory(state).map((record, index) =>
          index === repairIndex
            ? { ...record, resultReportId: qaState.report!.id }
            : record,
        ),
      },
    );
    repairRoundsRun += 1;
  }

  await publish(
    [
      workerEvent(
        dependencies.now,
        page.id,
        "qa",
        "page-qa",
        "page_done",
        `第 ${page.order} 页 Page Worker 已完成，可在学习空间预览。`,
      ),
    ],
    {
      ...state,
      status: "completed",
      currentStage: "complete",
      error: undefined,
    },
  );
  return result();

  function result() {
    return PageWorkerResultSchema.parse({ pageId: page.id, state, events });
  }

  async function runStage(
    stage: WorkerStage,
    agent: string,
    startSummary: string,
    doneSummary: string,
    execute: (
      failure: PageGenerationError | undefined,
    ) => Promise<StageSuccess | StageFailure>,
  ) {
    let previousFailure = state.error;

    while (attemptCount(state, stage) < PAGE_WORKER_MAX_STAGE_ATTEMPTS) {
      if (context.runtime.abortSignal?.aborted) {
        await failStage(
          stage,
          agent,
          "WORKFLOW_ABORTED",
          "课程生成已取消。",
        );
        return false;
      }

      state = PageGenerationStateSchema.parse({
        ...state,
        status: "running",
        currentStage: stage,
        attempts: incrementAttempt(state, stage),
        error: undefined,
      });
      await publish([
        workerEvent(
          dependencies.now,
          page.id,
          stage,
          agent,
          "agent_start",
          startSummary,
        ),
      ]);

      let outcome: StageSuccess | StageFailure;
      try {
        outcome = await execute(previousFailure);
      } catch (error) {
        outcome = {
          status: "failed",
          code:
            error instanceof DOMException && error.name === "AbortError"
              ? "WORKFLOW_ABORTED"
              : "WORKFLOW_NODE_EXECUTION_ERROR",
          message:
            error instanceof Error ? error.message : "页面阶段出现未知错误。",
        };
      }

      const projected = projectAgentEvents(
        outcome.events ?? [],
        page.id,
        stage,
        agent,
        dependencies.now,
      );
      if (projected.length > 0) await publish(projected);

      if (outcome.status === "completed") {
        state = PageGenerationStateSchema.parse({
          ...outcome.state,
          attempts: state.attempts ?? [],
          error: undefined,
        });
        await publish([
          workerEvent(
            dependencies.now,
            page.id,
            stage,
            agent,
            "agent_done",
            doneSummary,
          ),
        ]);
        return true;
      }

      previousFailure = { code: outcome.code, message: outcome.message };
      const attempts = attemptCount(state, stage);
      const retryable = isPageWorkerRetryableError(outcome.code);
      if (retryable && attempts < PAGE_WORKER_MAX_STAGE_ATTEMPTS) {
        state = PageGenerationStateSchema.parse({
          ...state,
          error: previousFailure,
        });
        await publish([
          workerEvent(
            dependencies.now,
            page.id,
            stage,
            agent,
            "validation",
            `${agent} 第 ${attempts} 次执行失败，Page Worker 将在预算内重试。`,
          ),
        ]);
        continue;
      }

      await failStage(
        stage,
        agent,
        retryable && attempts >= PAGE_WORKER_MAX_STAGE_ATTEMPTS
          ? "PAGE_WORKER_RETRY_EXHAUSTED"
          : outcome.code,
        outcome.message,
      );
      return false;
    }

    await failStage(
      stage,
      agent,
      "PAGE_WORKER_RETRY_EXHAUSTED",
      state.error?.message ?? `${agent} 已达到页面级执行预算。`,
    );
    return false;
  }

  async function failStage(
    stage: ActivePageStage,
    agent: string,
    code: string,
    message: string,
  ) {
    state = PageGenerationStateSchema.parse({
      ...state,
      status: "failed",
      currentStage: stage,
      error: { code, message },
    });
    await publish([
      workerEvent(
        dependencies.now,
        page.id,
        stage,
        agent,
        "error",
        message,
      ),
    ]);
  }

  async function failRepairAttempt(
    index: number,
    failureClass: RepairFailureClass,
    message: string,
    code = "REPAIR_FAILED",
  ) {
    state = PageGenerationStateSchema.parse({
      ...state,
      repairHistory: getRepairHistory(state).map((record, recordIndex) =>
        recordIndex === index
          ? {
              ...record,
              status: "failed" as const,
              failureClass,
              completedAt: dependencies.now(),
            }
          : record,
      ),
    });
    await failStage("repair", "repair-agent", code, message);
  }
}

function validateWorkerHandoff(
  page: PagePlan,
  briefs: PageWorkerGlobalBriefs,
) {
  if (briefs.brief.pageId !== page.id) {
    throw new Error("PageWorkerBrief 必须引用当前 PagePlan。");
  }
  if (briefs.brief.styleTemplateId !== page.styleTemplateId) {
    throw new Error("PageWorkerBrief 与 PagePlan 必须使用同一样式模板。");
  }
  if (
    !briefs.visualBrief.pageGuidance.some(
      ({ pageId }) => pageId === page.id,
    )
  ) {
    throw new Error(`VisualBrief 缺少页面 ${page.id} 的视觉指导。`);
  }
}

function incrementAttempt(state: PageGenerationState, stage: WorkerStage) {
  const attempts = state.attempts ?? [];
  const existing = attempts.find((attempt) => attempt.stage === stage);
  return existing
    ? attempts.map((attempt) =>
        attempt.stage === stage
          ? { ...attempt, attempts: attempt.attempts + 1 }
          : attempt,
      )
    : [...attempts, { stage, attempts: 1 }];
}

function attemptCount(state: PageGenerationState, stage: WorkerStage) {
  return (
    state.attempts?.find((attempt) => attempt.stage === stage)?.attempts ?? 0
  );
}

function projectAgentEvents(
  events: readonly (AgentEvent & { agent?: string })[],
  pageId: string,
  stage: ActivePageStage,
  fallbackAgent: string,
  now: () => string,
): PageWorkerEvent[] {
  return events.map(({ type, summary, step, timestamp, agent }) =>
    workerEvent(
      now,
      pageId,
      stage,
      agent ?? fallbackAgent,
      type,
      summary,
      step,
      timestamp,
    ),
  );
}

function workerEvent(
  now: () => string,
  pageId: string,
  stage: ActivePageStage,
  agent: string,
  type: PageWorkerEvent["type"],
  summary: string,
  step?: number,
  timestamp?: string,
): PageWorkerEvent {
  return {
    type,
    stage,
    pageId,
    agent,
    step,
    timestamp: timestamp ?? now(),
    summary,
  };
}

function internalAgentEvent(
  now: () => string,
  summary: string,
): AgentEvent {
  return {
    id: crypto.randomUUID(),
    sequence: 1,
    type: "validation",
    traceId: "page-worker",
    timestamp: now(),
    step: 0,
    summary,
  };
}

function toHtmlValidationFeedback(
  failure: PageGenerationError | undefined,
): HtmlEngineerValidationFeedback | undefined {
  if (!failure?.message.startsWith(HTML_VALIDATION_PREFIX)) return undefined;
  const issues = failure.message
    .slice(HTML_VALIDATION_PREFIX.length)
    .split("；")
    .map((issue) => issue.trim())
    .filter(Boolean)
    .slice(0, 20);
  return issues.length > 0 ? { code: failure.code, issues } : undefined;
}

export function isPageWorkerRetryableError(code: string) {
  return new Set([
    "AGENT_EXECUTION_ERROR",
    "AGENT_STEP_LIMIT",
    "WORKFLOW_NODE_EXECUTION_ERROR",
    "MODEL_TIMEOUT",
    "MODEL_RATE_LIMITED",
    "MODEL_PROVIDER_ERROR",
    "PAGE_WRITER_FAILED",
    "IMAGE_ASSETS_FAILED",
    "HTML_ENGINEER_FAILED",
    "PAGE_QA_FAILED",
  ]).has(code);
}

function isTimeoutMessage(message: string) {
  return /\btimeout\b|\btimed out\b/i.test(message);
}

function requireValue<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`Page Worker 缺少 ${name}。`);
  return value;
}

function getRepairHistory(state: PageGenerationState) {
  return state.repairHistory ?? [];
}
