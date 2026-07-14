import type { Metadata } from "next";

import { ChatApp } from "@/features/seaca/chat-app";

export const metadata: Metadata = {
  title: "学习对话",
  description: "通过对话开始一段新的学习。",
};

interface ChatPageProps {
  searchParams: Promise<{
    conversation?: string | string[];
    prompt?: string | string[];
  }>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;

  return (
    <ChatApp
      initialConversationId={first(params.conversation)}
      initialPrompt={first(params.prompt)}
    />
  );
}
