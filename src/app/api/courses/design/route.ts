import { z } from "zod";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/infra/ai/error";
import { runCourseDesignWorkflow } from "@/server/course";
import {
  CourseIntentSchema,
  CoursePlanSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const CourseDesignRequestSchema = z.object({
  intent: CourseIntentSchema,
  outline: CoursePlanSchema,
  traceId: z.string().trim().min(1).optional(),
});

/** 为已完成的 CoursePlan 串行生成教学、叙事和视觉设计 brief。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsed = CourseDesignRequestSchema.safeParse(await req.json());

    if (!parsed.success) {
      throw new AiRequestError(
        `请求必须包含有效的 CourseIntent 和 CoursePlan：${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const state = await runCourseDesignWorkflow(
      {
        intent: parsed.data.intent,
        outline: parsed.data.outline,
      },
      { abortSignal: req.signal, traceId },
    );

    return Response.json({ state, traceId });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}
