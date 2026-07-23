import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import {
  CourseIntentSchema,
  formatZodIssues,
  type CourseIntent,
} from "@/shared/course-schema";
import { buildIntentPrompts } from "@/server/prompts/intent";

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
  const prompts = await buildIntentPrompts(userPrompt);
  const output = await generateStructuredObjectSafe({
    abortSignal,
    cache: {
      input: { userPrompt },
      namespace: "course-intent",
      schemaVersion: "course-intent@1",
    },
    capability: "intent",
    maxTokens: 900,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: CourseIntentSchema,
    schemaDescription:
      "A structured course generation intent for a multi-page HTML course.",
    schemaName: "course_intent",
    systemPrompt: prompts.systemPrompt,
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
