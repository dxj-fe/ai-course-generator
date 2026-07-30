import { getRecommendedCourse } from "@/server/recommendations/recommended-course-registry";
import { renderRecommendedCoursePreviewHtml } from "@/server/recommendations/recommended-course-preview";

export const runtime = "nodejs";

const previewHeaders = {
  "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
  "content-security-policy":
    "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await context.params;
  const course = getRecommendedCourse(courseId);
  if (!course) {
    return new Response(null, {
      status: 404,
      headers: { "x-content-type-options": "nosniff" },
    });
  }

  return new Response(renderRecommendedCoursePreviewHtml(course), {
    headers: previewHeaders,
  });
}
