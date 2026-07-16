import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import { buildPageQAPrompts } from "@/server/prompts/page-qa";
import {
  PageContentDSLSchema,
  AssetGenerationResultSchema,
  PagePlanSchema,
  QualityDimensionNameSchema,
  QualityDimensionSchema,
  QualitySeveritySchema,
  VisualBriefSchema,
  type PageContentDSL,
  type AssetGenerationResult,
  type PagePlan,
  type QualityIssue,
  type QualityReport,
  type QualityScreenshotEvidence,
  type VisualBrief,
} from "@/shared/course-schema";
import { basicLayoutHeuristics } from "@/server/quality/basic-layout-heuristics";
import { buildPageQualityReport } from "@/server/quality/page-quality";
import {
  capturePageScreenshot,
  type PageScreenshotResult,
} from "@/server/quality/playwright-screenshot";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

const PageQAModelDimensionSchema = QualityDimensionSchema.pick({
  score: true,
  summary: true,
});

const PageQAModelIssueSchema = z
  .object({
    code: z.string().min(1).max(80),
    dimension: QualityDimensionNameSchema,
    severity: QualitySeveritySchema,
    message: z.string().min(2).max(500),
    location: z
      .object({
        pageId: z.string().min(1).max(80).optional(),
        blockId: z.string().min(1).max(80).optional(),
        selector: z.string().min(1).max(240).optional(),
        viewport: z.string().min(1).max(80).optional(),
        description: z.string().min(2).max(240),
      })
      .strict(),
    repairHint: z.string().min(2).max(500),
  })
  .strict();

export const PageQAModelOutputSchema = z
  .object({
    dimensions: z
      .object({
        contentAccuracy: PageQAModelDimensionSchema,
        layoutQuality: PageQAModelDimensionSchema,
        courseCoherence: PageQAModelDimensionSchema,
        styleConsistency: PageQAModelDimensionSchema,
        htmlRuntime: PageQAModelDimensionSchema,
        assetUsability: PageQAModelDimensionSchema,
      })
      .strict(),
    issues: z.array(PageQAModelIssueSchema).max(40),
  })
  .strict();

export type PageQACourseContext = {
  courseOverview?: string;
  learningObjectives: string[];
  previousPage?: PagePlan;
  nextPage?: PagePlan;
};

export type PageQAInput = {
  page: PagePlan;
  content: PageContentDSL;
  html: string;
  visualBrief: VisualBrief;
  assets?: AssetGenerationResult[];
  courseContext?: PageQACourseContext;
};

export type PageQAAgentState = AgentStateBase & {
  task: PageQAInput;
  report?: QualityReport;
};

