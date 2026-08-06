import { z } from "zod";

import { validateHtmlEngineerOutput } from "@/server/agent/plugins/model-steps/course/html-engineer-model-step";
import { validatePageWriterOutput } from "@/server/agent/plugins/model-steps/course/page-writer-model-step";
import { isDeliveryBlockingQualityIssue } from "@/server/course/page/quality/report";
import { projectCourseArchitecture } from "@/server/course/projection/architecture";
import {
  AssetGenerationResultSchema,
  CourseArchitectureSchema,
  HtmlOutputSchema,
  PageContentDSLSchema,
  PageSummarySchema,
  QualityReportSchema,
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

  const projection = projectCourseArchitecture(
    architecture,
    input.creationBrief,
  );
  const page = projection.outline.pages.find(({ id }) => id === input.pageId);
  const brief = projection.pageWorkerBriefs.find(
    ({ pageId }) => pageId === input.pageId,
  );
  if (!page || !brief) {
    return failure(
      "PAGE_PROJECTION_MISSING",
      "pageId",
      "当前页面无法投影为 Page Builder 执行合同",
    );
  }

  try {
    validatePageWriterOutput(parsedContent.data, {
      intent: projection.intent,
      page,
      brief,
      referencePacks: [...input.referencePacks],
    });
  } catch (error) {
    issues.push({
      code: "PAGE_CONTENT_CONTRACT_FAILED",
      path: "content",
      message: errorMessage(error),
    });
  }

  validateAssetCoverage(
    parsedContent.data,
    parsedAssets.data,
    issues,
  );

  try {
    validateHtmlEngineerOutput(parsedHtml.data.html, {
      content: parsedContent.data,
      visualBrief: projection.briefs.visual,
      assets: parsedAssets.data,
    });
  } catch (error) {
    issues.push({
      code: "PAGE_HTML_CONTRACT_FAILED",
      path: "html.html",
      message: errorMessage(error),
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
        quality: parsedQuality.data,
      }),
    },
  };
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
  quality: QualityReport;
}) {
  const pageTask = input.architecture.pageTasks.find(
    ({ pageId }) => pageId === input.pageId,
  )!;
  const contentDigest = [
    input.content.title,
    ...input.content.narration,
    ...input.content.blocks.flatMap(({ heading, body, supportingPoints }) => [
      heading,
      body,
      ...supportingPoints,
    ]),
    ...summarizeInteraction(input.content.interaction),
  ]
    .join("；")
    .slice(0, 2_000);
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
    interactionType: pageTask.interactionType,
    usedReferences: input.content.usedReferences ?? [],
    quality: {
      overallScore: input.quality.overallScore,
      decision: input.quality.decision,
      issueCodes: input.quality.issues.map(({ code }) => code),
    },
  });
}

function summarizeInteraction(
  interaction: PageContentDSL["interaction"],
): string[] {
  switch (interaction.type) {
    case "none":
      return [];
    case "navigate":
      return [interaction.actionLabel];
    case "reveal":
    case "explore":
      return [
        interaction.prompt,
        ...interaction.items.flatMap(({ label, content }) => [label, content]),
      ];
    case "choice":
      return interaction.questions.flatMap((question) => {
        const correct = question.options.find(
          ({ id }) => id === question.correctOptionId,
        );
        return [
          question.prompt,
          ...(correct ? [correct.label] : []),
          question.feedback.success,
        ];
      });
    case "sort":
      return [
        interaction.prompt,
        ...interaction.items.flatMap(({ label, content }) => [label, content]),
        interaction.feedback.success,
      ];
    case "input":
      return [
        interaction.prompt,
        ...interaction.evaluationCriteria,
        interaction.feedback.success,
      ];
  }
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "页面合同校验失败";
}
