import { getErrorText } from "@/features/ai-playground/lib/messages";
import {
  ConversationRecordSchema,
  type ConversationRecord,
  type SaveConversationInput,
  type UpdateConversationInput,
} from "@/shared/course-schema";

export async function saveConversation(
  input: SaveConversationInput,
  signal?: AbortSignal,
): Promise<ConversationRecord> {
  return requestConversation("/api/conversations", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export async function updateStoredConversation(
  conversationId: string,
  input: UpdateConversationInput,
  signal?: AbortSignal,
): Promise<ConversationRecord> {
  return requestConversation(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
      signal,
    },
  );
}

async function requestConversation(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(getErrorText(payload));
  return ConversationRecordSchema.parse(payload);
}
