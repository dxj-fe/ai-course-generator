import { describe, expect, it } from "vitest";

import {
  CoursePlanDraftSchema,
  projectCoursePlanDraft,
} from "../../../../src/server/agent/plugins/agents/course/architect-draft";
import {
  COURSE_ID,
  createBrief,
} from "../../../fixtures/course-architecture";

function createDraft() {
  return CoursePlanDraftSchema.parse({
    title: "四页理解恒星与行星",
    difficulty: "beginner",
    objectives: [
      {
        outcome: "能根据是否自身发光区分恒星和行星",
        evidence: "完成分类并说明判断依据",
      },
    ],
    facts: [],
    terms: [
      {
        term: "恒星",
        definition: "能够自身发光发热的天体",
      },
    ],
    examples: [],
    constraints: ["不虚构精确天文数据"],
    tone: "清楚、鼓励探索",
    visualDirection: "以光路和轨道作为持续视觉母题",
    visualStyle: "minimal",
    pages: Array.from({ length: 4 }, (_, index) => ({
      title: `页面 ${index + 1}`,
      purpose: `完成第 ${index + 1} 个学习职责`,
      objectiveNumbers: [1],
      buildDependsOnPageNumbers: [],
      teachingPoints: ["是否能够自身发光"],
      learnerAction: "观察并说出判断依据",
      assessment: "能说出是否自身发光这一依据",
      requiresInteraction: index === 2,
      visualDesign: {
        theme: "光线与轨道",
        layout: "让判断线索成为画面主角",
        graphicMotif: "用光线方向表达能量来源",
      },
    })),
  });
}

describe("Course Lead 轻量 draft 投影", () => {
  it("由 Harness 补齐稳定 ID、Brief 字段和兼容默认值", () => {
    const architecture = projectCoursePlanDraft({
      courseId: COURSE_ID,
      creationBrief: createBrief(),
      draft: createDraft(),
    });

    expect(architecture).toMatchObject({
      courseId: COURSE_ID,
      coursePack: {
        courseId: COURSE_ID,
        topic: "太阳系",
      },
      blueprint: {
        courseId: COURSE_ID,
        audience: { description: "零基础成年人" },
        language: "zh-CN",
        objectives: [{ id: "objective-01" }],
      },
    });
    expect(architecture.pageTasks).toHaveLength(4);
    expect(architecture.pageTasks[0]).toMatchObject({
      pageId: "page-01",
      order: 1,
      objectiveIds: ["objective-01"],
      pageType: "knowledge_card",
      functionalTemplateId: "agent-authored",
      styleTemplateId: "agent-authored",
      interactionType: "none",
      assetNeeds: [],
    });
    expect(architecture.blueprint.courseRules.terminology).toEqual([
      "恒星",
    ]);
  });
});
