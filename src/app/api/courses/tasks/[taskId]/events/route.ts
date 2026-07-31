import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/infra/ai/error";
import {
  COURSE_TASK_SSE_HEADERS,
  courseTaskMessageCursor,
  encodeCourseTaskSseMessage,
  parseLastEventId,
  sanitizePublicCourseState,
  sanitizePublicCourseTaskStreamMessage,
  type CourseTaskReplayCursor,
} from "@/server/course";
import { getWebServices } from "@/server/setup/web";
import {
  CourseTaskIdSchema,
  type CourseTaskRecord,
  type CourseTaskStreamMessage,
} from "@/shared/course-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const {
  courseEvents,
  coursePublicEvents: coursePublicEventReader,
  courses: courseStore,
  courseTasks,
} = getWebServices();
const HEARTBEAT_INTERVAL_MS = 15_000;
const DURABLE_POLL_INTERVAL_MS = 500;

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

    let initialCursor: CourseTaskReplayCursor | undefined;
    try {
      initialCursor = parseLastEventId(request.headers.get("last-event-id"));
    } catch (error) {
      throw new AiRequestError(
        error instanceof Error ? error.message : "Last-Event-ID 格式无效。",
      );
    }

    const task = await courseTasks.load(parsedTaskId.data);
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
  initialCursor: CourseTaskReplayCursor | undefined,
) {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let ready = false;
      let activeTraceId = task.traceId;
      let deliveredSequence =
        !initialCursor?.traceId || initialCursor.traceId === activeTraceId
          ? (initialCursor?.sequence ?? 0)
          : 0;
      let durableReadSequence = deliveredSequence;
      let needsTraceSnapshot = Boolean(
        initialCursor?.traceId &&
          initialCursor.traceId !== activeTraceId,
      );
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let durablePoll: ReturnType<typeof setInterval> | undefined;
      let durablePollInFlight = false;
      let lastSnapshotKey: string | undefined;
      const buffered: CourseTaskStreamMessage[] = [];

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (durablePoll) clearInterval(durablePoll);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // cancel() 或终态可能已经关闭 Controller。
        }
      };

      const send = (unsafeMessage: CourseTaskStreamMessage) => {
        if (closed) return;
        const message =
          sanitizePublicCourseTaskStreamMessage(unsafeMessage);
        const messageTraceId =
          message.type === "event"
            ? message.event.traceId
            : message.state.traceId;
        if (messageTraceId !== activeTraceId) return;
        const nextCursor = courseTaskMessageCursor(message);
        if (
          message.type === "event" &&
          message.event.sequence <= deliveredSequence
        ) {
          return;
        }
        // 内存总线可能比持久化轮询更快。旧 snapshot 不能让浏览器状态
        // 回退；terminal 即使来自较旧 checkpoint 也必须送达并关闭流。
        if (
          message.type === "snapshot" &&
          nextCursor !== undefined &&
          nextCursor.sequence < deliveredSequence
        ) {
          return;
        }
        if (message.type === "snapshot") {
          const snapshotKey = createSnapshotKey(message);
          if (snapshotKey === lastSnapshotKey) return;
          lastSnapshotKey = snapshotKey;
        }

        const cursorOverride =
          message.type === "terminal" &&
          (nextCursor?.sequence ?? -1) < deliveredSequence
            ? {
                traceId: activeTraceId,
                sequence: deliveredSequence,
              }
            : undefined;
        controller.enqueue(
          encoder.encode(
            encodeCourseTaskSseMessage(message, cursorOverride),
          ),
        );
        if (nextCursor !== undefined) {
          deliveredSequence = Math.max(
            deliveredSequence,
            nextCursor.sequence,
          );
        }
        if (message.type === "terminal") close();
      };

      const syncDurableState = async (initial = false) => {
        if (closed || durablePollInFlight) return;
        durablePollInFlight = true;

        try {
          const [state, currentTask] = await Promise.all([
            courseStore.load(task.courseId),
            courseTasks.load(task.taskId),
          ]);
          if (closed || !state || !currentTask) return;

          if (currentTask.traceId !== activeTraceId) {
            activeTraceId = currentTask.traceId;
            deliveredSequence =
              initialCursor?.traceId === activeTraceId
                ? initialCursor.sequence
                : 0;
            durableReadSequence = deliveredSequence;
            lastSnapshotKey = undefined;
            needsTraceSnapshot = true;
          }
          // resume 会先原子更新 TaskRecord，再由新 runner 接管 CourseRun。
          // 这段窄窗口内旧 checkpoint 仍属上一条 trace，不能把它发给新游标。
          if (state.traceId !== activeTraceId) return;

          // 首次无游标连接仍保持 snapshot-first 合同。snapshot 的事件序号
          // 已是 durable sequence，随后只补发比 checkpoint 更新的数据库事件。
          const publicState = sanitizePublicCourseState(state);
          const sentBaselineSnapshot =
            (initial && initialCursor === undefined) || needsTraceSnapshot;
          if (sentBaselineSnapshot) {
            send({
              type: "snapshot",
              taskId: task.taskId,
              courseId: task.courseId,
              taskStatus: currentTask.status,
              state: publicState,
            });
            needsTraceSnapshot = false;
          }

          const batch = coursePublicEventReader.listAfter({
            taskId: task.taskId,
            traceId: activeTraceId,
            afterSequence: durableReadSequence,
          });
          if (batch.traceId && batch.traceId !== activeTraceId) return;
          durableReadSequence = Math.max(
            durableReadSequence,
            batch.scannedThroughSequence,
          );
          for (const event of batch.events) {
            send({
              type: "event",
              taskId: task.taskId,
              courseId: task.courseId,
              event,
            });
          }

          if (
            isTerminalTask(currentTask) &&
            state.status === currentTask.status
          ) {
            send({
              type: "terminal",
              taskId: task.taskId,
              courseId: task.courseId,
              status: currentTask.status,
              state: publicState,
            });
            return;
          }

          // 跨进程 worker 不会经过本进程 EventBus。只要持久化检查点有变化，
          // 就补发 snapshot；增量事件仍由 cursor 去重并支持断线重放。
          if (!sentBaselineSnapshot) {
            send({
              type: "snapshot",
              taskId: task.taskId,
              courseId: task.courseId,
              taskStatus: currentTask.status,
              state: publicState,
            });
          }
        } catch (error) {
          console.error(
            "[course-task-sse]",
            {
              event: initial ? "stream:init-error" : "stream:poll-error",
              taskId: task.taskId,
              courseId: task.courseId,
              traceId: activeTraceId,
              deliveredSequence,
              durableReadSequence,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
            error,
          );
          if (initial && !closed) {
            closed = true;
            unsubscribe();
            request.signal.removeEventListener("abort", close);
            controller.error(error);
          }
        } finally {
          durablePollInFlight = false;
        }
      };

      const unsubscribe = courseEvents.subscribe(task.taskId, (message) => {
        if (!ready) {
          buffered.push(message);
          return;
        }
        // TaskRecord 已切到新 trace、CourseStore checkpoint 尚未对齐时，
        // 不能让同进程 EventBus 抢在基线 snapshot 前发送增量。事件已经
        // 持久化，下一次 durable poll 会在 snapshot 后完整重放。
        if (needsTraceSnapshot && message.type === "event") return;
        send(message);
      });
      cleanup = close;
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }

      void (async () => {
        await syncDurableState(true);
        if (closed) return;

        ready = true;
        for (const message of buffered.splice(0)) send(message);

        if (!closed) {
          durablePoll = setInterval(() => {
            void syncDurableState();
          }, DURABLE_POLL_INTERVAL_MS);
          heartbeat = setInterval(() => {
            if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
          }, HEARTBEAT_INTERVAL_MS);
        }
      })();
    },
    cancel() {
      cleanup();
    },
  });
}

function createSnapshotKey(
  message: Extract<CourseTaskStreamMessage, { type: "snapshot" }>,
) {
  return [
    message.state.traceId,
    message.taskStatus ?? message.state.status,
    message.state.status,
    message.state.updatedAt,
    message.state.events.at(-1)?.sequence ?? 0,
  ].join(":");
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
