import { z } from "zod";

import {
  RecommendedCourseDomainSchema,
  RecommendedCourseIdSchema,
  RecommendedCourseListResponseSchema,
  RecommendedCourseSummarySchema,
  type RecommendedCourseDomain,
  type RecommendedCourseListResponse,
  type RecommendedCourseSummary,
} from "@/shared/course-schema";

const PreviewLayoutSchema = z.enum(["left", "right", "bottom"]);
const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

const RecommendedCourseDefinitionSchema = z
  .object({
    id: RecommendedCourseIdSchema,
    domain: RecommendedCourseDomainSchema,
    domainLabel: z.string().min(1).max(24),
    title: z.string().min(2).max(80),
    description: z.string().min(8).max(160),
    learningOutcome: z.string().min(8).max(180),
    audience: z.string().min(2).max(60),
    pageCount: z.number().int().min(3).max(12),
    durationMinutes: z.number().int().min(8).max(90),
    styleLabel: z.string().min(2).max(40),
    outline: z.array(z.string().min(2).max(80)).min(3).max(12),
    coverImage: z
      .string()
      .regex(/^\/keya\/recommendations\/[a-z0-9-]+\.jpg$/),
    preview: z
      .object({
        layout: PreviewLayoutSchema,
        primary: HexColorSchema,
        surface: HexColorSchema,
        accent: HexColorSchema,
        kicker: z.string().min(2).max(40),
      })
      .strict(),
  })
  .strict()
  .superRefine((course, context) => {
    if (course.outline.length !== course.pageCount) {
      context.addIssue({
        code: "custom",
        message: "推荐课程的页面数必须与内容大纲一致。",
        path: ["outline"],
      });
    }
  });

export type RecommendedCourseDefinition = z.infer<
  typeof RecommendedCourseDefinitionSchema
>;

