import { describe, expect, it } from "vitest";

import { pageContentDsl } from "../../fixtures/course-design";
import { PageContentDSLSchema } from "../../../src/shared/course-schema";
import {
  functionalTemplateDslExamples,
  getFunctionalTemplate,
  getFunctionalTemplateDslExample,
} from "../../../src/shared/templates/functional";

describe("PageContentDSL", () => {
  it("accepts a semantic page contract without HTML implementation fields", () => {
    const parsed = PageContentDSLSchema.parse(pageContentDsl);

    expect(parsed.pageId).toBe("page-02-knowledge");
    expect(parsed.interaction.type).toBe("reveal");
    expect(JSON.stringify(parsed)).not.toMatch(/className|<div|<section|css/i);
  });

  it("rejects HTML markup inside content", () => {
    const invalid = structuredClone(pageContentDsl);
    invalid.blocks[0].body = "<section>模型越界生成的内容</section>";

    expect(PageContentDSLSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a reading order that does not cover every block", () => {
    const invalid = structuredClone(pageContentDsl);
    invalid.layoutHints.readingOrder = ["block-01"];

    expect(PageContentDSLSchema.safeParse(invalid).success).toBe(false);
  });

  it("provides one valid DSL example for every functional template", () => {
    expect(functionalTemplateDslExamples).toHaveLength(8);

    for (const example of functionalTemplateDslExamples) {
      expect(PageContentDSLSchema.safeParse(example).success).toBe(true);
      expect(getFunctionalTemplate(example.functionalTemplateId)).toBeDefined();
      expect(
        getFunctionalTemplateDslExample(example.functionalTemplateId),
      ).toEqual(example);
    }
  });

  it("represents a multi-question quiz without flattening question feedback", () => {
    const quiz = getFunctionalTemplateDslExample("interactive-quiz");

    expect(quiz.interaction.type).toBe("choice");
    if (quiz.interaction.type !== "choice") {
      throw new Error("Expected the quiz example to use a choice interaction");
    }

    expect(quiz.interaction.questions).toHaveLength(3);
    expect(quiz.interaction.questions[1].correctOptionId).toBe("option-02-01");
    expect(quiz.interaction.questions[2].feedback.success).toContain("土星");
  });
});
