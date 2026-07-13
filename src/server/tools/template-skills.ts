import { z } from "zod";

import { CourseIntentSchema, PageTypeSchema } from "@/shared/course-schema";
import { searchFunctionalTemplates } from "@/shared/templates/functional";

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
  pageType: PageTypeSchema.optional(),
  score: z.number().min(0).optional(),
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

type StyleTemplateDefinition = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  keywords: string[];
};

const styleTemplates: StyleTemplateDefinition[] = [
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
  execute: (input) => ({
    templates: searchFunctionalTemplates(input).map(
      ({ template, reason, score }) => ({
        id: template.id,
        name: template.name,
        description: template.goal,
        tags: [template.pageType, ...template.keywords.slice(0, 3)],
        reason,
        pageType: template.pageType,
        score,
      }),
    ),
  }),
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

/** 为 Day 09 之前的样式模板提供确定性关键词搜索。 */
function searchTemplates(
  templates: StyleTemplateDefinition[],
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
        score: matchedKeywords.length,
        reason:
          matchedKeywords.length > 0
            ? `匹配关键词：${matchedKeywords.join("、")}`
            : "未发现明确关键词，作为通用候选返回。",
      })),
  };
}
