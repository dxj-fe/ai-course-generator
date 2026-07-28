import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatSidebar } from "../../../src/features/keya/chat-sidebar";
import type { KeyaConversation } from "../../../src/types/keya";

describe("ChatSidebar", () => {
  it("distinguishes running and paused conversations in the history rail", () => {
    const markup = renderSidebar([
      conversation("conversation-running", "高一物理", "running"),
      conversation("conversation-paused", "太阳系课程", "paused"),
    ]);

    expect(markup).toContain("高一物理");
    expect(markup).toContain("太阳系课程");
    expect(markup).toContain("生成中");
    expect(markup).toContain("已暂停");
    expect(markup).toContain("animate-spin");
  });

  it("opens the pinned section when persisted pinned conversations exist", () => {
    const pinned = conversation(
      "conversation-pinned",
      "置顶课程",
      "completed",
    );
    pinned.pinned = true;

    const markup = renderSidebar([pinned]);

    expect(markup).toMatch(/aria-expanded="true"[^>]*>[\s\S]*?置顶/);
    expect(markup).toContain("置顶课程");
    expect(markup).toContain('aria-label="置顶课程 · 更多操作"');
  });
});

function renderSidebar(conversations: KeyaConversation[]) {
  return renderToStaticMarkup(
    <ChatSidebar
      collapsed={false}
      conversations={conversations}
      onDeleteConversation={vi.fn()}
      onNewConversation={vi.fn()}
      onRenameConversation={vi.fn()}
      onSelectConversation={vi.fn()}
      onToggleCollapsed={vi.fn()}
      onTogglePinned={vi.fn()}
      selectedConversationId={conversations[0]?.id ?? null}
    />,
  );
}

function conversation(
  id: string,
  title: string,
  taskStatus: KeyaConversation["taskStatus"],
): KeyaConversation {
  return {
    id,
    title,
    taskStatus,
    messages: [
      {
        id: `message-${id.slice("conversation-".length)}`,
        role: "user",
        content: title,
        createdAt: "2026-07-27T00:00:00.000Z",
      },
    ],
  };
}
