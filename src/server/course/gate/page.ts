import { z } from "zod";

import { isDeliveryBlockingQualityIssue } from "@/server/course/page/quality/report";
import { validatePageHtmlEnvelope } from "@/server/course/gate/page-html";
import {
  AssetGenerationResultSchema,
  CourseArchitectureSchema,
  HtmlOutputSchema,
  PageContentDSLSchema,
  PageSummarySchema,
  QualityReportSchema,
  validateReferenceUsages,
  type AssetGenerationResult,
  type CourseArchitecture,
  type CourseCreationBrief,
  type HtmlOutput,
  type PageContentDSL,
  type PageSummary,
  type QualityReport,
  type ReferencePack,
} from "@/shared/course-schema";

const PageAssetsSchema = z.array(AssetGenerationResultSchema).max(12);

export type PageGateIssue = {
  code: string;
  path: string;
  message: string;
};

export type AcceptedPagePayloads = {
  content: PageContentDSL;
  assets: AssetGenerationResult[];
  html: HtmlOutput;
  quality: QualityReport;
  summary: PageSummary;
};

export type PageGateResult =
  | { ok: true; payloads: AcceptedPagePayloads }
  | { ok: false; issues: PageGateIssue[] };

/**
 * Page Builder 不能自己宣布完成。这里重新解析全部页面产物，并复用现有
 * 内容、HTML、安全和质量规则；只有通过后 Repository 才能更新 current 指针。
 */
export function runPageGate(input: {
  architecture: CourseArchitecture;
  creationBrief: CourseCreationBrief;
  referencePacks: readonly ReferencePack[];
  pageId: string;
  content: unknown;
  assets: unknown;
  html: unknown;
  quality: unknown;
}): PageGateResult {
  const architecture = CourseArchitectureSchema.parse(input.architecture);
  const pageTask = architecture.pageTasks.find(
    ({ pageId }) => pageId === input.pageId,
  );
  if (!pageTask) {
    return failure(
      "PAGE_NOT_IN_ARCHITECTURE",
      "pageId",
      `当前课程架构中不存在页面 ${input.pageId}`,
    );
  }

  const parsedContent = PageContentDSLSchema.safeParse(input.content);
  const parsedAssets = PageAssetsSchema.safeParse(input.assets);
  const parsedHtml = HtmlOutputSchema.safeParse(input.html);
  const parsedQuality = QualityReportSchema.safeParse(input.quality);
  const issues: PageGateIssue[] = [
    ...schemaIssues("PAGE_CONTENT_INVALID", "content", parsedContent),
    ...schemaIssues("PAGE_ASSETS_INVALID", "assets", parsedAssets),
    ...schemaIssues("PAGE_HTML_INVALID", "html", parsedHtml),
    ...schemaIssues("PAGE_QUALITY_INVALID", "quality", parsedQuality),
  ];
  if (
    !parsedContent.success ||
    !parsedAssets.success ||
    !parsedHtml.success ||
    !parsedQuality.success
  ) {
    return { ok: false, issues };
  }

  validateAgentAuthoredContent(
    parsedContent.data,
    pageTask,
    input.referencePacks,
    issues,
  );

  validateAssetCoverage(
    parsedContent.data,
    parsedAssets.data,
    issues,
  );

  for (const issue of validatePageHtmlEnvelope(parsedHtml.data.html)) {
    issues.push({
      code: "PAGE_HTML_CONTRACT_FAILED",
      path: "html.html",
      message: issue.message,
    });
  }

  validateQuality(
    input.pageId,
    parsedQuality.data,
    issues,
  );

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    payloads: {
      content: parsedContent.data,
      assets: parsedAssets.data,
      html: parsedHtml.data,
      quality: parsedQuality.data,
      summary: buildPageSummary({
    architecture,
    pageId: input.pageId,
    content: parsedContent.data,
    html: parsedHtml.data.html,
    quality: parsedQuality.data,
      }),
    },
  };
}

