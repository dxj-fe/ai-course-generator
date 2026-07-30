import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RecommendedCourseDomainSchema,
  RecommendedCourseListResponseSchema,
} from "../../../../src/shared/course-schema";
import {
  getRecommendedCourse,
  listRecommendedCourses,
  recommendedCourseRegistry,
} from "../../../../src/server/recommendations/recommended-course-registry";
import { renderRecommendedCoursePreviewHtml } from "../../../../src/server/recommendations/recommended-course-preview";

describe("recommended course registry", () => {
  it("provides one curated course for every supported domain", () => {
    const domains = new Set(recommendedCourseRegistry.map(({ domain }) => domain));

    expect(recommendedCourseRegistry).toHaveLength(
      RecommendedCourseDomainSchema.options.length,
    );
    expect([...domains].sort()).toEqual(
      [...RecommendedCourseDomainSchema.options].sort(),
    );
    for (const course of recommendedCourseRegistry) {
      expect(course.outline).toHaveLength(course.pageCount);
      expect(existsSync(join(process.cwd(), "public", course.coverImage))).toBe(
        true,
      );
    }
  });

  it("rotates three-course batches without repeats and wraps after four batches", () => {
    const batches = [0, 3, 6, 9].map((cursor) =>
      listRecommendedCourses(cursor),
    );
    const ids = batches.flatMap(({ items }) => items.map(({ id }) => id));

    expect(new Set(ids)).toHaveLength(12);
    expect(batches[3]?.nextCursor).toBe(0);
    for (const batch of batches) {
      expect(() => RecommendedCourseListResponseSchema.parse(batch)).not.toThrow();
      expect(new Set(batch.items.map(({ domain }) => domain))).toHaveLength(3);
    }
  });

  it("builds a detailed generation prompt and a script-free HTML preview", () => {
    const response = listRecommendedCourses();
    const summary = response.items[0];
    const course = getRecommendedCourse(summary.id);

    expect(summary.prompt).toContain("学习结果");
    expect(summary.prompt).toContain("课程结构");
    expect(summary.prompt).toContain("具体示例、主动练习和解释性反馈");
    expect(course).toBeDefined();

    const html = renderRecommendedCoursePreviewHtml(course!);
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain(course!.coverImage);
    expect(html).toContain(course!.title);
    expect(html).not.toContain("<script");
  });
});
