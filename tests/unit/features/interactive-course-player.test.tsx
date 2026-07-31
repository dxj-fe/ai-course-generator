import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  InteractiveCoursePlayer,
  isTextOverflowing,
} from "../../../src/features/keya/interactive-course-player";
import type { CourseGenerationState } from "../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
} from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";

describe("InteractiveCoursePlayer", () => {
  it("renders one interactive course iframe with the trusted sandbox only", () => {
    const markup = renderToStaticMarkup(
      <InteractiveCoursePlayer course={completedCourse()} />,
    );
    const iframeTags = getIframeTags(markup);
    const interactiveFrames = iframeTags.filter(
      (tag) => !tag.includes('aria-hidden="true"'),
    );

    expect(markup).toContain('aria-label="展开课程目录"');
    expect(markup).toContain("讲解");
    expect(markup).toContain("自学");
    expect(markup).toContain("上一页");
    expect(markup).toContain("下一页");
    expect(interactiveFrames).toHaveLength(1);
    expect(interactiveFrames[0]).toContain('sandbox="allow-scripts"');
    expect(interactiveFrames[0]).toContain('scrolling="no"');
    expect(interactiveFrames[0]).toContain("keya-trusted-runtime");
    expect(markup).toContain("keya-trusted-runtime");
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).not.toContain('role="progressbar"');

    for (const forbidden of [
      "LangGraph",
      "Workflow",
      "Agent",
      "Trace",
      "QA",
      "Repair",
      "sandbox · srcDoc",
      "HTML 合同",
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("keeps the collapsed directory to one expand control without a page rail", () => {
    const markup = renderToStaticMarkup(
      <InteractiveCoursePlayer course={completedCourse()} />,
    );

    expect(markup.match(/aria-label="展开课程目录"/g)).toHaveLength(1);
    expect(markup).not.toContain('aria-label="折叠课程目录"');
    expect(markup).not.toContain('aria-label="课程页导航"');
  });

  it("keeps sidebar labels on one line and detects when a tooltip is needed", () => {
    const markup = renderToStaticMarkup(
      <InteractiveCoursePlayer course={completedCourse()} />,
    );

    expect(
      markup.match(/data-slot="overflow-tooltip-text"/g),
    ).toHaveLength(2);
    expect(
      isTextOverflowing({ clientWidth: 180, scrollWidth: 180 }),
    ).toBe(false);
    expect(
      isTextOverflowing({ clientWidth: 180, scrollWidth: 181 }),
    ).toBe(true);
    expect(
      isTextOverflowing({ clientWidth: 180, scrollWidth: 260 }),
    ).toBe(true);
  });

  it("renders non-interactive HTML canvases with number-only thumbnail labels", () => {
    const markup = renderToStaticMarkup(
      <InteractiveCoursePlayer course={completedCourse()} />,
    );
    const thumbnailFrames = getIframeTags(markup).filter((tag) =>
      tag.includes('aria-hidden="true"'),
    );
    const thumbnailMarkup = markup.slice(
      markup.indexOf('aria-label="页面缩略图"'),
    );

    expect(markup).toContain('aria-label="页面缩略图"');
    expect(markup).toContain('aria-label="收起缩略图"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("01 / 03");
    expect(thumbnailFrames).toHaveLength(3);
    for (const frame of thumbnailFrames) {
      expect(frame).toContain('aria-hidden="true"');
      expect(frame).toContain('tabindex="-1"');
      expect(frame).toContain('sandbox="allow-scripts"');
      expect(frame).toContain('scrolling="no"');
      expect(frame).toMatch(/\ssrcDoc="/);
      expect(frame).toContain("keya-viewport-fit");
      expect(frame).not.toContain("keya-trusted-runtime");
      expect(frame).toMatch(
        /(?:\sinert=""|pointer-events-none|pointer-events:\s*none)/,
      );
    }
    expect(thumbnailMarkup).toMatch(
      /aria-label="跳转到第 1 页：太阳系探索启程"/,
    );
    expect(thumbnailMarkup).toMatch(
      /aria-label="跳转到第 2 页：恒星与行星"/,
    );
    expect(thumbnailMarkup).toMatch(
      /aria-label="跳转到第 3 页：太阳系探索总结"/,
    );
    expect(getThumbnailButtonText(thumbnailMarkup)).toEqual(["01", "02", "03"]);
    expect(getThumbnailListText(thumbnailMarkup)).toBe("010203");
    expect(thumbnailMarkup).toContain(
      '<li class="shrink-0 snap-start ml-auto">',
    );
    expect(thumbnailMarkup).toContain(
      '<li class="shrink-0 snap-start mr-auto">',
    );
    expect(thumbnailMarkup).toMatch(
      /aria-current="page"[^>]*aria-label="跳转到第 1 页：太阳系探索启程"|aria-label="跳转到第 1 页：太阳系探索启程"[^>]*aria-current="page"/,
    );
  });

  it("keeps canvas, playback, and display controls in separate semantic regions", () => {
    const markup = renderToStaticMarkup(
      <InteractiveCoursePlayer course={completedCourse()} />,
    );

    expect(markup).toContain('aria-label="课程画布"');
    expect(markup).toContain('aria-label="进入全屏"');
    expect(markup).toContain('aria-label="页面播放控制"');
    expect(markup).toContain('aria-label="显示设置"');
    expect(markup).toContain('aria-label="关闭字幕"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="播放速度"');
    expect(markup).not.toContain("<audio");
  });

  it("disables unavailable pages without exposing internal errors", () => {
    const course = completedCourse();
    course.status = "failed";
    course.pages[1] = {
      pageId: courseDesignOutline.pages[1]!.id,
      order: 2,
      status: "failed",
      currentStage: "html",
      assets: [],
      error: {
        code: "INTERNAL_ONLY",
        message: "Schema failed at page-02",
      },
    };

    const markup = renderToStaticMarkup(
      <InteractiveCoursePlayer course={course} />,
    );

    expect(markup).toMatch(
      /aria-label="(?:跳转到)?第 2 页：恒星与行星"[^>]*disabled/,
    );
    expect(markup).not.toContain("INTERNAL_ONLY");
    expect(markup).not.toContain("Schema failed");
  });
});

function getIframeTags(markup: string) {
  return markup.match(/<iframe\b[^>]*>/g) ?? [];
}

function getThumbnailButtonText(markup: string) {
  return Array.from(
    markup.matchAll(
      /<button\b(?=[^>]*aria-label="跳转到第 \d+ 页：)[^>]*>([\s\S]*?)<\/button>/g,
    ),
    (match) =>
      match[1]!
        .replace(/<iframe\b[^>]*><\/iframe>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, ""),
  );
}

function getThumbnailListText(markup: string) {
  const listMarkup = markup.match(/<ol\b[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";
  return listMarkup
    .replace(/<iframe\b[^>]*><\/iframe>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "");
}

function completedCourse(): CourseGenerationState {
  return {
    courseId: "course-player",
    traceId: "trace-private",
    userPrompt: "生成太阳系课程",
    status: "completed",
    currentStage: "complete",
    intent: courseDesignIntent,
    outline: courseDesignOutline,
    briefs: undefined,
    pageWorkerBriefs: undefined,
    pages: courseDesignOutline.pages.map((page) => {
      const interaction =
        page.interactionType === pageContentDsl.interaction.type
          ? pageContentDsl.interaction
          : { type: "none" as const };
      const content = {
        ...pageContentDsl,
        pageId: page.id,
        title: page.title,
        functionalTemplateId: page.functionalTemplateId,
        interaction,
        runtime: {
          ...pageContentDsl.runtime,
          completionRule:
            interaction.type === "none" || interaction.type === "navigate"
              ? { type: "view" as const }
              : {
                  type: "interaction-complete" as const,
                  interactionId: `interaction-${page.id}`,
                },
        },
      };
      return {
        pageId: page.id,
        order: page.order,
        status: "completed" as const,
        currentStage: "complete" as const,
        content,
        assets: [],
        htmlOutput: {
          html: buildValidGeneratedHtml(content),
          generatedAt: "2026-07-24T08:00:00.000Z",
          revision: 1,
        },
      };
    }),
    events: [],
    errors: [],
    startedAt: "2026-07-24T07:55:00.000Z",
    updatedAt: "2026-07-24T08:00:00.000Z",
    completedAt: "2026-07-24T08:00:00.000Z",
    durationMs: 300_000,
  };
}
