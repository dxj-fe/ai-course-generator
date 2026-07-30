import {
  QualityReportSchema,
  type QualityDimension,
  type QualityDimensionName,
  type QualityIssue,
  type QualityReport,
  type QualityScreenshotEvidence,
} from "@/shared/course-schema";

export const PAGE_QUALITY_WEIGHTS = {
  contentAccuracy: 0.3,
  layoutQuality: 0.22,
  courseCoherence: 0.17,
  styleConsistency: 0.13,
  htmlRuntime: 0.1,
  assetUsability: 0.08,
} as const satisfies Record<QualityDimensionName, number>;

/**
 * 六维分数的期望目标，用于观测课程质量和比较有证据的 Repair 前后变化。
 * 分数本身不是返工授权；真正需要返工的问题必须同时给出可定位的 error 证据。
 */
export const PAGE_QUALITY_TARGETS = {
  contentAccuracy: 88,
  courseCoherence: 88,
  layoutQuality: 82,
  styleConsistency: 82,
  htmlRuntime: 92,
  assetUsability: 80,
} as const satisfies Record<QualityDimensionName, number>;

type QualityDimensions = Record<
  QualityDimensionName,
  Pick<QualityDimension, "score" | "summary">
>;

const DIMENSION_PRIORITY: Record<QualityDimensionName, number> = {
  contentAccuracy: 0,
  courseCoherence: 1,
  htmlRuntime: 2,
  layoutQuality: 3,
  styleConsistency: 4,
  assetUsability: 5,
};

const SEVERITY_PRIORITY = { error: 0, warning: 1, info: 2 } as const;

