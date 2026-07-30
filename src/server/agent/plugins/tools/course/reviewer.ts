import { tool } from "ai";
import { z } from "zod";

import { ToolIds } from "@/server/agent/ids";
import {
  runCourseReviewGate,
  type CourseGateIssue,
} from "@/server/course/gate/review";
import { classifyPublicAgentError } from "@/server/course/projection/public-error";
import { createCourseRunCommands } from "@/server/course/run/commands";
import {
  collectCourseReviewerEvidenceContractConflicts,
  collectUnreadCourseReviewerEvidenceIssues,
  COURSE_REVIEWER_PAGE_BATCH_LIMIT,
  loadCourseReviewerSnapshot,
  type CourseReviewerExecution,
} from "@/server/agent/plugins/contexts/course/reviewer";
import {
  FatalAgentRuntimeError,
  type AgentToolResult,
} from "@/server/agent/runtime";
import {
  CourseReviewSchema,
  type ArtifactRef,
  type CourseReview,
  type PageSummary,
  type QualityReport,
} from "@/shared/course-schema";

const EmptyInputSchema = z.object({}).strict();

const PageSelectionSchema = z
  .object({
    pageId: z.string().min(1).max(80).optional(),
    offset: z.number().int().nonnegative().default(0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(COURSE_REVIEWER_PAGE_BATCH_LIMIT)
      .default(COURSE_REVIEWER_PAGE_BATCH_LIMIT),
  })
  .strict();

const PageEvidenceInputSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    focus: z
      .enum([
        "objective",
        "continuity",
        "fact",
        "interaction",
        "visual",
      ])
      .default("continuity"),
  })
  .strict();

const ReviewCandidateInputSchema = z
  .object({
    review: z.unknown().describe("完整 CourseReview 候选对象"),
  })
  .strict();

const BlockReviewInputSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(2).max(500),
    evidence: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  })
  .strict();

export type ReviewerFinding = {
  code: string;
  evidenceArtifactRefs: ArtifactRef[];
  message: string;
  pageId?: string;
  scope: "course" | "page";
  severity: "warning" | "error";
  suggestedAction: string;
  targetArtifact?: "page_content" | "page_html";
};

