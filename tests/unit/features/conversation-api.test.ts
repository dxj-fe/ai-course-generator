import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteStoredConversation,
  saveConversation,
  updateStoredConversation,
} from "../../../src/features/keya/api/conversation";

const record = {
  id: "conversation-client-test",
  title: "太阳系课程",
  pinned: false,
  createdAt: "2026-07-24T01:00:00.000Z",
  updatedAt: "2026-07-24T01:00:00.000Z",
  messages: [
    {
      id: "message-client-test",
      role: "user" as const,
      content: "生成太阳系课程",
      createdAt: "2026-07-24T01:00:00.000Z",
    },
  ],
};

describe("conversation API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates and validates a stored conversation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(record), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveConversation({
        id: record.id,
        title: record.title,
        messages: record.messages,
      }),
    ).resolves.toEqual(record);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/conversations");
  });

  it("patches a conversation and rejects invalid response data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "invalid" }), { status: 200 }),
      ),
    );

    await expect(
      updateStoredConversation(record.id, {
        updateMessage: {
          id: record.messages[0].id,
          content: "已完成",
        },
      }),
    ).rejects.toThrow();
  });

  it("deletes a conversation through the typed endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: record.id, deleted: true }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteStoredConversation(record.id)).resolves.toEqual({
      id: record.id,
      deleted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/conversations/${record.id}`,
      { method: "DELETE", signal: undefined },
    );
  });
});