/** 合并确定性与模型证据，并由代码统一计算观测分数和交付决策。 */
export function buildPageQualityReport(input: {
  pageId: string;
  modelDimensions: QualityDimensions;
  heuristicIssues: QualityIssue[];
  modelIssues: QualityIssue[];
  browserIssues?: QualityIssue[];
  screenshotEvidence?: QualityScreenshotEvidence;
  requireScreenshotEvidence?: boolean;
  id?: string;
  createdAt?: string;
}): QualityReport {
  const browserIssueCodes = new Set(
    (input.browserIssues ?? []).map(({ code }) => code),
  );
  const issues = dedupeIssues([
    ...input.heuristicIssues,
    ...screenshotGateIssues(input),
    ...(input.browserIssues ?? []),
    ...input.modelIssues.filter(
      ({ code }) =>
        !(
          isBrowserOwnedIssueCode(code) &&
          browserIssueCodes.has(code)
        ),
    ),
  ])
    .sort(compareQualityIssues)
    .slice(0, 50);
  const dimensions = attachDimensionEvidence(
    applyIssueCaps(input.modelDimensions, issues),
    issues,
  );
  const overallScore = Math.round(
    (Object.keys(PAGE_QUALITY_WEIGHTS) as QualityDimensionName[]).reduce(
      (score, dimension) =>
        score + dimensions[dimension].score * PAGE_QUALITY_WEIGHTS[dimension],
      0,
    ),
  );
  const shouldRepair = issues.some(
    ({ severity }) => severity === "error",
  );
  const hardFailure = issues.some(
    ({ code, severity }) =>
      severity === "error" &&
      (code.startsWith("HTML_CONTRACT_") ||
        code.startsWith("HTML_SAFETY_")),
  );

  return QualityReportSchema.parse({
    id: input.id ?? `quality-${input.pageId}-${crypto.randomUUID()}`,
    target: { type: "page", pageId: input.pageId },
    overallScore,
    dimensions,
    issues,
    screenshotEvidence: input.screenshotEvidence,
    shouldRepair,
    decision: hardFailure ? "fail" : shouldRepair ? "revise" : "pass",
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

function isBrowserOwnedIssueCode(code: string) {
  return code.startsWith("BROWSER_") || code.startsWith("SCREENSHOT_");
}

function screenshotGateIssues(input: {
  pageId: string;
  screenshotEvidence?: QualityScreenshotEvidence;
  requireScreenshotEvidence?: boolean;
}): QualityIssue[] {
  if (input.requireScreenshotEvidence === false) return [];
  const evidence = input.screenshotEvidence;
  if (!evidence) {
    return [
      {
        code: "SCREENSHOT_EVIDENCE_MISSING",
        dimension: "layoutQuality",
        severity: "error",
        source: "browser",
        message: "页面缺少强制截图证据，不能通过质量闸门。",
        location: {
          pageId: input.pageId,
          description: "页面视觉质量闸门",
        },
        repairHint: "在真实播放器、平板和移动视口完成截图后重新运行 QA。",
      },
    ];
  }

  const captures = evidence.captures ?? [evidence];
  return captures.flatMap((capture) =>
    capture.status === "captured"
      ? []
      : [
          {
            code:
              capture.status === "skipped"
                ? "SCREENSHOT_CAPTURE_SKIPPED"
                : "SCREENSHOT_CAPTURE_FAILED",
            dimension: "layoutQuality" as const,
            severity: "error" as const,
            source: "browser" as const,
            message: `截图证据${capture.status === "skipped" ? "被跳过" : "采集失败"}，当前页面不能通过。`,
            location: {
              pageId: input.pageId,
              viewport: `${capture.viewport.width}x${capture.viewport.height}`,
              description: "强制截图质量证据",
            },
            repairHint:
              "恢复 Playwright 与截图存储后，在全部要求视口重新采集并复验。",
          },
        ],
  );
}

function applyIssueCaps(
  dimensions: QualityDimensions,
  issues: QualityIssue[],
): QualityDimensions {
  return Object.fromEntries(
    (Object.keys(PAGE_QUALITY_WEIGHTS) as QualityDimensionName[]).map(
      (dimension) => {
        const severities = issues
          .filter((issue) => issue.dimension === dimension)
          .map(({ severity }) => severity);
        const cap = severities.includes("error")
          ? 69
          : severities.includes("warning")
            ? 84
            : severities.includes("info")
              ? 94
              : 100;

        return [
          dimension,
          {
            ...dimensions[dimension],
            score: Math.min(dimensions[dimension].score, cap),
          },
        ];
      },
    ),
  ) as QualityDimensions;
}

function attachDimensionEvidence(
  dimensions: QualityDimensions,
  issues: QualityIssue[],
): Record<QualityDimensionName, QualityDimension> {
  return Object.fromEntries(
    (Object.keys(PAGE_QUALITY_WEIGHTS) as QualityDimensionName[]).map(
      (dimension) => {
        const dimensionIssues = issues.filter(
          (issue) => issue.dimension === dimension,
        );
        return [
          dimension,
          {
            ...dimensions[dimension],
            issueCodes: dimensionIssues.map(({ code }) => code),
            repairHints: [...new Set(dimensionIssues.map(({ repairHint }) => repairHint))],
          },
        ];
      },
    ),
  ) as Record<QualityDimensionName, QualityDimension>;
}

/** 内容错误先于一切视觉问题，其余问题遵循严重度和稳定维度顺序。 */
export function compareQualityIssues(left: QualityIssue, right: QualityIssue) {
  const leftContentError =
    left.dimension === "contentAccuracy" && left.severity === "error";
  const rightContentError =
    right.dimension === "contentAccuracy" && right.severity === "error";
  if (leftContentError !== rightContentError) return leftContentError ? -1 : 1;

  const severity =
    SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity];
  if (severity !== 0) return severity;

  const dimension =
    DIMENSION_PRIORITY[left.dimension] - DIMENSION_PRIORITY[right.dimension];
  if (dimension !== 0) return dimension;

  return issueStableKey(left).localeCompare(issueStableKey(right));
}

function dedupeIssues(issues: QualityIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.location.pageId,
      issue.location.blockId,
      issue.location.selector,
      issue.location.viewport,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function issueStableKey(issue: QualityIssue) {
  return [
    issue.code,
    issue.location.pageId,
    issue.location.blockId,
    issue.location.selector,
    issue.location.viewport,
    issue.location.description,
  ].join(":");
}
