import {
  classifyPublicAgentError,
  sanitizePublicDiagnosticText,
} from "@/server/course/projection/public-error";
import { AgentIds } from "@/server/agent/ids";
import { getAgentWorkOrderDefaults } from "@/server/agent/registry/agent-catalog";
import {
  CourseArchitectureSchema,
  CourseReviewSchema,
  CourseRunSchema,
  WorkOrderSchema,
  type ArtifactRef,
  type CourseArtifact,
  type CourseGenerationCauseCode,
  type CourseRun,
  type WorkOrder,
} from "@/shared/course-schema";
import type {
  CourseRunCommandFence,
  CourseRunRepository,
} from "@/server/course/store/repository";
import { assertCourseRunTaskExecutionActive } from "@/server/course/store/repository-support";
import {
  completeDirectorRoundInTransaction,
  type DirectorRoundCommit,
} from "@/server/course/run/director-round-commit";
import { transitiveDependentPageIds } from "@/server/course/policy/run";
import { runInTransaction } from "@/server/infra/database/connection";
import { createStorageId } from "@/server/infra/database/codec";

export const MAX_ARCHITECTURE_REVISION_ROUNDS = 2;
export const MAX_REPLAN_ROUNDS = 1;
export const MAX_COURSE_REVISION_ROUNDS = 2;

export class ArchitectureRevisionBudgetExhaustedError extends Error {
  readonly code = "ARCHITECTURE_REVISION_BUDGET_EXHAUSTED";

  constructor() {
    super(
      `课程架构语义退回已达到 ${MAX_ARCHITECTURE_REVISION_ROUNDS} 轮上限。`,
    );
    this.name = "ArchitectureRevisionBudgetExhaustedError";
  }
}

export function countArchitectureRevisionRounds(
  workOrders: readonly WorkOrder[],
) {
  return workOrders.filter(
    ({ kind, status }) =>
      kind === "architect_course" && status === "revision_requested",
  ).length;
}

const ARCHITECT_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CourseArchitect,
);
const PAGE_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CoursePageBuilder,
);

export type CourseRevisionCommands = {
  requestArchitectureRevision(input: {
    fence: CourseRunCommandFence;
    architectWorkOrderId: string;
    directorWorkOrderId?: string;
    directorRound?: DirectorRoundCommit;
    issues: string[];
    now?: string;
  }): {
    run: CourseRun;
    previous: WorkOrder;
    replacement: WorkOrder;
  };
  assignPageFixes(input: {
    fence: CourseRunCommandFence;
    reviewWorkOrderId: string;
    directorWorkOrderId?: string;
    directorRound?: DirectorRoundCommit;
    issueIds?: string[];
    now?: string;
  }): {
    run: CourseRun;
    acceptedReview: WorkOrder;
    fixWorkOrders: WorkOrder[];
  };
  requestReplan(input: {
    fence: CourseRunCommandFence;
    reviewWorkOrderId: string;
    directorWorkOrderId?: string;
    directorRound?: DirectorRoundCommit;
    now?: string;
  }): {
    run: CourseRun;
    acceptedReview: WorkOrder;
    architectWorkOrder: WorkOrder;
  };
  failCourse(input: {
    fence: CourseRunCommandFence;
    code: string;
    causeCode?: CourseGenerationCauseCode;
    message: string;
    directorRound?: DirectorRoundCommit;
    now?: string;
  }): CourseRun;
};

