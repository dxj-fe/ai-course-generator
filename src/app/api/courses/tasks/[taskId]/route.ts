import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { courseGenerationTaskService } from "@/server/tasks/course-generation-task-service";
import { CourseTaskIdSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

type CourseTaskRouteContext = {
  params: Promise<{ taskId: string }>;
};

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

    const record = await courseGenerationTaskService.cancel(parsedTaskId.data);
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
