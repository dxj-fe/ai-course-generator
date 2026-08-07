import type { DatabaseSync } from "node:sqlite";

import { AgentIds } from "@/server/agent/ids";
import { getAgentWorkOrderDefaults } from "@/server/agent/registry/agent-catalog";
import {
  CourseArchitectureSchema,
  CourseManifestSchema,
  CourseReviewSchema,
  CourseRunSchema,
  PageSummarySchema,
  WorkOrderSchema,
  type ArtifactRef,
  type CourseArtifact,
  type CourseManifest,
  type CourseReview,
  type CourseRun,
  type PageSummary,
  type Submission,
  type WorkOrder,
} from "@/shared/course-schema";
import {
  buildCurrentCourseManifest,
  computeCourseManifestHash,
  runCourseReviewGate,
  runFinalCourseGate,
} from "@/server/course/gate/review";
import {
  classifyPublicAgentError,
  sanitizePublicDiagnosticText,
} from "@/server/course/projection/public-error";
import { createCourseReviewerBudget } from "@/server/agent/plugins/contexts/course/reviewer";
import {
  completeDirectorRoundInTransaction,
  type DirectorRoundCommit,
} from "@/server/course/run/director-round-commit";
import type {
  CourseRunCommandFence,
  CourseRunRepository,
} from "@/server/course/store/repository";
import { assertCourseRunTaskExecutionActive } from "@/server/course/store/repository-support";
import { assertAllCurrentPagesReady } from "@/server/course/policy/run";
import { runInTransaction } from "@/server/infra/database/connection";
import { createStorageId } from "@/server/infra/database/codec";

const DIRECTOR_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CourseDirector,
);
const REVIEWER_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CourseReviewer,
);

export type CourseRunCommands = {
  createDirectorRound(input: {
    fence: CourseRunCommandFence;
    purpose: "review_architecture" | "decide_course_review";
    inputArtifactRefs: ArtifactRef[];
    now?: string;
  }): WorkOrder;
  completeDirectorRound(input: {
    workOrderId: string;
    expectedLockVersion: number;
    leaseOwner: string;
    summary: string;
    evidence?: string[];
    artifactRefs?: ArtifactRef[];
    now?: string;
  }): WorkOrder;
  createCurrentReview(input: {
    fence: CourseRunCommandFence;
    parentWorkOrderId?: string;
    now?: string;
  }): {
    run: CourseRun;
    manifest: CourseManifest;
    manifestArtifact: CourseArtifact;
    reviewWorkOrder: WorkOrder;
  };
  submitCourseReview(input: {
    workOrderId: string;
    expectedWorkOrderLockVersion: number;
    workOrderLeaseOwner: string;
    runLeaseOwner: string;
    traceId: string;
    candidate: unknown;
    now?: string;
  }): {
    run: CourseRun;
    workOrder: WorkOrder;
    artifact: CourseArtifact;
    review: CourseReview;
  };
  blockCourseReview(input: {
    workOrderId: string;
    expectedWorkOrderLockVersion: number;
    workOrderLeaseOwner: string;
    runLeaseOwner: string;
    traceId: string;
    code: string;
    message: string;
    evidence?: string[];
    now?: string;
  }): {
    run: CourseRun;
    workOrder: WorkOrder;
  };
  acceptCourseReviewAndPublish(input: {
    fence: CourseRunCommandFence;
    reviewWorkOrderId: string;
    directorWorkOrderId?: string;
    directorRound?: DirectorRoundCommit;
    now?: string;
  }): {
    run: CourseRun;
    reviewWorkOrder: WorkOrder;
    manifestArtifact: CourseArtifact;
  };
};

/**
 * Repository 主文件只保留最常用的页面提交事务；整课 Review 和 Director
 * 命令放在独立模块，继续共用同一个 DatabaseSync 和同一组 Store。
 */
