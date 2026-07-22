import { describe, expect, it, vi } from "vitest";

import {
  createCoursePlannerAgent,
  createCoursePlannerAgentState,
  normalizeCoursePlannerModelOutput,
  validateCoursePlannerOutput,
} from "../../../../src/server/agents/course-planner-agent";
import {
  CoursePlanSchema,
  type CourseIntent,
  type CoursePlan,
  type PageType,
  type ReferencePack,
  type VisualStyle,
} from "../../../../src/shared/course-schema";

type PlannerCase = {
  topic: string;
  titleKeyword: string;
  expectedPageType: PageType;
  visualStyle: VisualStyle;
  styleTemplateId: string;
};

const plannerCases: PlannerCase[] = [
  {
    topic: "太阳系",
    titleKeyword: "太阳系",
    expectedPageType: "quiz",
    visualStyle: "sci-fi",
    styleTemplateId: "sci-fi",
  },
  {
    topic: "火星探险",
    titleKeyword: "火星",
    expectedPageType: "achievement",
    visualStyle: "game-quest",
    styleTemplateId: "game-quest",
  },
  {
    topic: "垃圾分类",
    titleKeyword: "垃圾",
    expectedPageType: "comparison",
    visualStyle: "nature",
    styleTemplateId: "nature",
  },
  {
    topic: "AI 素养",
    titleKeyword: "AI",
    expectedPageType: "quiz",
    visualStyle: "professional",
    styleTemplateId: "minimal",
  },
  {
    topic: "古诗入门",
    titleKeyword: "古诗",
    expectedPageType: "knowledge_card",
    visualStyle: "blackboard",
    styleTemplateId: "blackboard",
  },
];

const referencePack: ReferencePack = {
  version: 1,
  id: "ref-1234567890abcdef12345678",
  sourceName: "solar.txt",
  sourceType: "txt",
  byteSize: 80,
  summary: "太阳风资料。",
  keyFacts: [{ text: "太阳风包含带电粒子。", chunkIds: ["chunk-01"] }],
  chunks: [{ id: "chunk-01", index: 1, text: "太阳风包含带电粒子。" }],
  truncated: false,
};

describe("CoursePlannerAgent", () => {
  it.each(plannerCases)(
    "plans a coherent five-page course for $topic",
    async (testCase) => {
      const intent = createIntent(testCase);
      const outline = createOutline(testCase);
      const generateOutline = vi.fn().mockResolvedValue(outline);
      const agent = createCoursePlannerAgent({ generateOutline });

      const result = await agent.run(createCoursePlannerAgentState(intent), {
        traceId: `planner-${testCase.styleTemplateId}`,
      });

      expect(result.status).toBe("completed");
      expect(result.outline?.pages).toHaveLength(5);
      expect(result.outline?.pages[0].pageType).toBe("cover");
      expect(result.outline?.pages.at(-1)?.pageType).toBe("summary");
      expect(
        result.outline?.pages.some(
          (page) => page.pageType === testCase.expectedPageType,
        ),
      ).toBe(true);
      expect(result.outline?.pages.some((page) => page.title.includes(testCase.titleKeyword))).toBe(
        true,
      );
      expect(
        new Set(result.outline?.pages.map((page) => page.styleTemplateId)),
      ).toEqual(new Set([testCase.styleTemplateId]));
      expect(result.events.map(({ type }) => type)).toEqual([
        "start",
        "model_call",
        "finish",
      ]);
      expect(generateOutline).toHaveBeenCalledWith(
        expect.objectContaining({ intent }),
      );
    },
  );

  it("rejects a plan whose page count differs from CourseIntent", () => {
    const testCase = plannerCases[0];
    const intent = createIntent(testCase);
    const outline = createOutline(testCase);

    expect(() =>
      validateCoursePlannerOutput(
        { ...outline, pages: outline.pages.slice(0, 4) },
        intent,
      ),
    ).toThrow("CoursePlan 结构校验失败");
  });

  it("rejects an invented functional template id", () => {
    const testCase = plannerCases[0];
    const intent = createIntent(testCase);
    const outline = structuredClone(createOutline(testCase));
    outline.pages[2].functionalTemplateId = "invented-template";

    expect(() => validateCoursePlannerOutput(outline, intent)).toThrow(
      "未知功能模板",
    );
  });

  it("passes Reference Packs to Planner and rejects invented chunk usages", async () => {
    const intent = createIntent(plannerCases[0]);
    const outline = structuredClone(createOutline(plannerCases[0]));
    outline.pages[1].usedReferences = [
      { referencePackId: referencePack.id, chunkIds: ["chunk-01"] },
    ];
    const generateOutline = vi.fn().mockResolvedValue(outline);
    const result = await createCoursePlannerAgent({ generateOutline }).run(
      createCoursePlannerAgentState(intent, [referencePack]),
      { traceId: "planner-reference" },
    );

    expect(result.status).toBe("completed");
    expect(generateOutline).toHaveBeenCalledWith(
      expect.objectContaining({ referencePacks: [referencePack] }),
    );

    outline.pages[1].usedReferences = [
      { referencePackId: referencePack.id, chunkIds: ["chunk-02"] },
    ];
    expect(() =>
      validateCoursePlannerOutput(outline, intent, [referencePack]),
    ).toThrow("不包含 chunk-02");
  });

  it("rejects a course without an active interaction", () => {
    const outline = structuredClone(createOutline(plannerCases[0]));

    for (const page of outline.pages) {
      page.interactionType = "navigate";
    }

    expect(CoursePlanSchema.safeParse(outline).success).toBe(false);
  });

  it("rejects explanation pages placed after an assessment", () => {
    const outline = structuredClone(createOutline(plannerCases[0]));
    outline.pages[3].pageType = "comparison";
    outline.pages[3].functionalTemplateId = "comparison-board";
    outline.pages[3].interactionType = "explore";

    expect(CoursePlanSchema.safeParse(outline).success).toBe(false);
  });

  it("normalizes only invalid interaction values from a valid page type", () => {
    const output = {
      overview: "高一数学课程规划。",
      learningObjectives: ["理解集合基础。"],
      pages: [
        { pageType: "cover", interactionType: "start-button" },
        { pageType: "knowledge_card", interactionType: "点击翻转" },
        { pageType: "quiz", interactionType: "multiple-choice" },
        { pageType: "summary", interactionType: "navigate" },
        { pageType: "invented", interactionType: "custom" },
      ],
    };

    expect(normalizeCoursePlannerModelOutput(output)).toEqual({
      ...output,
      pages: [
        { pageType: "cover", interactionType: "navigate" },
        { pageType: "knowledge_card", interactionType: "reveal" },
        { pageType: "quiz", interactionType: "choice" },
        { pageType: "summary", interactionType: "navigate" },
        { pageType: "invented", interactionType: "custom" },
      ],
    });
  });
});

