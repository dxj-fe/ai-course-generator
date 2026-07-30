import { createConversationHistoryService } from "@/server/conversation/service";
import { createConversationStore } from "@/server/conversation/store";
import { createCourseHistoryService } from "@/server/course/service/history";
import { createCoursePublicEventReader } from "@/server/course/stream/public-event-reader";
import { createCourseStore } from "@/server/course/store/course";
import { createCourseTaskStore } from "@/server/course/store/task";
import { createCourseTaskEventBus } from "@/server/course/task/event-bus";
import { createCourseGenerationTaskService } from "@/server/course/task/service";
import { createHtmlPreviewStore } from "@/server/preview/store";

export type WebServices = Readonly<{
  courseEvents: ReturnType<typeof createCourseTaskEventBus>;
  courseHistory: ReturnType<typeof createCourseHistoryService>;
  coursePublicEvents: ReturnType<typeof createCoursePublicEventReader>;
  courses: ReturnType<typeof createCourseStore>;
  courseTasks: ReturnType<typeof createCourseGenerationTaskService>;
  conversationHistory: ReturnType<typeof createConversationHistoryService>;
  conversations: ReturnType<typeof createConversationStore>;
  previews: ReturnType<typeof createHtmlPreviewStore>;
}>;

/** Route 只从这里取得已装配服务，避免各 Route 自行创建 Store 和事件总线。 */
export function createWebServices(): WebServices {
  const courseEvents = createCourseTaskEventBus();
  const courses = createCourseStore();
  const courseTaskStore = createCourseTaskStore();
  const conversations = createConversationStore();
  return Object.freeze({
    courseEvents,
    courseHistory: createCourseHistoryService({
      courseStore: courses,
      taskStore: courseTaskStore,
    }),
    coursePublicEvents: createCoursePublicEventReader(),
    courses,
    courseTasks: createCourseGenerationTaskService({
      courseStore: courses,
      eventBus: courseEvents,
      taskStore: courseTaskStore,
    }),
    conversationHistory: createConversationHistoryService({
      conversationStore: conversations,
      courseStore: courses,
      taskStore: courseTaskStore,
    }),
    conversations,
    previews: createHtmlPreviewStore(),
  });
}

const webServicesGlobal = globalThis as typeof globalThis & {
  __keyaWebServices?: WebServices;
};

export function getWebServices() {
  return (
    webServicesGlobal.__keyaWebServices ??=
      createWebServices()
  );
}
