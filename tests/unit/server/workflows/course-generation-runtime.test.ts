import { describe, expect, it } from "vitest";

import {
  failCourseGeneration,
  initializeCourseGenerationState,
  resolveCourseGenerationDependencies,
} from "../../../../src/server/workflows/course-generation-runtime";
import { CourseGenerationStateSchema } from "../../../../src/shared/course-schema";
import {
  courseDesignOutline,
  pageContentDsl,
} from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";
import { qualityReportWithIssue } from "../../../fixtures/quality-report";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";

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

  it("rechecks QA for the legacy unauthorized-issue Repair failure", () => {
    const existing = legacyRepairFailure();
    const pageId = existing.pages[0]!.pageId;
    const originalPage = structuredClone(existing.pages[0]!);
    existing.pages[0]!.error = {
      code: "REPAIR_FAILED",
      message: "RepairResult 引用了未授权的 issue code。",
    };
    existing.supervisor = {
      decisionCount: 8,
      attempts: [
        { nodeName: "intent", attempts: 1 },
        { nodeName: "page-worker", pageId, attempts: 1 },
        { nodeName: "repair", pageId, attempts: 2 },
        {
          nodeName: "page-worker",
          pageId: "page-other",
          attempts: 1,
        },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "页面 Repair 预算已耗尽。",
        stopReason: {
          code: "retry_exhausted",
          message: "页面 Repair 预算已耗尽。",
          recoverable: true,
        },
      },
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-unauthorized-repair-code" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      repairHistory: [],
    });
    expect(resumed.pages[0]?.content).toEqual(originalPage.content);
    expect(resumed.pages[0]?.assets).toEqual(originalPage.assets);
    expect(resumed.pages[0]?.htmlOutput).toEqual(originalPage.htmlOutput);
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 8,
      attempts: [
        { nodeName: "intent", attempts: 1 },
        {
          nodeName: "page-worker",
          pageId: "page-other",
          attempts: 1,
        },
      ],
      lastDecision: undefined,
    });
  });

  it("rearms a prior Repair candidate failure without discarding audit history", () => {
    const existing = legacyRepairFailure();
    existing.pages[0]!.error = {
      code: "REPAIR_FAILED",
      message: "Repair Agent 未返回有效候选。",
    };
    existing.supervisor = {
      decisionCount: 3,
      attempts: [
        {
          nodeName: "repair",
          pageId: existing.pages[0]!.pageId,
          attempts: 2,
        },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "旧 Repair 候选失败。",
        stopReason: {
          code: "retry_exhausted",
          message: "旧 Repair 候选失败。",
          recoverable: true,
        },
      },
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
      status: "running",
      currentStage: "repair",
      repairHistory: [{ round: 1 }, { round: 2 }],
    });
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 3,
      attempts: [],
      lastDecision: undefined,
    });
  });

  it("rearms a transient Repair execution failure on explicit resume", () => {
    const existing = legacyRepairFailure();
    const pageId = existing.pages[0]!.pageId;
    existing.pages[0]!.error = {
      code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
      causeCode: "TIMEOUT_ERROR",
      message: "Repair 连续 3 次执行未完成，可从检查点继续。",
    };
    existing.supervisor = {
      decisionCount: 6,
      attempts: [
        { nodeName: "intent", attempts: 1 },
        { nodeName: "repair", pageId, attempts: 3 },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "Repair 暂时无法继续。",
        stopReason: {
          code: "non_retryable_error",
          message: "Repair 暂时无法继续。",
          recoverable: true,
        },
      },
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-repair-execution" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "repair",
      repairHistory: [{ round: 1 }, { round: 2 }],
    });
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 6,
      attempts: [{ nodeName: "intent", attempts: 1 }],
      lastDecision: undefined,
    });
  });

  it("rechecks a fluid page that exhausted Repair against the delivered fitted canvas", () => {
    const existing = legacyRepairFailure();
    const page = existing.pages[0]!;
    const report = qualityReportWithIssue({
      code: "BROWSER_VERTICAL_OVERFLOW",
      dimension: "layoutQuality",
    });
    page.status = "failed";
    page.currentStage = "qa";
    page.htmlOutput = {
      ...page.htmlOutput!,
      html: page.htmlOutput!.html.replace(
        "<html",
        '<html data-keya-canvas-mode="fluid"',
      ),
    };
    page.qualityReport = report;
    page.repairHistory = Array.from({ length: 24 }, (_, index) => ({
      round: index + 1,
      sourceReport: report,
      targetArtifact: "html" as const,
      issueCodes: ["BROWSER_VERTICAL_OVERFLOW"],
      status: "failed" as const,
      changeSummary: [],
      failureClass: "agent_failed" as const,
      startedAt: timestamp,
      completedAt: timestamp,
    }));
    page.attempts = [
      { stage: "html", attempts: 1 },
      { stage: "qa", attempts: 1 },
    ];
    page.error = {
      code: "SUPERVISOR_DECISION_LIMIT",
      message: `页面 ${page.pageId} 的 Repair 已触发 24 次安全熔断上限。`,
    };
    existing.currentStage = "qa";
    existing.errors = [
      {
        stage: "qa",
        pageId: page.pageId,
        code: "SUPERVISOR_DECISION_LIMIT",
        message: page.error.message,
      },
    ];
    existing.supervisor = {
      decisionCount: 54,
      attempts: [
        { nodeName: "intent", attempts: 1 },
        { nodeName: "page-worker", pageId: page.pageId, attempts: 1 },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "旧截图口径耗尽 Repair。",
        stopReason: {
          code: "decision_limit",
          message: page.error.message,
          recoverable: true,
        },
      },
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-fitted-canvas-qa" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      repairHistory: [],
      attempts: [{ stage: "html", attempts: 1 }],
    });
    expect(resumed.pages[0]?.htmlOutput).toEqual(page.htmlOutput);
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 54,
      attempts: [{ nodeName: "intent", attempts: 1 }],
      lastDecision: undefined,
    });
  });

  it("rechecks QA for a persisted unlocatable visual-dominance report", () => {
    const existing = legacyRepairFailure();
    const originalPage = structuredClone(existing.pages[0]!);
    existing.pages[0]!.qualityReport = qualityReportWithIssue({
      code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
      dimension: "assetUsability",
    });
    existing.pages[0]!.error = {
      code: "REPAIR_TARGET_UNAVAILABLE",
      message:
        "QualityReport 要求修订，但没有可定位且受支持的 Repair issue。",
    };
    existing.supervisor = {
      decisionCount: 16,
      attempts: [
        {
          nodeName: "repair",
          pageId: existing.pages[0]!.pageId,
          attempts: 1,
        },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "Repair issue 无法定位。",
        stopReason: {
          code: "non_retryable_error",
          message: "Repair issue 无法定位。",
          recoverable: true,
        },
      },
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-visual-dominance" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      repairHistory: originalPage.repairHistory,
    });
    expect(resumed.pages[0]?.content).toEqual(originalPage.content);
    expect(resumed.pages[0]?.assets).toEqual(originalPage.assets);
    expect(resumed.pages[0]?.htmlOutput).toEqual(originalPage.htmlOutput);
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 16,
      attempts: [],
      lastDecision: undefined,
    });
  });

  it("rechecks QA for a stale transparency-capability-only repair failure", () => {
    const existing = legacyRepairFailure();
    const originalPage = structuredClone(existing.pages[0]!);
    existing.pages[0]!.qualityReport = qualityReportWithIssue({
      code: "ASSET_TRANSPARENCY_UNAVAILABLE",
      dimension: "assetUsability",
      selector: '[data-asset-slot-id="asset-slot-01"]',
    });
    existing.pages[0]!.error = {
      code: "REPAIR_TARGET_UNAVAILABLE",
      message:
        "素材 Provider 或素材可用性问题必须由 Assets 阶段处理，Repair 不伪造素材。",
    };
    existing.supervisor = {
      decisionCount: 18,
      attempts: [
        {
          nodeName: "repair",
          pageId: existing.pages[0]!.pageId,
          attempts: 1,
        },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "素材透明通道问题无法修复。",
        stopReason: {
          code: "non_retryable_error",
          message: "素材透明通道问题无法修复。",
          recoverable: true,
        },
      },
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-transparency-capability" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      repairHistory: originalPage.repairHistory,
    });
    expect(resumed.pages[0]?.content).toEqual(originalPage.content);
    expect(resumed.pages[0]?.assets).toEqual(originalPage.assets);
    expect(resumed.pages[0]?.htmlOutput).toEqual(originalPage.htmlOutput);
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 18,
      attempts: [],
      lastDecision: undefined,
    });
  });

  it("rechecks QA for the stale reveal-visibility model failure", () => {
    const existing = legacyRepairFailure();
    const originalPage = structuredClone(existing.pages[0]!);
    const report = qualityReportWithIssue({
      code: "INTERACTION_CONTENT_NOT_HIDDEN",
      dimension: "htmlRuntime",
    });
    existing.pages[0]!.qualityReport = {
      ...report,
      overallScore: 88,
      dimensions: {
        ...report.dimensions,
        courseCoherence: {
          score: 84,
          summary: "旁白与互动提示被误判为重复。",
          issueCodes: ["CONTENT_REDUNDANT"],
          repairHints: ["删除其中一项。"],
        },
        htmlRuntime: {
          score: 69,
          summary: "错误地要求 reveal 互动项初始隐藏。",
          issueCodes: ["INTERACTION_CONTENT_NOT_HIDDEN"],
          repairHints: ["隐藏互动项。"],
        },
      },
      issues: [
        {
          code: "INTERACTION_CONTENT_NOT_HIDDEN",
          dimension: "htmlRuntime",
          severity: "error",
          source: "model",
          message: "reveal 互动项初始可见。",
          location: {
            pageId: existing.pages[0]!.pageId,
            description: "可信 reveal runtime 的可见互动项",
          },
          repairHint: "隐藏互动项。",
        },
        {
          code: "CONTENT_REDUNDANT",
          dimension: "courseCoherence",
          severity: "warning",
          source: "model",
          message: "旁白与互动提示重复。",
          location: {
            pageId: existing.pages[0]!.pageId,
            description: "页面旁白与互动提示",
          },
          repairHint: "删除其中一项。",
        },
      ],
    };
    existing.pages[0]!.error = {
      code: "REPAIR_TARGET_UNAVAILABLE",
      message: "内容或教学问题没有可授权的 blockId，拒绝盲目重写 DSL。",
    };
    existing.supervisor = {
      decisionCount: 20,
      attempts: [
        {
          nodeName: "repair",
          pageId: existing.pages[0]!.pageId,
          attempts: 4,
        },
      ],
      lastDecision: {
        action: "stop",
        reasonSummary: "旧 QA issue 无法定位。",
        stopReason: {
          code: "non_retryable_error",
          message: "旧 QA issue 无法定位。",
          recoverable: true,
        },
      },
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-stale-reveal-qa" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      repairHistory: originalPage.repairHistory,
    });
    expect(resumed.pages[0]?.htmlOutput).toEqual(originalPage.htmlOutput);
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 20,
      attempts: [],
      lastDecision: undefined,
    });
  });

  it("removes stale contract-restored duplicates and resumes from QA", () => {
    const existing = legacyRepairFailure();
    const page = existing.pages[0]!;
    const body = "变量`name`的数据类型是`str`。";
    const content = {
      ...pageContentDsl,
      blocks: pageContentDsl.blocks.map((block, index) =>
        index === 0 ? { ...block, body } : block,
      ),
    };
    const report = qualityReportWithIssue({
      code: "CONTENT_DUPLICATION",
      dimension: "htmlRuntime",
      selector: '[data-block-id="block-01"]',
    });
    page.content = content;
    page.htmlOutput = {
      html: buildValidGeneratedHtml(content)
        .replace(
          body,
          "变量<code>name</code>的数据类型是<code>str</code>。",
        )
        .replace(
          "</article>",
          `<div data-course-contract-restored="block"><p>${body}</p></div></article>`,
        ),
      generatedAt: timestamp,
      version: 1,
    };
    page.qualityReport = report;
    page.error = {
      code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
      causeCode: "SCHEMA_ERROR",
      message:
        "Repair 连续返回相同错误：HTML patch 超出允许 selector scope：CONTENT_DUPLICATION。",
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-restored-duplication" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      htmlOutput: { version: 2 },
    });
    expect(resumed.pages[0]?.htmlOutput?.html).not.toContain(
      'data-course-contract-restored="block"',
    );
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
  });

  it("migrates a rearmed Python function graph page to a process primitive", () => {
    const existing = legacyRepairFailure();
    const page = existing.pages[0]!;
    const pagePlan = {
      ...courseDesignOutline.pages[1]!,
      title: "Python流程控制与函数",
      learningObjective: "掌握for循环、条件控制和def函数调用",
      contentSummary: "通过Python代码学习流程控制与函数。",
    };
    existing.outline = {
      ...courseDesignOutline,
      pages: courseDesignOutline.pages.map((candidate) =>
        candidate.id === page.pageId ? pagePlan : candidate,
      ),
    };
    page.status = "running";
    page.order = pagePlan.order;
    page.currentStage = "html";
    page.content = {
      ...pageContentDsl,
      version: 2,
      title: pagePlan.title,
      blocks: pageContentDsl.blocks.map((block, index) => ({
        ...block,
        heading: index === 0 ? "for循环遍历" : "def函数定义与调用",
        body:
          index === 0
            ? "使用for循环控制程序流程。"
            : "使用def定义函数并通过参数调用。",
      })),
      runtime: {
        runtimeVersion: 1,
        sceneKind: "demo",
        visualPrimitive: "function-graph",
        motionPlan: { intensity: "guided", cuePoints: [] },
        completionRule: {
          type: "interaction-complete",
          interactionId: `interaction-${page.pageId}`,
        },
      },
    };
    page.htmlOutput = undefined;
    page.qualityReport = undefined;
    page.attempts = [{ stage: "html", attempts: 3 }];
    page.error = undefined;
    existing.currentStage = "html";
    existing.currentPageId = page.pageId;
    existing.pages = existing.outline.pages.map((candidate) =>
      candidate.id === page.pageId
        ? page
        : {
            pageId: candidate.id,
            order: candidate.order,
            status: "pending" as const,
            currentStage: "page_writer" as const,
            assets: [],
          },
    );
    existing.errors = [];

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-python-primitive" },
      () => timestamp,
    );

    expect(resumed.pages[1]).toMatchObject({
      status: "running",
      currentStage: "html",
      content: {
        runtime: { visualPrimitive: "process" },
      },
    });
    expect(resumed.pages[1]?.attempts).toEqual([]);
    expect(resumed.pages[1]?.error).toBeUndefined();
  });

  it("migrates a legacy single-question marker that excludes its option controls", () => {
    const existing = legacyRepairFailure();
    const example = getFunctionalTemplateDslExample("interactive-quiz");
    if (!example || example.interaction.type !== "choice") {
      throw new Error("interactive-quiz fixture is required");
    }
    const pageId = existing.pages[0]!.pageId;
    const question = example.interaction.questions[0]!;
    const content = {
      ...example,
      version: 2 as const,
      pageId,
      interaction: {
        ...example.interaction,
        questions: [question],
      },
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "practice" as const,
        visualPrimitive: "none" as const,
        motionPlan: {
          intensity: "guided" as const,
          cuePoints: [],
        },
        completionRule: {
          type: "correct-answer" as const,
          interactionId: `interaction-${pageId}`,
        },
      },
    };
    const options = question.options
      .map(
        (option) =>
          `<li><input type="radio" value="${option.id}">${option.label}</li>`,
      )
      .join("");
    existing.pages[0]!.content = content;
    existing.pages[0]!.htmlOutput = {
      html: `<!doctype html><html><head><title>${content.title}</title></head><body><main data-page-id="${pageId}"><section data-interaction-type="choice" data-interaction-id="interaction-${pageId}"><div data-question-id="${question.id}">${question.prompt}</div><ul>${options}</ul><button data-runtime-submit="true">提交</button><p data-feedback-kind="success" hidden>${question.feedback.success}</p><p data-feedback-kind="retry" hidden>${question.feedback.retry}</p></section></main></body></html>`,
      generatedAt: timestamp,
      version: 1,
    };
    existing.pages[0]!.qualityReport = qualityReportWithIssue({
      code: "BROWSER_TOUCH_TARGET_UNDER_24",
      dimension: "htmlRuntime",
    });
    existing.pages[0]!.error = {
      code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
      causeCode: "SCHEMA_ERROR",
      message:
        "生成 HTML 校验失败：选项 option-01-01 必须绑定唯一 input value。",
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-choice-question-scope" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "running",
      currentStage: "qa",
      htmlOutput: { version: 2 },
    });
    expect(resumed.pages[0]?.htmlOutput?.html).toContain(
      `<section data-interaction-type="choice" data-interaction-id="interaction-${pageId}" data-question-id="${question.id}">`,
    );
    expect(resumed.pages[0]?.qualityReport).toBeUndefined();
    expect(resumed.pages[0]?.error).toBeUndefined();
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

  it.each(["QUOTA_ERROR", "AUTH_ERROR", "CONFIG_ERROR"] as const)(
    "rearms a non-repair page after the user resolves %s",
    (code) => {
      const base = legacyRepairFailure();
      const page = base.pages[0]!;
      const existing = CourseGenerationStateSchema.parse({
        ...base,
        currentStage: "html",
        pages: [
          {
            ...page,
            status: "failed",
            currentStage: "html",
            htmlOutput: undefined,
            qualityReport: undefined,
            repairHistory: undefined,
            attempts: [{ stage: "html", attempts: 1 }],
            error: {
              code,
              message: "模型服务外部条件尚未满足。",
            },
          },
        ],
        errors: [
          {
            stage: "html",
            pageId: page.pageId,
            code,
            message: "模型服务外部条件尚未满足。",
          },
        ],
      });

      const resumed = initializeCourseGenerationState(
        {
          courseId: existing.courseId,
          userPrompt: existing.userPrompt,
          existingState: existing,
        },
        { traceId: `trace-resume-${code.toLowerCase()}` },
        () => timestamp,
      );

      expect(resumed.errors).toEqual([]);
      expect(resumed.pages[0]).toMatchObject({
        status: "running",
        currentStage: "html",
        attempts: [],
      });
      expect(resumed.pages[0]?.error).toBeUndefined();
    },
  );

  it.each(["QUOTA_ERROR", "AUTH_ERROR", "CONFIG_ERROR"] as const)(
    "rearms a Repair page after the user resolves %s without discarding its audit history",
    (code) => {
      const existing = legacyRepairFailure();
      existing.pages[0]!.error = {
        code,
        message: "模型服务外部条件尚未满足。",
      };

      const resumed = initializeCourseGenerationState(
        {
          courseId: existing.courseId,
          userPrompt: existing.userPrompt,
          existingState: existing,
        },
        { traceId: `trace-resume-repair-${code.toLowerCase()}` },
        () => timestamp,
      );

      expect(resumed.pages[0]).toMatchObject({
        status: "running",
        currentStage: "repair",
        repairHistory: [{ round: 1 }, { round: 2 }],
      });
      expect(resumed.pages[0]?.error).toBeUndefined();
    },
  );

  it("resets page-scoped Supervisor attempts for every reopened page", () => {
    const base = legacyRepairFailure();
    const completedContent = {
      ...pageContentDsl,
      pageId: "page-completed",
    };
    const htmlContent = {
      ...pageContentDsl,
      pageId: "page-failed-html",
    };
    const existing = CourseGenerationStateSchema.parse({
      ...base,
      currentStage: "html",
      currentPageId: "page-failed-html",
      pages: [
        {
          pageId: completedContent.pageId,
          order: 1,
          status: "completed",
          currentStage: "complete",
          content: completedContent,
          assets: [],
          htmlOutput: {
            html: "<main>已完成页面</main>",
            generatedAt: timestamp,
            version: 1,
          },
        },
        {
          pageId: htmlContent.pageId,
          order: 2,
          status: "failed",
          currentStage: "html",
          content: htmlContent,
          assets: [],
          attempts: [{ stage: "html", attempts: 3 }],
          error: {
            code: "PAGE_WORKER_RETRY_EXHAUSTED",
            causeCode: "SCHEMA_ERROR",
            message: "页面内容校验失败。",
          },
        },
        {
          pageId: "page-failed-writer",
          order: 3,
          status: "failed",
          currentStage: "page_writer",
          assets: [],
          attempts: [{ stage: "page_writer", attempts: 1 }],
          error: {
            code: "AUTH_ERROR",
            message: "模型服务认证失败。",
          },
        },
      ],
      errors: [
        {
          stage: "html",
          pageId: htmlContent.pageId,
          code: "PAGE_WORKER_RETRY_EXHAUSTED",
          causeCode: "SCHEMA_ERROR",
          message: "页面内容校验失败。",
        },
        {
          stage: "page_writer",
          pageId: "page-failed-writer",
          code: "AUTH_ERROR",
          message: "模型服务认证失败。",
        },
      ],
      supervisor: {
        decisionCount: 23,
        attempts: [
          { nodeName: "intent", attempts: 1 },
          {
            nodeName: "page-worker",
            pageId: completedContent.pageId,
            attempts: 2,
          },
          {
            nodeName: "page-worker",
            pageId: htmlContent.pageId,
            attempts: 24,
          },
          {
            nodeName: "repair",
            pageId: htmlContent.pageId,
            attempts: 3,
          },
          {
            nodeName: "page-worker",
            pageId: "page-failed-writer",
            attempts: 7,
          },
        ],
        lastDecision: {
          action: "stop",
          reasonSummary: "部分页面暂时无法继续。",
          stopReason: {
            code: "non_retryable_error",
            message: "部分页面暂时无法继续。",
            recoverable: true,
          },
        },
      },
    });

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-multiple-pages" },
      () => timestamp,
    );

    expect(resumed.pages.map(({ status }) => status)).toEqual([
      "completed",
      "running",
      "running",
    ]);
    expect(resumed.pages[0]?.content).toEqual(completedContent);
    expect(resumed.pages[1]?.error).toMatchObject({
      code: "PAGE_WORKER_RETRY_EXHAUSTED",
    });
    expect(resumed.pages[2]?.error).toBeUndefined();
    expect(resumed.supervisor).toEqual({
      decisionCount: 23,
      attempts: [
        { nodeName: "intent", attempts: 1 },
        {
          nodeName: "page-worker",
          pageId: completedContent.pageId,
          attempts: 2,
        },
      ],
      lastDecision: undefined,
    });
  });

  it("keeps Repair safety-stop failures closed on explicit resume", () => {
    const existing = legacyRepairFailure();
    existing.pages[0]!.error = {
      code: "QUALITY_STALLED",
      message: "页面质量连续多轮没有改善。",
    };

    const resumed = initializeCourseGenerationState(
      {
        courseId: existing.courseId,
        userPrompt: existing.userPrompt,
        existingState: existing,
      },
      { traceId: "trace-resume-quality-stalled" },
      () => timestamp,
    );

    expect(resumed.pages[0]).toMatchObject({
      status: "failed",
      currentStage: "repair",
      error: { code: "QUALITY_STALLED" },
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

  it("preserves the concrete provider cause on the terminal page checkpoint", async () => {
    const existing = legacyRepairFailure();
    existing.status = "running";
    existing.pages[0]!.status = "running";
    existing.pages[0]!.currentStage = "qa";
    existing.pages[0]!.error = undefined;
    const checkpoints: typeof existing[] = [];
    const dependencies = resolveCourseGenerationDependencies({
      checkpoint: async (state) => {
        checkpoints.push(state);
      },
      now: () => timestamp,
    });

    const failed = await failCourseGeneration(
      existing,
      {
        stage: "qa",
        pageId: existing.pages[0]!.pageId,
        code: "PAGE_WORKER_RETRY_EXHAUSTED",
        causeCode: "RATE_LIMIT_ERROR",
        message: "模型服务请求过于频繁。",
      },
      { traceId: "trace-preserve-provider-cause" },
      dependencies,
    );

    expect(failed.pages[0]?.error).toEqual({
      code: "PAGE_WORKER_RETRY_EXHAUSTED",
      causeCode: "RATE_LIMIT_ERROR",
      message: "模型服务请求过于频繁。",
    });
    expect(failed.errors.at(-1)).toMatchObject({
      causeCode: "RATE_LIMIT_ERROR",
    });
    expect(checkpoints.at(-1)).toEqual(failed);
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
