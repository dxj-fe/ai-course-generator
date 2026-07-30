import type { CourseGenerationState, QualityReport } from "@/shared/course-schema";

export type CourseQualityMetrics = {
  pageCount: number;
  qaPageCount: number;
  capturedPageCount: number;
  firstPassAcceptedPageCount: number;
  firstPassAcceptanceRate: number;
  modelFirstPassAcceptedPageCount: number;
  modelFirstPassAcceptanceRate: number;
  modelRenderedPageCount: number;
  modelRenderRate: number;
  requestedAssetCount: number;
  readyAssetCount: number;
  fallbackAssetCount: number;
  assetReadyRate: number;
  architectureAttemptCount: number;
  architectureRevisionCount: number;
  replanCount: number;
  courseRevisionCount: number;
  courseFirstPassAccepted: boolean;
  repairAttemptCount: number;
  averageRepairAttempts: number;
  screenshotCaptureRate: number;
  averageOverallScore: number;
  averageVisualScore: number;
  errorCount: number;
  visualErrorCount: number;
  interactionErrorCount: number;
  compositeScore: number;
};

export type CourseQualityComparison = {
  baselineCourseId: string;
  candidateCourseId: string;
  winner: "baseline" | "candidate" | "tie";
  scoreDelta: number;
  baseline: CourseQualityMetrics;
  candidate: CourseQualityMetrics;
  pageComparisons: Array<{
    order: number;
    baselinePageId?: string;
    candidatePageId?: string;
    baselineScore?: number;
    candidateScore?: number;
    winner: "baseline" | "candidate" | "tie" | "missing";
  }>;
};

/** 对同一基准提示词的两个持久化课程做确定性、证据驱动的成对回归比较。 */
export function compareCourseQuality(
  baseline: CourseGenerationState,
  candidate: CourseGenerationState,
): CourseQualityComparison {
  const baselineMetrics = summarizeCourseQuality(baseline);
  const candidateMetrics = summarizeCourseQuality(candidate);
  const scoreDelta = round(
    candidateMetrics.compositeScore - baselineMetrics.compositeScore,
  );
  const baselinePages = new Map(
    baseline.pages.map((page) => [page.order, page]),
  );
  const candidatePages = new Map(
    candidate.pages.map((page) => [page.order, page]),
  );
  const orders = [
    ...new Set([...baselinePages.keys(), ...candidatePages.keys()]),
  ].sort((left, right) => left - right);

  return {
    baselineCourseId: baseline.courseId,
    candidateCourseId: candidate.courseId,
    winner:
      scoreDelta > 1 ? "candidate" : scoreDelta < -1 ? "baseline" : "tie",
    scoreDelta,
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    pageComparisons: orders.map((order) => {
      const baselinePage = baselinePages.get(order);
      const candidatePage = candidatePages.get(order);
      const baselineScore = baselinePage?.qualityReport
        ? visualPageScore(baselinePage.qualityReport)
        : undefined;
      const candidateScore = candidatePage?.qualityReport
        ? visualPageScore(candidatePage.qualityReport)
        : undefined;
      return {
        order,
        baselinePageId: baselinePage?.pageId,
        candidatePageId: candidatePage?.pageId,
        baselineScore,
        candidateScore,
        winner:
          baselineScore === undefined || candidateScore === undefined
            ? "missing"
            : candidateScore > baselineScore + 1
              ? "candidate"
              : baselineScore > candidateScore + 1
                ? "baseline"
                : "tie",
      };
    }),
  };
}

