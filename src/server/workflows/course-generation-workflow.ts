import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import type {
  AgentEvent,
  AgentRuntimeContext,
} from "@/server/agents/core/types";
import { createCourseStore } from "@/server/storage/course-store";
import {
  runCourseDesignWorkflow,
  type CourseDesignEvent,
} from "@/server/workflows/course-design-workflow";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import {
  CourseGenerationStateSchema,
  CourseIntentSchema,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
} from "@/shared/course-schema";

export type CourseMvpPageCount = 3 | 4 | 5;

export type CourseGenerationWorkflowInput = {
  courseId: string;
  userPrompt: string;
  pageCount?: CourseMvpPageCount;
  existingState?: CourseGenerationState;
};

export type CourseGenerationWorkflowDependencies = {
  generateIntent: typeof generateCourseIntent;
  runPlanner: typeof runCoursePlannerAgent;
  runDesign: typeof runCourseDesignWorkflow;
  runPageWriter: typeof runPageWriterAgent;
  runAssets: typeof runImageAssetWorkflow;
  runHtml: typeof runHtmlEngineerAgent;
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
 * Day 18 的课程级事实来源：按页面顺序串行生成 DSL、素材和 HTML。
 * 每个边界都保存完整、可校验的 checkpoint；失败只停止当前页及其后继页。
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

  if (!state.intent) {
    try {
      assertNotAborted(context.abortSignal);
      const generatedIntent = await dependencies.generateIntent({
        abortSignal: context.abortSignal,
        traceId: context.traceId,
        userPrompt: state.userPrompt,
      });
      const courseLength =
        input.pageCount ??
        (Math.min(5, Math.max(3, generatedIntent.courseLength)) as CourseMvpPageCount);
      const intent = CourseIntentSchema.parse({
        ...generatedIntent,
        courseLength,
      });
      state = appendEvent(
        {
          ...state,
          intent,
          currentStage: "planner",
        },
        dependencies.now,
        {
          type: "validation",
          stage: "intent",
          agent: "intent",
          summary: `课程意图已校验，MVP 固定生成 ${intent.courseLength} 页。`,
        },
      );
      state = await checkpoint(state, dependencies);
    } catch (error) {
      return failWorkflow(
        state,
        toWorkflowError("intent", error),
        context,
        dependencies,
      );
    }
  }

  if (!state.outline) {
    const plannerState = await dependencies.runPlanner(state.intent!, context);
    state = appendAgentEvents(state, dependencies.now, "planner", plannerState.events, {
      agent: "planner",
    });

    if (plannerState.status !== "completed" || !plannerState.outline) {
      return failWorkflow(
        state,
        {
          stage: "planner",
          code: plannerState.error?.code ?? "PLANNER_FAILED",
          message:
            plannerState.error?.message ?? "Course Planner 未生成有效课程结构。",
        },
        context,
        dependencies,
      );
    }

    state = {
      ...state,
      outline: plannerState.outline,
      currentStage: "design",
    };
    state = await checkpoint(state, dependencies);
  }

  if (!state.briefs || !state.pageWorkerBriefs) {
    const designState = await dependencies.runDesign(
      { intent: state.intent!, outline: state.outline! },
      context,
    );
    state = appendDesignEvents(state, dependencies.now, designState.events);

    if (
      designState.status !== "completed" ||
      !designState.briefs ||
      !designState.pageWorkerBriefs
    ) {
      return failWorkflow(
        state,
        {
          stage: "design",
          code: designState.error?.code ?? "COURSE_DESIGN_FAILED",
          message:
            designState.error?.message ?? "专业设计工作流未生成有效结果。",
        },
        context,
        dependencies,
      );
    }

    state = {
      ...state,
      briefs: designState.briefs,
      pageWorkerBriefs: designState.pageWorkerBriefs,
      pages: state.outline!.pages.map((page) => ({
        pageId: page.id,
        order: page.order,
        status: "pending" as const,
        currentStage: "page_writer" as const,
        assets: [],
      })),
      currentStage: "page_writer",
    };
    state = await checkpoint(state, dependencies);
  }

  for (const pagePlan of state.outline!.pages) {
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

    const brief = state.pageWorkerBriefs!.find(
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

    if (!getPage(state, pagePlan.id).content) {
      state = setCurrentStage(state, "page_writer", pagePlan.id);
      state = await checkpoint(state, dependencies);
      const writerState = await dependencies.runPageWriter(
        { intent: state.intent!, page: pagePlan, brief },
        context,
      );
      state = appendAgentEvents(
        state,
        dependencies.now,
        "page_writer",
        writerState.events,
        { agent: "page-writer", pageId: pagePlan.id },
      );

      if (writerState.status !== "completed" || !writerState.content) {
        return failWorkflow(
          state,
          {
            stage: "page_writer",
            pageId: pagePlan.id,
            code: writerState.error?.code ?? "PAGE_WRITER_FAILED",
            message:
              writerState.error?.message ??
              `页面 ${pagePlan.id} 未生成有效 PageContentDSL。`,
          },
          context,
          dependencies,
        );
      }

      state = updatePage(state, pagePlan.id, (page) => ({
        ...page,
        content: writerState.content,
        currentStage: "assets",
      }));
      state = await checkpoint(state, dependencies);
    }

    let currentPage = getPage(state, pagePlan.id);
    const assetsAlreadyResolved =
      currentPage.currentStage === "html" ||
      currentPage.currentStage === "complete" ||
      Boolean(currentPage.htmlOutput);

    if (!assetsAlreadyResolved) {
      state = setCurrentStage(state, "assets", pagePlan.id);
      state = updatePage(state, pagePlan.id, (page) => ({
        ...page,
        currentStage: "assets",
      }));
      state = await checkpoint(state, dependencies);
      currentPage = getPage(state, pagePlan.id);

      if (currentPage.content!.assetSlots.length === 0) {
        state = appendEvent(state, dependencies.now, {
          type: "validation",
          stage: "assets",
          pageId: pagePlan.id,
          agent: "image-assets",
          summary: "当前页面没有素材槽，素材阶段已确定性跳过。",
        });
      } else {
        const assetState = await dependencies.runAssets(
          {
            content: currentPage.content!,
            visualBrief: state.briefs!.visual,
          },
          context,
        );
        state = appendAgentEvents(
          state,
          dependencies.now,
          "assets",
          assetState.events,
          { agent: "image-assets", pageId: pagePlan.id },
        );

        if (assetState.status !== "completed" || !assetState.results) {
          return failWorkflow(
            state,
            {
              stage: "assets",
              pageId: pagePlan.id,
              code: assetState.error?.code ?? "IMAGE_ASSETS_FAILED",
              message:
                assetState.error?.message ??
                `页面 ${pagePlan.id} 的素材阶段未生成有效结果。`,
            },
            context,
            dependencies,
          );
        }

        state = updatePage(state, pagePlan.id, (page) => ({
          ...page,
          assets: assetState.results!,
        }));
      }

      state = updatePage(state, pagePlan.id, (page) => ({
        ...page,
        currentStage: "html",
      }));
      state = await checkpoint(state, dependencies);
    }

    currentPage = getPage(state, pagePlan.id);
    if (!currentPage.htmlOutput) {
      state = setCurrentStage(state, "html", pagePlan.id);
      state = await checkpoint(state, dependencies);
      const htmlState = await dependencies.runHtml(
        {
          content: currentPage.content!,
          visualBrief: state.briefs!.visual,
          assets: currentPage.assets,
        },
        context,
      );
      state = appendAgentEvents(
        state,
        dependencies.now,
        "html",
        htmlState.events,
        { agent: "html-engineer", pageId: pagePlan.id },
      );

      if (htmlState.status !== "completed" || !htmlState.htmlOutput) {
        return failWorkflow(
          state,
          {
            stage: "html",
            pageId: pagePlan.id,
            code: htmlState.error?.code ?? "HTML_ENGINEER_FAILED",
            message:
              htmlState.error?.message ??
              `页面 ${pagePlan.id} 未生成有效 HTML。`,
          },
          context,
          dependencies,
        );
      }

      state = updatePage(state, pagePlan.id, (page) => ({
        ...page,
        status: "completed",
        currentStage: "complete",
        htmlOutput: htmlState.htmlOutput,
        error: undefined,
      }));
      state = await checkpoint(state, dependencies);
    }
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
    summary: error.message,
  });
  return checkpoint(failed, dependencies);
}

