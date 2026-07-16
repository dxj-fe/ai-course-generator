import { describe, expect, it, vi } from "vitest";

import {
  runCourseGenerationWorkflow,
  type CourseGenerationWorkflowDependencies,
} from "../../../../src/server/workflows/course-generation-workflow";
import type {
  AgentEvent,
  AgentRuntimeContext,
} from "../../../../src/server/agents/core/types";
import {
  AssetGenerationResultSchema,
  type AssetGenerationResult,
  type CourseGenerationState,
  type PageContentDSL,
  type PagePlan,
} from "../../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";

const context: AgentRuntimeContext = { traceId: "trace-course-mvp" };
const timestamp = "2026-07-15T02:00:00.000Z";

describe("course generation workflow", () => {
  it("serially generates every page and checkpoints validated partial state", async () => {
    const order: string[] = [];
    const checkpoints: CourseGenerationState[] = [];
    const dependencies = createDependencies(order, checkpoints);

    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-123e4567-e89b-42d3-a456-426614174000",
        userPrompt: "为 8 岁儿童生成三页太阳系课程",
        pageCount: 3,
      },
      context,
      dependencies,
    );

    expect(state.status).toBe("completed");
    expect(state.pages).toHaveLength(3);
    expect(state.pages.every(({ status }) => status === "completed")).toBe(true);
    expect(order).toEqual([
      "intent",
      "planner",
      "design",
      "writer:page-01-cover",
      "html:page-01-cover",
      "writer:page-02-knowledge",
      "html:page-02-knowledge",
      "writer:page-03-summary",
      "html:page-03-summary",
    ]);
    expect(checkpoints.some((saved) => saved.pages[0]?.status === "completed"))
      .toBe(true);
    expect(state.events.map(({ sequence }) => sequence)).toEqual(
      state.events.map((_, index) => index + 1),
    );
    expect(state.events.every((event) => !("data" in event))).toBe(true);
    expect(
      state.events.filter(({ type }) => type === "page_done").map(({ pageId }) => pageId),
    ).toEqual(courseDesignOutline.pages.map(({ id }) => id));
    expect(state.events.some(({ type }) => type === "agent_start")).toBe(true);
    expect(state.events.some(({ type }) => type === "agent_done")).toBe(true);
    expect(
      checkpoints.some((saved) =>
        saved.events.some(
          ({ type, stage }) => type === "agent_start" && stage === "planner",
        ),
      ),
    ).toBe(true);
  });

  it("stops on the failing page and preserves earlier completed HTML", async () => {
    const order: string[] = [];
    const checkpoints: CourseGenerationState[] = [];
    const dependencies = createDependencies(order, checkpoints, {
      failHtmlPageId: "page-02-knowledge",
    });

    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-223e4567-e89b-42d3-a456-426614174000",
        userPrompt: "生成一门可恢复的三页太阳系课程",
        pageCount: 3,
      },
      context,
      dependencies,
    );

    expect(state.status).toBe("failed");
    expect(state.currentStage).toBe("html");
    expect(state.currentPageId).toBe("page-02-knowledge");
    expect(state.pages.map(({ status }) => status)).toEqual([
      "completed",
      "failed",
      "pending",
    ]);
    expect(state.pages[0]?.htmlOutput?.html).toContain("page-01-cover");
    expect(state.pages[1]?.content?.pageId).toBe("page-02-knowledge");
    expect(order).not.toContain("writer:page-03-summary");
    expect(state.events.find(({ type }) => type === "error")).toMatchObject({
      type: "error",
      stage: "html",
      pageId: "page-02-knowledge",
      agent: "html-engineer",
    });
    expect(checkpoints.at(-1)?.status).toBe("failed");
  });

  it("retries a transient node failure at most twice and records each decision", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order, [], {
      transientHtmlFailures: { pageId: "page-01-cover", count: 2 },
    });
    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-623e4567-e89b-42d3-a456-426614174000",
        userPrompt: "生成一门允许有限重试的三页太阳系课程",
        pageCount: 3,
      },
      context,
      dependencies,
    );

    expect(state.status).toBe("completed");
    expect(
      order.filter((entry) => entry === "html:page-01-cover"),
    ).toHaveLength(3);
    expect(
      state.supervisor?.attempts.find(
        ({ nodeName, pageId }) =>
          nodeName === "html-engineer" && pageId === "page-01-cover",
      ),
    ).toMatchObject({ attempts: 3 });
    expect(
      state.events.filter(({ type }) => type === "supervisor_decision"),
    ).toHaveLength(state.supervisor?.decisionCount ?? 0);
    const pageAttempts = vi
      .mocked(dependencies.runHtml!)
      .mock.calls.filter(([input]) => input.content.pageId === "page-01-cover");
    expect(pageAttempts[0]?.[0].validationFeedback).toBeUndefined();
    expect(pageAttempts[1]?.[0].validationFeedback).toEqual({
      code: "AGENT_EXECUTION_ERROR",
      issues: ["页面正文缺少 DSL 文本：课程总结与后续展望"],
    });
  });

  it("stops after exhausting two retries for the same page and node", async () => {
    const order: string[] = [];
    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-723e4567-e89b-42d3-a456-426614174000",
        userPrompt: "生成一门重试预算受控的三页太阳系课程",
        pageCount: 3,
      },
      context,
      createDependencies(order, [], {
        transientHtmlFailures: { pageId: "page-01-cover", count: 3 },
      }),
    );

    expect(state.status).toBe("failed");
    expect(state.errors.at(-1)).toMatchObject({
      code: "SUPERVISOR_RETRY_EXHAUSTED",
      pageId: "page-01-cover",
    });
    expect(
      order.filter((entry) => entry === "html:page-01-cover"),
    ).toHaveLength(3);
    expect(state.supervisor?.lastDecision).toMatchObject({
      action: "stop",
      stopReason: { code: "retry_exhausted" },
    });
  });

  it("rejects a Supervisor target outside the available node allowlist", async () => {
    const order: string[] = [];
    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-823e4567-e89b-42d3-a456-426614174000",
        userPrompt: "验证 Supervisor 不能编造下一节点",
        pageCount: 3,
      },
      context,
      createDependencies(order, [], { invalidSupervisorTarget: true }),
    );

    expect(state.status).toBe("failed");
    expect(state.errors.at(-1)?.code).toBe("SUPERVISOR_INVALID_DECISION");
    expect(state.supervisor?.lastDecision).toMatchObject({
      action: "stop",
      stopReason: { code: "invalid_decision" },
    });
    expect(order).toEqual([]);
  });

  it("runs the Assets node for a real slot and passes its result to HTML", async () => {
    const order: string[] = [];
    const checkpoints: CourseGenerationState[] = [];
    const assetPageId = "page-01-cover";
    const assetResult = assetResultForPage(assetPageId);
    const dependencies = createDependencies(order, checkpoints, {
      assetPageId,
    });

    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-523e4567-e89b-42d3-a456-426614174000",
        userPrompt: "生成一门包含真实图片素材的三页太阳系课程",
        pageCount: 3,
      },
      context,
      dependencies,
    );

    expect(dependencies.runAssets).toHaveBeenCalledOnce();
    expect(dependencies.runAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          pageId: assetPageId,
          assetSlots: [expect.objectContaining({ id: "asset-slot-01" })],
        }),
      }),
      context,
    );
    expect(dependencies.runHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ pageId: assetPageId }),
        assets: [assetResult],
      }),
      context,
    );
    expect(order).toContain(`assets:${assetPageId}`);
    expect(state.pages[0]).toMatchObject({
      pageId: assetPageId,
      status: "completed",
      currentStage: "complete",
      assets: [assetResult],
    });
    expect(state.pages[0]?.htmlOutput?.html).toContain(assetResult.asset!.uri);
    expect(state.status).toBe("completed");
  });

  it("resumes from the failed stage without rerunning completed pages", async () => {
    const firstOrder: string[] = [];
    const failed = await runCourseGenerationWorkflow(
      {
        courseId: "course-323e4567-e89b-42d3-a456-426614174000",
        userPrompt: "生成一门可以断点续跑的太阳系课程",
        pageCount: 3,
      },
      context,
      createDependencies(firstOrder, [], {
        failHtmlPageId: "page-02-knowledge",
      }),
    );
    const resumedOrder: string[] = [];
    const resumedDependencies = createDependencies(resumedOrder, []);

    const resumed = await runCourseGenerationWorkflow(
      {
        courseId: failed.courseId,
        userPrompt: failed.userPrompt,
        pageCount: 3,
        existingState: failed,
      },
      { traceId: "trace-course-resume" },
      resumedDependencies,
    );

    expect(resumed.status).toBe("completed");
    expect(resumedOrder).toEqual([
      "html:page-02-knowledge",
      "writer:page-03-summary",
      "html:page-03-summary",
    ]);
    expect(resumed.pages.every(({ status }) => status === "completed")).toBe(
      true,
    );
    expect(resumed.errors).toEqual([]);
    expect(resumed.pages.every(({ error }) => error === undefined)).toBe(true);
    expect(
      vi.mocked(resumedDependencies.runHtml!).mock.calls[0]?.[0]
        .validationFeedback,
    ).toEqual({
      code: "SUPERVISOR_NON_RETRYABLE_ERROR",
      issues: ["页面正文缺少 DSL 文本：课程总结与后续展望"],
    });
    expect(resumed.events.map(({ sequence }) => sequence)).toEqual(
      resumed.events.map((_, index) => index + 1),
    );
  });

  it("maps an aborted page agent to a cancellable persisted state", async () => {
    const dependencies = createDependencies([], [], {
      abortWriterPageId: "page-01-cover",
    });

    const state = await runCourseGenerationWorkflow(
      {
        courseId: "course-423e4567-e89b-42d3-a456-426614174000",
        userPrompt: "生成后允许我取消的太阳系课程",
        pageCount: 3,
      },
      context,
      dependencies,
    );

    expect(state.status).toBe("cancelled");
    expect(state.pages[0]).toMatchObject({
      status: "failed",
      currentStage: "page_writer",
      error: { code: "AGENT_ABORTED" },
    });
    expect(state.errors.at(-1)).toMatchObject({
      stage: "page_writer",
      pageId: "page-01-cover",
      code: "AGENT_ABORTED",
    });
  });
});

