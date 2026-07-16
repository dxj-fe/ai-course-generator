import type { AgentRuntimeContext } from "@/server/agents/core/types";
import {
  generatePageWorker,
  type PageWorkerDependencies,
  type PageWorkerGlobalBriefs,
  type PageWorkerUpdate,
} from "@/server/workflows/page-worker";
import { runPromisePool } from "@/server/workflows/promise-pool";
import {
  CourseGenerationStateSchema,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
  type PagePlan,
  type PageWorkerConfig,
  type PageWorkerEvent,
} from "@/shared/course-schema";

export type CourseWorkersWorkflowDependencies = PageWorkerDependencies & {
  generatePage: typeof generatePageWorker;
  checkpoint(state: CourseGenerationState): Promise<void>;
};

export type CourseWorkersWorkflowResult =
  | { status: "completed"; state: CourseGenerationState }
  | {
      status: "failed";
      state: CourseGenerationState;
      error: CourseGenerationError;
    };

/**
 * 根据页面依赖分批调度 Worker。Worker 之间不共享可变状态；所有局部更新都
 * 经过同一个串行 merge/checkpoint 队列，保证事件序号和持久化状态不丢失。
 */
export async function runCourseWorkersWorkflow(
  initialState: CourseGenerationState,
  context: AgentRuntimeContext,
  config: PageWorkerConfig,
  dependencies: CourseWorkersWorkflowDependencies,
): Promise<CourseWorkersWorkflowResult> {
  let state = CourseGenerationStateSchema.parse(initialState);
  let mergeQueue = Promise.resolve();
  const attempted = new Set<string>();
  const concurrency = config.mode === "serial" ? 1 : config.concurrency;

  while (true) {
    if (context.abortSignal?.aborted) {
      return {
        status: "failed",
        state,
        error: {
          stage: activeStage(state),
          pageId: state.currentPageId,
          code: "WORKFLOW_ABORTED",
          message: "课程生成已取消。",
        },
      };
    }

    if (state.pages.every(({ status }) => status === "completed")) {
      return { status: "completed", state };
    }

    const ready = requireValue(state.outline, "course outline").pages.filter(
      (page) => {
        const pageState = findPage(state, page.id);
        return (
          pageState?.status !== "completed" &&
          !attempted.has(page.id) &&
          page.dependsOnPageIds.every(
            (dependencyId) =>
              findPage(state, dependencyId)?.status === "completed",
          )
        );
      },
    );
    const batch = config.mode === "serial" ? ready.slice(0, 1) : ready;

    if (batch.length === 0) {
      const failedPage = state.pages.find(({ status }) => status === "failed");
      const error: CourseGenerationError = failedPage
        ? {
            stage: toCourseStage(failedPage.currentStage),
            pageId: failedPage.pageId,
            code: failedPage.error?.code ?? "PAGE_WORKER_FAILED",
            message:
              failedPage.error?.message ??
              `页面 ${failedPage.pageId} 的 Page Worker 执行失败。`,
          }
        : {
            stage: activeStage(state),
            code: "PAGE_WORKER_DEPENDENCY_BLOCKED",
            message: "剩余页面的依赖均未完成，Page Worker 无法继续调度。",
          };
      return { status: "failed", state, error };
    }

    batch.forEach(({ id }) => attempted.add(id));
    const settled = await runPromisePool(
      batch,
      async (page) =>
        dependencies.generatePage(
          page,
          workerBriefs(state, page),
          {
            runtime: context,
            initialState: requireValue(findPage(state, page.id), "page state"),
            dependencies,
            onUpdate: (update) => {
              const operation = mergeQueue.then(async () => {
                state = mergeWorkerUpdate(
                  state,
                  update,
                  context.traceId,
                  dependencies.now,
                );
                await dependencies.checkpoint(state);
              });
              mergeQueue = operation;
              return operation;
            },
          },
        ),
      { concurrency, signal: context.abortSignal },
    );

    await mergeQueue;

    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index]!;
      const page = batch[index]!;
      if (item.status === "fulfilled") continue;

      const aborted =
        context.abortSignal?.aborted ||
        (item.reason instanceof DOMException &&
          item.reason.name === "AbortError");
      if (
        item.reason instanceof DOMException &&
        item.reason.name === "AbortError"
      ) {
        continue;
      }
      const error = {
        code: aborted ? "WORKFLOW_ABORTED" : "PAGE_WORKER_EXECUTION_ERROR",
        message: aborted
          ? "课程生成已取消。"
          : item.reason instanceof Error
            ? item.reason.message
            : `页面 ${page.id} 的 Page Worker 出现未知错误。`,
      };
      state = await mergeSyntheticFailure(
        state,
        page,
        error,
        context.traceId,
        dependencies,
      );
    }
  }
}

