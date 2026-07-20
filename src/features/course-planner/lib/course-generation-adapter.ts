import type {
  CourseDesignResponse,
  CourseGenerationResponse,
  CoursePlannerResponse,
  HtmlEngineerResponse,
  ImageAssetResponse,
  PageQAResponse,
  PageWriterResponse,
  PublicAgentEvent,
} from "@/features/course-planner/lib/course-planner-api";
import type {
  CourseGenerationError,
  CourseGenerationPublicEvent,
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
  taskId?: string;
  prompt: string;
  startedAt: number;
};

type AgentCompatibleGenerationEvent = CourseGenerationPublicEvent & {
  type: PublicAgentEvent["type"];
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
  const designPublicEvents = eventsFor(state, ["design"]);
  const designAgentEvents = state.events
    .filter(isAgentCompatibleEvent)
    .filter(
      (
        event,
      ): event is AgentCompatibleGenerationEvent & {
        agent: "pedagogy" | "story" | "visual";
      } =>
        event.traceId === state.traceId &&
        event.stage === "design" &&
        isDesignAgent(event.agent),
    )
    .map((event) => ({ ...event, agent: event.agent }));
  const plannerStatus = stageStatus(
    Boolean(state.outline),
    plannerError,
    eventStatusForCurrentStage(state, ["intent", "planner"]),
    isStageRunning(state, ["intent", "planner"]),
  );
  const designStatus = stageStatus(
    Boolean(state.briefs),
    designError,
    eventStatusForCurrentStage(state, ["design"]),
    isStageRunning(state, ["design"]),
  );
  const plannerData = state.intent
    ? ({
        traceId: state.traceId,
        intent: state.intent,
        state: {
          status: plannerStatus,
          events: plannerEvents,
          outline: state.outline,
          error: plannerError
            ? { code: plannerError.code, message: plannerError.message }
            : undefined,
        },
      } satisfies CoursePlannerResponse)
    : undefined;
  const designData = state.outline && (state.briefs || designError)
    ? ({
        traceId: state.traceId,
        state: {
          status: state.briefs ? "completed" : "failed",
          events: designAgentEvents,
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
  const pageQa: SeacaCourseRun["pageQa"] = {};

  for (const page of state.pages) {
    pageWrites[page.pageId] = buildPageWriterStage(state, page);
    pageAssets[page.pageId] = buildAssetStage(state, page);
    pageHtml[page.pageId] = buildHtmlStage(state, page);
    const qa = buildQaStage(state, page);
    if (qa) pageQa[page.pageId] = qa;
  }

  return {
    id: seed.id,
    taskId: seed.taskId,
    courseId: state.courseId,
    prompt: seed.prompt,
    traceId: state.traceId,
    startedAt: seed.startedAt,
    generation: state,
    planner: {
      status: plannerStatus,
      events: plannerEvents,
      data: plannerData,
      error: plannerError?.message,
    },
    design: {
      status: designStatus,
      events: designPublicEvents,
      data: designData,
      error: designError?.message,
    },
    pageWrites,
    pageAssets,
    pageHtml,
    pageQa,
  };
}

function buildPageWriterStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage<PageWriterResponse> {
  const error = findStageError(state, ["page_writer"], page.pageId);
  const events = eventsFor(state, ["page_writer"], page.pageId);
  const status = stageStatus(
    Boolean(page.content),
    error,
    eventStatus(events),
    isPageStageRunning(state, page, "page_writer"),
  );

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
  const status = stageStatus(
    completed,
    error,
    eventStatus(events),
    isPageStageRunning(state, page, "assets"),
  );

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
  const status = stageStatus(
    Boolean(page.htmlOutput),
    error,
    eventStatus(events),
    isPageStageRunning(state, page, "html"),
  );

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

function buildQaStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage<PageQAResponse> | undefined {
  const error = findStageError(state, ["qa"], page.pageId);
  const events = eventsFor(state, ["qa"], page.pageId);
  if (
    !state.workerConfig &&
    !page.qualityReport &&
    !error &&
    events.length === 0 &&
    page.currentStage !== "qa"
  ) {
    return undefined;
  }
  const status = stageStatus(
    Boolean(page.qualityReport),
    error,
    eventStatus(events),
    isPageStageRunning(state, page, "qa"),
  );
  return {
    status,
    events,
    error: error?.message,
    data:
      page.qualityReport || error
        ? {
            traceId: state.traceId,
            state: {
              status,
              events,
              report: page.qualityReport,
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
  statusFromEvents?: CourseRunStageStatus,
  running = false,
): CourseRunStageStatus {
  if (completed) return "completed";
  if (error) return "failed";
  if (statusFromEvents) return statusFromEvents;
  if (running) return "running";
  return "idle";
}

function eventStatusForCurrentStage(
  state: CourseGenerationState,
  stages: CourseGenerationStage[],
) {
  if (!stages.includes(state.currentStage)) {
    return eventStatus(eventsFor(state, stages));
  }

  return eventStatus(eventsFor(state, [state.currentStage]));
}

function eventStatus(
  events: PublicAgentEvent[],
): CourseRunStageStatus | undefined {
  const type: string | undefined = events.at(-1)?.type;

  if (type === "error") return "failed";
  if (type === "agent_done" || type === "page_done" || type === "finish") {
    return "completed";
  }
  if (
    type === "agent_start" ||
    type === "repair_attempt" ||
    type === "start" ||
    type === "model_call" ||
    type === "tool_call" ||
    type === "validation"
  ) {
    return "running";
  }

  if (type === "repair_success") return "completed";

  return undefined;
}

function isStageRunning(
  state: CourseGenerationState,
  stages: CourseGenerationStage[],
) {
  return state.status === "running" && stages.includes(state.currentStage);
}

function isPageStageRunning(
  state: CourseGenerationState,
  page: PageGenerationState,
  stage: "page_writer" | "assets" | "html" | "qa",
) {
  return (
    state.status === "running" &&
    page.status === "running" &&
    page.currentStage === stage
  );
}

function eventsFor(
  state: CourseGenerationState,
  stages: CourseGenerationStage[],
  pageId?: string,
): PublicAgentEvent[] {
  return state.events.filter(isAgentCompatibleEvent).filter(
    (event) =>
      event.traceId === state.traceId &&
      stages.includes(event.stage) &&
      (pageId === undefined || event.pageId === pageId),
  );
}

function isAgentCompatibleEvent(
  event: CourseGenerationPublicEvent,
): event is AgentCompatibleGenerationEvent {
  return event.type !== "supervisor_decision";
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
