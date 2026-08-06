import type { DatabaseSync } from "node:sqlite";

import { AgentIds, ToolIds } from "@/server/agent/ids";
import {
  assertCanCommitPage,
  pageDependenciesAreReady,
} from "@/server/course/policy/run";
import { assertFixSubmissionUsesCurrentCheckpoints } from "@/server/course/policy/page-fix";
import {
  classifyPublicAgentError,
  sanitizePublicDiagnosticText,
} from "@/server/course/projection/public-error";
import {
  requiredArtifact,
  requiredRef,
  requiredRun,
  requiredWorkOrder,
  assertRunExecutionFence,
  toArtifactRef,
} from "@/server/course/store/repository-support";
import type { CourseArtifactStore } from "@/server/course/store/artifact";
import type {
  CourseRunEvent,
  CourseRunEventStore,
} from "@/server/course/store/run-event";
import type { CourseRunStore } from "@/server/course/store/run";
import type {
  CourseToolOperation,
  CourseToolOperationStore,
} from "@/server/course/store/tool-operation";
import { runInTransaction } from "@/server/infra/database/connection";
import type { WorkOrderStore } from "@/server/course/store/work-order";
import {
  CourseArchitectureSchema,
  type CourseArchitecture,
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
  type WorkOrder,
} from "@/shared/course-schema/work-order";

export type PageSubmissionPayloads = {
  content: unknown;
  assets?: unknown;
  html: unknown;
  quality: unknown;
  summary: unknown;
};

export type PageCheckpointKind =
  | "page_content"
  | "page_assets"
  | "page_html"
  | "page_quality";

