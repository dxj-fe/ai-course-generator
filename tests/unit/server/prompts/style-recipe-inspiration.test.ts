import { describe, expect, it } from "vitest";

import {
  extractStyleRecipeDescription,
  MAX_STYLE_RECIPE_DESCRIPTION_CHARS,
} from "../../../../src/server/agent/plugins/prompts/course/model-steps/style-recipe-inspiration";

describe("HTML style recipe inspiration", () => {
  it("extracts only a bounded YAML frontmatter description", () => {
    const description = "A".repeat(MAX_STYLE_RECIPE_DESCRIPTION_CHARS + 200);
    const source = [
      "---",
      "name: Test Recipe",
      `description: ${description}`,
      "colors:",
      '  secret-token: "#ffffff"',
      "---",
      "# Full recipe body",
      "deck runtime implementation details",
    ].join("\n");

    const extracted = extractStyleRecipeDescription(source);

    expect(extracted).toHaveLength(MAX_STYLE_RECIPE_DESCRIPTION_CHARS);
    expect(extracted).toBe("A".repeat(MAX_STYLE_RECIPE_DESCRIPTION_CHARS));
    expect(extracted).not.toContain("secret-token");
    expect(extracted).not.toContain("Full recipe body");
  });

  it.each([
    "A fixed 1920×1080 stage.",
    "Copy the deck runtime.",
    "Use deck-stage and viewport-base.css.",
  ])("rejects deck runtime guidance: %s", (description) => {
    expect(
      extractStyleRecipeDescription(
        `---\nname: Unsafe\ndescription: ${description}\n---\nbody`,
      ),
    ).toBeUndefined();
  });
});