export function createCourseRevisionCommands(
  repository: CourseRunRepository,
): CourseRevisionCommands {
  const database = repository.runs.database;

  return {
    requestArchitectureRevision(input) {
      const now = input.now ?? new Date().toISOString();
      if (input.issues.length === 0) {
        throw new Error("退回课程架构必须给出具体问题");
      }
      return runInTransaction(database, () => {
        const run = loadFencedRun(repository, input.fence);
        const previous = requiredWorkOrder(
          repository.workOrders.load(input.architectWorkOrderId),
          input.architectWorkOrderId,
        );
        const existing = repository.workOrders.loadByIdempotencyKey(
          `${previous.id}:revision:${previous.revision + 1}`,
        );
        if (existing) {
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              repository,
              input.directorRound,
              now,
            );
          }
          return { run, previous, replacement: existing };
        }
        if (
          previous.kind !== "architect_course" ||
          previous.status !== "submitted"
        ) {
          throw new Error("只有 submitted Architect WorkOrder 可以退回");
        }
        if (
          countArchitectureRevisionRounds(
            repository.workOrders.listByTask(run.taskId),
          ) >= MAX_ARCHITECTURE_REVISION_ROUNDS
        ) {
          throw new ArchitectureRevisionBudgetExhaustedError();
        }

        const revisionRequested = WorkOrderSchema.parse({
          ...previous,
          lockVersion: previous.lockVersion + 1,
          status: "revision_requested",
          submission: {
            ...previous.submission!,
            issues: input.issues,
          },
          updatedAt: now,
        });
        compareAndSetWorkOrder(repository, previous, revisionRequested);
        const replacement = createArchitectWorkOrder({
          run,
          parentWorkOrderId: input.directorWorkOrderId,
          supersedes: revisionRequested,
          inputArtifactRefs: revisionRequested.submission!.artifactRefs,
          revision: previous.revision + 1,
          now,
        });
        repository.workOrders.insert(replacement);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "architecture_revision_requested",
          stage: "planning",
          agent: AgentIds.CourseDirector,
          safeSummary: "主 Agent 已退回课程架构，并给出明确修改范围",
          payload: {
            previousWorkOrderId: previous.id,
            replacementWorkOrderId: replacement.id,
            issues: input.issues,
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
          run,
          previous: revisionRequested,
          replacement,
        };
      });
    },

    assignPageFixes(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = loadFencedRun(repository, input.fence);
        const storedReviewWorkOrder = requiredWorkOrder(
          repository.workOrders.load(input.reviewWorkOrderId),
          input.reviewWorkOrderId,
        );
        const storedReviewRef = reviewArtifactRef(storedReviewWorkOrder);
        const alreadyCreated = repository.workOrders
          .listByTask(run.taskId)
          .filter(
            (workOrder) =>
              workOrder.kind === "fix_page" &&
              workOrder.inputArtifactRefs.some(
                ({ id }) => id === storedReviewRef.id,
              ),
          );
        if (
          alreadyCreated.length > 0 &&
          storedReviewWorkOrder.status === "accepted"
        ) {
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              repository,
              input.directorRound,
              now,
            );
          }
          return {
            run,
            acceptedReview: storedReviewWorkOrder,
            fixWorkOrders: alreadyCreated,
          };
        }
        if (run.courseRevisionRound >= MAX_COURSE_REVISION_ROUNDS) {
          throw new Error("整课定向返工已达到上限");
        }
        const { review, reviewWorkOrder, reviewRef } = loadCurrentReview(
          repository,
          run,
          input.reviewWorkOrderId,
        );
        if (review.decision !== "revise_pages") {
          throw new Error("只有 revise_pages Review 能创建 Fix WorkOrder");
        }
        const selectedIssueIds = input.issueIds
          ? new Set(input.issueIds)
          : new Set(review.issues.map(({ id }) => id));
        if (selectedIssueIds.size === 0) {
          throw new Error("定向返工必须选择至少一个 Review issue");
        }
        const unknownIssueIds = [...selectedIssueIds].filter(
          (issueId) =>
            !review.issues.some(({ id }) => id === issueId),
        );
        if (unknownIssueIds.length > 0) {
          throw new Error(
            `定向返工引用了不存在的 Review issue：${unknownIssueIds.join(", ")}`,
          );
        }
        const selectedIssues = review.issues.filter(({ id }) =>
          selectedIssueIds.has(id),
        );
        if (selectedIssues.some(({ scope }) => scope !== "page")) {
          throw new Error("定向返工只能选择明确指向页面的 Review issue");
        }
        const issuePageIds = [
          ...new Set(
            selectedIssues.flatMap((issue) =>
              issue.scope === "page" && issue.pageId ? [issue.pageId] : [],
            ),
          ),
        ];
        const architecture = loadArchitecture(repository, run);
        const selectedPageIds = transitiveDependentPageIds(
          architecture,
          issuePageIds,
        );
        const existingFixes = repository.workOrders
          .listByTask(run.taskId)
          .filter(
            (workOrder) =>
              workOrder.kind === "fix_page" &&
              workOrder.inputArtifactRefs.some(
                ({ id }) => id === reviewRef.id,
              ),
          );
        if (existingFixes.length > 0) {
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              repository,
              input.directorRound,
              now,
            );
          }
          return {
            run,
            acceptedReview: reviewWorkOrder,
            fixWorkOrders: existingFixes,
          };
        }

        const acceptedReview = acceptReviewWorkOrder(
          repository,
          reviewWorkOrder,
          now,
        );
        const fixIds = new Map(
          selectedPageIds.map((pageId) => [
            pageId,
            createStorageId("work-order-fix"),
          ]),
        );
        const selected = new Set(selectedPageIds);
        const issueIdsByPage = new Map<string, string[]>();
        for (const pageId of selectedPageIds) {
          issueIdsByPage.set(
            pageId,
            selectedIssues
              .filter(
                (issue) =>
                  issue.scope === "page" && issue.pageId === pageId,
              )
              .map(({ id }) => id),
          );
        }
        const architectureRef = run.activeArchitecture!.architectureRef;
        const fixWorkOrders = selectedPageIds.map((pageId) => {
          const pageTask = architecture.pageTasks.find(
            (page) => page.pageId === pageId,
          )!;
          const oldCurrent = run.currentPages[pageId];
          if (!oldCurrent) {
            throw new Error(`待返工页面 ${pageId} 没有 current 版本`);
          }
          const waitingForSelected = pageTask.buildDependsOnPageIds.filter(
            (dependencyId) => selected.has(dependencyId),
          );
          const readyDependencyRefs = pageTask.buildDependsOnPageIds.flatMap(
            (dependencyId) =>
              selected.has(dependencyId)
                ? []
                : [run.currentPages[dependencyId]?.summaryRef].filter(
                    (value): value is ArtifactRef => Boolean(value),
                  ),
          );
          return repository.workOrders.insert(
            WorkOrderSchema.parse({
              lockVersion: 0,
              id: fixIds.get(pageId)!,
              taskId: run.taskId,
              courseId: run.courseId,
              parentWorkOrderId: input.directorWorkOrderId,
              supersedesWorkOrderId: oldCurrent.sourceWorkOrderId,
              causedByReviewIssueIds:
                issueIdsByPage.get(pageId)?.length
                  ? issueIdsByPage.get(pageId)
                  : [...selectedIssueIds],
              dependencyWorkOrderIds: waitingForSelected.map(
                (dependencyId) => fixIds.get(dependencyId)!,
              ),
              agentId: AgentIds.CoursePageBuilder,
              kind: "fix_page",
              scope: { type: "page", pageId },
              status:
                waitingForSelected.length > 0
                  ? "waiting_dependencies"
                  : "queued",
              idempotencyKey: `${run.taskId}:fix:${reviewRef.id}:${pageId}`,
              inputArtifactRefs: uniqueArtifactRefs([
                architectureRef,
                reviewRef,
                oldCurrent.contentRef,
                ...(oldCurrent.assetsRef ? [oldCurrent.assetsRef] : []),
                oldCurrent.htmlRef,
                oldCurrent.qualityRef,
                oldCurrent.summaryRef,
                ...readyDependencyRefs,
              ]),
              buildDependencyPageIds: pageTask.buildDependsOnPageIds,
              inputSealedAt:
                waitingForSelected.length === 0 ? now : undefined,
              checkpointArtifactRefs: [],
              acceptance: [
                "只修复 Review 授权的问题和依赖失效范围",
                ...selectedIssues
                  .filter(({ id }) =>
                    (issueIdsByPage.get(pageId) ?? []).includes(id),
                  )
                  .map(({ message }) => message),
              ],
              allowedTools: PAGE_DEFAULTS.allowedTools,
              budget: PAGE_DEFAULTS.budget,
              executionAttempt: 0,
              revision:
                (repository.workOrders.load(oldCurrent.sourceWorkOrderId)
                  ?.revision ?? 1) + 1,
              createdAt: now,
              updatedAt: now,
            }),
          );
        });
        const nextRun = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          phase: "revising",
          stalePageIds: selectedPageIds,
          currentManifestHash: undefined,
          currentReview: undefined,
          courseRevisionRound: run.courseRevisionRound + 1,
        });
        updateRun(repository, run, nextRun, input.fence.leaseOwner, now);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "page_fixes_assigned",
          stage: "repair",
          agent: AgentIds.CourseDirector,
          safeSummary: `主 Agent 已定向返工 ${fixWorkOrders.length} 个页面（含依赖失效范围）`,
          payload: {
            reviewRef,
            pageIds: selectedPageIds,
            workOrderIds: fixWorkOrders.map(({ id }) => id),
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
        return { run: nextRun, acceptedReview, fixWorkOrders };
      });
    },

    requestReplan(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = loadFencedRun(repository, input.fence);
        const storedReviewWorkOrder = requiredWorkOrder(
          repository.workOrders.load(input.reviewWorkOrderId),
          input.reviewWorkOrderId,
        );
        const storedReviewRef = reviewArtifactRef(storedReviewWorkOrder);
        const existing = repository.workOrders.loadByIdempotencyKey(
          `${run.taskId}:replan:${storedReviewRef.id}`,
        );
        if (existing && storedReviewWorkOrder.status === "accepted") {
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              repository,
              input.directorRound,
              now,
            );
          }
          return {
            run,
            acceptedReview: storedReviewWorkOrder,
            architectWorkOrder: existing,
          };
        }
        if (run.replanRound >= MAX_REPLAN_ROUNDS) {
          throw new Error("整课重新规划已达到上限");
        }
        const { review, reviewWorkOrder, reviewRef } = loadCurrentReview(
          repository,
          run,
          input.reviewWorkOrderId,
        );
        if (review.decision !== "replan") {
          throw new Error("只有 replan Review 能重新规划");
        }
        const existingAfterReview = repository.workOrders.loadByIdempotencyKey(
          `${run.taskId}:replan:${reviewRef.id}`,
        );
        if (existingAfterReview) {
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              repository,
              input.directorRound,
              now,
            );
          }
          return {
            run,
            acceptedReview: reviewWorkOrder,
            architectWorkOrder: existingAfterReview,
          };
        }
        const acceptedReview = acceptReviewWorkOrder(
          repository,
          reviewWorkOrder,
          now,
        );
        const currentArchitect = requiredWorkOrder(
          repository.workOrders.load(
            run.activeArchitecture!.submissionWorkOrderId,
          ),
          run.activeArchitecture!.submissionWorkOrderId,
        );
        const architectWorkOrder = repository.workOrders.insert(
          createArchitectWorkOrder({
            run,
            parentWorkOrderId: input.directorWorkOrderId,
            supersedes: currentArchitect,
            inputArtifactRefs: [
              run.activeArchitecture!.architectureRef,
              reviewRef,
            ],
            revision: currentArchitect.revision + 1,
            now,
            idempotencyKey: `${run.taskId}:replan:${reviewRef.id}`,
          }),
        );
        const nextRun = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          phase: "revising",
          currentManifestHash: undefined,
          currentReview: undefined,
          replanRound: run.replanRound + 1,
        });
        updateRun(repository, run, nextRun, input.fence.leaseOwner, now);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "course_replan_requested",
          stage: "planning",
          agent: AgentIds.CourseDirector,
          safeSummary: "整课问题无法局部修复，主 Agent 已要求重新规划",
          payload: {
            reviewRef,
            architectWorkOrderId: architectWorkOrder.id,
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
        return { run: nextRun, acceptedReview, architectWorkOrder };
      });
    },

    failCourse(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = loadFencedRun(repository, input.fence);
        const publicError = classifyPublicAgentError({
          code: input.code,
          fallbackCode: "COURSE_RUN_FAILED",
        });
        const causeCode = input.causeCode ?? publicError.causeCode;
        const next = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          phase: "failed",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          error: {
            code: publicError.code,
            causeCode,
            message: publicError.message,
          },
        });
        updateRun(repository, run, next, input.fence.leaseOwner, now);
        repository.events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "course_failed",
          stage: run.phase,
          agent: AgentIds.CourseDirector,
          safeSummary: publicError.message,
          payload: { code: publicError.code },
          createdAt: now,
        });
        if (input.directorRound) {
          completeDirectorRoundInTransaction(
            repository,
            {
              ...input.directorRound,
              summary: publicError.message,
              evidence: input.directorRound.evidence?.map((value) =>
                sanitizePublicDiagnosticText(value, {
                  fallback: "主 Agent 已检查失败证据。",
                  maxLength: 1_000,
                }),
              ),
            },
            now,
          );
        }
        return next;
      });
    },
  };
}

