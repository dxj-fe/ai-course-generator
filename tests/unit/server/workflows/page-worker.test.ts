import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generatePageWorker,
  isPageWorkerRetryableError,
  type PageWorkerDependencies,
} from "../../../../src/server/workflows/page-worker";
import {
  PageGenerationStateSchema,
  QualityReportSchema,
  type PageContentDSL,
  type QualityReport,
} from "../../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import { DETERMINISTIC_PAGE_RENDERER_VERSION } from "../../../../src/server/html/deterministic-page-fallback";

const timestamp = "2026-07-16T08:00:00.000Z";
const page = courseDesignOutline.pages[0]!;
const brief = {
  pageId: page.id,
  styleTemplateId: page.styleTemplateId,
  pedagogy: pedagogyPlan.pageGuidance[0]!,
  story: storyArc.pageBeats[0]!,
  visual: visualBrief.pageGuidance[0]!,
};
const content: PageContentDSL = {
  version: 1,
  pageId: page.id,
  functionalTemplateId: page.functionalTemplateId,
  title: page.title,
  narration: ["开始太阳系探索。"],
  blocks: [
    {
      id: "block-01",
      kind: "concept",
      heading: page.title,
      body: page.contentSummary,
      supportingPoints: ["观察后继续学习。"],
    },
  ],
  interaction: {
    type: "navigate",
    actionLabel: "开始探索",
    destination: "next",
  },
  assetSlots: [],
  layoutHints: {
    contentDensity: "balanced",
    visualPriority: "正文优先",
    groupingStrategy: "标题与正文分组",
    readingOrder: ["block-01"],
  },
};
const report = QualityReportSchema.parse({
  id: "quality-page-01-cover",
  target: { type: "page", pageId: page.id },
  overallScore: 95,
  dimensions: {
    contentAccuracy: { score: 95, summary: "内容准确。" },
    layoutQuality: { score: 95, summary: "布局清楚。" },
    courseCoherence: { score: 95, summary: "课程连贯。" },
    styleConsistency: { score: 95, summary: "风格一致。" },
    htmlRuntime: { score: 95, summary: "运行正常。" },
    assetUsability: { score: 95, summary: "素材可用。" },
  },
  issues: [],
  shouldRepair: false,
  decision: "pass",
  createdAt: timestamp,
});
const repairReport = QualityReportSchema.parse({
  ...report,
  id: "quality-page-01-repair",
  overallScore: 68,
  dimensions: {
    ...report.dimensions,
    layoutQuality: {
      score: 68,
      summary: "页面发生横向溢出。",
    },
  },
  issues: [
    {
      code: "LAYOUT_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "model",
      message: "页面发生横向溢出。",
      location: {
        pageId: page.id,
        selector: "style",
        description: "页面样式",
      },
      repairHint: "限制页面宽度。",
    },
  ],
  shouldRepair: true,
  decision: "revise",
});
const viewportScaleReport = QualityReportSchema.parse({
  ...repairReport,
  id: "quality-page-01-viewport-scale",
  issues: [
    {
      code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: "页面为装入画布被整体缩放到约 52%。",
      location: {
        pageId: page.id,
        selector: "main[data-page-id]",
        viewport: "922x460",
        description: "被播放器整体缩小的课程主画布",
      },
      repairHint: "从可信 DSL 重建紧凑布局。",
    },
  ],
});
const visualDominanceReport = QualityReportSchema.parse({
  ...repairReport,
  id: "quality-page-01-visual-dominance",
  dimensions: {
    ...repairReport.dimensions,
    assetUsability: {
      score: 52,
      summary: "主视觉遮蔽了正文焦点。",
    },
  },
  issues: [
    {
      code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
      dimension: "assetUsability",
      severity: "error",
      source: "browser",
      message: "单个视觉素材占据约 100% 的首屏面积。",
      location: {
        pageId: page.id,
        selector: '[data-asset-slot-id="asset-slot-01"]',
        viewport: "922x460",
        description: "播放器首屏中占比最大的可见视觉素材",
      },
      repairHint: "从可信 DSL 重建构图，让正文和学习动作保持可见。",
    },
  ],
});
const compactPresentationWarningReport = QualityReportSchema.parse({
  ...report,
  id: "quality-page-01-compact-warning",
  overallScore: 91,
  dimensions: {
    ...report.dimensions,
    styleConsistency: {
      score: 80,
      summary: "仍可继续优化装饰层次。",
    },
  },
  issues: [
    {
      code: "STYLE_DECORATION_REFINEMENT",
      dimension: "styleConsistency",
      severity: "warning",
      source: "model",
      message: "装饰层次仍可继续优化。",
      location: {
        pageId: page.id,
        selector: "style",
        description: "紧凑页面视觉样式",
      },
      repairHint: "后续迭代中优化装饰细节。",
    },
  ],
  shouldRepair: true,
  decision: "revise",
});
const compactPresentationErrorReport = QualityReportSchema.parse({
  ...report,
  id: "quality-page-01-compact-error",
  overallScore: 86,
  dimensions: {
    ...report.dimensions,
    assetUsability: {
      score: 69,
      summary: "必需插图在首屏中面积过小。",
    },
  },
  issues: [
    {
      code: "BROWSER_VISUAL_TOO_SMALL",
      dimension: "assetUsability",
      severity: "error",
      source: "browser",
      message: "必需插图仅占首屏 4%，无法形成清晰视觉焦点。",
      location: {
        pageId: page.id,
        selector: '[data-asset-slot-id="asset-slot-01"]',
        description: "面积过小的必需视觉素材",
      },
      repairHint: "扩大素材容器并重新构图。",
    },
  ],
  shouldRepair: true,
  decision: "revise",
});

