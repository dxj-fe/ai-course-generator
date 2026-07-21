import type { AgentEvent } from "../../src/server/agents/core/types";
import type { CourseGenerationWorkflowDependencies } from "../../src/server/workflows/course-generation-runtime";
import {
  PageContentDSLSchema,
  PageGenerationStateSchema,
  PageWorkerResultSchema,
  QualityReportSchema,
  type CourseDesignBriefs,
  type CourseGenerationState,
  type CourseIntent,
  type CoursePlan,
  type PagePlan,
  type PageWorkerEvent,
} from "../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "./course-design";

export const courseRuntimeTimestamp = "2026-07-21T02:00:00.000Z";

export type CourseRuntimeTestOptions = {
  failPlanner?: boolean;
  failPageId?: string;
  pageCount?: 3 | 5;
  repairRoundsByPageId?: Record<string, 0 | 1 | 2>;
};

export function createCourseRuntimeTestDependencies(
  order: string[],
  checkpoints: CourseGenerationState[],
  options: CourseRuntimeTestOptions = {},
): Partial<CourseGenerationWorkflowDependencies> {
  const intent = courseIntentFor(options.pageCount ?? 3);
  const outline = courseOutlineFor(options.pageCount ?? 3);
  const pageCalls = new Map<string, number>();
  let eventSequence = 0;
  const nextEvent = (summary: string): AgentEvent => ({
    id: `fixture-event-${++eventSequence}`,
    sequence: eventSequence,
    type: "validation",
    traceId: "trace-day-29",
    timestamp: courseRuntimeTimestamp,
    step: 1,
    summary,
    data: { private: "must-not-be-persisted" },
  });

  return {
    now: () => courseRuntimeTimestamp,
    checkpoint: async (state) => {
      checkpoints.push(structuredClone(state));
    },
    runSupervisor: async (input) => {
      if (input.stateSummary.readyToComplete) {
        return {
          action: "complete" as const,
          reasonSummary: "全部全局课程产物已经完成。",
        };
      }

      const available = input.availableNodes[0];
      if (!available) {
        return {
          action: "stop" as const,
          reasonSummary: "当前没有可执行节点。",
          stopReason: {
            code: "no_available_node" as const,
            message: "当前没有可执行节点。",
            recoverable: true,
          },
        };
      }

      if (input.recentFailure) {
        return {
          action: "retry" as const,
          nextNode: available.target,
          retryTarget: available.target,
          reasonSummary: "节点失败后在预算内重试。",
        };
      }

      return {
        action: "run" as const,
        nextNode: available.target,
        reasonSummary: "节点输入已满足，继续执行。",
      };
    },
    generateIntent: async () => {
      order.push("intent");
      return intent;
    },
    runPlanner: async (intent) => {
      order.push("planner");
      return {
        status: options.failPlanner ? ("failed" as const) : ("completed" as const),
        step: 1,
        maxSteps: 1,
        events: [nextEvent(options.failPlanner ? "planner failed" : "planner completed")],
        task: { intent },
        outline: options.failPlanner ? undefined : outline,
        error: options.failPlanner
          ? {
              code: "AGENT_EXECUTION_ERROR" as const,
              message: "Planner fixture failed.",
            }
          : undefined,
      };
    },
    runDesign: async ({ outline }) => {
      order.push("design");
      const briefs = designBriefsFor(outline);
      return {
        status: "completed" as const,
        events: [{ ...nextEvent("design completed"), agent: "visual" as const }],
        briefs,
        pageWorkerBriefs: outline.pages.map((page, index) => ({
          pageId: page.id,
          styleTemplateId: page.styleTemplateId,
          pedagogy: briefs.pedagogy.pageGuidance[index]!,
          story: briefs.story.pageBeats[index]!,
          visual: briefs.visual.pageGuidance[index]!,
        })),
      };
    },
    generatePage: async (page, _briefs, context) => {
      order.push(`worker:${page.id}`);
      const call = (pageCalls.get(page.id) ?? 0) + 1;
      pageCalls.set(page.id, call);
      const failed = options.failPageId === page.id;
      const requestedRepairRounds =
        options.repairRoundsByPageId?.[page.id] ?? 0;
      const shouldRepair = !failed && call <= requestedRepairRounds;
      const completedRepairRounds = Math.min(
        call - 1,
        requestedRepairRounds,
      );
      const content = contentForPage(page);
      const state = PageGenerationStateSchema.parse(
        failed
          ? {
              ...context.initialState,
              pageId: page.id,
              order: page.order,
              status: "failed",
              currentStage: "html",
              content,
              assets: [],
              attempts: [{ stage: "html" as const, attempts: 3 }],
              error: {
                code: "HTML_ENGINEER_FAILED",
                message: `页面 ${page.id} HTML 生成失败。`,
              },
            }
          : shouldRepair
            ? {
                ...context.initialState,
                pageId: page.id,
                order: page.order,
                status: "running",
                currentStage: "qa",
                content,
                assets: [],
                htmlOutput: htmlOutputForPage(page),
                qualityReport: repairReportForPage(page.id),
                repairHistory: repairHistoryForPage(
                  page.id,
                  completedRepairRounds,
                ),
                error: undefined,
              }
            : {
                ...context.initialState,
                pageId: page.id,
                order: page.order,
                status: "completed",
                currentStage: "complete",
                content,
                assets: [],
                htmlOutput: htmlOutputForPage(page),
                qualityReport: qualityReportForPage(page.id),
                repairHistory: repairHistoryForPage(
                  page.id,
                  completedRepairRounds,
                ),
                error: undefined,
              },
      );
      const events: PageWorkerEvent[] = [
        {
          type: failed ? "error" : shouldRepair ? "validation" : "page_done",
          stage: failed ? "html" : "qa",
          pageId: page.id,
          agent: failed
            ? "html-engineer"
            : shouldRepair
              ? "page-qa"
              : "page-worker",
          timestamp: courseRuntimeTimestamp,
          summary: failed
            ? `页面 ${page.id} HTML 生成失败。`
            : shouldRepair
              ? `页面 ${page.id} 需要第 ${completedRepairRounds + 1} 轮 Repair。`
              : `页面 ${page.id} 已完成。`,
        },
      ];
      await context.onUpdate?.({ state, events });
      return PageWorkerResultSchema.parse({ pageId: page.id, state, events });
    },
  };
}

