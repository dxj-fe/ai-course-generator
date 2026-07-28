import {
  MAX_REPAIR_ATTEMPTS,
  RepairRequestSchema,
  type AssetGenerationResult,
  type PageContentDSL,
  type QualityDimensionName,
  type QualityIssue,
  type QualityReport,
  type RepairFailureClass,
  type RepairRequest,
  type VisualBrief,
} from "@/shared/course-schema";
import { PAGE_QUALITY_THRESHOLDS } from "@/server/quality/page-quality";

const DSL_DIMENSIONS = new Set(["contentAccuracy", "courseCoherence"]);
const HTML_DIMENSIONS = new Set([
  "layoutQuality",
  "styleConsistency",
  "htmlRuntime",
]);
const UPSTREAM_ASSET_CODES = new Set([
  "ASSET_RESULT_MISSING",
  "ASSET_FALLBACK_USED",
]);
const HTML_ASSET_PRESENTATION_CODES = new Set([
  "BROWSER_VISUAL_DOMINATES_VIEWPORT",
  "BROWSER_VISUAL_TOO_SMALL",
]);
const CSS_PRESENTATION_ISSUE_CODES = new Set([
  "ASSET_OVERDOMINATES",
  "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
  "BROWSER_TOUCH_TARGET_UNDER_24",
  "BROWSER_TOUCH_TARGET_UNDER_44",
  "BROWSER_VISUAL_DOMINATES_VIEWPORT",
  "BROWSER_VISUAL_TOO_SMALL",
  "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
  "CSS_DUPLICATE_RULE",
  "DUPLICATE_CSS_RULE",
  "LAYOUT_CLIPPING_RISK",
  "LAYOUT_PRIMARY_ACTION_BELOW_FOLD",
  "PRIMARY_ACTION_BELOW_FOLD",
  "TOO_SMALL_TOUCH_TARGET",
  "TOUCH_TARGET_INSUFFICIENT",
  "TOUCH_TARGET_TOO_SMALL",
]);

export type RepairPlanningFailure = {
  status: "unavailable";
  failureClass: RepairFailureClass;
  message: string;
};

export type RepairQualityVector = {
  errorCount: number;
  thresholdDeficit: number;
  overallScore: number;
  actionableIssueSignature: string[];
  deterministicBrowserErrorSignature: string[];
};