/** 创建五个主题测试共用的合法 CourseIntent。 */
function createIntent(testCase: PlannerCase): CourseIntent {
  return {
    topic: testCase.topic,
    audienceAgeRange: { min: 8, max: 10, label: "8-10 岁" },
    courseLength: 5,
    visualStyle: testCase.visualStyle,
    difficulty: "beginner",
    mustInclude: ["互动练习"],
    avoid: [],
    language: "zh-CN",
  };
}

/** 创建具备引入、讲解、互动、实践和总结节奏的测试规划。 */
function createOutline(testCase: PlannerCase): CoursePlan {
  const topic = testCase.topic;
  const styleTemplateId = testCase.styleTemplateId;
  const middleType = testCase.expectedPageType;
  const middleTemplateId = getTemplateId(middleType);
  const pages: CoursePlan["pages"] = [
    {
      id: "page-01-cover",
      order: 1,
      pageType: "cover",
      title: `${topic}学习启程`,
      learningObjective: `学习者能够说明${topic}课程将解决的核心问题。`,
      contentSummary: `建立${topic}的学习期待并介绍学习路径。`,
      interactionType: "navigate",
      assetNeeds: [
        {
          type: "illustration",
          role: "hero",
          purpose: `建立${topic}的主题情境。`,
          required: true,
        },
      ],
      functionalTemplateId: "course-cover",
      styleTemplateId,
      assetIds: [],
      dependsOnPageIds: [],
      status: "planned",
    },
    {
      id: "page-02-foundation",
      order: 2,
      pageType: "knowledge_card",
      title: `${topic}基础知识`,
      learningObjective: `学习者能够识别${topic}的三个基础概念。`,
      contentSummary: `用同层级知识卡建立${topic}的基础认知。`,
      interactionType: "reveal",
      assetNeeds: [],
      functionalTemplateId: "knowledge-card-grid",
      styleTemplateId,
      assetIds: [],
      dependsOnPageIds: ["page-01-cover"],
      status: "planned",
    },
    {
      id: "page-03-deepen",
      order: 3,
      pageType: middleType,
      title: `${topic}重点探索`,
      learningObjective: `学习者能够运用${topic}的重点知识完成判断。`,
      contentSummary: `围绕${topic}的关键问题进行结构化探索。`,
      interactionType: middleType === "quiz" ? "choice" : "explore",
      assetNeeds: [],
      functionalTemplateId: middleTemplateId,
      styleTemplateId,
      assetIds: [],
      dependsOnPageIds: ["page-02-foundation"],
      status: "planned",
    },
    {
      id: "page-04-practice",
      order: 4,
      pageType: "quiz",
      title: `${topic}互动练习`,
      learningObjective: `学习者能够通过练习检查对${topic}的理解。`,
      contentSummary: `使用带反馈的选择题巩固${topic}知识。`,
      interactionType: "choice",
      assetNeeds: [],
      functionalTemplateId: "interactive-quiz",
      styleTemplateId,
      assetIds: [],
      dependsOnPageIds: ["page-03-deepen"],
      status: "planned",
    },
    {
      id: "page-05-summary",
      order: 5,
      pageType: "summary",
      title: `${topic}学习总结`,
      learningObjective: `学习者能够复述${topic}课程的三个核心收获。`,
      contentSummary: `回扣目标并整理${topic}的关键知识和下一步行动。`,
      interactionType: "navigate",
      assetNeeds: [],
      functionalTemplateId: "recap-summary",
      styleTemplateId,
      assetIds: [],
      dependsOnPageIds: ["page-04-practice"],
      status: "planned",
    },
  ];

  return CoursePlanSchema.parse({
    overview: `通过引入、讲解、互动和总结帮助学习者掌握${topic}。`,
    learningObjectives: [
      `学习者能够理解${topic}的基础概念。`,
      `学习者能够运用${topic}知识完成互动任务。`,
    ],
    pages,
  });
}

/** 把测试所需 pageType 映射到共享 Registry 中的真实模板 ID。 */
function getTemplateId(pageType: PageType) {
  const ids: Record<PageType, string> = {
    cover: "course-cover",
    story_intro: "story-intro",
    knowledge_card: "knowledge-card-grid",
    quiz: "interactive-quiz",
    comparison: "comparison-board",
    timeline: "learning-timeline",
    summary: "recap-summary",
    achievement: "achievement-task",
  };

  return ids[pageType];
}
