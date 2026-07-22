import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runPageQAAgent } from "@/server/agents/page-qa-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import { runRepairAgent } from "@/server/agents/repair-agent";
import { runSupervisorAgent } from "@/server/agents/supervisor-agent";
import { createCourseStore } from "@/server/storage/course-store";
import { runCourseDesignWorkflow } from "@/server/workflows/course-design-workflow";
import {
  CourseGenerationNodeError,
  type CourseGenerationNode,
  type CourseGenerationNodeContext,
  type CourseGenerationNodeDependencies,
  type CourseGenerationNodeEvent,
  type CourseGenerationNodeName,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-nodes";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import { generatePageWorker } from "@/server/workflows/page-worker";
import {
  runSequentialWorkflow,
  type SequentialWorkflowResult,
  type WorkflowNodeError,
} from "@/server/workflows/sequential-workflow";
import {
  CourseGenerationStateSchema,
  PageGenerationStateSchema,
  PageWorkerConfigSchema,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
  type PageWorkerMode,
  type ReferencePack,
} from "@/shared/course-schema";

export type CourseGenerationWorkflowInput = {
  courseId: string;
  userPrompt: string;
  referencePacks?: ReferencePack[];
  pageCount?: CourseMvpPageCount;
  executionMode?: PageWorkerMode;
  concurrency?: number;
  existingState?: CourseGenerationState;
};

export type CourseGenerationWorkflowDependencies =
  CourseGenerationNodeDependencies & {
    runSupervisor: typeof runSupervisorAgent;
    runQA: typeof runPageQAAgent;
    runRepair: typeof runRepairAgent;
    generatePage: typeof generatePageWorker;
    checkpoint(state: CourseGenerationState): Promise<void>;
    now(): string;
  };

export type CourseNodeRunResult = SequentialWorkflowResult<
  CourseGenerationState,
  CourseGenerationNode["name"]
>;

const courseStore = createCourseStore();
const defaultDependencies: CourseGenerationWorkflowDependencies = {
  generateIntent: generateCourseIntent,
  runPlanner: runCoursePlannerAgent,
  runDesign: runCourseDesignWorkflow,
  runPageWriter: runPageWriterAgent,
  runAssets: runImageAssetWorkflow,
  runHtml: runHtmlEngineerAgent,
  runQA: runPageQAAgent,
  runRepair: runRepairAgent,
  generatePage: generatePageWorker,
  runSupervisor: runSupervisorAgent,
  checkpoint: courseStore.save,
  now: () => new Date().toISOString(),
};

export function resolveCourseGenerationDependencies(
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
): CourseGenerationWorkflowDependencies {
  return { ...defaultDependencies, ...overrides };
}

export function initializeCourseGenerationState(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  now: () => string,
): CourseGenerationState {
  if (input.existingState) {
    const existing = CourseGenerationStateSchema.parse(input.existingState);
    if (
      existing.courseId !== input.courseId ||
      existing.userPrompt !== input.userPrompt
    ) {
      throw new Error("恢复输入必须与持久化课程的 courseId 和 userPrompt 一致。");
    }
    if (
      input.referencePacks &&
      JSON.stringify(input.referencePacks) !==
        JSON.stringify(existing.referencePacks ?? [])
    ) {
      throw new Error("恢复输入不能更换持久化课程的 Reference Pack。");
    }
    if (existing.status === "completed") return existing;

    const workerConfig = resolveWorkerConfig(input, existing.workerConfig);
    return CourseGenerationStateSchema.parse({
      ...existing,
      status: "running",
      traceId: context.traceId,
      errors: [],
      completedAt: undefined,
      durationMs: undefined,
      supervisor: existing.supervisor ?? {
        decisionCount: 0,
        attempts: [],
      },
      workerConfig,
      pages: existing.pages.map((page) => {
        const recovered = recoverLegacyDisabledChoiceRepairFailure(page);
        if (
          recovered.status === "failed" &&
          recovered.currentStage !== "repair" &&
          (recovered.error?.code === "PAGE_WORKER_RETRY_EXHAUSTED" ||
            isLegacySupervisorReasonSummaryFailure(recovered.error))
        ) {
          return {
            ...recovered,
            status: "running" as const,
            attempts: recovered.attempts?.filter(
              ({ stage }) => stage !== recovered.currentStage,
            ),
          };
        }
        return recovered.status === "failed"
          ? {
              ...recovered,
              attempts: recovered.attempts?.filter(
                ({ stage }) => stage !== recovered.currentStage,
              ),
            }
          : recovered;
      }),
      updatedAt: now(),
    });
  }

  const timestamp = now();
  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: input.courseId,
    traceId: context.traceId,
    userPrompt: input.userPrompt,
    referencePacks: input.referencePacks,
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    supervisor: { decisionCount: 0, attempts: [] },
    workerConfig: resolveWorkerConfig(input),
    startedAt: timestamp,
    updatedAt: timestamp,
  });
}