function workerBriefs(
  state: CourseGenerationState,
  page: PagePlan,
): PageWorkerGlobalBriefs {
  const outline = requireValue(state.outline, "course outline");
  const pageIndex = outline.pages.findIndex(({ id }) => id === page.id);
  return {
    intent: requireValue(state.intent, "course intent"),
    brief: requireValue(
      state.pageWorkerBriefs?.find(({ pageId }) => pageId === page.id),
      "page worker brief",
    ),
    visualBrief: requireValue(state.briefs?.visual, "visual brief"),
    courseContext: {
      courseOverview: outline.overview,
      learningObjectives: outline.learningObjectives,
      previousPage: outline.pages[pageIndex - 1],
      nextPage: outline.pages[pageIndex + 1],
    },
  };
}

function mergeWorkerUpdate(
  state: CourseGenerationState,
  update: PageWorkerUpdate,
  traceId: string,
  now: () => string,
) {
  const lastEvent = update.events.at(-1);
  const pages = state.pages.map((page) =>
    page.pageId === update.state.pageId ? update.state : page,
  );
  const nextErrors = state.errors.filter(
    ({ pageId }) => pageId !== update.state.pageId,
  );
  const pageError =
    update.state.status === "failed" && update.state.error
      ? {
          stage: toCourseStage(update.state.currentStage),
          pageId: update.state.pageId,
          ...update.state.error,
        }
      : undefined;
  let next: CourseGenerationState = {
    ...state,
    traceId,
    currentStage: lastEvent?.stage ?? state.currentStage,
    currentPageId: update.state.pageId,
    pages,
    errors: pageError ? [...nextErrors, pageError] : nextErrors,
  };

  for (const event of update.events) {
    next = appendWorkerEvent(next, event, traceId, now);
  }
  return CourseGenerationStateSchema.parse({ ...next, updatedAt: now() });
}

async function mergeSyntheticFailure(
  state: CourseGenerationState,
  page: PagePlan,
  error: { code: string; message: string },
  traceId: string,
  dependencies: CourseWorkersWorkflowDependencies,
) {
  const current = requireValue(findPage(state, page.id), "page state");
  const failed: PageGenerationState = {
    ...current,
    status: "failed",
    error,
  };
  const next = mergeWorkerUpdate(
    state,
    {
      state: failed,
      events: [
        {
          type: "error",
          stage: toWorkerStage(failed.currentStage),
          pageId: page.id,
          agent: "page-worker",
          timestamp: dependencies.now(),
          summary: error.message,
        },
      ],
    },
    traceId,
    dependencies.now,
  );
  await dependencies.checkpoint(next);
  return next;
}

function appendWorkerEvent(
  state: CourseGenerationState,
  event: PageWorkerEvent,
  traceId: string,
  now: () => string,
) {
  const projected: CourseGenerationPublicEvent = {
    id: crypto.randomUUID(),
    sequence: state.events.length + 1,
    traceId,
    timestamp: event.timestamp ?? now(),
    step: event.step ?? 0,
    type: event.type,
    stage: event.stage,
    pageId: event.pageId,
    agent: event.agent,
    summary: event.summary,
  };
  return { ...state, events: [...state.events, projected] };
}

function findPage(state: CourseGenerationState, pageId: string) {
  return state.pages.find((page) => page.pageId === pageId);
}

function activeStage(state: CourseGenerationState): CourseGenerationStage {
  return state.currentStage === "complete" ? "qa" : state.currentStage;
}

function toCourseStage(
  stage: PageGenerationState["currentStage"],
): CourseGenerationStage {
  return stage === "complete" ? "qa" : stage;
}

function toWorkerStage(
  stage: PageGenerationState["currentStage"],
): Exclude<PageGenerationState["currentStage"], "complete"> {
  return stage === "complete" ? "qa" : stage;
}

function requireValue<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`课程 Worker 运行层缺少 ${name}。`);
  return value;
}
