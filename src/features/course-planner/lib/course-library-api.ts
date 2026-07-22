import { getErrorText } from "@/features/ai-playground/lib/messages";
import {
  CourseHistoryDetailResponseSchema,
  CourseHistoryListResponseSchema,
  type CourseHistoryDetailResponse,
  type CourseHistoryListResponse,
  type CourseTaskRuntimeSource,
} from "@/shared/course-schema";

export type CourseHistoryFilters = {
  query?: string;
  status?: "running" | "completed" | "failed" | "cancelled";
  source?: CourseTaskRuntimeSource;
};

export async function listCourseHistory(
  filters: CourseHistoryFilters = {},
  signal?: AbortSignal,
): Promise<CourseHistoryListResponse> {
  const query = new URLSearchParams();
  if (filters.query?.trim()) query.set("query", filters.query.trim());
  if (filters.status) query.set("status", filters.status);
  if (filters.source) query.set("source", filters.source);
  const response = await fetch(`/api/courses?${query}`, { signal });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(getErrorText(payload));
  return CourseHistoryListResponseSchema.parse(payload);
}

export async function getCourseHistoryDetail(
  courseId: string,
  signal?: AbortSignal,
): Promise<CourseHistoryDetailResponse> {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
    signal,
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(getErrorText(payload));
  return CourseHistoryDetailResponseSchema.parse(payload);
}

export async function downloadCourseArchive(courseId: string) {
  const response = await fetch(
    `/api/courses/${encodeURIComponent(courseId)}/export`,
  );
  if (!response.ok) throw new Error(getErrorText(await readJsonResponse(response)));

  const blob = await response.blob();
  const fileName =
    response.headers
      .get("content-disposition")
      ?.match(/filename="([^"]+)"/i)?.[1] ?? `${courseId}.zip`;
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(href);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
