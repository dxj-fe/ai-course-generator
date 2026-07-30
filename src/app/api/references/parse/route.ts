import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/infra/ai/error";
import { parseReferenceUpload } from "@/server/reference";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const traceId = request.headers.get("x-trace-id")?.trim() || createTraceId();

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new AiRequestError("multipart/form-data 必须包含 file 字段。");
    }

    const referencePack = await parseReferenceUpload(file, { traceId });
    return Response.json(referencePack, {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
