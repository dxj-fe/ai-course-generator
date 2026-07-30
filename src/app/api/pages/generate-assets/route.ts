import { z } from "zod";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/infra/ai/error";
import { runImageAssetWorkflow } from "@/server/setup/capabilities";
import {
  PageContentDSLSchema,
  VisualBriefSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const ImageAssetRequestSchema = z.object({
  content: PageContentDSLSchema,
  visualBrief: VisualBriefSchema,
  traceId: z.string().trim().min(1).optional(),
});

/** 为单页素材槽生成真实图片或可继续 HTML 流程的 fallback。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsed = ImageAssetRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AiRequestError(
        `请求必须包含有效的 PageContentDSL 与 VisualBrief：${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const state = await runImageAssetWorkflow(
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