function createArchitectWorkOrder(input: {
  run: CourseRun;
  parentWorkOrderId?: string;
  supersedes: WorkOrder;
  inputArtifactRefs: ArtifactRef[];
  revision: number;
  now: string;
  idempotencyKey?: string;
}) {
  return WorkOrderSchema.parse({
    lockVersion: 0,
    id: createStorageId("work-order-architect"),
    taskId: input.run.taskId,
    courseId: input.run.courseId,
    parentWorkOrderId: input.parentWorkOrderId,
    supersedesWorkOrderId: input.supersedes.id,
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: [],
    agentId: AgentIds.CourseArchitect,
    kind: "architect_course",
    scope: { type: "course" },
    status: "queued",
    idempotencyKey:
      input.idempotencyKey ??
      `${input.supersedes.id}:revision:${input.revision}`,
    inputArtifactRefs: input.inputArtifactRefs,
    buildDependencyPageIds: [],
    inputSealedAt: input.now,
    checkpointArtifactRefs: [],
    acceptance: [
      "解决主 Agent 或整课 Reviewer 指出的明确问题",
      "重新提交通过 Blueprint Gate 的完整 CourseArchitecture",
    ],
    allowedTools: ARCHITECT_DEFAULTS.allowedTools,
    budget: ARCHITECT_DEFAULTS.budget,
    executionAttempt: 0,
    revision: input.revision,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function loadCurrentReview(
  repository: CourseRunRepository,
  run: CourseRun,
  workOrderId: string,
) {
  if (
    !run.currentReview ||
    run.currentReview.workOrderId !== workOrderId
  ) {
    throw new Error("指定 Review 不是 CourseRun 当前版本");
  }
  const reviewWorkOrder = requiredWorkOrder(
    repository.workOrders.load(workOrderId),
    workOrderId,
  );
  if (
    reviewWorkOrder.kind !== "review_course" ||
    reviewWorkOrder.status !== "submitted"
  ) {
    throw new Error("当前 Reviewer WorkOrder 尚未 submitted");
  }
  const reviewRef = run.currentReview.artifactRef;
  const review = CourseReviewSchema.parse(
    requiredArtifact(repository.artifacts.load(reviewRef.id), reviewRef.id)
      .payload,
  );
  return { review, reviewWorkOrder, reviewRef };
}

function acceptReviewWorkOrder(
  repository: CourseRunRepository,
  current: WorkOrder,
  now: string,
) {
  const next = WorkOrderSchema.parse({
    ...current,
    lockVersion: current.lockVersion + 1,
    status: "accepted",
    updatedAt: now,
  });
  compareAndSetWorkOrder(repository, current, next);
  return next;
}

function reviewArtifactRef(workOrder: WorkOrder) {
  if (workOrder.kind !== "review_course") {
    throw new Error("指定 WorkOrder 不是整课 Review");
  }
  const ref = workOrder.submission?.artifactRefs.find(
    ({ kind }) => kind === "course_review",
  );
  if (!ref) throw new Error("Reviewer Submission 缺少 Review Artifact");
  return ref;
}

function compareAndSetWorkOrder(
  repository: CourseRunRepository,
  current: WorkOrder,
  next: WorkOrder,
) {
  if (
    !repository.workOrders.compareAndSet(next, {
      expectedLockVersion: current.lockVersion,
      expectedStatus: current.status,
      expectedLeaseOwner: current.leaseOwner,
    })
  ) {
    throw new Error(`WorkOrder ${current.id} 更新发生并发冲突`);
  }
}

function loadFencedRun(
  repository: CourseRunRepository,
  fence: CourseRunCommandFence,
) {
  const run = requiredRun(repository.runs.load(fence.runId), fence.runId);
  assertCourseRunTaskExecutionActive(repository.runs.database, run);
  if (
    run.lockVersion !== fence.expectedLockVersion ||
    run.traceId !== fence.traceId ||
    run.leaseOwner !== fence.leaseOwner ||
    !run.leaseExpiresAt
  ) {
    throw new Error("CourseRun 命令围栏失效");
  }
  return run;
}

function loadArchitecture(
  repository: CourseRunRepository,
  run: CourseRun,
) {
  const ref = run.activeArchitecture?.architectureRef;
  if (!ref) throw new Error("CourseRun 尚无 active Architecture");
  return CourseArchitectureSchema.parse(
    requiredArtifact(repository.artifacts.load(ref.id), ref.id).payload,
  );
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

function uniqueArtifactRefs(refs: ArtifactRef[]) {
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
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
