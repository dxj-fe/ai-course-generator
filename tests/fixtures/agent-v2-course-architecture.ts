import type {
  CourseArchitecture,
  CourseCreationBrief,
  ReferencePack,
} from "../../src/shared/course-schema";

export const AGENT_V2_COURSE_ID = "course-architect-test";
export const AGENT_V2_REFERENCE_PACK_ID =
  "ref-aaaaaaaaaaaaaaaaaaaaaaaa";

export function createAgentV2Brief(): CourseCreationBrief {
  return {
    originalRequest: "给零基础用户做一门四页太阳系互动课",
    topic: "太阳系",
    audience: "零基础成年人",
    goal: "能区分恒星和行星",
    sectionCount: 4,
    learningMode: "mixed",
    language: "zh-CN",
  };
}

export function createAgentV2ReferencePack(): ReferencePack {
  return {
    version: 1,
    id: AGENT_V2_REFERENCE_PACK_ID,
    sourceName: "太阳系入门资料.md",
    sourceType: "md",
    byteSize: 320,
    summary: "太阳是恒星，地球是围绕太阳运行的行星。",
    keyFacts: [
      {
        text: "太阳是太阳系的恒星。",
        chunkIds: ["chunk-01"],
      },
    ],
    chunks: [
      {
        id: "chunk-01",
        index: 1,
        text: "太阳能自身发光发热，是太阳系的恒星；地球不能自身发光，是围绕太阳运行的行星。",
      },
    ],
    truncated: false,
  };
}

export function createAgentV2Architecture(input?: {
  reverseDisplayDependency?: boolean;
}): CourseArchitecture {
  return {
    version: 1,
    courseId: AGENT_V2_COURSE_ID,
    coursePack: {
      version: 1,
      courseId: AGENT_V2_COURSE_ID,
      topic: "太阳系",
      facts: [
        {
          id: "fact-sun",
          text: "太阳能自身发光发热，是太阳系的恒星。",
          sourceUsages: [
            {
              referencePackId: AGENT_V2_REFERENCE_PACK_ID,
              chunkIds: ["chunk-01"],
            },
          ],
        },
      ],
      terms: [
        {
          term: "恒星",
          definition: "能够自身发光发热的天体。",
          sourceUsages: [
            {
              referencePackId: AGENT_V2_REFERENCE_PACK_ID,
              chunkIds: ["chunk-01"],
            },
          ],
        },
      ],
      examples: [],
      constraints: ["不能把行星说成自身发光的天体"],
    },
    blueprint: {
      version: 1,
      courseId: AGENT_V2_COURSE_ID,
      title: "四页看懂恒星和行星",
      audience: {
        description: "第一次接触天文学的成年人",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-distinguish",
          outcome: "能根据是否自身发光区分恒星和行星",
          evidence: "完成一道天体分类练习并说出理由",
        },
      ],
      courseRules: {
        tone: "直接、清楚",
        terminology: ["恒星", "行星"],
        visualDirection: "使用简单天体卡片突出关键区别",
        visualStyle: "minimal",
        styleTemplateId: "minimal",
        teachingPattern: ["先讲区别", "再做判断"],
      },
    },
    pageTasks: [
      {
        version: 1,
        pageId: "page-cover",
        order: 1,
        title: "开始认识太阳系",
        pageType: "cover",
        purpose: "说明课程目标并让学习者开始",
        objectiveIds: ["objective-distinguish"],
        buildDependsOnPageIds: input?.reverseDisplayDependency
          ? ["page-summary"]
          : [],
        teachingPoints: ["本课将学习恒星和行星的关键区别"],
        learnerAction: "确认学习目标并开始课程",
        referenceUsages: [],
        functionalTemplateId: "course-cover",
        styleTemplateId: "minimal",
        interactionType: "navigate",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "知道本课要解决的问题",
          requiresInteraction: true,
          pageSpecific: ["只保留一个开始入口"],
        },
      },
      {
        version: 1,
        pageId: "page-concept",
        order: 2,
        title: "恒星与行星的区别",
        pageType: "knowledge_card",
        purpose: "讲清是否自身发光这一核心区别",
        objectiveIds: ["objective-distinguish"],
        buildDependsOnPageIds: [],
        teachingPoints: [
          "恒星能自身发光发热",
          "行星不能自身发光并围绕恒星运行",
        ],
        learnerAction: "展开两张卡片并说出区别",
        assessment: "口头判断太阳和地球分别属于哪一类天体",
        referenceUsages: [
          {
            referencePackId: AGENT_V2_REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "knowledge-card-grid",
        styleTemplateId: "minimal",
        interactionType: "reveal",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能说出恒星和行星的一项关键区别",
          requiresInteraction: true,
          pageSpecific: ["展开后的解释不能重复标题"],
        },
      },
      {
        version: 1,
        pageId: "page-practice",
        order: 3,
        title: "判断天体类型",
        pageType: "quiz",
        purpose: "让学习者使用核心区别做判断",
        objectiveIds: ["objective-distinguish"],
        buildDependsOnPageIds: ["page-concept"],
        teachingPoints: ["根据是否自身发光判断天体类型"],
        learnerAction: "选择答案并阅读原因反馈",
        assessment: "判断一个天体是恒星还是行星并说明依据",
        referenceUsages: [
          {
            referencePackId: AGENT_V2_REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "interactive-quiz",
        styleTemplateId: "minimal",
        interactionType: "choice",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能用是否自身发光作为分类依据",
          requiresInteraction: true,
          pageSpecific: ["错误答案必须给出原因"],
        },
      },
      {
        version: 1,
        pageId: "page-summary",
        order: 4,
        title: "记住判断方法",
        pageType: "summary",
        purpose: "回扣学习目标并让学习者复述判断方法",
        objectiveIds: ["objective-distinguish"],
        buildDependsOnPageIds: ["page-practice"],
        teachingPoints: ["能自身发光的是恒星，不能自身发光的是行星"],
        learnerAction: "用一句话复述判断方法",
        assessment: "根据自己的复述检查是否提到了自身发光",
        referenceUsages: [
          {
            referencePackId: AGENT_V2_REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "recap-summary",
        styleTemplateId: "minimal",
        interactionType: "navigate",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能独立复述判断恒星和行星的方法",
          requiresInteraction: true,
          pageSpecific: ["不引入新的核心概念"],
        },
      },
    ],
  };
}
