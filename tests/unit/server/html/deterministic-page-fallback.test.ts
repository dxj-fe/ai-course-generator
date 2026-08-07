import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import {
  renderDeterministicPageFallback,
} from "../../../../src/server/course/page/deterministic-fallback";
import { buildQaLessonSrcDoc } from "../../../../src/server/infra/browser/page-screenshot";
import { validateHtmlEngineerOutput } from "../../../../src/server/agent/plugins/model-steps/course/html-engineer-model-step";
import { buildFittedLessonSrcDoc } from "../../../../src/shared/html-preview";
import type {
  AssetGenerationResult,
  PageContentDSL,
  VisualBrief,
} from "../../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";
import { getStyleTemplate } from "../../../../src/shared/templates/style";

const styleTemplate = getStyleTemplate("kids-playful");

if (!styleTemplate) {
  throw new Error("测试需要 kids-playful 样式模板");
}

function getExample(templateId: string) {
  const example = getFunctionalTemplateDslExample(templateId);
  if (!example) throw new Error(`找不到 ${templateId} 示例`);
  return example;
}

function createReadyAsset(
  content: PageContentDSL,
  {
    assetType,
    transparencyUnavailable = false,
  }: {
    assetType: "background" | "character_sticker";
    transparencyUnavailable?: boolean;
  },
): AssetGenerationResult {
  const slot = content.assetSlots[0];
  if (!slot) throw new Error("测试页面必须声明素材槽位");

  return {
    request: {
      assetSlotId: slot.id,
      assetType,
      usage: slot.purpose,
      prompt: "A polished educational illustration without text.",
      transparentBackground: assetType === "character_sticker",
      safeArea: {
        position: assetType === "background" ? "left" : "none",
        coveragePercent: assetType === "background" ? 40 : 0,
        description: "测试安全区",
      },
      aspectRatio: assetType === "background" ? "16:9" : "3:4",
    },
    status: "ready",
    asset: {
      id: `asset-${assetType}`,
      type: "illustration",
      role: slot.role,
      source: "generated",
      status: "ready",
      uri: `/api/assets/asset-${assetType}`,
      altText: slot.altTextGuidance,
      generationPrompt: "A polished educational illustration without text.",
      mimeType: "image/png",
      dimensions:
        assetType === "background"
          ? { width: 1600, height: 900 }
          : { width: 1200, height: 1600 },
      usedByPageIds: [content.pageId],
    },
    provider: "test-provider",
    model: "test-model",
    durationMs: 10,
    ...(transparencyUnavailable
      ? { warnings: ["TRANSPARENCY_UNAVAILABLE"] }
      : {}),
  };
}

function createSubstantialStoryContent(): PageContentDSL {
  const example = getExample("story-intro");
  return {
    ...example,
    title: "毕加索的艺术人生开端",
    narration: [
      "从童年生活到艺术启蒙，沿着三个关键节点观察一位艺术家的风格如何逐步萌芽。",
    ],
    blocks: [
      {
        id: "block-01",
        kind: "fact",
        label: "早期生活背景",
        heading: "童年的艺术起点",
        body: "父亲的美术工作让他很早接触素描与油画，并通过持续训练建立了扎实的观察能力和造型基础。",
        supportingPoints: ["家庭工作室是他最早的艺术实践场所。"],
      },
      {
        id: "block-02",
        kind: "concept",
        label: "艺术启蒙关键",
        heading: "城市文化的影响",
        body: "进入新的城市文化环境后，他接触了更自由的艺术表达，开始尝试突破学院派绘画的既有框架。",
        supportingPoints: ["新的艺术社群拓宽了他的观看方式。"],
      },
      {
        id: "block-03",
        kind: "example",
        label: "早期风格雏形",
        heading: "作品中的变化",
        body: "早期作品仍保留写实基础，但已经更关注人物情感与观看角度，为之后持续探索新的形式埋下伏笔。",
        supportingPoints: ["技术训练与表达探索在这一阶段并行。"],
      },
    ],
    interaction: {
      type: "choice",
      questions: [
        {
          id: "question-01",
          prompt: "哪项经历最能说明艺术环境推动了风格探索？",
          options: [
            { id: "option-01-01", label: "从小接受基础绘画训练" },
            {
              id: "option-01-02",
              label: "接触新的艺术社群并尝试突破传统框架",
            },
            { id: "option-01-03", label: "完成一幅写实主义作品" },
            { id: "option-01-04", label: "整理童年时期的练习手稿" },
          ],
          correctOptionId: "option-01-02",
          feedback: {
            success: "正确，新的艺术环境直接推动了表达方式的变化。",
            retry: "请寻找与艺术环境和表达突破都有关的选项。",
          },
          maxAttempts: 2,
        },
      ],
    },
    layoutHints: {
      ...example.layoutHints,
      readingOrder: ["block-01", "block-02", "block-03"],
    },
  };
}

