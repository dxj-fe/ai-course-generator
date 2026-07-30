import { describe, expect, it } from "vitest";

import {
  ArchitectureSubmissionSchema,
  CourseArchitectureSchema,
  CourseCreationBriefSchema,
  type CourseArchitecture,
} from "../../../src/shared/course-schema";

const COURSE_ID = "course-domain-test";
const REFERENCE_PACK_ID = "ref-aaaaaaaaaaaaaaaaaaaaaaaa";

describe("多 Agent 课程架构 Schema", () => {
  it("接受当前 Keya 前端可直接上移的 CourseCreationBrief", () => {
    expect(
      CourseCreationBriefSchema.parse({
        originalRequest: "给零基础用户做一门太阳系互动课",
        topic: "太阳系",
        audience: "零基础用户",
        goal: "能够解释太阳系的基本结构",
        sectionCount: "auto",
        learningMode: "mixed",
        language: "zh-CN",
      }),
    ).toMatchObject({
      topic: "太阳系",
      sectionCount: "auto",
    });

    expect(
      CourseCreationBriefSchema.safeParse({
        originalRequest: "生成课程",
        topic: "测试",
        audience: "初学者",
        learningMode: "unknown",
        language: "zh-CN",
      }).success,
    ).toBe(false);
  });

  it("接受 CoursePack + 不含 pages 的 Blueprint + PageTask[] 单一架构", () => {
    const architecture = CourseArchitectureSchema.parse(createArchitecture());

    expect(architecture.blueprint).not.toHaveProperty("pages");
    expect(architecture.pageTasks).toHaveLength(2);
    expect(architecture.pageTasks[0]).toMatchObject({
      pageType: "knowledge_card",
      interactionType: "reveal",
      assetNeeds: [
        {
          type: "illustration",
          role: "inline",
        },
      ],
    });
    expect(architecture.coursePack.terms[0].sourceUsages).toEqual([]);
  });

  it("拒绝重复 objective ID", () => {
    const architecture = createArchitecture();
    architecture.blueprint.objectives[1].id =
      architecture.blueprint.objectives[0].id;

    expect(CourseArchitectureSchema.safeParse(architecture).success).toBe(
      false,
    );
  });

  it("拒绝重复 pageId 和不连续页面顺序", () => {
    const duplicatePage = createArchitecture();
    duplicatePage.pageTasks[1].pageId = duplicatePage.pageTasks[0].pageId;

    const brokenOrder = createArchitecture();
    brokenOrder.pageTasks[1].order = 3;

    expect(CourseArchitectureSchema.safeParse(duplicatePage).success).toBe(
      false,
    );
    expect(CourseArchitectureSchema.safeParse(brokenOrder).success).toBe(
      false,
    );
  });

  it("拒绝页面引用不存在的目标或生成依赖", () => {
    const unknownObjective = createArchitecture();
    unknownObjective.pageTasks[0].objectiveIds = ["objective-missing"];

    const unknownDependency = createArchitecture();
    unknownDependency.pageTasks[1].buildDependsOnPageIds = ["page-missing"];

    expect(CourseArchitectureSchema.safeParse(unknownObjective).success).toBe(
      false,
    );
    expect(CourseArchitectureSchema.safeParse(unknownDependency).success).toBe(
      false,
    );
  });

  it("拒绝 buildDependsOnPageIds 形成依赖环", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[0].buildDependsOnPageIds = ["page-practice"];
    architecture.pageTasks[1].buildDependsOnPageIds = ["page-concept"];

    const result = CourseArchitectureSchema.safeParse(architecture);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(({ message }) => message.includes("依赖环"))).toBe(
        true,
      );
    }
  });

  it("展示顺序与生成依赖互不冒充：允许前一展示页读取后一展示页产物", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[0].buildDependsOnPageIds = ["page-practice"];
    architecture.pageTasks[1].buildDependsOnPageIds = [];

    const result = CourseArchitectureSchema.safeParse(architecture);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageTasks.map(({ order }) => order)).toEqual([1, 2]);
      expect(result.data.pageTasks[0].buildDependsOnPageIds).toEqual([
        "page-practice",
      ]);
    }
  });

  it("每个目标都必须有教学覆盖和明确的练习证据", () => {
    const missingTeaching = createArchitecture();
    missingTeaching.pageTasks[1].objectiveIds = ["objective-concept"];

    const missingAssessment = createArchitecture();
    missingAssessment.pageTasks[1].assessment = undefined;

    expect(CourseArchitectureSchema.safeParse(missingTeaching).success).toBe(
      false,
    );
    expect(CourseArchitectureSchema.safeParse(missingAssessment).success).toBe(
      false,
    );
  });

  it("资料引用必须同时提供 Reference Pack 与 chunk，且同位置不重复 Pack", () => {
    const missingPack = createArchitecture() as unknown as {
      pageTasks: Array<Record<string, unknown>>;
    };
    missingPack.pageTasks[0].referenceUsages = [
      {
        chunkIds: ["chunk-01"],
      },
    ];

    const duplicatePack = createArchitecture();
    duplicatePack.pageTasks[0].referenceUsages = [
      {
        referencePackId: REFERENCE_PACK_ID,
        chunkIds: ["chunk-01"],
      },
      {
        referencePackId: REFERENCE_PACK_ID,
        chunkIds: ["chunk-02"],
      },
    ];

    expect(CourseArchitectureSchema.safeParse(missingPack).success).toBe(false);
    expect(CourseArchitectureSchema.safeParse(duplicatePack).success).toBe(
      false,
    );
  });

  it("ArchitectureSubmission 只能引用整组 course_architecture Artifact", () => {
    const validRef = createArtifactRef("course_architecture");
    const invalidRef = {
      ...createArtifactRef("page_html", "page-concept"),
      kind: "page_html",
    };

    expect(
      ArchitectureSubmissionSchema.safeParse({
        architectureRef: validRef,
      }).success,
    ).toBe(true);
    expect(
      ArchitectureSubmissionSchema.safeParse({
        architectureRef: invalidRef,
      }).success,
    ).toBe(false);
  });
});

