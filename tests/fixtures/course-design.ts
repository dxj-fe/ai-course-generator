import type {
  CourseIntent,
  CoursePlan,
  PageContentDSL,
  PedagogyPlan,
  StoryArc,
  VisualBrief,
} from "../../src/shared/course-schema";

export const courseDesignIntent: CourseIntent = {
  topic: "太阳系",
  audienceAgeRange: { min: 8, max: 8, label: "8 岁儿童" },
  courseLength: 3,
  visualStyle: "sci-fi",
  difficulty: "beginner",
  mustInclude: ["互动问答"],
  avoid: ["复杂公式"],
  language: "zh-CN",
};

export const courseDesignOutline: CoursePlan = {
  overview: "通过观察、探索和回顾认识太阳系的基础结构。",
  learningObjectives: [
    "学习者能够说出太阳系的核心组成。",
    "学习者能够区分恒星与行星的基本特点。",
  ],
  pages: [
    {
      id: "page-01-cover",
      order: 1,
      pageType: "cover",
      title: "太阳系探索启程",
      learningObjective: "学习者能够了解本节课的探索任务。",
      contentSummary: "用宇宙观察任务建立学习期待。",
      interactionType: "navigate",
      assetNeeds: [],
      functionalTemplateId: "course-cover",
      styleTemplateId: "sci-fi",
      assetIds: [],
      dependsOnPageIds: [],
      status: "planned",
    },
    {
      id: "page-02-knowledge",
      order: 2,
      pageType: "knowledge_card",
      title: "恒星与行星",
      learningObjective: "学习者能够区分恒星和行星的基础特点。",
      contentSummary: "通过两组知识卡比较太阳和行星。",
      interactionType: "reveal",
      assetNeeds: [],
      functionalTemplateId: "knowledge-card-grid",
      styleTemplateId: "sci-fi",
      assetIds: [],
      dependsOnPageIds: ["page-01-cover"],
      status: "planned",
    },
    {
      id: "page-03-summary",
      order: 3,
      pageType: "summary",
      title: "太阳系探索总结",
      learningObjective: "学习者能够复述太阳系的两个核心知识点。",
      contentSummary: "回顾太阳系组成并完成口头检查。",
      interactionType: "navigate",
      assetNeeds: [],
      functionalTemplateId: "recap-summary",
      styleTemplateId: "sci-fi",
      assetIds: [],
      dependsOnPageIds: ["page-02-knowledge"],
      status: "planned",
    },
  ],
};

export const pedagogyPlan: PedagogyPlan = {
  audienceSummary: "8 岁初学者，需要短句、具体类比和频繁理解检查。",
  ageAdaptation: {
    readingLevel: "小学二年级短句阅读水平",
    tone: "好奇、鼓励且不幼稚",
    explanationDepth: "只解释恒星与行星的可观察差异",
    chunkingStrategy: "每页只承载一个关键问题",
  },
  learningProgression: [
    "先建立太阳系整体探索任务。",
    "再比较恒星和行星的关键差异。",
    "最后通过复述完成知识回收。",
  ],
  interactionCadence: {
    recommendedIntervalPages: 1,
    maxPassivePages: 1,
    strategy: "每页都安排观察、揭示或口头复述动作。",
  },
  pageGuidance: [
    {
      pageId: "page-01-cover",
      cognitiveLevel: "remember",
      scaffolding: ["先观察主视觉，再说出已有印象。"],
      interactionPurpose: "激活对宇宙的已有认识。",
      checkForUnderstanding: "请学习者说出今天要探索的主题。",
    },
    {
      pageId: "page-02-knowledge",
      cognitiveLevel: "understand",
      scaffolding: ["先观察太阳，再与一颗行星比较。"],
      interactionPurpose: "通过揭示卡主动比较两个概念。",
      checkForUnderstanding: "请学习者指出哪一个会自己发光。",
    },
    {
      pageId: "page-03-summary",
      cognitiveLevel: "apply",
      scaffolding: ["用一句话复述，再查看总结。"],
      interactionPurpose: "主动提取核心知识而非只重读。",
      checkForUnderstanding: "请学习者说出恒星与行星的一项区别。",
    },
  ],
  misconceptions: [
    {
      misconception: "所有星星都是围绕地球转动的行星。",
      correction: "用太阳与地球的角色对比澄清恒星和行星。",
    },
  ],
  accessibilityStrategies: ["关键信息同时使用文字和图形表达。"],
};

