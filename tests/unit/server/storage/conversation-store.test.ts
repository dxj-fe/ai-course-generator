import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createConversationStore } from "../../../../src/server/storage/conversation-store";

const directories: string[] = [];

async function temporaryDatabase() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "conversation-store-test-"),
  );
  directories.push(directory);
  return path.join(directory, "keya.sqlite");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("conversation store", () => {
  it("persists normalized conversations and ordered messages", async () => {
    const store = createConversationStore(await temporaryDatabase());
    await store.save({
      id: "conversation-test-1",
      title: "太阳系课程",
      messages: [
        {
          id: "message-user-1",
          role: "user",
          content: "生成太阳系课程",
          createdAt: "2026-07-24T01:00:00.000Z",
        },
        {
          id: "message-assistant-1",
          role: "assistant",
          content: "正在生成",
          createdAt: "2026-07-24T01:00:01.000Z",
        },
      ],
    });

    await expect(store.load("conversation-test-1")).resolves.toMatchObject({
      title: "太阳系课程",
      messages: [
        { id: "message-user-1", content: "生成太阳系课程" },
        { id: "message-assistant-1", content: "正在生成" },
      ],
    });
  });

  it("appends and updates messages while linking a course task", async () => {
    const store = createConversationStore(await temporaryDatabase());
    await store.save({
      id: "conversation-test-2",
      title: "课程",
      messages: [
        {
          id: "message-user-2",
          role: "user",
          content: "开始",
          createdAt: "2026-07-24T01:00:00.000Z",
        },
      ],
    });
    await store.update("conversation-test-2", {
      courseId: "course-test-2",
      taskId: "task-test-2",
      appendMessages: [
        {
          id: "message-assistant-2",
          role: "assistant",
          content: "处理中",
          createdAt: "2026-07-24T01:00:01.000Z",
        },
      ],
    });
    await store.update("conversation-test-2", {
      updateMessage: {
        id: "message-assistant-2",
        content: "已完成",
        duration: "8s",
      },
    });

    await expect(store.load("conversation-test-2")).resolves.toMatchObject({
      courseId: "course-test-2",
      taskId: "task-test-2",
      messages: [
        { id: "message-user-2" },
        {
          id: "message-assistant-2",
          content: "已完成",
          duration: "8s",
        },
      ],
    });
  });

  it("renames, pins, and deletes a conversation without deleting twice", async () => {
    const store = createConversationStore(await temporaryDatabase());
    await store.save({
      id: "conversation-manage-test",
      title: "未命名会话",
      messages: [
        {
          id: "message-manage-test",
          role: "user",
          content: "生成课程",
          createdAt: "2026-07-24T01:00:00.000Z",
        },
      ],
    });

    await store.update("conversation-manage-test", {
      title: "高中物理课程",
      pinned: true,
    });

    await expect(store.load("conversation-manage-test")).resolves.toMatchObject({
      title: "高中物理课程",
      pinned: true,
    });
    await expect(store.delete("conversation-manage-test")).resolves.toBe(true);
    await expect(store.load("conversation-manage-test")).resolves.toBeUndefined();
    await expect(store.list()).resolves.toMatchObject({ items: [] });
    await expect(store.delete("conversation-manage-test")).resolves.toBe(false);
  });
});
