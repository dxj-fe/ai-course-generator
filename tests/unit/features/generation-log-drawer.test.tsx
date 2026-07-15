import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GenerationLogDrawer } from "../../../src/features/seaca/generation-log-drawer";
import type { CourseGenerationState } from "../../../src/shared/course-schema";
import type { SeacaCourseRun } from "../../../src/types/seaca";

function createRun(generation?: CourseGenerationState): SeacaCourseRun {
  return {
    id: "run-day-20",
    prompt: "PRIVATE_USER_PROMPT",
    traceId: "trace-current",
    startedAt: 0,
    generation,
    planner: { status: "completed", events: [] },
    design: { status: "completed", events: [] },
    pageWrites: {},
    pageAssets: {},
    pageHtml: {},
    pageQa: {},
  };
}

describe("GenerationLogDrawer", () => {
  it("sorts public events by sequence and renders only allowlisted fields", () => {
    const generation = {
      userPrompt: "PRIVATE_STATE_PROMPT",
      pages: [
        {
          htmlOutput: {
            html: "<p>PRIVATE_HTML_OUTPUT</p>",
          },
        },
      ],
      events: [
        {
          id: "event-2",
          sequence: 2,
          type: "agent_done",
          traceId: "trace-current",
          timestamp: "2026-07-15T02:00:02.000Z",
          step: 2,
          summary: "第二个公开摘要",
          stage: "html",
          pageId: "page-01",
          agent: "html-engineer",
          data: {
            systemPrompt: "PRIVATE_SYSTEM_PROMPT",
            reasoning: "PRIVATE_REASONING",
            snapshot: "PRIVATE_RAW_SNAPSHOT",
          },
        },
        {
          id: "event-1",
          sequence: 1,
          type: "agent_start",
          traceId: "trace-current",
          timestamp: "2026-07-15T02:00:01.000Z",
          step: 1,
          summary: "第一个公开摘要",
          stage: "html",
          pageId: "page-01",
          agent: "html-engineer",
          systemPrompt: "PRIVATE_EVENT_PROMPT",
        },
      ],
    } as unknown as CourseGenerationState;

    const markup = renderToStaticMarkup(
      <GenerationLogDrawer run={createRun(generation)} />,
    );

    expect(markup).toContain("2 条事件");
    expect(markup).toContain("第一个公开摘要");
    expect(markup).toContain("第二个公开摘要");
    expect(markup.indexOf("第一个公开摘要")).toBeLessThan(
      markup.indexOf("第二个公开摘要"),
    );
    expect(markup).toContain("html-engineer");
    expect(markup).toContain("page-01");
    expect(markup).not.toContain("PRIVATE_USER_PROMPT");
    expect(markup).not.toContain("PRIVATE_STATE_PROMPT");
    expect(markup).not.toContain("PRIVATE_HTML_OUTPUT");
    expect(markup).not.toContain("PRIVATE_SYSTEM_PROMPT");
    expect(markup).not.toContain("PRIVATE_REASONING");
    expect(markup).not.toContain("PRIVATE_RAW_SNAPSHOT");
    expect(markup).not.toContain("PRIVATE_EVENT_PROMPT");
  });

  it("uses native disclosure semantics and shows an empty state", () => {
    const markup = renderToStaticMarkup(<GenerationLogDrawer />);

    expect(markup).toContain("<details");
    expect(markup).toContain("<summary");
    expect(markup).toContain("0 条事件");
    expect(markup).toContain("暂无公开生成事件");
  });
});
