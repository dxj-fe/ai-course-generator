import { z } from "zod";

import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { createCourseStore } from "@/server/storage/course-store";
import {
  runCourseGenerationWorkflow,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-workflow";
import { CourseIdSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

const CourseGenerationRequestSchema = z
  .object({
    courseId: CourseIdSchema.optional(),
    userPrompt: z.string().trim().min(2).max(4_000).optional(),
    pageCount: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
    traceId: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.userPrompt || value.courseId), {
    message: "userPrompt 或 courseId 至少提供一个",
  });

const courseStore = createCourseStore();

/** 一次性返回整课状态；Day 19 再把同一协议的传输替换为 SSE。 */
export async function POST(req: Request) {
  const headerTraceId = req.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const parsed = CourseGenerationRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AiRequestError(
        `请求必须包含有效的课程提示或 courseId：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    const traceId = parsed.data.traceId || headerTraceId;
    const courseId =
      parsed.data.courseId ?? `course-${crypto.randomUUID()}`;
    const existingState = await courseStore.load(courseId);
    const userPrompt = parsed.data.userPrompt ?? existingState?.userPrompt;

    if (!userPrompt) {
      throw new AiRequestError(`找不到课程 ${courseId} 的可恢复检查点。`);
    }
    if (
      existingState &&
      parsed.data.userPrompt &&
      parsed.data.userPrompt !== existingState.userPrompt
    ) {
      throw new AiRequestError("恢复课程时不能更换原始 userPrompt。");
    }
    if (
      existingState?.intent &&
      !isMvpPageCount(existingState.intent.courseLength)
    ) {
      throw new AiRequestError("持久化课程的页面数量不属于 Day 18 的 3–5 页范围。");
    }
    if (
      existingState?.intent &&
      parsed.data.pageCount &&
      parsed.data.pageCount !== existingState.intent.courseLength
    ) {
      throw new AiRequestError("恢复课程时不能更改已确定的页面数量。");
    }

    const pageCount = existingState?.intent
      ? (existingState.intent.courseLength as CourseMvpPageCount)
      : parsed.data.pageCount;
    const state = await runCourseGenerationWorkflow(
      { courseId, userPrompt, pageCount, existingState },
      { abortSignal: req.signal, traceId },
      { checkpoint: courseStore.save },
    );

    return Response.json({ courseId, state, traceId: state.traceId });
  } catch (error) {
    return createAiErrorResponse(error, headerTraceId);
  }
}

function isMvpPageCount(value: number): value is CourseMvpPageCount {
  return value === 3 || value === 4 || value === 5;
}