const courseDefinitions = [
  {
    id: "recommended-math-functions",
    domain: "mathematics",
    domainLabel: "数学",
    title: "看懂函数的变化",
    description: "从山路、温度与图像出发，直观理解函数如何描述变化。",
    learningOutcome: "能够从函数图像中判断增减趋势、变化速度与关键转折。",
    audience: "高中入门",
    pageCount: 6,
    durationMinutes: 12,
    styleLabel: "自然地景 · 动态图像",
    outline: [
      "变化为什么需要函数",
      "把山路高度画成图像",
      "读懂上升、下降与平台",
      "比较不同区间的变化速度",
      "用图像解释生活数据",
      "完成一次函数侦探挑战",
    ],
    coverImage: "/keya/recommendations/math-functions.jpg",
    preview: {
      layout: "left",
      primary: "#173f32",
      surface: "#e9f4e6",
      accent: "#f2b84b",
      kicker: "从一条山路读懂变化",
    },
  },
  {
    id: "recommended-chinese-analects",
    domain: "chinese",
    domainLabel: "语文",
    title: "30 分钟读懂《论语》",
    description: "精选关键章句，联系真实处境理解孔子的学习与相处之道。",
    learningOutcome: "能够用自己的话解释三则核心章句，并迁移到当下生活。",
    audience: "初中及以上",
    pageCount: 5,
    durationMinutes: 30,
    styleLabel: "东方书卷 · 温润留白",
    outline: [
      "《论语》是一场怎样的对话",
      "学而时习之：学习如何发生",
      "三人行：怎样向他人学习",
      "己所不欲：关系中的分寸",
      "用一则章句回应真实问题",
    ],
    coverImage: "/keya/recommendations/chinese-analects.jpg",
    preview: {
      layout: "right",
      primary: "#65462f",
      surface: "#f8eddd",
      accent: "#d39a42",
      kicker: "让经典回到真实生活",
    },
  },
  {
    id: "recommended-english-conversation",
    domain: "english",
    domainLabel: "英语",
    title: "把英语说得更自然",
    description: "从真实对话节奏出发，练习接话、确认和表达不同意见。",
    learningOutcome: "能够在日常对话中自然回应，并完成一段有来有回的交流。",
    audience: "初中及以上",
    pageCount: 6,
    durationMinutes: 20,
    styleLabel: "生活实景 · 对话聚焦",
    outline: [
      "自然对话为什么不是逐句翻译",
      "用追问让交流继续",
      "听不清时怎样确认",
      "自然表达赞同与保留",
      "修正三段生硬表达",
      "完成一场情境对话",
    ],
    coverImage: "/keya/recommendations/english-conversation.jpg",
    preview: {
      layout: "bottom",
      primary: "#20584d",
      surface: "#e8f4ec",
      accent: "#efb756",
      kicker: "从会说到会交流",
    },
  },
  {
    id: "recommended-science-sky-color",
    domain: "science",
    domainLabel: "科学",
    title: "天空为什么会变色",
    description: "跟着一束阳光穿过大气，理解蓝天与晚霞背后的散射现象。",
    learningOutcome: "能够用光的散射解释蓝天、晚霞和不同天气下的颜色变化。",
    audience: "小学高年级及以上",
    pageCount: 6,
    durationMinutes: 18,
    styleLabel: "沉浸天空 · 光线实验",
    outline: [
      "同一片天空为什么颜色不同",
      "白光里藏着哪些颜色",
      "光遇到空气会发生什么",
      "为什么白天更容易看见蓝光",
      "晚霞为什么偏红",
      "设计一次安全的散射实验",
    ],
    coverImage: "/keya/recommendations/science-sky-color.jpg",
    preview: {
      layout: "left",
      primary: "#163d63",
      surface: "#e7f3fb",
      accent: "#ffc765",
      kicker: "跟一束光穿过大气",
    },
  },
  {
    id: "recommended-history-silk-road",
    domain: "history",
    domainLabel: "历史",
    title: "一张地图看懂丝绸之路",
    description: "沿着商队的路线，看商品、技术与观念如何跨越大陆流动。",
    learningOutcome: "能够结合路线与关键节点，解释丝绸之路带来的双向交流。",
    audience: "初中及以上",
    pageCount: 7,
    durationMinutes: 24,
    styleLabel: "地图叙事 · 历史旅程",
    outline: [
      "丝绸之路不只是一条路",
      "从长安出发",
      "穿过河西走廊",
      "绿洲城市为何重要",
      "商品与技术如何旅行",
      "交流也伴随着风险",
      "在地图上复原一段旅程",
    ],
    coverImage: "/keya/recommendations/history-silk-road.jpg",
    preview: {
      layout: "right",
      primary: "#65432c",
      surface: "#f6ead4",
      accent: "#d77b45",
      kicker: "沿地图看见文明相遇",
    },
  },
  {
    id: "recommended-geography-monsoon",
    domain: "geography",
    domainLabel: "地理",
    title: "季风如何影响我们的生活",
    description: "从风向、海陆温差到雨季，建立气候与生产生活的联系。",
    learningOutcome: "能够读懂季风示意图，并解释它对降水、农业和城市的影响。",
    audience: "初中及以上",
    pageCount: 6,
    durationMinutes: 18,
    styleLabel: "气象地图 · 因果推演",
    outline: [
      "雨季为什么总在相似时间到来",
      "海洋与陆地升温有何不同",
      "风为什么会改变方向",
      "读懂夏季风与冬季风",
      "季风怎样影响生产生活",
      "为一座城市制作季风提示",
    ],
    coverImage: "/keya/recommendations/geography-monsoon.jpg",
    preview: {
      layout: "bottom",
      primary: "#18596a",
      surface: "#e5f3f1",
      accent: "#efb345",
      kicker: "把风、雨与生活连起来",
    },
  },
  {
    id: "recommended-technology-guessing-game",
    domain: "technology",
    domainLabel: "编程",
    title: "用 JavaScript 做一个猜数游戏",
    description: "在可运行的小项目里掌握变量、条件判断与循环反馈。",
    learningOutcome: "能够独立写出一个可玩的猜数游戏，并解释程序的判断流程。",
    audience: "编程零基础",
    pageCount: 7,
    durationMinutes: 35,
    styleLabel: "代码实验室 · 即时反馈",
    outline: [
      "先把游戏规则说清楚",
      "让程序记住一个数字",
      "读取玩家的猜测",
      "用条件判断给出反馈",
      "让游戏可以继续",
      "处理无效输入",
      "加入次数与胜利提示",
    ],
    coverImage: "/keya/recommendations/technology-guessing-game.jpg",
    preview: {
      layout: "left",
      primary: "#233c61",
      surface: "#e9edf8",
      accent: "#55c7a7",
      kicker: "写下第一段会回应的程序",
    },
  },
  {
    id: "recommended-art-color-harmony",
    domain: "art",
    domainLabel: "艺术",
    title: "三步看懂色彩搭配",
    description: "从色相关系、面积比例与情绪出发，做出更有目的的配色。",
    learningOutcome: "能够分析一组配色的关系，并为指定情绪创建协调色板。",
    audience: "零基础",
    pageCount: 5,
    durationMinutes: 16,
    styleLabel: "色彩画室 · 视觉对比",
    outline: [
      "颜色为什么会彼此影响",
      "先看懂色相关系",
      "用面积决定主次",
      "用明度控制阅读顺序",
      "为一种情绪完成配色",
    ],
    coverImage: "/keya/recommendations/art-color-harmony.jpg",
    preview: {
      layout: "right",
      primary: "#65476e",
      surface: "#f5ebf2",
      accent: "#edb85b",
      kicker: "让每一种颜色都有理由",
    },
  },
  {
    id: "recommended-finance-monthly-budget",
    domain: "finance",
    domainLabel: "财商",
    title: "第一次做好月度预算",
    description: "用真实收支场景区分需要与想要，建立可执行的预算方案。",
    learningOutcome: "能够完成一份收支平衡、留有弹性并包含储蓄目标的预算。",
    audience: "高中及以上",
    pageCount: 6,
    durationMinutes: 22,
    styleLabel: "生活账本 · 情境决策",
    outline: [
      "预算不是限制而是选择",
      "先看清钱从哪里来",
      "区分固定与可变支出",
      "需要和想要如何取舍",
      "给意外留出缓冲",
      "完成并检查月度预算",
    ],
    coverImage: "/keya/recommendations/finance-monthly-budget.jpg",
    preview: {
      layout: "bottom",
      primary: "#225b45",
      surface: "#e8f3e8",
      accent: "#e2ad45",
      kicker: "让每一笔钱服务于目标",
    },
  },
  {
    id: "recommended-health-sleep-memory",
    domain: "health",
    domainLabel: "健康",
    title: "睡眠如何帮大脑整理记忆",
    description: "从睡眠周期与记忆巩固出发，设计更有效的学习和休息节奏。",
    learningOutcome: "能够解释睡眠与记忆的关系，并制定一份可坚持的睡眠计划。",
    audience: "初中及以上",
    pageCount: 6,
    durationMinutes: 18,
    styleLabel: "夜间科学 · 节律可视化",
    outline: [
      "睡着以后大脑还在做什么",
      "认识一个睡眠周期",
      "记忆怎样被重新整理",
      "熬夜为什么影响学习",
      "小睡应该怎样安排",
      "设计一周睡眠实验",
    ],
    coverImage: "/keya/recommendations/health-sleep-memory.jpg",
    preview: {
      layout: "left",
      primary: "#405e89",
      surface: "#eaf0f8",
      accent: "#efa773",
      kicker: "在夜晚完成记忆整理",
    },
  },
  {
    id: "recommended-critical-thinking-source-check",
    domain: "critical-thinking",
    domainLabel: "思辨",
    title: "一条消息，如何判断真假",
    description: "通过来源、证据与交叉验证，建立面对网络信息的判断流程。",
    learningOutcome: "能够使用一套可重复的核查步骤，判断信息可信度并说明依据。",
    audience: "初中及以上",
    pageCount: 6,
    durationMinutes: 20,
    styleLabel: "线索调查 · 证据卡片",
    outline: [
      "为什么看起来真实还不够",
      "先找到最初来源",
      "区分主张与证据",
      "检查时间与上下文",
      "寻找独立的交叉验证",
      "完成一次信息核查",
    ],
    coverImage: "/keya/recommendations/critical-thinking-source-check.jpg",
    preview: {
      layout: "right",
      primary: "#583f61",
      surface: "#f3ebf4",
      accent: "#eb9964",
      kicker: "让判断跟着证据走",
    },
  },
  {
    id: "recommended-learning-spaced-review",
    domain: "learning",
    domainLabel: "学习方法",
    title: "用间隔复习把知识记牢",
    description: "理解遗忘规律，用主动回忆与间隔安排提升长期记忆。",
    learningOutcome: "能够为一个真实学习目标制定一周间隔复习计划。",
    audience: "全年龄学习者",
    pageCount: 5,
    durationMinutes: 15,
    styleLabel: "记忆花园 · 时间路径",
    outline: [
      "为什么刚学会也会忘",
      "主动回忆比重复阅读更有效",
      "间隔应该怎样安排",
      "根据掌握程度调整节奏",
      "制作一周复习计划",
    ],
    coverImage: "/keya/recommendations/learning-spaced-review.jpg",
    preview: {
      layout: "bottom",
      primary: "#356348",
      surface: "#ecf5e9",
      accent: "#e6b54a",
      kicker: "让复习发生在快要忘记时",
    },
  },
] satisfies RecommendedCourseDefinition[];

