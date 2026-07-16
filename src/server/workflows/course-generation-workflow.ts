import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { createCourseStore } from "@/server/storage/course-store";
import { runCourseDesignWorkflow } from "@/server/workflows/course-design-workflow";
import {
  CourseGenerationNodeError,
  createAssetsNode,
  createCourseDesignNode,
  createHtmlEngineerNode,
  createIntentNode,
  createPageWriterNode,
  createPlannerNode,
  type CourseGenerationNode,
  type CourseGenerationNodeContext,
  type CourseGenerationNodeDependencies,
  type CourseGenerationNodeEvent,
  type CourseGenerationNodeName,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-nodes";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import {
  runSequentialWorkflow,
  type SequentialWorkflowResult,
} from "@/server/workflows/sequential-workflow";
import {
  CourseGenerationStateSchema,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
} from "@/shared/course-schema";

export type { CourseMvpPageCount } from "@/server/workflows/course-generation-nodes";

export type CourseGenerationWorkflowInput = {
  courseId: string;
  userPrompt: string;
  pageCount?: CourseMvpPageCount;
  existingState?: CourseGenerationState;
};

export type CourseGenerationWorkflowDependencies =
  CourseGenerationNodeDependencies & {
    checkpoint(state: CourseGenerationState): Promise<void>;
    now(): string;
  };

const courseStore = createCourseStore();
const defaultDependencies: CourseGenerationWorkflowDependencies = {
  generateIntent: generateCourseIntent,
  runPlanner: runCoursePlannerAgent,
  runDesign: runCourseDesignWorkflow,
  runPageWriter: runPageWriterAgent,
  runAssets: runImageAssetWorkflow,
  runHtml: runHtmlEngineerAgent,
  checkpoint: courseStore.save,
  now: () => new Date().toISOString(),
};

/**
 * Day 22 的兼容入口：用显式节点列表执行既有固定串行流程。
 * API、checkpoint、恢复和公开事件协议仍由这一课程级事实来源统一管理。
 */
