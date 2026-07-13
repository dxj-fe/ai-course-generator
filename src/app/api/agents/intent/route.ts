import { generateCourseIntent } from "@/server/agents/intent-agent";
import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";

export const runtime = "nodejs";

type IntentRequestBody = {
  prompt?: unknown;
  traceId?: unknown;
  userPrompt?: unknown;
};

export async function POST(req: Request) {
  const request = await readIntentRequest(req);

  if (request instanceof Response) {
    return request;
  }

  try {
    const intent = await generateCourseIntent({
      traceId: request.traceId,
      userPrompt: request.userPrompt,
    });

    return Response.json({ intent, traceId: request.traceId });
  } catch (error) {
    return createAiErrorResponse(error, request.traceId);
  }
}

async function readIntentRequest(req: Request) {
  const traceId = req.headers.get("x-trace-id")?.trim() || createTraceId();
  const body = await req.text();

  if (!body) {
    return createAiErrorResponse(
      new AiRequestError("请求体为空，请提供 userPrompt。"),
      traceId,
    );
  }

  let requestBody: IntentRequestBody;

  try {
    requestBody = JSON.parse(body);
  } catch {
    return createAiErrorResponse(
      new AiRequestError("请求体不是有效的 JSON。"),
      traceId,
    );
  }

  const requestTraceId =
    typeof requestBody.traceId === "string" && requestBody.traceId.trim()
      ? requestBody.traceId.trim()
      : traceId;
  const userPrompt = readPrompt(requestBody.userPrompt ?? requestBody.prompt);

  if (!userPrompt) {
    return createAiErrorResponse(
      new AiRequestError("请求体缺少有效的 userPrompt。"),
      requestTraceId,
    );
  }

  return {
    traceId: requestTraceId,
    userPrompt,
  };
}

function readPrompt(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
