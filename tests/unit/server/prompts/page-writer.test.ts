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

    expect(prompts.version).toBe("2.10.2/2.2.0");
    expect(prompts.systemPrompt).toContain(
      "contentDensity 只能是 sparse、balanced、dense",
    );
    expect(prompts.systemPrompt).toContain(
      "去除标点后至少包含 10 个有效字符",
    );
    expect(prompts.systemPrompt).toContain(
      "每个 body 压到 40 字内",
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
    expect(prompts.systemPrompt).toContain(
      "只要页面声明任何 assetSlots",
    );
    expect(prompts.systemPrompt).toContain(
      "互动只提供短标签和一条不同于 block 正文的因果衔接、证据或后续影响",
    );
    expect(prompts.systemPrompt).toContain(
      "禁止同时生成“3 个长故事块 + 4 个选项 + 必需插图”",
    );
    expect(prompts.systemPrompt).toContain(
      "禁止同时生成“3 个任务块 + 长输入说明 + 必需插图”",
    );
    expect(prompts.systemPrompt).toContain(
      "可见中文总量不超过约 280 个汉字",
    );
    expect(prompts.systemPrompt).toContain(
      "questions 必须且只能包含 1 道完整题目",
    );
    expect(prompts.systemPrompt).toContain(
      "items 中每项必须是只包含 label、content 的对象",
    );
    expect(prompts.systemPrompt).toContain(
      "不能重复 label",
    );
    expect(prompts.systemPrompt).toContain(
      "不能只列关键词",
    );
    expect(prompts.systemPrompt).toContain(
      "input 和 sort 在 interaction 根级返回 feedbackSuccess、feedbackRetry",
    );
    expect(prompts.systemPrompt).toContain(
      "choice 的根级 feedbackSuccess、feedbackRetry 必须为空数组",
    );
    expect(prompts.systemPrompt).toContain(
      "还缺少『评价标准』，请补充",
    );
    expect(prompts.systemPrompt).toContain(
      "不得只改字数或增加鼓励语",
    );
    expect(prompts.userPrompt).toContain(
      '"issues":["questions.0.correctOptionIndex 超出 options 范围"]',
    );
  });
});
