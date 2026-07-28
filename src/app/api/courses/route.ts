import { z } from "zod";

import { createAiErrorResponse, createTraceId } from "@/server/ai/error";
import { courseHistoryService } from "@/server/courses/course-history-service";

export const runtime = "nodejs";

const CourseHistoryQuerySchema = z
  .object({
    query: z.string().trim().max(160).optional(),
    status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const url = new URL(request.url);
    const query = CourseHistoryQuerySchema.parse({
      query: url.searchParams.get("query") || undefined,
      status: url.searchParams.get("status") || undefined,
    });
    return Response.json(await courseHistoryService.list(query), {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
