import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import type { HtmlEngineerValidationFeedback } from "@/server/agents/html-engineer-agent";
import { runPageQAAgent } from "@/server/agents/page-qa-agent";
import type { PageQACourseContext } from "@/server/agents/page-qa-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import type {
  AgentEvent,
  AgentRuntimeContext,
} from "@/server/agents/core/types";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import {
  CourseIntentSchema,
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
  type VisualBrief,
} from "@/shared/course-schema";

const MAX_STAGE_ATTEMPTS = 3;
const HTML_VALIDATION_PREFIX = "生成 HTML 校验失败：";

export type PageWorkerDependencies = {
  runPageWriter: typeof runPageWriterAgent;
  runAssets: typeof runImageAssetWorkflow;
  runHtml: typeof runHtmlEngineerAgent;
  runQA: typeof runPageQAAgent;
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
  onUpdate?(update: PageWorkerUpdate): void | Promise<void>;
};

const defaultDependencies: PageWorkerDependencies = {
  runPageWriter: runPageWriterAgent,
  runAssets: runImageAssetWorkflow,
  runHtml: runHtmlEngineerAgent,
  runQA: runPageQAAgent,
  now: () => new Date().toISOString(),
};

type WorkerStage = Exclude<PageGenerationStage, "complete">;
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
                status: "completed" as const,
                currentStage: "complete" as const,
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

  await publish([
    workerEvent(
      dependencies.now,
      page.id,
      "qa",
      "page-qa",
      "page_done",
      `第 ${page.order} 页 Page Worker 已完成，可在学习空间预览。`,
    ),
  ]);
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

    while (attemptCount(state, stage) < MAX_STAGE_ATTEMPTS) {
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
      const retryable = isRetryableError(outcome.code);
      if (retryable && attempts < MAX_STAGE_ATTEMPTS) {
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
        retryable && attempts >= MAX_STAGE_ATTEMPTS
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
    stage: WorkerStage,
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
  stage: WorkerStage,
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
  stage: WorkerStage,
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

function isRetryableError(code: string) {
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

function requireValue<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`Page Worker 缺少 ${name}。`);
  return value;
}
