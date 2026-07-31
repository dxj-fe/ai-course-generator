import { describe, expect, it } from "vitest";

import { ExecutableToolRegistry } from "../../../../src/server/agent/runtime/executable-tool-registry";
import {
  searchFunctionalTemplateTool,
  searchStyleTemplateTool,
  validateCourseIntentTool,
  type TemplateSearchOutput,
  type ValidateCourseIntentOutput,
} from "../../../../src/server/agent/plugins/tools/course/template-definitions";

const context = { traceId: "template-test" };

describe("template tool definitions", () => {
  it("finds an interactive functional template", async () => {
    const registry = new ExecutableToolRegistry(() => {}).register(
      searchFunctionalTemplateTool,
    );
    const result = await registry.execute<TemplateSearchOutput>(
      searchFunctionalTemplateTool.name,
      { query: "用互动问答检查儿童是否理解", limit: 1 },
      context,
    );

    expect(result.templates[0].id).toBe("interactive-quiz");
  });

  it("finds a professional style template", async () => {
    const registry = new ExecutableToolRegistry(() => {}).register(
      searchStyleTemplateTool,
    );
    const result = await registry.execute<TemplateSearchOutput>(
      searchStyleTemplateTool.name,
      { query: "极简专业的企业培训页面", limit: 1 },
      context,
    );

    expect(result.templates[0].id).toBe("minimal");
    expect(result.templates[0].visualStyle).toBe("minimal");
  });

  it("reports an invalid CourseIntent", async () => {
    const registry = new ExecutableToolRegistry(() => {}).register(
      validateCourseIntentTool,
    );
    const result = await registry.execute<ValidateCourseIntentOutput>(
      validateCourseIntentTool.name,
      {
        intent: {
          topic: "AI Agent",
          courseLength: 0,
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
