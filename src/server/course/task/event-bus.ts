import {
  CourseTaskIdSchema,
  CourseTaskStreamMessageSchema,
  type CourseTaskStreamMessage,
} from "@/shared/course-schema";

export type CourseTaskEventSubscriber = (
  message: CourseTaskStreamMessage,
) => void;

export type CourseTaskEventBus = {
  publish(message: CourseTaskStreamMessage): void;
  subscribe(
    taskId: string,
    subscriber: CourseTaskEventSubscriber,
  ): () => void;
};

/**
 * 单进程任务事件总线。同步发布保证同一 taskId 内的消息保持发布顺序；
 * 持久化重放由课程检查点负责，不在内存总线中复制状态。
 */
export function createCourseTaskEventBus(): CourseTaskEventBus {
  const subscribers = new Map<string, Set<CourseTaskEventSubscriber>>();

  return {
    publish(message) {
      const parsed = CourseTaskStreamMessageSchema.parse(message);
      const taskSubscribers = subscribers.get(parsed.taskId);

      if (!taskSubscribers) {
        return;
      }

      for (const subscriber of [...taskSubscribers]) {
        try {
          subscriber(parsed);
        } catch (error) {
          // 传输层订阅者失效不能反向中断持久化工作流，也不能阻塞
          // 同一任务的其他浏览器连接。
          console.error("[course-task-event-bus] 事件订阅者处理失败", {
            taskId: parsed.taskId,
            error: error instanceof Error ? error.message : "未知错误",
          });
        }
      }
    },

    subscribe(taskId, subscriber) {
      const safeTaskId = CourseTaskIdSchema.parse(taskId);
      const taskSubscribers = subscribers.get(safeTaskId) ?? new Set();
      let active = true;

      taskSubscribers.add(subscriber);
      subscribers.set(safeTaskId, taskSubscribers);

      return () => {
        if (!active) {
          return;
        }

        active = false;
        taskSubscribers.delete(subscriber);
        if (taskSubscribers.size === 0) {
          subscribers.delete(safeTaskId);
        }
      };
    },
  };
}
