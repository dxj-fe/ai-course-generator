import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { createCourseStore } from "@/server/storage/course-store";
import { courseTaskEventBus } from "@/server/tasks/course-task-event-bus";
import { courseGenerationTaskService } from "@/server/tasks/course-generation-task-service";
import {
  COURSE_TASK_SSE_HEADERS,
  courseTaskMessageCursor,
  encodeCourseTaskSseMessage,
  parseLastEventId,
} from "@/server/tasks/course-task-sse";
import {
  CourseTaskIdSchema,
  type CourseTaskRecord,
  type CourseTaskStreamMessage,
} from "@/shared/course-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const courseStore = createCourseStore();
const HEARTBEAT_INTERVAL_MS = 15_000;

type CourseTaskEventsRouteContext = {
  params: Promise<{ taskId: string }>;
};

/** 从持久化游标无缝切换到当前进程的实时事件订阅。 */
export async function GET(
  request: Request,
  { params }: CourseTaskEventsRouteContext,
) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsedTaskId = CourseTaskIdSchema.safeParse((await params).taskId);
    if (!parsedTaskId.success) {
      throw new AiRequestError("taskId 格式无效。");
    }

    let initialCursor: number | undefined;
    try {
      initialCursor = parseLastEventId(request.headers.get("last-event-id"));
    } catch (error) {
      throw new AiRequestError(
        error instanceof Error ? error.message : "Last-Event-ID 格式无效。",
      );
    }

    const task = await courseGenerationTaskService.load(parsedTaskId.data);
    if (!task) {
      return Response.json(
        { code: "REQUEST_ERROR", message: "课程任务不存在。", traceId },
        { status: 404 },
      );
    }

    return new Response(createTaskEventStream(request, task, initialCursor), {
      headers: COURSE_TASK_SSE_HEADERS,
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}

function createTaskEventStream(
  request: Request,
  task: CourseTaskRecord,
  initialCursor: number | undefined,
) {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let ready = false;
      let cursor = initialCursor ?? 0;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const buffered: CourseTaskStreamMessage[] = [];

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // cancel() 或终态可能已经关闭 Controller。
        }
      };

      const send = (message: CourseTaskStreamMessage) => {
        if (closed) return;
        if (message.source !== task.source) return;
        if (
          message.type === "event" &&
          (message.event.traceId !== task.traceId ||
            message.event.sequence <= cursor)
        ) {
          return;
        }

        controller.enqueue(
          encoder.encode(encodeCourseTaskSseMessage(message)),
        );
        const nextCursor = courseTaskMessageCursor(message);
        if (nextCursor !== undefined) cursor = Math.max(cursor, nextCursor);
        if (message.type === "terminal") close();
      };

      const unsubscribe = courseTaskEventBus.subscribe(task.taskId, (message) => {
        if (ready) send(message);
        else buffered.push(message);
      });
      cleanup = close;
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }

      void (async () => {
        try {
          const [state, currentTask] = await Promise.all([
            courseStore.load(task.courseId),
            courseGenerationTaskService.load(task.taskId),
          ]);

          if (state) {
            if (initialCursor === undefined) {
              send({
                type: "snapshot",
                taskId: task.taskId,
                courseId: task.courseId,
                source: task.source,
                state,
              });
            } else {
              for (const event of state.events) {
                if (
                  event.traceId === task.traceId &&
                  event.sequence > initialCursor
                ) {
                  send({
                    type: "event",
                    taskId: task.taskId,
                    courseId: task.courseId,
                    source: task.source,
                    event,
                  });
                }
              }
            }
          }

          ready = true;
          for (const message of buffered.splice(0)) send(message);

          if (
            !closed &&
            state &&
            currentTask &&
            isTerminalTask(currentTask) &&
            state.status === currentTask.status
          ) {
            send({
              type: "terminal",
              taskId: task.taskId,
              courseId: task.courseId,
              source: task.source,
              status: currentTask.status,
              state,
            });
          }

          if (!closed) {
            heartbeat = setInterval(() => {
              if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
            }, HEARTBEAT_INTERVAL_MS);
          }
        } catch (error) {
          if (!closed) {
            closed = true;
            unsubscribe();
            request.signal.removeEventListener("abort", close);
            controller.error(error);
          }
        }
      })();
    },
    cancel() {
      cleanup();
    },
  });
}

function isTerminalTask(
  task: CourseTaskRecord,
): task is CourseTaskRecord & {
  status: "completed" | "failed" | "cancelled";
} {
  return (
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "cancelled"
  );
}