describe("generatePageWorker", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs one isolated Writer → Assets → HTML → QA pipeline", async () => {
    const order: string[] = [];
    const updates: string[] = [];
    const dependencies = createDependencies(order);

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
          nextPage: courseDesignOutline.pages[1],
        },
      },
      {
        runtime: { traceId: "trace-page-worker" },
        dependencies,
        onUpdate: ({ state }) => {
          updates.push(state.currentStage);
        },
      },
    );

    expect(order).toEqual(["writer", "html", "qa"]);
    expect(result.state).toMatchObject({
      pageId: page.id,
      status: "completed",
      currentStage: "complete",
      content,
      qualityReport: report,
    });
    expect(result.events.every((event) => event.pageId === page.id)).toBe(true);
    expect(result.events.at(-1)).toMatchObject({
      type: "page_done",
      stage: "qa",
    });
    expect(updates).toContain("qa");
  });

  it("rebuilds an over-scaled model page deterministically and does not let presentation-only warnings fail the course", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [viewportScaleReport, compactPresentationWarningReport],
    });

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-compact-rebuild" },
        dependencies,
      },
    );

    expect(order).toEqual(["writer", "html", "qa", "html", "qa"]);
    expect(dependencies.runHtml).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        renderMode: "deterministic",
        validationFeedback: expect.objectContaining({
          code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
        }),
      }),
      expect.objectContaining({ traceId: "trace-page-compact-rebuild" }),
    );
    expect(dependencies.runRepair).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      status: "completed",
      currentStage: "complete",
      qualityReport: {
        id: compactPresentationWarningReport.id,
        shouldRepair: true,
      },
    });
    expect(result.state.htmlOutput?.html).toContain(
      'data-keya-renderer="deterministic"',
    );
    expect(result.events.map(({ summary }) => summary)).toContain(
      "确定性紧凑页面已通过内容与运行时底线；剩余视觉建议已记录，但不再阻断整课生成。",
    );
  });

  it("rebuilds a model page deterministically before Repair when its visual fills the viewport", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [visualDominanceReport, report],
    });

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-visual-dominance-rebuild" },
        dependencies,
      },
    );

    expect(order).toEqual(["writer", "html", "qa", "html", "qa"]);
    expect(dependencies.runHtml).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        renderMode: "deterministic",
        validationFeedback: expect.objectContaining({
          code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
          issues: [
            expect.stringContaining("单个视觉素材占据约 100%"),
          ],
        }),
      }),
      expect.objectContaining({
        traceId: "trace-page-visual-dominance-rebuild",
      }),
    );
    expect(dependencies.runRepair).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      status: "completed",
      currentStage: "complete",
      qualityReport: { id: report.id },
    });
    expect(result.state.htmlOutput?.html).toContain(
      'data-keya-renderer="deterministic"',
    );
  });

  it.each([
    ["missing version", ""],
    [
      "outdated version",
      ` data-keya-renderer-version="${DETERMINISTIC_PAGE_RENDERER_VERSION - 1}"`,
    ],
  ])(
    "rebuilds a deterministic checkpoint with %s before Repair",
    async (_versionCase, rendererVersionAttribute) => {
      const order: string[] = [];
      const dependencies = createDependencies(order, {
        qaReports: [report],
      });
      const initialState = PageGenerationStateSchema.parse({
        pageId: page.id,
        order: page.order,
        status: "running",
        currentStage: "repair",
        content,
        assets: [],
        htmlOutput: {
          version: 8,
          generatedAt: timestamp,
          html: `<!doctype html><html data-page-id="${page.id}" data-keya-renderer="deterministic"${rendererVersionAttribute}><body><h1>${page.title}</h1></body></html>`,
        },
        qualityReport: viewportScaleReport,
        repairHistory: [
          {
            round: 1,
            sourceReport: viewportScaleReport,
            targetArtifact: "html",
            issueCodes: ["BROWSER_VIEWPORT_SCALE_TOO_SMALL"],
            status: "applied",
            changeSummary: ["旧版确定性页面曾尝试局部修复。"],
            resultReportId: viewportScaleReport.id,
            qualityProgress: "stalled",
            consecutiveNoProgress: 1,
            startedAt: timestamp,
            completedAt: timestamp,
          },
        ],
      });

      const result = await generatePageWorker(
        page,
        {
          intent: courseDesignIntent,
          brief,
          visualBrief,
          courseContext: {
            learningObjectives: courseDesignOutline.learningObjectives,
          },
        },
        {
          runtime: { traceId: "trace-page-stale-deterministic-rebuild" },
          dependencies,
          initialState,
        },
      );

      expect(order).toEqual(["html", "qa"]);
      expect(dependencies.runHtml).toHaveBeenCalledWith(
        expect.objectContaining({
          renderMode: "deterministic",
          validationFeedback: expect.objectContaining({
            code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
          }),
        }),
        expect.objectContaining({
          traceId: "trace-page-stale-deterministic-rebuild",
        }),
      );
      expect(dependencies.runRepair).not.toHaveBeenCalled();
      expect(result.state).toMatchObject({
        status: "completed",
        currentStage: "complete",
        qualityReport: { id: report.id },
        repairHistory: [],
      });
      expect(result.state.htmlOutput?.html).toContain(
        `data-keya-renderer-version="${DETERMINISTIC_PAGE_RENDERER_VERSION}"`,
      );
    },
  );

  it("does not rebuild a checkpoint produced by the current deterministic renderer", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [report],
    });
    const initialState = PageGenerationStateSchema.parse({
      pageId: page.id,
      order: page.order,
      status: "running",
      currentStage: "repair",
      content,
      assets: [],
      htmlOutput: {
        version: 2,
        generatedAt: timestamp,
        html: `<!doctype html><html data-page-id="${page.id}" data-keya-renderer="deterministic" data-keya-renderer-version="${DETERMINISTIC_PAGE_RENDERER_VERSION}"><body><h1>${page.title}</h1></body></html>`,
      },
      qualityReport: viewportScaleReport,
    });

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-current-deterministic-guard" },
        dependencies,
        initialState,
      },
    );

    expect(order).toEqual(["repair", "qa"]);
    expect(dependencies.runHtml).not.toHaveBeenCalled();
    expect(dependencies.runRepair).toHaveBeenCalledOnce();
    expect(result.state).toMatchObject({
      status: "completed",
      currentStage: "complete",
      qualityReport: { id: report.id },
    });
  });

  it("does not auto-publish a deterministic page with a presentation error", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [
        viewportScaleReport,
        compactPresentationErrorReport,
        report,
      ],
    });

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-presentation-error" },
        dependencies,
      },
    );

    expect(order).toEqual([
      "writer",
      "html",
      "qa",
      "html",
      "qa",
      "repair",
      "qa",
    ]);
    expect(dependencies.runRepair).toHaveBeenCalledWith(
      expect.objectContaining({
        issueCodes: ["BROWSER_VISUAL_TOO_SMALL"],
        targetArtifact: "html",
      }),
      expect.objectContaining({ traceId: "trace-page-presentation-error" }),
    );
    expect(result.state).toMatchObject({
      status: "completed",
      currentStage: "complete",
      qualityReport: { id: report.id, shouldRepair: false },
    });
  });

  it("resumes at HTML and forwards the persisted validation failure", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order);
    const initialState = PageGenerationStateSchema.parse({
      pageId: page.id,
      order: page.order,
      status: "failed",
      currentStage: "html",
      content,
      assets: [],
      error: {
        code: "HTML_CONTRACT_INVALID",
        message: "生成 HTML 校验失败：页面正文缺少 DSL 文本：太阳系探索启程",
      },
    });

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-resume" },
        dependencies,
        initialState,
      },
    );

    expect(order).toEqual(["html", "qa"]);
    expect(dependencies.runHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        validationFeedback: {
          code: "HTML_CONTRACT_INVALID",
          issues: ["页面正文缺少 DSL 文本：太阳系探索启程"],
        },
      }),
      expect.objectContaining({ traceId: "trace-page-resume" }),
    );
    expect(result.state.status).toBe("completed");
    expect(initialState.status).toBe("failed");
  });

  it("keeps retry attempts page-local and stops after three failures", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, { htmlFailures: 3 });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-retries" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "html")).toHaveLength(3);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "html",
      error: {
        code: "PAGE_WORKER_RETRY_EXHAUSTED",
        message: "生成 HTML 校验失败：缺少标题",
      },
    });
    expect(result.state.attempts).toContainEqual({
      stage: "html",
      attempts: 3,
    });
  });

  it("logs terminal stage failures with page context and the original stack", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order);
    const originalError = new Error("HTML renderer crashed");
    dependencies.runHtml = vi.fn().mockRejectedValue(originalError);

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-html-crash" },
        dependencies,
      },
    );

    expect(result.state.error?.code).toBe("PAGE_WORKER_RETRY_EXHAUSTED");
    expect(consoleError).toHaveBeenLastCalledWith(
      "[page-worker]",
      expect.objectContaining({
        event: "stage:failed",
        traceId: "trace-page-html-crash",
        pageId: page.id,
        stage: "html",
        attempt: 3,
        code: "PAGE_WORKER_RETRY_EXHAUSTED",
        message: "HTML renderer crashed",
        errorName: "Error",
        errorMessage: "HTML renderer crashed",
        errorStack: expect.stringContaining("HTML renderer crashed"),
      }),
    );
    const terminalLog = consoleError.mock.calls.at(-1)?.[1];
    expect(terminalLog).not.toHaveProperty("html");
    expect(terminalLog).not.toHaveProperty("prompt");
  });

  it("passes the previous Page Writer validation failure into the next attempt", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, { writerFailures: 1 });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-writer-feedback" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "writer")).toHaveLength(2);
    expect(dependencies.runPageWriter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ validationFeedback: undefined }),
      expect.anything(),
    );
    expect(dependencies.runPageWriter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        validationFeedback: {
          code: "SCHEMA_ERROR",
          issues: [
            "PageContentDSL 结构校验失败：interaction.questions.0.correctOptionIndex 越界",
          ],
        },
      }),
      expect.anything(),
    );
    expect(result.state.status).toBe("completed");
  });

  it.each([
    ["SCHEMA_ERROR", true],
    ["TIMEOUT_ERROR", true],
    ["RATE_LIMIT_ERROR", true],
    ["MODEL_ERROR", true],
    ["QUOTA_ERROR", false],
    ["AUTH_ERROR", false],
    ["CONFIG_ERROR", false],
  ])("classifies %s retryability as %s", (code, expected) => {
    expect(isPageWorkerRetryableError(code)).toBe(expected);
  });

  it("keeps the stable root cause when Page Writer retries are exhausted", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, { writerFailures: 3 });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-writer-exhausted" },
        dependencies,
      },
    );

    expect(result.state.error).toEqual({
      code: "PAGE_WORKER_RETRY_EXHAUSTED",
      causeCode: "SCHEMA_ERROR",
      message:
        "PageContentDSL 结构校验失败：interaction.questions.0.correctOptionIndex 越界",
    });
  });

  it("runs one targeted Repair round and re-QA before completing the page", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport, report],
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair" },
        dependencies,
      },
    );

    expect(order).toEqual(["writer", "html", "qa", "repair", "qa"]);
    expect(result.state.status).toBe("completed");
    expect(result.state.qualityReport?.decision).toBe("pass");
    expect(result.state.repairHistory).toHaveLength(1);
    expect(result.state.repairHistory?.[0]).toMatchObject({
      round: 1,
      targetArtifact: "html",
      status: "applied",
      resultReportId: report.id,
    });
    expect(result.events.map(({ type }) => type)).toContain("repair_attempt");
    expect(result.events.map(({ type }) => type)).toContain("repair_success");
  });

  it("pauses at QA so a graph condition can route one bounded Repair round", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport, report],
    });
    const handoff = {
      intent: courseDesignIntent,
      brief,
      visualBrief,
      courseContext: {
        learningObjectives: courseDesignOutline.learningObjectives,
      },
    };

    const paused = await generatePageWorker(page, handoff, {
      runtime: { traceId: "trace-page-graph-qa" },
      dependencies,
      maxRepairRoundsPerRun: 0,
    });

    expect(order).toEqual(["writer", "html", "qa"]);
    expect(paused.state).toMatchObject({
      status: "running",
      currentStage: "qa",
      qualityReport: { shouldRepair: true },
    });
    expect(paused.state.repairHistory ?? []).toHaveLength(0);

    const completed = await generatePageWorker(page, handoff, {
      runtime: { traceId: "trace-page-graph-repair" },
      dependencies,
      initialState: paused.state,
      maxRepairRoundsPerRun: 1,
    });

    expect(order).toEqual(["writer", "html", "qa", "repair", "qa"]);
    expect(completed.state).toMatchObject({
      status: "completed",
      currentStage: "complete",
      qualityReport: { shouldRepair: false },
    });
    expect(completed.state.repairHistory).toHaveLength(1);
  });

  it("retries transient Repair execution failures without counting quality iterations", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport, report],
      repairFailure: "The operation was aborted due to timeout",
      repairFailureCode: "TIMEOUT_ERROR",
      repairFailures: 2,
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair-timeout-recovery" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(3);
    expect(result.state.status).toBe("completed");
    expect(result.state.repairHistory?.map(({ status }) => status)).toEqual([
      "failed",
      "failed",
      "applied",
    ]);
    expect(
      result.state.repairHistory?.filter(({ resultReportId }) =>
        Boolean(resultReportId),
      ),
    ).toHaveLength(1);
  });

  it("retains a recoverable checkpoint after three transient Repair failures", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport],
      repairFailure: "The operation was aborted due to timeout",
      repairFailureCode: "TIMEOUT_ERROR",
      repairFailures: 3,
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair-timeout" },
        dependencies,
      },
    );

    expect(order).toEqual([
      "writer",
      "html",
      "qa",
      "repair",
      "repair",
      "repair",
    ]);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "repair",
      error: {
        code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
        causeCode: "TIMEOUT_ERROR",
      },
    });
    expect(result.state.repairHistory).toHaveLength(3);
    expect(
      result.state.repairHistory?.every(
        ({ status, failureClass, resultReportId }) =>
          status === "failed" &&
          failureClass === "agent_failed" &&
          !resultReportId,
      ),
    ).toBe(true);
  });

  it("stops repeating the same Repair contract failure after one recovery retry", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport],
      repairFailure: '结构化输出校验失败：root: Unrecognized key: "dsl"',
      repairFailureCode: "SCHEMA_ERROR",
      repairFailures: 3,
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair-schema-repeat" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(2);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "repair",
      error: {
        code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
        causeCode: "SCHEMA_ERROR",
      },
    });
    expect(result.state.error?.message).toContain("已停止无反馈重复请求");
    expect(result.state.repairHistory).toHaveLength(2);
  });

  it("stops after three successful but non-improving quality iterations", async () => {
    const order: string[] = [];
    const stalledReports = [1, 2, 3].map((iteration) =>
      QualityReportSchema.parse({
        ...repairReport,
        id: `quality-page-01-stalled-${iteration}`,
      }),
    );
    const dependencies = createDependencies(order, {
      qaReports: [repairReport, ...stalledReports],
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair-stalled" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(3);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "repair",
      qualityReport: { id: stalledReports[2]!.id },
      error: { code: "QUALITY_STALLED" },
    });
    expect(
      result.state.repairHistory?.map(
        ({ qualityProgress, consecutiveNoProgress }) => ({
          qualityProgress,
          consecutiveNoProgress,
        }),
      ),
    ).toEqual([
      { qualityProgress: "stalled", consecutiveNoProgress: 1 },
      { qualityProgress: "stalled", consecutiveNoProgress: 2 },
      { qualityProgress: "stalled", consecutiveNoProgress: 3 },
    ]);
  });

  it("stops after three repairs when browser blockers persist despite rising model scores", async () => {
    const order: string[] = [];
    const persistentBrowserReports = [52, 58, 64, 69].map(
      (layoutScore, iteration) =>
        QualityReportSchema.parse({
          ...viewportScaleReport,
          id: `quality-page-01-browser-blockers-${iteration}`,
          overallScore: layoutScore,
          dimensions: {
            ...viewportScaleReport.dimensions,
            layoutQuality: {
              score: layoutScore,
              summary: "模型评分波动，但固定视口仍有缩放和裁切。",
            },
          },
          issues: [
            viewportScaleReport.issues[0],
            {
              code: "BROWSER_CONTENT_CLIPPED",
              dimension: "layoutQuality",
              severity: "error",
              source: "browser",
              message: "2 个元素存在可测量的内容裁切。",
              location: {
                pageId: page.id,
                viewport: "922x460",
                description: "Playwright 固定视口渲染结果",
              },
              repairHint: "检查 overflow 与固定高度。",
            },
          ],
        }),
    );
    const dependencies = createDependencies(order, {
      qaReports: [viewportScaleReport, ...persistentBrowserReports],
    });

    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-browser-blockers-stalled" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(3);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "repair",
      qualityReport: { id: persistentBrowserReports[3]!.id },
      error: { code: "QUALITY_STALLED" },
    });
    expect(
      result.state.repairHistory?.map(
        ({ qualityProgress, consecutiveNoProgress }) => ({
          qualityProgress,
          consecutiveNoProgress,
        }),
      ),
    ).toEqual([
      { qualityProgress: "stalled", consecutiveNoProgress: 1 },
      { qualityProgress: "stalled", consecutiveNoProgress: 2 },
      { qualityProgress: "stalled", consecutiveNoProgress: 3 },
    ]);
  });

  it("allows more than three improving Repair iterations before passing", async () => {
    const order: string[] = [];
    const improvingReports = [72, 76, 80].map((overallScore) =>
      QualityReportSchema.parse({
        ...repairReport,
        id: `quality-page-01-improved-${overallScore}`,
        overallScore,
        dimensions: {
          ...repairReport.dimensions,
          layoutQuality: {
            score: overallScore,
            summary: "横向溢出逐步收敛。",
          },
        },
      }),
    );
    const dependencies = createDependencies(order, {
      qaReports: [repairReport, ...improvingReports, report],
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair-quality-first" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(4);
    expect(result.state.status).toBe("completed");
    expect(result.state.repairHistory).toHaveLength(4);
    expect(
      result.state.repairHistory?.every(
        ({ qualityProgress, consecutiveNoProgress }) =>
          qualityProgress === "improved" && consecutiveNoProgress === 0,
      ),
    ).toBe(true);
  });

  it("does not retry authentication or configuration failures", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport],
      repairFailure: "Repair model authentication failed.",
      repairFailureCode: "AUTH_ERROR",
      repairFailures: 3,
    });
    const result = await generatePageWorker(
      page,
      {
        intent: courseDesignIntent,
        brief,
        visualBrief,
        courseContext: {
          learningObjectives: courseDesignOutline.learningObjectives,
        },
      },
      {
        runtime: { traceId: "trace-page-repair-auth" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(1);
    expect(result.state.error?.code).toBe("AUTH_ERROR");
  });
});

