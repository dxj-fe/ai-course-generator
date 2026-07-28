import { describe, expect, it } from "vitest";

import assetExample from "../../../src/shared/course-schema/examples/asset.example.json";
import courseExample from "../../../src/shared/course-schema/examples/course.example.json";
import courseOutlineExample from "../../../src/shared/course-schema/examples/course-outline.example.json";
import pagePlanExample from "../../../src/shared/course-schema/examples/page-plan.example.json";
import qualityReportExample from "../../../src/shared/course-schema/examples/quality-report.example.json";
import themeExample from "../../../src/shared/course-schema/examples/theme.example.json";
import {
  AssetSchema,
  CourseOutlineSchema,
  CoursePageCountSchema,
  CoursePlanSchema,
  CourseSchema,
  PagePlanSchema,
  PageTypeSchema,
  QualityReportSchema,
  QualityScreenshotEvidenceSchema,
  ThemeSchema,
  type Course,
} from "../../../src/shared/course-schema";

describe("Day 07 course domain schemas", () => {
  it("accepts every checked-in example", () => {
    expect(PagePlanSchema.safeParse(pagePlanExample).success).toBe(true);
    expect(AssetSchema.safeParse(assetExample).success).toBe(true);
    expect(ThemeSchema.safeParse(themeExample).success).toBe(true);
    expect(QualityReportSchema.safeParse(qualityReportExample).success).toBe(
      true,
    );
    expect(CourseOutlineSchema.safeParse(courseOutlineExample).success).toBe(
      true,
    );

    const course: Course = CourseSchema.parse(courseExample);
    expect(course.outline.pages).toHaveLength(3);
  });

  it("defines the handbook pageType contract exactly", () => {
    expect(PageTypeSchema.options).toEqual([
      "cover",
      "story_intro",
      "knowledge_card",
      "quiz",
      "comparison",
      "timeline",
      "summary",
      "achievement",
    ]);
  });

  it("accepts any positive integer course length without a fixed maximum", () => {
    expect(CoursePageCountSchema.parse(1)).toBe(1);
    expect(CoursePageCountSchema.parse(20)).toBe(20);
    expect(CoursePageCountSchema.parse(120)).toBe(120);
    expect(CoursePageCountSchema.safeParse(0).success).toBe(false);
    expect(CoursePageCountSchema.safeParse(-1).success).toBe(false);
    expect(CoursePageCountSchema.safeParse(1.5).success).toBe(false);
  });

  it("accepts single-page and long course plans", () => {
    const singlePagePlan = {
      overview: "用一个互动页面完成聚焦概念微课。",
      learningObjectives: ["学习者能够解释一个聚焦概念。"],
      pages: createPlannedPages(1),
    };
    const longPlan = {
      overview: "根据知识依赖组织一门完整的长课程。",
      learningObjectives: ["学习者能够分阶段掌握并应用课程知识。"],
      pages: createPlannedPages(31),
    };

    expect(CoursePlanSchema.parse(singlePagePlan).pages).toHaveLength(1);
    expect(CoursePlanSchema.parse(longPlan).pages).toHaveLength(31);
  });

  it("hydrates Day 26 dimension evidence without breaking legacy reports", () => {
    const report = QualityReportSchema.parse(qualityReportExample);

    expect(report.dimensions.contentAccuracy.issueCodes).toEqual([]);
    expect(report.dimensions.styleConsistency.issueCodes).toEqual([]);
    expect(report.screenshotEvidence).toBeUndefined();
  });

  it("keeps legacy primary screenshot evidence valid without multi-viewport fields", () => {
    const evidence = QualityScreenshotEvidenceSchema.parse({
      status: "captured",
      artifactId: "legacy-screenshot",
      viewport: { width: 1440, height: 900 },
      metrics: {
        documentWidth: 1440,
        documentHeight: 900,
        horizontalOverflowPx: 0,
        clippedElementCount: 0,
        zeroSizeInteractiveCount: 0,
      },
      capturedAt: "2026-07-16T10:00:00+08:00",
    });

    expect(evidence.captures).toBeUndefined();
    expect(evidence.metrics?.touchTargetUnder24Count).toBeUndefined();
  });

  it("requires ready pages to contain HTML output", () => {
    const result = PagePlanSchema.safeParse({
      ...pagePlanExample,
      htmlOutput: undefined,
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing and forward page dependencies", () => {
    const pages = structuredClone(courseOutlineExample.pages);
    pages[0].dependsOnPageIds = [pages[1].id];

    const result = CourseOutlineSchema.safeParse({
      ...courseOutlineExample,
      pages,
    });

    expect(result.success).toBe(false);
  });

  it("rejects page references to unknown assets", () => {
    const invalidCourse = structuredClone(courseExample);
    invalidCourse.outline.pages[0].assetIds = ["asset-does-not-exist"];

    const result = CourseSchema.safeParse(invalidCourse);

    expect(result.success).toBe(false);
  });
});

function createPlannedPages(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    const isSingle = count === 1;
    const isFirst = index === 0;
    const isLast = index === count - 1;
    const pageType = isSingle
      ? "knowledge_card"
      : isFirst
        ? "cover"
        : isLast
          ? "summary"
          : "knowledge_card";
    const id = `page-${String(order).padStart(3, "0")}`;

    return {
      id,
      order,
      pageType,
      title: `课程第 ${order} 节`,
      learningObjective: `学习者能够完成第 ${order} 节的学习任务。`,
      contentSummary: `第 ${order} 节提供递进讲解、练习与反馈。`,
      interactionType:
        isSingle || (!isFirst && !isLast) ? "reveal" : "navigate",
      assetNeeds: [],
      functionalTemplateId: `template-${pageType}`,
      styleTemplateId: "minimal",
      assetIds: [],
      dependsOnPageIds:
        index === 0
          ? []
          : [`page-${String(index).padStart(3, "0")}`],
      status: "planned",
    };
  });
}