export const recommendedCourseRegistry = courseDefinitions.map((course) =>
  RecommendedCourseDefinitionSchema.parse(course),
);

assertDomainCoverage(recommendedCourseRegistry);

export function listRecommendedCourses(
  cursor = 0,
): RecommendedCourseListResponse {
  const normalizedCursor = cursor % recommendedCourseRegistry.length;
  const items = Array.from({ length: 3 }, (_, index) => {
    const course =
      recommendedCourseRegistry[
        (normalizedCursor + index) % recommendedCourseRegistry.length
      ];
    return toSummary(course);
  });

  return RecommendedCourseListResponseSchema.parse({
    items,
    nextCursor: (normalizedCursor + items.length) % recommendedCourseRegistry.length,
    total: recommendedCourseRegistry.length,
    supportedDomains: RecommendedCourseDomainSchema.options,
  });
}

export function getRecommendedCourse(
  courseId: string,
): RecommendedCourseDefinition | undefined {
  const parsedId = RecommendedCourseIdSchema.safeParse(courseId);
  if (!parsedId.success) return undefined;
  return recommendedCourseRegistry.find(({ id }) => id === parsedId.data);
}

function toSummary(
  course: RecommendedCourseDefinition,
): RecommendedCourseSummary {
  return RecommendedCourseSummarySchema.parse({
    id: course.id,
    domain: course.domain,
    domainLabel: course.domainLabel,
    title: course.title,
    description: course.description,
    learningOutcome: course.learningOutcome,
    audience: course.audience,
    pageCount: course.pageCount,
    durationMinutes: course.durationMinutes,
    prompt: buildCoursePrompt(course),
    previewUrl: `/api/recommendations/courses/${course.id}/preview`,
    styleLabel: course.styleLabel,
  });
}

function buildCoursePrompt(course: RecommendedCourseDefinition) {
  return [
    `请为${course.audience}生成一门主题为“${course.title}”的 ${course.pageCount} 页互动课程。`,
    `学习结果：${course.learningOutcome}`,
    `课程结构：${course.outline.map((item, index) => `${index + 1}. ${item}`).join("；")}`,
    `视觉方向：${course.styleLabel}。`,
    "要求每页只承担一个清晰的认知推进，包含具体示例、主动练习和解释性反馈，最后用可观察的任务检验学习结果。",
  ].join("\n");
}

function assertDomainCoverage(courses: RecommendedCourseDefinition[]) {
  const coveredDomains = new Set<RecommendedCourseDomain>(
    courses.map(({ domain }) => domain),
  );
  const missingDomains = RecommendedCourseDomainSchema.options.filter(
    (domain) => !coveredDomains.has(domain),
  );
  if (missingDomains.length > 0) {
    throw new Error(`推荐课程领域缺失：${missingDomains.join(", ")}`);
  }
}
