import { createAiErrorResponse, createTraceId } from "@/server/ai/error";
import { conversationStore } from "@/server/storage/conversation-store";
import { SaveConversationInputSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    return Response.json(await conversationStore.list(), {
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
    return Response.json(await conversationStore.save(input), {
      status: 201,
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