export type CourseRunPageOperations = {
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

export function createCourseRunPageOperations(input: {
  database: DatabaseSync;
  runs: CourseRunStore;
  workOrders: WorkOrderStore;
  artifacts: CourseArtifactStore;
  events: CourseRunEventStore;
  toolOperations: CourseToolOperationStore;
}): CourseRunPageOperations {
  const {
    database,
    runs,
    workOrders,
    artifacts,
    events,
    toolOperations,
  } = input;

  return {
    checkpointPageArtifact(command) {
      const now = command.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const workOrder = requiredWorkOrder(
          workOrders.load(command.workOrderId),
          command.workOrderId,
        );
        const run = requiredRun(
          runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertRunExecutionFence(
          database,
          run,
          command.traceId,
          command.runLeaseOwner,
        );
        assertRunningPageWorkOrderFence(workOrder, {
          expectedLockVersion:
            command.expectedWorkOrderLockVersion,
          leaseOwner: command.workOrderLeaseOwner,
        });

        const artifact = artifacts.putInTransaction({
          taskId: workOrder.taskId,
          courseId: workOrder.courseId,
          pageId: workOrder.scope.pageId,
          scopeKey: `page:${workOrder.scope.pageId}`,
          kind: command.kind,
          createdByWorkOrderId: workOrder.id,
          payload: command.payload,
          createdAt: now,
        });
        const artifactRef = toArtifactRef(artifact);
        const invalidatedKinds = new Set(
          command.invalidates ?? [],
        );
        const retainedRefs =
          workOrder.checkpointArtifactRefs.filter(
            (ref) =>
              ref.kind !== command.kind &&
              !invalidatedKinds.has(
                ref.kind as PageCheckpointKind,
              ),
          );
        const sameCheckpoint =
          retainedRefs.length + 1 ===
            workOrder.checkpointArtifactRefs.length &&
          workOrder.checkpointArtifactRefs.some(
            (ref) => ref.id === artifactRef.id,
          );
        if (sameCheckpoint) {
          return { workOrder, artifact };
        }

        const next = WorkOrderSchema.parse({
          ...workOrder,
          lockVersion: workOrder.lockVersion + 1,
          checkpointArtifactRefs: [
            ...retainedRefs,
            artifactRef,
          ],
          updatedAt: now,
        });
        if (
          !workOrders.compareAndSet(next, {
            expectedLockVersion: workOrder.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: command.workOrderLeaseOwner,
          })
        ) {
          throw new Error(
            "Page WorkOrder checkpoint 发生并发冲突",
          );
        }
        const event = events.appendInTransaction({
          taskId: workOrder.taskId,
          traceId: command.traceId,
          type: "page_checkpoint_saved",
          stage: pageStageForArtifact(command.kind),
          pageId: workOrder.scope.pageId,
          agent: AgentIds.CoursePageBuilder,
          safeSummary: pageCheckpointSummary(command.kind),
          payload: {
            workOrderId: workOrder.id,
            toolName: command.toolName,
            ...operationPosition(
              findCurrentToolOperation(
                toolOperations,
                workOrder,
                command.toolName,
                command.toolCallId,
              ),
              workOrder,
            ),
            artifactRef,
          },
          createdAt: now,
        });
        return { workOrder: next, artifact, event };
      });
    },

    recordPageRepairDeclined(command) {
      const now = command.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const workOrder = requiredWorkOrder(
          workOrders.load(command.workOrderId),
          command.workOrderId,
        );
        const run = requiredRun(
          runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertRunExecutionFence(
          database,
          run,
          command.traceId,
          command.runLeaseOwner,
        );
        assertRunningPageWorkOrderFence(workOrder, {
          expectedLockVersion:
            command.expectedWorkOrderLockVersion,
          leaseOwner: command.workOrderLeaseOwner,
        });
        const operation = findCurrentToolOperation(
          toolOperations,
          workOrder,
          command.toolName,
          command.toolCallId,
        );
        return events.appendInTransaction({
          id: operation
            ? `run-event-repair-declined-${operation.id}`
            : undefined,
          taskId: workOrder.taskId,
          traceId: command.traceId,
          type: "page_repair_declined",
          stage: "repairing",
          pageId: workOrder.scope.pageId,
          agent: AgentIds.CoursePageBuilder,
          safeSummary: "定向修订拒绝扩大授权范围",
          payload: {
            workOrderId: workOrder.id,
            toolName: command.toolName,
            ...operationPosition(operation, workOrder),
            outcome: "declined",
            resultCode: "PAGE_REPAIR_DECLINED",
          },
          createdAt: now,
        });
      });
    },

    commitPageSubmission(command) {
      const now = command.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const workOrder = requiredWorkOrder(
          workOrders.load(command.workOrderId),
          command.workOrderId,
        );
        const run = requiredRun(
          runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertRunExecutionFence(
          database,
          run,
          command.traceId,
          command.runLeaseOwner,
        );

        if (workOrder.status === "accepted") {
          const current =
            workOrder.scope.type === "page"
              ? run.currentPages[workOrder.scope.pageId]
              : undefined;
          if (
            !current ||
            current.sourceWorkOrderId !== workOrder.id
          ) {
            throw new Error(
              "已接受页面不是当前 CourseRun 页面版本",
            );
          }
          return {
            run,
            workOrder,
            artifacts: workOrder.submission!.artifactRefs.map(
              (ref) =>
                requiredArtifact(
                  artifacts.load(ref.id),
                  ref.id,
                ),
            ),
            unlockedWorkOrders: [],
            events: [],
          };
        }

        if (
          workOrder.lockVersion !==
            command.expectedWorkOrderLockVersion ||
          workOrder.leaseOwner !== command.workOrderLeaseOwner
        ) {
          throw new Error("Page WorkOrder 提交围栏失效");
        }
        assertCanCommitPage({
          run,
          workOrder,
          pageGatePassed: command.pageGatePassed,
        });
        assertFixSubmissionUsesCurrentCheckpoints({
          artifacts,
          payloads: command.payloads,
          workOrder,
        });
        if (workOrder.scope.type !== "page") {
          throw new Error("页面 WorkOrder 缺少 page scope");
        }
        const pageId = workOrder.scope.pageId;
        const architecture = loadActiveArchitecture(
          run,
          artifacts,
        );
        const pageTask = requiredPageTask(
          architecture,
          pageId,
        );
        const createdArtifacts = createPageArtifacts({
          artifacts,
          workOrder,
          pageId,
          payloads: command.payloads,
          now,
        });
        const refsByKind = new Map(
          createdArtifacts.map((artifact) => [
            artifact.kind,
            toArtifactRef(artifact),
          ]),
        );
        const contentRef = requiredRef(
          refsByKind,
          "page_content",
        );
        const htmlRef = requiredRef(refsByKind, "page_html");
        const qualityRef = requiredRef(
          refsByKind,
          "page_quality",
        );
        const summaryRef = requiredRef(
          refsByKind,
          "page_summary",
        );

        const acceptedWorkOrder = WorkOrderSchema.parse({
          ...workOrder,
          lockVersion: workOrder.lockVersion + 1,
          status: "accepted",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          checkpointArtifactRefs:
            createdArtifacts.map(toArtifactRef),
          submission: {
            workOrderId: workOrder.id,
            status: "done",
            artifactRefs:
              createdArtifacts.map(toArtifactRef),
            evidence: command.evidence ?? [
              "页面确定性 Gate 已通过",
            ],
            issues: command.issues ?? [],
          },
          updatedAt: now,
        });
        if (
          !workOrders.compareAndSet(acceptedWorkOrder, {
            expectedLockVersion: workOrder.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: command.workOrderLeaseOwner,
          })
        ) {
          throw new Error("Page WorkOrder 提交发生并发冲突");
        }

        const currentPages = {
          ...run.currentPages,
          [pageId]: {
            sourceWorkOrderId: workOrder.id,
            contentRef,
            assetsRef: refsByKind.get("page_assets"),
            htmlRef,
            qualityRef,
            summaryRef,
          },
        };
        const interimRun = CourseRunSchema.parse({
          ...run,
          currentPages,
          stalePageIds: run.stalePageIds.filter(
            (stalePageId) => stalePageId !== pageId,
          ),
          currentManifestHash: undefined,
          currentReview: undefined,
        });
        const unlockedWorkOrders =
          unlockReadyPageWorkOrders({
            run: interimRun,
            architecture,
            architectureRef:
              run.activeArchitecture!.architectureRef,
            workOrders,
            now,
          });
        const nextRun = CourseRunSchema.parse({
          ...interimRun,
          lockVersion: run.lockVersion + 1,
        });
        if (
          !runs.compareAndSet(
            nextRun,
            {
              expectedLockVersion: run.lockVersion,
              expectedTraceId: run.traceId,
              expectedLeaseOwner: command.runLeaseOwner,
            },
            now,
          )
        ) {
          throw new Error(
            "CourseRun 页面指针更新发生并发冲突",
          );
        }

        const eventList = [
          events.appendInTransaction({
            taskId: run.taskId,
            traceId: run.traceId,
            type: "page_accepted",
            stage: "building",
            pageId,
            agent: AgentIds.CoursePageBuilder,
            safeSummary: `页面 ${pageTask.title} 已通过验收`,
            payload: {
              workOrderId: workOrder.id,
              pageId,
              artifactRefs:
                createdArtifacts.map(toArtifactRef),
            },
            createdAt: now,
          }),
          ...unlockedWorkOrders.map((unlocked) =>
            events.appendInTransaction({
              taskId: run.taskId,
              traceId: run.traceId,
              type: "page_dependencies_unlocked",
              stage: "building",
              pageId:
                unlocked.scope.type === "page"
                  ? unlocked.scope.pageId
                  : undefined,
              agent: "course-run-engine",
              safeSummary:
                "页面生成依赖已满足，任务进入执行队列",
              payload: { workOrderId: unlocked.id },
              createdAt: now,
            }),
          ),
        ];
        return {
          run: nextRun,
          workOrder: acceptedWorkOrder,
          artifacts: createdArtifacts,
          unlockedWorkOrders,
          events: eventList,
        };
      });
    },

    blockPageWorkOrder(command) {
      const now = command.now ?? new Date().toISOString();
      return runInTransaction(database, () => {
        const workOrder = requiredWorkOrder(
          workOrders.load(command.workOrderId),
          command.workOrderId,
        );
        const run = requiredRun(
          runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertRunExecutionFence(
          database,
          run,
          command.traceId,
          command.runLeaseOwner,
        );
        if (workOrder.status === "blocked") {
          return { workOrder };
        }
        assertRunningPageWorkOrderFence(workOrder, {
          expectedLockVersion:
            command.expectedWorkOrderLockVersion,
          leaseOwner: command.workOrderLeaseOwner,
        });
        const publicError = classifyPublicAgentError({
          code: command.code,
          fallbackCode: "PAGE_WORK_ORDER_BLOCKED",
        });
        const publicMessage = sanitizePublicDiagnosticText(command.message, {
          fallback: publicError.message,
          maxLength: 1_000,
        });
        const next = WorkOrderSchema.parse({
          ...workOrder,
          lockVersion: workOrder.lockVersion + 1,
          status: "blocked",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          submission: {
            workOrderId: workOrder.id,
            status: "blocked",
            artifactRefs:
              workOrder.checkpointArtifactRefs,
            evidence: command.evidence ?? [],
            issues: [
              `${publicError.code}: ${publicMessage}`,
            ],
          },
          error: {
            code: publicError.code,
            causeCode: publicError.causeCode,
            message: publicMessage,
            retryable: false,
            occurredAt: now,
          },
          updatedAt: now,
        });
        if (
          !workOrders.compareAndSet(next, {
            expectedLockVersion: workOrder.lockVersion,
            expectedStatus: "running",
            expectedLeaseOwner: command.workOrderLeaseOwner,
          })
        ) {
          throw new Error(
            "Page WorkOrder 阻塞提交发生并发冲突",
          );
        }
        const event = events.appendInTransaction({
          taskId: workOrder.taskId,
          traceId: command.traceId,
          type: "page_blocked",
          stage: "building",
          pageId: workOrder.scope.pageId,
          agent: AgentIds.CoursePageBuilder,
          safeSummary: `页面任务已阻塞：${publicMessage}`,
          payload: {
            workOrderId: workOrder.id,
            code: publicError.code,
          },
          createdAt: now,
        });
        return { workOrder: next, event };
      });
    },
  };
}