/** Supervisor 曾把完整页面错误复制到 300 字符摘要，导致错误处理本身失败。 */
function isLegacySupervisorReasonSummaryFailure(
  error: PageGenerationState["error"],
) {
  return (
    error?.code === "COURSE_TASK_EXECUTION_ERROR" &&
    error.message.includes('"path": [\n      "reasonSummary"') &&
    error.message.includes("expected string to have <=300 characters")
  );
}

/**
 * HTML Engineer 2.1.0 曾允许 disabled choice 控件进入 QA，而旧 Repair
 * 又只能唯一替换 search，导致重复 disabled 属性白白耗尽两轮预算。
 * 只迁移这一种已知基础设施失败：废弃无效候选历史并重新生成该页 HTML。
 */
function recoverLegacyDisabledChoiceRepairFailure(
  page: PageGenerationState,
): PageGenerationState {
  const history = page.repairHistory ?? [];
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    page.error?.code === "REPAIR_FAILED" &&
    page.error.message.includes("search 必须在当前文档中唯一匹配") &&
    page.error.message.includes("INTERACTIVE_OPTIONS_DISABLED") &&
    history.length === 2 &&
    history.every(
      (attempt) =>
        attempt.status === "failed" &&
        attempt.failureClass === "agent_failed" &&
        attempt.issueCodes.includes("INTERACTIVE_OPTIONS_DISABLED"),
    );

  if (!isKnownFailure) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "html",
    htmlOutput: undefined,
    qualityReport: undefined,
    repairHistory: [],
    error: {
      code: "HTML_ENGINEER_FAILED",
      message:
        "生成 HTML 校验失败：页面必须包含且只能包含一个 main 主内容区域；choice 互动的单选或复选控件不得包含 disabled 属性。",
    },
  });
}

export async function startCourseGeneration(
  state: CourseGenerationState,
  input: CourseGenerationWorkflowInput,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const next = appendCourseGenerationEvent(state, dependencies.now, {
    type: "start",
    stage: state.currentStage,
    summary: input.existingState
      ? "整课生成已从服务端检查点恢复。"
      : state.workerConfig?.mode === "parallel"
        ? `整课生成已开始，Page Worker 最大并发度为 ${state.workerConfig.concurrency}。`
        : "整课串行生成已开始。",
  });
  return checkpointCourseGenerationState(next, dependencies);
}

