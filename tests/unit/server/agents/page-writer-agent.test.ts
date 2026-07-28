import { describe, expect, it, vi } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import {
  buildLessonRuntime,
  createPageWriterAgent,
  createPageWriterAgentState,
  exceedsFixedCanvasCapacity,
  materializePageWriterInteraction,
  materializeInteractionItems,
  normalizePageContentDensity,
  normalizePageNavigationDestination,
  normalizePageWriterModelOutput,
  validatePageWriterOutput,
} from "../../../../src/server/agents/page-writer-agent";
import type {
  PageWorkerBrief,
  ReferencePack,
} from "../../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";

const page = courseDesignOutline.pages[1];
const brief: PageWorkerBrief = {
  pageId: page.id,
  styleTemplateId: visualBrief.styleTemplateId,
  pedagogy: pedagogyPlan.pageGuidance[1],
  story: storyArc.pageBeats[1],
  visual: visualBrief.pageGuidance[1],
};
const input = { intent: courseDesignIntent, page, brief };
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

describe("PageWriterAgent", () => {
  it("generates one PageContentDSL in one bounded step", async () => {
    const generateContent = vi.fn().mockResolvedValue(pageContentDsl);
    const result = await createPageWriterAgent({ generateContent }).run(
      createPageWriterAgentState(input),
      { traceId: "page-writer-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.content).toEqual(pageContentDsl);
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "finish",
    ]);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ page, brief }),
    );
  });

  it("rejects a DSL whose pageId differs from PagePlan", () => {
    expect(() =>
      validatePageWriterOutput(
        { ...pageContentDsl, pageId: "invented-page" },
        input,
      ),
    ).toThrow("DSL pageId 必须是");
  });

  it("rejects content outside FunctionalTemplate slot bounds", () => {
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          blocks: [],
          layoutHints: { ...pageContentDsl.layoutHints, readingOrder: [] },
        },
        input,
      ),
    ).toThrow("blocks 数量 0 不在模板范围 2-6");
  });

  it("rejects low-information narration, block bodies, and reveal items", () => {
    expect(() =>
      validatePageWriterOutput(
        { ...pageContentDsl, narration: ["看特质！"] },
        input,
      ),
    ).toThrow("narration.0 过短");

    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          blocks: [
            { ...pageContentDsl.blocks[0]!, body: "勇敢聪明" },
            pageContentDsl.blocks[1]!,
          ],
        },
        input,
      ),
    ).toThrow("blocks.0.body 信息不足");

    if (pageContentDsl.interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const revealInteraction = pageContentDsl.interaction;
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          interaction: {
            ...revealInteraction,
            items: revealInteraction.items.map((item, index) =>
              index === 0 ? { ...item, content: item.label } : item,
            ),
          },
        },
        input,
      ),
    ).toThrow("content 必须解释标签");
  });

  it("limits newly written quiz pages to one focused question and one block", () => {
    const quiz = getFunctionalTemplateDslExample("interactive-quiz");
    if (!quiz || quiz.interaction.type !== "choice") {
      throw new Error("interactive-quiz fixture is required");
    }
    const quizPage = {
      ...page,
      id: quiz.pageId,
      title: quiz.title,
      pageType: "quiz" as const,
      functionalTemplateId: "interactive-quiz",
      interactionType: "choice" as const,
      assetNeeds: [],
    };
    const quizInput = {
      ...input,
      page: quizPage,
      brief: {
        ...brief,
        pageId: quiz.pageId,
        pedagogy: { ...brief.pedagogy, pageId: quiz.pageId },
        story: { ...brief.story, pageId: quiz.pageId },
        visual: { ...brief.visual, pageId: quiz.pageId },
      },
    };

    expect(() => validatePageWriterOutput(quiz, quizInput)).toThrow(
      "choice 页面必须且只能包含 1 道完整题目",
    );

    const singleQuestion = {
      ...quiz,
      interaction: {
        ...quiz.interaction,
        questions: quiz.interaction.questions.slice(0, 1),
      },
    };
    const twoBlocks = {
      ...singleQuestion,
      blocks: [
        ...singleQuestion.blocks,
        {
          ...singleQuestion.blocks[0]!,
          id: "block-question-02",
          heading: "重复题卡",
        },
      ],
      layoutHints: {
        ...singleQuestion.layoutHints,
        readingOrder: ["block-question", "block-question-02"],
      },
    };

    expect(() => validatePageWriterOutput(twoBlocks, quizInput)).toThrow(
      "quiz 页面必须且只能包含 1 个题目内容块",
    );
    expect(() =>
      validatePageWriterOutput(singleQuestion, quizInput),
    ).not.toThrow();
  });

  it("keeps a story, required visual, and choice within the fixed canvas capacity", () => {
    const storyIntro = getFunctionalTemplateDslExample("story-intro");
    if (!storyIntro || storyIntro.interaction.type !== "choice") {
      throw new Error("story-intro fixture is required");
    }
    const storyPage = {
      ...page,
      id: storyIntro.pageId,
      title: storyIntro.title,
      pageType: "story_intro" as const,
      functionalTemplateId: "story-intro",
      interactionType: "choice" as const,
      assetNeeds: storyIntro.assetSlots.map(
        ({ type, role, purpose, required }) => ({
          type,
          role,
          purpose,
          required,
        }),
      ),
    };
    const storyInput = {
      ...input,
      page: storyPage,
      brief: {
        ...brief,
        pageId: storyIntro.pageId,
        pedagogy: { ...brief.pedagogy, pageId: storyIntro.pageId },
        story: { ...brief.story, pageId: storyIntro.pageId },
        visual: { ...brief.visual, pageId: storyIntro.pageId },
      },
    };

    expect(() =>
      validatePageWriterOutput(storyIntro, storyInput),
    ).not.toThrow();

    const sourceQuestion = storyIntro.interaction.questions[0]!;
    const denseStoryIntro = {
      ...storyIntro,
      narration: [
        "从主人公的童年讲到后来的人生转折，逐项分析塑造其思想与行动方式的全部经历。",
        "阅读三个故事区块后，再从四个相近答案中完成理解检查。",
      ],
      blocks: [
        ...storyIntro.blocks,
        {
          id: "block-aftermath",
          kind: "example" as const,
          label: "线索 3",
          heading: "经历带来的长期影响",
          body: "这段经历改变了主人公此后的判断方式，也为后续多个阶段的发展埋下线索，需要结合前面的背景和行动一起理解。",
          supportingPoints: [
            "联系前后情节，说明人物选择发生变化的具体原因。",
          ],
        },
      ],
      interaction: {
        ...storyIntro.interaction,
        questions: [
          {
            ...sourceQuestion,
            options: [
              ...sourceQuestion.options,
              { id: "option-01-03", label: "只与最后一个情节有关" },
              { id: "option-01-04", label: "四段经历产生了完全相同的影响" },
            ],
          },
        ],
      },
      layoutHints: {
        ...storyIntro.layoutHints,
        readingOrder: [
          ...storyIntro.layoutHints.readingOrder,
          "block-aftermath",
        ],
      },
    };

    expect(() =>
      validatePageWriterOutput(denseStoryIntro, storyInput),
    ).toThrow("固定画布容量超限");
  });

  it("compresses an achievement with a required visual and input before fixed-canvas rendering", () => {
    const achievement = getFunctionalTemplateDslExample("achievement-task");
    if (!achievement || achievement.interaction.type !== "input") {
      throw new Error("achievement-task fixture is required");
    }
    const achievementInteraction = achievement.interaction;
    const assetSlot = {
      id: "asset-slot-01",
      type: "illustration" as const,
      role: "inline" as const,
      purpose: "展示任务参考插图",
      required: true,
      altTextGuidance: "展示任务参考插图。",
    };
    const denseAchievement = {
      ...achievement,
      interaction: {
        ...achievementInteraction,
        evaluationCriteria:
          achievementInteraction.evaluationCriteria.slice(0, 1),
      },
      assetSlots: [assetSlot],
    };
    const achievementPage = {
      ...page,
      id: achievement.pageId,
      title: achievement.title,
      pageType: "achievement" as const,
      functionalTemplateId: "achievement-task",
      interactionType: "input" as const,
      assetNeeds: [
        {
          type: assetSlot.type,
          role: assetSlot.role,
          purpose: assetSlot.purpose,
          required: assetSlot.required,
        },
      ],
    };
    const achievementInput = {
      ...input,
      page: achievementPage,
      brief: {
        ...brief,
        pageId: achievement.pageId,
        pedagogy: { ...brief.pedagogy, pageId: achievement.pageId },
        story: { ...brief.story, pageId: achievement.pageId },
        visual: { ...brief.visual, pageId: achievement.pageId },
      },
    };

    expect(exceedsFixedCanvasCapacity(denseAchievement)).toBe(true);
    expect(() =>
      validatePageWriterOutput(denseAchievement, achievementInput),
    ).toThrow(
      "achievement 同时包含必需插图和 input",
    );

    const compactAchievement = {
      ...denseAchievement,
      blocks: denseAchievement.blocks.slice(0, 2),
      interaction: {
        ...denseAchievement.interaction,
        evaluationCriteria:
          denseAchievement.interaction.evaluationCriteria.slice(0, 2),
      },
      layoutHints: {
        ...denseAchievement.layoutHints,
        readingOrder: denseAchievement.layoutHints.readingOrder.slice(0, 2),
      },
    };

    expect(exceedsFixedCanvasCapacity(compactAchievement)).toBe(false);
    expect(() =>
      validatePageWriterOutput(compactAchievement, achievementInput),
    ).not.toThrow();
  });

  it("rejects generic input feedback that does not address the criteria", () => {
    const achievement = getFunctionalTemplateDslExample("achievement-task");
    if (!achievement || achievement.interaction.type !== "input") {
      throw new Error("achievement-task fixture is required");
    }
    const achievementInteraction = achievement.interaction;
    const achievementPage = {
      ...page,
      id: achievement.pageId,
      title: achievement.title,
      pageType: "achievement" as const,
      functionalTemplateId: "achievement-task",
      interactionType: "input" as const,
      assetNeeds: [],
    };
    const achievementInput = {
      ...input,
      page: achievementPage,
      brief: {
        ...brief,
        pageId: achievement.pageId,
        pedagogy: { ...brief.pedagogy, pageId: achievement.pageId },
        story: { ...brief.story, pageId: achievement.pageId },
        visual: { ...brief.visual, pageId: achievement.pageId },
      },
    };

    expect(() =>
      validatePageWriterOutput(
        {
          ...achievement,
          interaction: {
            ...achievementInteraction,
            feedback: {
              success: "完成得很好！",
              retry: "再试一次哦。",
            },
          },
        },
        achievementInput,
      ),
    ).toThrow(
      `interaction.feedback.success 必须点名已满足的 evaluationCriteria，并说明回答中用于判断的可观察内容；当前评价标准：“${achievementInteraction.evaluationCriteria[0]}”`,
    );

    expect(() =>
      validatePageWriterOutput(
        {
          ...achievement,
          interaction: {
            ...achievementInteraction,
            feedback: {
              success: achievementInteraction.feedback.success,
              retry: "请再试一次。",
            },
          },
        },
        achievementInput,
      ),
    ).toThrow(
      `interaction.feedback.retry 必须点名尚未满足的 evaluationCriteria，并说明应补充的事实、证据、步骤或理由；当前评价标准：“${achievementInteraction.evaluationCriteria[0]}”`,
    );
  });

  it("rejects a PageWorkerBrief whose nested IDs drift", () => {
    expect(() =>
      validatePageWriterOutput(pageContentDsl, {
        ...input,
        brief: {
          ...brief,
          story: { ...brief.story, pageId: "another-page" },
        },
      }),
    ).toThrow("PageWorkerBrief 必须完整引用当前 pageId");
  });

  it("accepts only PagePlan-authorized Reference chunks", () => {
    const referencedPage = {
      ...page,
      usedReferences: [
        { referencePackId: referencePack.id, chunkIds: ["chunk-01"] },
      ],
    };
    const referencedInput = {
      ...input,
      page: referencedPage,
      referencePacks: [referencePack],
    };

    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          usedReferences: referencedPage.usedReferences,
        },
        referencedInput,
      ),
    ).not.toThrow();
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          usedReferences: [
            { referencePackId: referencePack.id, chunkIds: ["chunk-02"] },
          ],
        },
        referencedInput,
      ),
    ).toThrow("Page Writer 的资料引用必须是 PagePlan 引用的子集");
  });

  it.each([
    ["low", "cover", "sparse"],
    ["medium", "knowledge_card", "balanced"],
    ["平衡", "knowledge_card", "balanced"],
    ["comfortable", "story_intro", "balanced"],
    ["spacious", "cover", "sparse"],
    ["high", "knowledge_card", "dense"],
    ["紧凑", "knowledge_card", "dense"],
    ["Medium_Density", "knowledge_card", "balanced"],
  ] as const)(
    "normalizes model density alias %s for %s to %s",
    (modelValue, pageType, expected) => {
      expect(normalizePageContentDensity(modelValue, pageType)).toBe(expected);
    },
  );

  it("uses a template-safe density when the model returns an unknown label", () => {
    expect(normalizePageContentDensity("concise", "cover")).toBe("sparse");
    expect(normalizePageContentDensity("regular", "story_intro")).toBe(
      "balanced",
    );
  });

  it("distinguishes programming functions from mathematical function graphs", () => {
    const programmingRuntime = buildLessonRuntime({
      page: {
        ...page,
        title: "Python流程控制与函数",
        learningObjective: "掌握for循环、条件控制和def函数调用",
        contentSummary: "通过Python代码学习流程控制与函数。",
      },
      blocks: pageContentDsl.blocks.map((block, index) => ({
        ...block,
        heading: index === 0 ? "for循环遍历" : "def函数定义与调用",
        body:
          index === 0
            ? "使用for循环控制程序流程。"
            : "使用def定义函数并通过参数调用。",
      })),
      interaction: pageContentDsl.interaction,
    });
    const mathRuntime = buildLessonRuntime({
      page: {
        ...page,
        title: "一次函数图像",
        learningObjective: "理解坐标系中函数图像与斜率",
        contentSummary: "绘制y = 2x + 1的函数曲线。",
      },
      blocks: pageContentDsl.blocks,
      interaction: pageContentDsl.interaction,
    });

    expect(programmingRuntime.visualPrimitive).toBe("process");
    expect(mathRuntime.visualPrimitive).toBe("function-graph");
  });

  it("keeps nested choice questions and resets the unused choice items field", () => {
    const questions = [
      {
        prompt: "哪一项符合定义？",
        options: ["选项一", "选项二"],
        correctOptionIndex: 0,
        feedbackSuccess: "选项一满足定义中的全部条件。",
        feedbackRetry: "请重新核对定义中的必要条件。",
        maxAttempts: 2,
      },
    ];

    expect(
      normalizePageWriterModelOutput({
        narration: [],
        interaction: {
          type: "choice",
          items: 5,
          questions,
        },
      }),
    ).toMatchObject({
      interaction: {
        items: [],
        questions,
      },
    });
  });

  it("restores compressed interaction feedback strings without changing arrays", () => {
    const existingRetryFeedback = [
      "先对照评价标准检查答案是否完整。",
      "再补充一个能够支撑结论的依据。",
    ];

    expect(
      normalizePageWriterModelOutput({
        narration: [],
        interaction: {
          type: "input",
          items: [],
          feedbackSuccess: "回答完整，已经覆盖两个关键判断依据。",
          feedbackRetry: existingRetryFeedback,
        },
      }),
    ).toMatchObject({
      interaction: {
        feedbackSuccess: ["回答完整，已经覆盖两个关键判断依据。"],
        feedbackRetry: existingRetryFeedback,
      },
    });
  });

  it("leaves unknown interaction feedback shapes for strict schema rejection", () => {
    expect(
      normalizePageWriterModelOutput({
        narration: [],
        interaction: {
          type: "input",
          feedbackSuccess: { message: "回答正确。" },
          feedbackRetry: 0,
        },
      }),
    ).toMatchObject({
      interaction: {
        feedbackSuccess: { message: "回答正确。" },
        feedbackRetry: 0,
      },
    });
  });

  it("adds stable technical IDs to each nested choice question", () => {
    expect(
      materializePageWriterInteraction({
        type: "choice",
        prompt: "完成选择题。",
        items: [],
        questions: [
          {
            prompt: "哪一项符合定义？",
            options: ["选项一", "选项二"],
            correctOptionIndex: 1,
            feedbackSuccess: "选项二满足定义中的全部条件。",
            feedbackRetry: "请重新核对定义中的必要条件。",
            maxAttempts: 2,
          },
        ],
        feedbackSuccess: [],
        feedbackRetry: [],
        maxAttempts: 1,
        placeholder: "未使用",
        evaluationCriteria: [],
        actionLabel: "未使用",
        destination: "next",
      }),
    ).toEqual({
      type: "choice",
      questions: [
        {
          id: "question-01",
          prompt: "哪一项符合定义？",
          options: [
            { id: "option-01-01", label: "选项一" },
            { id: "option-01-02", label: "选项二" },
          ],
          correctOptionId: "option-01-02",
          feedback: {
            success: "选项二满足定义中的全部条件。",
            retry: "请重新核对定义中的必要条件。",
          },
          maxAttempts: 2,
        },
      ],
    });
  });

  it("preserves a concise label and a substantive interaction explanation", () => {
    expect(
      materializeInteractionItems([
        { label: "增函数", content: "自变量增大时，函数值也随之增大。" },
        { label: "减函数", content: "自变量增大时，函数值反而减小。" },
      ]),
    ).toEqual([
      {
        id: "item-01",
        label: "增函数",
        content: "自变量增大时，函数值也随之增大。",
      },
      {
        id: "item-02",
        label: "减函数",
        content: "自变量增大时，函数值反而减小。",
      },
    ]);
  });

  it("recovers a compressed item label from its matching content block", () => {
    expect(
      materializeInteractionItems(["恒星"], pageContentDsl.blocks),
    ).toEqual([
      {
        id: "item-01",
        label: "恒星",
        content: "恒星会自己发光，太阳就是离我们最近的恒星。",
      },
    ]);
  });

  it.each([
    ["next", "next"],
    ["nextPage", "next"],
    ["previous-page", "previous"],
    ["home", "course-home"],
    ["unused choice placeholder", "next"],
  ] as const)(
    "normalizes model navigation placeholder %s to %s",
    (modelValue, expected) => {
      expect(normalizePageNavigationDestination(modelValue)).toBe(expected);
    },
  );
});