function createPageArtifacts(input: {
  artifacts: CourseArtifactStore;
  workOrder: WorkOrder;
  pageId: string;
  payloads: PageSubmissionPayloads;
  now: string;
}) {
  const base = {
    taskId: input.workOrder.taskId,
    courseId: input.workOrder.courseId,
    pageId: input.pageId,
    scopeKey: `page:${input.pageId}`,
    createdByWorkOrderId: input.workOrder.id,
    createdAt: input.now,
  };
  const created = [
    input.artifacts.putInTransaction({
      ...base,
      kind: "page_content",
      payload: input.payloads.content,
    }),
  ];
  if (input.payloads.assets !== undefined) {
    created.push(
      input.artifacts.putInTransaction({
        ...base,
        kind: "page_assets",
        payload: input.payloads.assets,
      }),
    );
  }
  created.push(
    input.artifacts.putInTransaction({
      ...base,
      kind: "page_html",
      payload: input.payloads.html,
    }),
    input.artifacts.putInTransaction({
      ...base,
      kind: "page_quality",
      payload: input.payloads.quality,
    }),
    input.artifacts.putInTransaction({
      ...base,
      kind: "page_summary",
      payload: input.payloads.summary,
    }),
  );
  return created;
}

function unlockReadyPageWorkOrders(input: {
  run: CourseRun;
  architecture: CourseArchitecture;
  architectureRef: ArtifactRef;
  workOrders: WorkOrderStore;
  now: string;
}) {
  const pageTasks = new Map(
    input.architecture.pageTasks.map((pageTask) => [
      pageTask.pageId,
      pageTask,
    ]),
  );
  const unlocked: WorkOrder[] = [];
  for (const waiting of input.workOrders.listByTask(
    input.run.taskId,
    ["waiting_dependencies"],
  )) {
    if (
      !waiting.inputArtifactRefs.some(
        (ref) => ref.id === input.architectureRef.id,
      ) ||
      waiting.scope.type !== "page"
    ) {
      continue;
    }
    const pageTask = pageTasks.get(waiting.scope.pageId);
    if (
      !pageTask ||
      !pageDependenciesAreReady({
        pageTask,
        run: input.run,
      })
    ) {
      continue;
    }
    const dependencySummaryRefs =
      pageTask.buildDependsOnPageIds.map(
        (pageId) =>
          input.run.currentPages[pageId]!.summaryRef,
      );
    const next = WorkOrderSchema.parse({
      ...waiting,
      lockVersion: waiting.lockVersion + 1,
      status: "queued",
      // Fix WorkOrder 还会携带 Review、旧页面等封口输入，不能覆盖。
      inputArtifactRefs: [
        ...new Map(
          [
            ...waiting.inputArtifactRefs,
            input.architectureRef,
            ...dependencySummaryRefs,
          ].map((ref) => [ref.id, ref]),
        ).values(),
      ],
      inputSealedAt: input.now,
      updatedAt: input.now,
    });
    if (
      !input.workOrders.compareAndSet(next, {
        expectedLockVersion: waiting.lockVersion,
        expectedStatus: "waiting_dependencies",
      })
    ) {
      throw new Error(
        `页面 ${waiting.scope.pageId} 依赖解锁发生并发冲突`,
      );
    }
    unlocked.push(next);
  }
  return unlocked;
}

