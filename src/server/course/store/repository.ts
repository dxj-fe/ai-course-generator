import type { DatabaseSync } from "node:sqlite";

import {
  AgentIds,
  ToolIds,
} from "@/server/agent/ids";
import { getAgentWorkOrderDefaults } from "@/server/agent/registry/agent-catalog";
import {
  CourseArchitectureSchema,
  type CourseArchitecture,
  type PageTask,
} from "@/shared/course-schema/course-architecture";
import {
  type ArtifactRef,
  type CourseArtifact,
} from "@/shared/course-schema/course-artifact";
import {
  CourseRunSchema,
  type CourseRun,
} from "@/shared/course-schema/course-run";
import {
  WorkOrderSchema,
  type AgentBudget,
  type WorkOrder,
} from "@/shared/course-schema/work-order";
import {
  assertCanAcceptArchitecture,
} from "@/server/course/policy/run";
import {
  createCourseRunPageOperations,
  type PageCheckpointKind,
  type PageSubmissionPayloads,
} from "@/server/course/run/page-operations";
import {
  completeDirectorRoundInTransaction,
  type DirectorRoundCommit,
} from "@/server/course/run/director-round-commit";
import {
  bootstrapEventId,
  assertCourseRunTaskExecutionActive,
  assertRunExecutionFence,
  pageAcceptance,
  requiredArtifact,
  requiredMapValue,
  requiredRun,
  requiredWorkOrder,
  toArtifactRef,
} from "@/server/course/store/repository-support";
import {
  createCourseArtifactStore,
  type CourseArtifactStore,
} from "@/server/course/store/artifact";
import {
  createCourseRunEventStore,
  type CourseRunEvent,
  type CourseRunEventStore,
} from "@/server/course/store/run-event";
import {
  createCourseRunStore,
  type CourseRunStore,
} from "@/server/course/store/run";
import {
  createCourseToolOperationStore,
  type CourseToolOperationStore,
} from "@/server/course/store/tool-operation";
import {
  type AppDatabaseOptions,
  resolveAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";
import { createStorageId } from "@/server/infra/database/codec";
import {
  createWorkOrderStore,
  type WorkOrderStore,
} from "@/server/course/store/work-order";

const ARCHITECT_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CourseArchitect,
);
const PAGE_DEFAULTS = getAgentWorkOrderDefaults(
  AgentIds.CoursePageBuilder,
);

export type CourseRunCommandFence = {
  runId: string;
  expectedLockVersion: number;
  traceId: string;
  leaseOwner: string;
};

export type {
  PageCheckpointKind,
  PageSubmissionPayloads,
} from "@/server/course/run/page-operations";