export type PageQAAgentDependencies = {
  evaluate(input: PageQAInput & {
    heuristicIssues: QualityIssue[];
    browserIssues: QualityIssue[];
    screenshotEvidence: QualityScreenshotEvidence;
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
  captureScreenshot(input: {
    pageId: string;
    html: string;
    abortSignal?: AbortSignal;
  }): Promise<PageScreenshotResult>;
};

const defaultDependencies: PageQAAgentDependencies = {
  evaluate,
  captureScreenshot: capturePageScreenshot,
};

/** 创建只读的一步页面 QA Agent；它只返回报告，不会修改 HTML。 */
export function createPageQAAgent(
  overrides: Partial<PageQAAgentDependencies> = {},
): Agent<PageQAAgentState> {
  const dependencies = { ...defaultDependencies, ...overrides };
  return createMinimalAgent({
    isComplete: (state) => Boolean(state.report),
    step: async (state, context, emit) => {
      validatePageQAInput(state.task);
      const heuristicIssues = basicLayoutHeuristics({
        content: state.task.content,
        html: state.task.html,
        assets: state.task.assets,
      });

      emit({
        type: "validation",
        summary: `页面静态质量检查完成，发现 ${heuristicIssues.length} 个确定性问题。`,
        data: {
          pageId: state.task.page.id,
          heuristicIssueCount: heuristicIssues.length,
        },
      });

      const screenshot = await dependencies.captureScreenshot({
        pageId: state.task.page.id,
        html: state.task.html,
        abortSignal: context.abortSignal,
      });
      emit({
        type: "validation",
        summary:
          screenshot.evidence.status === "captured"
            ? `Playwright 截图检查完成，发现 ${screenshot.issues.length} 个浏览器问题。`
            : `Playwright 截图检查${screenshot.evidence.status === "skipped" ? "已跳过" : "失败"}，QA 主流程继续。`,
        data: {
          pageId: state.task.page.id,
          screenshotStatus: screenshot.evidence.status,
          browserIssueCount: screenshot.issues.length,
        },
      });

      const modelOutput = await dependencies.evaluate({
        ...state.task,
        heuristicIssues,
        browserIssues: screenshot.issues,
        screenshotEvidence: screenshot.evidence,
        abortSignal: context.abortSignal,
        traceId: context.traceId,
      });

      emit({
        type: "model_call",
        summary: "Page QA 已完成内容、课程和视觉语义评估。",
        data: { pageId: state.task.page.id, purpose: "page-quality-evaluation" },
      });

      const report = validatePageQAOutput(
        modelOutput,
        state.task,
        heuristicIssues,
        screenshot,
      );

      emit({
        type: "validation",
        summary: `质量报告已通过校验：${report.overallScore} 分，${report.issues.length} 个问题。`,
        data: {
          pageId: state.task.page.id,
          overallScore: report.overallScore,
          issueCount: report.issues.length,
          shouldRepair: report.shouldRepair,
        },
      });

      return { ...state, report };
    },
  });
}

export function createPageQAAgentState(input: PageQAInput): PageQAAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

export function runPageQAAgent(
  input: PageQAInput,
  context: AgentRuntimeContext,
) {
  return createPageQAAgent().run(createPageQAAgentState(input), context);
}

export function validatePageQAInput(input: PageQAInput) {
  const parsed = z
    .object({
      page: PagePlanSchema,
      content: PageContentDSLSchema,
      html: z.string().min(1).max(200_000),
      visualBrief: VisualBriefSchema,
      assets: z.array(AssetGenerationResultSchema).max(12).optional(),
    })
    .safeParse(input);
  const issues: string[] = [];

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `Page QA 输入结构校验失败：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  if (input.page.id !== input.content.pageId) {
    issues.push("PagePlan.id 必须与 PageContentDSL.pageId 一致");
  }
  if (input.page.functionalTemplateId !== input.content.functionalTemplateId) {
    issues.push("PagePlan 与 PageContentDSL 必须引用同一功能模板");
  }
  if (input.page.styleTemplateId !== input.visualBrief.styleTemplateId) {
    issues.push("PagePlan 与 VisualBrief 必须引用同一样式模板");
  }
  if (
    !input.visualBrief.pageGuidance.some(
      ({ pageId }) => pageId === input.page.id,
    )
  ) {
    issues.push(`VisualBrief 缺少页面 ${input.page.id} 的视觉指导`);
  }

  if (issues.length > 0) {
    throw new AiSchemaValidationError(`Page QA 输入校验失败：${issues.join("；")}`);
  }
}

export function validatePageQAOutput(
  output: unknown,
  input: PageQAInput,
  heuristicIssues: QualityIssue[],
  screenshot?: PageScreenshotResult,
) {
  const parsed = PageQAModelOutputSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `Page QA 结构化输出校验失败：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const blockIds = new Set(input.content.blocks.map(({ id }) => id));
  const modelIssues: QualityIssue[] = parsed.data.issues.map((issue) => ({
    ...issue,
    source: "model",
    location: {
      ...issue.location,
      pageId: input.page.id,
      blockId:
        issue.location.blockId && blockIds.has(issue.location.blockId)
          ? issue.location.blockId
          : undefined,
    },
  }));

  return buildPageQualityReport({
    pageId: input.page.id,
    modelDimensions: parsed.data.dimensions,
    heuristicIssues,
    browserIssues: screenshot?.issues,
    modelIssues,
    screenshotEvidence: screenshot?.evidence,
  });
}

async function evaluate(
  input: PageQAInput & {
    heuristicIssues: QualityIssue[];
    browserIssues: QualityIssue[];
    screenshotEvidence: QualityScreenshotEvidence;
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const prompts = await buildPageQAPrompts({
    pagePlan: input.page,
    pageContentDsl: input.content,
    html: input.html,
    visualBrief: input.visualBrief,
    courseContext: input.courseContext,
    heuristicIssues: input.heuristicIssues,
    browserIssues: input.browserIssues,
    screenshotEvidence: input.screenshotEvidence,
    assets: input.assets ?? [],
  });

  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    maxTokens: 4_000,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: PageQAModelOutputSchema,
    schemaDescription:
      "Six-dimension page quality assessment with actionable issues; no repaired HTML.",
    schemaName: "page_quality_assessment",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.1,
    traceId: input.traceId,
  });
}
