import { getErrorText } from "@/features/keya/api/error";
import {
  CourseTaskControlResponseSchema,
  CourseTaskCreateResponseSchema,
  type CourseCreationBrief,
  type CoursePageCount,
  type CourseTaskControlAction,
  type CourseTaskControlResponse,
  type CourseTaskCreateResponse,
  type ReferencePack,
} from "@/shared/course-schema";

export type CourseTaskPageCount = CoursePageCount;
type CourseTaskWorkerOptions = {
  creationBrief: CourseCreationBrief;
  executionMode?: "parallel";
  concurrency?: number;
  referencePacks?: ReferencePack[];
};

export type CreateCourseTaskInput =
  | (CourseTaskWorkerOptions & {
      userPrompt: string;
      courseId?: string;
      pageCount?: CourseTaskPageCount;
    })
  | (CourseTaskWorkerOptions & {
      courseId: string;
      userPrompt?: string;
      pageCount?: CourseTaskPageCount;
    });

export type CourseTaskRequestOptions = {
  signal?: AbortSignal;
  traceId?: string;
};

/** 创建异步整课任务；生成进度通过对应的 SSE 端点订阅。 */
export async function createCourseTask(
  input: CreateCourseTaskInput,
  options: CourseTaskRequestOptions = {},
): Promise<CourseTaskCreateResponse> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const response = await fetch("/api/courses/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": traceId,
    },
    body: JSON.stringify({
      ...input,
      traceId,
    }),
    signal: options.signal,
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorText(payload));
  }

  const parsed = CourseTaskCreateResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(
      `课程任务接口返回了无效状态：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

/** 显式取消后台任务；关闭 EventSource 本身不会取消生成。 */
export async function cancelCourseTask(
  taskId: string,
  options: CourseTaskRequestOptions = {},
): Promise<void> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const response = await fetch(
    `/api/courses/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
      headers: {
        "x-trace-id": traceId,
      },
      signal: options.signal,
    },
  );

  if (!response.ok) {
    throw new Error(getErrorText(await readJsonResponse(response)));
  }
}

/** 暂停或继续单个课程任务；调用方必须显式传入目标 taskId。 */
async function controlCourseTask(
  taskId: string,
  action: CourseTaskControlAction,
  options: CourseTaskRequestOptions = {},
): Promise<CourseTaskControlResponse> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const response = await fetch(
    `/api/courses/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-trace-id": traceId,
      },
      body: JSON.stringify({ action }),
      signal: options.signal,
    },
  );
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getErrorText(payload));
  }

  const parsed = CourseTaskControlResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `课程任务控制接口返回了无效状态：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

export function pauseCourseTask(
  taskId: string,
  options: CourseTaskRequestOptions = {},
) {
  return controlCourseTask(taskId, "pause", options);
}

export function resumeCourseTask(
  taskId: string,
  options: CourseTaskRequestOptions = {},
) {
  return controlCourseTask(taskId, "resume", options);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
