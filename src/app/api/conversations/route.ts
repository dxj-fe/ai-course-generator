import { createAiErrorResponse, createTraceId } from "@/server/infra/ai/error";
import { getWebServices } from "@/server/setup/web";
import { SaveConversationInputSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

const { conversations } = getWebServices();

export async function GET(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    return Response.json(await conversations.list(), {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const input = SaveConversationInputSchema.parse(await request.json());
    return Response.json(await conversations.save(input), {
      status: 201,
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
