import { describe, expect, it } from "vitest";

import {
  buildCoursePlayerManifest,
  getAdjacentReadySectionId,
  getInitialCourseSectionId,
  type CoursePlayerManifest,
} from "../../../src/features/keya/course-player-model";
import type { CourseGenerationState } from "../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
} from "../../fixtures/course-design";

describe("course player model", () => {
  it("orders outline sections and projects only learner-facing fields", () => {
    const course = courseState();
    course.outline = {
      ...courseDesignOutline,
      pages: [
        courseDesignOutline.pages[2]!,
        courseDesignOutline.pages[0]!,
        courseDesignOutline.pages[1]!,
      ],
    };

    const manifest = buildCoursePlayerManifest(course);

    expect(manifest.sections.map(({ id }) => id)).toEqual([
      "page-01-cover",
      "page-02-knowledge",
      "page-03-summary",
    ]);
    expect(manifest.sections.map(({ generationStatus }) => generationStatus)).toEqual([
      "generating",
      "ready",
      "failed",
    ]);
    expect(manifest.sections[1]).toEqual({
      id: "page-02-knowledge",
      order: 2,
      title: "恒星与行星",
      learningObjective: "学习者能够区分恒星和行星的基础特点。",
      interactionType: "reveal",
      generationStatus: "ready",
      html: "<!doctype html><html><head></head><body>恒星与行星</body></html>",
      htmlRevision: 3,
      interaction: pageContentDsl.interaction,
      runtime: pageContentDsl.runtime,
      narration: pageContentDsl.narration,
    });
    expect(manifest.sections[0]).not.toHaveProperty("html");
    expect(manifest.sections[2]).not.toHaveProperty("html");

    expect(Object.keys(manifest).sort()).toEqual([
      "courseId",
      "overview",
      "sections",
      "title",
    ]);
    for (const section of manifest.sections) {
      expect(section).not.toHaveProperty("events");
      expect(section).not.toHaveProperty("error");
      expect(section).not.toHaveProperty("traceId");
      expect(section).not.toHaveProperty("agent");
      expect(section).not.toHaveProperty("qualityReport");
      expect(section).not.toHaveProperty("repairHistory");
    }
    expect(manifest).not.toHaveProperty("events");
    expect(manifest).not.toHaveProperty("errors");
    expect(manifest).not.toHaveProperty("traceId");
    expect(manifest).not.toHaveProperty("supervisor");
  });

  it("uses pending when an outline section has no page generation state", () => {
    const course = courseState();
    course.pages = course.pages.filter(
      ({ pageId }) => pageId !== "page-01-cover",
    );

    const manifest = buildCoursePlayerManifest(course);

    expect(manifest.sections[0]).toMatchObject({
      id: "page-01-cover",
      generationStatus: "pending",
      narration: [],
    });
  });

  it("restores only a ready stored section and otherwise selects the first ready section", () => {
    const manifest = buildCoursePlayerManifest(courseState());

    expect(
      getInitialCourseSectionId(manifest, "page-02-knowledge"),
    ).toBe("page-02-knowledge");
    expect(
      getInitialCourseSectionId(manifest, "page-03-summary"),
    ).toBe("page-02-knowledge");
    expect(
      getInitialCourseSectionId(manifest, "page-does-not-exist"),
    ).toBe("page-02-knowledge");
    expect(getInitialCourseSectionId(withoutReadySections(manifest))).toBeUndefined();
  });

  it("moves to the next ready section without selecting failed or pending sections", () => {
    const manifest = navigationManifest();

    expect(
      getAdjacentReadySectionId(manifest, "section-01", "next"),
    ).toBe("section-04");
    expect(
      getAdjacentReadySectionId(manifest, "section-04", "previous"),
    ).toBe("section-01");
    expect(
      getAdjacentReadySectionId(manifest, "section-02", "next"),
    ).toBeUndefined();
    expect(
      getAdjacentReadySectionId(manifest, "missing", "next"),
    ).toBeUndefined();
    expect(
      getAdjacentReadySectionId(manifest, "section-04", "next"),
    ).toBeUndefined();
  });
});

function courseState(): CourseGenerationState {
  return {
    courseId: "course-player-model",
    traceId: "trace-should-not-leak",
    userPrompt: "生成三节太阳系课程",
    status: "failed",
    currentStage: "html",
    intent: courseDesignIntent,
    outline: courseDesignOutline,
    pages: [
      {
        pageId: "page-01-cover",
        order: 1,
        status: "running",
        currentStage: "page_writer",
        assets: [],
      },
      {
        pageId: "page-02-knowledge",
        order: 2,
        status: "completed",
        currentStage: "complete",
        content: pageContentDsl,
        assets: [],
        htmlOutput: {
          html: "<!doctype html><html><head></head><body>恒星与行星</body></html>",
          generatedAt: "2026-07-24T01:00:00.000Z",
          revision: 3,
        },
      },
      {
        pageId: "page-03-summary",
        order: 3,
        status: "failed",
        currentStage: "html",
        assets: [],
        error: {
          code: "HTML_FAILED",
          message: "HTML Engineer 内部错误不应进入播放器。",
        },
      },
    ],
    events: [
      {
        id: "event-private-looking",
        sequence: 1,
        type: "error",
        traceId: "trace-should-not-leak",
        timestamp: "2026-07-24T01:00:01.000Z",
        step: 1,
        summary: "Agent 运行信息不应进入播放器。",
        stage: "html",
        pageId: "page-03-summary",
        agent: "html-engineer",
      },
    ],
    errors: [
      {
        stage: "html",
        pageId: "page-03-summary",
        code: "HTML_FAILED",
        message: "内部错误不应进入播放器。",
      },
    ],
    startedAt: "2026-07-24T00:59:00.000Z",
    updatedAt: "2026-07-24T01:00:01.000Z",
  };
}

function withoutReadySections(
  manifest: CoursePlayerManifest,
): CoursePlayerManifest {
  return {
    ...manifest,
    sections: manifest.sections.map((section) => ({
      ...section,
      generationStatus: "pending",
      html: undefined,
      htmlRevision: undefined,
    })),
  };
}

function navigationManifest(): CoursePlayerManifest {
  return {
    courseId: "course-navigation",
    title: "导航测试",
    sections: [
      section("section-01", 1, "ready"),
      section("section-02", 2, "failed"),
      section("section-03", 3, "pending"),
      section("section-04", 4, "ready"),
    ],
  };
}

function section(
  id: string,
  order: number,
  generationStatus: CoursePlayerManifest["sections"][number]["generationStatus"],
): CoursePlayerManifest["sections"][number] {
  return {
    id,
    order,
    title: `第 ${order} 节`,
    learningObjective: `完成第 ${order} 节学习目标。`,
    interactionType: "none",
    generationStatus,
    ...(generationStatus === "ready"
      ? { html: `<html>${order}</html>`, htmlRevision: 1 }
      : {}),
    narration: [],
  };
}
