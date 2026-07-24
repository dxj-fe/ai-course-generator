import { createAiErrorResponse, createTraceId } from "@/server/ai/error";
import { conversationStore } from "@/server/storage/conversation-store";
import {
  ConversationIdSchema,
  UpdateConversationInputSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const { conversationId } = await context.params;
    const safeId = ConversationIdSchema.parse(conversationId);
    const input = UpdateConversationInputSchema.parse(await request.json());
    const updated = await conversationStore.update(safeId, input);
    if (!updated) {
      return Response.json(
        { error: "CONVERSATION_NOT_FOUND", message: "找不到该会话。" },
        { status: 404, headers: { "x-trace-id": traceId } },
      );
    }
    return Response.json(updated, {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
