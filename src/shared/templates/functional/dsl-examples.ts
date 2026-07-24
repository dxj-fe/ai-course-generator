import {
  PageContentDSLSchema,
  type PageContentDSL,
} from "@/shared/course-schema";

const definitions = [
  {
    version: 1,
    pageId: "example-cover",
    functionalTemplateId: "course-cover",
    title: "太阳系探险启程",
    narration: ["准备好从太阳出发，认识太阳系中的重要成员。"],
    blocks: [],
    interaction: {
      type: "navigate",
      actionLabel: "开始探索",
      destination: "next",
    },
    assetSlots: [
      {
        id: "asset-slot-01",
        type: "illustration",
        role: "hero",
        purpose: "用太阳系全景建立课程主题和探索氛围。",
        required: true,
        altTextGuidance: "说明太阳位于中心并展示多颗行星的轨道关系。",
      },
    ],
    layoutHints: {
      contentDensity: "sparse",
      visualPriority: "课程主题和开始行动优先",
      groupingStrategy: "标题、简短引导和主操作形成单一焦点",
      readingOrder: [],
    },
  },
  {
    version: 1,
    pageId: "example-story-intro",
    functionalTemplateId: "story-intro",
    title: "来自火星的求救信号",
    narration: ["火星基地需要你判断下一步应先调查什么。"],
    blocks: [
      {
        id: "block-signal",
        kind: "fact",
        label: "线索 1",
        heading: "信号来自火星基地",
        body: "基地报告气温骤降，储水系统也出现异常。",
        supportingPoints: ["任务必须同时考虑环境和生存条件。"],
      },
      {
        id: "block-mission",
        kind: "instruction",
        label: "任务",
        heading: "提出调查问题",
        body: "选择最值得优先了解的火星环境信息。",
        supportingPoints: ["问题需要能帮助宇航员做出行动决定。"],
      },
    ],
    interaction: {
      type: "choice",
      questions: [
        {
          id: "question-01",
          prompt: "你认为应先调查哪一项？",
          options: [
            { id: "option-01-01", label: "可利用的水和温度条件" },
            { id: "option-01-02", label: "基地外墙的颜色" },
          ],
          correctOptionId: "option-01-01",
          feedback: {
            success: "正确，水和温度直接影响生存条件。",
            retry: "再想想哪项信息会直接影响宇航员生存。",
          },
          maxAttempts: 2,
        },
      ],
    },
    assetSlots: [
      {
        id: "asset-slot-01",
        type: "illustration",
        role: "background",
        purpose: "建立火星任务发生的故事场景。",
        required: true,
        altTextGuidance: "描述火星基地、低温环境和求救信号来源。",
      },
    ],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "求救信号与学习任务优先",
      groupingStrategy: "先呈现故事线索，再呈现任务选择",
      readingOrder: ["block-signal", "block-mission"],
    },
  },
  {
    version: 1,
    pageId: "example-knowledge-card",
    functionalTemplateId: "knowledge-card-grid",
    title: "认识八颗行星",
    narration: ["逐项查看行星卡，找出每颗行星最容易辨认的特点。"],
    blocks: [
      {
        id: "block-mercury",
        kind: "fact",
        heading: "水星",
        body: "水星是距离太阳最近的行星。",
        supportingPoints: ["公转轨道位于八颗行星最内侧。"],
      },
      {
        id: "block-earth",
        kind: "fact",
        heading: "地球",
        body: "地球表面拥有大量液态水。",
        supportingPoints: ["目前已知存在生命。"],
      },
      {
        id: "block-jupiter",
        kind: "fact",
        heading: "木星",
        body: "木星是太阳系中体积最大的行星。",
        supportingPoints: ["具有明显的大红斑。"],
      },
    ],
    interaction: {
      type: "reveal",
      prompt: "选择一颗行星，揭示它的辨认线索。",
      items: [
        { id: "item-mercury", label: "水星", content: "离太阳最近" },
        { id: "item-earth", label: "地球", content: "拥有大量液态水" },
        { id: "item-jupiter", label: "木星", content: "体积最大" },
      ],
    },
    assetSlots: [
      {
        id: "asset-slot-01",
        type: "icon",
        role: "inline",
        purpose: "帮助学习者快速区分不同的行星知识卡。",
        required: false,
        altTextGuidance: "使用行星名称和关键外观特征描述图标。",
      },
    ],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "行星名称与单一关键特征优先",
      groupingStrategy: "知识点保持同层级，可自由使用网格或逐项浏览",
      readingOrder: ["block-mercury", "block-earth", "block-jupiter"],
    },
  },
  {
    version: 1,
    pageId: "example-comparison",
    functionalTemplateId: "comparison-board",
    title: "地球和火星有什么不同",
    narration: ["使用温度、大气和水三个共同维度进行比较。"],
    blocks: [
      {
        id: "block-earth",
        kind: "concept",
        heading: "地球",
        body: "温度范围适合液态水长期存在，大气较浓厚。",
        supportingPoints: ["液态水丰富", "大气以氮气和氧气为主"],
      },
      {
        id: "block-mars",
        kind: "concept",
        heading: "火星",
        body: "整体更寒冷，大气稀薄，稳定液态水较少。",
        supportingPoints: ["存在水冰", "大气以二氧化碳为主"],
      },
    ],
    interaction: {
      type: "explore",
      prompt: "选择一个维度，查看两颗行星的差异。",
      items: [
        { id: "item-temperature", label: "温度", content: "地球整体更温和" },
        { id: "item-air", label: "大气", content: "火星大气更稀薄" },
        { id: "item-water", label: "水", content: "地球液态水更丰富" },
      ],
    },
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "共同维度下的关键差异优先",
      groupingStrategy: "两个对象保持等权，并使用相同信息顺序",
      readingOrder: ["block-earth", "block-mars"],
    },
  },
  {
    version: 1,
    pageId: "example-timeline",
    functionalTemplateId: "learning-timeline",
    title: "人类探索太空的里程碑",
    narration: ["按年份观察每次探索如何为下一阶段积累经验。"],
    blocks: [
      {
        id: "block-1957",
        kind: "fact",
        label: "1957",
        heading: "第一颗人造卫星进入太空",
        body: "人类证明可以把设备送入地球轨道。",
        supportingPoints: ["开启航天时代。"],
      },
      {
        id: "block-1961",
        kind: "fact",
        label: "1961",
        heading: "人类首次进入太空",
        body: "载人航天验证了人在太空短期活动的可能性。",
        supportingPoints: ["推动生命保障技术发展。"],
      },
      {
        id: "block-1969",
        kind: "fact",
        label: "1969",
        heading: "人类首次登上月球",
        body: "多项技术协同完成了往返月球任务。",
        supportingPoints: ["形成深空探索经验。"],
      },
    ],
    interaction: {
      type: "explore",
      prompt: "选择一个年份，查看它带来的变化。",
      items: [
        { id: "item-1957", label: "1957", content: "设备进入轨道" },
        { id: "item-1961", label: "1961", content: "人类进入太空" },
        { id: "item-1969", label: "1969", content: "人类登上月球" },
      ],
    },
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "年份、事件和影响的先后关系优先",
      groupingStrategy: "保持严格时间顺序，可纵向或横向表现",
      readingOrder: ["block-1957", "block-1961", "block-1969"],
    },
  },
  {
    version: 1,
    pageId: "example-quiz",
    functionalTemplateId: "interactive-quiz",
    title: "行星挑战赛",
    narration: ["选择答案后阅读反馈，确认自己理解了原因。"],
    blocks: [
      {
        id: "block-question",
        kind: "question",
        heading: "第一题",
        body: "太阳系中体积最大的行星是哪一颗？",
        supportingPoints: ["回想行星知识卡中的大小线索。"],
      },
    ],
    interaction: {
      type: "choice",
      questions: [
        {
          id: "question-01",
          prompt: "太阳系中体积最大的行星是哪一颗？",
          options: [
            { id: "option-01-01", label: "地球" },
            { id: "option-01-02", label: "木星" },
            { id: "option-01-03", label: "火星" },
          ],
          correctOptionId: "option-01-02",
          feedback: {
            success: "正确，木星是太阳系中体积最大的行星。",
            retry: "回看知识卡中关于行星大小的线索。",
          },
          maxAttempts: 2,
        },
        {
          id: "question-02",
          prompt: "离太阳最近的行星是哪一颗？",
          options: [
            { id: "option-02-01", label: "水星" },
            { id: "option-02-02", label: "金星" },
            { id: "option-02-03", label: "地球" },
          ],
          correctOptionId: "option-02-01",
          feedback: {
            success: "正确，水星是离太阳最近的行星。",
            retry: "回想太阳系行星由近到远的顺序。",
          },
          maxAttempts: 2,
        },
        {
          id: "question-03",
          prompt: "哪颗行星拥有最明显的行星环？",
          options: [
            { id: "option-03-01", label: "火星" },
            { id: "option-03-02", label: "土星" },
            { id: "option-03-03", label: "海王星" },
          ],
          correctOptionId: "option-03-02",
          feedback: {
            success: "正确，土星以明显的行星环闻名。",
            retry: "回想知识卡中带有宽阔光环的行星。",
          },
          maxAttempts: 2,
        },
      ],
    },
    assetSlots: [],
    layoutHints: {
      contentDensity: "sparse",
      visualPriority: "题目、选项和解释性反馈优先",
      groupingStrategy: "一次只突出一道题，反馈紧邻作答结果",
      readingOrder: ["block-question"],
    },
  },
  {
    version: 1,
    pageId: "example-achievement",
    functionalTemplateId: "achievement-task",
    title: "制作我的行星档案",
    narration: ["选择一颗行星，用三项事实完成档案。"],
    blocks: [
      {
        id: "block-name",
        kind: "instruction",
        heading: "填写名称",
        body: "写出你选择的行星名称。",
        supportingPoints: [],
      },
      {
        id: "block-position",
        kind: "instruction",
        heading: "说明位置",
        body: "说明它按照离太阳远近排在第几位。",
        supportingPoints: [],
      },
      {
        id: "block-feature",
        kind: "instruction",
        heading: "记录特点",
        body: "写出一个能帮助别人辨认它的典型特点。",
        supportingPoints: [],
      },
    ],
    interaction: {
      type: "input",
      prompt: "提交你的行星档案。",
      placeholder: "行星名称、位置和典型特点",
      evaluationCriteria: ["包含行星名称", "位置正确", "特点能够辨认该行星"],
      feedback: {
        success: "档案完整，你已经能整理和表达行星信息。",
        retry: "检查档案是否同时包含名称、位置和典型特点。",
      },
    },
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "任务步骤和可观察完成条件优先",
      groupingStrategy: "按完成顺序组织步骤，提交区位于步骤之后",
      readingOrder: ["block-name", "block-position", "block-feature"],
    },
  },
  {
    version: 1,
    pageId: "example-summary",
    functionalTemplateId: "recap-summary",
    title: "太阳系知识地图",
    narration: ["用三个关键结论回顾本次太阳系探索。"],
    blocks: [
      {
        id: "block-center",
        kind: "recap",
        heading: "太阳位于中心",
        body: "太阳是恒星，八颗行星围绕太阳运行。",
        supportingPoints: [],
      },
      {
        id: "block-planets",
        kind: "recap",
        heading: "行星各有特点",
        body: "行星在大小、环境和离太阳距离方面存在差异。",
        supportingPoints: [],
      },
      {
        id: "block-method",
        kind: "recap",
        heading: "使用线索进行辨认",
        body: "可以用位置、大小和外观线索区分行星。",
        supportingPoints: [],
      },
    ],
    interaction: {
      type: "navigate",
      actionLabel: "完成课程",
      destination: "course-home",
    },
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "三个学习结论和完成行动优先",
      groupingStrategy: "总结要点同层级呈现，不引入新知识",
      readingOrder: ["block-center", "block-planets", "block-method"],
    },
  },
] as const;

/** 八个功能模板各自拥有一份可通过共享 Schema 的 DSL example。 */
export const functionalTemplateDslExamples = PageContentDSLSchema.array()
  .length(8)
  .parse(definitions);

const examplesByTemplateId = new Map(
  functionalTemplateDslExamples.map((dsl) => [dsl.functionalTemplateId, dsl]),
);

/** 按模板 ID 返回文档、测试和前端演示可复用的 DSL example。 */
export function getFunctionalTemplateDslExample(
  templateId: string,
): PageContentDSL | undefined {
  return examplesByTemplateId.get(templateId);
}
