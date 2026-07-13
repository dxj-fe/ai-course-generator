import { z } from "zod";

import {
  CourseIntentSchema,
  PageTypeSchema,
  VisualStyleSchema,
} from "@/shared/course-schema";
import { searchFunctionalTemplates } from "@/shared/templates/functional";
import { searchStyleTemplates } from "@/shared/templates/style";

import type { Skill } from "./types";

const FunctionalTemplateSearchInputSchema = z.object({
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

const StyleTemplateSearchInputSchema = z
  .object({
    query: z
      .string()
      .min(2)
      .max(200)
      .optional()
      .describe("视觉目标、主题氛围或审美关键词"),
    visualStyle: VisualStyleSchema.optional().describe(
      "CourseIntent 中已经解析出的视觉风格",
    ),
    audience: z
      .string()
      .min(1)
      .max(80)
      .optional()
      .describe("目标学习者，例如 8 岁儿童或企业员工"),
    limit: z.number().int().min(1).max(3).default(3),
  })
  .refine((input) => Boolean(input.query || input.visualStyle), {
    message: "query 或 visualStyle 至少提供一个",
  });

const TemplateMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  reason: z.string(),
  pageType: PageTypeSchema.optional(),
  visualStyle: VisualStyleSchema.optional(),
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

type FunctionalTemplateSearchInput = z.infer<
  typeof FunctionalTemplateSearchInputSchema
>;
type StyleTemplateSearchInput = z.infer<
  typeof StyleTemplateSearchInputSchema
>;
export type TemplateSearchOutput = z.infer<
  typeof TemplateSearchOutputSchema
>;
export type ValidateCourseIntentOutput = z.infer<
  typeof ValidateCourseIntentOutputSchema
>;

export const searchFunctionalTemplateSkill: Skill<
  FunctionalTemplateSearchInput,
  TemplateSearchOutput
> = {
  name: "searchFunctionalTemplate",
  description:
    "当用户描述页面的教学目的、内容结构或互动方式时，搜索合适的功能模板。不要用它选择颜色、字体或视觉风格。",
  inputSchema: FunctionalTemplateSearchInputSchema,
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
  StyleTemplateSearchInput,
  TemplateSearchOutput
> = {
  name: "searchStyleTemplate",
  description:
    "当用户描述视觉风格、设计氛围或受众审美时，搜索合适的样式模板。不要用它规划页面教学结构。",
  inputSchema: StyleTemplateSearchInputSchema,
  outputSchema: TemplateSearchOutputSchema,
  execute: (input) => ({
    templates: searchStyleTemplates(input).map(
      ({ template, reason, score }) => ({
        id: template.id,
        name: template.name,
        description: template.goal,
        tags: [
          template.visualStyle,
          template.layoutDensity,
          ...template.keywords.slice(0, 3),
        ],
        reason,
        visualStyle: template.visualStyle,
        score,
      }),
    ),
  }),
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