function createDependencies(
  order: string[],
  checkpoints: CourseGenerationState[],
  options: {
    failHtmlPageId?: string;
    transientHtmlFailures?: { pageId: string; count: number };
    invalidSupervisorTarget?: boolean;
    abortWriterPageId?: string;
    assetPageId?: string;
  } = {},
): Partial<CourseGenerationWorkflowDependencies> {
  let eventSequence = 0;
  const htmlAttempts = new Map<string, number>();
  const nextEvent = (summary: string): AgentEvent => ({
    id: `event-${++eventSequence}`,
    sequence: eventSequence,
    type: "validation",
    traceId: context.traceId,
    timestamp,
    step: 1,
    summary,
    data: { private: "must-not-be-persisted" },
  });

  const runAssets = vi.fn(
    async (
      input: Parameters<CourseGenerationWorkflowDependencies["runAssets"]>[0],
    ): Promise<
      Awaited<ReturnType<CourseGenerationWorkflowDependencies["runAssets"]>>
    > => {
      order.push(`assets:${input.content.pageId}`);
      return {
        status: "completed",
        events: [nextEvent("assets completed")],
        results: [assetResultForPage(input.content.pageId)],
      };
    },
  );
  const runHtml = vi.fn(
    async (
      input: Parameters<CourseGenerationWorkflowDependencies["runHtml"]>[0],
    ): Promise<
      Awaited<ReturnType<CourseGenerationWorkflowDependencies["runHtml"]>>
    > => {
      order.push(`html:${input.content.pageId}`);
      const attempt = (htmlAttempts.get(input.content.pageId) ?? 0) + 1;
      htmlAttempts.set(input.content.pageId, attempt);
      const permanentlyFailed =
        options.failHtmlPageId === input.content.pageId;
      const transientlyFailed =
        options.transientHtmlFailures?.pageId === input.content.pageId &&
        attempt <= options.transientHtmlFailures.count;
      const failed = permanentlyFailed || transientlyFailed;
      const assetMarkup = (input.assets ?? [])
        .flatMap(({ asset }) =>
          asset?.uri ? [`<img src="${asset.uri}">`] : [],
        )
        .join("");
      return {
        status: failed ? "failed" : "completed",
        step: 1,
        maxSteps: 1,
        events: [nextEvent(failed ? "html failed" : "html completed")],
        task: input,
        htmlOutput: failed
          ? undefined
          : {
              html: `<!doctype html><html data-page-id="${input.content.pageId}"><body>${assetMarkup}</body></html>`,
              generatedAt: timestamp,
              version: 1,
            },
        error: failed
          ? {
              code: permanentlyFailed
                ? "HTML_CONTRACT_INVALID"
                : "AGENT_EXECUTION_ERROR",
              message:
                "生成 HTML 校验失败：页面正文缺少 DSL 文本：课程总结与后续展望",
            }
          : undefined,
      };
    },
  );

  return {
    now: () => timestamp,
    checkpoint: async (state) => {
      checkpoints.push(structuredClone(state));
    },
    runSupervisor: async (supervisorInput) => {
      if (supervisorInput.stateSummary.readyToComplete) {
        return {
          action: "complete" as const,
          reasonSummary: "全部课程页面已经完成，可以结束生成。",
        };
      }

      const available = supervisorInput.availableNodes[0];
      if (!available) {
        return {
          action: "stop" as const,
          reasonSummary: "没有可用节点，停止自动执行。",
          stopReason: {
            code: "no_available_node" as const,
            message: "没有可用节点。",
            recoverable: true,
          },
        };
      }

      if (supervisorInput.recentFailure) {
        return {
          action: "retry" as const,
          nextNode: available.target,
          retryTarget: available.target,
          reasonSummary: "最近节点执行失败且仍有预算，进行有限重试。",
        };
      }

      if (options.invalidSupervisorTarget) {
        return {
          action: "run" as const,
          nextNode: { nodeName: "planner" as const },
          reasonSummary: "尝试运行不在可用清单中的节点。",
        };
      }

      return {
        action: "run" as const,
        nextNode: available.target,
        reasonSummary: "当前节点输入已就绪，继续执行课程生成。",
      };
    },
    generateIntent: async () => {
      order.push("intent");
      return courseDesignIntent;
    },
    runPlanner: async (intent) => {
      order.push("planner");
      return {
        status: "completed",
        step: 1,
        maxSteps: 1,
        events: [nextEvent("planner completed")],
        task: { intent },
        outline: courseDesignOutline,
      };
    },
    runDesign: async () => {
      order.push("design");
      return {
        status: "completed",
        events: [
          { ...nextEvent("design completed"), agent: "visual" as const },
        ],
        briefs: { pedagogy: pedagogyPlan, story: storyArc, visual: visualBrief },
        pageWorkerBriefs: courseDesignOutline.pages.map((page, index) => ({
          pageId: page.id,
          styleTemplateId: page.styleTemplateId,
          pedagogy: pedagogyPlan.pageGuidance[index]!,
          story: storyArc.pageBeats[index]!,
          visual: visualBrief.pageGuidance[index]!,
        })),
      };
    },
    runPageWriter: async (input) => {
      order.push(`writer:${input.page.id}`);
      const aborted = options.abortWriterPageId === input.page.id;
      return {
        status: aborted ? "failed" : "completed",
        step: 1,
        maxSteps: 1,
        events: [nextEvent(aborted ? "writer aborted" : "writer completed")],
        task: input,
        content: aborted
          ? undefined
          : contentForPage(input.page, options.assetPageId === input.page.id),
        error: aborted
          ? { code: "AGENT_ABORTED", message: "Agent 执行已取消。" }
          : undefined,
      };
    },
    runAssets,
    runHtml,
  };
}

