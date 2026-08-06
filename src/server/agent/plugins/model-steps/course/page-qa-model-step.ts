import type { UIMessage } from "ai";
import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { buildPageQAPrompts } from "@/server/agent/plugins/prompts/course/model-steps/page-qa";
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
  type CoursePack,
  type PagePlan,
  type QualityIssue,
  type QualityReport,
  type QualityScreenshotEvidence,
  type VisualBrief,
} from "@/shared/course-schema";
import {
  basicLayoutHeuristics,
  hasSafelyContainedOpaqueAssetFallback,
} from "@/server/course/page/quality/basic-layout";
import {
  buildPageQualityReport,
  PAGE_QUALITY_TARGETS,
} from "@/server/course/page/quality/report";
import {
  capturePageScreenshot,
  type PageScreenshotModelImage,
  type PageScreenshotResult,
} from "@/server/infra/browser/page-screenshot";

import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

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

const CONTRACT_OWNED_MODEL_ISSUE_CODES = new Set([
  "ASSET_ALT_TEXT_INVALID",
  "INTERACTION_FEEDBACK_VISIBLE_BY_DEFAULT",
  "INTERACTION_CONTENT_NOT_HIDDEN",
  "INTERACTION_ITEM_VISIBILITY",
]);
const UNLOCATABLE_MODEL_WARNING_CODES = new Set([
  "CONTENT_REDUNDANCY",
  "CONTENT_REDUNDANT",
]);
const MODEL_REDUNDANCY_ISSUE_CODES = new Set([
  "CONTENT_DUPLICATION",
  "CONTENT_REDUNDANCY",
  "CONTENT_REDUNDANT",
  "REDUNDANT_CONTENT",
  "REDUNDANT_CONTENT_BLOCK",
]);
const MODEL_TOUCH_TARGET_ISSUE_CODES = new Set([
  "TOO_SMALL_TOUCH_TARGET",
  "TOUCH_TARGET_INSUFFICIENT",
  "TOUCH_TARGET_TOO_SMALL",
]);
export type PageQACourseContext = {
  courseOverview?: string;
  learningObjectives: string[];
  facts?: Array<Pick<CoursePack["facts"][number], "id" | "text">>;
  terms?: Array<
    Pick<CoursePack["terms"][number], "term" | "definition">
  >;
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

export type PageQAModelStepState = ModelStepStateBase & {
  task: PageQAInput;
  report?: QualityReport;
};

export type PageQAModelStepDependencies = {
  evaluate(input: PageQAInput & {
    heuristicIssues: QualityIssue[];
    browserIssues: QualityIssue[];
    screenshotEvidence: QualityScreenshotEvidence;
    /** Ephemeral PNGs for this model call only; never persist in QualityReport. */
    screenshotImages: PageScreenshotModelImage[];
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
  captureScreenshot(input: {
    pageId: string;
    html: string;
    content?: PageContentDSL;
    abortSignal?: AbortSignal;
    traceId?: string;
  }): Promise<PageScreenshotResult>;
};

const defaultDependencies: PageQAModelStepDependencies = {
  evaluate,
  captureScreenshot: capturePageScreenshot,
};

/** 创建只读的页面 QA 模型步骤；它只返回报告，不会修改 HTML。 */
export function createPageQAModelStep(
  overrides: Partial<PageQAModelStepDependencies> = {},
): ModelStep<PageQAModelStepState> {
  const dependencies = { ...defaultDependencies, ...overrides };
  return createModelStep({
    name: "page-qa-model-step",
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
        content: state.task.content,
        abortSignal: context.abortSignal,
        traceId: context.traceId,
      });
      const screenshotStatus = screenshotEvidenceStatus(
        screenshot.evidence,
      );
      emit({
        type: "validation",
        summary:
          screenshotStatus === "captured"
            ? `Playwright 截图检查完成，发现 ${screenshot.issues.length} 个浏览器问题。`
            : `Playwright 截图检查${screenshotStatus === "skipped" ? "已跳过" : "失败"}，页面将进入质量修复。`,
        data: {
          pageId: state.task.page.id,
          screenshotStatus,
          browserIssueCount: screenshot.issues.length,
        },
      });

      const modelOutput = await dependencies.evaluate({
        ...state.task,
        assets: assetsForPageQAModel(state.task),
        heuristicIssues,
        browserIssues: screenshot.issues,
        screenshotEvidence: screenshot.evidence,
        screenshotImages: screenshot.modelImages ?? [],
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

export function createPageQAModelStepState(
  input: PageQAInput,
): PageQAModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

export function runPageQAModelStep(
  input: PageQAInput,
  context: ModelStepContext,
) {
  return createPageQAModelStep().run(
    createPageQAModelStepState(input),
    context,
  );
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
  const safelyContainedTransparencyFallbacks =
    hasOnlySafelyContainedTransparencyFallbacks(input);
  const browserIssues = screenshot?.issues ?? [];
  const modelIssueDecisions = parsed.data.issues.map((issue) => ({
    issue,
    keep:
      shouldKeepModelIssue(issue, input, browserIssues) &&
      !(
        safelyContainedTransparencyFallbacks &&
        issue.code === "ASSET_TRANSPARENCY_UNAVAILABLE"
      ),
  }));
  const ignoredModelIssueDimensions = new Set(
    modelIssueDecisions
      .filter(({ keep }) => !keep)
      .map(({ issue }) => issue.dimension),
  );
  const modelIssues: QualityIssue[] = modelIssueDecisions
    .filter(({ keep }) => keep)
    .map(({ issue }) => issue)
    .map((issue) => ({
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
  const effectiveHeuristicIssues = safelyContainedTransparencyFallbacks
    ? heuristicIssues.filter(
        ({ code }) => code !== "ASSET_TRANSPARENCY_UNAVAILABLE",
      )
    : heuristicIssues;
  const hasOtherAssetIssue = [
    ...effectiveHeuristicIssues,
    ...browserIssues,
    ...modelIssues,
  ].some(({ dimension }) => dimension === "assetUsability");
  let modelDimensions =
    safelyContainedTransparencyFallbacks && !hasOtherAssetIssue
      ? {
          ...parsed.data.dimensions,
          assetUsability: {
            ...parsed.data.dimensions.assetUsability,
            score: Math.max(
              parsed.data.dimensions.assetUsability.score,
              PAGE_QUALITY_TARGETS.assetUsability,
            ),
          },
        }
      : parsed.data.dimensions;
  const retainedIssues = [
    ...effectiveHeuristicIssues,
    ...browserIssues,
    ...modelIssues,
  ];
  for (const dimension of ignoredModelIssueDimensions) {
    if (
      retainedIssues.some(
        (issue) =>
          issue.dimension === dimension && issue.severity !== "info",
      )
    ) {
      continue;
    }
    modelDimensions = {
      ...modelDimensions,
      [dimension]: {
        ...modelDimensions[dimension],
        score: Math.max(
          modelDimensions[dimension].score,
          PAGE_QUALITY_TARGETS[dimension],
        ),
      },
    };
  }

  return buildPageQualityReport({
    pageId: input.page.id,
    modelDimensions,
    heuristicIssues: effectiveHeuristicIssues,
    browserIssues,
    modelIssues,
    screenshotEvidence: screenshot?.evidence,
  });
}

function assetsForPageQAModel(input: PageQAInput) {
  return input.assets?.map((result) =>
    result.warnings?.includes("TRANSPARENCY_UNAVAILABLE") &&
    hasSafelyContainedOpaqueAssetFallback(
      input.html,
      result.request.assetSlotId,
      result.asset?.uri,
    )
      ? {
          ...result,
          warnings: result.warnings.filter(
            (warning) => warning !== "TRANSPARENCY_UNAVAILABLE",
          ),
        }
      : result,
  );
}

function hasOnlySafelyContainedTransparencyFallbacks(input: PageQAInput) {
  const affected = (input.assets ?? []).filter(({ warnings }) =>
    warnings?.includes("TRANSPARENCY_UNAVAILABLE"),
  );
  return (
    affected.length > 0 &&
    affected.every((result) =>
      hasSafelyContainedOpaqueAssetFallback(
        input.html,
        result.request.assetSlotId,
        result.asset?.uri,
      ),
    )
  );
}

function shouldKeepModelIssue(
  issue: z.infer<typeof PageQAModelIssueSchema>,
  input: PageQAInput,
  browserIssues: QualityIssue[],
) {
  if (CONTRACT_OWNED_MODEL_ISSUE_CODES.has(issue.code)) return false;
  if (
    MODEL_TOUCH_TARGET_ISSUE_CODES.has(issue.code) &&
    browserIssues.some(({ code }) =>
      code.startsWith("BROWSER_TOUCH_TARGET_"),
    )
  ) {
    return false;
  }
  if (
    MODEL_REDUNDANCY_ISSUE_CODES.has(issue.code) &&
    isTrustedRestorationIssue(issue, input.html)
  ) {
    return false;
  }
  const validBlockId =
    issue.location.blockId &&
    input.content.blocks.some(({ id }) => id === issue.location.blockId);
  if (
    issue.severity !== "error" &&
    UNLOCATABLE_MODEL_WARNING_CODES.has(issue.code) &&
    !validBlockId &&
    !issue.location.selector
  ) {
    return false;
  }
  if (
    issue.code === "LAYOUT_READING_ORDER_MISMATCH" &&
    followsDeclaredBlockOrder(input.html, input.content.layoutHints.readingOrder)
  ) {
    return false;
  }
  return true;
}

function isTrustedRestorationIssue(
  issue: z.infer<typeof PageQAModelIssueSchema>,
  html: string,
) {
  if (!html.includes("data-course-contract-restored=")) return false;
  if (issue.location.selector?.includes("data-course-contract-restored")) {
    return true;
  }
  if (!issue.location.blockId) return false;

  const blockId = issue.location.blockId.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const opening = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bdata-block-id\\s*=\\s*(["'])${blockId}\\2[^>]*>`,
    "i",
  ).exec(html);
  if (!opening?.[1] || opening.index === undefined) return false;

  const tagName = opening[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tag.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) {
        return html
          .slice(opening.index, tag.lastIndex)
          .includes("data-course-contract-restored=");
      }
    } else if (!/\/>$/.test(match[0])) {
      depth += 1;
    }
  }
  return false;
}

function followsDeclaredBlockOrder(html: string, blockIds: string[]) {
  let previousIndex = -1;
  return blockIds.every((blockId) => {
    const marker = `data-block-id="${blockId}"`;
    const index = html.indexOf(marker);
    if (index < 0 || index <= previousIndex) return false;
    previousIndex = index;
    return true;
  });
}

function screenshotEvidenceStatus(
  evidence: QualityScreenshotEvidence,
) {
  if (evidence.captures.every(({ status }) => status === "captured")) {
    return "captured" as const;
  }
  return evidence.captures.some(({ status }) => status === "failed")
    ? "failed" as const
    : "skipped" as const;
}

async function evaluate(
  input: PageQAInput & {
    heuristicIssues: QualityIssue[];
    browserIssues: QualityIssue[];
    screenshotEvidence: QualityScreenshotEvidence;
    screenshotImages: PageScreenshotModelImage[];
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
  const messages = buildPageQAModelMessages(
    prompts.userPrompt,
    input.screenshotImages,
  );

  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "page-qa",
    maxTokens: 4_000,
    messages,
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
    schema: PageQAModelOutputSchema,
    schemaDescription:
      "Six-dimension page quality assessment with actionable issues; no repaired HTML.",
    schemaName: "page_quality_assessment",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.1,
    traceId: input.traceId,
  });
}

/**
 * 把浏览器首屏证据作为真正的视觉输入发送给模型。data URL 只存在于本次
 * 请求的内存对象中；持久化报告仍只保留脱敏后的 viewport/metrics 证据。
 */
export function buildPageQAModelMessages(
  userPrompt: string,
  images: PageScreenshotModelImage[],
) {
  const parts: UIMessage["parts"] = [
    { type: "text", text: userPrompt },
  ];

  for (const image of images) {
    const viewport = `${image.viewport.width}x${image.viewport.height}`;
    parts.push(
      {
        type: "text",
        text: `\nPlaywright 首屏截图（视口 ${viewport}）：`,
      },
      {
        type: "file",
        mediaType: "image/png",
        filename: `page-qa-${viewport}.png`,
        url: `data:image/png;base64,${Buffer.from(image.png).toString("base64")}`,
      },
    );
  }

  return [
    {
      id: "page-qa-request",
      role: "user",
      parts,
    },
  ] satisfies UIMessage[];
}
