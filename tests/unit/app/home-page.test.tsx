import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("@/components/site-header", () => ({
  SiteHeader: () => <header>header</header>,
}));
vi.mock("@/features/keya/home-hero", () => ({
  HomeHero: () => <section>hero</section>,
}));
vi.mock("@/features/keya/recommended-course-showcase", () => ({
  RecommendedCourseShowcase: ({
    initialData,
  }: {
    initialData: { items: Array<{ id: string }> };
  }) => (
    <section data-recommended={initialData.items.map(({ id }) => id).join(",")}>
      recommendations
    </section>
  ),
}));
vi.mock("@/server/recommendations/recommended-course-registry", () => ({
  listRecommendedCourses: mocks.list,
}));

import Home from "../../../src/app/page";

describe("homepage recommendations", () => {
  it("uses the backend recommendation batch without loading personal history", async () => {
    mocks.list.mockReturnValue({
      items: [
        { id: "recommended-math-functions" },
        { id: "recommended-chinese-analects" },
        { id: "recommended-english-conversation" },
      ],
    });

    const markup = renderToStaticMarkup(await Home());

    expect(mocks.list).toHaveBeenCalledWith(0);
    expect(markup).toContain(
      'data-recommended="recommended-math-functions,recommended-chinese-analects,recommended-english-conversation"',
    );
    expect(markup).not.toContain("gallery");
  });

  it("uses the recommendation cursor for the native no-JavaScript fallback", async () => {
    mocks.list.mockReturnValue({ items: [{ id: "recommended-science-sky" }] });

    renderToStaticMarkup(
      await Home({
        searchParams: Promise.resolve({ recommendationCursor: "3" }),
      }),
    );

    expect(mocks.list).toHaveBeenCalledWith(3);
  });
});
