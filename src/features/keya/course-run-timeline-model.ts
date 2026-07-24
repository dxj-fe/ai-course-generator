import type {
  CourseGenerationError,
  CourseGenerationStage,
  CourseTaskRuntimeSource,
  CourseTaskStatus,
} from "@/shared/course-schema";
import type {
  CourseRunStage,
  CourseRunStageStatus,
  KeyaCourseRun,
} from "@/types/keya";

export type CourseRunTimelineConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export type CourseRunTimelineStageKind = CourseGenerationStage | "qa";

export type CourseRunTimelineError = {
  agent: string;
  code: string;
  message: string;
  stage: CourseRunTimelineStageKind;
  pageId?: string;
};

export type CourseRunTimelineStage = {
  id: string;
  label: string;
  agent: string;
  stage: CourseRunTimelineStageKind;
  status: CourseRunStageStatus;
  summaries: string[];
  durationMs?: number;
  attemptCount: number;
  resumed: boolean;
  optional?: boolean;
  pageId?: string;
  error?: CourseRunTimelineError;
};

export type CourseRunTimelinePage = {
  pageId: string;
  order: number;
  title?: string;
  status: CourseRunStageStatus;
  completed: boolean;
  stages: {
    writer: CourseRunTimelineStage;
    assets: CourseRunTimelineStage;
    html: CourseRunTimelineStage;
    qa?: CourseRunTimelineStage;
    repair?: CourseRunTimelineStage;
  };
};

export type CourseRunTimelineTaskSummary = {
  id: string;
  taskId?: string;
  courseId?: string;
  traceId: string;
  source: CourseTaskRuntimeSource;
  status: CourseTaskStatus;
  connectionStatus: CourseRunTimelineConnectionStatus;
  completedPages: number;
  totalPages: number;
  currentPageId?: string;
  currentStageId?: string;
  currentAgent?: string;
  durationMs: number;
  resumed: boolean;
};

export type CourseRunTimelineSupervisorDecision = {
  id: string;
  sequence: number;
  summary: string;
  stage: CourseGenerationStage;
  pageId?: string;
  timestamp: string;
};

export type CourseRunTimelineModel = {
  task: CourseRunTimelineTaskSummary;
  supervisorDecisions: CourseRunTimelineSupervisorDecision[];
  globalStages: CourseRunTimelineStage[];
  pages: CourseRunTimelinePage[];
};

export type BuildCourseRunTimelineModelOptions = {
  taskStatus?: CourseTaskStatus;
  connectionStatus?: CourseRunTimelineConnectionStatus;
  nowMs?: number;
};

type StageDefinition = {
  id: string;
  label: string;
  agent: string;
  stage: CourseRunTimelineStageKind;
  pageId?: string;
  optional?: boolean;
};

type AttemptMetadata = {
  attemptCount: number;
  resumed: boolean;
  durationMs?: number;
};

/**
 * 把持久化任务状态投影成 Timeline 所需的只读模型。
 * 业务阶段仍以服务端 checkpoint 为准，这里只派生展示分组、耗时和恢复提示。
 */
export function buildCourseRunTimelineModel(
  run: KeyaCourseRun,
  options: BuildCourseRunTimelineModelOptions = {},
): CourseRunTimelineModel {
  const nowMs = options.nowMs ?? Date.now();
  const globalStages = buildGlobalStages(run, nowMs);
  const pages = buildPages(run, nowMs);
  const allStages = [
    ...globalStages,
    ...pages.flatMap(({ stages }) => [
      stages.writer,
      stages.assets,
      stages.html,
      ...(stages.qa ? [stages.qa] : []),
      ...(stages.repair ? [stages.repair] : []),
    ]),
  ];
  const activeStage = allStages.find(({ status }) => status === "running");
  const currentStage =
    activeStage ??
    allStages.find(
      ({ pageId, stage }) =>
        stage === run.generation?.currentStage &&
        pageId === run.generation.currentPageId,
    );
  const completedPages = pages.filter(({ completed }) => completed).length;

  return {
    task: {
      id: run.id,
      taskId: run.taskId,
      courseId: run.courseId,
      traceId: run.traceId,
      source: run.source ?? "workflow",
      status: options.taskStatus ?? deriveTaskStatus(run, pages),
      connectionStatus: options.connectionStatus ?? "idle",
      completedPages,
      totalPages: pages.length,
      currentPageId: run.generation?.currentPageId ?? activeStage?.pageId,
      currentStageId: currentStage?.id,
      currentAgent: currentStage?.error?.agent ?? currentStage?.agent,
      durationMs: taskDuration(run, nowMs),
      resumed: taskWasResumed(run),
    },
    supervisorDecisions:
      run.generation?.events
        .filter(({ type }) => type === "supervisor_decision")
        .map(({ id, sequence, summary, stage, pageId, timestamp }) => ({
          id,
          sequence,
          summary,
          stage,
          pageId,
          timestamp,
        })) ?? [],
    globalStages,
    pages,
  };
}