function createSkyKnowledgeContent(): PageContentDSL {
  const content = structuredClone(getExample("knowledge-card-grid"));
  content.pageId = "page-01";
  content.title = "同一片天空为什么颜色不同";
  content.narration = [
    "观察白天和傍晚的天空图片，思考颜色变化的原因。",
  ];
  content.blocks = [
    {
      id: "block-01",
      kind: "fact",
      heading: "天空颜色变化的现象",
      body: "白天的天空呈蓝色，傍晚的晚霞呈红色，同一片天空在不同时间颜色不同。",
      supportingPoints: ["这是日常可见的自然现象。"],
    },
    {
      id: "block-02",
      kind: "concept",
      heading: "大气层厚度的影响",
      body: "太阳光穿过大气层的厚度随时间变化：白天较薄，傍晚较厚。",
      supportingPoints: ["太阳在头顶时，光线穿过的大气层路径更短。"],
    },
    {
      id: "block-03",
      kind: "concept",
      heading: "光散射的核心",
      body: "光遇到空气中的微小颗粒会发生散射，不同颜色的光散射程度不同。",
      supportingPoints: ["波长较短的光更容易被散射。"],
    },
  ];
  content.interaction = {
    type: "explore",
    prompt: "点击查看不同时间天空颜色变化的原因",
    items: [
      {
        id: "item-01",
        label: "白天天空",
        content: "大气层薄，蓝光被大量散射，所以天空呈现蓝色。",
      },
      {
        id: "item-02",
        label: "傍晚天空",
        content: "大气层厚，蓝光被散射殆尽，红光保留，所以晚霞偏红。",
      },
    ],
  };
  content.assetSlots = [];
  content.layoutHints = {
    ...content.layoutHints,
    contentDensity: "balanced",
    readingOrder: ["block-01", "block-02", "block-03"],
  };
  return content;
}

function createSkyScatteringContent(): PageContentDSL {
  const content = createSkyKnowledgeContent();
  content.pageId = "page-03";
  content.title = "光遇到空气会发生什么";
  content.narration = ["观察光遇到空气分子散射的动画，理解散射过程。"];
  content.blocks = [
    {
      id: "block-01",
      kind: "concept",
      heading: "光的散射定义",
      body: "光遇到微小颗粒时，光线会向不同方向散开，这种现象就是光的散射，是天空颜色变化的核心原因。",
      supportingPoints: ["空气中的微小颗粒包括空气分子、灰尘等。"],
    },
    {
      id: "block-02",
      kind: "concept",
      heading: "散射与波长的关系",
      body: "不同颜色的光波长不同，波长越短的光，散射程度越强；波长越长的光，散射程度越弱。",
      supportingPoints: ["可见光中，红光波长最长，蓝光波长最短。"],
    },
    {
      id: "block-03",
      kind: "concept",
      heading: "空气分子对光的散射作用",
      body: "空气中的微小分子会对太阳光产生散射，让太阳光向各个方向散开，这是白天天空呈现蓝色的关键原因。",
      supportingPoints: ["空气分子的大小刚好适合散射波长较短的蓝光。"],
    },
  ];
  content.interaction = {
    type: "explore",
    prompt: "点击不同颜色的光标签，查看它们在空气中的散射差异",
    items: [
      {
        id: "item-01",
        label: "红光",
        content: "波长较长，在空气中散射程度弱，能传播到更远的地方。",
      },
      {
        id: "item-02",
        label: "蓝光",
        content: "波长较短，在空气中散射程度强，会向各个方向散开。",
      },
      {
        id: "item-03",
        label: "绿光",
        content: "波长中等，在空气中散射程度介于红光和蓝光之间。",
      },
    ],
  };
  content.assetSlots = [
    {
      id: "asset-slot-01",
      type: "illustration",
      role: "inline",
      purpose: "展示光与空气分子相互作用的示意图",
      required: true,
      altTextGuidance: "展示光与空气分子相互作用的示意图。",
    },
  ];
  return content;
}

function createFixedCanvasRegressionContents(): PageContentDSL[] {
  const assetSlot = {
    id: "asset-slot-01",
    type: "illustration" as const,
    role: "inline" as const,
    purpose: "展示页面核心概念的视觉示意",
    required: true,
    altTextGuidance: "展示页面核心概念的视觉示意。",
  };

  const knowledge = structuredClone(getExample("knowledge-card-grid"));
  knowledge.title = "毕加索核心创作时期划分";
  knowledge.narration = [
    "通过三张知识卡梳理核心创作时期，并建立时期与风格的明确关联。",
  ];
  knowledge.blocks = knowledge.blocks.map((block, index) => ({
    ...block,
    heading: ["蓝色时期（1901-1904）", "玫瑰时期（1904-1906）", "立体主义时期（1907-1917）"][
      index
    ]!,
    body: [
      "作品以冷蓝色调为主，多描绘贫困、孤独的底层人物，线条细腻且带有忧郁氛围。",
      "作品转向暖粉和玫瑰色调，题材多为马戏团人物，线条流畅，情感更温暖。",
      "作品打破传统透视，用几何块面分解物体并同时呈现多个视角。",
    ][index]!,
  }));
  knowledge.assetSlots = [assetSlot];

  const comparison = structuredClone(getExample("comparison-board"));
  comparison.title = "不同时期作品风格对比";
  comparison.narration = [
    "对比三个核心创作时期的代表作品，重点观察色调、线条和造型差异。",
  ];
  comparison.blocks = [
    {
      ...comparison.blocks[0]!,
      id: "block-blue",
      heading: "蓝色时期（1901-1904）",
      body: "作品以冷蓝色调为主，多描绘贫困、孤独的底层人物，线条柔和细腻，造型偏向写实。",
      supportingPoints: [],
    },
    {
      ...comparison.blocks[1]!,
      id: "block-rose",
      heading: "玫瑰时期（1904-1906）",
      body: "作品转向暖粉和玫瑰色调，题材多为马戏团人物，线条流畅，氛围温暖明快。",
      supportingPoints: [],
    },
    {
      ...comparison.blocks[1]!,
      id: "block-cubism",
      heading: "立体主义时期（1907-1917）",
      body: "作品用几何块面分解物体，造型抽象并强调多视角同时呈现，是最具实验性的阶段。",
      supportingPoints: [],
    },
  ];
  comparison.assetSlots = [assetSlot];

  const quiz = structuredClone(getExample("interactive-quiz"));
  if (quiz.interaction.type !== "choice") {
    throw new Error("interactive-quiz 示例必须使用 choice interaction");
  }
  quiz.title = "毕加索风格知识小测验";
  quiz.narration = [
    "根据不同创作时期的风格特点，判断作品所属时期，作答后查看判断依据。",
  ];
  quiz.blocks = [
    {
      id: "block-question",
      kind: "question",
      heading: "作品时期判断",
      body: "分析作品的风格特征，选择它所属的毕加索创作时期。",
      supportingPoints: [
        "蓝色时期偏冷色与忧郁主题；玫瑰时期偏暖色与柔和情感；立体主义强调几何分解与多视角。",
      ],
    },
  ];
  quiz.interaction = {
    ...quiz.interaction,
    questions: [
      {
        ...quiz.interaction.questions[0]!,
        prompt: "观察作品的几何分解特征，判断其所属时期。",
        options: [
          { id: "option-blue", label: "蓝色时期" },
          { id: "option-rose", label: "玫瑰时期" },
          { id: "option-cubism", label: "立体主义时期" },
          { id: "option-classical", label: "新古典主义时期" },
        ],
        correctOptionId: "option-cubism",
      },
    ],
  };
  quiz.assetSlots = [assetSlot];

  const recap = structuredClone(getExample("recap-summary"));
  recap.title = "毕加索生平与作品赏析总结";
  recap.narration = ["回顾各时期风格，形成可迁移的作品赏析框架。"];
  recap.blocks = [
    ...recap.blocks,
    {
      id: "block-method",
      kind: "concept",
      heading: "毕加索作品赏析方法",
      body: "先判断作品所属时期，再分析对应风格特征，并结合时代背景理解创作意图。",
      supportingPoints: [],
    },
  ];
  recap.assetSlots = [assetSlot];

  return [knowledge, comparison, quiz, recap];
}

