import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import { runHtmlEngineerAgent } from "@/server/agents/html-engineer-agent";
import type { HtmlEngineerValidationFeedback } from "@/server/agents/html-engineer-agent";
import { runPageWriterAgent } from "@/server/agents/page-writer-agent";
import type {
  AgentEvent,
  AgentRuntimeContext,
} from "@/server/agents/core/types";
import {
  runCourseDesignWorkflow,
  type CourseDesignEvent,
} from "@/server/workflows/course-design-workflow";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import {
  WorkflowNodeError,
  type WorkflowNode,
  type WorkflowValue,
} from "@/server/workflows/sequential-workflow";
import {
  CourseIntentSchema,
  type CourseGenerationNodeName,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PageGenerationState,
} from "@/shared/course-schema";

export type CourseMvpPageCount = 3 | 4 | 5;

export type { CourseGenerationNodeName } from "@/shared/course-schema";

export type CourseGenerationNodeDependencies = {
  generateIntent: typeof generateCourseIntent;
  runPlanner: typeof runCoursePlannerAgent;
  runDesign: typeof runCourseDesignWorkflow;
  runPageWriter: typeof runPageWriterAgent;
  runAssets: typeof runImageAssetWorkflow;
  runHtml: typeof runHtmlEngineerAgent;
};

export type CourseGenerationNodeContext = {
  runtime: AgentRuntimeContext;
  pageCount?: CourseMvpPageCount;
  dependencies: CourseGenerationNodeDependencies;
  retryFeedback?: {
    nodeName: CourseGenerationNodeName;
    code: string;
    message: string;
  };
};

export type CourseGenerationNodeEvent = Pick<
  CourseGenerationPublicEvent,
  "type" | "summary"
> &
  Partial<
    Pick<
      CourseGenerationPublicEvent,
      "agent" | "step" | "timestamp"
    >
  >;

export type CourseGenerationNode = WorkflowNode<
  CourseGenerationState,
  CourseGenerationNodeContext,
  CourseGenerationNodeEvent,
  CourseGenerationNodeName
> & {
  stage: CourseGenerationStage;
  agent: string;
  pageId?: string;
  startSummary(state: CourseGenerationState): string;
  doneSummary(state: CourseGenerationState): string;
  afterDoneEvents?(
    state: CourseGenerationState,
  ): readonly CourseGenerationNodeEvent[];
};

/** 节点失败只携带公开安全事件，不保留 Agent 原始 data。 */
export class CourseGenerationNodeError extends WorkflowNodeError<CourseGenerationNodeName> {
  constructor(
    nodeName: CourseGenerationNodeName,
    code: string,
    message: string,
    readonly events: readonly CourseGenerationNodeEvent[] = [],
  ) {
    super(nodeName, code, message);
    this.name = "CourseGenerationNodeError";
  }
}

export function createIntentNode(): CourseGenerationNode {
  return {
    name: "intent",
    stage: "intent",
    agent: "intent",
    requiredInputs: [
      value("userPrompt", "userPrompt", (state) => state.userPrompt),
    ],
    produces: [
      value("intent", "intent", (state) => state.intent),
      value("currentStage", "planner stage", (state) =>
        state.currentStage === "planner" ? state.currentStage : undefined,
      ),
    ],
    startSummary: () => "Intent Agent 已开始理解课程需求。",
    doneSummary: () => "Intent Agent 已完成课程需求解析。",
    async run(state, context) {
      try {
        if (context.runtime.abortSignal?.aborted) {
          throw new CourseGenerationNodeError(
            "intent",
            "WORKFLOW_ABORTED",
            "课程生成已取消。",
          );
        }

        const generatedIntent = await context.dependencies.generateIntent({
          abortSignal: context.runtime.abortSignal,
          traceId: context.runtime.traceId,
          userPrompt: state.userPrompt,
        });
        const courseLength =
          context.pageCount ??
          (Math.min(
            5,
            Math.max(3, generatedIntent.courseLength),
          ) as CourseMvpPageCount);
        const intent = CourseIntentSchema.parse({
          ...generatedIntent,
          courseLength,
        });

        return {
          patch: { intent, currentStage: "planner" },
          events: [
            {
              type: "validation" as const,
              summary: `课程意图已校验，MVP 固定生成 ${intent.courseLength} 页。`,
            },
          ],
        };
      } catch (error) {
        if (error instanceof CourseGenerationNodeError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new CourseGenerationNodeError(
            "intent",
            "WORKFLOW_ABORTED",
            "课程生成已取消。",
          );
        }
        throw new CourseGenerationNodeError(
          "intent",
          "WORKFLOW_EXECUTION_ERROR",
          error instanceof Error ? error.message : "课程生成出现未知错误。",
        );
      }
    },
  };
}

