import { describe, expect, it } from "vitest";

import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildHtmlEngineerPrompts } from "../../../../src/server/prompts/html-engineer";
import { getFunctionalTemplate } from "../../../../src/shared/templates/functional";
import { getStyleTemplate } from "../../../../src/shared/templates/style";

describe("HTML Engineer prompts", () => {
  it("renders only the resolved DSL, templates and visual contracts", async () => {
    const functionalTemplate = getFunctionalTemplate(
      pageContentDsl.functionalTemplateId,
    );
    const styleTemplate = getStyleTemplate(visualBrief.styleTemplateId);
    const pageGuidance = visualBrief.pageGuidance.find(
      ({ pageId }) => pageId === pageContentDsl.pageId,
    );
    expect(functionalTemplate && styleTemplate && pageGuidance).toBeTruthy();

    const prompts = await buildHtmlEngineerPrompts({
      pageContentDsl,
      functionalTemplate,
      styleTemplate: styleTemplate!,
      visualBrief,
      pageGuidance,
    });

    expect(prompts.version).toBe("1.0.0/1.0.0");
    expect(prompts.systemPrompt).toContain("禁止任何 `<script>`");
    expect(prompts.userPrompt).toContain(pageContentDsl.pageId);
    expect(prompts.userPrompt).toContain("--course-color-background");
    expect(prompts.userPrompt).not.toContain("为 8 岁儿童设计一门");
  });

  it.each(["sci-fi", "kids-playful", "minimal"])(
    "injects the %s style contract for the same DSL",
    async (styleId) => {
      const functionalTemplate = getFunctionalTemplate(
        pageContentDsl.functionalTemplateId,
      );
      const styleTemplate = getStyleTemplate(styleId);
      const pageGuidance = visualBrief.pageGuidance.find(
        ({ pageId }) => pageId === pageContentDsl.pageId,
      );
      expect(functionalTemplate && styleTemplate && pageGuidance).toBeTruthy();

      const prompts = await buildHtmlEngineerPrompts({
        pageContentDsl,
        functionalTemplate,
        styleTemplate: styleTemplate!,
        visualBrief: { ...visualBrief, styleTemplateId: styleId },
        pageGuidance,
      });

      expect(prompts.userPrompt).toContain(`\"id\":\"${styleId}\"`);
      expect(prompts.userPrompt).toContain(styleTemplate!.colorTokens.primary);
    },
  );
});
