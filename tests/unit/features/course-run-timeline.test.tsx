import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CourseRunTimeline } from "../../../src/features/seaca/course-run-timeline";
import type { SeacaCourseRun } from "../../../src/types/seaca";
import {
  courseDesignIntent,
  courseDesignOutline,
} from "../../fixtures/course-design";

function createRun(): SeacaCourseRun {
  return {
    id: "run-day-18",
    prompt: "生成太阳系课程",
    traceId: "trace-day-18",
    startedAt: 0,
    planner: {
      status: "completed",
      events: [],
      data: {
        traceId: "trace-day-18",
        intent: courseDesignIntent,
        state: {
          status: "completed",
          events: [],
          outline: courseDesignOutline,
        },
      },
    },
    design: { status: "completed", events: [] },
    pageWrites: {},
    pageAssets: {},
    pageHtml: {},
    pageQa: {},
  };
}

describe("CourseRunTimeline", () => {
  it("does not present optional Page QA as a required Day 18 stage", () => {
    const markup = renderToStaticMarkup(<CourseRunTimeline run={createRun()} />);

    expect(markup).toContain("Page Writer");
    expect(markup).toContain("HTML Engineer");
    expect(markup).not.toContain("Page QA");
  });

  it("shows Page QA after the user starts that optional action", () => {
    const run = createRun();
    run.pageQa[courseDesignOutline.pages[0]!.id] = {
      status: "running",
      events: [],
    };

    const markup = renderToStaticMarkup(<CourseRunTimeline run={run} />);

    expect(markup).toContain("Page QA");
    expect(markup).toContain("进行中");
  });
});