export type CourseRunRepository = {
  runs: CourseRunStore;
  workOrders: WorkOrderStore;
  artifacts: CourseArtifactStore;
  toolOperations: CourseToolOperationStore;
  events: CourseRunEventStore;
  bootstrapCourseRun(input: {
    taskId: string;
    courseId: string;
    traceId: string;
    now?: string;
    runId?: string;
    architectWorkOrderId?: string;
    architectBudget?: AgentBudget;
    architectAllowedTools?: string[];
  }): {
    run: CourseRun;
    architectWorkOrder: WorkOrder;
    event: CourseRunEvent;
  };
  cancelCourseRun(input: {
    taskId: string;
    traceId: string;
    now?: string;
  }):
    | {
        run: CourseRun;
        cancelledWorkOrders: WorkOrder[];
        event?: CourseRunEvent;
      }
    | undefined;
  submitArchitecture(input: {
    workOrderId: string;
    expectedWorkOrderLockVersion: number;
    workOrderLeaseOwner: string;
    runLeaseOwner: string;
    traceId: string;
    architecture: CourseArchitecture;
    evidence?: string[];
    issues?: string[];
    now?: string;
  }): {
    workOrder: WorkOrder;
    artifact: CourseArtifact;
    event?: CourseRunEvent;
  };
  acceptArchitectureAndDispatchPages(input: {
    fence: CourseRunCommandFence;
    architectWorkOrderId: string;
    directorWorkOrderId?: string;
    directorRound?: DirectorRoundCommit;
    now?: string;
    pageBudget?: AgentBudget;
    pageAllowedTools?: string[];
  }): {
    run: CourseRun;
    architectWorkOrder: WorkOrder;
    pageWorkOrders: WorkOrder[];
    event?: CourseRunEvent;
  };
  checkpointPageArtifact(input: {
    workOrderId: string;
    expectedWorkOrderLockVersion: number;
    workOrderLeaseOwner: string;
    runLeaseOwner: string;
    traceId: string;
    toolName: string;
    toolCallId?: string;
    kind: PageCheckpointKind;
    payload: unknown;
    invalidates?: PageCheckpointKind[];
    now?: string;
  }): {
    workOrder: WorkOrder;
    artifact: CourseArtifact;
    event?: CourseRunEvent;
  };
  recordPageRepairDeclined(input: {
    workOrderId: string;
    expectedWorkOrderLockVersion: number;
    workOrderLeaseOwner: string;
    runLeaseOwner: string;
    traceId: string;
    toolName:
      | typeof ToolIds.RepairPageContent
      | typeof ToolIds.RepairPageHtml;
    toolCallId?: string;
    now?: string;
  }): CourseRunEvent;
  commitPageSubmission(input: {
    workOrderId: string;
    expectedWorkOrderLockVersion: number;
    workOrderLeaseOwner: string;
    runLeaseOwner: string;
    traceId: string;
    pageGatePassed: boolean;
    payloads: PageSubmissionPayloads;
    evidence?: string[];
    issues?: string[];
    now?: string;
  }): {
    run: CourseRun;
    workOrder: WorkOrder;
    artifacts: CourseArtifact[];
    unlockedWorkOrders: WorkOrder[];
    events: CourseRunEvent[];
  };
  blockPageWorkOrder(input: {
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
    workOrder: WorkOrder;
    event?: CourseRunEvent;
  };
};

export function createCourseRunRepository(
  options: AppDatabaseOptions = {},
): CourseRunRepository {
  const database = resolveAppDatabase(options);
  const sharedOptions = { database };
  const runs = createCourseRunStore(sharedOptions);
  const workOrders = createWorkOrderStore(sharedOptions);
  const artifacts = createCourseArtifactStore(sharedOptions);
  const toolOperations = createCourseToolOperationStore(sharedOptions);
  const events = createCourseRunEventStore(sharedOptions);
  const pageOperations = createCourseRunPageOperations({
    database,
    runs,
    workOrders,
    artifacts,
    events,
    toolOperations,
  });

  return {
    runs,
    workOrders,
    artifacts,
    toolOperations,
    events,
    ...pageOperations,

    bootstrapCourseRun(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        assertCourseRunTaskExecutionActive(database, {
          taskId: input.taskId,
          courseId: input.courseId,
          traceId: input.traceId,
        });
        const existingRun = runs.loadByTaskId(input.taskId);
        if (existingRun) {
          if (
            existingRun.courseId !== input.courseId ||
            existingRun.traceId !== input.traceId
          ) {
            throw new Error("taskId 已绑定到不同 CourseRun 参数");
          }
          const architectWorkOrder = requiredArchitectWorkOrder(
            workOrders.listByTask(input.taskId),
          );
          const event = events.appendInTransaction({
            id: bootstrapEventId(input.taskId),
            taskId: input.taskId,
            traceId: input.traceId,
            type: "course_run_bootstrapped",
            stage: "planning",
            agent: "course-run-engine",
            safeSummary: "课程任务已建立，等待课程架构",
            payload: {
              runId: existingRun.id,
              architectWorkOrderId: architectWorkOrder.id,
            },
            createdAt: now,
          });
          return { run: existingRun, architectWorkOrder, event };
        }

        const run = runs.insert(
          CourseRunSchema.parse({
            version: 1,
            id: input.runId ?? createStorageId("course-run"),
            taskId: input.taskId,
            courseId: input.courseId,
            lockVersion: 0,
            phase: "planning",
            traceId: input.traceId,
            planningRevision: 0,
            currentPages: {},
            stalePageIds: [],
            replanRound: 0,
            courseRevisionRound: 0,
          }),
          now,
        );
        const architectWorkOrder = workOrders.insert(
          WorkOrderSchema.parse({
            version: 1,
            lockVersion: 0,
            id:
              input.architectWorkOrderId ??
              createStorageId("work-order-architect"),
            taskId: input.taskId,
            courseId: input.courseId,
            causedByReviewIssueIds: [],
            dependencyWorkOrderIds: [],
            agentId: AgentIds.CourseArchitect,
            kind: "architect_course",
            scope: { type: "course" },
            status: "queued",
            idempotencyKey: `${input.taskId}:architect:1`,
            inputArtifactRefs: [],
            buildDependencyPageIds: [],
            inputSealedAt: now,
            checkpointArtifactRefs: [],
            acceptance: [
              "提交一份通过 Blueprint Gate 的完整 CourseArchitecture",
              "每个学习目标同时有教学页和练习或证据页",
            ],
            allowedTools:
              input.architectAllowedTools ??
              ARCHITECT_DEFAULTS.allowedTools,
            budget:
              input.architectBudget ?? ARCHITECT_DEFAULTS.budget,
            executionAttempt: 0,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          }),
        );
        const event = events.appendInTransaction({
          id: bootstrapEventId(input.taskId),
          taskId: input.taskId,
          traceId: input.traceId,
          type: "course_run_bootstrapped",
          stage: "planning",
          agent: "course-run-engine",
          safeSummary: "课程任务已建立，等待课程架构",
          payload: {
            runId: run.id,
            architectWorkOrderId: architectWorkOrder.id,
          },
          createdAt: now,
        });
        return { run, architectWorkOrder, event };
      });
    },

    cancelCourseRun(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const currentRun = runs.loadByTaskId(input.taskId);
        if (!currentRun) {
          return undefined;
        }
        const cancelIntentTraceId = loadAuthorizedCancelIntentTraceId(
          database,
          input.taskId,
          currentRun.courseId,
        );
        const cancellationTraceId =
          currentRun.traceId === input.traceId
            ? input.traceId
            : cancelIntentTraceId === input.traceId
              ? input.traceId
              : undefined;
        if (!cancellationTraceId) return undefined;
        if (currentRun.phase === "completed" || currentRun.phase === "failed") {
          return {
            run: currentRun,
            cancelledWorkOrders: [],
          };
        }
        if (currentRun.phase === "cancelled") {
          if (currentRun.traceId !== cancellationTraceId) {
            const alignedRun = CourseRunSchema.parse({
              ...currentRun,
              lockVersion: currentRun.lockVersion + 1,
              traceId: cancellationTraceId,
            });
            if (
              !runs.compareAndSet(
                alignedRun,
                {
                  expectedLockVersion: currentRun.lockVersion,
                  expectedTraceId: currentRun.traceId,
                  expectedLeaseOwner: currentRun.leaseOwner,
                },
                now,
              )
            ) {
              throw new Error("对齐已取消 CourseRun trace 时发生并发冲突");
            }
            const event = events.appendInTransaction({
              taskId: currentRun.taskId,
              traceId: cancellationTraceId,
              type: "course_cancelled",
              stage: "cancelled",
              agent: "course-task-service",
              safeSummary: "课程取消状态已对齐到当前任务",
              payload: {
                cancelledWorkOrderIds: [],
              },
              createdAt: now,
            });
            return {
              run: alignedRun,
              cancelledWorkOrders: [],
              event,
            };
          }
          return {
            run: currentRun,
            cancelledWorkOrders: [],
          };
        }

        const cancelledWorkOrders = workOrders
          .listByTask(input.taskId)
          .filter(({ status }) =>
            ["waiting_dependencies", "queued", "running"].includes(status),
          )
          .map((current) => {
            const next = WorkOrderSchema.parse({
              ...current,
              lockVersion: current.lockVersion + 1,
              status: "cancelled",
              leaseOwner: undefined,
              leaseExpiresAt: undefined,
              updatedAt: now,
            });
            if (
              !workOrders.compareAndSet(next, {
                expectedLockVersion: current.lockVersion,
                expectedStatus: current.status,
                expectedLeaseOwner: current.leaseOwner,
              })
            ) {
              throw new Error(
                `取消 WorkOrder ${current.id} 时发生并发冲突`,
              );
            }
            return next;
          });

        const nextRun = CourseRunSchema.parse({
          ...currentRun,
          lockVersion: currentRun.lockVersion + 1,
          phase: "cancelled",
          traceId: cancellationTraceId,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        });
        if (
          !runs.compareAndSet(
            nextRun,
            {
              expectedLockVersion: currentRun.lockVersion,
              expectedTraceId: currentRun.traceId,
              expectedLeaseOwner: currentRun.leaseOwner,
            },
            now,
          )
        ) {
          throw new Error("取消 CourseRun 时发生并发冲突");
        }
        const event = events.appendInTransaction({
          taskId: currentRun.taskId,
          traceId: cancellationTraceId,
          type: "course_cancelled",
          stage: "cancelled",
          agent: "course-task-service",
          safeSummary: "课程生成已取消",
          payload: {
            cancelledWorkOrderIds: cancelledWorkOrders.map(({ id }) => id),
          },
          createdAt: now,
        });
        return {
          run: nextRun,
          cancelledWorkOrders,
          event,
        };
      });
    },

    submitArchitecture(input) {
      const architecture = CourseArchitectureSchema.parse(input.architecture);
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const current = requiredWorkOrder(
          workOrders.load(input.workOrderId),
          input.workOrderId,
        );
        const run = requiredRun(runs.loadByTaskId(current.taskId), current.taskId);
        assertRunExecutionFence(
          database,
          run,
          input.traceId,
          input.runLeaseOwner,
        );

        if (
          current.status === "submitted" ||
          current.status === "accepted"
        ) {
          const existingArtifact = submittedArchitectureArtifact(
            current,
            artifacts,
          );
          const parsedExisting = CourseArchitectureSchema.parse(
            existingArtifact.payload,
          );
          if (
            JSON.stringify(parsedExisting) !== JSON.stringify(architecture)
          ) {
            throw new Error("Architect WorkOrder 已提交不同版本的课程架构");
          }
          return {
            workOrder: current,
            artifact: existingArtifact,
          };
        }

        if (
          current.status !== "running" ||
          current.lockVersion !== input.expectedWorkOrderLockVersion ||
          current.leaseOwner !== input.workOrderLeaseOwner
        ) {
          throw new Error("Architect WorkOrder 提交围栏失效");
        }
        if (current.kind !== "architect_course") {
          throw new Error("只有 Architect WorkOrder 能提交课程架构");
        }
        if (
          current.taskId !== run.taskId ||
          architecture.courseId !== current.courseId
        ) {
          throw new Error("课程架构提交范围不一致");
        }

        const artifact = artifacts.putInTransaction({
          taskId: current.taskId,
          courseId: current.courseId,
          scopeKey: "course",
          kind: "course_architecture",
          createdByWorkOrderId: current.id,
          payload: architecture,
          createdAt: now,
        });
        const artifactRef = toArtifactRef(artifact);
        const next = WorkOrderSchema.parse({
          ...current,
          lockVersion: current.lockVersion + 1,
          status: "submitted",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          submission: {
            workOrderId: current.id,
            status: "done",
            artifactRefs: [artifactRef],
            evidence: input.evidence ?? ["课程架构已通过结构化 Schema"],
            issues: input.issues ?? [],
          },
          updatedAt: now,
        });
        if (
          !workOrders.compareAndSet(next, {
            expectedLockVersion: current.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: input.workOrderLeaseOwner,
          })
        ) {
          throw new Error("Architect WorkOrder 提交发生并发冲突");
        }
        const event = events.appendInTransaction({
          taskId: current.taskId,
          traceId: input.traceId,
          type: "architecture_submitted",
          stage: "planning",
          agent: AgentIds.CourseArchitect,
          safeSummary: "课程架构已提交，等待主 Agent 验收",
          payload: {
            workOrderId: current.id,
            architectureRef: artifactRef,
            pageCount: architecture.pageTasks.length,
          },
          createdAt: now,
        });
        return { workOrder: next, artifact, event };
      });
    },

    acceptArchitectureAndDispatchPages(input) {
      const now = input.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const run = requiredRun(runs.load(input.fence.runId), input.fence.runId);
        assertCourseRunTaskExecutionActive(database, run);
        const architectWorkOrder = requiredWorkOrder(
          workOrders.load(input.architectWorkOrderId),
          input.architectWorkOrderId,
        );
        const architectureArtifact = submittedArchitectureArtifact(
          architectWorkOrder,
          artifacts,
        );
        const architecture = CourseArchitectureSchema.parse(
          architectureArtifact.payload,
        );
        const architectureRef = toArtifactRef(architectureArtifact);

        if (
          run.activeArchitecture?.architectureRef.id === architectureRef.id
        ) {
          if (input.directorRound) {
            completeDirectorRoundInTransaction(
              { runs, workOrders, events },
              input.directorRound,
              now,
            );
          }
          return {
            run,
            architectWorkOrder,
            pageWorkOrders: pageOrdersForArchitecture(
              workOrders.listByTask(run.taskId),
              architectureRef.id,
            ),
          };
        }

        assertCourseRunFence(database, run, input.fence);
        assertCanAcceptArchitecture({
          run,
          architectWorkOrder,
          architectureArtifactRef: architectureRef,
          architecture,
        });

        supersedeOldArchitectureBranch({
          run,
          workOrders,
          now,
        });

        const nextPlanningRevision = run.planningRevision + 1;
        const pageOrderIds = new Map(
          architecture.pageTasks.map((page) => [
            page.pageId,
            createStorageId("work-order-page"),
          ]),
        );
        const pageWorkOrders = architecture.pageTasks
          .sort((left, right) => left.order - right.order)
          .map((pageTask) =>
            workOrders.insert(
              createPageWorkOrder({
                run,
                architectureRef,
                pageTask,
                pageOrderIds,
                parentWorkOrderId: input.directorWorkOrderId,
                planningRevision: nextPlanningRevision,
                budget: input.pageBudget ?? PAGE_DEFAULTS.budget,
                allowedTools:
                  input.pageAllowedTools ??
                  PAGE_DEFAULTS.allowedTools,
                now,
              }),
            ),
          );

        const acceptedArchitect = WorkOrderSchema.parse({
          ...architectWorkOrder,
          lockVersion: architectWorkOrder.lockVersion + 1,
          status: "accepted",
          updatedAt: now,
        });
        if (
          !workOrders.compareAndSet(acceptedArchitect, {
            expectedLockVersion: architectWorkOrder.lockVersion,
            expectedStatus: "submitted",
          })
        ) {
          throw new Error("Architect WorkOrder 验收发生并发冲突");
        }

        const nextRun = CourseRunSchema.parse({
          ...run,
          lockVersion: run.lockVersion + 1,
          phase: "building",
          planningRevision: nextPlanningRevision,
          activeArchitecture: {
            submissionWorkOrderId: acceptedArchitect.id,
            architectureRef,
          },
          currentPages: {},
          stalePageIds: [],
          currentManifestHash: undefined,
          currentReview: undefined,
        });
        if (
          !runs.compareAndSet(nextRun, {
            expectedLockVersion: run.lockVersion,
            expectedTraceId: run.traceId,
            expectedLeaseOwner: input.fence.leaseOwner,
          }, now)
        ) {
          throw new Error("CourseRun 激活课程架构发生并发冲突");
        }

        const event = events.appendInTransaction({
          taskId: run.taskId,
          traceId: run.traceId,
          type: "architecture_accepted",
          stage: "building",
          agent: AgentIds.CourseDirector,
          safeSummary: `课程架构已接受，已派发 ${pageWorkOrders.length} 个页面任务`,
          payload: {
            architectureRef,
            planningRevision: nextPlanningRevision,
            pageWorkOrderIds: pageWorkOrders.map(({ id }) => id),
          },
          createdAt: now,
        });
        if (input.directorRound) {
          completeDirectorRoundInTransaction(
            { runs, workOrders, events },
            input.directorRound,
            now,
          );
        }
        return {
          run: nextRun,
          architectWorkOrder: acceptedArchitect,
          pageWorkOrders,
          event,
        };
      });
    },

  };
}