export function createCourseReviewerTools(
  execution: CourseReviewerExecution,
  dependencies: {
    now?: () => string;
  } = {},
) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const commands = createCourseRunCommands(execution.repository);

  return {
    [ToolIds.ReadCourseMatrix]: tool({
      description:
        "读取整课目标、统一规则、事实底稿和目标到页面的计划矩阵。返回的是当前 accepted Architecture，不是旧计划。",
      inputSchema: EmptyInputSchema,
      execute: () => {
        const { architecture, manifest } =
          loadCourseReviewerSnapshot(execution);
        execution.evidenceReadProgress.courseMatrixRead = true;
        return success("已读取当前课程目标和页面职责矩阵。", {
          evidenceArtifactRefs: [manifest.architectureRef],
          title: architecture.blueprint.title,
          audience: architecture.blueprint.audience,
          objectives: architecture.blueprint.objectives,
          courseRules: architecture.blueprint.courseRules,
          facts: architecture.coursePack.facts,
          terms: architecture.coursePack.terms,
          constraints: architecture.coursePack.constraints,
          pages: architecture.pageTasks.map(
            ({
              pageId,
              order,
              title,
              pageType,
              purpose,
              objectiveIds,
              teachingPoints,
              learnerAction,
              assessment,
              interactionType,
            }) => ({
              pageId,
              order,
              title,
              pageType,
              purpose,
              objectiveIds,
              teachingPoints,
              learnerAction,
              assessment,
              interactionType,
            }),
          ),
        });
      },
    }),

    [ToolIds.ReadPageSummary]: tool({
      description:
        "读取当前 manifest 中一个页面或一批页面的实际内容摘要。没有 pageId 时按 offset/limit 分页读取。",
      inputSchema: PageSelectionSchema,
      execute: (input) => {
        const snapshot = loadCourseReviewerSnapshot(execution);
        const selected = selectPages(
          snapshot.manifest.pages.map(({ pageId }) => pageId),
          input,
        );
        recordEvidenceRead(
          execution,
          "summary",
          selected.pageIds,
          !input.pageId && selected.nextOffset === null,
        );
        return success(`已读取 ${selected.pageIds.length} 个页面摘要。`, {
          items: selected.pageIds.map((pageId) =>
            requiredMapValue(snapshot.pageSummaries, pageId),
          ),
          nextOffset: selected.nextOffset,
          total: snapshot.manifest.pages.length,
        });
      },
    }),

    [ToolIds.ReadPageQuality]: tool({
      description:
        "读取当前 manifest 中一个页面或一批页面的确定性检查、模型 QA 和截图指标。不会返回 HTML。",
      inputSchema: PageSelectionSchema,
      execute: (input) => {
        const snapshot = loadCourseReviewerSnapshot(execution);
        const selected = selectPages(
          snapshot.manifest.pages.map(({ pageId }) => pageId),
          input,
        );
        recordEvidenceRead(
          execution,
          "quality",
          selected.pageIds,
          !input.pageId && selected.nextOffset === null,
        );
        return success(`已读取 ${selected.pageIds.length} 份页面质量报告。`, {
          items: selected.pageIds.map((pageId) =>
            compactQuality(
              pageId,
              requiredMapValue(snapshot.pageQualities, pageId),
              false,
            ),
          ),
          nextOffset: selected.nextOffset,
          total: snapshot.manifest.pages.length,
        });
      },
    }),

    [ToolIds.InspectPageEvidence]: tool({
      description:
        "针对当前 manifest 中的一个页面核对目标、跨页衔接、事实、互动或视觉证据。只返回受控摘要与截图指标，不返回原始 HTML。",
      inputSchema: PageEvidenceInputSchema,
      execute: ({ pageId, focus }) => {
        const snapshot = loadCourseReviewerSnapshot(execution);
        const pageTask = snapshot.architecture.pageTasks.find(
          (page) => page.pageId === pageId,
        );
        const manifestPage = snapshot.manifest.pages.find(
          (page) => page.pageId === pageId,
        );
        if (!pageTask || !manifestPage) {
          throw new FatalAgentRuntimeError(
            "REVIEWER_PAGE_OUT_OF_SCOPE",
            `页面 ${pageId} 不在当前 Reviewer manifest 中。`,
          );
        }
        const summary = requiredMapValue(
          snapshot.pageSummaries,
          pageId,
        );
        const quality = requiredMapValue(
          snapshot.pageQualities,
          pageId,
        );
        return success(`已核对页面 ${pageId} 的${focusLabel(focus)}证据。`, {
          focus,
          pageTask: {
            pageId,
            order: pageTask.order,
            title: pageTask.title,
            pageType: pageTask.pageType,
            purpose: pageTask.purpose,
            objectiveIds: pageTask.objectiveIds,
            teachingPoints: pageTask.teachingPoints,
            learnerAction: pageTask.learnerAction,
            assessment: pageTask.assessment,
            interactionType: pageTask.interactionType,
            acceptance: pageTask.acceptance,
          },
          actual: {
            keyPoints: summary.keyPoints,
            contentDigest: summary.contentDigest,
            learnerAction: summary.learnerAction,
            assessment: summary.assessment,
            interactionType: summary.interactionType,
            usedReferences: summary.usedReferences,
            quality: compactQuality(pageId, quality, true),
          },
          evidenceArtifactRefs: [
            manifestPage.summaryRef,
            manifestPage.qualityRef,
          ],
        });
      },
    }),

    [ToolIds.ValidateCourseReview]: tool({
      description:
        "提交前校验 CourseReview 的目标覆盖、页面引用、证据范围、manifest 新鲜度和确定性跨页问题；失败只返回可修改反馈。",
      inputSchema: ReviewCandidateInputSchema,
      execute: ({ review }) => {
        const evidenceIssues =
          collectUnreadCourseReviewerEvidenceIssues(execution);
        if (evidenceIssues.length > 0) {
          return gateFailure(evidenceIssues);
        }
        const validation = validateCourseReviewerCandidate(
          execution,
          review,
        );
        if (!validation.ok) {
          return gateFailure(validation.issues);
        }
        return success("整课审查报告通过提交前检查。", {
          decision: validation.review.decision,
          issueCount: validation.review.issues.length,
          manifestHash: validation.manifestHash,
          systemFindingCount: validation.findings.length,
        });
      },
    }),

    [ToolIds.SubmitCourseReview]: tool({
      description:
        "提交完整 CourseReview。工具会重新校验当前 manifest 和全部证据；成功落库后才结束 Reviewer WorkOrder。",
      inputSchema: ReviewCandidateInputSchema,
      execute: ({ review }) => {
        const evidenceIssues =
          collectUnreadCourseReviewerEvidenceIssues(execution);
        if (evidenceIssues.length > 0) {
          return gateFailure(evidenceIssues);
        }
        const validation = validateCourseReviewerCandidate(
          execution,
          review,
        );
        if (!validation.ok) {
          return gateFailure(validation.issues);
        }

        try {
          const committed = commands.submitCourseReview({
            workOrderId: execution.initialWorkOrder.id,
            expectedWorkOrderLockVersion:
              execution.initialWorkOrder.lockVersion,
            workOrderLeaseOwner: execution.workOrderLeaseOwner,
            runLeaseOwner: execution.runLeaseOwner,
            traceId: execution.traceId,
            candidate: validation.review,
            now: now(),
          });
          const artifactRef = toArtifactRef(committed.artifact);
          return {
            ok: true as const,
            committed: true,
            terminal: true,
            summary: `整课审查已提交，结论为 ${decisionLabel(
              committed.review.decision,
            )}。`,
            data: {
              workOrderId: committed.workOrder.id,
              decision: committed.review.decision,
              reviewRef: artifactRef,
            },
            artifactRefs: [artifactRef],
          };
        } catch (error) {
          throw new FatalAgentRuntimeError(
            "COURSE_REVIEW_COMMIT_FAILED",
            "整课审查写入失败，当前执行必须停止并由 Engine 重新读取状态。",
            error,
          );
        }
      },
    }),

    [ToolIds.BlockCourseReview]: tool({
      description:
        "只有读完全部封口证据后，机器 Gate 检测到封口摘要与精确质量证据互相矛盾时才可使用。它会持久化 blocked 终态，不能用来代替 revise_pages 或 replan。",
      inputSchema: BlockReviewInputSchema,
      execute: () => {
        const evidenceIssues =
          collectUnreadCourseReviewerEvidenceIssues(execution);
        if (evidenceIssues.length > 0) {
          return gateFailure(evidenceIssues);
        }
        const contractConflicts =
          collectCourseReviewerEvidenceContractConflicts(execution);
        if (contractConflicts.length === 0) {
          return gateFailure([
            {
              code: "COURSE_REVIEW_BLOCK_NOT_ELIGIBLE",
              path: ToolIds.BlockCourseReview,
              message:
                "当前封口证据合同完整；内容问题必须提交 pass、revise_pages 或 replan，不能 blocked。",
            },
          ]);
        }
        try {
          const publicError = classifyPublicAgentError({
            code: "REVIEWER_EVIDENCE_CONTRACT_CONFLICT",
            fallbackCode: "COURSE_REVIEW_BLOCKED",
          });
          const committed = commands.blockCourseReview({
            workOrderId: execution.initialWorkOrder.id,
            expectedWorkOrderLockVersion:
              execution.initialWorkOrder.lockVersion,
            workOrderLeaseOwner: execution.workOrderLeaseOwner,
            runLeaseOwner: execution.runLeaseOwner,
            traceId: execution.traceId,
            code: publicError.code,
            message: publicError.message,
            evidence: contractConflicts.map(
              ({ code, path, message }) =>
                `${code} ${path}: ${message}`,
            ),
            now: now(),
          });
          return {
            ok: true as const,
            committed: true,
            terminal: true,
            summary: `整课审查已阻塞：${publicError.message}`,
            data: {
              workOrderId: committed.workOrder.id,
              code: publicError.code,
            },
          };
        } catch (error) {
          throw new FatalAgentRuntimeError(
            "COURSE_REVIEW_BLOCK_FAILED",
            "Reviewer blocked 状态写入失败。",
            error,
          );
        }
      },
    }),
  };
}

