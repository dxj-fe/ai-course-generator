import { z } from "zod";

import { getWebServices } from "@/server/setup/web";
import { CourseIdSchema } from "@/shared/course-schema";
import {
  buildFittedLessonSrcDoc,
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

export const runtime = "nodejs";

const { courses: courseStore } = getWebServices();

const CoverQuerySchema = z
  .object({
    pageId: z.string().min(1).max(80),
    version: z.coerce.number().int().positive(),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const responseHeaders = {
  "cache-control": "private, max-age=31536000, immutable",
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts",
  ].join("; "),
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

type CourseCoverRouteContext = { params: Promise<{ courseId: string }> };

export async function GET(
  request: Request,
  { params }: CourseCoverRouteContext,
) {
  const parsedCourseId = CourseIdSchema.safeParse((await params).courseId);
  const url = new URL(request.url);
  const parsedQuery = CoverQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsedCourseId.success || !parsedQuery.success) {
    return new Response(null, { status: 404 });
  }

  const course = await courseStore.load(parsedCourseId.data);
  const firstPage = course?.pages.find(({ order }) => order === 1);
  const output = firstPage?.htmlOutput;
  if (
    firstPage?.status !== "completed" ||
    !output ||
    firstPage.pageId !== parsedQuery.data.pageId ||
    output.version !== parsedQuery.data.version ||
    output.generatedAt !== parsedQuery.data.generatedAt
  ) {
    return new Response(null, { status: 404 });
  }

  const contract = validateGeneratedHtmlContract(output.html);
  const safety = sanitizeHtmlLite(output.html);
  if (!contract.valid || !safety.safe) {
    return new Response(null, { status: 422 });
  }

  return new Response(buildFittedLessonSrcDoc(output.html), {
    headers: responseHeaders,
  });
}
