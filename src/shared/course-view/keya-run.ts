import type {
  CourseGenerationError,
  CourseGenerationPublicEvent,
  CourseGenerationResponse,
  CourseGenerationStage,
  CourseGenerationState,
  PageGenerationState,
  PublicAgentEvent,
} from "@/shared/course-schema";
import type {
  CourseRunStage,
  CourseRunStageStatus,
  KeyaCourseRun,
} from "@/types/keya";

type RunSeed = {
  id: string;
  taskId?: string;
  prompt: string;
  startedAt: number;
};

type AgentGenerationEvent = CourseGenerationPublicEvent & {
  type: PublicAgentEvent["type"];
};

/**
 * 把服务端持久化课程状态投影到现有课芽 Controller 结构。
 * 这里只做协议映射，不在浏览器复制课程编排规则。
 */
export function projectCourseStateToKeyaRun(
  response: CourseGenerationResponse,
  seed: RunSeed,
): KeyaCourseRun {
  const { state } = response;
  const plannerError = findStageError(state, ["intent", "planner"]);
  const designError = findStageError(state, ["design"]);
  const plannerEvents = eventsFor(state, ["intent", "planner"]);
  const designPublicEvents = eventsFor(state, ["design"]);
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
  const pageWrites: KeyaCourseRun["pageWrites"] = {};
  const pageAssets: KeyaCourseRun["pageAssets"] = {};
  const pageHtml: KeyaCourseRun["pageHtml"] = {};
  const pageQa: KeyaCourseRun["pageQa"] = {};

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
      error: plannerError?.message,
    },
    design: {
      status: designStatus,
      events: designPublicEvents,
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
): CourseRunStage {
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
  };
}

function buildAssetStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage {
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
  };
}

function buildHtmlStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage {
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
  };
}

function buildQaStage(
  state: CourseGenerationState,
  page: PageGenerationState,
): CourseRunStage | undefined {
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
  return state.events.filter(isAgentEvent).filter(
    (event) =>
      event.traceId === state.traceId &&
      stages.includes(event.stage) &&
      (pageId === undefined || event.pageId === pageId),
  );
}

function isAgentEvent(
  event: CourseGenerationPublicEvent,
): event is AgentGenerationEvent {
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
