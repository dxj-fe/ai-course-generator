import { describe, expect, it } from "vitest";

import {
  classifyPublicAgentError,
  sanitizePublicCourseState,
  sanitizePublicDiagnosticText,
  sanitizePublicErrorCode,
} from "../../../../src/server/course/projection/public-error";
import { encodeCourseTaskSseMessage } from "../../../../src/server/course/task/sse";
import type { CourseGenerationState } from "../../../../src/shared/course-schema";

const SECRET_TEXT =
  "Authorization: Bearer sk-live-SECRET MODEL_API_KEY=top-secret privatePrompt=system requestBody={raw}";

describe("course public error", () => {
  it("持久化前保留诊断 code/causeCode，但不保留 Provider 原始异常", () => {
    const error = Object.assign(new Error(SECRET_TEXT), {
      code: "AUTH_ERROR",
      status: 401,
      requestBodyValues: { prompt: "system" },
    });

    const classified = classifyPublicAgentError({ error });

    expect(classified).toEqual({
      code: "AUTH_ERROR",
      causeCode: "AUTH_ERROR",
      message: "模型服务认证失败，请检查访问权限后重试。",
    });
    expect(JSON.stringify(classified)).not.toMatch(
      /sk-live|top-secret|privatePrompt|requestBody/i,
    );
  });

  it("投影边界清洗历史事件、页面错误和课程终态错误", () => {
    const state: CourseGenerationState = {
      courseId: "course-public-error",
      traceId: "trace-public-error",
      userPrompt: "生成一门课程",
      status: "failed",
      currentStage: "qa",
      pages: [
        {
          pageId: "page-one",
          order: 1,
          status: "failed",
          currentStage: "qa",
          assets: [],
          error: {
            code: "AUTH_ERROR",
            causeCode: "AUTH_ERROR",
            message: SECRET_TEXT,
          },
        },
      ],
      events: [
        {
          id: "event-public-error",
          sequence: 1,
          type: "error",
          traceId: "trace-public-error",
          timestamp: "2026-07-29T08:00:00.000Z",
          step: 1,
          summary: SECRET_TEXT,
          stage: "qa",
          pageId: "page-one",
        },
      ],
      errors: [
        {
          stage: "qa",
          pageId: "page-one",
          code: "AUTH_ERROR",
          causeCode: "AUTH_ERROR",
          message: SECRET_TEXT,
        },
      ],
      startedAt: "2026-07-29T08:00:00.000Z",
      updatedAt: "2026-07-29T08:01:00.000Z",
      completedAt: "2026-07-29T08:01:00.000Z",
      durationMs: 60_000,
    };

    const sanitized = sanitizePublicCourseState(state);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toMatch(
      /sk-live|top-secret|privatePrompt|requestBody/i,
    );
    expect(sanitized.events[0]?.summary).toBe("课程生成进度已更新。");
    expect(sanitized.pages[0]?.error?.message).toBe(
      "页面生成失败，请根据错误码排查后重试。",
    );
    expect(sanitized.errors[0]).toMatchObject({
      code: "AUTH_ERROR",
      causeCode: "AUTH_ERROR",
      message: "课程生成失败，请根据错误码排查后重试。",
    });
  });

  it("清洗非法诊断字符串时不会返回空公开文案", () => {
    expect(
      sanitizePublicDiagnosticText("<script></script>", {
        fallback: "安全失败文案。",
        maxLength: 100,
      }),
    ).toBe("安全失败文案。");
    expect(
      classifyPublicAgentError({
        code: "Authorization: Bearer sk-secret",
      }).code,
    ).toBe("AGENT_EXECUTION_FAILED");
  });

  it.each([
    "sk-live-SECRET",
    "Authorization:Bearer-sk-live-SECRET",
    "API_KEY:top-secret",
  ])("拒绝 Provider code 中的凭据或私有字段：%s", (providerCode) => {
    const error = Object.assign(new Error("Provider 请求失败"), {
      code: providerCode,
      status: 401,
    });

    expect(classifyPublicAgentError({ error })).toEqual({
      code: "AUTH_ERROR",
      causeCode: "AUTH_ERROR",
      message: "模型服务认证失败，请检查访问权限后重试。",
    });
    expect(
      sanitizePublicErrorCode(providerCode, "COURSE_GENERATION_FAILED"),
    ).toBe("COURSE_GENERATION_FAILED");
  });

  it("非 allowlist 的 Provider 原码和不安全 fallback 都回退到稳定诊断码", () => {
    expect(
      sanitizePublicErrorCode(
        "provider_connection_failed",
        "sk-live-fallback-secret",
      ),
    ).toBe("AGENT_EXECUTION_FAILED");
    expect(sanitizePublicErrorCode("PAGE_FIX_FAILED")).toBe(
      "PAGE_FIX_FAILED",
    );
    expect(sanitizePublicErrorCode("PAGE_CONTENT_RETRY_EXHAUSTED")).toBe(
      "PAGE_CONTENT_RETRY_EXHAUSTED",
    );
  });

  it.each([
    "/app/src/provider.ts:12",
    "/opt/service/provider.js",
    "/etc/passwd",
    "/workspace/private/provider.ts:42",
  ])("隐藏任意 Unix 绝对路径：%s", (absolutePath) => {
    expect(
      sanitizePublicDiagnosticText(`Provider stack ${absolutePath}`, {
        fallback: "安全失败文案。",
        maxLength: 1_000,
      }),
    ).toBe("Provider stack [路径已隐藏]");
  });

  it("隐藏反引号路径和带 authority 的 file URL，同时保留普通 HTTPS 链接", () => {
    expect(
      sanitizePublicDiagnosticText(
        "Provider at `/opt/service/provider.js:7`；file:///etc/passwd；file://localhost/private/config；file://server/share/private.txt；https://example.com/help",
        {
          fallback: "安全失败文案。",
          maxLength: 1_000,
        },
      ),
    ).toBe(
      "Provider at `[路径已隐藏]`；[路径已隐藏]；[路径已隐藏]；[路径已隐藏]；https://example.com/help",
    );
  });

  it.each([
    "https://example.com/course/page?q=1",
    "http://localhost:3000/api/private",
    "input/output",
    "PAGE/FAILED",
  ])("不把 URL、普通斜杠词或错误码当成本地路径：%s", (text) => {
    expect(
      sanitizePublicDiagnosticText(text, {
        fallback: "安全失败文案。",
        maxLength: 1_000,
      }),
    ).toBe(text);
  });

  it("历史 CourseState 中的 Unix 路径经过最后防线后不会进入 SSE", () => {
    const state: CourseGenerationState = {
      courseId: "course-public-path",
      traceId: "trace-public-path",
      userPrompt: "生成一门课程",
      status: "failed",
      currentStage: "planner",
      pages: [],
      events: [
        {
          id: "event-public-path",
          sequence: 1,
          type: "error",
          traceId: "trace-public-path",
          timestamp: "2026-07-29T08:00:00.000Z",
          step: 1,
          summary:
            "Provider stack /app/src/provider.ts:12，文档 https://example.com/help/error",
          stage: "planner",
        },
      ],
      errors: [
        {
          stage: "planner",
          code: "MODEL_ERROR",
          causeCode: "MODEL_ERROR",
          message: "运行时文件 /opt/service/provider.js 调用失败",
        },
      ],
      startedAt: "2026-07-29T08:00:00.000Z",
      updatedAt: "2026-07-29T08:01:00.000Z",
      completedAt: "2026-07-29T08:01:00.000Z",
      durationMs: 60_000,
    };
    const publicState = sanitizePublicCourseState(state);
    const sse = encodeCourseTaskSseMessage({
      type: "terminal",
      taskId: "task-public-path",
      courseId: state.courseId,
      status: "failed",
      state: publicState,
    });

    expect(sse).not.toMatch(/\/app\/|\/opt\//);
    expect(sse).toContain("[路径已隐藏]");
    expect(sse).toContain("https://example.com/help/error");
    expect(sse).toContain('"code":"MODEL_ERROR"');
    expect(sse).toContain('"causeCode":"MODEL_ERROR"');
  });
});
