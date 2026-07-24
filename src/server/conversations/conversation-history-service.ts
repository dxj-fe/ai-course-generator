import { courseGenerationToKeyaRun } from "@/features/course-planner/lib/course-generation-adapter";
import {
  createConversationStore,
  type ConversationStore,
} from "@/server/storage/conversation-store";
import {
  createCourseStore,
  type CourseStore,
} from "@/server/storage/course-store";
import {
  createCourseTaskStore,
  type CourseTaskStore,
} from "@/server/storage/course-task-store";
import type {
  ConversationRecord,
  CourseGenerationState,
  CourseTaskRecord,
} from "@/shared/course-schema";
import type { KeyaConversation } from "@/types/keya";

export type ConversationHistoryService = {
  list(): Promise<{
    items: KeyaConversation[];
    unavailableCount: number;
  }>;
  viewForCourse(courseId: string): Promise<KeyaConversation | undefined>;
};

export function createConversationHistoryService(input: {
  conversationStore?: ConversationStore;
  courseStore?: CourseStore;
  taskStore?: CourseTaskStore;
} = {}): ConversationHistoryService {
  const conversations =
    input.conversationStore ?? createConversationStore();
  const courses = input.courseStore ?? createCourseStore();
  const tasks = input.taskStore ?? createCourseTaskStore();

  return {
    async list() {
      const [conversationResult, taskResult] = await Promise.all([
        conversations.list(),
        tasks.list(),
      ]);
      const taskById = new Map(
        taskResult.items.map((task) => [task.taskId, task]),
      );
      const items = await Promise.all(
        conversationResult.items.map(async (conversation) =>
          projectConversation(
            conversation,
            conversation.courseId
              ? await courses.load(conversation.courseId)
              : undefined,
            conversation.taskId
              ? taskById.get(conversation.taskId)
              : undefined,
          ),
        ),
      );

      return {
        items,
        unavailableCount:
          conversationResult.unavailableCount + taskResult.unavailableCount,
      };
    },

    async viewForCourse(courseId) {
      const [conversationResult, course, taskResult] = await Promise.all([
        conversations.list(),
        courses.load(courseId),
        tasks.list(),
      ]);
      if (!course) return undefined;
      const existing = conversationResult.items.find(
        (conversation) => conversation.courseId === courseId,
      );
      const task = taskResult.items
        .filter((candidate) => candidate.courseId === courseId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (existing) return projectConversation(existing, course, task);

      return projectConversation(
        {
          id: `conversation-${course.courseId.slice("course-".length)}`,
          title: titleFor(course),
          pinned: false,
          courseId,
          taskId: task?.taskId,
          createdAt: course.startedAt,
          updatedAt: course.updatedAt,
          messages: [
            {
              id: `message-${crypto.randomUUID()}`,
              role: "user",
              content: course.userPrompt,
              createdAt: course.startedAt,
            },
          ],
        },
        course,
        task,
      );
    },
  };
}

function projectConversation(
  conversation: ConversationRecord,
  course?: CourseGenerationState,
  task?: CourseTaskRecord,
): KeyaConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    pinned: conversation.pinned,
    messages: conversation.messages,
    courseRun: course
      ? courseGenerationToKeyaRun(
          { courseId: course.courseId, traceId: course.traceId, state: course },
          {
            id: `run-${task?.taskId ?? course.courseId}`,
            taskId: task?.taskId,
            source: task?.source,
            prompt: course.userPrompt,
            startedAt: Date.parse(task?.createdAt ?? course.startedAt),
          },
        )
      : undefined,
  };
}

function titleFor(course: CourseGenerationState) {
  const title = course.intent?.topic.trim() || course.userPrompt.trim();
  return title.length > 160 ? `${title.slice(0, 159)}…` : title;
}

export const conversationHistoryService =
  createConversationHistoryService();