function buildGlobalStages(run: KeyaCourseRun, nowMs: number) {
  const definitions: Array<
    StageDefinition & {
      status: CourseRunStageStatus;
      fallbackError?: string;
      fallbackSummaries: string[];
    }
  > = [
    {
      id: "intent",
      label: "理解课程需求",
      agent: "intent",
      stage: "intent",
      status: generationStageStatus(run, "intent", Boolean(run.generation?.intent)),
      fallbackError: run.planner.error,
      fallbackSummaries: [],
    },
    {
      id: "planner",
      label: "规划课程结构",
      agent: "planner",
      stage: "planner",
      status: generationStageStatus(
        run,
        "planner",
        Boolean(run.generation?.outline),
      ),
      fallbackError: run.planner.error,
      fallbackSummaries: run.planner.events.map(({ summary }) => summary),
    },
    {
      id: "design",
      label: "教学、故事与视觉设计",
      agent: "course-design",
      stage: "design",
      status: run.generation
        ? generationStageStatus(
            run,
            "design",
            Boolean(run.generation.briefs && run.generation.pageWorkerBriefs),
          )
        : run.design.status,
      fallbackError: run.design.error,
      fallbackSummaries: run.design.events.map(({ summary }) => summary),
    },
  ];

  return definitions.map(
    ({ status, fallbackError, fallbackSummaries, ...definition }) =>
      buildStage(
        run,
        definition,
        status,
        nowMs,
        fallbackError,
        undefined,
        fallbackSummaries,
      ),
  );
}

function buildPages(run: KeyaCourseRun, nowMs: number) {
  const outline = run.generation?.outline ?? run.planner.data?.state.outline;
  const outlinePages = outline?.pages ?? [];
  const pageIds = [
    ...outlinePages.map(({ id }) => id),
    ...(run.generation?.pages.map(({ pageId }) => pageId) ?? []),
    ...Object.keys(run.pageWrites),
    ...Object.keys(run.pageAssets),
    ...Object.keys(run.pageHtml),
    ...Object.keys(run.pageQa),
  ].filter((pageId, index, values) => values.indexOf(pageId) === index);

  return pageIds.map((pageId, index): CourseRunTimelinePage => {
    const plan = outlinePages.find(({ id }) => id === pageId);
    const writer = buildPageStage(
      run,
      {
        id: `page-writer-${pageId}`,
        label: "Page Writer",
        agent: "page-writer",
        stage: "page_writer",
        pageId,
      },
      run.pageWrites[pageId],
      nowMs,
    );
    const assets = buildPageStage(
      run,
      {
        id: `image-assets-${pageId}`,
        label: "Image Assets",
        agent: "image-assets",
        stage: "assets",
        pageId,
      },
      run.pageAssets[pageId],
      nowMs,
    );
    const html = buildPageStage(
      run,
      {
        id: `html-engineer-${pageId}`,
        label: "HTML Engineer",
        agent: "html-engineer",
        stage: "html",
        pageId,
      },
      run.pageHtml[pageId],
      nowMs,
    );
    const qaStage = run.pageQa[pageId];
    const qa = qaStage
      ? buildPageStage(
          run,
          {
            id: `page-qa-${pageId}`,
            label: "Page QA",
            agent: "page-qa",
            stage: "qa",
            pageId,
            optional: !Boolean(run.generation?.workerConfig),
          },
          qaStage,
          nowMs,
        )
      : undefined;
    const pageState = run.generation?.pages.find(
      (candidate) => candidate.pageId === pageId,
    );
    const repairEvents =
      run.generation?.events.filter(
        (event) => event.stage === "repair" && event.pageId === pageId,
      ) ?? [];
    const repairError = run.generation?.errors.find(
      (error) => error.stage === "repair" && error.pageId === pageId,
    );
    const hasRepair = Boolean(
      pageState?.repairHistory?.length ||
        repairEvents.length ||
        repairError ||
        pageState?.currentStage === "repair",
    );
    const repair = hasRepair
      ? buildStage(
          run,
          {
            id: `repair-${pageId}`,
            label: "Repair / re-QA",
            agent: "repair-agent",
            stage: "repair",
            pageId,
          },
          repairError
            ? "failed"
            : pageState?.currentStage === "repair" &&
                pageState.status === "running"
              ? "running"
              : pageState?.repairHistory?.some(
                    ({ status }) => status === "applied",
                  )
                ? "completed"
                : "idle",
          nowMs,
        )
      : undefined;
    const requiredStages = [
      writer,
      assets,
      html,
      ...(run.generation?.workerConfig && qa ? [qa] : []),
      ...(repair ? [repair] : []),
    ];
    const completed = requiredStages.every(
      ({ status }) => status === "completed",
    );

    return {
      pageId,
      order: plan?.order ?? index + 1,
      title: plan?.title,
      status: completed
        ? "completed"
        : requiredStages.some(({ status }) => status === "failed")
          ? "failed"
          : requiredStages.some(({ status }) => status === "running")
            ? "running"
            : "idle",
      completed,
      stages: { writer, assets, html, qa, repair },
    };
  });
}