function appendDesignEvents(
  state: CourseGenerationState,
  now: () => string,
  events: CourseDesignEvent[],
) {
  let next = state;
  for (const event of events) {
    next = appendAgentEvent(next, now, "design", event, {
      agent: event.agent,
    });
  }
  return next;
}

function appendAgentEvents(
  state: CourseGenerationState,
  now: () => string,
  stage: CourseGenerationStage,
  events: AgentEvent[],
  metadata: { agent: string; pageId?: string },
) {
  return events.reduce(
    (next, event) => appendAgentEvent(next, now, stage, event, metadata),
    state,
  );
}

function appendAgentEvent(
  state: CourseGenerationState,
  now: () => string,
  stage: CourseGenerationStage,
  event: AgentEvent,
  metadata: { agent: string; pageId?: string },
) {
  return appendEvent(state, now, {
    type: event.type,
    stage,
    pageId: metadata.pageId,
    agent: metadata.agent,
    step: event.step,
    summary: event.summary,
    timestamp: event.timestamp,
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

function setCurrentStage(
  state: CourseGenerationState,
  stage: "page_writer" | "assets" | "html",
  pageId: string,
): CourseGenerationState {
  return { ...state, currentStage: stage, currentPageId: pageId };
}

function toWorkflowError(
  stage: CourseGenerationStage,
  error: unknown,
): CourseGenerationError {
  if (error instanceof WorkflowAbortedError) {
    return { stage, code: "WORKFLOW_ABORTED", message: error.message };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { stage, code: "WORKFLOW_ABORTED", message: "课程生成已取消。" };
  }
  return {
    stage,
    code: "WORKFLOW_EXECUTION_ERROR",
    message: error instanceof Error ? error.message : "课程生成出现未知错误。",
  };
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new WorkflowAbortedError();
}

class WorkflowAbortedError extends Error {
  constructor() {
    super("课程生成已取消。");
    this.name = "WorkflowAbortedError";
  }
}

function isPageStage(
  stage: CourseGenerationStage,
): stage is "page_writer" | "assets" | "html" {
  return stage === "page_writer" || stage === "assets" || stage === "html";
}

function durationSince(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
