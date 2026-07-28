import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createCourseCreationBrief } from "../../../src/features/keya/course-creation-model";
import { CourseWorkspacePanel } from "../../../src/features/keya/course-workspace-panel";
import type { KeyaCourseRun } from "../../../src/types/keya";
import {
  courseDesignIntent,
  courseDesignOutline,
} from "../../fixtures/course-design";

function failedRun(): KeyaCourseRun {
  return {
    id: "run-failed",
    prompt: "生成前端面试课程",
    traceId: "trace-private",
    startedAt: 0,
    generation: {
      version: 1,
      courseId: "course-failed-run",
      traceId: "trace-private",
      userPrompt: "生成前端面试课程",
      status: "failed",
      currentStage: "page_writer",
      pages: [],
      events: [],
      errors: [
        {
          stage: "page_writer",
          code: "PAGE_WORKER_RETRY_EXHAUSTED",
          causeCode: "QUOTA_ERROR",
          message: "provider raw billing response",
        },
      ],
      startedAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:01:00.000Z",
    },
    planner: { status: "failed", events: [] },
    design: { status: "idle", events: [] },
    pageWrites: {},
    pageAssets: {},
    pageHtml: {},
    pageQa: {},
  };
}

function readyRun(): KeyaCourseRun {
  const firstPage = courseDesignOutline.pages[0]!;
  return {
    id: "run-ready",
    prompt: "生成太阳系课程",
    traceId: "trace-ready",
    startedAt: 0,
    planner: {
      status: "completed",
      events: [],
      data: {
        traceId: "trace-ready",
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
    pageHtml: {
      [firstPage.id]: {
        status: "completed",
        events: [],
        data: {
          traceId: "trace-ready",
          state: {
            status: "completed",
            events: [],
            htmlOutput: {
              html: `<main>${firstPage.title}</main>`,
              generatedAt: "2026-07-24T08:00:00.000Z",
              version: 1,
            },
          },
        },
      },
    },
    pageQa: {},
  };
}

function partiallyFailedRun(
  generationStatus: "running" | "failed",
): KeyaCourseRun {
  const [completedPage, failedPage, remainingPage] =
    courseDesignOutline.pages;
  if (!completedPage || !failedPage || !remainingPage) {
    throw new Error("course design fixture must contain three pages");
  }
  const generatedAt = "2026-07-24T08:00:00.000Z";
  const completedState = (page: typeof completedPage) => ({
    pageId: page.id,
    order: page.order,
    status: "completed" as const,
    currentStage: "complete" as const,
    assets: [],
    htmlOutput: {
      html: `<main>${page.title}</main>`,
      generatedAt,
      version: 1,
    },
  });

  return {
    ...readyRun(),
    id: `run-partial-${generationStatus}`,
    generation: {
      version: 1,
      courseId: "course-partially-failed",
      traceId: "trace-partially-failed",
      userPrompt: "生成太阳系课程",
      status: generationStatus,
      currentStage: "html",
      currentPageId:
        generationStatus === "running" ? remainingPage.id : undefined,
      intent: courseDesignIntent,
      outline: courseDesignOutline,
      pages: [
        completedState(completedPage),
        {
          pageId: failedPage.id,
          order: failedPage.order,
          status: "failed",
          currentStage: "html",
          assets: [],
          attempts: [{ stage: "html", attempts: 3 }],
          error: {
            code: "PAGE_WORKER_RETRY_EXHAUSTED",
            causeCode: "TIMEOUT_ERROR",
            message: "provider private timeout response",
          },
        },
        generationStatus === "running"
          ? {
              pageId: remainingPage.id,
              order: remainingPage.order,
              status: "running",
              currentStage: "html",
              assets: [],
            }
          : completedState(remainingPage),
      ],
      events: [],
      errors: [
        {
          stage: "html",
          pageId: failedPage.id,
          code: "PAGE_WORKER_RETRY_EXHAUSTED",
          causeCode: "TIMEOUT_ERROR",
          message: "provider private timeout response",
        },
      ],
      startedAt: generatedAt,
      updatedAt: generatedAt,
    },
  };
}

describe("CourseWorkspacePanel", () => {
  it("waits for the backend outline instead of inventing five draft sections", () => {
    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        brief={createCourseCreationBrief("目标是系统理解操作系统原理")}
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onResumeCourse={vi.fn()}
      />,
    );

    expect(markup).toContain("按内容规划章节");
    expect(markup).toContain("课芽正在规划课程结构");
    expect(markup).not.toContain("0 / 5");
    expect(markup).not.toContain('id="draft-section-');
  });

  it("shows actionable bounded failure guidance without raw provider details", () => {
    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onResumeCourse={vi.fn()}
        run={failedRun()}
      />,
    );

    expect(markup).toContain("模型服务额度不足");
    expect(markup).toContain("额度恢复后继续");
    expect(markup).not.toContain("课程生成暂停");
    expect(markup).not.toContain("provider raw billing response");
  });

  it("keeps the chapter list as the scroll region and uses a compact preview entry", () => {
    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onOpenCoursePlayer={vi.fn()}
        onResumeCourse={vi.fn()}
        run={readyRun()}
      />,
    );

    expect(markup).toContain('aria-label="课程章节列表"');
    expect(markup).toContain("已完成，可打开查看完整互动内容");
    expect(markup).toContain("查看内容");
    expect(markup).not.toContain("<iframe");
  });

  it("projects checkpoint-running chapters as paused without a spinner", () => {
    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onResumeCourse={vi.fn()}
        run={partiallyFailedRun("running")}
        taskStatus="paused"
      />,
    );

    expect(markup).toContain(
      "已完成 1 / 3 节 · 1 节未完成 · 1 节已暂停",
    );
    expect(markup).toContain("本节未完成，继续后重新生成");
    expect(markup).toContain("已暂停，继续后恢复");
    expect(markup).not.toContain("正在生成");
    expect(markup).not.toContain("motion-safe:animate-spin");
  });

  it("lets other chapters continue while one chapter is temporarily incomplete", () => {
    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onResumeCourse={vi.fn()}
        run={partiallyFailedRun("running")}
        taskStatus="running"
      />,
    );

    expect(markup).toContain("已完成 1 / 3 节 · 1 节暂未完成");
    expect(markup).toContain("本节暂未完成，其余章节继续生成");
    expect(markup).toContain("正在生成");
    expect(markup).not.toContain("重试 1 个失败章节");
  });

  it("offers one bounded retry action after the batch settles", () => {
    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onResumeCourse={vi.fn()}
        run={partiallyFailedRun("failed")}
        taskStatus="failed"
      />,
    );

    expect(markup).toContain("已完成 2 / 3 节 · 1 节待处理");
    expect(markup).toContain("需要重新生成");
    expect(markup).toContain("重试 1 个失败章节");
    expect(markup).not.toContain("provider private timeout response");
  });

  it("does not leave sibling chapters spinning after the course is terminal", () => {
    const run = partiallyFailedRun("running");
    if (!run.generation) throw new Error("generation fixture is required");
    run.generation.status = "failed";
    run.generation.currentPageId = undefined;

    const markup = renderToStaticMarkup(
      <CourseWorkspacePanel
        onEvaluatePage={vi.fn()}
        onExportCourse={vi.fn()}
        onGenerateAssets={vi.fn()}
        onGenerateDesign={vi.fn()}
        onGenerateHtml={vi.fn()}
        onGeneratePage={vi.fn()}
        onOpenHtmlPreview={vi.fn()}
        onResumeCourse={vi.fn()}
        run={run}
        taskStatus="failed"
      />,
    );

    expect(markup).toContain("已完成 1 / 3 节 · 2 节待处理");
    expect(markup).toContain("重试 2 个失败章节");
    expect(markup).not.toContain("正在生成");
    expect(markup).not.toContain("motion-safe:animate-spin");
  });
});