export type CourseReviewerTools = ReturnType<
  typeof createCourseReviewerTools
>;

export function validateCourseReviewerCandidate(
  execution: CourseReviewerExecution,
  candidate: unknown,
):
  | {
      findings: ReviewerFinding[];
      manifestHash: string;
      ok: true;
      review: CourseReview;
    }
  | { issues: CourseGateIssue[]; ok: false } {
  const snapshot = loadCourseReviewerSnapshot(execution);
  const gate = runCourseReviewGate({
    architecture: snapshot.architecture,
    manifest: snapshot.manifest,
    pageSummaries: [...snapshot.pageSummaries.values()],
    candidate,
  });
  if (!gate.ok) return gate;

  const findings = collectDeterministicReviewerFindings(snapshot);
  if (
    gate.review.decision === "pass" &&
    findings.some(({ severity }) => severity === "error")
  ) {
    return {
      ok: false,
      issues: findings
        .filter(({ severity }) => severity === "error")
        .map((finding) => ({
          code: finding.code,
          path: finding.pageId
            ? `pages.${finding.pageId}`
            : "pages",
          message: `${finding.message}；不能给出 pass，请改为 revise_pages 或 replan 并写入证据。`,
        })),
    };
  }

  return {
    findings,
    manifestHash: gate.manifestHash,
    ok: true,
    review: CourseReviewSchema.parse(gate.review),
  };
}

