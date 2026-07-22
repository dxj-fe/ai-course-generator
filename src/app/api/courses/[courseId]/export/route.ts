import { AiRequestError, createAiErrorResponse, createTraceId } from "@/server/ai/error";
import { createCourseArchive } from "@/server/courses/course-export";
import { createCourseStore } from "@/server/storage/course-store";
import { CourseIdSchema } from "@/shared/course-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const courseStore = createCourseStore();
type CourseExportRouteContext = { params: Promise<{ courseId: string }> };

export async function GET(
  request: Request,
  { params }: CourseExportRouteContext,
) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const parsedId = CourseIdSchema.safeParse((await params).courseId);
    if (!parsedId.success) throw new AiRequestError("courseId 格式无效。");
    const course = await courseStore.load(parsedId.data);
    if (!course) {
      return Response.json(
        { code: "REQUEST_ERROR", message: "课程不存在。", traceId },
        { status: 404 },
      );
    }
    const archive = createCourseArchive(course);
    return new Response(archive.stream, {
      headers: {
        "Content-Disposition": `attachment; filename="${archive.fileName}"`,
        "Content-Type": "application/zip",
        "Cache-Control": "no-store",
        "x-trace-id": traceId,
      },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