/** 统一执行节点生命周期，节点本身不能写 checkpoint 或发布 SSE。 */
export async function runCourseGenerationNodes(
  state: CourseGenerationState,
  nodes: CourseGenerationNode[],
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
  retryFeedback?: CourseGenerationNodeContext["retryFeedback"],
): Promise<CourseNodeRunResult> {
  const result = await runSequentialWorkflow<
    CourseGenerationState,
    CourseGenerationNodeContext,
    CourseGenerationNodeEvent,
    CourseGenerationNodeName,
    CourseGenerationNode
  >({
    state,
    nodes,
    context: {
      runtime: context,
      pageCount: input.pageCount,
      dependencies,
      retryFeedback,
    },
    merge: (current, patch) =>
      CourseGenerationStateSchema.parse({ ...current, ...patch }),
    beforeNode: (current, node) => {
      let next: CourseGenerationState = {
        ...current,
        currentStage: node.stage,
        currentPageId: node.pageId,
      };

      if (node.pageId && isPageStage(node.stage)) {
        const pageStage = node.stage;
        next = updatePage(next, node.pageId, (page) => ({
          ...page,
          status: "running",
          currentStage: pageStage,
          error: undefined,
        }));
      }

      return beginAgent(next, dependencies, {
        stage: node.stage,
        pageId: node.pageId,
        agent: node.agent,
        summary: node.startSummary(next),
      });
    },
    afterNode: async (current, node, nodeResult) => {
      let next = appendNodeEvents(
        current,
        dependencies.now,
        node,
        nodeResult.events,
      );
      next = appendAgentDone(next, dependencies.now, {
        stage: node.stage,
        pageId: node.pageId,
        agent: node.agent,
        summary: node.doneSummary(next),
      });

      for (const event of node.afterDoneEvents?.(next) ?? []) {
        next = appendNodeEvent(next, dependencies.now, node, event, false);
      }

      return checkpointCourseGenerationState(next, dependencies);
    },
  });

  if (
    result.status === "failed" &&
    result.error instanceof CourseGenerationNodeError
  ) {
    const failedNode = nodes.find(
      ({ name }) => name === result.error.nodeName,
    );
    if (failedNode) {
      return {
        ...result,
        state: appendNodeEvents(
          result.state,
          dependencies.now,
          failedNode,
          result.error.events,
        ),
      };
    }
  }

  return result;
}

export function getCourseNodeRetryFeedback(
  state: CourseGenerationState,
  node: CourseGenerationNode,
  retryFailure?: WorkflowNodeError<CourseGenerationNodeName>,
): CourseGenerationNodeContext["retryFeedback"] {
  if (retryFailure) {
    return {
      nodeName: retryFailure.nodeName,
      code: retryFailure.code,
      message: retryFailure.message,
    };
  }

  const persistedError = node.pageId
    ? state.pages.find(({ pageId }) => pageId === node.pageId)?.error
    : undefined;
  return persistedError
    ? {
        nodeName: node.name,
        code: persistedError.code,
        message: persistedError.message,
      }
    : undefined;
}

export function failCourseGenerationNode(
  result: Extract<CourseNodeRunResult, { status: "failed" }>,
  nodes: CourseGenerationNode[],
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const node = nodes.find(({ name }) => name === result.error.nodeName);
  return failCourseGeneration(
    result.state,
    {
      stage: node?.stage ?? result.state.currentStage,
      pageId: node?.pageId,
      code: result.error.code,
      message: result.error.message,
    },
    context,
    dependencies,
    { agent: node?.agent ?? result.error.nodeName },
  );
}

export async function failCourseGeneration(
  state: CourseGenerationState,
  error: CourseGenerationError,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: { agent?: string } = {},
) {
  const cancelled =
    context.abortSignal?.aborted ||
    error.code === "AGENT_ABORTED" ||
    error.code === "WORKFLOW_ABORTED";
  const completedAt = dependencies.now();
  let failed: CourseGenerationState = {
    ...state,
    status: cancelled ? ("cancelled" as const) : ("failed" as const),
    currentStage: error.stage,
    currentPageId: error.pageId,
    completedAt,
    durationMs: durationSince(state.startedAt, completedAt),
    errors: sameError(state.errors.at(-1), error)
      ? state.errors
      : [...state.errors, error],
  };

  if (error.pageId && isPageStage(error.stage)) {
    const pageStage = error.stage;
    failed = updatePage(failed, error.pageId, (page) => ({
      ...page,
      status: "failed",
      currentStage: pageStage,
      error: { code: error.code, message: error.message },
    }));
  }

  failed = appendCourseGenerationEvent(failed, dependencies.now, {
    type: "error",
    stage: error.stage,
    pageId: error.pageId,
    agent: metadata.agent,
    summary: error.message,
  });
  return checkpointCourseGenerationState(failed, dependencies);
}

export function completeCourseGeneration(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const completedAt = dependencies.now();
  const completed = appendCourseGenerationEvent(
    {
      ...state,
      status: "completed",
      currentStage: "complete",
      currentPageId: undefined,
      completedAt,
      durationMs: durationSince(state.startedAt, completedAt),
    },
    dependencies.now,
    {
      type: "finish",
      stage: "complete",
      summary: `整课生成完成，共交付 ${state.pages.length} 个 HTML 页面。`,
    },
  );
  return checkpointCourseGenerationState(completed, dependencies);
}

