import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CourseCoverFrame } from "../../../src/features/keya/course-cover-frame";

describe("CourseCoverFrame", () => {
  it("renders a versioned inert iframe without same-origin privileges", () => {
    const markup = renderToStaticMarkup(
      <CourseCoverFrame
        courseId="course-day-34"
        cover={{
          pageId: "page-01-cover",
          version: 4,
          generatedAt: "2026-07-22T03:05:00.000Z",
        }}
        loading="eager"
        title="太阳系入门"
      />,
    );

    expect(markup).toContain(
      "/api/courses/course-day-34/cover?pageId=page-01-cover",
    );
    expect(markup).toContain("version=4");
    expect(markup).toContain("loading=\"eager\"");
    expect(markup).toContain("sandbox=\"allow-scripts\"");
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).toContain("tabindex=\"-1\"");
    expect(markup).toContain("referrerPolicy=\"no-referrer\"");
  });

  it("keeps the branded title fallback when no first lesson is ready", () => {
    const markup = renderToStaticMarkup(
      <CourseCoverFrame
        courseId="course-day-34"
        title="尚在生成的课程"
      />,
    );

    expect(markup).toContain("尚在生成的课程");
    expect(markup).not.toContain("<iframe");
  });
});
