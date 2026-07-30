import type { Metadata } from "next";

import { ChatApp } from "@/features/keya/chat-app";
import { getWebServices } from "@/server/setup/web";

export const metadata: Metadata = {
  title: "学习对话",
  description: "通过对话开始一段新的学习。",
};

const { conversationHistory } = getWebServices();

interface ChatPageProps {
  searchParams: Promise<{
    conversation?: string | string[];
    course?: string | string[];
    prompt?: string | string[];
  }>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const requestedCourseId = first(params.course);
  const result = await conversationHistory.list();
  let conversations = result.items;
  let selectedConversationId = first(params.conversation);

  if (requestedCourseId) {
    const courseConversation =
      await conversationHistory.viewForCourse(requestedCourseId);
    if (courseConversation) {
      conversations = [
        courseConversation,
        ...conversations.filter(({ id }) => id !== courseConversation.id),
      ];
      selectedConversationId = courseConversation.id;
    }
  }

  return (
    <ChatApp
      initialConversations={conversations}
      initialConversationId={selectedConversationId}
      initialPrompt={first(params.prompt)}
    />
  );
}