function loadActiveArchitecture(
  run: CourseRun,
  artifacts: CourseArtifactStore,
) {
  const ref = run.activeArchitecture?.architectureRef;
  if (!ref) {
    throw new Error("CourseRun 尚无 active Architecture");
  }
  const artifact = requiredArtifact(
    artifacts.load(ref.id),
    ref.id,
  );
  return CourseArchitectureSchema.parse(artifact.payload);
}

function assertRunningPageWorkOrderFence(
  workOrder: WorkOrder,
  fence: {
    expectedLockVersion: number;
    leaseOwner: string;
  },
): asserts workOrder is WorkOrder & {
  scope: { type: "page"; pageId: string };
} {
  if (
    (workOrder.kind !== "build_page" &&
      workOrder.kind !== "fix_page") ||
    workOrder.scope.type !== "page"
  ) {
    throw new Error(
      "只有页面 WorkOrder 能保存页面 checkpoint",
    );
  }
  if (
    workOrder.status !== "running" ||
    workOrder.lockVersion !== fence.expectedLockVersion ||
    workOrder.leaseOwner !== fence.leaseOwner
  ) {
    throw new Error(
      "Page WorkOrder checkpoint 围栏失效",
    );
  }
}

function findCurrentToolOperation(
  store: CourseToolOperationStore,
  workOrder: WorkOrder,
  toolName: string,
  toolCallId: string | undefined,
) {
  if (!toolCallId) return undefined;
  return store
    .listByWorkOrder(workOrder.id)
    .find(
      (operation) =>
        operation.executionAttempt ===
          workOrder.executionAttempt &&
        operation.toolCallId === toolCallId &&
        operation.toolName === toolName,
    );
}

