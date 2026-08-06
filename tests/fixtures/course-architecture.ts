import type {
  CourseArchitecture,
  CourseCreationBrief,
  ReferencePack,
} from "../../src/shared/course-schema";

export const COURSE_ID = "course-architect-test";
export const REFERENCE_PACK_ID =
  "ref-aaaaaaaaaaaaaaaaaaaaaaaa";

export function createBrief(): CourseCreationBrief {
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

export function createReferencePack(): ReferencePack {
  return {
    id: REFERENCE_PACK_ID,
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

export function createArchitecture(input?: {
  reverseDisplayDependency?: boolean;
}): CourseArchitecture {
  return {
    courseId: COURSE_ID,
    coursePack: {
      courseId: COURSE_ID,
      topic: "太阳系",
      facts: [
        {
          id: "fact-sun",
          text: "太阳能自身发光发热，是太阳系的恒星。",
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
          sourceUsages: [
            {
              referencePackId: REFERENCE_PACK_ID,
              chunkIds: ["chunk-01"],
            },
          ],
        },
      ],
      examples: [],
      constraints: ["不能把行星说成自身发光的天体"],
    },
    blueprint: {
      courseId: COURSE_ID,
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
        visualDesign: {
          theme: "从恒星光芒进入分类任务",
          layout: "超大课程问题居左，右侧用发光天体和开始动作形成入口",
          graphicMotif: "用同心光环与一条轨道表达课程探索范围",
        },
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "知道本课要解决的问题",
          requiresInteraction: true,
          pageSpecific: ["只保留一个开始入口"],
        },
      },
      {
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
            referencePackId: REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "knowledge-card-grid",
        styleTemplateId: "minimal",
        interactionType: "reveal",
        assetNeeds: [],
        visualDesign: {
          theme: "恒星发光与行星反光的双档案",
          layout: "左右分屏对照两类天体，中线承载判断标准，展开动作贴近对应一侧",
          graphicMotif: "用实体光线与反射虚线形成两套方向相反的光路",
        },
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能说出恒星和行星的一项关键区别",
          requiresInteraction: true,
          pageSpecific: ["展开后的解释不能重复标题"],
        },
      },
      {
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
            referencePackId: REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "interactive-quiz",
        styleTemplateId: "minimal",
        interactionType: "choice",
        assetNeeds: [],
        visualDesign: {
          theme: "在观测台上完成一次天体身份判定",
          layout: "题干与观测线索占左侧主舞台，选项和提交动作组成右侧判定区",
          graphicMotif: "用扫描准星和二分轨道把线索导向恒星或行星",
        },
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能用是否自身发光作为分类依据",
          requiresInteraction: true,
          pageSpecific: ["错误答案必须给出原因"],
        },
      },
      {
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
            referencePackId: REFERENCE_PACK_ID,
            chunkIds: ["chunk-01"],
          },
        ],
        functionalTemplateId: "recap-summary",
        styleTemplateId: "minimal",
        interactionType: "navigate",
        assetNeeds: [],
        visualDesign: {
          theme: "把判断方法压缩成可携带的观测准则",
          layout: "中央展示一句核心准则，前后两端分别锚定恒星与行星结果",
          graphicMotif: "用一条发光刻度轴连接自发光与不自发光两个端点",
        },
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
