import type { PageBuilderExecution } from "@/server/agent/plugins/contexts/course/page-builder";
import { runHtmlEngineerModelStep } from "@/server/agent/plugins/model-steps/course/html-engineer-model-step";
import { runPageQAModelStep } from "@/server/agent/plugins/model-steps/course/page-qa-model-step";
import { runPageWriterModelStep } from "@/server/agent/plugins/model-steps/course/page-writer-model-step";
import type { PageWriterCourseContext } from "@/server/agent/plugins/model-steps/course/page-writer-model-step";
import { runRepairModelStep } from "@/server/agent/plugins/model-steps/course/repair-model-step";
import { runImageAssetWorkflow } from "@/server/agent/plugins/tools/course/image-assets";
import { PageBuilderModelStepError } from "@/server/agent/plugins/tools/course/page-builder-support";
import type {
  AssetGenerationResult,
  HtmlOutput,
  PageContentDSL,
  QualityReport,
  RepairRequest,
} from "@/shared/course-schema";

export type PageRepairOutcome =
  | {
      status: "applied";
      targetArtifact: "dsl";
      content: PageContentDSL;
      summary: string;
    }
  | {
      status: "applied";
      targetArtifact: "html";
      html: string;
      summary: string;
    }
  | {
      status: "declined";
      targetArtifact: "dsl" | "html";
      summary: string;
    };

export type PageBuilderModelSteps = {
  generateContent(input: {
    execution: PageBuilderExecution;
    validationFeedback?: string[];
    abortSignal?: AbortSignal;
  }): Promise<PageContentDSL>;
  resolveAssets(input: {
    execution: PageBuilderExecution;
    content: PageContentDSL;
    abortSignal?: AbortSignal;
  }): Promise<AssetGenerationResult[]>;
  generateHtml(input: {
    execution: PageBuilderExecution;
    content: PageContentDSL;
    assets: AssetGenerationResult[];
    validationFeedback?: string[];
    abortSignal?: AbortSignal;
  }): Promise<HtmlOutput>;
  inspectPage(input: {
    execution: PageBuilderExecution;
    content: PageContentDSL;
    assets: AssetGenerationResult[];
    html: HtmlOutput;
    abortSignal?: AbortSignal;
  }): Promise<QualityReport>;
  repairPage(input: {
    execution: PageBuilderExecution;
    request: RepairRequest;
    abortSignal?: AbortSignal;
  }): Promise<PageRepairOutcome>;
};

/**
 * 把成熟的单次模型调用和确定性工作流接到 Page Builder 工具边界。
 * 这些步骤没有工具选择、任务分派或自主循环能力，真正的 Agent 是外层 Page Builder。
 */
