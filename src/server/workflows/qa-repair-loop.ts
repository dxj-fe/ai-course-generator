import {
  MAX_REPAIR_ROUNDS,
  RepairRequestSchema,
  type AssetGenerationResult,
  type PageContentDSL,
  type QualityIssue,
  type QualityReport,
  type RepairFailureClass,
  type RepairRequest,
  type VisualBrief,
} from "@/shared/course-schema";

const DSL_DIMENSIONS = new Set(["contentAccuracy", "courseCoherence"]);
const HTML_DIMENSIONS = new Set([
  "layoutQuality",
  "styleConsistency",
  "htmlRuntime",
]);
const UPSTREAM_ASSET_CODES = new Set([
  "ASSET_RESULT_MISSING",
  "ASSET_FALLBACK_USED",
  "ASSET_TRANSPARENCY_UNAVAILABLE",
]);

export type RepairPlanningFailure = {
  status: "unavailable";
  failureClass: RepairFailureClass;
  message: string;
};

/** 把最新 QA 报告确定性路由到一个最小修复目标；模型不能选择修复范围。 */
export function planRepairRound(input: {
  pageId: string;
  content: PageContentDSL;
  html: string;
  visualBrief: VisualBrief;
  assets: AssetGenerationResult[];
  report: QualityReport;
  completedRounds: number;
}): RepairRequest | RepairPlanningFailure {
  if (input.completedRounds >= MAX_REPAIR_ROUNDS) {
    return {
      status: "unavailable",
      failureClass: "budget_exhausted",
      message: `页面 ${input.pageId} 已达到 ${MAX_REPAIR_ROUNDS} 轮 Repair 预算。`,
    };
  }

  const semanticIssues = input.report.issues.filter((issue) =>
    DSL_DIMENSIONS.has(issue.dimension),
  );
  if (semanticIssues.length > 0) {
    const located = semanticIssues.filter(({ location }) => location.blockId);
    if (located.length === 0) {
      return {
        status: "unavailable",
        failureClass: "unlocatable_issue",
        message: "内容或教学问题没有可授权的 blockId，拒绝盲目重写 DSL。",
      };
    }
    return request(input, "dsl", located, {
      allowedBlockIds: unique(
        located.flatMap(({ location }) => location.blockId ?? []),
      ),
      allowedSelectors: [],
    });
  }

  const hasUpstreamAssetIssue = input.report.issues.some(
    (issue) =>
      issue.dimension === "assetUsability" &&
      UPSTREAM_ASSET_CODES.has(issue.code),
  );
  const htmlIssues = input.report.issues.filter(
    (issue) =>
      isHtmlRepairable(issue) &&
      !(hasUpstreamAssetIssue && issue.dimension === "assetUsability"),
  );
  if (htmlIssues.length > 0) {
    return request(input, "html", htmlIssues, {
      allowedBlockIds: [],
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

  return {
    status: "unavailable",
    failureClass: "unlocatable_issue",
    message: "QualityReport 要求修订，但没有可定位且受支持的 Repair issue。",
  };
}

function request(
  input: Parameters<typeof planRepairRound>[0],
  targetArtifact: "dsl" | "html",
  issues: QualityIssue[],
  scope: Pick<RepairRequest, "allowedBlockIds" | "allowedSelectors">,
) {
  return RepairRequestSchema.parse({
    pageId: input.pageId,
    targetArtifact,
    round: input.completedRounds + 1,
    maxRounds: MAX_REPAIR_ROUNDS,
    sourceReport: input.report,
    issueCodes: unique(issues.map(({ code }) => code)),
    ...scope,
    content: input.content,
    html: input.html,
    visualBrief: input.visualBrief,
    assets: input.assets,
  });
}

function isHtmlRepairable(issue: QualityIssue) {
  if (HTML_DIMENSIONS.has(issue.dimension)) return true;
  return (
    issue.dimension === "assetUsability" &&
    !UPSTREAM_ASSET_CODES.has(issue.code) &&
    Boolean(issue.location.selector)
  );
}

function defaultSelector(issue: QualityIssue) {
  if (issue.location.selector) return issue.location.selector;
  if (issue.dimension === "layoutQuality" || issue.dimension === "styleConsistency") {
    return "style";
  }
  if (issue.dimension === "htmlRuntime") return "html";
  return undefined;
}

function unique<Value>(values: Value[]) {
  return [...new Set(values)];
}
