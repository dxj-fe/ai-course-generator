import { z } from "zod";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { runToolCallDemo } from "@/server/tools/tool-call-demo";

export const runtime = "nodejs";

const ToolCallDemoRequestSchema = z.object({
  pagePurpose: z.string().trim().min(2).max(500),
  traceId: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return createAiErrorResponse(
      new AiRequestError("请求体不是有效的 JSON。"),
      headerTraceId,
    );
  }

  const parsed = ToolCallDemoRequestSchema.safeParse(body);

  if (!parsed.success) {
    return createAiErrorResponse(
      new AiRequestError("请求体缺少有效的 pagePurpose。"),
      headerTraceId,
    );
  }

  const traceId = parsed.data.traceId || headerTraceId;

  try {
    const result = await runToolCallDemo({
      abortSignal: req.signal,
      pagePurpose: parsed.data.pagePurpose,
      traceId,
    });

    return Response.json({ ...result, traceId });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
