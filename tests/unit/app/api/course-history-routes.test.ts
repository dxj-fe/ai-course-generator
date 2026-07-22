import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  loadDetail: vi.fn(),
  loadCourse: vi.fn(),
  createArchive: vi.fn(),
}));

vi.mock("@/server/courses/course-history-service", () => ({
  courseHistoryService: { list: mocks.list, load: mocks.loadDetail },
}));
vi.mock("@/server/storage/course-store", () => ({
  createCourseStore: () => ({ load: mocks.loadCourse }),
}));
vi.mock("@/server/courses/course-export", () => ({
  createCourseArchive: mocks.createArchive,
}));

import { GET as GET_LIST } from "../../../../src/app/api/courses/route";
import { GET as GET_DETAIL } from "../../../../src/app/api/courses/[courseId]/route";
import { GET as GET_EXPORT } from "../../../../src/app/api/courses/[courseId]/export/route";

describe("course history Route Handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes validated list filters to the history service", async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0, unavailableCount: 0 });
    const response = await GET_LIST(
      new Request("http://localhost/api/courses?query=solar&status=failed&source=langgraph"),
    );

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      query: "solar",
      status: "failed",
      source: "langgraph",
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
});

function context(courseId: string) {
  return { params: Promise.resolve({ courseId }) };
}
