import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("@/components/site-header", () => ({
  SiteHeader: () => <header>header</header>,
}));
vi.mock("@/features/keya/home-hero", () => ({
  HomeHero: ({
    featuredWorks,
  }: {
    featuredWorks: Array<{ courseId: string }>;
  }) => (
    <section data-featured={featuredWorks.map(({ courseId }) => courseId).join(",")}>
      featured
    </section>
  ),
}));
vi.mock("@/features/keya/work-gallery", () => ({
  WorkGallery: ({ works }: { works: Array<{ courseId: string }> }) => (
    <section data-gallery={works.map(({ courseId }) => courseId).join(",")}>
      gallery
    </section>
  ),
}));
vi.mock("@/server/courses/course-history-service", () => ({
  courseHistoryService: { list: mocks.list },
}));

import Home from "../../../src/app/page";

describe("homepage course selection", () => {
  it("features only fully generated courses while preserving all history below", async () => {
    const items = [
      historyItem("course-complete", {
        status: "completed",
        exportable: true,
        completedPages: 3,
        totalPages: 3,
        latestRun: { status: "completed" },
      }),
      historyItem("course-paused", {
        status: "completed",
        exportable: true,
        completedPages: 3,
        totalPages: 3,
        latestRun: { status: "paused" },
      }),
      historyItem("course-running", {
        status: "running",
        completedPages: 1,
        totalPages: 3,
      }),
      historyItem("course-failed", {
        status: "failed",
        completedPages: 1,
        totalPages: 3,
      }),
      historyItem("course-incomplete", {
        status: "completed",
        exportable: true,
        completedPages: 2,
        totalPages: 3,
      }),
    ];
    mocks.list.mockResolvedValue({ items, total: items.length, unavailableCount: 0 });

    const markup = renderToStaticMarkup(await Home());

    expect(markup).toContain('data-featured="course-complete"');
    expect(markup).toContain(
      'data-gallery="course-complete,course-paused,course-running,course-failed,course-incomplete"',
    );
  });
});

function historyItem(
  courseId: string,
  overrides: Record<string, unknown>,
) {
  return {
    courseId,
    title: courseId,
    prompt: "生成课程",
    status: "running",
    currentStage: "page_writer",
    totalPages: 3,
    completedPages: 0,
    referenceCount: 0,
    runCount: 1,
    exportable: false,
    startedAt: "2026-07-22T03:00:00.000Z",
    updatedAt: "2026-07-22T03:05:00.000Z",
    ...overrides,
  };
}