function createPageWorkOrder(input: {
  run: CourseRun;
  architectureRef: ArtifactRef;
  pageTask: PageTask;
  pageOrderIds: Map<string, string>;
  parentWorkOrderId?: string;
  planningRevision: number;
  budget: AgentBudget;
  allowedTools: readonly string[];
  now: string;
}) {
  const hasDependencies = input.pageTask.buildDependsOnPageIds.length > 0;
  return WorkOrderSchema.parse({
    version: 1,
    lockVersion: 0,
    id: requiredMapValue(input.pageOrderIds, input.pageTask.pageId),
    taskId: input.run.taskId,
    courseId: input.run.courseId,
    parentWorkOrderId: input.parentWorkOrderId,
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: input.pageTask.buildDependsOnPageIds.map(
      (pageId) => requiredMapValue(input.pageOrderIds, pageId),
    ),
    agentId: AgentIds.CoursePageBuilder,
    kind: "build_page",
    scope: { type: "page", pageId: input.pageTask.pageId },
    status: hasDependencies ? "waiting_dependencies" : "queued",
    idempotencyKey: [
      input.run.taskId,
      "build-page",
      input.architectureRef.id,
      input.pageTask.pageId,
      input.planningRevision,
    ].join(":"),
    inputArtifactRefs: [input.architectureRef],
    buildDependencyPageIds: input.pageTask.buildDependsOnPageIds,
    inputSealedAt: hasDependencies ? undefined : input.now,
    checkpointArtifactRefs: [],
    acceptance: pageAcceptance(input.pageTask),
    allowedTools: input.allowedTools,
    budget: input.budget,
    executionAttempt: 0,
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function supersedeOldArchitectureBranch(input: {
  run: CourseRun;
  workOrders: WorkOrderStore;
  now: string;
}) {
  const oldArchitectureId = input.run.activeArchitecture?.architectureRef.id;
  if (!oldArchitectureId) return;
  for (const current of input.workOrders.listByTask(input.run.taskId)) {
    if (
      !["build_page", "fix_page", "review_course"].includes(current.kind) ||
      !current.inputArtifactRefs.some((ref) => ref.id === oldArchitectureId) ||
      current.status === "superseded" ||
      current.status === "failed"
    ) {
      continue;
    }
    const canSupersede = [
      "submitted",
      "accepted",
      "revision_requested",
    ].includes(current.status);
    const next = WorkOrderSchema.parse({
      ...current,
      lockVersion: current.lockVersion + 1,
      status: canSupersede ? "superseded" : "cancelled",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: input.now,
    });
    if (
      !input.workOrders.compareAndSet(next, {
        expectedLockVersion: current.lockVersion,
        expectedStatus: current.status,
        expectedLeaseOwner: current.leaseOwner,
      })
    ) {
      throw new Error(`旧 WorkOrder ${current.id} 失效处理发生并发冲突`);
    }
  }
}

function submittedArchitectureArtifact(
  workOrder: WorkOrder,
  artifacts: CourseArtifactStore,
) {
  const ref = workOrder.submission?.artifactRefs.find(
    (artifact) => artifact.kind === "course_architecture",
  );
  if (!ref) throw new Error("Architect Submission 缺少课程架构 Artifact");
  return requiredArtifact(artifacts.load(ref.id), ref.id);
}

function requiredArchitectWorkOrder(workOrders: WorkOrder[]) {
  const architect = workOrders.find(({ kind }) => kind === "architect_course");
  if (!architect) throw new Error("CourseRun 缺少 Architect WorkOrder");
  return architect;
}

function pageOrdersForArchitecture(
  workOrders: WorkOrder[],
  architectureArtifactId: string,
) {
  return workOrders.filter(
    (workOrder) =>
      (workOrder.kind === "build_page" || workOrder.kind === "fix_page") &&
      workOrder.inputArtifactRefs.some(
        (ref) => ref.id === architectureArtifactId,
      ) &&
      workOrder.status !== "superseded" &&
      workOrder.status !== "cancelled",
  );
}

function assertCourseRunFence(
  database: DatabaseSync,
  run: CourseRun,
  fence: CourseRunCommandFence,
) {
  assertCourseRunTaskExecutionActive(database, run);
  if (
    run.id !== fence.runId ||
    run.lockVersion !== fence.expectedLockVersion ||
    run.traceId !== fence.traceId ||
    run.leaseOwner !== fence.leaseOwner
  ) {
    throw new Error("CourseRun 命令围栏失效");
  }
  if (!run.leaseExpiresAt) {
    throw new Error("CourseRun 未持有有效 lease");
  }
}

/**
 * resume 可能已经为 TaskRecord 换了新 trace，但 CourseRun 尚未来得及 adopt。
 * 只有 TaskStore 在写锁内登记、且仍与当前活动 TaskRecord 一致的 cancel 意图，
 * 才能授权取消旧 trace 的 CourseRun。
 */
function loadAuthorizedCancelIntentTraceId(
  database: DatabaseSync,
  taskId: string,
  courseId: string,
) {
  const row = database
    .prepare(`
      SELECT intent.trace_id AS traceId
      FROM course_task_control_intents AS intent
      INNER JOIN course_tasks AS task
        ON task.id = intent.task_id
       AND task.course_id = intent.course_id
      WHERE intent.task_id = ?
        AND intent.course_id = ?
        AND intent.action = 'cancel'
        AND json_extract(task.payload, '$.traceId') = intent.trace_id
        AND json_extract(task.payload, '$.status')
          IN ('queued', 'running', 'paused')
    `)
    .get(taskId, courseId) as { traceId: string } | undefined;
  return row?.traceId;
}
