import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageProgressPanel } from "../../../src/features/seaca/page-progress-panel";
import { CourseGenerationStateSchema } from "../../../src/shared/course-schema";
import type { SeacaCourseRun } from "../../../src/types/seaca";
import {
  courseDesignIntent,
  courseDesignOutline,
} from "../../fixtures/course-design";

function createRun(): SeacaCourseRun {
  return {
    id: "run-day-20",
    prompt: "生成太阳系课程",
    traceId: "trace-day-20",
    startedAt: 0,
    planner: {
      status: "completed",
      events: [],
      data: {
        traceId: "trace-day-20",
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

describe("PageProgressPanel", () => {
  it("renders a stable empty state before the course outline exists", () => {
    const markup = renderToStaticMarkup(<PageProgressPanel />);

    expect(markup).toContain("逐页生成状态");
    expect(markup).toContain(
      "课程规划生成后，这里会显示每页的 DSL、素材、HTML 与 QA",
    );
    expect(markup).not.toContain('aria-label="课程逐页生成进度"');
  });

  it("renders all three outline pages with mixed stage statuses", () => {
    const run = createRun();
    const [firstPage, secondPage, thirdPage] = courseDesignOutline.pages;

    run.pageWrites[firstPage!.id] = { status: "completed", events: [] };
    run.pageAssets[firstPage!.id] = { status: "completed", events: [] };
    run.pageHtml[firstPage!.id] = { status: "completed", events: [] };

    run.pageWrites[secondPage!.id] = { status: "completed", events: [] };
    run.pageAssets[secondPage!.id] = { status: "running", events: [] };
    run.pageHtml[secondPage!.id] = { status: "idle", events: [] };

    run.pageWrites[thirdPage!.id] = { status: "idle", events: [] };

    const markup = renderToStaticMarkup(<PageProgressPanel run={run} />);

    expect(markup).toContain('aria-label="课程逐页生成进度"');
    expect(markup.match(/<li/g)).toHaveLength(3);
    expect(markup).toContain("太阳系探索启程");
    expect(markup).toContain("恒星与行星");
    expect(markup).toContain("太阳系探索总结");
    expect(markup).toContain("页面已完成");
    expect(markup).toContain("页面生成中");
    expect(markup).toContain("页面等待中");
    expect(markup).toContain("Page DSL");
    expect(markup).toContain("图片素材");
    expect(markup).toContain("HTML");
    expect(markup).toContain("页面 QA");
  });

  it("treats missing optional QA as non-blocking after required stages complete", () => {
    const run = createRun();
    const pageId = courseDesignOutline.pages[0]!.id;

    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = { status: "completed", events: [] };

    const markup = renderToStaticMarkup(<PageProgressPanel run={run} />);

    expect(markup).toContain("页面已完成");
    expect(markup).toContain("可选·未运行");
    expect(markup).toContain('data-status="optional"');
  });

  it("shows automatic QA as waiting for Day 25 Page Workers", () => {
    const run = createRun();
    const pageId = courseDesignOutline.pages[0]!.id;
    run.generation = CourseGenerationStateSchema.parse({
      version: 1,
      courseId: "course-page-worker-progress",
      traceId: run.traceId,
      userPrompt: run.prompt,
      status: "running",
      currentStage: "html",
      workerConfig: { mode: "parallel", concurrency: 2 },
      pages: [],
      events: [],
      errors: [],
      startedAt: "2026-07-16T08:00:00.000Z",
      updatedAt: "2026-07-16T08:00:01.000Z",
    });
    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = { status: "completed", events: [] };
    run.pageHtml[pageId] = { status: "completed", events: [] };

    const markup = renderToStaticMarkup(<PageProgressPanel run={run} />);

    expect(markup).toContain("HTML 与 QA 均由 Page Worker 自动执行");
    expect(markup).toContain("页面生成中");
    expect(markup).not.toContain("可选·未运行");
  });

  it("exposes failed stages with text instead of relying on color", () => {
    const run = createRun();
    const pageId = courseDesignOutline.pages[1]!.id;

    run.pageWrites[pageId] = { status: "completed", events: [] };
    run.pageAssets[pageId] = {
      status: "failed",
      events: [],
      error: "素材服务不可用",
    };

    const markup = renderToStaticMarkup(<PageProgressPanel run={run} />);

    expect(markup).toContain("页面失败");
    expect(markup).toContain('data-status="failed"');
    expect(markup).toMatch(/图片素材[\s\S]*失败/);
  });
});
