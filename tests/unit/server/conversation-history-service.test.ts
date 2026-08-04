import { describe, expect, it, vi } from "vitest";

import {
  createConversationHistoryService,
} from "../../../src/server/conversation/service";
import type { ConversationStore } from "../../../src/server/conversation/store";
import type { CourseStore } from "../../../src/server/course/store/course";
import type { CourseTaskStore } from "../../../src/server/course/store/task";

const NOW = "2026-08-04T08:00:00.000Z";

describe("conversation history service", () => {
  it("隔离不兼容的课程历史，不让聊天页整体失败", async () => {
    const loadCourse = vi.fn(() => {
      throw new Error("旧课程 payload 不兼容");
    });
    const service = createConversationHistoryService({
      conversationStore: {
        list: async () => ({
          items: [
            {
              id: "conversation-legacy-course",
              title: "历史课程",
              pinned: false,
              courseId: "course-legacy-course",
              createdAt: NOW,
              updatedAt: NOW,
              messages: [
                {
                  id: "message-legacy-course",
                  role: "user",
                  content: "生成一门历史课程",
                  createdAt: NOW,
                },
              ],
            },
          ],
          unavailableCount: 0,
        }),
      } as ConversationStore,
      courseStore: {
        load: loadCourse,
        list: async () => ({ items: [], unavailableCount: 1 }),
      } as CourseStore,
      taskStore: {
        list: async () => ({ items: [], unavailableCount: 2 }),
      } as CourseTaskStore,
    });

    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          id: "conversation-legacy-course",
          title: "历史课程",
          messages: [{ content: "生成一门历史课程" }],
        },
      ],
      unavailableCount: 3,
    });
    expect(loadCourse).not.toHaveBeenCalled();
  });

  it("通过 course 参数查看不兼容历史时返回空结果", async () => {
    const loadCourse = vi.fn(() => {
      throw new Error("旧课程 payload 不兼容");
    });
    const service = createConversationHistoryService({
      conversationStore: {
        list: async () => ({ items: [], unavailableCount: 0 }),
      } as ConversationStore,
      courseStore: {
        load: loadCourse,
        list: async () => ({ items: [], unavailableCount: 1 }),
      } as CourseStore,
      taskStore: {
        list: async () => ({ items: [], unavailableCount: 0 }),
      } as CourseTaskStore,
    });

    await expect(
      service.viewForCourse("course-legacy-course"),
    ).resolves.toBeUndefined();
    expect(loadCourse).not.toHaveBeenCalled();
  });
});