export function createCourseRunCommands(
  repository: CourseRunRepository,
): CourseRunCommands {
  const database = repository.runs.database;

  return {
    createDirectorRound(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = requiredRun(
          repository.runs.load(input.fence.runId),
          input.fence.runId,
        );
        assertFence(database, run, input.fence);
        const idempotencyKey = [
          run.taskId,
          "director",
          input.purpose,
          ...input.inputArtifactRefs.map(({ id }) => id).sort(),
        ].join(":");
        const existing =
          repository.workOrders.loadByIdempotencyKey(idempotencyKey);
        if (existing) return existing;

        const workOrder = repository.workOrders.insert(
          WorkOrderSchema.parse({
            lockVersion: 0,
            id: createStorageId("work-order-director"),
            taskId: run.taskId,
            courseId: run.courseId,
            causedByReviewIssueIds: [],
            dependencyWorkOrderIds: [],
            agentId: AgentIds.CourseLead,
            kind: "director_round",
            scope: { type: "course" },
            status: "queued",
            idempotencyKey,
            inputArtifactRefs: input.inputArtifactRefs,
            buildDependencyPageIds: [],
            inputSealedAt: now,
            checkpointArtifactRefs: [],
            acceptance: [
              input.purpose === "review_architecture"
                ? "根据用户目标和课程矩阵明确接受或退回课程架构"
                : "根据当前整课 Review 明确发布、局部返工或重新规划",
            ],
            allowedTools: DIRECTOR_DEFAULTS.allowedTools,
            budget: DIRECTOR_DEFAULTS.budget,
            executionAttempt: 0,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          }),
        );
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "director_round_created",
          stage:
            input.purpose === "review_architecture"
              ? "planning"
              : "course_review",
          agent: "course-run-engine",
          safeSummary:
            input.purpose === "review_architecture"
              ? "课程架构已交给主 Agent 做目标验收"
              : "整课报告已交给主 Agent做最终决策",
          payload: { workOrderId: workOrder.id, purpose: input.purpose },
          createdAt: now,
        });
        return workOrder;
      });
    },

    completeDirectorRound(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const current = requiredWorkOrder(
          repository.workOrders.load(input.workOrderId),
          input.workOrderId,
        );
        const run = requiredRun(
          repository.runs.loadByTaskId(current.taskId),
          current.taskId,
        );
        assertCourseRunTaskExecutionActive(database, run);
        if (current.status === "accepted") return current;
        if (
          current.kind !== "director_round" ||
          current.status !== "running" ||
          current.lockVersion !== input.expectedLockVersion ||
          current.leaseOwner !== input.leaseOwner
        ) {
          throw new Error("Director WorkOrder 完成围栏失效");
        }
        const next = WorkOrderSchema.parse({
          ...current,
          lockVersion: current.lockVersion + 1,
          status: "accepted",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          submission: {
            workOrderId: current.id,
            status: "done",
            artifactRefs: input.artifactRefs ?? [],
            evidence: input.evidence ?? [input.summary],
            issues: [],
          },
          updatedAt: now,
        });
        if (
          !repository.workOrders.compareAndSet(next, {
            expectedLockVersion: current.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: input.leaseOwner,
          })
        ) {
          throw new Error("Director WorkOrder 完成发生并发冲突");
        }
        repository.events.appendInTransaction({
          taskId: current.taskId,
          traceId: run.traceId,
          type: "director_decision",
          stage: "course_review",
          agent: AgentIds.CourseDirector,
          safeSummary: input.summary,
          payload: { workOrderId: current.id },
          createdAt: now,
        });
        return next;
      });
    },

    createCurrentReview(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = requiredRun(
          repository.runs.load(input.fence.runId),
          input.fence.runId,
        );
        assertFence(database, run, input.fence);
        const architecture = loadActiveArchitecture(repository, run);
        assertAllCurrentPagesReady({ architecture, run });
        const manifest = buildCurrentCourseManifest({ run, architecture });
        const manifestHash = computeCourseManifestHash(manifest);
        const idempotencyKey = `${run.taskId}:review:${manifestHash}`;
        const existing =
          repository.workOrders.loadByIdempotencyKey(idempotencyKey);
        if (existing) {
          const manifestRef = existing.inputArtifactRefs.find(
            ({ kind }) => kind === "course_manifest",
          );
          if (!manifestRef) {
            throw new Error("已有 Reviewer WorkOrder 缺少 manifest");
          }
          return {
            run,
            manifest,
            manifestArtifact: requiredArtifact(
              repository.artifacts.load(manifestRef.id),
              manifestRef.id,
            ),
            reviewWorkOrder: existing,
          };
        }

        const reviewWorkOrderId = createStorageId("work-order-review");
        const manifestArtifact = repository.artifacts.putInTransaction({
          taskId: run.taskId,
          courseId: run.courseId,
          scopeKey: "course",
          kind: "course_manifest",
          createdByWorkOrderId: reviewWorkOrderId,
          payload: manifest,
          createdAt: now,
        });
        const manifestRef = toArtifactRef(manifestArtifact);
        const reviewWorkOrder = repository.workOrders.insert(
          WorkOrderSchema.parse({
            lockVersion: 0,
            id: reviewWorkOrderId,
            taskId: run.taskId,
            courseId: run.courseId,
            parentWorkOrderId: input.parentWorkOrderId,
            causedByReviewIssueIds: [],
            dependencyWorkOrderIds: manifest.pages.map(
              ({ sourceWorkOrderId }) => sourceWorkOrderId,
            ),
            agentId: AgentIds.CourseReviewer,
            kind: "review_course",
            scope: { type: "course" },
            status: "queued",
            idempotencyKey,
            inputArtifactRefs: [
              manifest.architectureRef,
              manifestRef,
            ],
            buildDependencyPageIds: [],
            inputSealedAt: now,
            checkpointArtifactRefs: [],
            acceptance: [
              "逐一检查目标覆盖、练习证据、重复、断层和跨页一致性",
              "结论必须固定引用当前 manifest hash",
            ],
            allowedTools: REVIEWER_DEFAULTS.allowedTools,
            budget: createCourseReviewerBudget(
              manifest.pages.length,
            ),
            executionAttempt: 0,
            revision: run.courseRevisionRound + 1,
            createdAt: now,
            updatedAt: now,
          }),
        );
        const nextRun = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          phase: "reviewing",
          currentManifestHash: manifestHash,
          currentReview: undefined,
        });
        updateRun(repository, run, nextRun, input.fence.leaseOwner, now);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "course_review_created",
          stage: "course_review",
          agent: "course-run-engine",
          safeSummary: "全部当前页面已冻结，开始整课验收",
          payload: {
            workOrderId: reviewWorkOrder.id,
            manifestHash,
            pageCount: manifest.pages.length,
          },
          createdAt: now,
        });
        return {
          run: nextRun,
          manifest,
          manifestArtifact,
          reviewWorkOrder,
        };
      });
    },

    submitCourseReview(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const workOrder = requiredWorkOrder(
          repository.workOrders.load(input.workOrderId),
          input.workOrderId,
        );
        const run = requiredRun(
          repository.runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertExecutionFence(
          database,
          run,
          input.traceId,
          input.runLeaseOwner,
        );
        if (workOrder.status === "submitted") {
          const reviewRef = workOrder.submission?.artifactRefs.find(
            ({ kind }) => kind === "course_review",
          );
          if (!reviewRef) throw new Error("Reviewer Submission 缺少 Review");
          const artifact = requiredArtifact(
            repository.artifacts.load(reviewRef.id),
            reviewRef.id,
          );
          return {
            run,
            workOrder,
            artifact,
            review: CourseReviewSchema.parse(artifact.payload),
          };
        }
        if (
          workOrder.kind !== "review_course" ||
          workOrder.status !== "running" ||
          workOrder.lockVersion !== input.expectedWorkOrderLockVersion ||
          workOrder.leaseOwner !== input.workOrderLeaseOwner
        ) {
          throw new Error("Reviewer WorkOrder 提交围栏失效");
        }
        const manifestRef = workOrder.inputArtifactRefs.find(
          ({ kind }) => kind === "course_manifest",
        );
        if (!manifestRef) throw new Error("Reviewer WorkOrder 缺少 manifest");
        const manifestArtifact = requiredArtifact(
          repository.artifacts.load(manifestRef.id),
          manifestRef.id,
        );
        const manifest = CourseManifestSchema.parse(manifestArtifact.payload);
        const architecture = loadActiveArchitecture(repository, run);
        const gate = runCourseReviewGate({
          architecture,
          manifest,
          pageSummaries: loadManifestPageSummaries(
            repository,
            manifest,
          ),
          candidate: input.candidate,
        });
        if (!gate.ok) {
          throw new Error(
            `Course Review Gate 未通过：${gate.issues
              .map(({ message }) => message)
              .join("；")}`,
          );
        }
        if (run.currentManifestHash !== gate.manifestHash) {
          throw new Error("Reviewer 提交时 current manifest 已变化");
        }

        const artifact = repository.artifacts.putInTransaction({
          taskId: run.taskId,
          courseId: run.courseId,
          scopeKey: "course",
          kind: "course_review",
          createdByWorkOrderId: workOrder.id,
          payload: gate.review,
          createdAt: now,
        });
        const reviewRef = toArtifactRef(artifact);
        const submitted = WorkOrderSchema.parse({
          ...workOrder,
          lockVersion: workOrder.lockVersion + 1,
          status: "submitted",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          submission: {
            workOrderId: workOrder.id,
            status: "done",
            artifactRefs: [reviewRef],
            evidence: [
              `已检查 ${gate.review.coverage.length} 个学习目标`,
              `Review 固定引用 manifest ${gate.manifestHash}`,
            ],
            issues: gate.review.issues.map(({ message }) => message),
          },
          updatedAt: now,
        });
        if (
          !repository.workOrders.compareAndSet(submitted, {
            expectedLockVersion: workOrder.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: input.workOrderLeaseOwner,
          })
        ) {
          throw new Error("Reviewer WorkOrder 提交发生并发冲突");
        }
        const nextRun = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          currentReview: {
            workOrderId: workOrder.id,
            artifactRef: reviewRef,
            inputManifestHash: gate.manifestHash,
          },
        });
        updateRun(repository, run, nextRun, input.runLeaseOwner, now);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "course_review_submitted",
          stage: "course_review",
          agent: AgentIds.CourseReviewer,
          safeSummary: `整课验收结论：${reviewDecisionLabel(gate.review.decision)}`,
          payload: {
            workOrderId: workOrder.id,
            reviewRef,
            decision: gate.review.decision,
            issueCount: gate.review.issues.length,
          },
          createdAt: now,
        });
        return {
          run: nextRun,
          workOrder: submitted,
          artifact,
          review: gate.review,
        };
      });
    },

    blockCourseReview(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const workOrder = requiredWorkOrder(
          repository.workOrders.load(input.workOrderId),
          input.workOrderId,
        );
        const run = requiredRun(
          repository.runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertExecutionFence(
          database,
          run,
          input.traceId,
          input.runLeaseOwner,
        );
        if (workOrder.status === "blocked") {
          return { run, workOrder };
        }
        if (
          workOrder.kind !== "review_course" ||
          workOrder.status !== "running" ||
          workOrder.lockVersion !== input.expectedWorkOrderLockVersion ||
          workOrder.leaseOwner !== input.workOrderLeaseOwner
        ) {
          throw new Error("Reviewer WorkOrder 阻塞提交围栏失效");
        }
        const publicError = classifyPublicAgentError({
          code: input.code,
          fallbackCode: "COURSE_REVIEW_BLOCKED",
        });

        const blocked = WorkOrderSchema.parse({
          ...workOrder,
          lockVersion: workOrder.lockVersion + 1,
          status: "blocked",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          submission: {
            workOrderId: workOrder.id,
            status: "blocked",
            artifactRefs: [],
            evidence: (input.evidence ?? []).map((value) =>
              sanitizePublicDiagnosticText(value, {
                fallback: "Reviewer 已检查封口证据。",
                maxLength: 1_000,
              }),
            ),
            issues: [`${publicError.code}: ${publicError.message}`],
          },
          updatedAt: now,
        });
        if (
          !repository.workOrders.compareAndSet(blocked, {
            expectedLockVersion: workOrder.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: input.workOrderLeaseOwner,
          })
        ) {
          throw new Error("Reviewer WorkOrder 阻塞提交发生并发冲突");
        }
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "course_review_blocked",
          stage: "course_review",
          agent: AgentIds.CourseReviewer,
          safeSummary: `整课审查已阻塞：${publicError.message}`,
          payload: {
            workOrderId: workOrder.id,
            code: publicError.code,
          },
          createdAt: now,
        });
        return { run, workOrder: blocked };
      });
    },

    acceptCourseReviewAndPublish(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = requiredRun(
          repository.runs.load(input.fence.runId),
          input.fence.runId,
        );
        assertCourseRunTaskExecutionActive(database, run);
        if (run.phase === "completed") {
          const reviewWorkOrder = requiredWorkOrder(
            repository.workOrders.load(input.reviewWorkOrderId),
            input.reviewWorkOrderId,
          );
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              repository,
              input.directorRound,
              now,
            );
          }
          return {
            run,
            reviewWorkOrder,
            manifestArtifact: loadManifestForReview(
              repository,
              reviewWorkOrder,
            ),
          };
        }
        assertFence(database, run, input.fence);
        const reviewWorkOrder = requiredWorkOrder(
          repository.workOrders.load(input.reviewWorkOrderId),
          input.reviewWorkOrderId,
        );
        if (
          reviewWorkOrder.kind !== "review_course" ||
          reviewWorkOrder.status !== "submitted"
        ) {
          throw new Error("只有 submitted Reviewer WorkOrder 能进入发布");
        }
        const reviewRef = reviewWorkOrder.submission?.artifactRefs.find(
          ({ kind }) => kind === "course_review",
        );
        if (!reviewRef) throw new Error("Reviewer Submission 缺少 Review");
        const review = CourseReviewSchema.parse(
          requiredArtifact(
            repository.artifacts.load(reviewRef.id),
            reviewRef.id,
          ).payload,
        );
        const architecture = loadActiveArchitecture(repository, run);
        const manifestArtifact = loadManifestForReview(
          repository,
          reviewWorkOrder,
        );
        const reviewManifest = CourseManifestSchema.parse(
          manifestArtifact.payload,
        );
        const gate = runFinalCourseGate({
          run,
          architecture,
          review,
          pageSummaries: loadManifestPageSummaries(
            repository,
            reviewManifest,
          ),
          workOrders: repository.workOrders.listByTask(run.taskId),
        });
        if (!gate.ok) {
          throw new Error(
            `Final Gate 未通过：${gate.issues
              .map(({ message }) => message)
              .join("；")}`,
          );
        }
        if (
          computeCourseManifestHash(
            CourseManifestSchema.parse(manifestArtifact.payload),
          ) !== gate.manifestHash
        ) {
          throw new Error("发布用 manifest Artifact 与 Final Gate 不一致");
        }

        const acceptedReview = WorkOrderSchema.parse({
          ...reviewWorkOrder,
          lockVersion: reviewWorkOrder.lockVersion + 1,
          status: "accepted",
          updatedAt: now,
        });
        if (
          !repository.workOrders.compareAndSet(acceptedReview, {
            expectedLockVersion: reviewWorkOrder.lockVersion,
            expectedStatus: "submitted",
          })
        ) {
          throw new Error("Reviewer WorkOrder 接受发生并发冲突");
        }
        const nextRun = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          phase: "completed",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        });
        updateRun(repository, run, nextRun, input.fence.leaseOwner, now);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "course_published",
          stage: "complete",
          agent: AgentIds.CourseDirector,
          safeSummary: `课程已通过整课验收并发布 ${gate.manifest.pages.length} 个页面`,
          payload: {
            reviewRef,
            manifestRef: toArtifactRef(manifestArtifact),
            directorWorkOrderId: input.directorWorkOrderId,
          },
          createdAt: now,
        });
        if (input.directorRound) {
          completeDirectorRoundInTransaction(
            repository,
            input.directorRound,
            now,
          );
        }
        return {
          run: nextRun,
          reviewWorkOrder: acceptedReview,
          manifestArtifact,
        };
      });
    },
  };
}

