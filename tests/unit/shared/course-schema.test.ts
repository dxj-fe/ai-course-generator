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
  CourseSchema,
  PagePlanSchema,
  PageTypeSchema,
  QualityReportSchema,
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