export const defaultPageBuilderModelSteps: PageBuilderModelSteps = {
  async generateContent(input) {
    const state = await runPageWriterModelStep(
      {
        intent: input.execution.projection.intent,
        courseContext: buildPageWriterCourseContext(input.execution),
        page: input.execution.pagePlan,
        brief: input.execution.pageBrief,
        referencePacks: input.execution.referencePacks,
        validationFeedback: input.validationFeedback
          ? {
              code: "PAGE_BUILDER_RETRY",
              issues: input.validationFeedback,
            }
          : undefined,
      },
      {
        traceId: input.execution.traceId,
        abortSignal: input.abortSignal,
      },
    );
    if (state.status !== "completed" || !state.content) {
      throw new PageBuilderModelStepError(
        state.error?.code ?? "MODEL_STEP_OUTPUT_MISSING",
        state.error?.message ?? "Page Writer 没有返回内容",
      );
    }
    return state.content;
  },

  async resolveAssets(input) {
    const state = await runImageAssetWorkflow(
      {
        content: input.content,
        visualBrief: input.execution.projection.briefs.visual,
      },
      {
        traceId: input.execution.traceId,
        abortSignal: input.abortSignal,
      },
    );
    if (state.status !== "completed" || !state.results) {
      throw new PageBuilderModelStepError(
        state.error?.code ?? "MODEL_STEP_OUTPUT_MISSING",
        state.error?.message ?? "素材工作流没有返回结果",
      );
    }
    return state.results;
  },

  async generateHtml(input) {
    const state = await runHtmlEngineerModelStep(
      {
        content: input.content,
        visualBrief: input.execution.projection.briefs.visual,
        assets: input.assets,
        pageDesignGuidance: buildPageDesignGuidance(
          input.execution,
        ),
        validationFeedback: input.validationFeedback
          ? {
              code: "PAGE_FIX_REVIEW_FEEDBACK",
              issues: input.validationFeedback,
            }
          : undefined,
      },
      {
        traceId: input.execution.traceId,
        abortSignal: input.abortSignal,
      },
    );
    if (state.status !== "completed" || !state.htmlOutput) {
      throw new PageBuilderModelStepError(
        state.error?.code ?? "MODEL_STEP_OUTPUT_MISSING",
        state.error?.message ?? "HTML Engineer 没有返回页面",
      );
    }
    return state.htmlOutput;
  },

  async inspectPage(input) {
    const currentIndex =
      input.execution.projection.outline.pages.findIndex(
        ({ id }) => id === input.execution.pageId,
      );
    const dependencyDigest =
      input.execution.dependencySummaries
        .map(({ title, contentDigest }) => `${title}：${contentDigest}`)
        .join("；");
    const state = await runPageQAModelStep(
      {
        page: input.execution.pagePlan,
        content: input.content,
        html: input.html.html,
        visualBrief: input.execution.projection.briefs.visual,
        assets: input.assets,
        courseContext: {
          courseOverview: [
            input.execution.projection.outline.overview,
            dependencyDigest,
          ]
            .filter(Boolean)
            .join("；"),
          learningObjectives:
            input.execution.projection.outline.learningObjectives,
          previousPage:
            input.execution.projection.outline.pages[
              currentIndex - 1
            ],
          nextPage:
            input.execution.projection.outline.pages[
              currentIndex + 1
            ],
        },
      },
      {
        traceId: input.execution.traceId,
        abortSignal: input.abortSignal,
      },
    );
    if (state.status !== "completed" || !state.report) {
      throw new PageBuilderModelStepError(
        state.error?.code ?? "MODEL_STEP_OUTPUT_MISSING",
        state.error?.message ?? "Page QA 没有返回报告",
      );
    }
    return state.report;
  },

  async repairPage(input) {
    const state = await runRepairModelStep(input.request, {
      traceId: input.execution.traceId,
      abortSignal: input.abortSignal,
    });
    if (state.status !== "completed" || !state.result) {
      throw new PageBuilderModelStepError(
        state.error?.code ?? "MODEL_STEP_OUTPUT_MISSING",
        state.error?.message ?? "修复模型步骤没有返回结果",
      );
    }
    if (state.result.kind === "declined") {
      return {
        status: "declined",
        targetArtifact: state.result.targetArtifact,
        summary: state.result.reasonSummary,
      };
    }
    if (
      state.result.kind === "dsl_candidate" &&
      state.repairedContent
    ) {
      return {
        status: "applied",
        targetArtifact: "dsl",
        content: state.repairedContent,
        summary: state.result.changeSummary.join("；"),
      };
    }
    if (
      state.result.kind === "html_patch_candidate" &&
      state.repairedHtml
    ) {
      return {
        status: "applied",
        targetArtifact: "html",
        html: state.repairedHtml,
        summary: state.result.changeSummary.join("；"),
      };
    }
    throw new Error("修复模型步骤的结果与修复产物不一致");
  },
};

export function buildPageWriterCourseContext(
  execution: PageBuilderExecution,
): PageWriterCourseContext {
  const orderedPages = [...execution.architecture.pageTasks].sort(
    (left, right) => left.order - right.order,
  );
  const currentIndex = orderedPages.findIndex(
    ({ pageId }) => pageId === execution.pageId,
  );
  const neighboringPageTasks = [
    orderedPages[currentIndex - 1],
    orderedPages[currentIndex + 1],
  ].flatMap((page) =>
    page
      ? [
          {
            pageId: page.pageId,
            order: page.order,
            title: page.title,
            purpose: page.purpose,
            objectiveIds: page.objectiveIds,
            learnerAction: page.learnerAction,
          },
        ]
      : [],
  );

  return {
    creationBrief: execution.creationBrief,
    courseTitle: execution.architecture.blueprint.title,
    audience: execution.architecture.blueprint.audience,
    language: execution.architecture.blueprint.language,
    objectives: execution.architecture.blueprint.objectives,
    courseRules: execution.architecture.blueprint.courseRules,
    coursePack: execution.architecture.coursePack,
    pageTask: execution.pageTask,
    neighboringPageTasks,
    dependencySummaries: execution.dependencySummaries,
    pageDesignGuidance: buildPageDesignGuidance(execution),
  };
}

export function buildPageDesignGuidance(
  execution: PageBuilderExecution,
) {
  return (
    execution.localResourceSession?.loadedResources.filter(
      ({ logicalPath }) =>
        logicalPath.startsWith(
          "agent/skills/frontend-slides/",
        ) && !logicalPath.endsWith("/agents/openai.yaml"),
    ) ?? []
  );
}