function operationPosition(
  operation: CourseToolOperation | undefined,
  workOrder: WorkOrder,
) {
  return {
    executionAttempt:
      operation?.executionAttempt ?? workOrder.executionAttempt,
    ...(operation
      ? {
          agentStepNumber: operation.agentStepNumber,
          toolOrdinal: operation.toolOrdinal,
          toolCallId: operation.toolCallId,
        }
      : {}),
  };
}

function pageStageForArtifact(kind: PageCheckpointKind) {
  switch (kind) {
    case "page_content":
      return "page_writer";
    case "page_assets":
      return "assets";
    case "page_html":
      return "html";
    case "page_quality":
      return "qa";
  }
}

function pageCheckpointSummary(kind: PageCheckpointKind) {
  switch (kind) {
    case "page_content":
      return "页面内容已保存";
    case "page_assets":
      return "页面素材已保存";
    case "page_html":
      return "页面 HTML 已保存";
    case "page_quality":
      return "页面质量报告已保存";
  }
}

function requiredPageTask(
  architecture: CourseArchitecture,
  pageId: string,
) {
  const pageTask = architecture.pageTasks.find(
    (page) => page.pageId === pageId,
  );
  if (!pageTask) {
    throw new Error(`课程架构中不存在页面 ${pageId}`);
  }
  return pageTask;
}