function createAchievementCapacityBoundaryContent(): PageContentDSL {
  const achievement = structuredClone(getExample("achievement-task"));
  if (achievement.interaction.type !== "input") {
    throw new Error("achievement-task 示例必须使用 input interaction");
  }

  achievement.title = "独立赏析毕加索《亚维农少女》";
  achievement.narration = ["观察人物空间与视角完成有画面依据的赏析"];
  achievement.blocks = [
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
  ];
  achievement.interaction = {
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
  };
  achievement.assetSlots = [
    {
      id: "asset-slot-01",
      type: "illustration",
      role: "inline",
      purpose: "展示《亚维农少女》的构图与造型示意",
      required: true,
      altTextGuidance: "展示作品人物造型、视角和空间结构的示意图。",
    },
  ];
  achievement.layoutHints = {
    ...achievement.layoutHints,
    readingOrder: ["block-period", "block-method"],
  };

  return achievement;
}

function createLongInputQuizContent(): PageContentDSL {
  const quiz = structuredClone(getExample("interactive-quiz"));
  quiz.title = "设计安全的散射实验";
  quiz.narration = [
    "请设计一个安全的散射实验，列出所需材料、操作步骤和安全注意事项。",
  ];
  quiz.blocks = [
    {
      id: "block-01",
      kind: "concept",
      heading: "安全散射实验的核心要素",
      body: "安全的散射实验需使用常见易获取的材料，操作简单且无危险。",
      supportingPoints: ["推荐材料：激光笔、透明容器、水、少量牛奶"],
    },
  ];
  quiz.interaction = {
    type: "input",
    prompt: "请输入你设计的散射实验的材料、步骤和安全注意事项：",
    placeholder:
      "例如：材料：激光笔、透明玻璃杯、水、1勺牛奶；步骤：1. 玻璃杯装半杯水，加入牛奶搅拌；2. 用激光笔从侧面照射水中，观察光路；安全注意事项：1. 激光笔不直射眼睛；2. 实验后整理好器材。",
    evaluationCriteria: [
      "包含至少3种推荐材料",
      "步骤清晰，能说明如何观察到光的散射",
      "包含至少2条安全注意事项",
    ],
    feedback: {
      success: "你设计的实验符合安全要求。",
      retry: "请检查材料、步骤和安全注意事项。",
    },
  };
  quiz.assetSlots = [];
  quiz.runtime = {
    sceneKind: "practice",
    visualPrimitive: "process",
    motionPlan: {
      intensity: "none",
      cuePoints: [
        {
          id: "cue-wait-interaction",
          action: "wait-for-interaction",
          targetId: "interaction-page-quiz",
          delayMs: 0,
          durationMs: 180,
        },
      ],
    },
    completionRule: {
      type: "interaction-complete",
      interactionId: "interaction-page-quiz",
    },
  };
  return quiz;
}

function createMobileComparisonContent(): PageContentDSL {
  const comparison = structuredClone(getExample("comparison-board"));
  comparison.title = "晚霞为什么偏红";
  comparison.narration = [
    "对比白天和傍晚天空的颜色成因，分析晚霞偏红的原因。",
  ];
  comparison.blocks = [
    {
      id: "block-01",
      kind: "fact",
      heading: "白天天空颜色成因",
      body: "白天太阳光穿过较薄的大气层，蓝光波长较短，更容易被散射，所以天空呈蓝色。",
      supportingPoints: ["大气层厚度较薄"],
    },
    {
      id: "block-02",
      kind: "fact",
      heading: "傍晚天空颜色成因",
      body: "傍晚太阳光穿过更厚的大气层，大部分蓝光被散射，红光散射较少，所以晚霞呈红色。",
      supportingPoints: ["大气层厚度更厚"],
    },
  ];
  comparison.interaction = {
    type: "sort",
    prompt: "请将以下对比维度与对应的白天、傍晚情况匹配。",
    items: [
      { id: "item-01", label: "大气层厚度", content: "白天：较薄；傍晚：更厚" },
      { id: "item-02", label: "散射的蓝光量", content: "白天：较多；傍晚：较少" },
      { id: "item-03", label: "散射的红光量", content: "白天：较少；傍晚：较多" },
    ],
    correctOrderIds: ["item-01", "item-02", "item-03"],
    feedback: {
      success: "正确匹配了白天和傍晚的散射差异。",
      retry: "请再对比大气层厚度与散射光量。",
    },
  };
  comparison.assetSlots = [];
  return comparison;
}

