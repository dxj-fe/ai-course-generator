import { describe, expect, it } from "vitest";

import { createCourseArchive } from "../../../../src/server/courses/course-export";
import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "../../../../src/shared/course-schema";

describe("course export", () => {
  it("rejects an unfinished course", () => {
    expect(() => createCourseArchive(runningState())).toThrow(
      "课程尚未完成",
    );
  });

  it("creates a ZIP with course JSON, ordered page HTML, and asset manifest", async () => {
    const archive = createCourseArchive(completedState());
    const bytes = new Uint8Array(await new Response(archive.stream).arrayBuffer());
    const searchable = new TextDecoder("latin1").decode(bytes);

    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(searchable).toContain("course.json");
    expect(searchable).toContain("pages/01-page-01-cover.html");
    expect(searchable).toContain("assets/manifest.json");
    expect(archive.fileName).toBe("course-day-34-export.zip");
  });
});

function runningState(): CourseGenerationState {
  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: "course-day-34-export",
    traceId: "trace-day-34-export",
    userPrompt: "生成太阳系课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: "2026-07-22T03:00:00.000Z",
    updatedAt: "2026-07-22T03:00:00.000Z",
  });
}

function completedState() {
  const completedAt = "2026-07-22T03:05:00.000Z";
  return CourseGenerationStateSchema.parse({
    ...runningState(),
    status: "completed",
    currentStage: "complete",
    intent: courseDesignIntent,
    outline: courseDesignOutline,
    briefs: { pedagogy: pedagogyPlan, story: storyArc, visual: visualBrief },
    pageWorkerBriefs: courseDesignOutline.pages.map((page, index) => ({
      pageId: page.id,
      styleTemplateId: visualBrief.styleTemplateId,
      pedagogy: pedagogyPlan.pageGuidance[index],
      story: storyArc.pageBeats[index],
      visual: visualBrief.pageGuidance[index],
    })),
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
            ? { type: "navigate", actionLabel: "继续学习", destination: "next" }
            : pageContentDsl.interaction,
      },
      assets: [],
      htmlOutput: {
        version: 1,
        html: `<!doctype html><html><body>${page.title}</body></html>`,
        generatedAt: completedAt,
      },
    })),
    updatedAt: completedAt,
    completedAt,
    durationMs: 300_000,
  });
}