export function collectDeterministicReviewerFindings(
  snapshot: ReturnType<typeof loadCourseReviewerSnapshot>,
) {
  const findings: ReviewerFinding[] = [];
  const manifestByPage = new Map(
    snapshot.manifest.pages.map((page) => [page.pageId, page]),
  );
  const digestOwner = new Map<string, string>();

  for (const pageTask of snapshot.architecture.pageTasks) {
    const summary = requiredMapValue(
      snapshot.pageSummaries,
      pageTask.pageId,
    );
    const quality = requiredMapValue(
      snapshot.pageQualities,
      pageTask.pageId,
    );
    const manifestPage = requiredMapValue(
      manifestByPage,
      pageTask.pageId,
    );
    if (
      summary.quality.decision !== "pass" ||
      quality.decision !== "pass"
    ) {
      findings.push({
        code: "REVIEWER_PAGE_QUALITY_NOT_PASSED",
        evidenceArtifactRefs: [
          manifestPage.summaryRef,
          manifestPage.qualityRef,
        ],
        message: `页面 ${pageTask.pageId} 的当前质量证据没有通过`,
        pageId: pageTask.pageId,
        scope: "page",
        severity: "error",
        suggestedAction: "先定向修复该页并重新执行 Page Gate",
        targetArtifact: qualityRepairTarget(quality),
      });
    }
    if (
      !sameValues(summary.objectiveIds, pageTask.objectiveIds) ||
      summary.interactionType !== pageTask.interactionType ||
      !sameValues(
        summary.buildDependencyPageIds,
        pageTask.buildDependsOnPageIds,
      )
    ) {
      findings.push({
        code: "REVIEWER_PAGE_PLAN_DRIFT",
        evidenceArtifactRefs: [manifestPage.summaryRef],
        message: `页面 ${pageTask.pageId} 的实际摘要偏离当前 PageTask`,
        pageId: pageTask.pageId,
        scope: "page",
        severity: "error",
        suggestedAction: "按当前 PageTask 重建该页，不要修改整课计划",
        targetArtifact: "page_content",
      });
    }
    if (pageTask.assessment && !summary.assessment) {
      findings.push({
        code: "REVIEWER_ASSESSMENT_MISSING",
        evidenceArtifactRefs: [manifestPage.summaryRef],
        message: `页面 ${pageTask.pageId} 计划有考核，但实际摘要没有考核证据`,
        pageId: pageTask.pageId,
        scope: "page",
        severity: "error",
        suggestedAction: "补齐可观察的学习结果检查",
        targetArtifact: "page_content",
      });
    }

    const normalizedDigest = normalizeDigest(summary.contentDigest);
    if (normalizedDigest.length < 12) continue;
    const owner = digestOwner.get(normalizedDigest);
    if (owner) {
      const ownerManifest = requiredMapValue(manifestByPage, owner);
      findings.push({
        code: "REVIEWER_CROSS_PAGE_DUPLICATE",
        evidenceArtifactRefs: [
          ownerManifest.summaryRef,
          manifestPage.summaryRef,
        ],
        message: `页面 ${pageTask.pageId} 与 ${owner} 的实际内容摘要重复`,
        pageId: pageTask.pageId,
        scope: "page",
        severity: "error",
        suggestedAction: `保留 ${owner} 的职责，重写 ${pageTask.pageId} 使其完成自己的页面目标`,
        targetArtifact: "page_content",
      });
    } else {
      digestOwner.set(normalizedDigest, pageTask.pageId);
    }
  }

  return findings;
}

