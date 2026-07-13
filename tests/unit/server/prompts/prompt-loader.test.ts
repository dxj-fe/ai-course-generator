import { describe, expect, it } from "vitest";

import {
  loadPromptTemplate,
  renderPromptTemplate,
} from "../../../../src/server/prompts/prompt-loader";
import type { PromptTemplateDefinition } from "../../../../src/server/prompts/types";

const userPromptDefinition: PromptTemplateDefinition = {
  name: "course-intent-user",
  version: "1.0.0",
  role: "user",
  inputContract: ["userPromptJson"],
  outputContract: ["CourseIntent"],
  fileName: "intent.user.v1.md",
};

describe("prompt-loader", () => {
  it("loads a versioned Markdown prompt", async () => {
    const template = await loadPromptTemplate(userPromptDefinition);

    expect(template.name).toBe("course-intent-user");
    expect(template.version).toBe("1.0.0");
    expect(template.content).toContain("{{userPromptJson}}");
  });

  it("injects declared variables without evaluating placeholders in values", async () => {
    const template = await loadPromptTemplate(userPromptDefinition);
    const userPromptJson = JSON.stringify("保留 {{unknown}} 文本");

    const rendered = renderPromptTemplate(template, { userPromptJson });

    expect(rendered).toContain(userPromptJson);
    expect(rendered).not.toContain("{{userPromptJson}}");
  });

  it("rejects missing variables", async () => {
    const template = await loadPromptTemplate(userPromptDefinition);

    expect(() => renderPromptTemplate(template, {})).toThrow("缺少变量");
  });

  it("rejects variables that the template does not declare", async () => {
    const template = await loadPromptTemplate(userPromptDefinition);

    expect(() =>
      renderPromptTemplate(template, {
        userPromptJson: '"太阳系课程"',
        unknown: "value",
      }),
    ).toThrow("未声明变量");
  });
});
