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
  it("registers twelve valid templates covering every core visual style", () => {
    const templates = listStyleTemplates();

    expect(templates).toHaveLength(12);
    expect(new Set(templates.map(({ id }) => id)).size).toBe(12);
    expect(new Set(templates.map(({ visualStyle }) => visualStyle))).toEqual(
      new Set(CoreVisualStyleSchema.options),
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
    [{ query: "给 10 岁孩子讲太阳系，让他们探索行星" }, "kids-playful"],
    [{ query: "面向大学生推导轨道力学公式并安排练习" }, "blackboard"],
    [{ query: "管理层生成式 AI 风险、法规与合规培训" }, "minimal"],
    [{ query: "中国古典文学赏析与作品叙事" }, "soft-editorial"],
    [{ query: "英语词汇闯关，每关都有测验和反馈" }, "game-quest"],
    [{ query: "深夜编辑杂志风格的夜空与极光" }, "editorial-night"],
    [{ query: "火焰橙大字报式城市文化观点课程" }, "broadside"],
    [{ query: "为植物光合作用设计自然观察课程" }, "nature"],
    [
      {
        query:
          "为初中生解释可观察的光路并完成选择题，精确关系用 HTML/CSS/SVG 表达",
        audience: "初中生",
        learningActivities: ["practice", "assess"] as const,
      },
      "minimal",
    ],
  ])("matches %o to %s", (input, expectedId) => {
    const [match] = searchStyleTemplates({ ...input, limit: 1 });

    expect(match.template.id).toBe(expectedId);
    expect(match.score).toBeGreaterThan(0);
  });

  it("returns explainable and intentionally different top-three directions", () => {
    const matches = searchStyleTemplates({
      query: "给初中生讲人工智能原理，通过案例、图表和互动练习理解",
      limit: 3,
    });

    expect(matches).toHaveLength(3);
    expect(matches.map(({ candidateRole }) => candidateRole)).toEqual([
      "best-match",
      "safe",
      "explore",
    ]);
    expect(new Set(matches.map(({ template }) => template.profile.family)).size)
      .toBeGreaterThan(1);
    expect(matches[0]?.factors.some(({ score }) => score > 0)).toBe(true);
    expect(matches[0]?.reason.length).toBeGreaterThan(2);
  });

  it("uses a hard risk constraint for regulated learning", () => {
    const matches = searchStyleTemplates({
      query: "面向医生的患者安全法规与临床合规培训",
      limit: 8,
    });

    expect(matches).not.toHaveLength(0);
    expect(
      matches.every(({ template }) =>
        template.profile.riskContexts.includes("regulated"),
      ),
    ).toBe(true);
  });

  it("keeps all 96 functional and style combinations valid", () => {
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

    expect(combinationCount).toBe(96);
  });

  it("没有明确关键词时允许架构师看到全部主题，而不是固定前三种", () => {
    const matches = searchStyleTemplates({
      query: "面向成人讲解一个尚未收录关键词的主题",
      limit: 12,
    });

    expect(matches).toHaveLength(listStyleTemplates().length);
    expect(matches.map(({ template }) => template.id)).toEqual(
      expect.arrayContaining(listStyleTemplates().map(({ id }) => id)),
    );
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