function htmlOutputForPage(page: PagePlan) {
  return {
    version: 1 as const,
    html: `<!doctype html><html data-page-id="${page.id}"><body>${page.title}</body></html>`,
    generatedAt: courseRuntimeTimestamp,
  };
}

function repairHistoryForPage(pageId: string, rounds: number) {
  return Array.from({ length: rounds }, (_, index) => ({
    round: index + 1,
    sourceReport: repairReportForPage(pageId),
    targetArtifact: "html" as const,
    issueCodes: ["HTML_MAIN_MISSING"],
    status: "applied" as const,
    changeSummary: ["补充页面主内容语义。"],
    resultReportId: `quality-${pageId}-repair-${index + 1}`,
    startedAt: courseRuntimeTimestamp,
    completedAt: courseRuntimeTimestamp,
  }));
}

function courseIntentFor(pageCount: 3 | 5): CourseIntent {
  return pageCount === 3
    ? courseDesignIntent
    : { ...courseDesignIntent, courseLength: 5 };
}

function courseOutlineFor(pageCount: 3 | 5): CoursePlan {
  if (pageCount === 3) return courseDesignOutline;

  const [cover, knowledge, summary] = courseDesignOutline.pages;
  return {
    ...courseDesignOutline,
    overview: "通过五页观察、比较、练习和回顾认识太阳系基础结构。",
    pages: [
      cover!,
      knowledge!,
      {
        ...knowledge!,
        id: "page-03-comparison",
        order: 3,
        pageType: "comparison",
        title: "恒星与行星对比",
        interactionType: "explore",
        functionalTemplateId: "comparison-split",
        dependsOnPageIds: [knowledge!.id],
      },
      {
        ...knowledge!,
        id: "page-04-quiz",
        order: 4,
        pageType: "quiz",
        title: "太阳系知识练习",
        interactionType: "choice",
        functionalTemplateId: "quiz-choice",
        dependsOnPageIds: ["page-03-comparison"],
      },
      {
        ...summary!,
        id: "page-05-summary",
        order: 5,
        dependsOnPageIds: ["page-04-quiz"],
      },
    ],
  };
}

