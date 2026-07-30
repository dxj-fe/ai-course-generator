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

const PAGE_QA_DIMENSION_NAMES = [
  "contentAccuracy",
  "layoutQuality",
  "courseCoherence",
  "styleConsistency",
  "htmlRuntime",
  "assetUsability",
] as const;

const MODEL_SEVERITY_ALIASES = {
  blocker: "error",
  critical: "error",
  fatal: "error",
  high: "error",
  major: "error",
  severe: "error",
  medium: "warning",
  minor: "warning",
  moderate: "warning",
  low: "info",
  notice: "info",
  suggestion: "info",
} as const;

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
      emit({
        type: "validation",
        summary:
          screenshot.evidence.status === "captured"
            ? `Playwright 截图检查完成，发现 ${screenshot.issues.length} 个浏览器问题。`
            : `Playwright 截图检查${screenshot.evidence.status === "skipped" ? "已跳过" : "失败"}，页面将进入质量修复。`,
        data: {
          pageId: state.task.page.id,
          screenshotStatus: screenshot.evidence.status,
          browserIssueCount: screenshot.issues.length,
        },
      });

      const modelOutput = await dependencies.evaluate({
        ...state.task,
        assets: assetsForPageQAModel(state.task),
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
  const parsed = PageQAModelOutputSchema.safeParse(
    normalizePageQAModelOutput(output),
  );

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

/**
 * 兼容只提供 JSON object mode 的 Provider：仅收敛可无损确定的展示文本和
 * 常见严重度别名。维度、issue code、定位引用等语义字段仍由严格 Schema 拒绝。
 */
export function normalizePageQAModelOutput(output: unknown): unknown {
  if (!isRecord(output)) return output;

  let changed = false;
  let dimensions = output.dimensions;
  if (isRecord(dimensions)) {
    const normalizedDimensions = { ...dimensions };
    for (const name of PAGE_QA_DIMENSION_NAMES) {
      const dimension = normalizedDimensions[name];
      if (!isRecord(dimension)) continue;
      const summary = truncateString(dimension.summary, 300);
      if (summary !== dimension.summary) {
        normalizedDimensions[name] = { ...dimension, summary };
        changed = true;
      }
    }
    dimensions = normalizedDimensions;
  }

  let issues = output.issues;
  if (Array.isArray(issues)) {
    issues = issues.map((issue) => {
      if (!isRecord(issue)) return issue;
      let normalizedIssue = issue;

      const issueWithCanonicalRepairHint =
        normalizeMisplacedIssueRepairHint(normalizedIssue);
      if (issueWithCanonicalRepairHint !== normalizedIssue) {
        normalizedIssue = issueWithCanonicalRepairHint;
        changed = true;
      }

      const severity = normalizeModelSeverity(issue.severity);
      if (severity !== issue.severity) {
        normalizedIssue = { ...normalizedIssue, severity };
        changed = true;
      }

      for (const field of ["message", "repairHint"] as const) {
        const value = truncateString(normalizedIssue[field], 500);
        if (value !== normalizedIssue[field]) {
          normalizedIssue = { ...normalizedIssue, [field]: value };
          changed = true;
        }
      }

      if (isRecord(normalizedIssue.location)) {
        const location = normalizeModelIssueLocation(normalizedIssue.location);
        if (location !== normalizedIssue.location) {
          normalizedIssue = {
            ...normalizedIssue,
            location,
          };
          changed = true;
        }
      }

      return normalizedIssue;
    });
  }

  return changed ? { ...output, dimensions, issues } : output;
}

function normalizeModelSeverity(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["info", "warning", "error"].includes(normalized)) return normalized;
  return MODEL_SEVERITY_ALIASES[
    normalized as keyof typeof MODEL_SEVERITY_ALIASES
  ] ?? value;
}

function normalizeMisplacedIssueRepairHint(
  issue: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(issue.location)) return issue;

  const misplacedRepairHint = issue.location.repairHint;
  if (typeof misplacedRepairHint !== "string") return issue;

  const canonicalLocation = { ...issue.location };
  delete canonicalLocation.repairHint;
  return {
    ...issue,
    ...(issue.repairHint === undefined
      ? { repairHint: misplacedRepairHint }
      : {}),
    location: canonicalLocation,
  };
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

function normalizeModelIssueLocation(location: Record<string, unknown>) {
  let normalizedLocation = location;

  if ("viewports" in location) {
    const { viewports, ...canonicalLocation } = location;
    const viewport =
      typeof location.viewport === "string"
        ? location.viewport
        : normalizeViewportAlias(viewports);
    normalizedLocation =
      viewport === undefined
        ? canonicalLocation
        : { ...canonicalLocation, viewport };
  }

  const description = normalizeLocationDescription(normalizedLocation);
  return description === normalizedLocation.description
    ? normalizedLocation
    : { ...normalizedLocation, description };
}

function normalizeViewportAlias(value: unknown) {
  const candidates = (Array.isArray(value) ? value : [value])
    .filter((viewport): viewport is string => typeof viewport === "string")
    .map((viewport) => viewport.trim())
    .filter((viewport, index, viewports) => {
      return viewport.length > 0 && viewports.indexOf(viewport) === index;
    });
  if (candidates.length === 0) return undefined;
  return truncateString(candidates.join("、"), 80);
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

function normalizeLocationDescription(location: Record<string, unknown>) {
  if (typeof location.description === "string") {
    const description = truncateString(location.description, 240);
    if (description.trim().length >= 2) return description;
  }
  if (typeof location.blockId === "string") {
    return truncateString(`内容块 ${location.blockId}`, 240);
  }
  if (typeof location.selector === "string") {
    return truncateString(`页面元素 ${location.selector}`, 240);
  }
  if (typeof location.viewport === "string") {
    return truncateString(`${location.viewport} 视口`, 240);
  }
  return "当前页面相关内容";
}

function truncateString(value: string, maxLength: number): string;
function truncateString(value: unknown, maxLength: number): unknown;
function truncateString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > maxLength
    ? value.slice(0, maxLength)
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    capability: "page-qa",
    maxTokens: 4_000,
    normalizeOutput: normalizePageQAModelOutput,
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
