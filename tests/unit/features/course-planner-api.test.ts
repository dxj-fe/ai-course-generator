import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateCoursePage,
  generateCoursePageHtml,
  planCourse,
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

  it("posts the prompt, trace id, and abort signal to the existing route", async () => {
    const payload = {
      traceId: "trace-planner",
      intent: {},
      state: { status: "completed", events: [], outline: {} },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      planCourse(
        { userPrompt: "为小学生生成一门太阳系课程" },
        { signal: controller.signal, traceId: "trace-planner" },
      ),
    ).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("/api/courses/plan");
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-trace-id": "trace-planner",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      userPrompt: "为小学生生成一门太阳系课程",
      traceId: "trace-planner",
    });
  });

  it("returns an HTTP 200 Agent failure for the controller to handle", async () => {
    const payload = {
      traceId: "trace-failed",
      intent: {},
      state: {
        status: "failed",
        events: [],
        error: { code: "AGENT_EXECUTION_ERROR", message: "Planner failed" },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      planCourse(
        { userPrompt: "生成课程" },
        { traceId: "trace-failed" },
      ),
    ).resolves.toEqual(payload);
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
      planCourse(
        { userPrompt: "生成课程" },
        { traceId: "trace-error" },
      ),
    ).rejects.toThrow(
      "[MODEL_CONFIG_ERROR] 缺少模型配置 traceId: trace-error",
    );
  });
});
