import { z } from "zod";

import { createAiErrorResponse, createTraceId } from "@/server/infra/ai/error";
import { getWebServices } from "@/server/setup/web";
import { QualityReportSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

const { previews } = getWebServices();

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
    return Response.json(await previews.save(input), {
      status: 201,
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