function compactQuality(
  pageId: string,
  quality: QualityReport,
  focused: boolean,
) {
  const issueLimit = focused ? 10 : 1;
  return {
    pageId,
    overallScore: quality.overallScore,
    decision: quality.decision,
    shouldRepair: quality.shouldRepair,
    dimensionScores: Object.fromEntries(
      Object.entries(quality.dimensions).map(
        ([name, dimension]) => [name, dimension.score],
      ),
    ),
    issueCount: quality.issues.length,
    issues: quality.issues.slice(0, issueLimit).map((issue) => ({
      code: issue.code,
      dimension: issue.dimension,
      severity: issue.severity,
      source: issue.source,
      message: truncateEvidenceText(issue.message, focused ? 240 : 120),
      ...(focused
        ? {
            location: issue.location,
            repairHint: truncateEvidenceText(issue.repairHint, 240),
          }
        : {}),
    })),
    screenshotEvidence: quality.screenshotEvidence
      ? {
          status: quality.screenshotEvidence.status,
          viewport: quality.screenshotEvidence.viewport,
          metrics: quality.screenshotEvidence.metrics,
          reason: quality.screenshotEvidence.reason,
        }
      : undefined,
  };
}

function qualityRepairTarget(
  quality: QualityReport,
): "page_content" | "page_html" {
  return quality.issues.some(
    ({ dimension }) =>
      dimension === "contentAccuracy" ||
      dimension === "courseCoherence",
  )
    ? "page_content"
    : "page_html";
}

function truncateEvidenceText(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function selectPages(
  orderedPageIds: string[],
  input: z.infer<typeof PageSelectionSchema>,
) {
  if (input.pageId) {
    return {
      pageIds: orderedPageIds.filter(
        (pageId) => pageId === input.pageId,
      ),
      nextOffset: null,
    };
  }
  const pageIds = orderedPageIds.slice(
    input.offset,
    input.offset + input.limit,
  );
  const next = input.offset + pageIds.length;
  return {
    pageIds,
    nextOffset: next < orderedPageIds.length ? next : null,
  };
}

function recordEvidenceRead(
  execution: CourseReviewerExecution,
  kind: "quality" | "summary",
  pageIds: readonly string[],
  reachedEnd: boolean,
) {
  const progress = execution.evidenceReadProgress;
  const readPageIds =
    kind === "summary"
      ? progress.summaryPageIds
      : progress.qualityPageIds;
  pageIds.forEach((pageId) => readPageIds.add(pageId));
  if (!reachedEnd) return;
  if (kind === "summary") {
    progress.summaryReachedEnd = true;
  } else {
    progress.qualityReachedEnd = true;
  }
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function normalizeDigest(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()[\]{}_-]+/g, "");
}

function requiredMapValue<Value>(
  map: ReadonlyMap<string, Value>,
  key: string,
) {
  const value = map.get(key);
  if (!value) {
    throw new FatalAgentRuntimeError(
      "REVIEWER_EVIDENCE_MISSING",
      `Reviewer 缺少页面 ${key} 的封口证据。`,
    );
  }
  return value;
}

function success<Data>(
  summary: string,
  data: Data,
): AgentToolResult<Data, ArtifactRef> {
  return {
    ok: true,
    committed: false,
    terminal: false,
    summary,
    data,
  };
}

function gateFailure(
  issues: CourseGateIssue[],
): AgentToolResult<never, ArtifactRef> {
  return {
    ok: false,
    committed: false,
    terminal: false,
    code: "COURSE_REVIEW_GATE_FAILED",
    message: `整课审查还有 ${issues.length} 个可修正问题。`,
    retryable: true,
    feedback: issues
      .slice(0, 40)
      .map(
        ({ code, path, message }) =>
          `${code} @ ${path}: ${message}`,
      ),
  };
}

function toArtifactRef(artifact: {
  contentHash: string;
  courseId: string;
  id: string;
  kind: ArtifactRef["kind"];
  pageId?: string;
  scopeKey: string;
  version: number;
}): ArtifactRef {
  return {
    contentHash: artifact.contentHash,
    courseId: artifact.courseId,
    id: artifact.id,
    kind: artifact.kind,
    pageId: artifact.pageId,
    scopeKey: artifact.scopeKey,
    version: artifact.version,
  };
}

function decisionLabel(decision: CourseReview["decision"]) {
  if (decision === "pass") return "通过";
  if (decision === "revise_pages") return "页面返工";
  return "重新规划";
}

function focusLabel(
  focus: z.infer<typeof PageEvidenceInputSchema>["focus"],
) {
  if (focus === "objective") return "目标对应";
  if (focus === "fact") return "事实与术语";
  if (focus === "interaction") return "互动可完成性";
  if (focus === "visual") return "视觉与布局";
  return "跨页衔接";
}

// 显式引用类型，避免未来误把工具证据改成任意 JSON。
export type CourseReviewerEvidence = {
  quality: QualityReport;
  summary: PageSummary;
};
