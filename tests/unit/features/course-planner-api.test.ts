import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateCoursePage,
  generateCoursePageAssets,
  generateCoursePageHtml,
} from "../../../src/features/course-planner/lib/course-planner-api";
import {
  courseDesignOutline,
  pageContentDsl,
  visualBrief,
} from "../../fixtures/course-design";

describe("course planner API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts only DSL and VisualBrief to the HTML Engineer route", async () => {
    const payload = {
      traceId: "trace-html",
      state: { status: "completed", events: [], htmlOutput: {} },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateCoursePageHtml(
      { content: pageContentDsl, visualBrief },
      { traceId: "trace-html" },
    );

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(endpoint).toBe("/api/pages/generate-html");
    expect(body).toEqual({
      content: pageContentDsl,
      visualBrief,
      traceId: "trace-html",
    });
    expect(body).not.toHaveProperty("userPrompt");
  });

  it("posts one page to the image asset workflow", async () => {
    const payload = {
      traceId: "trace-assets",
      state: { status: "completed", events: [], requests: [], results: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateCoursePageAssets(
      { content: pageContentDsl, visualBrief },
      { traceId: "trace-assets" },
    );

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("/api/pages/generate-assets");
    expect(JSON.parse(String(init.body))).toEqual({
      content: pageContentDsl,
      visualBrief,
      traceId: "trace-assets",
    });
  });

  it("posts the current artifact and neighboring context to Page QA", async () => {
    const payload = {
      traceId: "trace-qa",
      state: { status: "completed", events: [], report: {} },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await evaluateCoursePage(
      {
        page: courseDesignOutline.pages[1]!,
        content: pageContentDsl,
        html: "<!doctype html><html></html>",
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
          previousPage: courseDesignOutline.pages[0],
          nextPage: courseDesignOutline.pages[2],
        },
      },
      { traceId: "trace-qa" },
    );

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(endpoint).toBe("/api/pages/qa");
    expect(body).toMatchObject({
      page: courseDesignOutline.pages[1],
      content: pageContentDsl,
      visualBrief,
      traceId: "trace-qa",
    });
    expect(body).not.toHaveProperty("userPrompt");
  });

  it("turns a non-success API payload into a readable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "MODEL_CONFIG_ERROR",
            message: "缺少模型配置",
            traceId: "trace-error",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      generateCoursePageHtml(
        { content: pageContentDsl, visualBrief },
        { traceId: "trace-error" },
      ),
    ).rejects.toThrow(
      "[MODEL_CONFIG_ERROR] 缺少模型配置 traceId: trace-error",
    );
  });
});
