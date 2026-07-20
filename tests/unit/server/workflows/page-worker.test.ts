import { describe, expect, it, vi } from "vitest";

import {
  generatePageWorker,
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

describe("generatePageWorker", () => {
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

  it("classifies a Repair model timeout as a recoverable checkpoint error", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, {
      qaReports: [repairReport],
      repairFailure: "The operation was aborted due to timeout",
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

    expect(order).toEqual(["writer", "html", "qa", "repair"]);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "repair",
      error: {
        code: "REPAIR_TIMEOUT",
        message: "Repair 模型调用超时，请从断点继续重试。",
      },
    });
    expect(result.state.repairHistory?.[0]).toMatchObject({
      status: "failed",
      failureClass: "agent_failed",
    });
  });

  it("stops after two Repair rounds and preserves the final failing report", async () => {
    const order: string[] = [];
    const finalReport = QualityReportSchema.parse({
      ...repairReport,
      id: "quality-page-01-final-failure",
    });
    const dependencies = createDependencies(order, {
      qaReports: [repairReport, repairReport, finalReport],
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
        runtime: { traceId: "trace-page-repair-budget" },
        dependencies,
      },
    );

    expect(order.filter((stage) => stage === "repair")).toHaveLength(2);
    expect(result.state).toMatchObject({
      status: "failed",
      currentStage: "repair",
      qualityReport: { id: finalReport.id },
      error: { code: "REPAIR_BUDGET_EXHAUSTED" },
    });
    expect(result.state.repairHistory).toHaveLength(2);
  });
});

function createDependencies(
  order: string[],
  options: {
    htmlFailures?: number;
    qaReports?: QualityReport[];
    repairFailure?: string;
  } = {},
): PageWorkerDependencies {
  let htmlAttempt = 0;
  let qaAttempt = 0;
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
      return {
        status: "completed" as const,
        step: 1,
        maxSteps: 1,
        events: [event("writer completed")],
        task: input,
        content,
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
              html: `<!doctype html><html data-page-id="${page.id}"><body><h1>${page.title}</h1></body></html>`,
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
      if (options.repairFailure) {
        return {
          status: "failed" as const,
          step: 1,
          maxSteps: 1,
          events: [event("repair failed")],
          task: input,
          error: {
            code: "AGENT_EXECUTION_ERROR" as const,
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