function buildPageStage(
  run: KeyaCourseRun,
  definition: StageDefinition,
  source: CourseRunStage<unknown> | undefined,
  nowMs: number,
) {
  const status = source?.status ?? "idle";
  const responseError = getResponseError(source);

  return buildStage(
    run,
    definition,
    status,
    nowMs,
    source?.error ?? responseError?.message,
    responseError?.code,
    source?.events.map(({ summary }) => summary),
  );
}

function buildStage(
  run: KeyaCourseRun,
  definition: StageDefinition,
  status: CourseRunStageStatus,
  nowMs: number,
  fallbackError?: string,
  fallbackErrorCode?: string,
  fallbackSummaries: string[] = [],
): CourseRunTimelineStage {
  const attempt = attemptMetadata(run, definition, status, nowMs);
  const generationError = findGenerationError(run, definition);
  const error = generationError
    ? {
        agent: findFailureAgent(run, definition),
        code: generationError.code,
        message: generationError.message,
        stage: definition.stage,
        pageId: definition.pageId,
      }
    : fallbackError
      ? {
          agent: "Workflow",
          code: fallbackErrorCode ?? "STAGE_FAILED",
          message: fallbackError,
          stage: definition.stage,
          pageId: definition.pageId,
        }
      : undefined;

  return {
    ...definition,
    status,
    summaries: stageSummaries(run, definition, fallbackSummaries),
    durationMs: attempt.durationMs,
    attemptCount: attempt.attemptCount,
    resumed: attempt.resumed,
    error,
  };
}

function stageSummaries(
  run: KeyaCourseRun,
  definition: StageDefinition,
  fallbackSummaries: string[],
) {
  if (!run.generation) {
    return fallbackSummaries;
  }

  const scopedEvents = run.generation.events.filter(
    (event) =>
      event.traceId === run.generation?.traceId &&
      event.stage === definition.stage &&
      event.pageId === definition.pageId,
  );
  const focusedEvents = scopedEvents.filter(
    (event) =>
      event.agent === definition.agent ||
      event.type === "error" ||
      event.type === "page_done",
  );

  return (focusedEvents.length > 0 ? focusedEvents : scopedEvents).map(
    ({ summary }) => summary,
  );
}

function generationStageStatus(
  run: KeyaCourseRun,
  stage: CourseGenerationStage,
  completed: boolean,
): CourseRunStageStatus {
  const generation = run.generation;

  if (!generation) {
    return stage === "design" ? run.design.status : run.planner.status;
  }
  if (completed) return "completed";
  if (generation.errors.some((error) => error.stage === stage)) return "failed";
  if (generation.status === "running" && generation.currentStage === stage) {
    return "running";
  }
  return "idle";
}

