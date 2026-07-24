import { getErrorText } from "@/features/ai-playground/lib/messages";
import {
  parseGeneratedHtmlPreviewRecord,
  type GeneratedHtmlPreviewInput,
} from "@/shared/html-preview";

export async function saveGeneratedHtmlPreview(
  input: GeneratedHtmlPreviewInput,
) {
  const response = await fetch("/api/previews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(getErrorText(payload));
  return parseGeneratedHtmlPreviewRecord(payload);
}
