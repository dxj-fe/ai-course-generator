import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CourseLibrary } from "../../../src/features/keya/course-library";

describe("CourseLibrary", () => {
  it("keeps runtime implementation details out of the course filters", () => {
    const markup = renderToStaticMarkup(<CourseLibrary />);

    expect(markup).toContain("全部状态");
    expect(markup).not.toContain("全部运行源");
    expect(markup).not.toContain("LangGraph");
    expect(markup).not.toContain("Workflow");
  });
});