export function summarizeCourseQuality(
  course: CourseGenerationState,
): CourseQualityMetrics {
  const reports = course.pages.flatMap(({ qualityReport }) =>
    qualityReport ? [qualityReport] : [],
  );
  const capturedPageCount = reports.filter((report) =>
    allRequiredScreenshotsCaptured(report),
  ).length;
  const repairAttemptCount = course.pages.reduce(
    (total, page) =>
      total +
      (page.repairAttemptCount ??
        page.repairHistory?.length ??
        0),
    0,
  );
  const firstPassAcceptedPageCount = course.pages.filter(
    (page) =>
      page.qualityReport?.decision === "pass" &&
      (page.repairAttemptCount ??
        page.repairHistory?.length ??
        0) === 0,
  ).length;
  const modelRenderedPageCount = course.pages.filter(
    ({ htmlOutput }) =>
      htmlOutput && !isDeterministicPageHtml(htmlOutput.html),
  ).length;
  const requestedAssetCount = course.pages.reduce(
    (total, page) => total + page.assets.length,
    0,
  );
  const readyAssetCount = course.pages.reduce(
    (total, page) =>
      total + page.assets.filter(({ status }) => status === "ready").length,
    0,
  );
  const fallbackAssetCount = requestedAssetCount - readyAssetCount;
  const modelFirstPassAcceptedPageCount = course.pages.filter(
    (page) =>
      page.qualityReport?.decision === "pass" &&
      (page.repairAttemptCount ??
        page.repairHistory?.length ??
        0) === 0 &&
      Boolean(page.htmlOutput) &&
      !isDeterministicPageHtml(page.htmlOutput!.html) &&
      page.assets.every(({ status }) => status === "ready"),
  ).length;
  const issues = reports.flatMap(({ issues }) => issues);
  const errorCount = issues.filter(({ severity }) => severity === "error").length;
  const visualErrorCount = issues.filter(
    ({ dimension, severity }) =>
      severity === "error" &&
      ["layoutQuality", "styleConsistency", "assetUsability"].includes(
        dimension,
      ),
  ).length;
  const interactionErrorCount = issues.filter(
    ({ code, severity }) =>
      severity === "error" &&
      (code.includes("INTERACTION") || code.includes("FEEDBACK")),
  ).length;
  const averageOverallScore = average(
    reports.map(({ overallScore }) => overallScore),
  );
  const averageVisualScore = average(reports.map(visualPageScore));
  const screenshotCaptureRate =
    reports.length > 0 ? capturedPageCount / reports.length : 0;
  const firstPassAcceptanceRate =
    reports.length > 0
      ? firstPassAcceptedPageCount / reports.length
      : 0;
  const modelFirstPassAcceptanceRate =
    reports.length > 0
      ? modelFirstPassAcceptedPageCount / reports.length
      : 0;
  const modelRenderRate =
    course.pages.length > 0
      ? modelRenderedPageCount / course.pages.length
      : 0;
  const assetReadyRate =
    requestedAssetCount > 0
      ? readyAssetCount / requestedAssetCount
      : 1;
  const averageRepairAttempts =
    reports.length > 0 ? repairAttemptCount / reports.length : 0;
  const architectureAttemptCount =
    course.generationMetrics?.architectureAttemptCount ?? 0;
  const architectureRevisionCount =
    course.generationMetrics?.architectureRevisionCount ?? 0;
  const replanCount = course.generationMetrics?.replanCount ?? 0;
  const courseRevisionCount =
    course.generationMetrics?.courseRevisionCount ?? 0;
  const courseFirstPassAccepted =
    course.status === "completed" &&
    architectureAttemptCount === 1 &&
    replanCount === 0 &&
    courseRevisionCount === 0 &&
    modelFirstPassAcceptedPageCount === course.pages.length;
  const compositeScore = clamp(
    averageOverallScore * 0.35 +
      averageVisualScore * 0.25 +
      screenshotCaptureRate * 100 * 0.15 +
      modelFirstPassAcceptanceRate * 100 * 0.15 +
      modelRenderRate * 100 * 0.05 +
      assetReadyRate * 100 * 0.05 -
      errorCount * 2 -
      averageRepairAttempts * 2 -
      architectureRevisionCount * 3 -
      replanCount * 5 -
      courseRevisionCount * 3,
    0,
    100,
  );

  return {
    pageCount: course.pages.length,
    qaPageCount: reports.length,
    capturedPageCount,
    firstPassAcceptedPageCount,
    firstPassAcceptanceRate: round(firstPassAcceptanceRate),
    modelFirstPassAcceptedPageCount,
    modelFirstPassAcceptanceRate: round(
      modelFirstPassAcceptanceRate,
    ),
    modelRenderedPageCount,
    modelRenderRate: round(modelRenderRate),
    requestedAssetCount,
    readyAssetCount,
    fallbackAssetCount,
    assetReadyRate: round(assetReadyRate),
    architectureAttemptCount,
    architectureRevisionCount,
    replanCount,
    courseRevisionCount,
    courseFirstPassAccepted,
    repairAttemptCount,
    averageRepairAttempts: round(averageRepairAttempts),
    screenshotCaptureRate: round(screenshotCaptureRate),
    averageOverallScore: round(averageOverallScore),
    averageVisualScore: round(averageVisualScore),
    errorCount,
    visualErrorCount,
    interactionErrorCount,
    compositeScore: round(compositeScore),
  };
}

export function isDeterministicPageHtml(html: string) {
  return /\bdata-keya-renderer\s*=\s*["']deterministic["']/i.test(
    html,
  );
}

function visualPageScore(report: QualityReport) {
  return round(
    report.dimensions.layoutQuality.score * 0.45 +
      report.dimensions.styleConsistency.score * 0.3 +
      report.dimensions.assetUsability.score * 0.25,
  );
}

function allRequiredScreenshotsCaptured(report: QualityReport) {
  const evidence = report.screenshotEvidence;
  if (!evidence) return false;
  return (evidence.captures ?? [evidence]).every(
    ({ status }) => status === "captured",
  );
}

function average(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
