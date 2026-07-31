import { describe, expect, it } from "vitest";

import {
  ConversationRecordSchema,
  DeleteConversationResponseSchema,
  UpdateConversationInputSchema,
} from "../../../src/shared/course-schema";

const conversation = {
  id: "conversation-schema-test",
  title: "物理课程",
  pinned: false,
  createdAt: "2026-07-24T01:00:00.000Z",
  updatedAt: "2026-07-24T01:00:00.000Z",
  messages: [
    {
      id: "message-schema-test",
      role: "user" as const,
      content: "生成物理课程",
      createdAt: "2026-07-24T01:00:00.000Z",
    },
  ],
};

describe("conversation schemas", () => {
  it("requires the current pinned field", () => {
    expect(ConversationRecordSchema.parse(conversation).pinned).toBe(false);
    const withoutPinned = Object.fromEntries(
      Object.entries(conversation).filter(([key]) => key !== "pinned"),
    );
    expect(ConversationRecordSchema.safeParse(withoutPinned).success).toBe(
      false,
    );
  });

  it("accepts rename and pin patches while rejecting empty updates", () => {
    expect(
      UpdateConversationInputSchema.parse({
        title: "高中物理学习课程",
        pinned: true,
      }),
    ).toEqual({
      title: "高中物理学习课程",
      pinned: true,
    });
    expect(UpdateConversationInputSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateConversationInputSchema.safeParse({ title: "   " }).success,
    ).toBe(false);
  });

  it("defines the successful deletion response", () => {
    expect(
      DeleteConversationResponseSchema.parse({
        id: conversation.id,
        deleted: true,
      }),
    ).toEqual({
      id: conversation.id,
      deleted: true,
    });
    expect(
      DeleteConversationResponseSchema.safeParse({
        id: conversation.id,
        deleted: false,
      }).success,
    ).toBe(false);
  });
});
