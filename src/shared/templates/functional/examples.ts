import { PagePlanSchema, type PagePlan } from "@/shared/course-schema";

const definitions = [
  {
    id: "mock-cover",
    order: 1,
    pageType: "cover",
    title: "太阳系探险启程",
    learningObjective: "学习者能够说出本课程将探索的核心主题。",
    contentSummary: "用课程主题、学习期待和开始入口建立学习动机。",
    interactionType: "navigate",
    assetNeeds: [
      {
        type: "illustration",
        role: "hero",
        purpose: "用太阳系全景建立课程主题和探索氛围。",
        required: true,
      },
    ],
    functionalTemplateId: "course-cover",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-story-intro",
    order: 1,
    pageType: "story_intro",
    title: "来自火星的求救信号",
    learningObjective: "学习者能够提出探索火星环境所需的关键问题。",
    contentSummary: "通过宇航员任务情境引出火星环境和生存条件。",
    interactionType: "choice",
    assetNeeds: [
      {
        type: "illustration",
        role: "background",
        purpose: "建立火星任务发生的故事场景。",
        required: true,
      },
    ],
    functionalTemplateId: "story-intro",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-knowledge-card",
    order: 1,
    pageType: "knowledge_card",
    title: "认识八颗行星",
    learningObjective: "学习者能够识别八颗行星的名称和典型特征。",
    contentSummary: "使用同层级知识卡分别介绍每颗行星的一个关键特征。",
    interactionType: "reveal",
    assetNeeds: [
      {
        type: "icon",
        role: "inline",
        purpose: "帮助学习者快速区分不同的行星知识卡。",
        required: false,
      },
    ],
    functionalTemplateId: "knowledge-card-grid",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-comparison",
    order: 1,
    pageType: "comparison",
    title: "地球和火星有什么不同",
    learningObjective: "学习者能够从温度、大气和水三个维度比较地球与火星。",
    contentSummary: "使用统一维度并列比较两颗行星并总结关键差异。",
    interactionType: "explore",
    assetNeeds: [],
    functionalTemplateId: "comparison-board",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-timeline",
    order: 1,
    pageType: "timeline",
    title: "人类探索太空的里程碑",
    learningObjective: "学习者能够按时间顺序说出三个重要太空探索事件。",
    contentSummary: "按时间节点呈现探索事件及其带来的技术进步。",
    interactionType: "explore",
    assetNeeds: [],
    functionalTemplateId: "learning-timeline",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-quiz",
    order: 1,
    pageType: "quiz",
    title: "行星挑战赛",
    learningObjective: "学习者能够通过选择题正确识别行星顺序和特征。",
    contentSummary: "使用四道带即时解释的选择题检查学习结果。",
    interactionType: "choice",
    assetNeeds: [],
    functionalTemplateId: "interactive-quiz",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-achievement",
    order: 1,
    pageType: "achievement",
    title: "制作我的行星档案",
    learningObjective: "学习者能够整理一颗行星的名称、位置和典型特征。",
    contentSummary: "通过任务步骤完成行星档案并确认学习成就。",
    interactionType: "input",
    assetNeeds: [],
    functionalTemplateId: "achievement-task",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
  {
    id: "mock-summary",
    order: 1,
    pageType: "summary",
    title: "太阳系知识地图",
    learningObjective: "学习者能够复述本课程的三个核心知识要点。",
    contentSummary: "回扣学习目标、整理关键知识并提示下一步探索方向。",
    interactionType: "navigate",
    assetNeeds: [],
    functionalTemplateId: "recap-summary",
    styleTemplateId: "minimal",
    assetIds: [],
    dependsOnPageIds: [],
    status: "planned",
  },
] as const;

/** 每个功能模板对应一个通过完整 PagePlanSchema 的可运行示例。 */
export const functionalTemplateExamples = PagePlanSchema.array()
  .length(8)
  .parse(definitions);

const examplesByTemplateId = new Map(
  functionalTemplateExamples.map((pagePlan) => [
    pagePlan.functionalTemplateId,
    pagePlan,
  ]),
);

/** 按模板 ID 返回 Gallery 和测试使用的 PagePlan mock。 */
export function getFunctionalTemplateExample(
  templateId: string,
): PagePlan | undefined {
  return examplesByTemplateId.get(templateId);
}
