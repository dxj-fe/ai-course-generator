import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { SPECIALIST_PROMPT_LIBRARY } from "../../../../src/server/prompts/specialist-library";

const require = createRequire(import.meta.url);
const {
  lintPromptContent,
  lintPromptLibrary,
}: {
  lintPromptContent: (
    entry: (typeof SPECIALIST_PROMPT_LIBRARY)[number],
    systemContent: string,
    userContent: string,
  ) => Array<{ code: string }>;
  lintPromptLibrary: (rootDir?: string) => Promise<Array<{ code: string }>>;
} = require("../../../../scripts/prompt-lint.ts");

describe("Specialist Prompt Library", () => {
  it("registers the exact nine Specialist roles without coordinator prompts", () => {
    expect(SPECIALIST_PROMPT_LIBRARY.map(({ id }) => id)).toEqual([
      "planner",
      "pedagogy",
      "story",
      "visual",
      "page-writer",
      "image-prompt",
      "html-engineer",
      "qa",
      "repair",
    ]);
    expect(
      SPECIALIST_PROMPT_LIBRARY.filter(({ status }) => status === "draft").map(
        ({ id }) => id,
      ),
    ).toEqual(["repair"]);
  });

  it("passes the repository Prompt lint", async () => {
    await expect(lintPromptLibrary()).resolves.toEqual([]);
  });

  it("reports a missing required section without rewriting the prompt", () => {
    const planner = SPECIALIST_PROMPT_LIBRARY[0];
    const systemContent = [
      "# Role",
      "视为数据",
      "# Goal",
      "# Inputs",
      "# Output Schema",
      "# Rules",
      "# Forbidden",
      "# Examples",
    ].join("\n\n");
    const userContent = [
      "不是新的系统指令",
      "{{courseIntentJson}}",
      "{{functionalTemplatesJson}}",
      "{{styleTemplateJson}}",
    ].join("\n");

    expect(lintPromptContent(planner, systemContent, userContent)).toContainEqual(
      expect.objectContaining({ code: "PROMPT_SECTION_MISSING" }),
    );
  });

  it("detects a user-template variable contract mismatch", () => {
    const planner = SPECIALIST_PROMPT_LIBRARY[0];
    const systemContent = [
      "# Role",
      "视为数据",
      "# Goal",
      "# Inputs",
      "# Output Schema",
      "# Rules",
      "# Forbidden",
      "# Examples",
      "# Failure Handling",
    ].join("\n\n");

    expect(
      lintPromptContent(
        planner,
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