export async function runCourseGenerationWorkflow(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
): Promise<CourseGenerationState> {
  const dependencies = { ...defaultDependencies, ...overrides };
  let state = initializeState(input, context, dependencies.now);

  if (state.status === "completed") return state;

  state = appendEvent(state, dependencies.now, {
    type: "start",
    stage: state.currentStage,
    summary: input.existingState
      ? "整课生成已从服务端检查点恢复。"
      : "整课串行生成已开始。",
  });
  state = await checkpoint(state, dependencies);

  const globalNodes: CourseGenerationNode[] = [];
  if (!state.intent) globalNodes.push(createIntentNode());
  if (!state.outline) globalNodes.push(createPlannerNode());
  if (!state.briefs || !state.pageWorkerBriefs) {
    globalNodes.push(createCourseDesignNode());
  }

  const globalResult = await runCourseNodes(
    state,
    globalNodes,
    input,
    context,
    dependencies,
  );
  if (globalResult.status === "failed") {
    return failNodeWorkflow(
      globalResult,
      globalNodes,
      context,
      dependencies,
    );
  }
  state = globalResult.state;

  if (!state.outline || !state.pageWorkerBriefs) {
    return failWorkflow(
      state,
      {
        stage: state.currentStage,
        code: "WORKFLOW_STATE_INCOMPLETE",
        message: "课程工作流缺少规划或页面 brief。",
      },
      context,
      dependencies,
    );
  }

  for (const pagePlan of state.outline.pages) {
    const pageState = getPage(state, pagePlan.id);
    if (pageState.status === "completed") continue;

    const unmetDependency = pagePlan.dependsOnPageIds.find(
      (pageId) => getPage(state, pageId).status !== "completed",
    );
    if (unmetDependency) {
      return failWorkflow(
        state,
        {
          stage: pageState.currentStage,
          pageId: pagePlan.id,
          code: "PAGE_DEPENDENCY_INCOMPLETE",
          message: `页面 ${pagePlan.id} 的依赖 ${unmetDependency} 尚未完成。`,
        },
        context,
        dependencies,
      );
    }

    const brief = state.pageWorkerBriefs?.find(
      ({ pageId }) => pageId === pagePlan.id,
    );
    if (!brief) {
      return failWorkflow(
        state,
        {
          stage: "page_writer",
          pageId: pagePlan.id,
          code: "PAGE_BRIEF_NOT_FOUND",
          message: `页面 ${pagePlan.id} 缺少 Page Worker brief。`,
        },
        context,
        dependencies,
      );
    }

    state = updatePage(state, pagePlan.id, (page) => ({
      ...page,
      status: "running",
      error: undefined,
    }));

    const pageNodes: CourseGenerationNode[] = [];
    const currentPage = getPage(state, pagePlan.id);
    if (!currentPage.content) {
      pageNodes.push(createPageWriterNode(pagePlan.id));
    }

    const assetsAlreadyResolved =
      currentPage.currentStage === "html" ||
      currentPage.currentStage === "complete" ||
      Boolean(currentPage.htmlOutput);

    if (!assetsAlreadyResolved) {
      pageNodes.push(createAssetsNode(pagePlan.id));
    }

    if (!currentPage.htmlOutput) {
      pageNodes.push(createHtmlEngineerNode(pagePlan.id));
    }

    const pageResult = await runCourseNodes(
      state,
      pageNodes,
      input,
      context,
      dependencies,
    );
    if (pageResult.status === "failed") {
      return failNodeWorkflow(
        pageResult,
        pageNodes,
        context,
        dependencies,
      );
    }
    state = pageResult.state;
  }

  const completedAt = dependencies.now();
  state = appendEvent(
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
  return checkpoint(state, dependencies);
}

type CourseNodeRunResult = SequentialWorkflowResult<
  CourseGenerationState,
  CourseGenerationNode["name"]
>;

/** 统一执行节点生命周期，节点本身不能写 checkpoint 或发布 SSE。 */
async function runCourseNodes(
  state: CourseGenerationState,
  nodes: CourseGenerationNode[],
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
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

      return checkpoint(next, dependencies);
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

function failNodeWorkflow(
  result: Extract<CourseNodeRunResult, { status: "failed" }>,
  nodes: CourseGenerationNode[],
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const node = nodes.find(({ name }) => name === result.error.nodeName);
  return failWorkflow(
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
  return appendEvent(state, now, {
    type: event.type,
    stage: node.stage,
    pageId: node.pageId,
    agent: event.agent ?? (inheritNodeAgent ? node.agent : undefined),
    step: event.step,
    summary: event.summary,
    timestamp: event.timestamp,
  });
}

function initializeState(
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
    if (existing.status === "completed") return existing;

    return CourseGenerationStateSchema.parse({
      ...existing,
      status: "running",
      traceId: context.traceId,
      errors: [],
      completedAt: undefined,
      durationMs: undefined,
      updatedAt: now(),
    });
  }

  const timestamp = now();
  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: input.courseId,
    traceId: context.traceId,
    userPrompt: input.userPrompt,
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: timestamp,
    updatedAt: timestamp,
  });
}

async function failWorkflow(
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
    errors: [...state.errors, error],
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

  failed = appendEvent(failed, dependencies.now, {
    type: "error",
    stage: error.stage,
    pageId: error.pageId,
    agent: metadata.agent,
    summary: error.message,
  });
  return checkpoint(failed, dependencies);
}

type AgentBoundaryMetadata = {
  stage: CourseGenerationStage;
  agent: string;
  pageId?: string;
  summary: string;
};

/** 在调用长耗时 Agent 前先落盘，SSE 才能即时展示真实的运行阶段。 */
function beginAgent(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: AgentBoundaryMetadata,
) {
  return checkpoint(
    appendEvent(state, dependencies.now, {
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
  return appendEvent(state, now, {
    type: "agent_done",
    ...metadata,
  });
}

function appendEvent(
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

async function checkpoint(
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

function getPage(state: CourseGenerationState, pageId: string) {
  const page = state.pages.find((candidate) => candidate.pageId === pageId);
  if (!page) throw new Error(`课程状态缺少页面 ${pageId}。`);
  return page;
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
): stage is "page_writer" | "assets" | "html" {
  return stage === "page_writer" || stage === "assets" || stage === "html";
}

function durationSince(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