function loadActiveArchitecture(
  repository: CourseRunRepository,
  run: CourseRun,
) {
  const ref = run.activeArchitecture?.architectureRef;
  if (!ref) throw new Error("CourseRun 尚无 active Architecture");
  return CourseArchitectureSchema.parse(
    requiredArtifact(repository.artifacts.load(ref.id), ref.id).payload,
  );
}

function loadManifestForReview(
  repository: CourseRunRepository,
  workOrder: WorkOrder,
) {
  const ref = workOrder.inputArtifactRefs.find(
    ({ kind }) => kind === "course_manifest",
  );
  if (!ref) throw new Error("Reviewer WorkOrder 缺少 manifest Artifact");
  return requiredArtifact(repository.artifacts.load(ref.id), ref.id);
}

function loadManifestPageSummaries(
  repository: CourseRunRepository,
  manifest: CourseManifest,
): PageSummary[] {
  return manifest.pages.map(({ pageId, summaryRef }) => {
    const artifact = requiredArtifact(
      repository.artifacts.load(summaryRef.id),
      summaryRef.id,
    );
    if (
      artifact.kind !== "page_summary" ||
      artifact.courseId !== summaryRef.courseId ||
      artifact.pageId !== summaryRef.pageId ||
      artifact.scopeKey !== summaryRef.scopeKey ||
      artifact.revision !== summaryRef.revision ||
      artifact.contentHash !== summaryRef.contentHash
    ) {
      throw new Error(
        `页面 ${pageId} 的 PageSummary Artifact 与 manifest 引用不一致`,
      );
    }
    const summary = PageSummarySchema.parse(artifact.payload);
    if (
      summary.courseId !== manifest.courseId ||
      summary.pageId !== pageId
    ) {
      throw new Error(
        `页面 ${pageId} 的 PageSummary 内容不属于当前 manifest`,
      );
    }
    return summary;
  });
}

