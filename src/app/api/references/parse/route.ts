import {
  AiRequestError,
  createAiErrorResponse,
  createTraceId,
} from "@/server/ai/error";
import { parseUploadedFileSkill } from "@/server/skills/parse-uploaded-file";

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

    const referencePack = await parseUploadedFileSkill(file, { traceId });
    return Response.json(referencePack, {
      headers: { "x-trace-id": traceId },
    });
  } catch (error) {
    return createAiErrorResponse(error, traceId);
  }
}
