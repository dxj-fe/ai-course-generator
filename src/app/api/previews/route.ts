import { z } from "zod";

import { createAiErrorResponse, createTraceId } from "@/server/ai/error";
import { htmlPreviewStore } from "@/server/storage/html-preview-store";
import { QualityReportSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

const PreviewInputSchema = z
  .object({
    pageId: z.string().min(1).max(120),
    title: z.string().min(1).max(240),
    html: z.string().min(1).max(2_000_000),
    qualityReport: QualityReportSchema.optional(),
  })
  .strict();

export async function POST(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const input = PreviewInputSchema.parse(await request.json());
    return Response.json(await htmlPreviewStore.save(input), {
      status: 201,
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