function createFiveNodeTimelineContent(): PageContentDSL {
  const timeline = structuredClone(getExample("learning-timeline"));
  if (timeline.interaction.type !== "explore") {
    throw new Error("learning-timeline 示例必须使用 explore interaction");
  }

  timeline.title = "猴王出世时间线";
  timeline.narration = ["按情节顺序观察石猴如何一步步被众猴推举为王。"];
  timeline.blocks = [
    {
      id: "block-01",
      kind: "fact",
      label: "仙石孕育",
      heading: "花果山仙石孕育石猴",
      body: "仙石吸收天地精华，裂开后化作一只五官俱备的石猴。",
      supportingPoints: [],
    },
    {
      id: "block-02",
      kind: "fact",
      label: "初识群猴",
      heading: "石猴融入花果山猴群",
      body: "石猴与群猴一起生活嬉戏，凭胆识逐渐获得伙伴的信任。",
      supportingPoints: [],
    },
    {
      id: "block-03",
      kind: "fact",
      label: "发现瀑布",
      heading: "群猴寻找涧水源头",
      body: "群猴顺着涧水来到瀑布前，约定谁敢进入就拜谁为王。",
      supportingPoints: [],
    },
    {
      id: "block-04",
      kind: "fact",
      label: "探入水帘",
      heading: "石猴纵身跃入瀑布",
      body: "石猴率先穿过水帘，发现可供猴群安居的水帘洞。",
      supportingPoints: [],
    },
    {
      id: "block-05",
      kind: "fact",
      label: "推举为王",
      heading: "石猴兑现约定成为猴王",
      body: "群猴进入水帘洞后遵守承诺，共同推举石猴为美猴王。",
      supportingPoints: [],
    },
  ];
  timeline.interaction = {
    type: "explore",
    prompt: "聚焦一个节点，查看它怎样推动下一段情节。",
    items: [
      {
        id: "item-01",
        label: "仙石孕育",
        content: "奇异身世为石猴后续的不凡表现埋下伏笔。",
      },
      {
        id: "item-02",
        label: "初识群猴",
        content: "融入猴群让石猴有机会在共同挑战中证明自己。",
      },
      {
        id: "item-03",
        label: "发现瀑布",
        content: "群猴的约定把寻找源头转化为一次勇气考验。",
      },
      {
        id: "item-04",
        label: "探入水帘",
        content: "率先行动既解决了住处问题，也证明了石猴的胆识。",
      },
      {
        id: "item-05",
        label: "推举为王",
        content: "群猴兑现承诺，完成石猴从伙伴到首领的身份变化。",
      },
    ],
  };
  timeline.assetSlots = [
    {
      id: "asset-slot-01",
      type: "illustration",
      role: "inline",
      purpose: "展示石猴穿过水帘并发现洞穴的情节插图",
      required: false,
      altTextGuidance: "石猴穿过瀑布，发现水帘洞内部空间。",
    },
  ];
  timeline.layoutHints = {
    ...timeline.layoutHints,
    readingOrder: timeline.blocks.map((block) => block.id),
  };

  return timeline;
}

