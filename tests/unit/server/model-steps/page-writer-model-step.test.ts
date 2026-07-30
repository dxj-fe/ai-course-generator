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
  createPageWriterModelStep,
  createPageWriterModelStepState,
  estimateFixedCanvasVisibleTextWidth,
  exceedsFixedCanvasCapacity,
  materializePageWriterInteraction,
  materializeInteractionItems,
  normalizePageContentDensity,
  normalizePageNavigationDestination,
  normalizePageWriterModelOutput,
  PageWriterNarrationDraftSchema,
  validatePageWriterOutput,
  type PageWriterInput,
} from "../../../../src/server/agent/plugins/model-steps/course/page-writer-model-step";
import type {
  PageContentDSL,
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

describe("PageWriterModelStep", () => {
  it("generates one PageContentDSL in one bounded step", async () => {
    const generateContent = vi.fn().mockResolvedValue(pageContentDsl);
    const result = await createPageWriterModelStep({ generateContent }).run(
      createPageWriterModelStepState(input),
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

  it("accepts concise narration when its semantic content is sufficient", () => {
    const conciseNarration = "比较石猴行动后的选择。";

    expect(conciseNarration.length).toBe(11);
    expect(PageWriterNarrationDraftSchema.parse([conciseNarration])).toEqual([
      conciseNarration,
    ]);
    expect(() =>
      validatePageWriterOutput(
        { ...pageContentDsl, narration: [conciseNarration] },
        input,
      ),
    ).not.toThrow();
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

  it("accepts the measured 273-width achievement boundary and rejects text beyond 280", () => {
    const boundary = createAchievementCapacityBoundaryContent();
    const achievementInput = pageWriterInputFor(boundary, "achievement");

    expect(estimateFixedCanvasVisibleTextWidth(boundary)).toBe(273);
    expect(exceedsFixedCanvasCapacity(boundary)).toBe(false);
    expect(() =>
      validatePageWriterOutput(boundary, achievementInput),
    ).not.toThrow();

    if (boundary.interaction.type !== "input") {
      throw new Error("achievement boundary must use input");
    }
    const overCapacity = {
      ...boundary,
      interaction: {
        ...boundary.interaction,
        prompt: `${boundary.interaction.prompt}请再补充画面证据`,
      },
    };

    expect(estimateFixedCanvasVisibleTextWidth(overCapacity)).toBe(281);
    expect(exceedsFixedCanvasCapacity(overCapacity)).toBe(true);
    expect(() =>
      validatePageWriterOutput(overCapacity, achievementInput),
    ).toThrow("可见文本约 280 个汉字宽度");
  });

  it("counts an optional timeline illustration as real fixed-canvas capacity", () => {
    const timeline = structuredClone(
      getFunctionalTemplateDslExample("learning-timeline"),
    );
    if (!timeline || timeline.interaction.type !== "explore") {
      throw new Error("learning-timeline fixture is required");
    }
    timeline.assetSlots = [
      {
        id: "asset-slot-01",
        type: "illustration",
        role: "inline",
        purpose: "展示时间线流程示意",
        required: false,
        altTextGuidance: "展示时间线的阶段顺序。",
      },
    ];
    const denseTimeline = {
      ...timeline,
      blocks: [
        ...timeline.blocks,
        {
          ...timeline.blocks[0]!,
          id: "block-04",
          heading: "第四阶段",
        },
        {
          ...timeline.blocks[1]!,
          id: "block-05",
          heading: "第五阶段",
        },
      ],
      interaction: {
        ...timeline.interaction,
        items: [
          ...timeline.interaction.items,
          {
            ...timeline.interaction.items[0]!,
            id: "item-04",
            label: "第四阶段",
          },
          {
            ...timeline.interaction.items[1]!,
            id: "item-05",
            label: "第五阶段",
          },
        ],
      },
      layoutHints: {
        ...timeline.layoutHints,
        readingOrder: [
          ...timeline.layoutHints.readingOrder,
          "block-04",
          "block-05",
        ],
      },
    };

    expect(timeline.assetSlots[0]?.required).toBe(false);
    expect(exceedsFixedCanvasCapacity(timeline)).toBe(false);
    expect(exceedsFixedCanvasCapacity(denseTimeline)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseTimeline,
        pageWriterInputFor(denseTimeline, "timeline"),
      ),
    ).toThrow("learning-timeline/explore");
  });

  it("rewrites real dense card and comparison pages when a required visual shares the canvas", () => {
    const knowledge = getFunctionalTemplateDslExample(
      "knowledge-card-grid",
    );
    const comparison = getFunctionalTemplateDslExample("comparison-board");
    if (
      !knowledge ||
      knowledge.interaction.type !== "reveal" ||
      !comparison ||
      comparison.interaction.type !== "explore"
    ) {
      throw new Error("card and comparison fixtures are required");
    }

    const knowledgeWithVisual = withRequiredVisual({
      ...knowledge,
      blocks: knowledge.blocks.map((block, index) => ({
        ...block,
        body: [
          "水星离太阳最近，因此公转轨道位于八颗行星最内侧。",
          "地球表面拥有大量液态水，为已知生命提供了生存条件。",
          "木星体积最大，大红斑是帮助辨认它的显著外观特征。",
        ][index]!,
      })),
    });
    if (knowledgeWithVisual.interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const denseKnowledge = {
      ...knowledgeWithVisual,
      title: "毕加索核心创作时期划分",
      narration: [
        "本页通过3张知识卡梳理毕加索的三大核心创作时期，点击卡片可查看对应时期的详细风格特点。",
      ],
      blocks: knowledgeWithVisual.blocks.map((block, index) => ({
        ...block,
        label: ["蓝色时期", "玫瑰时期", "立体主义时期"][index]!,
        heading: [
          "蓝色时期（1901-1904）",
          "玫瑰时期（1904-1906）",
          "立体主义时期（1907-1917）",
        ][index]!,
        body: [
          "毕加索因好友自杀陷入忧郁，这一时期作品以冷色调蓝色为主，主题多为贫困、孤独的底层人物，风格偏向写实且充满悲伤氛围。",
          "毕加索情绪逐渐缓和，作品转向暖色调玫瑰色，主题多为马戏团演员、小丑等温情角色，风格仍偏向写实但更具柔和感。",
          "毕加索与布拉克共同创立立体主义，打破传统透视规则，将物体拆解为几何碎片并重新组合，强调多视角同时呈现，是现代艺术的重要转折点。",
        ][index]!,
      })),
      interaction: {
        ...knowledgeWithVisual.interaction,
        items: knowledgeWithVisual.interaction.items.map((item, index) => ({
          ...item,
          content: [
            "冷色调蓝色为主，主题围绕贫困与孤独，充满忧郁氛围",
            "暖色调玫瑰色为主，主题转向温情的马戏团人物，风格更柔和",
            "拆解物体为几何碎片，多视角组合，打破传统透视规则",
          ][index]!,
        })),
      },
    };

    expect(exceedsFixedCanvasCapacity(denseKnowledge)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseKnowledge,
        pageWriterInputFor(knowledgeWithVisual, "knowledge_card"),
      ),
    ).toThrow("knowledge-card-grid/reveal");
    expect(exceedsFixedCanvasCapacity(knowledgeWithVisual)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        knowledgeWithVisual,
        pageWriterInputFor(knowledgeWithVisual, "knowledge_card"),
      ),
    ).not.toThrow();

    const comparisonWithVisual = withRequiredVisual(comparison);
    if (comparisonWithVisual.interaction.type !== "explore") {
      throw new Error("explore fixture is required");
    }
    const denseComparison = {
      ...comparisonWithVisual,
      title: "不同时期作品风格对比",
      narration: [
        "本页将对比毕加索三个核心创作时期的代表作品，重点观察色调、线条和造型的差异，帮助你快速识别不同阶段的风格变化。",
      ],
      blocks: [
        ...comparisonWithVisual.blocks.map((block, index) => ({
          ...block,
          label: ["蓝色时期", "玫瑰时期"][index]!,
          heading: [
            "蓝色时期（1901-1904）",
            "玫瑰时期（1904-1906）",
          ][index]!,
          body: [
            "毕加索蓝色时期的作品以冷蓝色调为主，多描绘贫困、孤独的底层人物，线条柔和细腻，造型偏向写实，整体传递出忧郁、压抑的氛围。",
            "玫瑰时期的作品转为暖粉色、玫瑰色的色调，题材多为马戏团演员、舞者等角色，线条更流畅，造型略带夸张但仍偏向写实，氛围更加温暖。",
          ][index]!,
          supportingPoints: [],
        })),
        {
          id: "block-cubism",
          kind: "concept" as const,
          label: "立体主义时期",
          heading: "立体主义时期（1907-1917）",
          body: "立体主义时期的作品打破传统透视规则，用几何块面分解物体，色调不再局限于单一色系，造型抽象且强调多视角同时呈现，是毕加索最具实验性的创作阶段。",
          supportingPoints: [],
        },
      ],
      interaction: {
        ...comparisonWithVisual.interaction,
        prompt: "点击下方的时期标签，查看对应时期作品的风格细节。",
        items: comparisonWithVisual.interaction.items.map((item, index) => ({
          ...item,
          label: ["蓝色时期", "玫瑰时期", "立体主义时期"][index]!,
          content: [
            "冷蓝色调，题材多为底层人物，线条柔和写实",
            "暖粉色调，题材偏向马戏团角色，线条流畅略带夸张",
            "几何块面造型，多视角呈现物体，色调多元丰富",
          ][index]!,
        })),
      },
      layoutHints: {
        ...comparisonWithVisual.layoutHints,
        readingOrder: [
          ...comparisonWithVisual.layoutHints.readingOrder,
          "block-cubism",
        ],
      },
    };
    const compactComparison = {
      ...comparisonWithVisual,
      blocks: comparisonWithVisual.blocks.map((block) => ({
        ...block,
        supportingPoints: block.supportingPoints.slice(0, 1),
      })),
    };

    expect(exceedsFixedCanvasCapacity(denseComparison)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseComparison,
        pageWriterInputFor(denseComparison, "comparison"),
      ),
    ).toThrow("comparison-board/explore");
    expect(exceedsFixedCanvasCapacity(compactComparison)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        compactComparison,
        pageWriterInputFor(compactComparison, "comparison"),
      ),
    ).not.toThrow();
  });

  it("keeps required-visual quiz and summary pages to three choices or cards", () => {
    const quiz = getFunctionalTemplateDslExample("interactive-quiz");
    const summary = getFunctionalTemplateDslExample("recap-summary");
    if (
      !quiz ||
      quiz.interaction.type !== "choice" ||
      !summary ||
      summary.interaction.type !== "navigate"
    ) {
      throw new Error("quiz and summary fixtures are required");
    }

    const compactQuiz = withRequiredVisual({
      ...quiz,
      interaction: {
        ...quiz.interaction,
        questions: quiz.interaction.questions.slice(0, 1),
      },
    });
    if (compactQuiz.interaction.type !== "choice") {
      throw new Error("choice fixture is required");
    }
    const question = compactQuiz.interaction.questions[0]!;
    const denseQuiz = {
      ...compactQuiz,
      interaction: {
        ...compactQuiz.interaction,
        questions: [
          {
            ...question,
            options: [
              ...question.options,
              {
                id: "option-01-04",
                label: "新古典主义时期",
              },
            ],
          },
        ],
      },
    };

    expect(exceedsFixedCanvasCapacity(denseQuiz)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseQuiz,
        pageWriterInputFor(denseQuiz, "quiz"),
      ),
    ).toThrow("interactive-quiz/choice");
    expect(exceedsFixedCanvasCapacity(compactQuiz)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        compactQuiz,
        pageWriterInputFor(compactQuiz, "quiz"),
      ),
    ).not.toThrow();

    const compactSummary = withRequiredVisual(summary);
    const denseSummary = {
      ...compactSummary,
      blocks: [
        ...compactSummary.blocks,
        {
          id: "block-framework",
          kind: "recap" as const,
          label: "赏析方法",
          heading: "使用时期特征赏析作品",
          body: "先判断创作时期，再用色调、线条与造型证据说明风格。",
          supportingPoints: [],
        },
      ],
      layoutHints: {
        ...compactSummary.layoutHints,
        readingOrder: [
          ...compactSummary.layoutHints.readingOrder,
          "block-framework",
        ],
      },
    };

    expect(exceedsFixedCanvasCapacity(denseSummary)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseSummary,
        pageWriterInputFor(denseSummary, "summary"),
      ),
    ).toThrow("recap-summary/navigate");
    expect(exceedsFixedCanvasCapacity(compactSummary)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        compactSummary,
        pageWriterInputFor(compactSummary, "summary"),
      ),
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

  it("restores a compressed single narration string without changing arrays", () => {
    const narration = "比较三个时期的色彩与造型差异。";
    const existingNarration = [
      "先观察作品中的色彩变化。",
      "再比较人物造型的处理方式。",
    ];

    expect(
      normalizePageWriterModelOutput({
        narration,
        interaction: { type: "none" },
      }),
    ).toMatchObject({ narration: [narration] });
    expect(
      normalizePageWriterModelOutput({
        narration: existingNarration,
        interaction: { type: "none" },
      }),
    ).toMatchObject({ narration: existingNarration });
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

function withRequiredVisual<T extends PageContentDSL>(
  dsl: T,
): T & { assetSlots: PageContentDSL["assetSlots"] } {
  return {
    ...dsl,
    assetSlots: [
      {
        id: "asset-slot-01",
        type: "illustration",
        role: "inline",
        purpose: "展示本页核心知识所需的解释性插图",
        required: true,
        altTextGuidance: "描述支持本页核心知识的主要视觉线索。",
      },
    ],
  };
}

function createAchievementCapacityBoundaryContent(): PageContentDSL {
  const achievement = getFunctionalTemplateDslExample("achievement-task");
  if (!achievement || achievement.interaction.type !== "input") {
    throw new Error("achievement-task fixture is required");
  }

  return withRequiredVisual({
    ...achievement,
    title: "独立赏析毕加索《亚维农少女》",
    narration: ["观察人物空间与视角完成有画面依据的赏析"],
    blocks: [
      {
        id: "block-period",
        kind: "instruction",
        heading: "判断时期与创作背景",
        body: "说明作品创作于立体主义形成前夕，并联系毕加索对传统透视与人体造型的突破。",
        supportingPoints: ["用作品年代和艺术转折作为判断依据。"],
      },
      {
        id: "block-method",
        kind: "instruction",
        heading: "分析立体主义表现手法",
        body: "指出人物被几何化处理、多个视角并置，以及空间被压缩切割的具体画面证据。",
        supportingPoints: ["至少引用两个能在画面中直接观察到的特征。"],
      },
    ],
    interaction: {
      type: "input",
      prompt: "写出作品所属时期，并结合画面说明两种立体主义表现手法。",
      placeholder: "例如：作品处于……时期；画面通过……与……表现……",
      evaluationCriteria: [
        "准确说明作品所处时期或艺术转折位置",
        "结合画面证据分析至少两种立体主义表现手法",
      ],
      feedback: {
        success:
          "你已准确判断时期，并用可观察的画面证据说明了两种立体主义手法。",
        retry:
          "请补充作品所处时期，并从几何化造型、多视角或压缩空间中选择两项结合画面说明。",
      },
    },
    layoutHints: {
      ...achievement.layoutHints,
      readingOrder: ["block-period", "block-method"],
    },
  });
}

function pageWriterInputFor(
  dsl: PageContentDSL,
  pageType: PageWriterInput["page"]["pageType"],
): PageWriterInput {
  const targetPage: PageWriterInput["page"] = {
    ...page,
    id: dsl.pageId,
    title: dsl.title,
    pageType,
    functionalTemplateId: dsl.functionalTemplateId,
    interactionType: dsl.interaction.type,
    assetNeeds: dsl.assetSlots.map(
      ({ type, role, purpose, required }) => ({
        type,
        role,
        purpose,
        required,
      }),
    ),
  };

  return {
    ...input,
    page: targetPage,
    brief: {
      ...brief,
      pageId: dsl.pageId,
      pedagogy: { ...brief.pedagogy, pageId: dsl.pageId },
      story: { ...brief.story, pageId: dsl.pageId },
      visual: { ...brief.visual, pageId: dsl.pageId },
    },
  };
}
