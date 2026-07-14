import { afterEach, describe, expect, it, vi } from "vitest";

import { planCourse } from "../../../src/features/course-planner/lib/course-planner-api";

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
