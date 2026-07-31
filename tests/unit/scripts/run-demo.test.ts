import { describe, expect, it } from "vitest";

import {
  buildDemoServerEnvironment,
  buildDemoTaskInput,
  findProviderConfigIssues,
  parseDemoCliOptions,
  parseCourseTaskSseFrame,
} from "../../../scripts/run-demo";

describe("Demo SSE parser", () => {
  it("ignores heartbeat frames", () => {
    expect(parseCourseTaskSseFrame(": ping")).toBeUndefined();
  });

  it("parses and validates a strict terminal frame", () => {
    const state = {
      courseId: "course-demo-terminal",
      traceId: "trace-demo-terminal",
      userPrompt: "生成一门固定 Demo 课程",
      status: "cancelled",
      currentStage: "intent",
      pages: [],
      events: [],
      errors: [
        {
          stage: "intent",
          code: "COURSE_TASK_CANCELLED",
          message: "课程生成已取消。",
        },
      ],
      startedAt: "2026-07-23T01:00:00.000Z",
      updatedAt: "2026-07-23T01:01:00.000Z",
      completedAt: "2026-07-23T01:01:00.000Z",
      durationMs: 60_000,
    };
    const message = {
      type: "terminal",
      taskId: "task-demo-terminal",
      courseId: state.courseId,
      status: "cancelled",
      state,
    };

    expect(
      parseCourseTaskSseFrame(
        `id: 0\nevent: terminal\ndata: ${JSON.stringify(message)}`,
      ),
    ).toEqual(message);
  });

  it("creates a structured 课程生成 input for the fixed demo", () => {
    const input = buildDemoTaskInput({
      id: "solar-system",
      name: "太阳系入门",
      prompt: "为 8–10 岁学生生成一门 5 页太阳系入门课程，并安排一次可观察练习。",
      pageCount: 5,
      expectedCourseRoles: [
        {
          label: "建立目标",
          allowedPageTypes: ["cover"],
          allowedInteractionTypes: ["navigate"],
        },
        {
          label: "解释概念",
          allowedPageTypes: ["knowledge_card"],
          allowedInteractionTypes: ["reveal"],
        },
        {
          label: "组织关系",
          allowedPageTypes: ["comparison"],
          allowedInteractionTypes: ["explore"],
        },
        {
          label: "检查理解",
          allowedPageTypes: ["quiz"],
          allowedInteractionTypes: ["choice"],
        },
        {
          label: "总结迁移",
          allowedPageTypes: ["summary"],
          allowedInteractionTypes: ["input"],
        },
      ],
      requiredConcepts: [
        { label: "太阳", anyOf: ["太阳"] },
        { label: "行星", anyOf: ["行星"] },
      ],
      quality: {
        minOverallScore: 85,
        minDimensionScore: 80,
        requireScreenshotEvidence: true,
      },
      manualReview: {
        minimumTotal: 24,
        minimumDimension: 3,
      },
    });

    expect(input).toMatchObject({
      executionMode: "parallel",
      concurrency: 1,
      creationBrief: {
        topic: "太阳系入门",
        sectionCount: 5,
        learningMode: "mixed",
        language: "zh-CN",
      },
    });
  });

  it("支持只运行一个固定案例", () => {
    expect(
      parseDemoCliOptions(["--case", "solar-system"]),
    ).toEqual({
      caseIds: ["solar-system"],
    });
    expect(() =>
      parseDemoCliOptions(["--case", "unknown-course"]),
    ).toThrow("未知固定 Demo");
  });

  it("rejects placeholder providers without exposing API keys", () => {
    const secret = "your_private_demo_key";
    const issues = findProviderConfigIssues([
      {
        label: "文本模型 strong",
        config: {
          apiKey: secret,
          baseURL: "https://your-model-endpoint/api",
          modelName: "your_model_name",
          providerName: "model-provider",
        },
      },
    ]);

    expect(issues).toEqual([
      "文本模型 strong 的 API Key 仍是占位值。",
      "文本模型 strong 的模型 ID 仍是占位值。",
      "文本模型 strong 的 Base URL 无效或仍是占位地址。",
    ]);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  it("uses polling for the in-project Demo build cache", () => {
    expect(
      buildDemoServerEnvironment("/workspace/project", {
        EXISTING_VALUE: "kept",
        NODE_ENV: "test",
        WATCHPACK_POLLING: "false",
      }),
    ).toMatchObject({
      EXISTING_VALUE: "kept",
      COURSE_TASK_STARTUP_RECOVERY: "0",
      NEXT_DIST_DIR: ".data/demo-next",
      PAGE_QA_SCREENSHOTS_ENABLED: "true",
      WATCHPACK_POLLING: "true",
    });
  });
});
