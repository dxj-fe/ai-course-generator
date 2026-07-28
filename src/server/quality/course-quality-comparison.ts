import type { CourseGenerationState, QualityReport } from "@/shared/course-schema";

export type CourseQualityMetrics = {
  pageCount: number;
  qaPageCount: number;
  capturedPageCount: number;
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
  const compositeScore = clamp(
    averageOverallScore * 0.45 +
      averageVisualScore * 0.35 +
      screenshotCaptureRate * 100 * 0.2 -
      errorCount * 2,
    0,
    100,
  );

  return {
    pageCount: course.pages.length,
    qaPageCount: reports.length,
    capturedPageCount,
    screenshotCaptureRate: round(screenshotCaptureRate),
    averageOverallScore: round(averageOverallScore),
    averageVisualScore: round(averageVisualScore),
    errorCount,
    visualErrorCount,
    interactionErrorCount,
    compositeScore: round(compositeScore),
  };
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
