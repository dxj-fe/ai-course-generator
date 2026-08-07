import { describe, expect, it } from "vitest";

import { projectCourseArchitecture } from "@/server/course/projection/architecture";
import {
  CourseArchitectureSchema,
  CourseCreationBriefSchema,
} from "@/shared/course-schema";

describe("CourseArchitecture 当前投影", () => {
  it("把单一架构真相投影为现有页面生成合同", () => {
    const projected = projectCourseArchitecture(
      architectureFixture(),
      creationBriefFixture(),
    );

    expect(projected.intent).toMatchObject({
      topic: "光合作用",
      courseLength: 3,
      visualStyle: "minimal",
    });
    expect(projected.outline.pages.map(({ id }) => id)).toEqual([
      "page-1",
      "page-2",
      "page-3",
    ]);
    expect(projected.outline.pages[1]?.dependsOnPageIds).toEqual([]);
    expect(projected.briefs.visual.styleTemplateId).toBe("minimal");
    expect(projected.briefs.visual.pageGuidance).toEqual([
      expect.objectContaining({
        theme: "课程目标的内容隐喻",
        composition: expect.stringContaining("cover页面"),
      }),
      expect.objectContaining({
        theme: "叶片把光变成能量的微型工厂",
        composition: "左侧展示光线进入叶片，右侧沿反应路径解释并完成揭示",
        graphicMotif: "用光束、叶片截面和能量流箭头连接输入与输出",
      }),
      expect.objectContaining({
        theme: "回顾与练习的内容隐喻",
        composition: expect.stringContaining("summary页面"),
      }),
    ]);
    expect(projected.pageWorkerBriefs).toHaveLength(3);
  });

  it("不再用整课模板 ID 阻断页面投影", () => {
    const architecture = architectureFixture();
    architecture.pageTasks[1]!.styleTemplateId = "nature";

    const projected = projectCourseArchitecture(
      architecture,
      creationBriefFixture(),
    );

    expect(projected.outline.pages[1]?.styleTemplateId).toBe("nature");
  });

  it("允许最终选择题在反馈中承担紧凑课程回扣", () => {
    const architecture = architectureFixture();
    architecture.pageTasks[2] = {
      ...architecture.pageTasks[2]!,
      pageType: "quiz",
      interactionType: "choice",
      functionalTemplateId: "interactive-quiz",
    };

    const projected = projectCourseArchitecture(
      architecture,
      creationBriefFixture(),
    );

    expect(projected.outline.pages[2]).toMatchObject({
      pageType: "quiz",
      interactionType: "choice",
      functionalTemplateId: "interactive-quiz",
    });
  });

  it("从用户受众描述推导学龄范围，不把小学课程投影为成人课程", () => {
    const architecture = architectureFixture();
    architecture.blueprint.audience.description = "小学五年级学生";

    const projected = projectCourseArchitecture(
      architecture,
      creationBriefFixture(),
    );

    expect(projected.intent.audienceAgeRange).toEqual({
      min: 10,
      max: 11,
      label: "小学五年级学生",
    });
  });
});

function creationBriefFixture() {
  return CourseCreationBriefSchema.parse({
    originalRequest: "给初学者生成一门光合作用互动课",
    topic: "光合作用",
    audience: "初学者",
    goal: "理解光合作用并能解释基本过程",
    sectionCount: 3,
    learningMode: "mixed",
    language: "zh-CN",
  });
}

function architectureFixture() {
  return CourseArchitectureSchema.parse({
    courseId: "course-architecture-fixture",
    coursePack: {
      courseId: "course-architecture-fixture",
      topic: "光合作用",
      facts: [],
      terms: [],
      examples: [],
      constraints: [],
    },
    blueprint: {
      courseId: "course-architecture-fixture",
      title: "光合作用入门",
      audience: {
        description: "没有生物学基础的初学者",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-1",
          outcome: "解释光合作用的基本过程",
          evidence: "能完成一道过程判断题",
        },
      ],
      courseRules: {
        tone: "清楚、直接、友好",
        terminology: ["光合作用"],
        visualDirection: "用简洁图形展示能量与物质变化",
        visualStyle: "minimal",
        styleTemplateId: "minimal",
        teachingPattern: ["先直观解释，再主动练习"],
      },
    },
    pageTasks: [
      pageTask({
        pageId: "page-1",
        order: 1,
        title: "课程目标",
        pageType: "cover",
        interactionType: "navigate",
        functionalTemplateId: "course-cover",
      }),
      pageTask({
        pageId: "page-2",
        order: 2,
        title: "光合作用如何发生",
        pageType: "knowledge_card",
        interactionType: "reveal",
        functionalTemplateId: "knowledge-card-grid",
      }),
      pageTask({
        pageId: "page-3",
        order: 3,
        title: "回顾与练习",
        pageType: "summary",
        interactionType: "choice",
        functionalTemplateId: "recap-summary",
        assessment: "完成过程判断并解释答案",
      }),
    ],
  });
}

function pageTask(
  overrides: Partial<{
    pageId: string;
    order: number;
    title: string;
    pageType:
      | "cover"
      | "knowledge_card"
      | "summary";
    interactionType: "navigate" | "reveal" | "choice";
    functionalTemplateId: string;
    assessment: string;
  }>,
) {
  return {
    pageId: overrides.pageId,
    order: overrides.order,
    title: overrides.title,
    pageType: overrides.pageType,
    purpose: `帮助学习者理解${overrides.title}`,
    objectiveIds: ["objective-1"],
    buildDependsOnPageIds: [],
    teachingPoints: ["光合作用把光能转成可利用的化学能"],
    learnerAction: "阅读要点并完成页面操作",
    assessment:
      overrides.assessment ??
      (overrides.order === 1 ? undefined : "说出本页最重要的结论"),
    referenceUsages: [],
    functionalTemplateId: overrides.functionalTemplateId,
    styleTemplateId: "minimal",
    interactionType: overrides.interactionType,
    assetNeeds: [],
    ...(overrides.order === 2
      ? {
          visualDesign: {
            theme: "叶片把光变成能量的微型工厂",
            layout: "左侧展示光线进入叶片，右侧沿反应路径解释并完成揭示",
            graphicMotif: "用光束、叶片截面和能量流箭头连接输入与输出",
          },
        }
      : {}),
    acceptance: {
      requiredConcepts: ["光合作用"],
      expectedLearnerOutcome: "能用自己的话说明本页核心内容",
      requiresInteraction: true,
      pageSpecific: ["页面职责清楚且不重复"],
    },
  };
}