/** 把最新 QA 报告确定性路由到一个最小修复目标；模型不能选择修复范围。 */
export function planRepairRound(input: {
  pageId: string;
  content: PageContentDSL;
  html: string;
  visualBrief: VisualBrief;
  assets: AssetGenerationResult[];
  report: QualityReport;
  attemptCount: number;
}): RepairRequest | RepairPlanningFailure {
  if (input.attemptCount >= MAX_REPAIR_ATTEMPTS) {
    return {
      status: "unavailable",
      failureClass: "safety_limit",
      message: `页面 ${input.pageId} 的 Repair 已触发 ${MAX_REPAIR_ATTEMPTS} 次安全熔断上限。`,
    };
  }

  const actionableIssues = input.report.issues.filter((issue) =>
    contributesToRepairDecision(issue, input.report),
  );
  const semanticIssues = actionableIssues.filter((issue) =>
    DSL_DIMENSIONS.has(issue.dimension),
  );
  let unlocatableSemanticFailure: RepairPlanningFailure | undefined;
  if (semanticIssues.length > 0) {
    const located = semanticIssues.filter(({ location }) => location.blockId);
    const narrationIssues = semanticIssues.filter((issue) =>
      isNarrationRepairIssue(issue, input.content),
    );
    const interactionIssues = semanticIssues.filter((issue) =>
      isInteractionRepairIssue(issue, input.content),
    );
    const dslIssues = uniqueByCode([
      ...located,
      ...narrationIssues,
      ...interactionIssues,
    ]);
    if (dslIssues.length > 0) {
      return request(input, "dsl", dslIssues, {
        allowedBlockIds: unique(
          located.flatMap(({ location }) => location.blockId ?? []),
        ),
        allowedContentFields: [
          ...(narrationIssues.length > 0 ? (["narration"] as const) : []),
          ...(interactionIssues.length > 0 ? (["interaction"] as const) : []),
        ],
        allowedSelectors: [],
      });
    }

    if (!semanticIssues.some(({ location }) => location.selector)) {
      unlocatableSemanticFailure = {
        status: "unavailable",
        failureClass: "unlocatable_issue",
        message: "内容或教学问题没有可授权的 blockId，拒绝盲目重写 DSL。",
      };
    }
  }

  const hasUpstreamAssetIssue = actionableIssues.some(
    (issue) =>
      issue.dimension === "assetUsability" &&
      UPSTREAM_ASSET_CODES.has(issue.code),
  );
  const htmlIssues = actionableIssues.filter(
    (issue) =>
      isHtmlRepairable(issue) &&
      !(hasUpstreamAssetIssue && issue.dimension === "assetUsability"),
  );
  if (htmlIssues.length > 0) {
    return request(input, "html", htmlIssues, {
      allowedBlockIds: [],
      allowedContentFields: [],
      allowedSelectors: unique(
        htmlIssues.map(defaultSelector).filter((value): value is string => Boolean(value)),
      ),
    });
  }

  if (hasUpstreamAssetIssue) {
    return {
      status: "unavailable",
      failureClass: "unsupported_asset_issue",
      message: "素材 Provider 或素材可用性问题必须由 Assets 阶段处理，Repair 不伪造素材。",
    };
  }

  if (unlocatableSemanticFailure) return unlocatableSemanticFailure;

  return {
    status: "unavailable",
    failureClass: "unlocatable_issue",
    message: "QualityReport 要求修订，但没有可定位且受支持的 Repair issue。",
  };
}

/** Repair 只处理触发本轮 revise 的问题，不把旁路 warning 搭车进候选范围。 */
function contributesToRepairDecision(
  issue: QualityIssue,
  report: QualityReport,
) {
  if (issue.severity === "error") return true;

  return (
    report.dimensions[issue.dimension].score <
    PAGE_QUALITY_THRESHOLDS[issue.dimension]
  );
}

function request(
  input: Parameters<typeof planRepairRound>[0],
  targetArtifact: "dsl" | "html",
  issues: QualityIssue[],
  scope: Pick<
    RepairRequest,
    "allowedBlockIds" | "allowedContentFields" | "allowedSelectors"
  >,
) {
  return RepairRequestSchema.parse({
    pageId: input.pageId,
    targetArtifact,
    round: input.attemptCount + 1,
    maxRounds: MAX_REPAIR_ATTEMPTS,
    sourceReport: input.report,
    issueCodes: unique(issues.map(({ code }) => code)),
    ...scope,
    content: input.content,
    html: input.html,
    visualBrief: input.visualBrief,
    assets: input.assets,
  });
}

function isNarrationRepairIssue(
  issue: QualityIssue,
  content: PageContentDSL,
) {
  const selector = issue.location.selector ?? "";
  return (
    /(?:^|[-_])narration(?:$|[-_])/i.test(selector) ||
    (content.blocks.length === 0 &&
      (issue.code === "OBJECTIVE_COVERAGE_GAP" ||
        (issue.code === "CORE_LEARNING_TARGETS_MISSING" &&
          content.functionalTemplateId === "course-cover")))
  );
}

function isInteractionRepairIssue(
  issue: QualityIssue,
  content: PageContentDSL,
) {
  if (
    content.interaction.type === "none" ||
    content.interaction.type === "navigate"
  ) {
    return false;
  }

  const selector = issue.location.selector ?? "";
  if (!/(?:interaction|quiz|choice|question|exercise|answer)/i.test(selector)) {
    return false;
  }

  return /(?:OBJECTIVE|CHECK|QUESTION|ANSWER|FEEDBACK|DISTRACTOR|ASSESSMENT)/i.test(
    issue.code,
  );
}

