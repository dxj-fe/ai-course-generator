import { describe, expect, it } from "vitest";

import { buildCourseRunTimelineModel } from "../../../src/features/seaca/course-run-timeline-model";
import type {
  CourseGenerationPublicEvent,
  CourseGenerationState,
} from "../../../src/shared/course-schema";
import type { SeacaCourseRun } from "../../../src/types/seaca";

const pageId = "page-1";
const startedAt = "2026-07-15T01:00:00.000Z";

function createEvent(
  sequence: number,
  overrides: Partial<CourseGenerationPublicEvent> &
    Pick<CourseGenerationPublicEvent, "type" | "stage" | "traceId">,
): CourseGenerationPublicEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    timestamp: `2026-07-15T01:00:0${sequence}.000Z`,
    step: sequence,
    summary: `公开事件 ${sequence}`,
    ...overrides,
  };
}

function createGeneration(
  overrides: Partial<CourseGenerationState> = {},
): CourseGenerationState {
  return {
    version: 1,
    courseId: "course-day-20",
    traceId: "trace-current",
    userPrompt: "生成三页课程",
    status: "running",
    currentStage: "page_writer",
    currentPageId: pageId,
    pages: [
      {
        pageId,
        order: 1,
        status: "running",
        currentStage: "page_writer",
        assets: [],
      },
    ],
    events: [],
    errors: [],
    startedAt,
    updatedAt: startedAt,
    ...overrides,
  };
}

function createRun(generation: CourseGenerationState): SeacaCourseRun {
  return {
    id: "run-day-20",
    taskId: "task-day-20",
    courseId: generation.courseId,
    prompt: generation.userPrompt,
    traceId: generation.traceId,
    startedAt: Date.parse(generation.startedAt),
    generation,
    planner: { status: "completed", events: [] },
    design: { status: "completed", events: [] },
    pageWrites: { [pageId]: { status: "running", events: [] } },
    pageAssets: { [pageId]: { status: "idle", events: [] } },
    pageHtml: { [pageId]: { status: "idle", events: [] } },
    pageQa: {},
  };
}

