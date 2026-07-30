import { AiRequestError, createAiErrorResponse, createTraceId } from "@/server/infra/ai/error";
import { getWebServices } from "@/server/setup/web";
import { CourseIdSchema } from "@/shared/course-schema";

export const runtime = "nodejs";

const { courseHistory } = getWebServices();

type CourseRouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, { params }: CourseRouteContext) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();
  try {
    const parsedId = CourseIdSchema.safeParse((await params).courseId);
    if (!parsedId.success) throw new AiRequestError("courseId 格式无效。");
    const detail = await courseHistory.load(parsedId.data);
    if (!detail) {
      return Response.json(
        { code: "REQUEST_ERROR", message: "课程不存在。", traceId },
        { status: 404 },
      );
    }
    return Response.json(detail, { headers: { "x-trace-id": traceId } });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
