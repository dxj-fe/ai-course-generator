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

  it("keeps contentDensity strict at the final DSL boundary", () => {
    const invalid = {
      ...pageContentDsl,
      layoutHints: {
        ...pageContentDsl.layoutHints,
        contentDensity: "medium",
      },
    };

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

    if (!quiz) {
      throw new Error("Expected an interactive-quiz DSL example");
    }
    expect(quiz.interaction.type).toBe("choice");
    if (quiz.interaction.type !== "choice") {
      throw new Error("Expected the quiz example to use a choice interaction");
    }

    expect(quiz.interaction.questions).toHaveLength(3);
    expect(quiz.interaction.questions[1].correctOptionId).toBe("option-02-01");
    expect(quiz.interaction.questions[2].feedback.success).toContain("土星");
  });

  it("keeps v1 content compatible and requires a runtime plan for v2", () => {
    expect(PageContentDSLSchema.safeParse(pageContentDsl).success).toBe(true);
    expect(
      PageContentDSLSchema.safeParse({
        ...pageContentDsl,
        version: 2,
      }).success,
    ).toBe(false);

    const parsed = PageContentDSLSchema.parse({
      ...pageContentDsl,
      version: 2,
      runtime: {
        runtimeVersion: 1,
        sceneKind: "demo",
        visualPrimitive: "concept-map",
        motionPlan: {
          intensity: "guided",
          cuePoints: [
            {
              id: "cue-block-01",
              action: "reveal",
              targetId: "block-01",
              delayMs: 120,
              durationMs: 420,
            },
          ],
        },
        completionRule: {
          type: "interaction-complete",
          interactionId: "interaction-page-02-knowledge",
        },
      },
    });

    expect(parsed.version).toBe(2);
    expect(parsed.runtime?.visualPrimitive).toBe("concept-map");
  });
});