export function createPlannerNode(): CourseGenerationNode {
  return {
    name: "planner",
    stage: "planner",
    agent: "planner",
    requiredInputs: [value("intent", "intent", (state) => state.intent)],
    produces: [
      value("outline", "outline", (state) => state.outline),
      value("currentStage", "design stage", (state) =>
        state.currentStage === "design" ? state.currentStage : undefined,
      ),
    ],
    startSummary: () => "Course Planner 已开始规划课程页面。",
    doneSummary: (state) =>
      `Course Planner 已完成 ${requireValue(state.outline, "outline").pages.length} 页课程规划。`,
    async run(state, context) {
      const plannerState = await context.dependencies.runPlanner(
        requireValue(state.intent, "intent"),
        context.runtime,
      );
      const events = projectAgentEvents(plannerState.events);

      if (plannerState.status !== "completed" || !plannerState.outline) {
        throw new CourseGenerationNodeError(
          "planner",
          plannerState.error?.code ?? "PLANNER_FAILED",
          plannerState.error?.message ?? "Course Planner 未生成有效课程结构。",
          events,
        );
      }

      return {
        patch: { outline: plannerState.outline, currentStage: "design" },
        events,
      };
    },
  };
}

export function createCourseDesignNode(): CourseGenerationNode {
  return {
    name: "course-design",
    stage: "design",
    agent: "course-design",
    requiredInputs: [
      value("intent", "intent", (state) => state.intent),
      value("outline", "outline", (state) => state.outline),
    ],
    produces: [
      value("briefs", "briefs", (state) => state.briefs),
      value(
        "pageWorkerBriefs",
        "pageWorkerBriefs",
        (state) => state.pageWorkerBriefs,
      ),
      value("pages", "pages", (state) =>
        state.pages.length > 0 ? state.pages : undefined,
      ),
      value("currentStage", "page_writer stage", (state) =>
        state.currentStage === "page_writer"
          ? state.currentStage
          : undefined,
      ),
    ],
    startSummary: () => "课程专业设计工作流已开始。",
    doneSummary: () => "教学、故事与视觉设计已完成。",
    async run(state, context) {
      const designState = await context.dependencies.runDesign(
        {
          intent: requireValue(state.intent, "intent"),
          outline: requireValue(state.outline, "outline"),
        },
        context.runtime,
      );
      const events = projectDesignEvents(designState.events);

      if (
        designState.status !== "completed" ||
        !designState.briefs ||
        !designState.pageWorkerBriefs
      ) {
        throw new CourseGenerationNodeError(
          "course-design",
          designState.error?.code ?? "COURSE_DESIGN_FAILED",
          designState.error?.message ?? "专业设计工作流未生成有效结果。",
          events,
        );
      }

      const outline = requireValue(state.outline, "outline");
      return {
        patch: {
          briefs: designState.briefs,
          pageWorkerBriefs: designState.pageWorkerBriefs,
          pages: outline.pages.map((page) => ({
            pageId: page.id,
            order: page.order,
            status: "pending" as const,
            currentStage: "page_writer" as const,
            assets: [],
            attempts: [],
          })),
          currentStage: "page_writer",
        },
        events,
      };
    },
  };
}