function validateAgentAuthoredContent(
  content: PageContentDSL,
  pageTask: CourseArchitecture["pageTasks"][number],
  referencePacks: readonly ReferencePack[],
  issues: PageGateIssue[],
) {
  if (content.pageId !== pageTask.pageId) {
    issues.push({
      code: "PAGE_CONTENT_SCOPE_MISMATCH",
      path: "content.pageId",
      message: `页面内容必须属于 ${pageTask.pageId}`,
    });
  }
  const allowedByPack = new Map(
    pageTask.referenceUsages.map((usage) => [
      usage.referencePackId,
      new Set(usage.chunkIds),
    ]),
  );
  for (const message of validateReferenceUsages(
    content.usedReferences ?? [],
    [...referencePacks],
  )) {
    issues.push({
      code: "PAGE_REFERENCE_INVALID",
      path: "content.usedReferences",
      message,
    });
  }
  for (const usage of content.usedReferences ?? []) {
    const allowed = allowedByPack.get(usage.referencePackId);
    if (!allowed || usage.chunkIds.some((chunkId) => !allowed.has(chunkId))) {
      issues.push({
        code: "PAGE_REFERENCE_OUT_OF_SCOPE",
        path: "content.usedReferences",
        message: "页面只能引用当前 WorkOrder 已授权的资料片段。",
      });
    }
  }
}

function validateAssetCoverage(
  content: PageContentDSL,
  assets: AssetGenerationResult[],
  issues: PageGateIssue[],
) {
  const expected = content.assetSlots.map(({ id }) => id);
  const actual = assets.map(({ request }) => request.assetSlotId);
  if (
    expected.length !== actual.length ||
    new Set(actual).size !== actual.length ||
    expected.some((id) => !actual.includes(id))
  ) {
    issues.push({
      code: "PAGE_ASSET_COVERAGE_FAILED",
      path: "assets",
      message: "素材结果必须无重复地覆盖当前页面的全部素材槽",
    });
  }
}

function validateQuality(
  pageId: string,
  report: QualityReport,
  issues: PageGateIssue[],
) {
  if (report.target.type !== "page" || report.target.pageId !== pageId) {
    issues.push({
      code: "PAGE_QUALITY_SCOPE_MISMATCH",
      path: "quality.target",
      message: `质量报告必须只检查页面 ${pageId}`,
    });
  }
  const blockingIssues = report.issues.filter(
    isDeliveryBlockingQualityIssue,
  );
  if (report.shouldRepair || blockingIssues.length > 0) {
    issues.push({
      code: "PAGE_QUALITY_NOT_PASSED",
      path: "quality.decision",
      message: `页面仍有 ${blockingIssues.length} 个内容、安全、运行时或真实布局故障`,
    });
  }
}

function buildPageSummary(input: {
  architecture: CourseArchitecture;
  pageId: string;
  content: PageContentDSL;
  html: string;
  quality: QualityReport;
}) {
  const pageTask = input.architecture.pageTasks.find(
    ({ pageId }) => pageId === input.pageId,
  )!;
  const contentDigest = (
    summarizeVisibleHtml(input.html) || pageTask.purpose
  ).slice(0, 2_000);
  return PageSummarySchema.parse({
    courseId: input.architecture.courseId,
    pageId: pageTask.pageId,
    order: pageTask.order,
    title: pageTask.title,
    purpose: pageTask.purpose,
    objectiveIds: pageTask.objectiveIds,
    buildDependencyPageIds: pageTask.buildDependsOnPageIds,
    keyPoints: pageTask.teachingPoints,
    contentDigest,
    learnerAction: pageTask.learnerAction,
    assessment: pageTask.assessment,
    interactionType: input.content.interaction.type,
    usedReferences: input.content.usedReferences ?? [],
    quality: {
      overallScore: input.quality.overallScore,
      decision: input.quality.decision,
      issueCodes: input.quality.issues.map(({ code }) => code),
    },
  });
}

function summarizeVisibleHtml(html: string) {
  const visible = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, " ")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return visible;
}

function schemaIssues(
  code: string,
  path: string,
  result: z.ZodSafeParseResult<unknown>,
) {
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code,
    path: [path, ...issue.path].join("."),
    message: issue.message,
  }));
}

function failure(
  code: string,
  path: string,
  message: string,
): PageGateResult {
  return { ok: false, issues: [{ code, path, message }] };
}
