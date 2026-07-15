import type {
  CourseDesignResponse,
  CourseGenerationResponse,
  CoursePlannerResponse,
  HtmlEngineerResponse,
  ImageAssetResponse,
  PageWriterResponse,
  PublicAgentEvent,
} from "@/features/course-planner/lib/course-planner-api";
import type {
  CourseGenerationError,
  CourseGenerationStage,
  CourseGenerationState,
  PageGenerationState,
} from "@/shared/course-schema";
import type {
  CourseRunStage,
  CourseRunStageStatus,
  SeacaCourseRun,
} from "@/types/seaca";

type RunSeed = {
  id: string;
  prompt: string;
  startedAt: number;
};

/**
 * 把服务端持久化工作流状态投影到现有 Seaca Controller 结构。
 * 这里只做协议映射，不在浏览器复制课程编排规则。
 */
export function courseGenerationToSeacaRun(
  response: CourseGenerationResponse,
  seed: RunSeed,
): SeacaCourseRun {
  const { state } = response;
  const plannerError = findStageError(state, ["intent", "planner"]);
  const designError = findStageError(state, ["design"]);
  const plannerEvents = eventsFor(state, ["intent", "planner"]);
  const designEvents = state.events
    .filter(
      (
        event,
      ): event is typeof event & {
        agent: "pedagogy" | "story" | "visual";
      } =>
        event.traceId === state.traceId &&
        event.stage === "design" &&
        isDesignAgent(event.agent),
    )
    .map((event) => ({ ...event, agent: event.agent }));
  const plannerData = state.intent
    ? ({
        traceId: state.traceId,
        intent: state.intent,
        state: {
          status: state.outline ? "completed" : "failed",
          events: plannerEvents,
          outline: state.outline,
          error: plannerError
            ? { code: plannerError.code, message: plannerError.message }
            : undefined,
        },
      } satisfies CoursePlannerResponse)
    : undefined;
  const designData = state.outline
    ? ({
        traceId: state.traceId,
        state: {
          status: state.briefs ? "completed" : "failed",
          events: designEvents,
          briefs: state.briefs,
          pageWorkerBriefs: state.pageWorkerBriefs,
          error: designError
            ? {
                agent: "workflow",
                code: designError.code,
                message: designError.message,
              }
            : undefined,
        },
      } satisfies CourseDesignResponse)
    : undefined;

  const pageWrites: SeacaCourseRun["pageWrites"] = {};
  const pageAssets: SeacaCourseRun["pageAssets"] = {};
  const pageHtml: SeacaCourseRun["pageHtml"] = {};

  for (const page of state.pages) {
    pageWrites[page.pageId] = buildPageWriterStage(state, page);
    pageAssets[page.pageId] = buildAssetStage(state, page);
    pageHtml[page.pageId] = buildHtmlStage(state, page);
  }

  return {
    id: seed.id,
    courseId: state.courseId,
    prompt: seed.prompt,
    traceId: state.traceId,
    startedAt: seed.startedAt,
    generation: state,
    planner: {
      status: stageStatus(Boolean(state.outline), plannerError),
      events: plannerEvents,
      data: plannerData,
      error: plannerError?.message,
    },
    design: {
      status: stageStatus(Boolean(state.briefs), designError),
      events: designEvents,
      data: designData,
      error: designError?.message,
    },
    pageWrites,
    pageAssets,
    pageHtml,
    pageQa: {},
  };
}

function buildPageWriterStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage<PageWriterResponse> {
  const error = findStageError(state, ["page_writer"], page.pageId);
  const events = eventsFor(state, ["page_writer"], page.pageId);
  const status = stageStatus(Boolean(page.content), error);

  return {
    status,
    events,
    error: error?.message,
    data:
      page.content || error
        ? {
            traceId: state.traceId,
            state: {
              status,
              events,
              content: page.content,
              error: error
                ? { code: error.code, message: error.message }
                : undefined,
            },
          }
        : undefined,
  };
}

function buildAssetStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage<ImageAssetResponse> {
  const error = findStageError(state, ["assets"], page.pageId);
  const events = eventsFor(state, ["assets"], page.pageId);
  const completed =
    page.currentStage === "html" ||
    page.currentStage === "complete" ||
    Boolean(page.htmlOutput);
  const status = stageStatus(completed, error);

  return {
    status,
    events,
    error: error?.message,
    data:
      completed || error
        ? {
            traceId: state.traceId,
            state: {
              status: status === "completed" ? "completed" : "failed",
              events,
              results: completed ? page.assets : undefined,
              error: error
                ? { code: error.code, message: error.message }
                : undefined,
            },
          }
        : undefined,
  };
}

function buildHtmlStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage<HtmlEngineerResponse> {
  const error = findStageError(state, ["html"], page.pageId);
  const events = eventsFor(state, ["html"], page.pageId);
  const status = stageStatus(Boolean(page.htmlOutput), error);

  return {
    status,
    events,
    error: error?.message,
    data:
      page.htmlOutput || error
        ? {
            traceId: state.traceId,
            state: {
              status,
              events,
              htmlOutput: page.htmlOutput,
              error: error
                ? { code: error.code, message: error.message }
                : undefined,
            },
          }
        : undefined,
  };
}

function stageStatus(
  completed: boolean,
  error?: CourseGenerationError,
): CourseRunStageStatus {
  if (completed) return "completed";
  if (error) return "failed";
  return "idle";
}

function eventsFor(
  state: CourseGenerationState,
  stages: CourseGenerationStage[],
  pageId?: string,
): PublicAgentEvent[] {
  return state.events.filter(
    (event) =>
      event.traceId === state.traceId &&
      stages.includes(event.stage) &&
      (pageId === undefined || event.pageId === pageId),
  );
}

function findStageError(
  state: CourseGenerationState,
  stages: CourseGenerationStage[],
  pageId?: string,
) {
  return [...state.errors]
    .reverse()
    .find(
      (error) =>
        stages.includes(error.stage) &&
        (pageId === undefined || error.pageId === pageId),
    );
}

function isDesignAgent(
  value: string | undefined,
): value is "pedagogy" | "story" | "visual" {
  return value === "pedagogy" || value === "story" || value === "visual";
}
