import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import {
  CourseIntentSchema,
  formatZodIssues,
  type CourseIntent,
} from "@/shared/course-schema";

const INTENT_SYSTEM_PROMPT = [
  "你是 AI Course Generator 的 Intent Agent，只负责把用户的一句话需求解析成课程生成任务规格。",
  "你必须返回满足 schema 的 JSON object。",
  "你不生成课程正文，不写 HTML，不规划每一页内容。",
  "你必须根据用户需求推断受众年龄、课程页数、视觉风格、难度、必须包含项、避免项和语言。",
  "courseLength 表示目标页面数量，只能是 3 到 12 的整数；不明确时默认 5。",
  "visualStyle 只能从 sci-fi、kids-playful、minimal、nature、blackboard、game-quest、professional 中选择最贴近的一项。",
  "difficulty 只能是 beginner、intermediate、advanced。",
  "language 只能是 zh-CN、en-US、bilingual；中文输入默认 zh-CN。",
  "mustInclude 和 avoid 没有明确内容时返回空数组。",
  "返回 CourseIntent JSON object 本身，禁止外层 wrapper，例如 intent、courseIntent、data 或 result。",
  '示例 JSON：{"topic":"太阳系入门","audienceAgeRange":{"min":8,"max":10,"label":"8-10 岁儿童"},"courseLength":5,"visualStyle":"kids-playful","difficulty":"beginner","mustInclude":["互动问答"],"avoid":[],"language":"zh-CN"}',
].join("\n");

export type GenerateCourseIntentInput = {
  abortSignal?: AbortSignal;
  traceId: string;
  userPrompt: string;
};

export async function generateCourseIntent({
  abortSignal,
  traceId,
  userPrompt,
}: GenerateCourseIntentInput): Promise<CourseIntent> {
  const output = await generateStructuredObjectSafe({
    abortSignal,
    maxTokens: 900,
    prompt: buildIntentPrompt(userPrompt),
    schema: CourseIntentSchema,
    schemaDescription:
      "A structured course generation intent for a multi-page HTML course.",
    schemaName: "course_intent",
    systemPrompt: INTENT_SYSTEM_PROMPT,
    temperature: 0.2,
    traceId,
  });
  const parsed = CourseIntentSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `CourseIntent 结构校验失败：${formatZodIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

function buildIntentPrompt(userPrompt: string) {
  return [
    "请解析下面的用户课程需求，并只返回符合 CourseIntent schema 的结构化结果。",
    "输出必须是 JSON object，不要添加 Markdown 代码块或解释文字。",
    "JSON 根对象必须直接包含 topic、audienceAgeRange、courseLength、visualStyle、difficulty、mustInclude、avoid、language。",
    "不要返回 { intent: ... }、{ courseIntent: ... }、{ data: ... } 这类外层包装。",
    "",
    "用户原始需求：",
    userPrompt,
  ].join("\n");
}
