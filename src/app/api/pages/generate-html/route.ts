import { z } from "zod";

import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import {
  PageContentDSLSchema,
  VisualBriefSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const HtmlEngineerRequestSchema = z.object({
  content: PageContentDSLSchema,
  visualBrief: VisualBriefSchema,
  traceId: z.string().trim().min(1).optional(),
});

/** 将单页 DSL 与服务端模板实现为可安全预览的完整 HTML 文档。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsed = HtmlEngineerRequestSchema.safeParse(await req.json());

    if (!parsed.success) {
      throw new AiRequestError(
        `请求必须包含有效的 PageContentDSL 和 VisualBrief：${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const state = await runHtmlEngineerAgent(
      {
        content: parsed.data.content,
        visualBrief: parsed.data.visualBrief,
      },
      { abortSignal: req.signal, traceId },
    );

    return Response.json({ state, traceId });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}