describe("renderDeterministicPageFallback advanced layout", () => {
  it("renders a contract-complete Broadside fallback with a code-native visual", () => {
    const broadside = getStyleTemplate("broadside");
    if (!broadside) throw new Error("测试需要 broadside 样式模板");
    const content = {
      ...getExample("knowledge-card-grid"),
      assetSlots: [],
    };
    const html = renderDeterministicPageFallback({
      content,
      styleTemplate: broadside,
    });

    expect(html).toContain('data-keya-renderer="broadside-structural"');
    expect(html).toContain('class="masthead"');
    expect(html).toContain('class="course-native-visual"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('class="lesson-card"');
    expect(html).not.toContain("border-radius: var(--course-radius-card)");
    expect(() =>
      validateHtmlEngineerOutput(html, {
        content,
        visualBrief: {
          styleTemplateId: "broadside",
        } as unknown as VisualBrief,
      }),
    ).not.toThrow();
  });

  it("marks generated HTML as deterministic", () => {
    const html = renderDeterministicPageFallback({
      content: getExample("story-intro"),
      styleTemplate,
    });

    expect(html).toContain('data-keya-renderer="deterministic"');
  });

  it("fills the visual rail with a real code-native primitive when no asset exists", () => {
    const content = structuredClone(getExample("story-intro"));
    content.assetSlots = [];
    content.runtime.visualPrimitive = "process";
    const html = renderDeterministicPageFallback({
      content,
      styleTemplate,
    });

    expect(html).toContain('data-style-template="kids-playful"');
    expect(html).toContain(
      '<div class="course-native-visual" data-visual-primitive="process"',
    );
    expect(html).toContain('<svg viewBox="0 0 620 360"');
    expect(html.indexOf('class="course-action"')).toBeLessThan(
      html.indexOf('class="course-native-visual"'),
    );
    expect(html).not.toContain(".course-native-visual { display: none; }");
  });

  it("keeps lesson copy visible instead of hiding every block in closed details", () => {
    const content = getExample("story-intro");
    const html = renderDeterministicPageFallback({
      content,
      styleTemplate,
    });

    expect(html).toContain('data-template="story-intro"');
    expect(html).toContain(
      `data-block-count="${String(content.blocks.length)}"`,
    );
    expect(html).not.toContain('<details class="lesson-card"');

    for (const [index, block] of content.blocks.entries()) {
      expect(html).toContain(
        `<article class="lesson-card" data-block-index="${String(index + 1).padStart(2, "0")}" data-block-id="${block.id}" data-runtime-target-id="${block.id}">`,
      );
      expect(html).toContain(`<h2>${block.heading}</h2>`);
      expect(html).toContain(`<p>${block.body}</p>`);
    }
  });

  it("turns a single background asset into a full visual region", () => {
    const content = getExample("course-cover");
    const html = renderDeterministicPageFallback({
      assets: [createReadyAsset(content, { assetType: "background" })],
      content,
      styleTemplate,
    });

    expect(html).toContain('data-template="course-cover"');
    expect(html).toContain(
      'class="course-asset-frame asset-panel--background asset-panel--role-hero"',
    );
    expect(html).toContain(
      "main[data-template=\"course-cover\"] .asset-panel",
    );
    expect(html).toContain("height: 100%;");
    expect(html).toContain(
      ".asset-panel--background .course-asset {\n      width: 68%;",
    );
    expect(html).not.toContain("height: min(18vh, 140px)");
  });

  it("lets wide scene assets span the stage instead of cropping them into a narrow rail", () => {
    const content = getExample("story-intro");
    const html = renderDeterministicPageFallback({
      assets: [createReadyAsset(content, { assetType: "background" })],
      content,
      styleTemplate,
    });

    expect(html).toContain(
      ".course-stage:has(.asset-panel--background) .asset-panel",
    );
    expect(html).toContain("grid-area: 1 / 1 / 2 / 3;");
    expect(html).toContain(
      ".course-stage:has(.asset-panel--background) .interaction-panel",
    );
  });

  it("covers the visual rail when a requested transparent sticker is returned opaque", () => {
    const content = getExample("story-intro");
    const html = renderDeterministicPageFallback({
      assets: [
        createReadyAsset(content, {
          assetType: "character_sticker",
          transparencyUnavailable: true,
        }),
      ],
      content,
      styleTemplate,
    });

    expect(html).toContain(
      "asset-panel--character_sticker asset-panel--opaque-sticker",
    );
    expect(html).toContain(
      ".asset-panel--opaque-sticker .course-asset",
    );
    expect(html).toContain("object-fit: cover;");
  });

  it("uses a dedicated two-zone composition for practice and task pages", () => {
    for (const templateId of ["interactive-quiz", "achievement-task"]) {
      const html = renderDeterministicPageFallback({
        content: getExample(templateId),
        styleTemplate,
      });

      expect(html).toContain(`data-template="${templateId}"`);
      expect(html).toContain(
        `main[data-template="${templateId}"] .course-stage`,
      );
      expect(html).toContain(
        `main[data-template="${templateId}"] .course-action`,
      );
    }
  });

  it(
    "keeps mobile quiz feedback inside the QA viewport after submit",
    async () => {
      const content = createFixedCanvasRegressionContents().find(
        ({ functionalTemplateId }) =>
          functionalTemplateId === "interactive-quiz",
      );
      if (!content) throw new Error("测试数据缺少 interactive-quiz");
      const html = buildQaLessonSrcDoc(
        renderDeterministicPageFallback({ content, styleTemplate }),
        {
          pageId: content.pageId,
          runtime: content.runtime,
          interaction: content.interaction,
        },
      );
      const browser = await chromium.launch({ headless: true });

      try {
        const page = await browser.newPage({
          viewport: { width: 640, height: 360 },
        });
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => document.documentElement.dataset.keyaRuntime === "ready",
        );
        await page.locator(".option").first().click();
        await page.locator('[data-runtime-submit="true"]').click();
        expect(
          await page.locator("[data-keya-runtime-feedback]").isVisible(),
        ).toBe(true);

        const metrics = await page.evaluate(() => {
          const elements = [
            document.documentElement,
            document.body,
            ...document.body.querySelectorAll<HTMLElement>("*"),
          ];
          return {
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            clippedElementCount: elements.filter((element) => {
              if (element.closest("[data-asset-slot-id]")) return false;
              const style = getComputedStyle(element);
              const clipsX = ["hidden", "clip"].includes(style.overflowX);
              const clipsY = ["hidden", "clip"].includes(style.overflowY);
              return (
                (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                (clipsY && element.scrollHeight > element.clientHeight + 1)
              );
            }).length,
          };
        });

        expect(metrics).toEqual({
          documentHeight: 360,
          viewportHeight: 360,
          clippedElementCount: 0,
        });
        await page.close();
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "keeps long input placeholders out of nested QA scroll regions",
    async () => {
      const content = createLongInputQuizContent();
      const natureStyle = getStyleTemplate("nature");
      if (!natureStyle) throw new Error("测试需要 nature 样式模板");
      const html = buildQaLessonSrcDoc(
        renderDeterministicPageFallback({ content, styleTemplate: natureStyle }),
        {
          pageId: content.pageId,
          runtime: content.runtime,
          interaction: content.interaction,
        },
      );
      const browser = await chromium.launch({ headless: true });

      try {
        for (const viewport of [
          { width: 1280, height: 720 },
          { width: 960, height: 540 },
          { width: 640, height: 360 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(
            () => document.documentElement.dataset.keyaRuntime === "ready",
          );
          const metrics = await page.evaluate(() => {
            const elements = [
              document.documentElement,
              document.body,
              ...document.body.querySelectorAll<HTMLElement>("*"),
            ];
            return {
              documentHeight: document.documentElement.scrollHeight,
              viewportHeight: window.innerHeight,
              nestedVerticalOverflowCount: elements.filter((element) => {
                const style = getComputedStyle(element);
                return (
                  ["auto", "scroll"].includes(style.overflowY) &&
                  element.clientHeight > 0 &&
                  element.scrollHeight > element.clientHeight + 1
                );
              }).length,
              clippedElementCount: elements.filter((element) => {
                if (element.closest("[data-asset-slot-id]")) return false;
                const style = getComputedStyle(element);
                const clipsX = ["hidden", "clip"].includes(style.overflowX);
                const clipsY = ["hidden", "clip"].includes(style.overflowY);
                return (
                  (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                  (clipsY && element.scrollHeight > element.clientHeight + 1)
                );
              }).length,
            };
          });

          expect(metrics, `${viewport.width}x${viewport.height}`).toEqual({
            documentHeight: viewport.height,
            viewportHeight: viewport.height,
            nestedVerticalOverflowCount: 0,
            clippedElementCount: 0,
          });
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "fits a two-block comparison and three sort items in the mobile QA canvas",
    async () => {
      const content = createMobileComparisonContent();
      const natureStyle = getStyleTemplate("nature");
      if (!natureStyle) throw new Error("测试需要 nature 样式模板");
      const html = buildQaLessonSrcDoc(
        renderDeterministicPageFallback({ content, styleTemplate: natureStyle }),
        {
          pageId: content.pageId,
          runtime: content.runtime,
          interaction: content.interaction,
        },
      );
      const browser = await chromium.launch({ headless: true });

      try {
        const page = await browser.newPage({
          viewport: { width: 640, height: 360 },
        });
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => document.documentElement.dataset.keyaRuntime === "ready",
        );
        const metrics = await page.evaluate(() => {
          const elements = [
            document.documentElement,
            document.body,
            ...document.body.querySelectorAll<HTMLElement>("*"),
          ];
          return {
            documentHeight: document.documentElement.scrollHeight,
            clippedElementCount: elements.filter((element) => {
              if (element.closest("[data-asset-slot-id]")) return false;
              const style = getComputedStyle(element);
              const clipsX = ["hidden", "clip"].includes(style.overflowX);
              const clipsY = ["hidden", "clip"].includes(style.overflowY);
              return (
                (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                (clipsY && element.scrollHeight > element.clientHeight + 1)
              );
            }).length,
          };
        });

        expect(metrics).toEqual({
          documentHeight: 360,
          clippedElementCount: 0,
        });
        await page.close();
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "fits three knowledge blocks and two explore items in the mobile QA canvas",
    async () => {
      const content = createSkyKnowledgeContent();
      const natureStyle = getStyleTemplate("nature");
      if (!natureStyle) throw new Error("测试需要 nature 样式模板");
      const html = buildQaLessonSrcDoc(
        renderDeterministicPageFallback({ content, styleTemplate: natureStyle }),
        {
          pageId: content.pageId,
          runtime: content.runtime,
          interaction: content.interaction,
        },
      );
      const browser = await chromium.launch({ headless: true });

      try {
        const page = await browser.newPage({
          viewport: { width: 640, height: 360 },
        });
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => document.documentElement.dataset.keyaRuntime === "ready",
        );
        const metrics = await page.evaluate(() => {
          const elements = [
            document.documentElement,
            document.body,
            ...document.body.querySelectorAll<HTMLElement>("*"),
          ];
          return {
            documentHeight: document.documentElement.scrollHeight,
            clippedElementCount: elements.filter((element) => {
              const style = getComputedStyle(element);
              const clipsX = ["hidden", "clip"].includes(style.overflowX);
              const clipsY = ["hidden", "clip"].includes(style.overflowY);
              return (
                (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                (clipsY && element.scrollHeight > element.clientHeight + 1)
              );
            }).length,
          };
        });

        expect(metrics).toEqual({
          documentHeight: 360,
          clippedElementCount: 0,
        });
        await page.close();
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "fits three scattering blocks with a background visual in every QA canvas",
    async () => {
      const content = createSkyScatteringContent();
      const natureStyle = getStyleTemplate("nature");
      if (!natureStyle) throw new Error("测试需要 nature 样式模板");
      const html = buildQaLessonSrcDoc(
        renderDeterministicPageFallback({
          assets: [createReadyAsset(content, { assetType: "background" })],
          content,
          styleTemplate: natureStyle,
        }),
        {
          pageId: content.pageId,
          runtime: content.runtime,
          interaction: content.interaction,
        },
      );
      const browser = await chromium.launch({ headless: true });

      try {
        for (const viewport of [
          { width: 1280, height: 720 },
          { width: 960, height: 540 },
          { width: 640, height: 360 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(
            () => document.documentElement.dataset.keyaRuntime === "ready",
          );
          const metrics = await page.evaluate(() => {
            const elements = [
              document.documentElement,
              document.body,
              ...document.body.querySelectorAll<HTMLElement>("*"),
            ];
            return {
              contentHeight: Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
              ),
              clippedElementCount: elements.filter((element) => {
                if (element.closest("[data-asset-slot-id]")) return false;
                const style = getComputedStyle(element);
                const clipsX = ["hidden", "clip"].includes(style.overflowX);
                const clipsY = ["hidden", "clip"].includes(style.overflowY);
                return (
                  (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                  (clipsY && element.scrollHeight > element.clientHeight + 1)
                );
              }).length,
            };
          });

          expect(metrics, `${viewport.width}x${viewport.height}`).toEqual({
            contentHeight: viewport.height,
            clippedElementCount: 0,
          });
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "keeps a substantial story page readable without clipping required copy",
    async () => {
      const content = createSubstantialStoryContent();
      const html = buildFittedLessonSrcDoc(
        renderDeterministicPageFallback({
          assets: [createReadyAsset(content, { assetType: "background" })],
          content,
          styleTemplate,
        }),
      );
      const browser = await chromium.launch({ headless: true });

      try {
        for (const viewport of [
          { width: 1280, height: 720 },
          { width: 960, height: 540 },
          { width: 640, height: 360 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(
            () =>
              document.documentElement.dataset.keyaViewportFitScale !==
              undefined,
          );
          await page.waitForTimeout(32);

          const metrics = (await page.evaluate(`(() => {
            const root = document.documentElement;
            const body = document.body;
            const requiredCopy = Array.from(document.querySelectorAll(
              "h1, .course-narration p, .course-block-summary, .course-block-body, .interaction-panel fieldset"
            ));
            const clippedElementCount = [root, body, ...body.querySelectorAll("*")]
              .filter((element) => {
                if (
                  element === root ||
                  element === body ||
                  element.dataset.keyaFitExpanded === "true"
                ) return false;
                const style = getComputedStyle(element);
                const clipsX = ["hidden", "clip"].includes(style.overflowX);
                const clipsY = ["hidden", "clip"].includes(style.overflowY);
                return (
                  (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                  (clipsY && element.scrollHeight > element.clientHeight + 1)
                );
              }).length;
            return {
              scale: Number(root.dataset.keyaViewportFitScale ?? "0"),
              clippedElementCount,
              requiredCopyVisible: requiredCopy.every((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.left >= -1 &&
                  rect.top >= -1 &&
                  rect.right <= window.innerWidth + 1 &&
                  rect.bottom <= window.innerHeight + 1
                );
              }),
            };
          })()`)) as {
            scale: number;
            clippedElementCount: number;
            requiredCopyVisible: boolean;
          };

          expect(metrics, `${viewport.width}x${viewport.height}`).toMatchObject({
            clippedElementCount: 0,
            requiredCopyVisible: true,
          });
          expect(metrics.scale, `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(
            viewport.width === 640 ? 0.94 : 0.99,
          );
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "keeps dense card, comparison, quiz and recap pages readable across QA viewports",
    async () => {
      const browser = await chromium.launch({ headless: true });

      try {
        for (const content of createFixedCanvasRegressionContents()) {
          const html = buildFittedLessonSrcDoc(
            renderDeterministicPageFallback({
              assets: [createReadyAsset(content, { assetType: "background" })],
              content,
              styleTemplate,
            }),
          );

          for (const viewport of [
            { width: 1280, height: 720 },
            { width: 960, height: 540 },
            { width: 640, height: 360 },
          ]) {
            const page = await browser.newPage({ viewport });
            await page.route("**/*", (route) => route.abort());
            await page.setContent(html, { waitUntil: "domcontentloaded" });
            await page.waitForFunction(
              () =>
                document.documentElement.dataset.keyaViewportFitScale !==
                undefined,
            );
            await page.waitForTimeout(32);

            const metrics = await page.evaluate(() => {
              const root = document.documentElement;
              const body = document.body;
              const requiredCopy = Array.from(
                document.querySelectorAll<HTMLElement>(
                  "h1, .course-block-summary, .course-block-body, .interaction-panel",
                ),
              );
              const clippedElementCount = [
                root,
                body,
                ...body.querySelectorAll<HTMLElement>("*"),
              ].filter((element) => {
                if (
                  element === root ||
                  element === body ||
                  element.dataset.keyaFitExpanded === "true"
                ) {
                  return false;
                }
                const style = getComputedStyle(element);
                const clipsX = ["hidden", "clip"].includes(style.overflowX);
                const clipsY = ["hidden", "clip"].includes(style.overflowY);
                return (
                  (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                  (clipsY && element.scrollHeight > element.clientHeight + 1)
                );
              }).length;

              return {
                scale: Number(root.dataset.keyaViewportFitScale ?? "0"),
                clippedElementCount,
                requiredCopyVisible: requiredCopy.every((element) => {
                  const style = getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.left >= -1 &&
                    rect.top >= -1 &&
                    rect.right <= window.innerWidth + 1 &&
                    rect.bottom <= window.innerHeight + 1
                  );
                }),
              };
            });

            expect(
              metrics,
              `${content.functionalTemplateId} ${viewport.width}x${viewport.height}`,
            ).toMatchObject({
              clippedElementCount: 0,
              requiredCopyVisible: true,
            });
            expect(
              metrics.scale,
              `${content.functionalTemplateId} ${viewport.width}x${viewport.height}`,
            ).toBeGreaterThanOrEqual(0.9);
            await page.close();
          }
        }
      } finally {
        await browser.close();
      }
    },
    20_000,
  );

  it(
    "keeps the 273-width achievement boundary readable at the production canvas sizes",
    async () => {
      const content = createAchievementCapacityBoundaryContent();
      const html = buildFittedLessonSrcDoc(
        renderDeterministicPageFallback({
          assets: [createReadyAsset(content, { assetType: "background" })],
          content,
          styleTemplate,
        }),
      );
      const browser = await chromium.launch({ headless: true });

      try {
        for (const viewport of [
          { width: 640, height: 360 },
          { width: 768, height: 432 },
          { width: 1365, height: 768 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(
            () =>
              document.documentElement.dataset.keyaViewportFitScale !==
              undefined,
          );
          await page.evaluate(() => {
            const feedback =
              document.querySelector<HTMLElement>(".interaction-panel .feedback");
            if (feedback) {
              feedback.textContent =
                "请补充作品所处时期，并从几何化造型、多视角或压缩空间中选择两项结合画面说明。";
              feedback.hidden = false;
            }
            window.dispatchEvent(new Event("keya:viewport-fit"));
          });
          await page.waitForTimeout(32);

          const metrics = await page.evaluate(() => {
            const root = document.documentElement;
            const body = document.body;
            const requiredCopy = Array.from(
              document.querySelectorAll<HTMLElement>(
                "h1, .course-block-summary, .course-block-body, .interaction-panel",
              ),
            );
            const clippedElementCount = [
              root,
              body,
              ...body.querySelectorAll<HTMLElement>("*"),
            ].filter((element) => {
              if (
                element === root ||
                element === body ||
                element.dataset.keyaFitExpanded === "true"
              ) {
                return false;
              }
              const style = getComputedStyle(element);
              const clipsX = ["hidden", "clip"].includes(style.overflowX);
              const clipsY = ["hidden", "clip"].includes(style.overflowY);
              return (
                (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                (clipsY && element.scrollHeight > element.clientHeight + 1)
              );
            }).length;

            return {
              scale: Number(root.dataset.keyaViewportFitScale ?? "0"),
              clippedElementCount,
              requiredCopyVisible: requiredCopy.every((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.left >= -1 &&
                  rect.top >= -1 &&
                  rect.right <= window.innerWidth + 1 &&
                  rect.bottom <= window.innerHeight + 1
                );
              }),
              textareaHeight:
                document
                  .querySelector<HTMLTextAreaElement>("textarea")
                  ?.getBoundingClientRect().height ?? 0,
              submitHeight:
                document
                  .querySelector<HTMLButtonElement>(
                    "button[data-runtime-submit='true']",
                  )
                  ?.getBoundingClientRect().height ?? 0,
            };
          });

          expect(metrics, `${viewport.width}x${viewport.height}`).toMatchObject({
            clippedElementCount: 0,
            requiredCopyVisible: true,
          });
          expect(
            metrics.scale,
            `${viewport.width}x${viewport.height}`,
          ).toBeGreaterThanOrEqual(0.9);
          expect(
            metrics.textareaHeight,
            `${viewport.width}x${viewport.height}`,
          ).toBeGreaterThanOrEqual(43.5);
          expect(
            metrics.submitHeight,
            `${viewport.width}x${viewport.height}`,
          ).toBeGreaterThanOrEqual(43.5);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
    15_000,
  );

  it(
    "keeps a five-node illustrated timeline at native scale with progressive detail disclosure",
    async () => {
      const content = createFiveNodeTimelineContent();
      const html = buildFittedLessonSrcDoc(
        renderDeterministicPageFallback({
          assets: [createReadyAsset(content, { assetType: "background" })],
          content,
          styleTemplate,
        }),
      );
      const browser = await chromium.launch({ headless: true });

      try {
        for (const viewport of [
          { width: 1280, height: 720 },
          { width: 960, height: 540 },
          { width: 640, height: 360 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(
            () =>
              document.documentElement.dataset.keyaViewportFitScale !==
              undefined,
          );
          await page.waitForTimeout(32);

          const collapsed = await page.evaluate(() => {
            const root = document.documentElement;
            const items = Array.from(
              document.querySelectorAll<HTMLElement>(".explore-item"),
            );
            const details = items
              .map((item) => item.querySelector<HTMLElement>("p"))
              .filter((detail): detail is HTMLElement => detail !== null);

            return {
              scale: Number(root.dataset.keyaViewportFitScale ?? "0"),
              visibleItemCount: items.filter((item) => {
                const rect = item.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.height >= 43.5 &&
                  rect.left >= -1 &&
                  rect.top >= -1 &&
                  rect.right <= window.innerWidth + 1 &&
                  rect.bottom <= window.innerHeight + 1
                );
              }).length,
              visibleDetailCount: details.filter(
                (detail) => getComputedStyle(detail).display !== "none",
              ).length,
            };
          });

          expect(
            collapsed,
            `collapsed ${viewport.width}x${viewport.height}`,
          ).toMatchObject({
            visibleItemCount: 5,
            visibleDetailCount: 0,
          });
          expect(
            collapsed.scale,
            `collapsed ${viewport.width}x${viewport.height}`,
          ).toBeGreaterThanOrEqual(0.99);

          await page.locator(".explore-item").last().focus();
          await page.evaluate(() => {
            window.dispatchEvent(new Event("keya:viewport-fit"));
          });
          await page.waitForTimeout(32);

          const expanded = await page.evaluate(() => {
            const root = document.documentElement;
            const details = Array.from(
              document.querySelectorAll<HTMLElement>(".explore-item p"),
            );
            const activeItem =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            const activeRect = activeItem?.getBoundingClientRect();

            return {
              scale: Number(root.dataset.keyaViewportFitScale ?? "0"),
              visibleDetailCount: details.filter(
                (detail) => getComputedStyle(detail).display !== "none",
              ).length,
              activeItemVisible:
                activeRect !== undefined &&
                activeRect.width > 0 &&
                activeRect.height >= 43.5 &&
                activeRect.left >= -1 &&
                activeRect.top >= -1 &&
                activeRect.right <= window.innerWidth + 1 &&
                activeRect.bottom <= window.innerHeight + 1,
            };
          });

          expect(
            expanded,
            `expanded ${viewport.width}x${viewport.height}`,
          ).toMatchObject({
            visibleDetailCount: 1,
            activeItemVisible: true,
          });
          expect(
            expanded.scale,
            `expanded ${viewport.width}x${viewport.height}`,
          ).toBeGreaterThanOrEqual(0.99);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
    15_000,
  );
});
