import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateCoursePage,
  generateCourseMvp,
  generateCoursePageAssets,
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

  it("posts one Day 18 course task and validates the shared workflow state", async () => {
    const payload = {
      courseId: "course-123e4567-e89b-42d3-a456-426614174000",
      traceId: "trace-course-mvp",
      state: {
        version: 1,
        courseId: "course-123e4567-e89b-42d3-a456-426614174000",
        traceId: "trace-course-mvp",
        userPrompt: "生成五页太阳系课程",
        status: "running",
        currentStage: "intent",
        pages: [],
        events: [],
        errors: [],
        startedAt: "2026-07-15T02:00:00.000Z",
        updatedAt: "2026-07-15T02:00:00.000Z",
      },
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
      generateCourseMvp(
        {
          courseId: payload.courseId,
          userPrompt: "生成五页太阳系课程",
          pageCount: 5,
        },
        { signal: controller.signal, traceId: payload.traceId },
      ),
    ).resolves.toEqual(payload);

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("/api/courses/generate");
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(String(init.body))).toEqual({
      courseId: payload.courseId,
      userPrompt: "生成五页太阳系课程",
      pageCount: 5,
      traceId: payload.traceId,
    });
  });

  it("rejects an invalid course workflow response before it reaches the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            courseId: "course-invalid",
            traceId: "trace-invalid",
            state: { status: "completed", events: [] },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      generateCourseMvp(
        { userPrompt: "生成课程" },
        { traceId: "trace-invalid" },
      ),
    ).rejects.toThrow("整课生成接口返回了无效状态");
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
      planCourse(
        { userPrompt: "生成课程" },
        { traceId: "trace-error" },
      ),
    ).rejects.toThrow(
      "[MODEL_CONFIG_ERROR] 缺少模型配置 traceId: trace-error",
    );
  });
});
