import { z } from "zod";

import { CourseIntentSchema } from "@/shared/course-schema";

import type { Skill } from "./types";

const TemplateSearchInputSchema = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe("页面目的、视觉目标或需要解决的教学问题"),
  audience: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe("目标学习者，例如 8 岁儿童或企业员工"),
  limit: z.number().int().min(1).max(3).default(3),
});

const TemplateMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  reason: z.string(),
});

const TemplateSearchOutputSchema = z.object({
  templates: z.array(TemplateMatchSchema).min(1).max(3),
});

const ValidateCourseIntentInputSchema = z.object({
  intent: z.record(z.string(), z.unknown()),
});

const ValidateCourseIntentOutputSchema = z.object({
  valid: z.boolean(),
  issues: z.array(
    z.object({
      field: z.string(),
      message: z.string(),
    }),
  ),
});

type TemplateSearchInput = z.infer<typeof TemplateSearchInputSchema>;
export type TemplateSearchOutput = z.infer<
  typeof TemplateSearchOutputSchema
>;
export type ValidateCourseIntentOutput = z.infer<
  typeof ValidateCourseIntentOutputSchema
>;

type TemplateDefinition = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  keywords: string[];
};

const functionalTemplates: TemplateDefinition[] = [
  {
    id: "concept-intro",
    name: "概念导入",
    description: "通过问题、现象或生活场景引出一个新概念。",
    tags: ["开场", "概念", "启发"],
    keywords: ["导入", "开场", "概念", "引出", "是什么"],
  },
  {
    id: "step-by-step",
    name: "分步讲解",
    description: "把复杂知识拆成连续步骤，并为每一步提供解释。",
    tags: ["步骤", "过程", "讲解"],
    keywords: ["步骤", "过程", "讲解", "推导", "怎么做"],
  },
  {
    id: "interactive-quiz",
    name: "互动问答",
    description: "使用选择、判断或即时反馈检查学习者理解。",
    tags: ["互动", "问答", "练习"],
    keywords: ["互动", "问答", "选择", "判断", "练习", "反馈"],
  },
  {
    id: "story-scenario",
    name: "故事情境",
    description: "用角色、任务和情节承载知识内容。",
    tags: ["故事", "情境", "任务"],
    keywords: ["故事", "情境", "角色", "任务", "冒险"],
  },
  {
    id: "recap-summary",
    name: "总结复习",
    description: "提炼关键知识并提供回顾或自测提示。",
    tags: ["总结", "复习", "回顾"],
    keywords: ["总结", "复习", "回顾", "要点", "自测"],
  },
];

const styleTemplates: TemplateDefinition[] = [
  {
    id: "kids-playful",
    name: "儿童趣味",
    description: "明亮色彩、圆润元素和轻量游戏化反馈。",
    tags: ["儿童", "活泼", "游戏化"],
    keywords: ["儿童", "孩子", "趣味", "活泼", "游戏"],
  },
  {
    id: "minimal-professional",
    name: "极简专业",
    description: "清晰层级、克制配色和适合职场阅读的高信息密度。",
    tags: ["极简", "专业", "企业"],
    keywords: ["极简", "专业", "企业", "职场", "商务"],
  },
  {
    id: "sci-fi-exploration",
    name: "科幻探索",
    description: "深色空间、发光线条和探索任务视觉语言。",
    tags: ["科幻", "太空", "探索"],
    keywords: ["科幻", "太空", "宇宙", "未来", "探索"],
  },
  {
    id: "blackboard-classroom",
    name: "黑板课堂",
    description: "黑板底色、粉笔笔触和传统课堂板书结构。",
    tags: ["黑板", "课堂", "板书"],
    keywords: ["黑板", "课堂", "板书", "数学", "公式"],
  },
  {
    id: "nature-observation",
    name: "自然观察",
    description: "自然色彩、标本式布局和观察记录元素。",
    tags: ["自然", "科学", "观察"],
    keywords: ["自然", "植物", "动物", "生态", "观察"],
  },
];

export const searchFunctionalTemplateSkill: Skill<
  TemplateSearchInput,
  TemplateSearchOutput
> = {
  name: "searchFunctionalTemplate",
  description:
    "当用户描述页面的教学目的、内容结构或互动方式时，搜索合适的功能模板。不要用它选择颜色、字体或视觉风格。",
  inputSchema: TemplateSearchInputSchema,
  outputSchema: TemplateSearchOutputSchema,
  execute: (input) => searchTemplates(functionalTemplates, input),
};

export const searchStyleTemplateSkill: Skill<
  TemplateSearchInput,
  TemplateSearchOutput
> = {
  name: "searchStyleTemplate",
  description:
    "当用户描述视觉风格、设计氛围或受众审美时，搜索合适的样式模板。不要用它规划页面教学结构。",
  inputSchema: TemplateSearchInputSchema,
  outputSchema: TemplateSearchOutputSchema,
  execute: (input) => searchTemplates(styleTemplates, input),
};

export const validateCourseIntentSkill: Skill<
  z.infer<typeof ValidateCourseIntentInputSchema>,
  ValidateCourseIntentOutput
> = {
  name: "validateCourseIntent",
  description:
    "仅用于校验一个完整的 CourseIntent 对象是否合法。不要用它搜索页面功能模板或视觉样式。",
  inputSchema: ValidateCourseIntentInputSchema,
  outputSchema: ValidateCourseIntentOutputSchema,
  execute: ({ intent }) => {
    const result = CourseIntentSchema.safeParse(intent);

    if (result.success) {
      return { valid: true, issues: [] };
    }

    return {
      valid: false,
      issues: result.error.issues.map((issue) => ({
        field: issue.path.length ? issue.path.join(".") : "root",
        message: issue.message,
      })),
    };
  },
};

function searchTemplates(
  templates: TemplateDefinition[],
  input: TemplateSearchInput,
): TemplateSearchOutput {
  const text = `${input.query} ${input.audience ?? ""}`.toLowerCase();
  const ranked = templates
    .map((template, index) => {
      const matchedKeywords = template.keywords.filter((keyword) =>
        text.includes(keyword.toLowerCase()),
      );

      return {
        template,
        index,
        matchedKeywords,
        score: matchedKeywords.length,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const candidates = ranked.some(({ score }) => score > 0)
    ? ranked.filter(({ score }) => score > 0)
    : ranked;

  return {
    templates: candidates
      .slice(0, input.limit)
      .map(({ template, matchedKeywords }) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        tags: template.tags,
        reason:
          matchedKeywords.length > 0
            ? `匹配关键词：${matchedKeywords.join("、")}`
            : "未发现明确关键词，作为通用候选返回。",
      })),
  };
}