function updateRun(
  repository: CourseRunRepository,
  current: CourseRun,
  next: CourseRun,
  leaseOwner: string,
  now: string,
) {
  if (
    !repository.runs.compareAndSet(
      next,
      {
        expectedLockVersion: current.lockVersion,
        expectedTraceId: current.traceId,
        expectedLeaseOwner: leaseOwner,
      },
      now,
    )
  ) {
    throw new Error("CourseRun 更新发生并发冲突");
  }
}

function assertFence(
  database: DatabaseSync,
  run: CourseRun,
  fence: CourseRunCommandFence,
) {
  assertCourseRunTaskExecutionActive(database, run);
  if (
    run.id !== fence.runId ||
    run.lockVersion !== fence.expectedLockVersion ||
    run.traceId !== fence.traceId ||
    run.leaseOwner !== fence.leaseOwner ||
    !run.leaseExpiresAt
  ) {
    throw new Error("CourseRun 命令围栏失效");
  }
}

function assertExecutionFence(
  database: DatabaseSync,
  run: CourseRun,
  traceId: string,
  leaseOwner: string,
) {
  assertCourseRunTaskExecutionActive(database, run);
  if (
    run.traceId !== traceId ||
    run.leaseOwner !== leaseOwner ||
    !run.leaseExpiresAt
  ) {
    throw new Error("CourseRun trace 或 lease 围栏失效");
  }
}