export function createPageWriterNode(pageId: string): CourseGenerationNode {
  return {
    name: "page-writer",
    stage: "page_writer",
    agent: "page-writer",
    pageId,
    requiredInputs: pageRequirements(pageId, [
      value("intent", "intent", (state) => state.intent),
      value("outline", "page plan", (state) => findPagePlan(state, pageId)),
      value("pageWorkerBriefs", "page worker brief", (state) =>
        findPageBrief(state, pageId),
      ),
    ]),
    produces: [
      value("pages", "page content", (state) =>
        getPage(state, pageId)?.content,
      ),
      value("pages", "page assets stage", (state) =>
        getPage(state, pageId)?.currentStage === "assets"
          ? "assets"
          : undefined,
      ),
    ],
    startSummary: (state) =>
      `Page Writer 已开始生成第 ${requirePagePlan(state, pageId).order} 页内容。`,
    doneSummary: (state) =>
      `第 ${requirePagePlan(state, pageId).order} 页 PageContentDSL 已生成。`,
    async run(state, context) {
      const page = requirePagePlan(state, pageId);
      const writerState = await context.dependencies.runPageWriter(
        {
          intent: requireValue(state.intent, "intent"),
          page,
          brief: requirePageBrief(state, pageId),
        },
        context.runtime,
      );
      const events = projectAgentEvents(writerState.events);

      if (writerState.status !== "completed" || !writerState.content) {
        throw new CourseGenerationNodeError(
          "page-writer",
          writerState.error?.code ?? "PAGE_WRITER_FAILED",
          writerState.error?.message ??
            `页面 ${pageId} 未生成有效 PageContentDSL。`,
          events,
        );
      }

      return {
        patch: {
          pages: updatePage(state, pageId, (pageState) => ({
            ...pageState,
            content: writerState.content,
            currentStage: "assets",
          })),
        },
        events,
      };
    },
  };
}

export function createAssetsNode(pageId: string): CourseGenerationNode {
  return {
    name: "assets",
    stage: "assets",
    agent: "image-assets",
    pageId,
    requiredInputs: pageRequirements(pageId, [
      value("pages", "page content", (state) => getPage(state, pageId)?.content),
      value("briefs", "visual brief", (state) => state.briefs?.visual),
    ]),
    produces: [
      value("pages", "page assets", (state) => getPage(state, pageId)?.assets),
      value("pages", "page html stage", (state) =>
        getPage(state, pageId)?.currentStage === "html"
          ? "html"
          : undefined,
      ),
    ],
    startSummary: (state) =>
      `第 ${requirePagePlan(state, pageId).order} 页素材解析已开始。`,
    doneSummary: (state) =>
      `第 ${requirePagePlan(state, pageId).order} 页素材解析已完成。`,
    async run(state, context) {
      const page = requirePage(state, pageId);
      const content = requireValue(page.content, "page content");
      let assets = page.assets;
      let events: CourseGenerationNodeEvent[];

      if (content.assetSlots.length === 0) {
        assets = [];
        events = [
          {
            type: "validation",
            summary: "当前页面没有素材槽，素材阶段已确定性跳过。",
          },
        ];
      } else {
        const assetState = await context.dependencies.runAssets(
          {
            content,
            visualBrief: requireValue(state.briefs?.visual, "visual brief"),
          },
          context.runtime,
        );
        events = projectAgentEvents(assetState.events);

        if (assetState.status !== "completed" || !assetState.results) {
          throw new CourseGenerationNodeError(
            "assets",
            assetState.error?.code ?? "IMAGE_ASSETS_FAILED",
            assetState.error?.message ??
              `页面 ${pageId} 的素材阶段未生成有效结果。`,
            events,
          );
        }

        assets = assetState.results;
      }

      return {
        patch: {
          pages: updatePage(state, pageId, (pageState) => ({
            ...pageState,
            assets,
            currentStage: "html",
          })),
        },
        events,
      };
    },
  };
}

