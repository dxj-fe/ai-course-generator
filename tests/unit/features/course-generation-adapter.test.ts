import { describe, expect, it } from "vitest";

import { courseGenerationToSeacaRun } from "../../../src/features/course-planner/lib/course-generation-adapter";
import type { CourseGenerationResponse } from "../../../src/features/course-planner/lib/course-planner-api";
import { CourseGenerationStateSchema } from "../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../fixtures/course-design";

describe("course generation adapter", () => {
  it("maps the current batch attempt into existing Seaca stages", () => {
    const state = CourseGenerationStateSchema.parse({
      version: 1,
      courseId: "course-123e4567-e89b-42d3-a456-426614174000",
      traceId: "trace-current",
      userPrompt: "生成三页太阳系课程",
      status: "failed",
      currentStage: "design",
      intent: courseDesignIntent,
      outline: courseDesignOutline,
      pages: [],
      events: [
        {
          id: "event-old",
          sequence: 1,
          type: "validation",
          traceId: "trace-old",
          timestamp: "2026-07-15T01:00:00.000Z",
          step: 1,
          summary: "旧尝试不应进入当前 UI",
          stage: "design",
          agent: "visual",
        },
        {
          id: "event-design-start",
          sequence: 2,
          type: "agent_start",
          traceId: "trace-current",
          timestamp: "2026-07-15T01:59:59.000Z",
          step: 0,
          summary: "课程专业设计工作流已开始。",
          stage: "design",
          agent: "course-design",
        },
        {
          id: "event-current",
          sequence: 3,
          type: "error",
          traceId: "trace-current",
          timestamp: "2026-07-15T02:00:00.000Z",
          step: 1,
          summary: "Visual Agent failed",
          stage: "design",
          agent: "visual",
        },
      ],
      errors: [
        {
          stage: "design",
          code: "COURSE_DESIGN_FAILED",
          message: "Visual Agent failed",
        },
      ],
      startedAt: "2026-07-15T01:00:00.000Z",
      updatedAt: "2026-07-15T02:00:00.000Z",
      completedAt: "2026-07-15T02:00:00.000Z",
      durationMs: 3_600_000,
    });
    const response: CourseGenerationResponse = {
      courseId: state.courseId,
      traceId: state.traceId,
      state,
    };

    const run = courseGenerationToSeacaRun(response, {
      id: "run-1",
      prompt: state.userPrompt,
      startedAt: Date.parse(state.startedAt),
    });

    expect(run.planner.status).toBe("completed");
    expect(run.design.status).toBe("failed");
    expect(run.design.error).toBe("Visual Agent failed");
    expect(run.design.events.map(({ summary }) => summary)).toEqual([
      "课程专业设计工作流已开始。",
      "Visual Agent failed",
    ]);
    expect(
      run.design.data?.state.events.map(({ summary }) => summary),
    ).toEqual(["Visual Agent failed"]);
    expect(run.courseId).toBe(state.courseId);
    expect(run.generation).toBe(state);
  });

  it("maps the persisted current stage to a live Seaca running stage", () => {
    const state = CourseGenerationStateSchema.parse({
      version: 1,
      courseId: "course-123e4567-e89b-42d3-a456-426614174001",
      traceId: "trace-stream",
      userPrompt: "生成三页太阳系课程",
      status: "running",
      currentStage: "page_writer",
      currentPageId: courseDesignOutline.pages[0].id,
      intent: courseDesignIntent,
      outline: courseDesignOutline,
      briefs: {
        pedagogy: pedagogyPlan,
        story: storyArc,
        visual: visualBrief,
      },
      pageWorkerBriefs: courseDesignOutline.pages.map((page) => ({
        pageId: page.id,
        styleTemplateId: visualBrief.styleTemplateId,
        pedagogy: pedagogyPlan.pageGuidance.find(
          ({ pageId }) => pageId === page.id,
        )!,
        story: storyArc.pageBeats.find(({ pageId }) => pageId === page.id)!,
        visual: visualBrief.pageGuidance.find(
          ({ pageId }) => pageId === page.id,
        )!,
      })),
      pages: courseDesignOutline.pages.map((page, index) => ({
        pageId: page.id,
        order: page.order,
        status: index === 0 ? "running" : "pending",
        currentStage: "page_writer",
        assets: [],
      })),
      events: [
        {
          id: "event-page-writer-start",
          sequence: 1,
          type: "agent_start",
          traceId: "trace-stream",
          timestamp: "2026-07-15T01:00:01.000Z",
          step: 0,
          summary: "Page Writer 已开始生成第一页内容。",
          stage: "page_writer",
          pageId: courseDesignOutline.pages[0].id,
          agent: "page-writer",
        },
      ],
      errors: [],
      startedAt: "2026-07-15T01:00:00.000Z",
      updatedAt: "2026-07-15T01:00:01.000Z",
    });
    const response: CourseGenerationResponse = {
      courseId: state.courseId,
      traceId: state.traceId,
      state,
    };

    const run = courseGenerationToSeacaRun(response, {
      id: "run-stream",
      taskId: "task-stream",
      prompt: state.userPrompt,
      startedAt: Date.parse(state.startedAt),
    });

    expect(run.taskId).toBe("task-stream");
    expect(run.planner.status).toBe("completed");
    expect(run.design.status).toBe("completed");
    expect(run.pageWrites[courseDesignOutline.pages[0].id]?.status).toBe(
      "running",
    );
    expect(run.pageWrites[courseDesignOutline.pages[1].id]?.status).toBe(
      "idle",
    );

    const doneState = CourseGenerationStateSchema.parse({
      ...state,
      events: [
        {
          ...state.events[0],
          id: "event-page-writer-done",
          type: "agent_done",
          summary: "第一页 PageContentDSL 已生成。",
        },
      ],
    });
    const doneRun = courseGenerationToSeacaRun(
      {
        courseId: doneState.courseId,
        traceId: doneState.traceId,
        state: doneState,
      },
      {
        id: "run-stream",
        taskId: "task-stream",
        prompt: doneState.userPrompt,
        startedAt: Date.parse(doneState.startedAt),
      },
    );

    expect(doneRun.pageWrites[courseDesignOutline.pages[0].id]?.status).toBe(
      "completed",
    );

    const errorState = CourseGenerationStateSchema.parse({
      ...state,
      events: [
        state.events[0],
        {
          ...state.events[0],
          id: "event-page-writer-error",
          sequence: 2,
          type: "error",
          summary: "Page Writer 生成失败。",
        },
      ],
    });
    const errorRun = courseGenerationToSeacaRun(
      {
        courseId: errorState.courseId,
        traceId: errorState.traceId,
        state: errorState,
      },
      {
        id: "run-stream",
        taskId: "task-stream",
        prompt: errorState.userPrompt,
        startedAt: Date.parse(errorState.startedAt),
      },
    );

    expect(errorRun.pageWrites[courseDesignOutline.pages[0].id]?.status).toBe(
      "failed",
    );
  });

  it("derives concurrent page stages from each worker-local state", () => {
    const firstPageId = courseDesignOutline.pages[0].id;
    const secondPageId = courseDesignOutline.pages[1].id;
    const state = CourseGenerationStateSchema.parse({
      version: 1,
      courseId: "course-123e4567-e89b-42d3-a456-426614174002",
      traceId: "trace-workers",
      userPrompt: "并行生成太阳系课程",
      status: "running",
      currentStage: "qa",
      currentPageId: secondPageId,
      workerConfig: { mode: "parallel", concurrency: 2 },
      intent: courseDesignIntent,
      outline: courseDesignOutline,
      briefs: {
        pedagogy: pedagogyPlan,
        story: storyArc,
        visual: visualBrief,
      },
      pageWorkerBriefs: courseDesignOutline.pages.map((page, index) => ({
        pageId: page.id,
        styleTemplateId: page.styleTemplateId,
        pedagogy: pedagogyPlan.pageGuidance[index]!,
        story: storyArc.pageBeats[index]!,
        visual: visualBrief.pageGuidance[index]!,
      })),
      pages: courseDesignOutline.pages.map((page, index) => ({
        pageId: page.id,
        order: page.order,
        status: index < 2 ? "running" : "pending",
        currentStage:
          index === 0 ? "page_writer" : index === 1 ? "qa" : "page_writer",
        assets: [],
      })),
      events: [
        {
          id: "event-writer-active",
          sequence: 1,
          type: "agent_start",
          traceId: "trace-workers",
          timestamp: "2026-07-16T08:00:00.000Z",
          step: 0,
          summary: "第一页 Writer 运行中。",
          stage: "page_writer",
          pageId: firstPageId,
          agent: "page-writer",
        },
        {
          id: "event-qa-active",
          sequence: 2,
          type: "agent_start",
          traceId: "trace-workers",
          timestamp: "2026-07-16T08:00:01.000Z",
          step: 0,
          summary: "第二页 QA 运行中。",
          stage: "qa",
          pageId: secondPageId,
          agent: "page-qa",
        },
      ],
      errors: [],
      startedAt: "2026-07-16T08:00:00.000Z",
      updatedAt: "2026-07-16T08:00:01.000Z",
    });

    const run = courseGenerationToSeacaRun(
      { courseId: state.courseId, traceId: state.traceId, state },
      {
        id: "run-workers",
        prompt: state.userPrompt,
        startedAt: Date.parse(state.startedAt),
      },
    );

    expect(run.pageWrites[firstPageId]?.status).toBe("running");
    expect(run.pageQa[secondPageId]?.status).toBe("running");
  });
});