export const storyArc: StoryArc = {
  narrativeMode: "light",
  premise: "学习者作为小小观察员，帮助空间站整理太阳系观察记录。",
  learnerRole: "空间站小小观察员",
  mission: "辨认太阳和行星，并完成一份简短观察报告。",
  characters: [{ name: "星星助手", role: "提示任务和连接页面" }],
  pageBeats: [
    {
      pageId: "page-01-cover",
      beat: "收到空间站发来的观察邀请。",
      transition: "助手打开第一份恒星与行星记录。",
    },
    {
      pageId: "page-02-knowledge",
      beat: "比较两份记录并找出关键差异。",
      transition: "助手邀请学习者提交最终观察结论。",
    },
    {
      pageId: "page-03-summary",
      beat: "复述发现并完成观察任务。",
      transition: "以获得下一次探索邀请结束。",
    },
  ],
  tone: "轻量探索、清楚可信",
  continuityRules: ["故事只服务学习任务，不添加新的天文知识。"],
};

export const visualBrief: VisualBrief = {
  styleTemplateId: "sci-fi",
  visualConcept: "以儿童空间观察台串联三页，突出清晰轨道和单一视觉焦点。",
  layoutPrinciples: [
    "始终保留清晰的标题和主任务区。",
    "装饰元素不能挤压知识与互动区域。",
  ],
  typographyGuidance: "标题突出探索阶段，正文保持短行和清晰层级。",
  colorUsage: "只使用 sci-fi StyleTemplate 的语义颜色变量。",
  assetDirection: {
    medium: "简洁的矢量太空插画",
    composition: "单一主体配少量轨道元素，保留文字安全区",
    negativeConstraints: ["避免写实恐怖宇宙画面", "避免装饰过密"],
  },
  pageGuidance: [
    {
      pageId: "page-01-cover",
      theme: "从舷窗进入太阳系观察任务",
      focalPoint: "空间观察台入口",
      composition: "居中主视觉配底部行动按钮",
      graphicMotif: "用轨道圆环和舷窗边框建立观察入口",
      assetPurpose: "建立探索情境和方向感",
    },
    {
      pageId: "page-02-knowledge",
      theme: "两份天体光源档案的并置调查",
      focalPoint: "太阳与行星对比卡",
      composition: "左右两组等权卡片，揭示前保持轮廓提示",
      graphicMotif: "用发光核心与反射轨道对比是否自身发光",
      assetPurpose: "帮助观察能否自行发光的差异",
    },
    {
      pageId: "page-03-summary",
      theme: "完成观察记录并封存两条发现",
      focalPoint: "两项探索发现",
      composition: "纵向总结卡配一个完成状态标记",
      graphicMotif: "用两枚已确认的轨道印章回收核心结论",
      assetPurpose: "帮助回忆而不引入新信息",
    },
  ],
  motionGuidance: {
    intensity: "subtle",
    strategy: "只在揭示卡和任务完成时使用短暂反馈。",
    reducedMotionAlternative: "使用即时状态变化和清晰文本标签替代动画。",
  },
  accessibilityRules: [
    "信息不能只依赖颜色区分。",
    "正文和交互文字必须保持可读对比度。",
  ],
};

export const pageContentDsl: PageContentDSL = {
  pageId: "page-02-knowledge",
  functionalTemplateId: "knowledge-card-grid",
  title: "恒星与行星",
  runtime: {
    sceneKind: "demo",
    visualPrimitive: "concept-map",
    motionPlan: {
      intensity: "guided",
      cuePoints: [
        {
          id: "cue-block-01",
          action: "reveal",
          targetId: "block-01",
          delayMs: 120,
          durationMs: 420,
        },
      ],
    },
    completionRule: {
      type: "interaction-complete",
      interactionId: "interaction-page-02-knowledge",
    },
  },
  narration: ["先观察太阳，再与一颗行星比较它们是否会自己发光。"],
  blocks: [
    {
      id: "block-01",
      kind: "concept",
      heading: "恒星",
      body: "恒星会自己发光，太阳就是离我们最近的恒星。",
      supportingPoints: ["太阳为太阳系提供光和热。"],
    },
    {
      id: "block-02",
      kind: "concept",
      heading: "行星",
      body: "行星不会自己发光，而是反射恒星的光。",
      supportingPoints: ["地球是一颗围绕太阳运行的行星。"],
    },
  ],
  interaction: {
    type: "reveal",
    prompt: "逐项揭示并比较恒星和行星。",
    items: [
      { id: "item-01", label: "恒星", content: "会自己发光" },
      { id: "item-02", label: "行星", content: "反射恒星的光" },
    ],
  },
  assetSlots: [],
  layoutHints: {
    contentDensity: "balanced",
    visualPriority: "恒星与行星的核心差异优先",
    groupingStrategy: "两个同层级概念保持清晰对照",
    readingOrder: ["block-01", "block-02"],
  },
};