function isHtmlRepairable(issue: QualityIssue) {
  if (HTML_DIMENSIONS.has(issue.dimension)) return true;
  if (DSL_DIMENSIONS.has(issue.dimension)) {
    return Boolean(issue.location.selector) && !issue.location.blockId;
  }
  return (
    issue.dimension === "assetUsability" &&
    !UPSTREAM_ASSET_CODES.has(issue.code) &&
    (Boolean(issue.location.selector) ||
      HTML_ASSET_PRESENTATION_CODES.has(issue.code))
  );
}

function defaultSelector(issue: QualityIssue) {
  if (CSS_PRESENTATION_ISSUE_CODES.has(issue.code)) return "style";
  if (issue.location.selector) return issue.location.selector;
  if (issue.dimension === "layoutQuality" || issue.dimension === "styleConsistency") {
    return "style";
  }
  if (issue.dimension === "htmlRuntime") return "html";
  if (HTML_ASSET_PRESENTATION_CODES.has(issue.code)) return "style";
  return undefined;
}

export function buildRepairQualityVector(
  report: QualityReport,
): RepairQualityVector {
  const issueSignature = (issue: QualityIssue) =>
    [
      issue.code,
      issue.dimension,
      issue.severity,
      issue.location.blockId ?? "",
      issue.location.selector ?? "",
      issue.location.viewport ?? "",
    ].join(":");

  return {
    errorCount: report.issues.filter(({ severity }) => severity === "error")
      .length,
    thresholdDeficit: (
      Object.keys(PAGE_QUALITY_THRESHOLDS) as QualityDimensionName[]
    ).reduce(
      (total, dimension) =>
        total +
        deficit(
          report.dimensions[dimension].score,
          PAGE_QUALITY_THRESHOLDS[dimension],
        ),
      0,
    ),
    overallScore: report.overallScore,
    actionableIssueSignature: report.issues
      .filter((issue) => contributesToRepairDecision(issue, report))
      .map(issueSignature)
      .sort(),
    deterministicBrowserErrorSignature: report.issues
      .filter(
        ({ code, severity, source }) =>
          source === "browser" &&
          severity === "error" &&
          code.startsWith("BROWSER_"),
      )
      .map(issueSignature)
      .sort(),
  };
}

/** 只把确定性质量向量的严格改善视为进展，模型分数波动不会掩盖退化。 */
export function didRepairQualityImprove(
  before: QualityReport,
  after: QualityReport,
) {
  const previous = buildRepairQualityVector(before);
  const next = buildRepairQualityVector(after);

  if (
    previous.deterministicBrowserErrorSignature.length > 0 &&
    next.deterministicBrowserErrorSignature.length > 0 &&
    !isStrictSubset(
      next.deterministicBrowserErrorSignature,
      previous.deterministicBrowserErrorSignature,
    )
  ) {
    return false;
  }

  if (next.errorCount !== previous.errorCount) {
    return next.errorCount < previous.errorCount;
  }
  if (next.thresholdDeficit !== previous.thresholdDeficit) {
    return next.thresholdDeficit < previous.thresholdDeficit;
  }
  return isStrictSubset(
    next.actionableIssueSignature,
    previous.actionableIssueSignature,
  );
}

function deficit(score: number, threshold: number) {
  return Math.max(0, threshold - score);
}

function isStrictSubset(candidate: string[], source: string[]) {
  if (candidate.length >= source.length) return false;
  const sourceValues = new Set(source);
  return candidate.every((value) => sourceValues.has(value));
}

function unique<Value>(values: Value[]) {
  return [...new Set(values)];
}

function uniqueByCode(issues: QualityIssue[]) {
  const seen = new Set<string>();
  return issues.filter(({ code }) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}