describe("buildCourseRunTimelineModel", () => {
  it("uses the persisted task duration and keeps optional QA out of completion", () => {
    const generation = createGeneration({
      status: "completed",
      currentStage: "complete",
      currentPageId: undefined,
      completedAt: "2026-07-15T01:01:00.000Z",
      durationMs: 12_345,
      pages: [
        {
          pageId,
          order: 1,
          status: "completed",
          currentStage: "complete",
          assets: [],
        },
      ],
    });
    const run = createRun(generation);
    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = { status: "completed", events: [] };

    const model = buildCourseRunTimelineModel(run, {
      taskStatus: "completed",
      connectionStatus: "closed",
      nowMs: Date.parse("2026-07-15T02:00:00.000Z"),
    });

    expect(model.task).toMatchObject({
      status: "completed",
      connectionStatus: "closed",
      completedPages: 1,
      totalPages: 1,
      durationMs: 12_345,
    });
    expect(model.pages[0]).toMatchObject({
      status: "completed",
      completed: true,
      stages: { qa: undefined },
    });
  });

  it("falls back to the completed timestamp when no task duration was persisted", () => {
    const generation = createGeneration({
      status: "failed",
      currentStage: "planner",
      currentPageId: undefined,
      completedAt: "2026-07-15T01:00:09.000Z",
    });

    const model = buildCourseRunTimelineModel(createRun(generation), {
      nowMs: Date.parse("2026-07-15T02:00:00.000Z"),
    });

    expect(model.task.durationMs).toBe(9_000);
  });

  it("derives task recovery from distinct traces even when no stage repeats", () => {
    const generation = createGeneration({
      currentStage: "planner",
      currentPageId: undefined,
      events: [
        createEvent(1, {
          type: "agent_start",
          stage: "intent",
          traceId: "trace-original",
          agent: "intent",
        }),
        createEvent(2, {
          type: "agent_done",
          stage: "intent",
          traceId: "trace-original",
          agent: "intent",
        }),
        createEvent(3, {
          type: "agent_start",
          stage: "planner",
          traceId: "trace-current",
          agent: "planner",
        }),
      ],
    });
    const run = createRun(generation);

    const model = buildCourseRunTimelineModel(run, {
      nowMs: Date.parse("2026-07-15T01:00:08.000Z"),
    });

    expect(model.task.resumed).toBe(true);
    expect(model.globalStages.find(({ id }) => id === "intent")).toMatchObject({
      attemptCount: 1,
      resumed: false,
    });
    expect(model.globalStages.find(({ id }) => id === "planner")).toMatchObject({
      attemptCount: 1,
      resumed: false,
      durationMs: 5_000,
    });
  });

  it("projects only public Supervisor decision events", () => {
    const generation = createGeneration({
      events: [
        createEvent(1, {
          type: "supervisor_decision",
          stage: "page_writer",
          pageId,
          traceId: "trace-current",
          agent: "supervisor",
          summary: "页面输入已就绪，运行 Page Writer。（第 1 次执行）",
        }),
      ],
    });

    expect(
      buildCourseRunTimelineModel(createRun(generation)).supervisorDecisions,
    ).toEqual([
      expect.objectContaining({
        sequence: 1,
        stage: "page_writer",
        pageId,
        summary: "页面输入已就绪，运行 Page Writer。（第 1 次执行）",
      }),
    ]);
  });

  it("projects Repair attempts as a page stage without exposing candidate data", () => {
    const generation = createGeneration({
      currentStage: "repair",
      pages: [
        {
          pageId,
          order: 1,
          status: "running",
          currentStage: "repair",
          assets: [],
        },
      ],
      events: [
        createEvent(1, {
          type: "repair_attempt",
          stage: "repair",
          pageId,
          traceId: "trace-current",
          agent: "repair-agent",
          summary: "第 1 轮 Repair 开始：定向修复 HTML。",
        }),
      ],
    });
    const run = createRun(generation);
    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = { status: "completed", events: [] };

    expect(
      buildCourseRunTimelineModel(run).pages[0]?.stages.repair,
    ).toMatchObject({
      agent: "repair-agent",
      label: "Repair / re-QA",
      status: "running",
      summaries: ["第 1 轮 Repair 开始：定向修复 HTML。"],
    });
  });

  it("counts attempts by trace and times the latest attempt from its earliest duplicate start", () => {
    const events = [
      createEvent(1, {
        type: "agent_start",
        stage: "page_writer",
        pageId,
        traceId: "trace-original",
        agent: "page-writer",
        summary: "第一次开始",
      }),
      createEvent(2, {
        type: "error",
        stage: "page_writer",
        pageId,
        traceId: "trace-original",
        summary: "第一次失败",
      }),
      createEvent(3, {
        type: "agent_start",
        stage: "page_writer",
        pageId,
        traceId: "trace-current",
        agent: "page-writer",
        summary: "恢复后开始",
      }),
      createEvent(4, {
        type: "agent_start",
        stage: "page_writer",
        pageId,
        traceId: "trace-current",
        agent: "page-writer",
        summary: "同一 trace 的重复边界",
      }),
      createEvent(6, {
        type: "agent_done",
        stage: "page_writer",
        pageId,
        traceId: "trace-current",
        agent: "page-writer",
        summary: "恢复后完成",
      }),
    ];
    const generation = createGeneration({ events });
    const run = createRun(generation);
    run.pageWrites[pageId] = { status: "completed", events: [] };

    const writer = buildCourseRunTimelineModel(run).pages[0]!.stages.writer;

    expect(writer).toMatchObject({
      attemptCount: 2,
      resumed: true,
      durationMs: 3_000,
      summaries: [
        "恢复后开始",
        "同一 trace 的重复边界",
        "恢复后完成",
      ],
    });
  });

  it("locates a failure through the nearest matching Agent start", () => {
    const generation = createGeneration({
      status: "failed",
      currentStage: "html",
      events: [
        createEvent(1, {
          type: "agent_start",
          stage: "html",
          pageId,
          traceId: "trace-current",
          agent: "html-engineer",
        }),
        createEvent(2, {
          type: "error",
          stage: "html",
          pageId,
          traceId: "trace-current",
          summary: "HTML 合同校验失败",
        }),
      ],
      errors: [
        {
          stage: "html",
          pageId,
          code: "HTML_CONTRACT_INVALID",
          message: "HTML 合同校验失败",
        },
      ],
    });
    const run = createRun(generation);
    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = {
      status: "failed",
      events: [],
      error: "HTML 合同校验失败",
    };

    const html = buildCourseRunTimelineModel(run).pages[0]!.stages.html;

    expect(html.error).toEqual({
      agent: "html-engineer",
      code: "HTML_CONTRACT_INVALID",
      message: "HTML 合同校验失败",
      stage: "html",
      pageId,
    });
    expect(html.durationMs).toBe(1_000);
    expect(buildCourseRunTimelineModel(run).task.currentAgent).toBe(
      "html-engineer",
    );

    const withoutStart = createGeneration({
      status: "failed",
      currentStage: "html",
      events: [
        createEvent(1, {
          type: "error",
          stage: "html",
          pageId,
          traceId: "trace-current",
          summary: "HTML 合同校验失败",
        }),
      ],
      errors: generation.errors,
    });
    const withoutStartRun = createRun(withoutStart);
    withoutStartRun.pageHtml[pageId] = {
      status: "failed",
      events: [],
      error: "HTML 合同校验失败",
    };

    expect(
      buildCourseRunTimelineModel(withoutStartRun).pages[0]!.stages.html.error
        ?.agent,
    ).toBe("Workflow");
  });

  it("does not let a failed optional QA stage block a completed page", () => {
    const generation = createGeneration();
    const run = createRun(generation);
    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = { status: "completed", events: [] };
    run.pageQa[pageId] = {
      status: "failed",
      events: [],
      error: "QA 服务暂不可用",
    };

    const page = buildCourseRunTimelineModel(run).pages[0]!;

    expect(page).toMatchObject({ status: "completed", completed: true });
    expect(page.stages.qa).toMatchObject({
      status: "failed",
      optional: true,
      error: { agent: "Workflow", message: "QA 服务暂不可用" },
    });
  });
});
