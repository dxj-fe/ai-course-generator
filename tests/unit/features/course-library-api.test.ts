import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCourseHistoryDetail,
  listCourseHistory,
} from "../../../src/features/course-planner/lib/course-library-api";

describe("course library API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends typed filters and validates compact history", async () => {
    const payload = {
      items: [historyItem()],
      total: 1,
      unavailableCount: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listCourseHistory({
        query: "太阳系",
        status: "completed",
        source: "langgraph",
      }),
    ).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/courses?query=%E5%A4%AA%E9%98%B3%E7%B3%BB&status=completed&source=langgraph",
    );
  });

  it("rejects an invalid detail response before it reaches UI state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ course: { privatePrompt: "no" }, runs: [] })),
      ),
    );

    await expect(getCourseHistoryDetail("course-day-34")).rejects.toThrow();
  });
});

function historyItem() {
  return {
    courseId: "course-day-34",
    title: "太阳系课程",
    prompt: "生成太阳系课程",
    status: "completed",
    currentStage: "complete",
    totalPages: 3,
    completedPages: 3,
    referenceCount: 0,
    runCount: 1,
    exportable: true,
    startedAt: "2026-07-22T03:00:00.000Z",
    updatedAt: "2026-07-22T03:05:00.000Z",
    completedAt: "2026-07-22T03:05:00.000Z",
  };
}
