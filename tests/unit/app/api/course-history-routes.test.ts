import { beforeEach, describe, expect, it, vi } from "vitest";

import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  loadDetail: vi.fn(),
  loadCourse: vi.fn(),
  createArchive: vi.fn(),
}));

vi.mock("@/server/setup/web", () => ({
  getWebServices: () => ({
    courseHistory: { list: mocks.list, load: mocks.loadDetail },
    courses: { load: mocks.loadCourse },
  }),
}));
vi.mock("@/server/course/service/export", () => ({
  createCourseArchive: mocks.createArchive,
}));

import { GET as GET_LIST } from "../../../../src/app/api/courses/route";
import { GET as GET_DETAIL } from "../../../../src/app/api/courses/[courseId]/route";
import { GET as GET_COVER } from "../../../../src/app/api/courses/[courseId]/cover/route";
import { GET as GET_EXPORT } from "../../../../src/app/api/courses/[courseId]/export/route";

describe("course history Route Handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes validated list filters to the history service", async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0, unavailableCount: 0 });
    const response = await GET_LIST(
      new Request("http://localhost/api/courses?query=solar&status=failed"),
    );

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      query: "solar",
      status: "failed",
    });
  });

  it("returns a persisted detail and handles a missing course", async () => {
    mocks.loadDetail.mockResolvedValueOnce({ course: {}, runs: [] });
    const found = await GET_DETAIL(
      new Request("http://localhost/api/courses/course-day-34"),
      context("course-day-34"),
    );
    expect(found.status).toBe(200);

    mocks.loadDetail.mockResolvedValueOnce(undefined);
    const missing = await GET_DETAIL(
      new Request("http://localhost/api/courses/course-missing"),
      context("course-missing"),
    );
    expect(missing.status).toBe(404);
  });

  it("streams a ZIP with download headers and rejects unsafe ids", async () => {
    mocks.loadCourse.mockResolvedValue({ courseId: "course-day-34" });
    mocks.createArchive.mockReturnValue({
      fileName: "course-day-34.zip",
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x50, 0x4b]));
          controller.close();
        },
      }),
    });
    const response = await GET_EXPORT(
      new Request("http://localhost/api/courses/course-day-34/export"),
      context("course-day-34"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain(
      "course-day-34.zip",
    );

    const invalid = await GET_EXPORT(
      new Request("http://localhost/api/courses/invalid/export"),
      context("../private"),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.loadCourse).toHaveBeenCalledTimes(1);
  });

  it("serves only the versioned first lesson as a sandbox-ready cover", async () => {
    const generatedAt = "2026-07-22T03:05:00.000Z";
    mocks.loadCourse.mockResolvedValue({
      pages: [
        {
          pageId: pageContentDsl.pageId,
          order: 1,
          status: "completed",
          htmlOutput: {
            html: buildValidGeneratedHtml(pageContentDsl),
            generatedAt,
            version: 3,
          },
        },
      ],
    });
    const query = new URLSearchParams({
      pageId: pageContentDsl.pageId,
      version: "3",
      generatedAt,
    });
    const response = await GET_COVER(
      new Request(
        `http://localhost/api/courses/course-day-34/cover?${query}`,
      ),
      context("course-day-34"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.text()).resolves.toContain("keya-viewport-fit");

    const stale = await GET_COVER(
      new Request(
        "http://localhost/api/courses/course-day-34/cover?pageId=page-02-knowledge&version=2&generatedAt=2026-07-22T03%3A05%3A00.000Z",
      ),
      context("course-day-34"),
    );
    expect(stale.status).toBe(404);
  });

  it("does not substitute a later lesson or expose unsafe cover HTML", async () => {
    const generatedAt = "2026-07-22T03:05:00.000Z";
    const request = (pageId: string) =>
      new Request(
        `http://localhost/api/courses/course-day-34/cover?${new URLSearchParams({
          pageId,
          version: "1",
          generatedAt,
        })}`,
      );
    mocks.loadCourse.mockResolvedValueOnce({
      pages: [
        {
          pageId: "page-01-cover",
          order: 1,
          status: "running",
        },
        {
          pageId: pageContentDsl.pageId,
          order: 2,
          status: "completed",
          htmlOutput: {
            html: buildValidGeneratedHtml(pageContentDsl),
            generatedAt,
            version: 1,
          },
        },
      ],
    });
    const laterLesson = await GET_COVER(
      request(pageContentDsl.pageId),
      context("course-day-34"),
    );
    expect(laterLesson.status).toBe(404);

    mocks.loadCourse.mockResolvedValueOnce({
      pages: [
        {
          pageId: pageContentDsl.pageId,
          order: 1,
          status: "completed",
          htmlOutput: {
            html: buildValidGeneratedHtml(pageContentDsl).replace(
              "</body>",
              "<script>alert('unsafe')</script></body>",
            ),
            generatedAt,
            version: 1,
          },
        },
      ],
    });
    const unsafe = await GET_COVER(
      request(pageContentDsl.pageId),
      context("course-day-34"),
    );
    expect(unsafe.status).toBe(422);
    await expect(unsafe.text()).resolves.toBe("");
  });
});

function context(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}