export function createHtmlEngineerNode(pageId: string): CourseGenerationNode {
  return {
    name: "html-engineer",
    stage: "html",
    agent: "html-engineer",
    pageId,
    requiredInputs: pageRequirements(pageId, [
      value("pages", "page content", (state) => getPage(state, pageId)?.content),
      value("pages", "resolved page assets", (state) =>
        getPage(state, pageId)?.currentStage === "html"
          ? getPage(state, pageId)?.assets
          : undefined,
      ),
      value("briefs", "visual brief", (state) => state.briefs?.visual),
    ]),
    produces: [
      value("pages", "page html", (state) =>
        getPage(state, pageId)?.htmlOutput,
      ),
      value("pages", "completed page", (state) =>
        getPage(state, pageId)?.status === "completed"
          ? "completed"
          : undefined,
      ),
    ],
    startSummary: (state) =>
      `HTML Engineer 已开始生成第 ${requirePagePlan(state, pageId).order} 页。`,
    doneSummary: (state) =>
      `第 ${requirePagePlan(state, pageId).order} 页 HTML 已完成校验。`,
    afterDoneEvents: (state) => [
      {
        type: "page_done",
        summary: `第 ${requirePagePlan(state, pageId).order} 页已完成，可在学习空间预览。`,
      },
    ],
    async run(state, context) {
      const page = requirePage(state, pageId);
      const validationFeedback = toHtmlValidationFeedback(
        context.retryFeedback,
      );
      const htmlState = await context.dependencies.runHtml(
        {
          content: requireValue(page.content, "page content"),
          visualBrief: requireValue(state.briefs?.visual, "visual brief"),
          assets: page.assets,
          validationFeedback,
        },
        context.runtime,
      );
      const events = projectAgentEvents(htmlState.events);

      if (htmlState.status !== "completed" || !htmlState.htmlOutput) {
        throw new CourseGenerationNodeError(
          "html-engineer",
          htmlState.error?.code ?? "HTML_ENGINEER_FAILED",
          htmlState.error?.message ?? `页面 ${pageId} 未生成有效 HTML。`,
          events,
        );
      }

      return {
        patch: {
          pages: updatePage(state, pageId, (pageState) => ({
            ...pageState,
            status: "completed",
            currentStage: "complete",
            htmlOutput: htmlState.htmlOutput,
            error: undefined,
          })),
        },
        events,
      };
    },
  };
}

const HTML_VALIDATION_PREFIX = "生成 HTML 校验失败：";

function toHtmlValidationFeedback(
  feedback: CourseGenerationNodeContext["retryFeedback"],
): HtmlEngineerValidationFeedback | undefined {
  if (
    feedback?.nodeName !== "html-engineer" ||
    !feedback.message.startsWith(HTML_VALIDATION_PREFIX)
  ) {
    return undefined;
  }

  const issues = feedback.message
    .slice(HTML_VALIDATION_PREFIX.length)
    .split("；")
    .map((issue) => issue.trim())
    .filter(Boolean)
    .slice(0, 20);

  return issues.length > 0 ? { code: feedback.code, issues } : undefined;
}

function value(
  key: keyof CourseGenerationState,
  name: string,
  select: (state: CourseGenerationState) => unknown,
): WorkflowValue<CourseGenerationState> {
  return { key, name, select };
}

function pageRequirements(
  pageId: string,
  requirements: WorkflowValue<CourseGenerationState>[],
) {
  return [
    value("pages", "page state", (state) => getPage(state, pageId)),
    ...requirements,
  ];
}

function projectAgentEvents(
  events: readonly (AgentEvent & { agent?: string })[],
): CourseGenerationNodeEvent[] {
  return events.map(({ type, summary, step, timestamp, agent }) => ({
    type,
    summary,
    step,
    timestamp,
    agent,
  }));
}

function projectDesignEvents(
  events: readonly CourseDesignEvent[],
): CourseGenerationNodeEvent[] {
  return projectAgentEvents(events);
}

function getPage(state: CourseGenerationState, pageId: string) {
  return state.pages.find((page) => page.pageId === pageId);
}

function requirePage(state: CourseGenerationState, pageId: string) {
  return requireValue(getPage(state, pageId), `page ${pageId}`);
}

function findPagePlan(state: CourseGenerationState, pageId: string) {
  return state.outline?.pages.find((page) => page.id === pageId);
}

function requirePagePlan(state: CourseGenerationState, pageId: string) {
  return requireValue(findPagePlan(state, pageId), `page plan ${pageId}`);
}

function findPageBrief(state: CourseGenerationState, pageId: string) {
  return state.pageWorkerBriefs?.find((brief) => brief.pageId === pageId);
}

function requirePageBrief(state: CourseGenerationState, pageId: string) {
  return requireValue(findPageBrief(state, pageId), `page brief ${pageId}`);
}

function updatePage(
  state: CourseGenerationState,
  pageId: string,
  updater: (page: PageGenerationState) => PageGenerationState,
) {
  return state.pages.map((page) =>
    page.pageId === pageId ? updater(page) : page,
  );
}

function requireValue<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) {
    throw new Error(`工作流内部缺少 ${name}。`);
  }
  return value;
}
