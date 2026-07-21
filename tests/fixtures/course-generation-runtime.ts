import type { AgentEvent } from "../../src/server/agents/core/types";
import type { CourseGenerationWorkflowDependencies } from "../../src/server/workflows/course-generation-runtime";
import {
  PageContentDSLSchema,
  PageGenerationStateSchema,
  PageWorkerResultSchema,
  QualityReportSchema,
  type CourseGenerationState,
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
};

export function createCourseRuntimeTestDependencies(
  order: string[],
  checkpoints: CourseGenerationState[],
  options: CourseRuntimeTestOptions = {},
): Partial<CourseGenerationWorkflowDependencies> {
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
      return courseDesignIntent;
    },
    runPlanner: async (intent) => {
      order.push("planner");
      return {
        status: options.failPlanner ? ("failed" as const) : ("completed" as const),
        step: 1,
        maxSteps: 1,
        events: [nextEvent(options.failPlanner ? "planner failed" : "planner completed")],
        task: { intent },
        outline: options.failPlanner ? undefined : courseDesignOutline,
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
      return {
        status: "completed" as const,
        events: [{ ...nextEvent("design completed"), agent: "visual" as const }],
        briefs: { pedagogy: pedagogyPlan, story: storyArc, visual: visualBrief },
        pageWorkerBriefs: outline.pages.map((page, index) => ({
          pageId: page.id,
          styleTemplateId: page.styleTemplateId,
          pedagogy: pedagogyPlan.pageGuidance[index]!,
          story: storyArc.pageBeats[index]!,
          visual: visualBrief.pageGuidance[index]!,
        })),
      };
    },
    generatePage: async (page, _briefs, context) => {
      order.push(`worker:${page.id}`);
      const failed = options.failPageId === page.id;
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
              error: {
                code: "HTML_ENGINEER_FAILED",
                message: `页面 ${page.id} HTML 生成失败。`,
              },
            }
          : {
              ...context.initialState,
              pageId: page.id,
              order: page.order,
              status: "completed",
              currentStage: "complete",
              content,
              assets: [],
              htmlOutput: {
                version: 1,
                html: `<!doctype html><html data-page-id="${page.id}"><body>${page.title}</body></html>`,
                generatedAt: courseRuntimeTimestamp,
              },
              qualityReport: qualityReportForPage(page.id),
              error: undefined,
            },
      );
      const events: PageWorkerEvent[] = [
        {
          type: failed ? "error" : "page_done",
          stage: failed ? "html" : "qa",
          pageId: page.id,
          agent: failed ? "html-engineer" : "page-worker",
          timestamp: courseRuntimeTimestamp,
          summary: failed
            ? `页面 ${page.id} HTML 生成失败。`
            : `页面 ${page.id} 已完成。`,
        },
      ];
      await context.onUpdate?.({ state, events });
      return PageWorkerResultSchema.parse({ pageId: page.id, state, events });
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
        : {
            type: "navigate",
            actionLabel: page.order === 3 ? "完成课程" : "继续学习",
            destination: page.order === 3 ? "course-home" : "next",
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
