import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildPageWriterPrompts } from "../../../../src/server/agent/plugins/prompts/course/model-steps/page-writer";
import { getFunctionalTemplate } from "../../../../src/shared/templates/functional";

describe("Page Writer prompts", () => {
  it("优先提供完整课程方向和首轮生成质量，而不是堆叠末端修复规则", async () => {
    const pagePlan = courseDesignOutline.pages[1];
    const functionalTemplate = getFunctionalTemplate(
      pagePlan.functionalTemplateId,
    );

    expect(functionalTemplate).toBeDefined();

    const prompts = await buildPageWriterPrompts({
      courseIntent: courseDesignIntent,
      courseArchitectureContext: {
        courseTitle: "理解太阳系",
        pageTask: {
          purpose: "比较恒星与行星",
          learnerAction: "根据特征完成分类",
        },
        neighboringPageTasks: [
          { pageId: "page-01", purpose: "建立太阳系整体模型" },
        ],
      },
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

    expect(prompts.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(prompts.systemPrompt).toContain(
      "首轮结果应当已经值得交付",
    );
    expect(prompts.systemPrompt).toContain(
      "CourseArchitecture Context 是本页最完整的课程事实与职责来源",
    );
    expect(prompts.systemPrompt).toContain(
      "表达方式由你在边界内决定",
    );
    expect(prompts.systemPrompt).toContain(
      "固定画布不是字符竞赛",
    );
    expect(prompts.systemPrompt).toContain(
      "模板没有声明的槽必须返回空数组",
    );
    expect(prompts.systemPrompt).toContain(
      "不得受下面“通常使用 2–4 个 blocks”的一般建议影响",
    );
    expect(prompts.systemPrompt).toContain(
      "`visualPriority` 和 `groupingStrategy` 各自是一句简洁字符串",
    );
    expect(prompts.systemPrompt).toContain(
      "`contentDensity` 只能是 `sparse`、`balanced`、`dense`",
    );
    expect(prompts.systemPrompt).toContain(
      "choice 只保留最能检验核心判断依据的一题",
    );
    expect(prompts.systemPrompt).toContain(
      "支持性 blocks 只取模板允许的最小充分数量",
    );
    expect(prompts.systemPrompt).toContain(
      "不要无方向扩写",
    );
    expect(prompts.systemPrompt).toContain(
      "不编造事实、不改目标",
    );
    expect(prompts.userPrompt).toContain('"courseTitle":"理解太阳系"');
    expect(prompts.userPrompt).toContain(
      '"purpose":"建立太阳系整体模型"',
    );
    expect(prompts.userPrompt).toContain(
      '"issues":["questions.0.correctOptionIndex 超出 options 范围"]',
    );
  });
});