function designBriefsFor(outline: CoursePlan): CourseDesignBriefs {
  return {
    pedagogy: {
      ...pedagogyPlan,
      pageGuidance: outline.pages.map((page, index) => ({
        ...pedagogyPlan.pageGuidance[Math.min(index, 2)]!,
        pageId: page.id,
      })),
    },
    story: {
      ...storyArc,
      pageBeats: outline.pages.map((page, index) => ({
        ...storyArc.pageBeats[Math.min(index, 2)]!,
        pageId: page.id,
      })),
    },
    visual: {
      ...visualBrief,
      pageGuidance: outline.pages.map((page, index) => ({
        ...visualBrief.pageGuidance[Math.min(index, 2)]!,
        pageId: page.id,
      })),
    },
  };
}

function contentForPage(page: PagePlan) {
  return PageContentDSLSchema.parse({
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
    interaction:
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
        : page.interactionType === "explore"
          ? {
              type: "explore",
              prompt: "探索并比较两个太阳系对象。",
              items: [
                { id: "item-01", label: "恒星", content: "能够自己发光。" },
                { id: "item-02", label: "行星", content: "反射恒星的光。" },
              ],
            }
          : page.interactionType === "choice"
            ? {
                type: "choice",
                questions: [
                  {
                    id: "question-01",
                    prompt: "太阳属于哪一类天体？",
                    options: [
                      { id: "option-star", label: "恒星" },
                      { id: "option-planet", label: "行星" },
                    ],
                    correctOptionId: "option-star",
                    feedback: {
                      success: "正确，太阳会自己发光。",
                      retry: "再想想哪类天体会自己发光。",
                    },
                    maxAttempts: 2,
                  },
                ],
              }
            : {
                type: "navigate",
                actionLabel: page.pageType === "summary" ? "完成课程" : "继续学习",
                destination: page.pageType === "summary" ? "course-home" : "next",
              },
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "课程正文优先",
      groupingStrategy: "标题、正文和操作顺序排列",
      readingOrder: [`block-${page.order}`],
    },
  });
}

function qualityReportForPage(pageId: string) {
  return QualityReportSchema.parse({
    id: `quality-${pageId}`,
    target: { type: "page", pageId },
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
    createdAt: courseRuntimeTimestamp,
  });
}

function repairReportForPage(pageId: string) {
  return QualityReportSchema.parse({
    id: `quality-${pageId}-repair`,
    target: { type: "page", pageId },
    overallScore: 70,
    dimensions: {
      contentAccuracy: { score: 95, summary: "内容准确。" },
      layoutQuality: { score: 70, summary: "布局需要修订。" },
      courseCoherence: { score: 95, summary: "课程连贯。" },
      styleConsistency: { score: 95, summary: "风格一致。" },
      htmlRuntime: {
        score: 60,
        summary: "缺少主内容语义。",
        issueCodes: ["HTML_MAIN_MISSING"],
        repairHints: ["补充 main 元素。"],
      },
      assetUsability: { score: 95, summary: "素材可用。" },
    },
    issues: [
      {
        code: "HTML_MAIN_MISSING",
        dimension: "htmlRuntime",
        severity: "error",
        source: "heuristic",
        message: "页面缺少 main 元素。",
        location: {
          pageId,
          selector: "body",
          description: "页面正文根节点。",
        },
        repairHint: "补充 main 元素。",
      },
    ],
    shouldRepair: true,
    decision: "revise",
    createdAt: courseRuntimeTimestamp,
  });
}