function createArchitecture(): CourseArchitecture {
  return {
    version: 1,
    courseId: COURSE_ID,
    coursePack: {
      version: 1,
      courseId: COURSE_ID,
      topic: "太阳系",
      facts: [
        {
          id: "fact-sun",
          text: "太阳是太阳系的恒星。",
          sourceUsages: [
            {
              referencePackId: REFERENCE_PACK_ID,
              chunkIds: ["chunk-01"],
            },
          ],
        },
      ],
      terms: [
        {
          term: "恒星",
          definition: "能够自身发光发热的天体。",
          sourceUsages: [],
        },
      ],
      examples: [
        {
          id: "example-earth",
          summary: "地球围绕太阳运行。",
          sourceUsages: [
            {
              referencePackId: REFERENCE_PACK_ID,
              chunkIds: ["chunk-02"],
            },
          ],
        },
      ],
      constraints: ["不把行星描述为自身发光"],
    },
    blueprint: {
      version: 1,
      courseId: COURSE_ID,
      title: "两步认识太阳系",
      audience: {
        description: "零基础学习者",
        priorKnowledge: ["知道地球是一颗行星"],
        difficulty: "beginner",
        ageRange: {
          min: 8,
          max: 12,
          label: "8-12 岁",
        },
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-concept",
          outcome: "解释恒星与行星的基本区别",
          evidence: "完成一次概念判断",
        },
        {
          id: "objective-apply",
          outcome: "用所学判断一个天体的类型",
          evidence: "完成一次情境练习",
        },
      ],
      courseRules: {
        tone: "清楚、友好",
        terminology: ["恒星", "行星"],
        visualDirection: "以简单轨道和天体卡片辅助理解",
        visualStyle: "kids-playful",
        styleTemplateId: "style-kids-playful",
        teachingPattern: ["先给例子", "再解释概念", "最后练习"],
      },
    },
    pageTasks: [
      {
        version: 1,
        pageId: "page-concept",
        order: 1,
        title: "恒星与行星",
        pageType: "knowledge_card",
        purpose: "建立两个核心概念",
        objectiveIds: ["objective-concept"],
        buildDependsOnPageIds: [],
        teachingPoints: ["恒星能够自身发光", "行星围绕恒星运行"],
        learnerAction: "展开卡片后用自己的话说出区别",
        assessment: "选择哪个天体属于恒星并说明原因",
        referenceUsages: [
          {
            referencePackId: REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "template-knowledge-card",
        styleTemplateId: "style-kids-playful",
        interactionType: "reveal",
        assetNeeds: [
          {
            type: "illustration",
            role: "inline",
            purpose: "展示恒星与行星的视觉区别",
            required: false,
          },
        ],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能够说出恒星和行星的一项区别",
          requiresInteraction: true,
          pageSpecific: ["展开前后内容不能重复"],
        },
      },
      {
        version: 1,
        pageId: "page-practice",
        order: 2,
        title: "判断天体类型",
        pageType: "quiz",
        purpose: "把概念用于具体判断",
        objectiveIds: ["objective-apply"],
        buildDependsOnPageIds: ["page-concept"],
        teachingPoints: ["根据是否自身发光判断天体类型"],
        learnerAction: "选择答案并查看针对性反馈",
        assessment: "根据描述判断目标天体是恒星还是行星",
        referenceUsages: [
          {
            referencePackId: REFERENCE_PACK_ID,
            chunkIds: ["chunk-02"],
          },
        ],
        functionalTemplateId: "template-quiz",
        styleTemplateId: "style-kids-playful",
        interactionType: "choice",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能够用依据完成天体类型判断",
          requiresInteraction: true,
          pageSpecific: ["错误答案必须有解释"],
        },
      },
    ],
  };
}

function createArtifactRef(
  kind:
    | "course_architecture"
    | "page_html",
  pageId?: string,
) {
  return {
    id: `artifact-${kind}`,
    kind,
    courseId: COURSE_ID,
    pageId,
    scopeKey: pageId ? `page:${pageId}` : "course",
    version: 1,
    contentHash: "1234567890abcdef",
  };
}