function toArtifactRef(artifact: CourseArtifact): ArtifactRef {
  const {
    id,
    kind,
    courseId,
    pageId,
    scopeKey,
    revision,
    contentHash,
  } = artifact;
  return { id, kind, courseId, pageId, scopeKey, revision, contentHash };
}

function reviewDecisionLabel(decision: CourseReview["decision"]) {
  if (decision === "pass") return "通过";
  if (decision === "revise_pages") return "定向返工";
  return "重新规划";
}

function requiredRun(run: CourseRun | undefined, id: string) {
  if (!run) throw new Error(`CourseRun 不存在：${id}`);
  return run;
}

function requiredWorkOrder(workOrder: WorkOrder | undefined, id: string) {
  if (!workOrder) throw new Error(`WorkOrder 不存在：${id}`);
  return workOrder;
}

function requiredArtifact(artifact: CourseArtifact | undefined, id: string) {
  if (!artifact) throw new Error(`Artifact 不存在：${id}`);
  return artifact;
}

export function parseDirectorTerminal(value: unknown): {
  status: "accepted";
  submission: Submission;
} | null {
  if (!value || typeof value !== "object") return null;
  const workOrder = (value as { workOrder?: unknown }).workOrder;
  const parsed = WorkOrderSchema.safeParse(workOrder);
  return parsed.success &&
    parsed.data.kind === "director_round" &&
    parsed.data.status === "accepted" &&
    parsed.data.submission
    ? { status: "accepted", submission: parsed.data.submission }
    : null;
}