function createDependencies(
  order: string[],
  options: {
    writerFailures?: number;
    htmlFailures?: number;
    qaReports?: QualityReport[];
    repairFailure?: string;
    repairFailureCode?:
      | "AGENT_EXECUTION_ERROR"
      | "AUTH_ERROR"
      | "CONFIG_ERROR"
      | "SCHEMA_ERROR"
      | "TIMEOUT_ERROR";
    repairFailures?: number;
  } = {},
): PageWorkerDependencies {
  let writerAttempt = 0;
  let htmlAttempt = 0;
  let qaAttempt = 0;
  let repairAttempt = 0;
  const event = (summary: string) => ({
    id: `event-${summary}`,
    sequence: 1,
    type: "validation" as const,
    traceId: "trace-page-worker",
    timestamp,
    step: 1,
    summary,
  });

  return {
    now: () => timestamp,
    runPageWriter: vi.fn(async (input) => {
      order.push("writer");
      writerAttempt += 1;
      const failed = writerAttempt <= (options.writerFailures ?? 0);
      return {
        status: failed ? ("failed" as const) : ("completed" as const),
        step: 1,
        maxSteps: 1,
        events: [event(failed ? "writer failed" : "writer completed")],
        task: input,
        content: failed ? undefined : content,
        error: failed
          ? {
              code: "SCHEMA_ERROR" as const,
              message:
                "PageContentDSL 结构校验失败：interaction.questions.0.correctOptionIndex 越界",
            }
          : undefined,
      };
    }),
    runAssets: vi.fn(async () => {
      order.push("assets");
      throw new Error("没有素材槽时不应调用素材工作流");
    }),
    runHtml: vi.fn(async (input) => {
      order.push("html");
      htmlAttempt += 1;
      const failed = htmlAttempt <= (options.htmlFailures ?? 0);
      return {
        status: failed ? ("failed" as const) : ("completed" as const),
        step: 1,
        maxSteps: 1,
        events: [event(failed ? "html failed" : "html completed")],
        task: input,
        htmlOutput: failed
          ? undefined
          : {
              version: 1 as const,
              generatedAt: timestamp,
              html: `<!doctype html><html data-page-id="${page.id}"${input.renderMode === "deterministic" ? ` data-keya-renderer="deterministic" data-keya-renderer-version="${DETERMINISTIC_PAGE_RENDERER_VERSION}"` : ""}><body><h1>${page.title}</h1></body></html>`,
            },
        error: failed
          ? {
              code: "AGENT_EXECUTION_ERROR" as const,
              message: "生成 HTML 校验失败：缺少标题",
            }
          : undefined,
      };
    }),
    runQA: vi.fn(async (input) => {
      order.push("qa");
      const nextReport = options.qaReports?.[qaAttempt] ?? report;
      qaAttempt += 1;
      return {
        status: "completed" as const,
        step: 1,
        maxSteps: 1,
        events: [event("qa completed")],
        task: input,
        report: nextReport,
      };
    }),
    runRepair: vi.fn(async (input) => {
      order.push("repair");
      repairAttempt += 1;
      if (
        options.repairFailure &&
        repairAttempt <= (options.repairFailures ?? Number.POSITIVE_INFINITY)
      ) {
        return {
          status: "failed" as const,
          step: 1,
          maxSteps: 1,
          events: [event("repair failed")],
          task: input,
          error: {
            code: options.repairFailureCode ?? ("AGENT_EXECUTION_ERROR" as const),
            message: options.repairFailure,
          },
        };
      }
      return {
        status: "completed" as const,
        step: 1,
        maxSteps: 1,
        events: [event("repair completed")],
        task: input,
        result: {
          kind: "html_patch_candidate" as const,
          pageId: input.pageId,
          targetArtifact: "html" as const,
          addressedIssueCodes: input.issueCodes,
          unresolvedIssueCodes: [],
          changeSummary: ["限制页面宽度。"],
          patches: [
            {
              issueCode: input.issueCodes[0]!,
              search: "body",
              replacement: "body",
              summary: "保持测试 HTML 并记录定向 patch。",
            },
          ],
        },
        repairedHtml: input.html,
      };
    }),
  };
}
