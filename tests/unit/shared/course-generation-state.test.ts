import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../fixtures/course-design";
import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "../../../src/shared/course-schema";

const startedAt = "2026-07-15T01:00:00.000Z";
const completedAt = "2026-07-15T01:00:05.000Z";

function createRunningState(): CourseGenerationState {
  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: "course-day-18",
    traceId: "trace-day-18",
    userPrompt: "为 8 岁儿童生成太阳系互动课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt,
    updatedAt: startedAt,
  });
}

function createCompletedState(): CourseGenerationState {
  const pageWorkerBriefs = courseDesignOutline.pages.map((page) => ({
    pageId: page.id,
    styleTemplateId: visualBrief.styleTemplateId,
    pedagogy: pedagogyPlan.pageGuidance.find(
      ({ pageId }) => pageId === page.id,
    ),
    story: storyArc.pageBeats.find(({ pageId }) => pageId === page.id),
    visual: visualBrief.pageGuidance.find(({ pageId }) => pageId === page.id),
  }));

  return CourseGenerationStateSchema.parse({
    ...createRunningState(),
    status: "completed",
    currentStage: "complete",
    intent: courseDesignIntent,
    outline: courseDesignOutline,
    briefs: {
      pedagogy: pedagogyPlan,
      story: storyArc,
      visual: visualBrief,
    },
    pageWorkerBriefs,
    pages: courseDesignOutline.pages.map((page) => ({
      pageId: page.id,
      order: page.order,
      status: "completed",
      currentStage: "complete",
      content: {
        ...pageContentDsl,
        pageId: page.id,
        functionalTemplateId: page.functionalTemplateId,
        title: page.title,
        interaction:
          page.interactionType === "navigate"
            ? {
                type: "navigate" as const,
                actionLabel: "继续学习",
                destination: "next" as const,
              }
            : pageContentDsl.interaction,
      },
      assets: [],
      htmlOutput: {
        html: `<!doctype html><html><body>${page.title}</body></html>`,
        generatedAt: completedAt,
        version: 1,
      },
    })),
    updatedAt: completedAt,
    completedAt,
    durationMs: 5_000,
  });
}

describe("Day 18 course generation state", () => {
  it("accepts a minimal running checkpoint before planning", () => {
    expect(createRunningState()).toMatchObject({
      status: "running",
      currentStage: "intent",
      pages: [],
    });
  });

  it("accepts a completed three-page course with previewable HTML", () => {
    const state = createCompletedState();

    expect(state.pages).toHaveLength(3);
    expect(state.pages.every(({ status }) => status === "completed")).toBe(
      true,
    );
  });

  it("rejects private event data while accepting public stage metadata", () => {
    const state = {
      ...createRunningState(),
      events: [
        {
          id: "event-01",
          sequence: 1,
          type: "model_call",
          traceId: "trace-day-18",
          timestamp: startedAt,
          step: 1,
          summary: "Intent Agent 已返回课程意图。",
          stage: "intent",
          agent: "intent",
          data: { systemPrompt: "private" },
        },
      ],
    };

    expect(CourseGenerationStateSchema.safeParse(state).success).toBe(false);
  });

  it("rejects completed pages without HTML output", () => {
    const state = structuredClone(createCompletedState());
    delete state.pages[0].htmlOutput;

    expect(CourseGenerationStateSchema.safeParse(state).success).toBe(false);
  });

  it("rejects a page DSL that diverges from its planned interaction", () => {
    const state = structuredClone(createCompletedState());
    state.pages[0].content = {
      ...state.pages[0].content!,
      interaction: {
        type: "none",
      },
    };

    expect(CourseGenerationStateSchema.safeParse(state).success).toBe(false);
  });

  it("rejects events that reference unknown pages", () => {
    const state = {
      ...createCompletedState(),
      events: [
        {
          id: "event-01",
          sequence: 1,
          type: "finish",
          traceId: "trace-day-18",
          timestamp: completedAt,
          step: 1,
          summary: "页面 HTML 已生成。",
          stage: "html",
          pageId: "page-does-not-exist",
          agent: "html-engineer",
        },
      ],
    };

    expect(CourseGenerationStateSchema.safeParse(state).success).toBe(false);
  });

  it("rejects an outline whose page count diverges from the intent", () => {
    const state = {
      ...createRunningState(),
      currentStage: "design",
      intent: { ...courseDesignIntent, courseLength: 4 },
      outline: courseDesignOutline,
    };

    expect(CourseGenerationStateSchema.safeParse(state).success).toBe(false);
  });
});
