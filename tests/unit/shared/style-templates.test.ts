import { describe, expect, it } from "vitest";

import {
  PagePlanSchema,
  ThemeSchema,
} from "../../../src/shared/course-schema";
import { functionalTemplateExamples } from "../../../src/shared/templates/functional";
import {
  CoreVisualStyleSchema,
  StyleTemplateSchema,
  listStyleTemplates,
  searchStyleTemplates,
  styleTemplateToCssText,
  styleTemplateToCssVariables,
  styleTemplateToTheme,
} from "../../../src/shared/templates/style";

describe("Style Template Registry", () => {
  it("registers eight valid and unique core styles", () => {
    const templates = listStyleTemplates();

    expect(templates).toHaveLength(8);
    expect(new Set(templates.map(({ id }) => id)).size).toBe(8);
    expect(templates.map(({ visualStyle }) => visualStyle).sort()).toEqual(
      [...CoreVisualStyleSchema.options].sort(),
    );

    for (const template of templates) {
      expect(StyleTemplateSchema.safeParse(template).success).toBe(true);
    }
  });

  it("converts every template to the same stable CSS variable contract", () => {
    const [first, ...rest] = listStyleTemplates().map((template) =>
      styleTemplateToCssVariables(template),
    );
    const expectedKeys = Object.keys(first);

    expect(expectedKeys.length).toBeGreaterThan(20);

    for (const variables of rest) {
      expect(Object.keys(variables)).toEqual(expectedKeys);
      expect(Object.values(variables)).not.toContain("undefined");
    }
  });

  it("serializes CSS variables and maps a style to the course Theme", () => {
    const template = listStyleTemplates()[0];
    const cssText = styleTemplateToCssText(template, ".course-preview");
    const theme = styleTemplateToTheme(template);

    expect(cssText).toContain(".course-preview {");
    expect(cssText).toContain("--course-color-background:");
    expect(cssText).not.toContain("undefined");
    expect(ThemeSchema.safeParse(theme).success).toBe(true);
    expect(theme.styleTemplateId).toBe(template.id);
  });

  it.each([
    [{ visualStyle: "sci-fi" as const }, "sci-fi"],
    [{ query: "适合孩子的明亮童趣风格" }, "kids-playful"],
    [{ query: "黑板粉笔数学课堂" }, "blackboard"],
    [{ query: "深夜编辑杂志风格的夜空与极光" }, "editorial-night"],
    [{ query: "frontend-slides Broadside 火焰橙大字海报" }, "broadside"],
  ])("matches %o to %s", (input, expectedId) => {
    const [match] = searchStyleTemplates({ ...input, limit: 1 });

    expect(match.template.id).toBe(expectedId);
    expect(match.score).toBeGreaterThan(0);
  });

  it("keeps all 48 functional and style combinations valid", () => {
    let combinationCount = 0;

    for (const pagePlan of functionalTemplateExamples) {
      for (const styleTemplate of listStyleTemplates()) {
        const combination = {
          ...pagePlan,
          id: `${pagePlan.id}-${styleTemplate.id}`,
          styleTemplateId: styleTemplate.id,
        };

        expect(PagePlanSchema.safeParse(combination).success).toBe(true);
        combinationCount += 1;
      }
    }

    expect(combinationCount).toBe(64);
  });

  it("keeps concrete course content outside the style protocol", () => {
    const forbiddenKeys = new Set([
      "topic",
      "courseTitle",
      "learningObjective",
      "pageType",
      "content",
      "html",
    ]);

    for (const template of listStyleTemplates()) {
      expect(Object.keys(template).filter((key) => forbiddenKeys.has(key))).toEqual(
        [],
      );
    }
  });
});
