import { getErrorText } from "@/features/ai-playground/lib/messages";
import {
  ReferencePackSchema,
  type ReferencePack,
} from "@/shared/course-schema";

export async function parseReferenceFile(
  file: File,
  options: { signal?: AbortSignal; traceId?: string } = {},
): Promise<ReferencePack> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/references/parse", {
    method: "POST",
    headers: { "x-trace-id": traceId },
    body: formData,
    signal: options.signal,
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) throw new Error(getErrorText(payload));

  const parsed = ReferencePackSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `资料解析接口返回了无效 Reference Pack：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
