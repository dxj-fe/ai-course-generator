import { z } from "zod";

import { runPageQAAgent } from "@/server/agents/page-qa-agent";
import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import {
  PageContentDSLSchema,
  PagePlanSchema,
  VisualBriefSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const PageQARequestSchema = z.object({
  page: PagePlanSchema,
  content: PageContentDSLSchema,
  html: z.string().min(1).max(200_000),
  visualBrief: VisualBriefSchema,
  courseContext: z
    .object({
      learningObjectives: z.array(z.string().min(2).max(300)).max(20),
      previousPage: PagePlanSchema.optional(),
      nextPage: PagePlanSchema.optional(),
    })
    .strict()
    .optional(),
  traceId: z.string().trim().min(1).optional(),
});

/** 对一页已生成 HTML 执行只读质量评估，不在该接口中修复页面。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsed = PageQARequestSchema.safeParse(await req.json());

    if (!parsed.success) {
      throw new AiRequestError(
        `请求必须包含有效的 PagePlan、PageContentDSL、HTML 与 VisualBrief：${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const state = await runPageQAAgent(
      {
        page: parsed.data.page,
        content: parsed.data.content,
        html: parsed.data.html,
        visualBrief: parsed.data.visualBrief,
        courseContext: parsed.data.courseContext,
      },
      { abortSignal: req.signal, traceId },
    );

    return Response.json({ state, traceId });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}