export function appendCourseGenerationEvent(
  state: CourseGenerationState,
  now: () => string,
  event: Pick<
    CourseGenerationPublicEvent,
    "type" | "stage" | "summary"
  > &
    Partial<
      Pick<
        CourseGenerationPublicEvent,
        "pageId" | "agent" | "step" | "timestamp"
      >
    >,
): CourseGenerationState {
  const nextEvent: CourseGenerationPublicEvent = {
    id: crypto.randomUUID(),
    sequence: state.events.length + 1,
    traceId: state.traceId,
    timestamp: event.timestamp ?? now(),
    step: event.step ?? 0,
    type: event.type,
    stage: event.stage,
    pageId: event.pageId,
    agent: event.agent,
    summary: event.summary,
  };

  return { ...state, events: [...state.events, nextEvent] };
}

export async function checkpointCourseGenerationState(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const parsed = CourseGenerationStateSchema.parse({
    ...state,
    updatedAt: dependencies.now(),
  });
  await dependencies.checkpoint(parsed);
  return parsed;
}

export function requireCourseGenerationValue<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) throw new Error(`课程工作流缺少 ${name}。`);
  return value;
}

type AgentBoundaryMetadata = {
  stage: CourseGenerationStage;
  agent: string;
  pageId?: string;
  summary: string;
};

function beginAgent(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: AgentBoundaryMetadata,
) {
  return checkpointCourseGenerationState(
    appendCourseGenerationEvent(state, dependencies.now, {
      type: "agent_start",
      ...metadata,
    }),
    dependencies,
  );
}

function appendAgentDone(
  state: CourseGenerationState,
  now: () => string,
  metadata: AgentBoundaryMetadata,
) {
  return appendCourseGenerationEvent(state, now, {
    type: "agent_done",
    ...metadata,
  });
}

function appendNodeEvents(
  state: CourseGenerationState,
  now: () => string,
  node: CourseGenerationNode,
  events: readonly CourseGenerationNodeEvent[],
) {
  return events.reduce(
    (next, event) => appendNodeEvent(next, now, node, event),
    state,
  );
}

function appendNodeEvent(
  state: CourseGenerationState,
  now: () => string,
  node: CourseGenerationNode,
  event: CourseGenerationNodeEvent,
  inheritNodeAgent = true,
) {
  return appendCourseGenerationEvent(state, now, {
    type: event.type,
    stage: node.stage,
    pageId: node.pageId,
    agent: event.agent ?? (inheritNodeAgent ? node.agent : undefined),
    step: event.step,
    summary: event.summary,
    timestamp: event.timestamp,
  });
}

function updatePage(
  state: CourseGenerationState,
  pageId: string,
  updater: (page: PageGenerationState) => PageGenerationState,
): CourseGenerationState {
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.pageId === pageId ? updater(page) : page,
    ),
  };
}

function isPageStage(
  stage: CourseGenerationStage,
): stage is "page_writer" | "assets" | "html" | "qa" {
  return (
    stage === "page_writer" ||
    stage === "assets" ||
    stage === "html" ||
    stage === "qa"
  );
}

function resolveWorkerConfig(
  input: CourseGenerationWorkflowInput,
  persisted?: CourseGenerationState["workerConfig"],
) {
  if (
    persisted &&
    ((input.executionMode && input.executionMode !== persisted.mode) ||
      (input.concurrency && input.concurrency !== persisted.concurrency))
  ) {
    throw new Error("恢复课程时不能更改已持久化的 Page Worker 配置。");
  }
  return PageWorkerConfigSchema.parse(
    persisted ?? {
      mode: input.executionMode ?? "parallel",
      concurrency: input.concurrency ?? 2,
    },
  );
}

function sameError(
  left: CourseGenerationError | undefined,
  right: CourseGenerationError,
) {
  return Boolean(
    left &&
      left.stage === right.stage &&
      left.pageId === right.pageId &&
      left.code === right.code &&
      left.message === right.message,
  );
}

function durationSince(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