function contentForPage(
  page: PagePlan,
  includeAssetSlot = false,
): PageContentDSL {
  const interaction: PageContentDSL["interaction"] =
    page.interactionType === "reveal"
      ? {
          type: "reveal",
          prompt: "逐项查看本页的关键内容。",
          items: [
            {
              id: "item-01",
              label: "关键知识",
              content: "太阳是离地球最近的恒星。",
            },
          ],
        }
      : {
          type: "navigate",
          actionLabel: page.order === 3 ? "完成课程" : "继续学习",
          destination: page.order === 3 ? "course-home" : "next",
        };

  return {
    version: 1,
    pageId: page.id,
    functionalTemplateId: page.functionalTemplateId,
    title: page.title,
    narration: ["跟随页面提示完成今天的学习任务。"],
    blocks: [
      {
        id: `block-${page.order}`,
        kind: "concept",
        heading: page.title,
        body: page.contentSummary,
        supportingPoints: ["完成后继续进入下一页。"],
      },
    ],
    interaction,
    assetSlots: includeAssetSlot
      ? [
          {
            id: "asset-slot-01",
            type: "image",
            role: "hero",
            purpose: "展示太阳系主要天体的关系",
            required: true,
            altTextGuidance: "太阳与八大行星的太阳系示意图",
          },
        ]
      : [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "课程正文优先",
      groupingStrategy: "标题、正文和操作顺序排列",
      readingOrder: [`block-${page.order}`],
    },
  };
}

function assetResultForPage(pageId: string): AssetGenerationResult {
  return AssetGenerationResultSchema.parse({
    request: {
      assetSlotId: "asset-slot-01",
      assetType: "background",
      usage: "作为太阳系课程封面的主视觉素材",
      prompt: "绘制一幅适合儿童课程的太阳系科普插画，清楚展示太阳和八大行星",
      transparentBackground: false,
      safeArea: {
        position: "right",
        coveragePercent: 35,
        description: "右侧保留课程标题和导航按钮的文字安全区",
      },
      aspectRatio: "16:9",
    },
    status: "ready",
    asset: {
      id: `asset-${pageId}-01`,
      type: "image",
      role: "hero",
      source: "generated",
      status: "ready",
      uri: `https://assets.example.com/${pageId}/solar-system.webp`,
      altText: "太阳与八大行星的太阳系示意图",
      generationPrompt: "适合儿童课程的太阳系科普插画",
      mimeType: "image/webp",
      dimensions: { width: 1280, height: 720 },
      usedByPageIds: [pageId],
    },
    provider: "test-provider",
    model: "test-image-model",
    durationMs: 120,
  });
}
