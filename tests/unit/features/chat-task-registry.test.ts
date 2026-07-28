import { describe, expect, it } from "vitest";

import {
  removeRegisteredTask,
  updateConversationTaskStatus,
  type ActiveCourseTaskRegistry,
} from "../../../src/features/keya/chat-task-registry";
import type { KeyaConversation } from "../../../src/types/keya";

describe("chat task isolation", () => {
  it("pauses only the addressed conversation", () => {
    const courseOne = conversation("conversation-course-one", "running");
    const courseTwo = conversation("conversation-course-two", "running");

    const next = updateConversationTaskStatus(
      [courseOne, courseTwo],
      courseTwo.id,
      "paused",
    );

    expect(next[0]).toBe(courseOne);
    expect(next[0]?.taskStatus).toBe("running");
    expect(next[1]?.taskStatus).toBe("paused");
  });

  it("removes only the matching conversation task", () => {
    const registry = {
      "conversation-course-one": task(
        "conversation-course-one",
        "task-course-one",
      ),
      "conversation-course-two": task(
        "conversation-course-two",
        "task-course-two",
      ),
    } satisfies ActiveCourseTaskRegistry;

    const next = removeRegisteredTask(
      registry,
      "conversation-course-two",
      "task-course-two",
    );

    expect(next["conversation-course-one"]).toBe(
      registry["conversation-course-one"],
    );
    expect(next["conversation-course-two"]).toBeUndefined();
  });
});

function conversation(
  id: string,
  taskStatus: KeyaConversation["taskStatus"],
): KeyaConversation {
  return {
    id,
    title: id,
    taskStatus,
    messages: [],
  };
}

function task(conversationId: string, taskId: string) {
  return {
    taskId,
    traceId: `trace-${taskId}`,
    conversationId,
    assistantId: `message-${taskId}`,
    runId: `run-${taskId}`,
    prompt: "生成课程",
    runStartedAt: 1,
    requestStartedAt: 1,
    mode: "create" as const,
    source: "langgraph" as const,
  };
}
