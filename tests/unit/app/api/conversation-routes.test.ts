import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/server/storage/conversation-store", () => ({
  conversationStore: mocks,
}));

import {
  GET,
  POST,
} from "../../../../src/app/api/conversations/route";
import {
  DELETE,
  PATCH,
} from "../../../../src/app/api/conversations/[conversationId]/route";

const message = {
  id: "message-user-test",
  role: "user" as const,
  content: "生成太阳系课程",
  createdAt: "2026-07-24T01:00:00.000Z",
};

describe("conversation Route Handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists stored conversations", async () => {
    mocks.list.mockResolvedValue({ items: [], unavailableCount: 0 });
    const response = await GET(
      new Request("http://localhost/api/conversations"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      unavailableCount: 0,
    });
  });

  it("validates and stores a conversation with messages", async () => {
    const record = {
      id: "conversation-route-test",
      title: "太阳系课程",
      pinned: false,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      messages: [message],
    };
    mocks.save.mockResolvedValue(record);
    const response = await POST(
      new Request("http://localhost/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          id: record.id,
          title: record.title,
          messages: [message],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith({
      id: record.id,
      title: record.title,
      messages: [message],
    });
  });

  it("updates a message and returns 404 for a missing conversation", async () => {
    mocks.update.mockResolvedValueOnce({ id: "conversation-route-test" });
    const found = await PATCH(
      new Request(
        "http://localhost/api/conversations/conversation-route-test",
        {
          method: "PATCH",
          body: JSON.stringify({
            updateMessage: {
              id: "message-user-test",
              content: "已完成",
            },
          }),
        },
      ),
      context("conversation-route-test"),
    );
    expect(found.status).toBe(200);

    mocks.update.mockResolvedValueOnce(undefined);
    const missing = await PATCH(
      new Request(
        "http://localhost/api/conversations/conversation-route-missing",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "不存在" }),
        },
      ),
      context("conversation-route-missing"),
    );
    expect(missing.status).toBe(404);
  });

  it("deletes a conversation and returns an explicit 404 for a missing one", async () => {
    mocks.delete.mockResolvedValueOnce(true);
    const deleted = await DELETE(
      new Request(
        "http://localhost/api/conversations/conversation-route-test",
        { method: "DELETE" },
      ),
      context("conversation-route-test"),
    );

    expect(deleted.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith("conversation-route-test");
    await expect(deleted.json()).resolves.toEqual({
      id: "conversation-route-test",
      deleted: true,
    });

    mocks.delete.mockResolvedValueOnce(false);
    const missing = await DELETE(
      new Request(
        "http://localhost/api/conversations/conversation-route-missing",
        { method: "DELETE" },
      ),
      context("conversation-route-missing"),
    );

    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: "CONVERSATION_NOT_FOUND",
      message: "找不到该会话。",
    });
  });
});

function context(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}
