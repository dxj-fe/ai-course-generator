import { describe, expect, it } from "vitest";

import { RecommendedCourseListResponseSchema } from "../../../../src/shared/course-schema";
import { GET as GET_RECOMMENDATIONS } from "../../../../src/app/api/recommendations/courses/route";
import { GET as GET_PREVIEW } from "../../../../src/app/api/recommendations/courses/[courseId]/preview/route";

describe("recommended course Route Handlers", () => {
  it("returns validated three-course batches with an opaque next position", async () => {
    const response = await GET_RECOMMENDATIONS(
      new Request("http://localhost/api/recommendations/courses?cursor=3"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");
    expect(() => RecommendedCourseListResponseSchema.parse(payload)).not.toThrow();
    expect(payload.items).toHaveLength(3);
    expect(payload.nextCursor).toBe(6);
    expect(payload.items[0].domain).toBe("science");
  });

  it("rejects an invalid cursor instead of silently changing the batch", async () => {
    const response = await GET_RECOMMENDATIONS(
      new Request("http://localhost/api/recommendations/courses?cursor=-1"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_ERROR",
    });
  });

  it("serves a sandboxed, script-free course preview and hides unknown ids", async () => {
    const response = await GET_PREVIEW(
      new Request(
        "http://localhost/api/recommendations/courses/recommended-math-functions/preview",
      ),
      context("recommended-math-functions"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html).toContain("看懂函数的变化");
    expect(html).toContain("/keya/recommendations/math-functions.jpg");
    expect(html).not.toContain("<script");

    const missing = await GET_PREVIEW(
      new Request(
        "http://localhost/api/recommendations/courses/recommended-missing/preview",
      ),
      context("recommended-missing"),
    );
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toBe("");
  });
});

function context(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}
