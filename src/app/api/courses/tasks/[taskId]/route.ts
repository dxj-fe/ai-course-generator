import { after } from "next/server";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
  toAiErrorPayload,
} from "@/server/infra/ai/error";
import { getWebServices } from "@/server/setup/web";
import {
  CourseTaskControlRequestSchema,
  CourseTaskControlResponseSchema,
  CourseTaskIdSchema,
} from "@/shared/course-schema";

export const runtime = "nodejs";

const { courseTasks } = getWebServices();

type CourseTaskRouteContext = {
  params: Promise<{ taskId: string }>;
};

/** 暂停保留可恢复 checkpoint；继续使用同一 taskId/courseId 和新 traceId。 */
export async function PATCH(
  request: Request,
  { params }: CourseTaskRouteContext,
) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsedTaskId = CourseTaskIdSchema.safeParse((await params).taskId);
    if (!parsedTaskId.success) {
      throw new AiRequestError("taskId 格式无效。");
    }
    const control = await readControlRequest(request);
    const record =
      control.action === "pause"
        ? await courseTasks.pause(parsedTaskId.data)
        : await courseTasks.resume(parsedTaskId.data);

    if (!record) {
      return Response.json(
        { code: "REQUEST_ERROR", message: "课程任务不存在。", traceId },
        { status: 404 },
      );
    }

    if (control.action === "resume" && record.status === "queued") {
      after(async () => {
        try {
          await courseTasks.run(record.taskId);
        } catch (error) {
          const classified = toAiErrorPayload(error, record.traceId);
          console.error("[course-task] 恢复后的后台任务执行失败", {
            taskId: record.taskId,
            traceId: record.traceId,
            errorCode: classified.code,
            errorMessage: classified.message,
          }, error);
        }
      });
    }

    const response = CourseTaskControlResponseSchema.parse({
      taskId: record.taskId,
      courseId: record.courseId,
      traceId: record.traceId,
      status: record.status,
    });
    return Response.json(response, {
      status:
        control.action === "resume" && record.status === "queued" ? 202 : 200,
      headers: { "x-trace-id": record.traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}

async function readControlRequest(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new AiRequestError("请求体必须是有效的 JSON。");
  }
  const parsed = CourseTaskControlRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AiRequestError("action 必须是 pause 或 resume。");
  }
  return parsed.data;
}

/** 用户主动取消后台任务；EventSource 断开不会调用此路由。 */
export async function DELETE(
  request: Request,
  { params }: CourseTaskRouteContext,
) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsedTaskId = CourseTaskIdSchema.safeParse((await params).taskId);
    if (!parsedTaskId.success) {
      throw new AiRequestError("taskId 格式无效。");
    }

    const record = await courseTasks.cancel(parsedTaskId.data);
    if (!record) {
      return Response.json(
        { code: "REQUEST_ERROR", message: "课程任务不存在。", traceId },
        { status: 404 },
      );
    }

    return Response.json({
      taskId: record.taskId,
      status: record.status,
      traceId: record.traceId,
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
