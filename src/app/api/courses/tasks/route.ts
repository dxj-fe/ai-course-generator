import { after } from "next/server";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
  toAiErrorPayload,
} from "@/server/ai/error";
import { courseGenerationTaskService } from "@/server/tasks/course-generation-task-service";

export const runtime = "nodejs";
export const maxDuration = 900;

/** 创建长任务后立即返回；课程编排继续由服务端任务服务持有并执行。 */
export async function POST(request: Request) {
  const headerTraceId =
    request.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const payload = await readJsonBody(request);
    const input = isObjectRecord(payload)
      ? {
          ...payload,
          source: "langgraph",
          traceId:
            typeof payload.traceId === "string" && payload.traceId.trim()
              ? payload.traceId
              : headerTraceId,
        }
      : payload;
    const task = await courseGenerationTaskService.create(input);

    after(async () => {
      try {
        await courseGenerationTaskService.run(task.taskId);
      } catch (error) {
        const classified = toAiErrorPayload(error, task.traceId);
        console.error("[course-task] 后台任务执行失败", {
          taskId: task.taskId,
          traceId: task.traceId,
          errorCode: classified.code,
        });
      }
    });

    return Response.json(task, {
      status: 202,
      headers: { "x-trace-id": task.traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AiRequestError("请求体必须是有效的 JSON。");
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
