import {
  RecommendedCourseListResponseSchema,
  type RecommendedCourseListResponse,
} from "@/shared/course-schema";

export async function fetchRecommendedCourses(
  cursor: number,
  signal?: AbortSignal,
): Promise<RecommendedCourseListResponse> {
  const response = await fetch(
    `/api/recommendations/courses?${new URLSearchParams({
      cursor: String(cursor),
    })}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`推荐课程加载失败（${response.status}）`);
  }
  return RecommendedCourseListResponseSchema.parse(await response.json());
}
