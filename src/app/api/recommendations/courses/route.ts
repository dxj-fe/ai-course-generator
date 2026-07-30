import { z } from "zod";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { listRecommendedCourses } from "@/server/recommendations/recommended-course-registry";

export const runtime = "nodejs";

const RecommendedCourseQuerySchema = z
  .object({
    cursor: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export async function GET(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const url = new URL(request.url);
    const query = RecommendedCourseQuerySchema.safeParse({
      cursor: url.searchParams.get("cursor") || undefined,
    });
    if (!query.success) {
      throw new AiRequestError("cursor 必须是 0 到 10000 之间的整数。");
    }
    return Response.json(listRecommendedCourses(query.data.cursor), {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
        "x-trace-id": traceId,
      },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
