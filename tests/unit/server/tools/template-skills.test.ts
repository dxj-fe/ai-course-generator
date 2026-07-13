import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../../../../src/server/tools/skill-registry";
import {
  searchFunctionalTemplateSkill,
  searchStyleTemplateSkill,
  validateCourseIntentSkill,
  type TemplateSearchOutput,
  type ValidateCourseIntentOutput,
} from "../../../../src/server/tools/template-skills";

const context = { traceId: "template-test" };

describe("template skills", () => {
  it("finds an interactive functional template", async () => {
    const registry = new SkillRegistry(() => {}).register(
      searchFunctionalTemplateSkill,
    );
    const result = await registry.execute<TemplateSearchOutput>(
      searchFunctionalTemplateSkill.name,
      { query: "用互动问答检查儿童是否理解", limit: 1 },
      context,
    );

    expect(result.templates[0].id).toBe("interactive-quiz");
  });

  it("finds a professional style template", async () => {
    const registry = new SkillRegistry(() => {}).register(
      searchStyleTemplateSkill,
    );
    const result = await registry.execute<TemplateSearchOutput>(
      searchStyleTemplateSkill.name,
      { query: "极简专业的企业培训页面", limit: 1 },
      context,
    );

    expect(result.templates[0].id).toBe("minimal");
    expect(result.templates[0].visualStyle).toBe("minimal");
  });

  it("maps the professional CourseIntent style to minimal", async () => {
    const registry = new SkillRegistry(() => {}).register(
      searchStyleTemplateSkill,
    );
    const result = await registry.execute<TemplateSearchOutput>(
      searchStyleTemplateSkill.name,
      { visualStyle: "professional", audience: "企业管理者", limit: 1 },
      context,
    );

    expect(result.templates[0].id).toBe("minimal");
    expect(result.templates[0].reason).toContain("visualStyle");
  });

  it("reports an invalid CourseIntent", async () => {
    const registry = new SkillRegistry(() => {}).register(
      validateCourseIntentSkill,
    );
    const result = await registry.execute<ValidateCourseIntentOutput>(
      validateCourseIntentSkill.name,
      {
        intent: {
          topic: "AI Agent",
          courseLength: 30,
        },
      },
      context,
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "courseLength" }),
      ]),
    );
  });
});