function attemptMetadata(
  run: KeyaCourseRun,
  definition: StageDefinition,
  status: CourseRunStageStatus,
  nowMs: number,
): AttemptMetadata {
  if (!run.generation) {
    return { attemptCount: 0, resumed: false };
  }

  const events = run.generation.events;
  const starts = events.filter(
    (event) =>
      event.type === "agent_start" &&
      event.stage === definition.stage &&
      event.pageId === definition.pageId &&
      event.agent === definition.agent,
  );
  const traces = [...new Set(starts.map(({ traceId }) => traceId))];
  const latestStart = starts.at(-1);

  if (!latestStart) {
    return { attemptCount: 0, resumed: false };
  }

  const attemptStarts = starts.filter(
    ({ traceId }) => traceId === latestStart.traceId,
  );
  const firstStart = attemptStarts[0]!;
  const terminal = events
    .filter(
      (event) =>
        event.sequence >= firstStart.sequence &&
        event.traceId === firstStart.traceId &&
        event.stage === definition.stage &&
        event.pageId === definition.pageId &&
        ((event.type === "agent_done" && event.agent === definition.agent) ||
          (event.type === "error" &&
            (!event.agent || event.agent === definition.agent))),
    )
    .at(-1);
  const startedAt = parseTime(firstStart.timestamp);
  const endedAt = terminal
    ? parseTime(terminal.timestamp)
    : status === "running"
      ? nowMs
      : undefined;

  return {
    attemptCount: traces.length,
    resumed: traces.length > 1,
    durationMs:
      startedAt === undefined || endedAt === undefined
        ? undefined
        : Math.max(0, endedAt - startedAt),
  };
}

function findGenerationError(
  run: KeyaCourseRun,
  definition: StageDefinition,
): CourseGenerationError | undefined {
  return run.generation?.errors
    .filter(
      (error) =>
        error.stage === definition.stage && error.pageId === definition.pageId,
    )
    .at(-1);
}

function findFailureAgent(run: KeyaCourseRun, definition: StageDefinition) {
  if (!run.generation) return "Workflow";

  const events = run.generation.events;
  const errorEvent = events
    .filter(
      (event) =>
        event.type === "error" &&
        event.stage === definition.stage &&
        event.pageId === definition.pageId,
    )
    .at(-1);

  if (errorEvent?.agent) return errorEvent.agent;

  return (
    events
      .filter(
        (event) =>
          event.type === "agent_start" &&
          event.stage === definition.stage &&
          event.pageId === definition.pageId &&
          event.traceId === (errorEvent?.traceId ?? run.generation?.traceId) &&
          (!errorEvent || event.sequence <= errorEvent.sequence),
      )
      .at(-1)?.agent ?? "Workflow"
  );
}

function getResponseError(source: CourseRunStage<unknown> | undefined) {
  const data = source?.data;

  if (!data || typeof data !== "object" || !("state" in data)) return undefined;
  const state = data.state;
  if (!state || typeof state !== "object" || !("error" in state)) {
    return undefined;
  }
  const error = state.error;

  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    !("message" in error) ||
    typeof error.code !== "string" ||
    typeof error.message !== "string"
  ) {
    return undefined;
  }

  return { code: error.code, message: error.message };
}

function deriveTaskStatus(
  run: KeyaCourseRun,
  pages: CourseRunTimelinePage[],
): CourseTaskStatus {
  if (run.generation) return run.generation.status;
  const requiredStatuses = [
    run.planner.status,
    run.design.status,
    ...pages.flatMap(({ stages }) => [
      stages.writer.status,
      stages.assets.status,
      stages.html.status,
    ]),
  ];

  if (requiredStatuses.some((status) => status === "failed")) return "failed";
  if (requiredStatuses.some((status) => status === "running")) return "running";
  if (
    requiredStatuses.length > 2 &&
    requiredStatuses.every((status) => status === "completed")
  ) {
    return "completed";
  }
  return "queued";
}

function taskDuration(run: KeyaCourseRun, nowMs: number) {
  const generation = run.generation;

  if (generation?.durationMs !== undefined) return generation.durationMs;

  const startedAt = generation
    ? parseTime(generation.startedAt) ?? run.startedAt
    : run.startedAt;
  const completedAt = generation?.completedAt
    ? parseTime(generation.completedAt)
    : undefined;

  return Math.max(0, (completedAt ?? nowMs) - startedAt);
}

function taskWasResumed(run: KeyaCourseRun) {
  if (!run.generation) return false;
  return new Set(run.generation.events.map(({ traceId }) => traceId)).size > 1;
}

function parseTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
