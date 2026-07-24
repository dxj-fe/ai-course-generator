import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CourseRunTimeline } from "../../../src/features/keya/course-run-timeline";
import type { KeyaCourseRun } from "../../../src/types/keya";
import {
  courseDesignIntent,
  courseDesignOutline,
} from "../../fixtures/course-design";

function createRun(): KeyaCourseRun {
  return {
    id: "run-day-18",
    source: "langgraph",
    prompt: "生成太阳系课程",
    traceId: "trace-day-18",
    startedAt: 0,
    planner: {
      status: "completed",
      events: [],
      data: {
        traceId: "trace-day-18",
        intent: courseDesignIntent,
        state: {
          status: "completed",
          events: [],
          outline: courseDesignOutline,
        },
      },
    },
    design: { status: "completed", events: [] },
    pageWrites: {},
    pageAssets: {},
    pageHtml: {},
    pageQa: {},
  };
}

describe("CourseRunTimeline", () => {
  it("separates task, connection, global Agent and page progress", () => {
    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        connectionStatus="reconnecting"
        nowMs={5_000}
        run={createRun()}
        taskStatus="running"
      />,
    );

    expect(markup).toContain("生成中");
    expect(markup).toContain("正在重连");
    expect(markup).toContain("来源 · LangGraph");
    expect(markup).toContain("0 / 3");
    expect(markup).toContain("5 秒");
    expect(markup).toContain("全局 Agent");
    expect(markup).toContain("页面执行");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-live="polite"');
  });

  it("locates a page failure and exposes the checkpoint recovery action", () => {
    const run = createRun();
    const pageId = courseDesignOutline.pages[0]!.id;
    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = {
      status: "failed",
      events: [],
      error: "HTML 合同校验失败",
    };

    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        nowMs={5_000}
        onResumeCourse={() => undefined}
        run={run}
        taskStatus="failed"
      />,
    );

    expect(markup).toContain(`Workflow · ${pageId} · STAGE_FAILED`);
    expect(markup).toContain("HTML 合同校验失败");
    expect(markup).toContain("从断点继续");
    expect(markup).toContain('role="alert"');
  });

  it("does not present optional Page QA as a required Day 18 stage", () => {
    const markup = renderToStaticMarkup(<CourseRunTimeline run={createRun()} />);

    expect(markup).toContain("Page Writer");
    expect(markup).toContain("HTML Engineer");
    expect(markup).not.toContain("Page QA");
  });

  it("shows Page QA after the user starts that optional action", () => {
    const run = createRun();
    run.pageQa[courseDesignOutline.pages[0]!.id] = {
      status: "running",
      events: [],
    };

    const markup = renderToStaticMarkup(<CourseRunTimeline run={run} />);

    expect(markup).toContain("Page QA");
    expect(markup).toContain("进行中");
  });

  it("shows the latest public Supervisor decision in the existing Timeline", () => {
    const run = createRun();
    run.generation = {
      version: 1,
      courseId: "course-day-23",
      traceId: run.traceId,
      userPrompt: run.prompt,
      status: "running",
      currentStage: "intent",
      pages: [],
      events: [
        {
          id: "event-supervisor-1",
          sequence: 1,
          type: "supervisor_decision",
          traceId: run.traceId,
          timestamp: "2026-07-16T04:00:00.000Z",
          step: 0,
          summary: "课程意图尚未生成，运行 Intent Agent。（第 1 次执行）",
          stage: "intent",
          agent: "supervisor",
        },
      ],
      errors: [],
      supervisor: {
        decisionCount: 1,
        attempts: [{ nodeName: "intent", attempts: 1 }],
        lastDecision: {
          action: "run",
          nextNode: { nodeName: "intent" },
          reasonSummary: "课程意图尚未生成，运行 Intent Agent。",
        },
      },
      startedAt: "2026-07-16T04:00:00.000Z",
      updatedAt: "2026-07-16T04:00:00.000Z",
    };

    const markup = renderToStaticMarkup(<CourseRunTimeline run={run} />);

    expect(markup).toContain("Supervisor 调度");
    expect(markup).toContain("仅展示公开决策摘要");
    expect(markup).toContain("课程意图尚未生成，运行 Intent Agent。");
  });
});
