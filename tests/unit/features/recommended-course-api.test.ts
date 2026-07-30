import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRecommendedCourses } from "../../../src/features/keya/recommended-course-api";
import { listRecommendedCourses } from "../../../src/server/recommendations/recommended-course-registry";

describe("recommended course API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the next cursor and validates the recommendation batch", async () => {
    const payload = listRecommendedCourses(3);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRecommendedCourses(3)).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/recommendations/courses?cursor=3",
    );
  });

  it("rejects malformed batches before they reach homepage state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [], nextCursor: 0, total: 0 })),
        ),
    );

    await expect(fetchRecommendedCourses(0)).rejects.toThrow();
  });
});
