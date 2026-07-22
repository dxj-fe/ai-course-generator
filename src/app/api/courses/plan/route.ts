import { z } from "zod";

import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import {
  CourseIntentSchema,
  REFERENCE_MAX_PACKS,
  ReferencePackSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const CoursePlanRequestSchema = z
  .object({
    userPrompt: z.string().trim().min(2).max(500).optional(),
    intent: CourseIntentSchema.optional(),
    referencePacks: z.array(ReferencePackSchema).max(REFERENCE_MAX_PACKS).optional(),
    traceId: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.userPrompt || value.intent), {
    message: "userPrompt 或 intent 至少提供一个",
  });

/** 将一句话意图解析与 CoursePlannerAgent 串成一个前端可调用入口。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const body = await req.json();
    const parsed = CoursePlanRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new AiRequestError(
        "请求必须包含有效的 userPrompt 或 CourseIntent。",
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const intent =
      parsed.data.intent ??
      (await generateCourseIntent({
        abortSignal: req.signal,
        traceId,
        userPrompt: parsed.data.userPrompt!,
      }));
    const state = await runCoursePlannerAgent(
      intent,
      { abortSignal: req.signal, traceId },
      parsed.data.referencePacks ?? [],
    );

    return Response.json({ intent, state, traceId });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}
