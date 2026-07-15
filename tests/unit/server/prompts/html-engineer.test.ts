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

    expect(prompts.version).toBe("1.1.5/1.0.0");
    expect(prompts.systemPrompt).toContain("禁止任何 `<script>`");
    expect(prompts.systemPrompt).toContain("不得交换槽位");
    expect(prompts.systemPrompt).toContain("精确 altText");
    expect(prompts.systemPrompt).toContain("只包裹一个此类直接消费节点");
    expect(prompts.systemPrompt).toContain(
      "唯一 class、唯一 id、精确 `[data-asset-slot-id",
    );
    expect(prompts.systemPrompt).toContain("不使用其他命名实体");
    expect(prompts.systemPrompt).toContain("`none` 页面不要为了标记");
    expect(prompts.systemPrompt).toContain(
      "`feedback.retry` 只属于答错后的条件状态",
    );
    expect(prompts.systemPrompt).toContain(
      "choice prompt 若只比对应 question block 的 body 多一个纯题号前缀",
    );
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
