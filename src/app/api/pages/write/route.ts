import { z } from "zod";

import { runPageWriterModelStep } from "@/server/setup/capabilities";
import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/infra/ai/error";
import {
  CourseIntentSchema,
  PagePlanSchema,
  PageWorkerBriefSchema,
  REFERENCE_MAX_PACKS,
  ReferencePackSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const PageWriterRequestSchema = z.object({
  intent: CourseIntentSchema,
  page: PagePlanSchema,
  brief: PageWorkerBriefSchema,
  referencePacks: z.array(ReferencePackSchema).max(REFERENCE_MAX_PACKS).optional(),
  traceId: z.string().trim().min(1).optional(),
});

/** 将单个 PagePlan 与专业 brief 转换为结构化 PageContentDSL。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsed = PageWriterRequestSchema.safeParse(await req.json());

    if (!parsed.success) {
      throw new AiRequestError(
        `请求必须包含有效的 CourseIntent、PagePlan 和 PageWorkerBrief：${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const state = await runPageWriterModelStep(
      {
        intent: parsed.data.intent,
        page: parsed.data.page,
        brief: parsed.data.brief,
        referencePacks: parsed.data.referencePacks ?? [],
      },
      { abortSignal: req.signal, traceId },
    );

    return Response.json({ state, traceId });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}
