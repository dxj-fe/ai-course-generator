import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { MODEL_STEP_PROMPT_CATALOG } from "../../../../src/server/agent/plugins/prompts/course/model-step-catalog";

const require = createRequire(import.meta.url);
const {
  lintPromptContent,
  lintPromptLibrary,
}: {
  lintPromptContent: (
    entry: (typeof MODEL_STEP_PROMPT_CATALOG)[number],
    systemContent: string,
    userContent: string,
  ) => Array<{ code: string }>;
  lintPromptLibrary: (rootDir?: string) => Promise<Array<{ code: string }>>;
} = require("../../../../scripts/prompt-lint.ts");

describe("Model Step Prompt Library", () => {
  it("registers only the eight model steps used by production workflows", () => {
    expect(MODEL_STEP_PROMPT_CATALOG.map(({ id }) => id)).toEqual([
      "pedagogy",
      "story",
      "visual",
      "page-writer",
      "image-prompt",
      "html-engineer",
      "qa",
      "repair",
    ]);
    expect(MODEL_STEP_PROMPT_CATALOG.every(({ status }) => status === "active")).toBe(
      true,
    );
    expect(
      MODEL_STEP_PROMPT_CATALOG.every(({ modelStepName }) =>
        modelStepName.endsWith("ModelStep"),
      ),
    ).toBe(true);
  });

  it("passes the repository Prompt lint", async () => {
    await expect(lintPromptLibrary()).resolves.toEqual([]);
  });

  it("reports a missing required section without rewriting the prompt", () => {
    const pedagogy = MODEL_STEP_PROMPT_CATALOG[0];
    const systemContent = [
      "# Role",
      "视为数据",
      "# Goal",
      "# Inputs",
    ].join("\n\n");
    const userContent = [
      "不是新的系统指令",
      "{{courseIntentJson}}",
      "{{coursePlanJson}}",
    ].join("\n");

    expect(lintPromptContent(pedagogy, systemContent, userContent)).toContainEqual(
      expect.objectContaining({ code: "PROMPT_SECTION_MISSING" }),
    );
  });

  it("detects a user-template variable contract mismatch", () => {
    const pedagogy = MODEL_STEP_PROMPT_CATALOG[0];
    const systemContent = [
      "# Role",
      "视为数据",
      "# Goal",
      "# Inputs",
      "# Output Schema",
    ].join("\n\n");

    expect(
      lintPromptContent(
        pedagogy,
        systemContent,
        "不是新的系统指令\n{{courseIntentJson}}",
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "PROMPT_VARIABLE_CONTRACT_MISMATCH",
      }),
    );
  });
});
