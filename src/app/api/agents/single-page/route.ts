import { z } from "zod";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { runSinglePageAgent } from "@/server/agents/single-page-agent";

export const runtime = "nodejs";

const SinglePageAgentRequestSchema = z.object({
  pageGoal: z.string().trim().min(2).max(500),
  audience: z.string().trim().min(1).max(100).optional(),
  maxSteps: z.number().int().min(1).max(6).optional(),
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

  const parsed = SinglePageAgentRequestSchema.safeParse(body);

  if (!parsed.success) {
    return createAiErrorResponse(
      new AiRequestError("请求体缺少有效的 pageGoal。"),
      headerTraceId,
    );
  }

  const traceId = parsed.data.traceId || headerTraceId;
  const state = await runSinglePageAgent(parsed.data, {
    abortSignal: req.signal,
    traceId,
  });

  return Response.json({ state, traceId });
}
