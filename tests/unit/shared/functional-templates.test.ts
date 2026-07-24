import { describe, expect, it } from "vitest";

import { PagePlanSchema, PageTypeSchema } from "../../../src/shared/course-schema";
import {
  FunctionalTemplateSchema,
  functionalTemplateExamples,
  getFunctionalTemplate,
  listFunctionalTemplates,
  searchFunctionalTemplates,
} from "../../../src/shared/templates/functional";

describe("Functional Template Registry", () => {
  it("registers exactly one valid template for every pageType", () => {
    const templates = listFunctionalTemplates();

    expect(templates).toHaveLength(8);
    expect(new Set(templates.map(({ id }) => id)).size).toBe(8);
    expect(templates.map(({ pageType }) => pageType).sort()).toEqual(
      [...PageTypeSchema.options].sort(),
    );

    for (const template of templates) {
      expect(FunctionalTemplateSchema.safeParse(template).success).toBe(true);
      expect(template.slots.length).toBeGreaterThanOrEqual(2);
      expect(template.bestFor.length).toBeGreaterThan(0);
      expect(template.avoidFor.length).toBeGreaterThan(0);
    }
  });

  it("provides one valid PagePlan example for every template", () => {
    expect(functionalTemplateExamples).toHaveLength(8);

    for (const example of functionalTemplateExamples) {
      const template = getFunctionalTemplate(example.functionalTemplateId);

      expect(PagePlanSchema.safeParse(example).success).toBe(true);
      expect(template).toBeDefined();
      expect(template?.pageType).toBe(example.pageType);
    }
  });

  it.each([
    ["用选择题检查学习者是否理解", "interactive-quiz"],
    ["对比地球和火星的区别", "comparison-board"],
    ["按时间顺序介绍航天历史", "learning-timeline"],
    ["完成一个课后实践任务", "achievement-task"],
  ])("matches %s to %s", (query, expectedId) => {
    const [match] = searchFunctionalTemplates({ query, limit: 1 });

    expect(match.template.id).toBe(expectedId);
    expect(match.score).toBeGreaterThan(0);
    expect(match.reason).toContain("匹配教学关键词");
  });

  it("returns bounded fallback candidates for an unknown goal", () => {
    const matches = searchFunctionalTemplates({
      query: "尚未归档的学习需求",
      limit: 2,
    });

    expect(matches).toHaveLength(2);
    expect(matches.every(({ score }) => score === 0)).toBe(true);
  });

  it("keeps visual implementation fields outside the functional DSL", () => {
    const forbiddenKeys = new Set([
      "color",
      "font",
      "shadow",
      "radius",
      "className",
      "css",
      "html",
    ]);

    for (const template of listFunctionalTemplates()) {
      expect(Object.keys(template).filter((key) => forbiddenKeys.has(key))).toEqual(
        [],
      );
    }
  });
});
