import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildPageWriterPrompts } from "../../../../src/server/agent/plugins/prompts/course/model-steps/page-writer";

describe("Page Writer prompts", () => {
  it("用紧凑 page brief 指导首轮语义写作，不注入模板槽位合同", async () => {
    const pagePlan = courseDesignOutline.pages[1];

    const prompts = await buildPageWriterPrompts({
      pageBrief: {
        course: {
          title: "理解太阳系",
          audience: courseDesignIntent.audienceAgeRange,
          language: courseDesignIntent.language,
          learningGoal: courseDesignIntent.learningGoal,
          objectives: [pagePlan.learningObjective],
          tone: "清楚、好奇",
          terminology: [],
          facts: [{ id: "fact-01", text: "行星绕恒星运行。" }],
          terms: [{ term: "轨道", definition: "天体运行的路径。" }],
          constraints: courseDesignIntent.avoid,
        },
        page: {
          id: pagePlan.id,
          title: pagePlan.title,
          pageType: pagePlan.pageType,
          objective: pagePlan.learningObjective,
          interactionType: pagePlan.interactionType,
          task: {
            purpose: "比较恒星与行星",
            learnerAction: "根据特征完成分类",
          },
          pedagogy: pedagogyPlan.pageGuidance[1],
          visualFocus: visualBrief.pageGuidance[1],
          neighbors: [
            { pageId: "page-01", purpose: "建立太阳系整体模型" },
          ],
          dependencySummaries: [],
          assetNeeds: pagePlan.assetNeeds,
        },
      },
      validationFeedback: {
        code: "SCHEMA_ERROR",
        issues: ["questions.0.correctOptionIndex 超出 options 范围"],
      },
    });

    expect(prompts.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(prompts.systemPrompt).toContain("首稿就应值得交付");
    expect(prompts.systemPrompt).toContain(
      "用最少但充分的文字完成本页唯一认知动作",
    );
    expect(prompts.systemPrompt).toContain(
      "PageBrief 是本页职责、事实锚点、受众、前后页分工、互动意图和视觉重心的唯一输入",
    );
    expect(prompts.systemPrompt).toContain("blocks 是语义锚点");
    expect(prompts.systemPrompt).toContain(
      "只保留互动之外不可缺少的共同依据",
    );
    expect(prompts.systemPrompt).toContain(
      "不自作主张补充波长区间、倍数、百分比、年份",
    );
    expect(prompts.systemPrompt).toContain(
      "继承 facts 中的观察对象、比较范围和程度限定",
    );
    expect(prompts.systemPrompt).toContain(
      "保留事实中的因果主体、作用方向、比较范围和限定词",
    );
    expect(prompts.systemPrompt).toContain(
      "互动项承担实际观察、比较或判断",
    );
    expect(prompts.systemPrompt).toContain(
      "PAGE_WRITER_CAPACITY_REWRITE",
    );
    expect(prompts.systemPrompt).toContain(
      "合并重复语义，让互动承担对应证据",
    );
    expect(prompts.systemPrompt).toContain(
      "body 用最短但可独立理解的表达",
    );
    expect(prompts.systemPrompt).toContain("不为凑字数扩写");
    expect(prompts.systemPrompt).toContain("无滚动的 16:9 教学舞台");
    expect(prompts.systemPrompt).toContain(
      "choice 只问一道最有诊断价值的问题",
    );
    expect(prompts.systemPrompt).toContain(
      "让每条必要事实只出现一次",
    );
    expect(prompts.systemPrompt).toContain(
      "按 type 只输出该类型真实需要的字段",
    );
    expect(prompts.systemPrompt).not.toContain("FunctionalTemplate");
    expect(prompts.systemPrompt).not.toContain("contentDensity");
    expect(prompts.systemPrompt).not.toContain("散射出直射光束");
    expect(prompts.systemPrompt).not.toContain("12–24 个中文字");
    expect(prompts.userPrompt).toContain('"title":"理解太阳系"');
    expect(prompts.userPrompt).toContain('"id":"fact-01"');
    expect(prompts.userPrompt).toContain('"term":"轨道"');
    expect(prompts.userPrompt).toContain(
      '"purpose":"建立太阳系整体模型"',
    );
    expect(prompts.userPrompt).toContain(
      '"issues":["questions.0.correctOptionIndex 超出 options 范围"]',
    );
    expect(prompts.userPrompt).not.toContain('"functionalTemplateId"');
  });
});
