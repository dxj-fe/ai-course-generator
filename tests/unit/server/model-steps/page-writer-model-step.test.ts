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
  exceedsFixedCanvasCapacity,
  materializePageWriterInteraction,
  materializeInteractionItems,
  normalizeMultilineBulletBody,
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
import {
  PageWriterBlockDraftSchema,
  PageWriterModelOutputSchema,
  normalizePageWriterModelOutput,
} from "../../../../src/server/agent/plugins/model-steps/course/page-writer-schema";

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
  it("只接受当前 Page Writer 模型合同", () => {
    const currentOutput = {
      narration: ["先观察两个天体是否会自己发光。"],
      blocks: [
        {
          kind: "fact" as const,
          heading: "恒星",
          body: "恒星能够自行发光，太阳就是一颗恒星。",
          supportingPoints: [],
        },
      ],
      interaction: {
        type: "reveal" as const,
        prompt: "逐项揭示天体特点。",
        items: [
          {
            label: "恒星",
            content: "恒星会自己发光并向周围释放能量。",
          },
        ],
      },
      usedReferences: [],
    };

    expect(PageWriterModelOutputSchema.safeParse(currentOutput).success).toBe(
      true,
    );
    expect(
      PageWriterModelOutputSchema.safeParse({
        ...currentOutput,
        blocks: ["恒星会自己发光。"],
      }).success,
    ).toBe(false);
    expect(
      PageWriterModelOutputSchema.safeParse({
        ...currentOutput,
        interaction: {
          ...currentOutput.interaction,
          placeholder: "未使用",
        },
      }).success,
    ).toBe(false);
  });

  it("normalizes a multiline emoji checklist into stable prose for HTML", () => {
    expect(
      normalizeMultilineBulletBody(
        "✅ 会自己发光发热\n✅ 太阳是恒星\n✅ 行星围绕太阳运行",
      ),
    ).toBe("会自己发光发热；太阳是恒星；行星围绕太阳运行");
    expect(normalizeMultilineBulletBody("第一段\n第二段")).toBe(
      "第一段\n第二段",
    );
  });

  it("只无损归一化 narration 单字符串，不修补互动占位字段", () => {
    const normalized = normalizePageWriterModelOutput({
      narration: "先观察两个天体是否会自己发光。",
      blocks: [],
      interaction: {
        type: "reveal",
        prompt: "逐项查看特征。",
        items: [
          {
            label: "恒星",
            content: "恒星能够自行发光并向外释放能量。",
          },
        ],
      },
      usedReferences: [],
    });

    expect(normalized).toEqual({
      narration: ["先观察两个天体是否会自己发光。"],
      blocks: [],
      interaction: {
        type: "reveal",
        prompt: "逐项查看特征。",
        items: [
          {
            label: "恒星",
            content: "恒星能够自行发光并向外释放能量。",
          },
        ],
      },
      usedReferences: [],
    });
    expect(PageWriterModelOutputSchema.safeParse(normalized).success).toBe(
      true,
    );

    const placeholderInteraction = normalizePageWriterModelOutput({
      ...(normalized as object),
      interaction: {
        type: "reveal",
        prompt: "逐项查看特征。",
        items: [{ label: "恒星", content: "恒星能够自行发光。" }],
        destination: "未使用",
      },
    });
    expect(
      PageWriterModelOutputSchema.safeParse(placeholderInteraction).success,
    ).toBe(false);
  });

  it("只为无语义的可选展示字段提供等价默认形状", () => {
    const parsed = PageWriterModelOutputSchema.parse({
      narration: [],
      blocks: [
        {
          kind: "recap",
          heading: "三步检查",
          body: "依次检查色相、面积比例和明度层级。",
        },
      ],
      interaction: {
        type: "input",
        prompt: "说明你会怎样改进这组配色。",
        placeholder: "  ",
        evaluationCriteria: "同时说明三个判断方面",
        feedbackSuccess: "你已经用三个判断方面解释了改进方案。",
        feedbackRetry: "请补充尚未说明的判断方面和具体改法。",
      },
      usedReferences: [],
    });

    expect(parsed.blocks[0]?.supportingPoints).toEqual([]);
    expect(parsed.interaction).toMatchObject({
      type: "input",
      placeholder: undefined,
      evaluationCriteria: ["同时说明三个判断方面"],
    });

    expect(
      materializePageWriterInteraction(parsed.interaction, "en-US"),
    ).toMatchObject({
      type: "input",
      placeholder: "Type your answer",
      evaluationCriteria: ["同时说明三个判断方面"],
    });
  });

  it("把旧版单题 questions 包装与 success/retry 别名无损归一化", () => {
    const normalized = normalizePageWriterModelOutput({
      narration: [],
      blocks: [],
      interaction: {
        type: "choice",
        questions: [
          {
            prompt: "日落时太阳光为什么更偏红？",
            options: ["穿过的大气路径更长", "太阳本身变成红色"],
            correctOptionIndex: 0,
            success: "光程更长，短波光被散射得更多。",
            retry: "比较太阳高低不同时光穿过大气的路径长度。",
            maxAttempts: 2,
          },
        ],
      },
      usedReferences: [],
    });

    const parsed = PageWriterModelOutputSchema.parse(normalized);
    expect(parsed.interaction).toMatchObject({
      type: "choice",
      prompt: "日落时太阳光为什么更偏红？",
      feedbackSuccess: "光程更长，短波光被散射得更多。",
      feedbackRetry: "比较太阳高低不同时光穿过大气的路径长度。",
    });
  });

  it("直接接受不带多余 questions 层级的单题 choice 草稿", () => {
    const output = {
      narration: [],
      blocks: [],
      interaction: {
        type: "choice" as const,
        prompt: "太阳高度角变小时，光程如何变化？",
        options: ["变长", "变短"],
        correctOptionIndex: 0,
        feedbackSuccess: "太阳越接近地平线，光穿过的大气路径越长。",
        feedbackRetry: "比较斜向与垂直穿过大气的路径。",
        maxAttempts: 2,
      },
      usedReferences: [],
    };

    expect(PageWriterModelOutputSchema.parse(output)).toEqual(output);
  });

  it("不静默合并互动项：保留合法项，超出 schema 上限则拒绝", () => {
    const items = ["红", "橙", "黄", "绿", "青", "蓝", "靛", "紫"].map(
      (label) => ({ label, content: `${label}色光的观察记录` }),
    );
    const output = {
      narration: [],
      blocks: [],
      interaction: {
        type: "reveal" as const,
        prompt: "逐项观察白光中的颜色。",
        items,
      },
      usedReferences: [],
    };
    const normalized = normalizePageWriterModelOutput(output);

    const parsed = PageWriterModelOutputSchema.parse(normalized);
    expect(parsed.interaction).toEqual(output.interaction);
    expect(
      PageWriterModelOutputSchema.safeParse({
        ...output,
        interaction: {
          ...output.interaction,
          items: [
            ...items,
            { label: "红外", content: "红外辐射的观察记录" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("拒绝多题 choice，而不是静默截断题目或正文", () => {
    const block = {
      kind: "concept",
      heading: "回顾要点",
      body: "先回顾判断自然回应时需要关注的语境线索。",
      supportingPoints: [],
    };
    const questionBlock = {
      ...block,
      kind: "question",
      heading: "情境选择",
    };
    const question = {
      prompt: "哪一句回应更自然？",
      options: ["Sure, what happened?", "I translate now."],
      correctOptionIndex: 0,
      feedbackSuccess: "正确，这句话承接了对方的语境。",
      feedbackRetry: "再看哪一句能让交流继续。",
      maxAttempts: 2,
    };
    const output = {
      narration: [],
      blocks: [block, questionBlock],
      interaction: {
        type: "choice" as const,
        questions: [question, { ...question, prompt: "第二题" }],
      },
      usedReferences: [],
    };
    const normalized = normalizePageWriterModelOutput(output);

    expect(normalized).toEqual(output);
    expect(PageWriterModelOutputSchema.safeParse(normalized).success).toBe(
      false,
    );
  });

  it("不根据模板槽位静默删除模型写出的正文", () => {
    const output = {
      narration: ["先了解课程目标，再开始学习。"],
      blocks: [
        {
          kind: "concept" as const,
          heading: "课程核心问题",
          body: "先建立本课需要回答的核心问题，再开始后续学习。",
          supportingPoints: [],
        },
      ],
      interaction: {
        type: "navigate" as const,
        actionLabel: "开始学习",
        destination: "next" as const,
      },
      usedReferences: [],
    };
    const normalized = normalizePageWriterModelOutput(output);

    expect(PageWriterModelOutputSchema.parse(normalized).blocks).toEqual(
      output.blocks,
    );
  });

  it("generates one PageContentDSL without a rewrite when it fits the interaction budget", async () => {
    const compactContent = {
      ...pageContentDsl,
      blocks: pageContentDsl.blocks.slice(0, 1),
      layoutHints: {
        ...pageContentDsl.layoutHints,
        readingOrder: [pageContentDsl.blocks[0]!.id],
      },
    };
    const generateContent = vi.fn().mockResolvedValue(compactContent);
    const result = await createPageWriterModelStep({ generateContent }).run(
      createPageWriterModelStepState(input),
      { traceId: "page-writer-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.content).toEqual(compactContent);
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "finish",
    ]);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ page, brief }),
    );
  });

  it("rewrites an over-capacity draft once with interaction-specific compression feedback", async () => {
    const compactContent = {
      ...pageContentDsl,
      blocks: pageContentDsl.blocks.slice(0, 1),
      layoutHints: {
        ...pageContentDsl.layoutHints,
        readingOrder: [pageContentDsl.blocks[0]!.id],
      },
    };
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(pageContentDsl)
      .mockResolvedValueOnce(compactContent);
    const result = await createPageWriterModelStep({ generateContent }).run(
      createPageWriterModelStepState({
        ...input,
        validationFeedback: {
          code: "PAGE_BUILDER_RETRY",
          issues: ["保留事实中的比较方向。"],
        },
      }),
      { traceId: "page-writer-capacity-rewrite" },
    );

    expect(result.status).toBe("completed");
    expect(result.content).toEqual(compactContent);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        validationFeedback: expect.objectContaining({
          code: "PAGE_WRITER_CAPACITY_REWRITE",
          issues: expect.arrayContaining([
            "保留事实中的比较方向。",
            expect.stringContaining("当前 reveal 初稿超出单页语义容量"),
            expect.stringContaining("blocks 有 2 个，reveal 页预算为 1 个"),
            expect.stringContaining("interaction item 承担对应观察证据"),
          ]),
        }),
      }),
    );
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "model_call",
      "finish",
    ]);
  });

  it("rejects a DSL whose pageId differs from PagePlan", () => {
    expect(() =>
      validatePageWriterOutput(
        { ...pageContentDsl, pageId: "invented-page" },
        input,
      ),
    ).toThrow("DSL pageId 必须是");
  });

  it("does not reject semantic content by FunctionalTemplate slot arithmetic", () => {
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          blocks: [],
          layoutHints: { ...pageContentDsl.layoutHints, readingOrder: [] },
        },
        input,
      ),
    ).not.toThrow();
  });

  it("rejects deterministic low-information narration and reveal items", () => {
    expect(() =>
      validatePageWriterOutput(
        { ...pageContentDsl, narration: ["看特质！"] },
        input,
      ),
    ).toThrow("narration.0 过短");

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

  it("accepts a concise block body when the relationship is independently clear", () => {
    const conciseBody = "视觉上，暖色前进，冷色后退。";

    expect(
      PageWriterBlockDraftSchema.parse({
        kind: "fact",
        heading: "冷暖空间感",
        body: conciseBody,
      }).body,
    ).toBe(conciseBody);
    expect(() =>
      validatePageWriterOutput(
        {
          ...pageContentDsl,
          blocks: [
            { ...pageContentDsl.blocks[0]!, body: conciseBody },
            pageContentDsl.blocks[1]!,
          ],
        },
        input,
      ),
    ).not.toThrow();
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

  it("rejects learner-facing content that is predominantly English in a Chinese course", () => {
    if (pageContentDsl.interaction.type !== "reveal") {
      throw new Error("reveal fixture is required");
    }
    const englishContent = {
      ...pageContentDsl,
      narration: [
        "Start by comparing how these two objects produce or reflect light.",
      ],
      blocks: pageContentDsl.blocks.map((block, index) => ({
        ...block,
        heading: index === 0 ? "A star produces light" : "A planet reflects light",
        body:
          index === 0
            ? "A star releases energy and produces its own light across the Solar System."
            : "A planet travels around a star and reflects the light that reaches its surface.",
        supportingPoints: [
          index === 0
            ? "The Sun is the star at the center of our Solar System."
            : "Earth is a planet that travels around the Sun.",
        ],
      })),
      interaction: {
        ...pageContentDsl.interaction,
        prompt: "Reveal each object to compare its most important feature.",
        items: pageContentDsl.interaction.items.map((item, index) => ({
          ...item,
          label: index === 0 ? "The Sun" : "The Earth",
          content:
            index === 0
              ? "The Sun is a star that produces light and releases energy."
              : "The Earth is a planet that reflects sunlight as it travels around the Sun.",
        })),
      },
    };

    expect(() => validatePageWriterOutput(englishContent, input)).toThrow(
      "课程语言为中文，但页面正文以英文为主",
    );
  });

  it("allows bilingual content and target-language learning lessons", () => {
    const bilingualInput: PageWriterInput = {
      ...input,
      intent: { ...input.intent, language: "bilingual" },
    };
    const englishLessonInput: PageWriterInput = {
      ...input,
      intent: { ...input.intent, topic: "英语词汇", language: "zh-CN" },
    };
    const englishContent = {
      ...pageContentDsl,
      narration: [
        "Start by comparing how these two objects produce or reflect light.",
      ],
      blocks: pageContentDsl.blocks.map((block) => ({
        ...block,
        heading: "Learn these English astronomy words",
        body: "Read each English sentence and explain its meaning using the lesson context.",
      })),
    };

    expect(() =>
      validatePageWriterOutput(englishContent, bilingualInput),
    ).not.toThrow();
    expect(() =>
      validatePageWriterOutput(englishContent, englishLessonInput),
    ).not.toThrow();
  });

  it("does not prune quiz content during final DSL validation", () => {
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

    expect(() => validatePageWriterOutput(quiz, quizInput)).not.toThrow();

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

    expect(() => validatePageWriterOutput(twoBlocks, quizInput)).not.toThrow();
    expect(() =>
      validatePageWriterOutput(singleQuestion, quizInput),
    ).not.toThrow();
  });

  it("treats dense story composition as a layout hint instead of a content rejection", () => {
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
    ).not.toThrow();
  });

  it("treats dense achievement composition as a layout hint instead of a content rejection", () => {
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
    ).not.toThrow();

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

  it("asks an explore page to let interaction items carry timeline evidence", () => {
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
    const interactionLedTimeline = {
      ...timeline,
      blocks: timeline.blocks.slice(0, 1),
      layoutHints: {
        ...timeline.layoutHints,
        readingOrder: [timeline.blocks[0]!.id],
      },
    };

    expect(timeline.assetSlots[0]?.required).toBe(false);
    expect(exceedsFixedCanvasCapacity(timeline)).toBe(true);
    expect(exceedsFixedCanvasCapacity(denseTimeline)).toBe(true);
    expect(exceedsFixedCanvasCapacity(interactionLedTimeline)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        denseTimeline,
        pageWriterInputFor(denseTimeline, "timeline"),
      ),
    ).not.toThrow();
  });

  it("budgets reveal and explore pages by semantic regions, not paragraph length", () => {
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
    const interactionLedKnowledge = {
      ...denseKnowledge,
      blocks: denseKnowledge.blocks.slice(0, 1),
      layoutHints: {
        ...denseKnowledge.layoutHints,
        readingOrder: [denseKnowledge.blocks[0]!.id],
      },
    };

    expect(exceedsFixedCanvasCapacity(denseKnowledge)).toBe(true);
    expect(exceedsFixedCanvasCapacity(interactionLedKnowledge)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        denseKnowledge,
        pageWriterInputFor(denseKnowledge, "knowledge_card"),
      ),
    ).not.toThrow();
    expect(exceedsFixedCanvasCapacity(knowledgeWithVisual)).toBe(true);
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
    const interactionLedComparison = {
      ...comparisonWithVisual,
      blocks: comparisonWithVisual.blocks.slice(0, 1).map((block) => ({
        ...block,
        supportingPoints: block.supportingPoints.slice(0, 1),
      })),
      layoutHints: {
        ...comparisonWithVisual.layoutHints,
        readingOrder: [comparisonWithVisual.blocks[0]!.id],
      },
    };

    expect(exceedsFixedCanvasCapacity(denseComparison)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseComparison,
        pageWriterInputFor(denseComparison, "comparison"),
      ),
    ).not.toThrow();
    expect(exceedsFixedCanvasCapacity(interactionLedComparison)).toBe(false);
    expect(() =>
      validatePageWriterOutput(
        interactionLedComparison,
        pageWriterInputFor(interactionLedComparison, "comparison"),
      ),
    ).not.toThrow();
  });

  it("asks choice content to remove prose that repeats the question", () => {
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
    const interactionLedQuiz = {
      ...compactQuiz,
      narration: [],
      blocks: [],
      layoutHints: {
        ...compactQuiz.layoutHints,
        readingOrder: [],
      },
    };

    expect(exceedsFixedCanvasCapacity(denseQuiz)).toBe(true);
    expect(() =>
      validatePageWriterOutput(
        denseQuiz,
        pageWriterInputFor(denseQuiz, "quiz"),
      ),
    ).not.toThrow();
    expect(exceedsFixedCanvasCapacity(compactQuiz)).toBe(true);
    expect(exceedsFixedCanvasCapacity(interactionLedQuiz)).toBe(false);
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
    ).not.toThrow();
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

  it("leaves the visual primitive open for the page designer", () => {
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

    expect(programmingRuntime.visualPrimitive).toBe("none");
    expect(mathRuntime.visualPrimitive).toBe("none");
  });

  it("adds stable technical IDs to the single choice question", () => {
    expect(
      materializePageWriterInteraction({
        type: "choice",
        prompt: "哪一项符合定义？",
        options: ["选项一", "选项二"],
        correctOptionIndex: 1,
        feedbackSuccess: "选项二满足定义中的全部条件。",
        feedbackRetry: "请重新核对定义中的必要条件。",
        maxAttempts: 2,
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
