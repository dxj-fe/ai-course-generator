import type {
  CourseTaskRuntimeSource,
  CourseTaskStatus,
} from "@/shared/course-schema";
import type { KeyaConversation } from "@/types/keya";

export type ActiveCourseTask = {
  taskId: string;
  traceId: string;
  conversationId: string;
  assistantId: string;
  runId: string;
  prompt: string;
  runStartedAt: number;
  requestStartedAt: number;
  mode: "create" | "resume";
  source: CourseTaskRuntimeSource;
};

export type ActiveCourseTaskRegistry = Record<string, ActiveCourseTask>;

const recoverableTaskStatuses = new Set<CourseTaskStatus>([
  "queued",
  "running",
  "paused",
]);

export function createInitialTaskRegistry(
  conversations: KeyaConversation[],
): ActiveCourseTaskRegistry {
  return Object.fromEntries(
    conversations.flatMap((conversation) => {
      const run = conversation.courseRun;
      const assistant = [...conversation.messages]
        .reverse()
        .find(({ role }) => role === "assistant");

      if (
        !run?.taskId ||
        !conversation.taskStatus ||
        !recoverableTaskStatuses.has(conversation.taskStatus)
      ) {
        return [];
      }

      return [
        [
          conversation.id,
          {
            taskId: run.taskId,
            traceId: run.traceId,
            conversationId: conversation.id,
            assistantId:
              assistant?.id ??
              `message-${run.taskId.slice("task-".length)}`,
            runId: run.id,
            prompt: run.prompt,
            runStartedAt: run.startedAt,
            requestStartedAt: run.startedAt,
            mode: "create" as const,
            source: run.source ?? "workflow",
          },
        ],
      ];
    }),
  );
}

export function updateConversationTaskStatus(
  conversations: KeyaConversation[],
  conversationId: string,
  taskStatus: CourseTaskStatus | undefined,
) {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, taskStatus }
      : conversation,
  );
}

export function removeRegisteredTask(
  registry: ActiveCourseTaskRegistry,
  conversationId: string,
  taskId?: string,
) {
  const registered = registry[conversationId];
  if (!registered || (taskId && registered.taskId !== taskId)) {
    return registry;
  }

  const next = { ...registry };
  delete next[conversationId];
  return next;
}
