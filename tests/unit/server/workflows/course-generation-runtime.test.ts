import { describe, expect, it } from "vitest";

import { initializeCourseGenerationState } from "../../../../src/server/workflows/course-generation-runtime";
import { CourseGenerationStateSchema } from "../../../../src/shared/course-schema";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../../fixtures/quality-report";

const timestamp = "2026-07-22T12:00:00+08:00";

describe("initializeCourseGenerationState", () => {
  it("regenerates HTML for the legacy disabled-choice repair contract failure", () => {
    const existing = legacyRepairFailure();

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-disabled-choice" },
      () => timestamp,
    );

    expect(resumed.status).toBe("running");
    expect(resumed.errors).toEqual([]);
    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "html",
      repairHistory: [],
      error: {
        code: "HTML_ENGINEER_FAILED",
      },
    });
    expect(resumed.pages[0]?.htmlOutput).toBeUndefined();
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error?.message).toContain(
      "choice 互动的单选或复选控件不得包含 disabled 属性",
    );
  });

  it("does not restore repair budget for unrelated failures", () => {
    const existing = legacyRepairFailure();
    existing.pages[0]!.error = {
      code: "REPAIR_FAILED",
      message: "Repair Agent 未返回有效候选。",
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-unrelated-repair" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "failed",
      currentStage: "repair",
      repairHistory: [{ round: 1 }, { round: 2 }],
    });
  });

  it("rearms an exhausted non-repair page when the user explicitly resumes", () => {
    const base = legacyRepairFailure();
    const page = base.pages[0]!;
    const existing = CourseGenerationStateSchema.parse({
      ...base,
      currentStage: "html",
      pages: [
        {
          ...page,
          currentStage: "html",
          htmlOutput: undefined,
          qualityReport: undefined,
          repairHistory: undefined,
          attempts: [{ stage: "html", attempts: 3 }],
          error: {
            code: "PAGE_WORKER_RETRY_EXHAUSTED",
            message: "生成 HTML 校验失败：页面正文缺少 DSL 文本：数学定义",
          },
        },
      ],
      errors: [
        {
          stage: "html",
          pageId: page.pageId,
          code: "PAGE_WORKER_RETRY_EXHAUSTED",
          message: "生成 HTML 校验失败：页面正文缺少 DSL 文本：数学定义",
        },
      ],
    });

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-exhausted-html" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "html",
      attempts: [],
      error: { code: "PAGE_WORKER_RETRY_EXHAUSTED" },
    });
  });

  it("rearms a page stopped by the legacy oversized Supervisor summary", () => {
    const base = legacyRepairFailure();
    const page = base.pages[0]!;
    const legacyError = {
      code: "COURSE_TASK_EXECUTION_ERROR",
      message:
        '[\n  {\n    "path": [\n      "reasonSummary"\n    ],\n    "message": "Too big: expected string to have <=300 characters"\n  }\n]',
    };
    const existing = CourseGenerationStateSchema.parse({
      ...base,
      currentStage: "page_writer",
      pages: [
        {
          ...page,
          status: "failed",
          currentStage: "page_writer",
          content: undefined,
          htmlOutput: undefined,
          qualityReport: undefined,
          repairHistory: undefined,
          attempts: [{ stage: "page_writer", attempts: 3 }],
          error: legacyError,
        },
      ],
      errors: [{ stage: "page_writer", pageId: page.pageId, ...legacyError }],
    });

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-supervisor-summary" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "page_writer",
      attempts: [],
      error: legacyError,
    });
  });
});

function legacyRepairFailure() {
  const report = qualityReportWithIssue({
    code: "INTERACTIVE_OPTIONS_DISABLED",
    dimension: "htmlRuntime",
    selector: 'input[type="radio"][name^="question"]',
  });
  const repairHistory = [1, 2].map((round) => ({
    round,
    sourceReport: report,
    targetArtifact: "html" as const,
    issueCodes: ["INTERACTIVE_OPTIONS_DISABLED"],
    status: "failed" as const,
    changeSummary: [],
    failureClass: "agent_failed" as const,
    startedAt: timestamp,
    completedAt: timestamp,
  }));

  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: "course-disabled-choice-recovery",
    traceId: "trace-disabled-choice-failed",
    userPrompt: "生成一门集合基础课程",
    status: "failed",
    currentStage: "repair",
    currentPageId: pageContentDsl.pageId,
    pages: [
      {
        pageId: pageContentDsl.pageId,
        order: 1,
        status: "failed",
        currentStage: "repair",
        content: pageContentDsl,
        assets: [],
        htmlOutput: {
          html: buildValidGeneratedHtml(pageContentDsl),
          generatedAt: timestamp,
          version: 1,
        },
        qualityReport: report,
        repairHistory,
        attempts: [{ stage: "html", attempts: 1 }],
        error: {
          code: "REPAIR_FAILED",
          message:
            "HTML patch 的 search 必须在当前文档中唯一匹配：INTERACTIVE_OPTIONS_DISABLED。",
        },
      },
    ],
    events: [],
    errors: [
      {
        stage: "repair",
        pageId: pageContentDsl.pageId,
        code: "REPAIR_FAILED",
        message:
          "HTML patch 的 search 必须在当前文档中唯一匹配：INTERACTIVE_OPTIONS_DISABLED。",
      },
    ],
    supervisor: { decisionCount: 1, attempts: [] },
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}
