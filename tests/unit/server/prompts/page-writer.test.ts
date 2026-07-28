import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildPageWriterPrompts } from "../../../../src/server/prompts/page-writer";
import { getFunctionalTemplate } from "../../../../src/shared/templates/functional";

describe("Page Writer prompts", () => {
  it("states the allowed content density values", async () => {
    const pagePlan = courseDesignOutline.pages[1];
    const functionalTemplate = getFunctionalTemplate(
      pagePlan.functionalTemplateId,
    );

    expect(functionalTemplate).toBeDefined();

    const prompts = await buildPageWriterPrompts({
      courseIntent: courseDesignIntent,
      pagePlan,
      pageWorkerBrief: {
        pageId: pagePlan.id,
        styleTemplateId: visualBrief.styleTemplateId,
        pedagogy: pedagogyPlan.pageGuidance[1],
        story: storyArc.pageBeats[1],
        visual: visualBrief.pageGuidance[1],
      },
      functionalTemplate,
      validationFeedback: {
        code: "SCHEMA_ERROR",
        issues: ["questions.0.correctOptionIndex 超出 options 范围"],
      },
    });

    expect(prompts.version).toBe("2.3.0/2.2.0");
    expect(prompts.systemPrompt).toContain(
      "contentDensity 只能是 sparse、balanced、dense",
    );
    expect(prompts.systemPrompt).toContain(
      "每道题只包含 prompt、options、correctOptionIndex",
    );
    expect(prompts.systemPrompt).toContain(
      "若 validationFeedback 非 null，必须返回完整的新 JSON object",
    );
    expect(prompts.systemPrompt).toContain(
      "PageContentDSL 整体必须直接满足 PagePlan.learningObjective",
    );
    expect(prompts.systemPrompt).toContain(
      "未来时引导只能用于衔接，不能代替当前 learningObjective",
    );
    expect(prompts.systemPrompt).toContain(
      "即使 FunctionalTemplate 不允许 blocks、blocks 必须为空数组",
    );
    expect(prompts.systemPrompt).toContain(
      "练习页必须真实检验本页 learningObjective",
    );
    expect(prompts.systemPrompt).toContain(
      "不依赖根文档或嵌套正文滚动",
    );
    expect(prompts.systemPrompt).toContain(
      "`dense` 只表示紧凑分组",
    );
    expect(prompts.userPrompt).toContain(
      '"issues":["questions.0.correctOptionIndex 超出 options 范围"]',
    );
  });
});
