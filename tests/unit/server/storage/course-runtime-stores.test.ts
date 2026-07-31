import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCoursePublicEventProjectionContext,
  projectCoursePublicEvents,
} from "../../../../src/server/course/projection/public-events";
import {
  createCourseArtifactStore,
} from "../../../../src/server/course/store/artifact";
import { createCoursePublicEventReader } from "../../../../src/server/course/stream/public-event-reader";
import {
  createCourseRunEventStore,
  type CourseRunEvent,
} from "../../../../src/server/course/store/run-event";
import {
  createCourseRunStore,
} from "../../../../src/server/course/store/run";
import {
  createCourseToolOperationStore,
  createLogicalOperationKey,
} from "../../../../src/server/course/store/tool-operation";
import {
  resolveAppDatabase,
  runInTransaction,
} from "../../../../src/server/infra/database/connection";
import {
  createWorkOrderStore,
} from "../../../../src/server/course/store/work-order";
import type {
  ArtifactRef,
  CourseArchitecture,
  CourseArtifact,
  CourseRun,
  WorkOrder,
} from "../../../../src/shared/course-schema";
import { createArchitecture } from "../../../fixtures/course-architecture";

const directories: string[] = [];
const NOW = "2026-07-29T08:00:00.000Z";

async function temporaryRoot() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "course-runtime-store-test-"),
  );
  directories.push(directory);
  return directory;
}

function courseRun(overrides: Partial<CourseRun> = {}): CourseRun {
  return {
    id: "course-run-01",
    taskId: "task-runtime-01",
    courseId: "course-runtime-01",
    lockVersion: 0,
    phase: "planning",
    traceId: "trace-runtime-01",
    planningRevision: 0,
    currentPages: {},
    stalePageIds: [],
    replanRound: 0,
    courseRevisionRound: 0,
    ...overrides,
  };
}

function workOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    lockVersion: 0,
    id: "work-order-01",
    taskId: "task-runtime-01",
    courseId: "course-runtime-01",
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: [],
    agentId: "curriculum-architect",
    kind: "architect_course",
    scope: { type: "course" },
    status: "queued",
    idempotencyKey: "task-runtime-01:architect:1",
    inputArtifactRefs: [],
    buildDependencyPageIds: [],
    inputSealedAt: NOW,
    checkpointArtifactRefs: [],
    acceptance: ["提交完整课程架构"],
    allowedTools: ["submit_course_architecture"],
    budget: {
      maxSteps: 8,
      maxToolCalls: 8,
      timeoutMs: 180_000,
      maxOutputTokens: 16_000,
    },
    executionAttempt: 0,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function architectureForCourse(courseId: string): CourseArchitecture {
  const architecture = createArchitecture();
  return {
    ...architecture,
    courseId,
    coursePack: {
      ...architecture.coursePack,
      courseId,
    },
    blueprint: {
      ...architecture.blueprint,
      courseId,
    },
  };
}

function artifactRefOf(artifact: CourseArtifact): ArtifactRef {
  return {
    id: artifact.id,
    kind: artifact.kind,
    courseId: artifact.courseId,
    pageId: artifact.pageId,
    scopeKey: artifact.scopeKey,
    revision: artifact.revision,
    contentHash: artifact.contentHash,
  };
}

function publicRunEvent(input: {
  taskId: string;
  traceId: string;
  sequence: number;
  workOrderId: string;
  summary: string;
}): CourseRunEvent {
  return {
    id: `run-event-${input.sequence}`,
    taskId: input.taskId,
    sequence: input.sequence,
    traceId: input.traceId,
    type: "work_order_claimed",
    stage: "planning",
    agent: "curriculum-architect",
    safeSummary: input.summary,
    payload: { workOrderId: input.workOrderId },
    createdAt: NOW,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("课程 Agent 运行时数据库", () => {
  it("建立课程运行所需的数据表", async () => {
    const database = resolveAppDatabase({
      rootDir: await temporaryRoot(),
    });
    const rows = database
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'course_%'
        ORDER BY name
      `)
      .all() as Array<{ name: string }>;

    expect(rows.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "course_runs",
        "course_work_orders",
        "course_artifacts",
        "course_tool_operations",
        "course_run_events",
      ]),
    );
  });

});

describe("CourseRun 与 WorkOrder lease", () => {
  it("两个数据库连接只能有一个领取同一 CourseRun", async () => {
    const rootDir = await temporaryRoot();
    const first = createCourseRunStore({ rootDir });
    const second = createCourseRunStore({ rootDir });
    first.insert(courseRun(), NOW);

    const [firstClaim, secondClaim] = await Promise.all([
      Promise.resolve().then(() =>
        first.claimLease({
          runId: "course-run-01",
          owner: "worker-a",
          now: NOW,
          durationMs: 30_000,
        }),
      ),
      Promise.resolve().then(() =>
        second.claimLease({
          runId: "course-run-01",
          owner: "worker-b",
          now: NOW,
          durationMs: 30_000,
        }),
      ),
    ]);

    expect([firstClaim, secondClaim].filter(Boolean)).toHaveLength(1);
    expect(first.load("course-run-01")?.leaseOwner).toMatch(/^worker-[ab]$/);
  });

  it("只允许在旧 lease 失效后切换 trace，并允许当前 owner 续租", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseRunStore({ rootDir });
    store.insert(courseRun(), NOW);
    const claimed = store.claimLease({
      runId: "course-run-01",
      owner: "worker-a",
      now: NOW,
      durationMs: 1_000,
      expectedTraceId: "trace-runtime-01",
    });
    expect(claimed).toBeDefined();
    expect(
      store.adoptTrace({
        runId: "course-run-01",
        previousTraceId: "trace-runtime-01",
        nextTraceId: "trace-runtime-02",
        now: "2026-07-29T08:00:00.500Z",
      }),
    ).toBeUndefined();

    const adopted = store.adoptTrace({
      runId: "course-run-01",
      previousTraceId: "trace-runtime-01",
      nextTraceId: "trace-runtime-02",
      now: "2026-07-29T08:00:02.000Z",
    });
    expect(adopted).toMatchObject({
      traceId: "trace-runtime-02",
      leaseOwner: undefined,
    });

    const reclaimed = store.claimLease({
      runId: "course-run-01",
      owner: "worker-b",
      now: "2026-07-29T08:00:02.000Z",
      durationMs: 1_000,
      expectedTraceId: "trace-runtime-02",
    });
    const renewed = store.renewLease({
      runId: "course-run-01",
      owner: "worker-b",
      now: "2026-07-29T08:00:02.500Z",
      durationMs: 5_000,
      expectedTraceId: "trace-runtime-02",
    });
    expect(renewed?.lockVersion).toBe((reclaimed?.lockVersion ?? 0) + 1);
    expect(renewed?.leaseExpiresAt).toBe(
      "2026-07-29T08:00:07.500Z",
    );
  });

  it("取消 CourseRun 会原子清除 lease，并让旧 worker 失去写权限", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseRunStore({ rootDir });
    store.insert(courseRun(), NOW);
    const claimed = store.claimLease({
      runId: "course-run-01",
      owner: "worker-a",
      now: NOW,
      durationMs: 30_000,
      expectedTraceId: "trace-runtime-01",
    });
    const cancelled = store.cancel({
      runId: "course-run-01",
      expectedTraceId: "trace-runtime-01",
      now: "2026-07-29T08:00:01.000Z",
    });

    expect(cancelled).toMatchObject({
      phase: "cancelled",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    expect(
      store.releaseLease({
        runId: "course-run-01",
        owner: "worker-a",
        expectedLockVersion: claimed!.lockVersion,
        expectedTraceId: "trace-runtime-01",
        now: "2026-07-29T08:00:02.000Z",
      }),
    ).toBeUndefined();
  });

  it("过期 WorkOrder lease 可被接管，未过期时拒绝第二个 worker", async () => {
    const rootDir = await temporaryRoot();
    const first = createWorkOrderStore({ rootDir });
    const second = createWorkOrderStore({ rootDir });
    first.insert(workOrder());

    const claimed = first.claim("work-order-01", {
      owner: "worker-a",
      now: NOW,
      durationMs: 1_000,
    });
    expect(claimed).toMatchObject({
      status: "running",
      leaseOwner: "worker-a",
      executionAttempt: 1,
    });
    expect(
      second.claim("work-order-01", {
        owner: "worker-b",
        now: "2026-07-29T08:00:00.500Z",
        durationMs: 1_000,
      }),
    ).toBeUndefined();

    const reclaimed = second.claim("work-order-01", {
      owner: "worker-b",
      now: "2026-07-29T08:00:02.000Z",
      durationMs: 1_000,
    });
    expect(reclaimed).toMatchObject({
      status: "running",
      leaseOwner: "worker-b",
      executionAttempt: 2,
    });
  });

  it("当前 owner 可以在模型 fallback 前续期 WorkOrder lease", async () => {
    const store = createWorkOrderStore({
      rootDir: await temporaryRoot(),
    });
    store.insert(workOrder());
    const claimed = store.claim("work-order-01", {
      owner: "worker-a",
      now: NOW,
      durationMs: 1_000,
    })!;
    const renewed = store.renewLease({
      workOrderId: claimed.id,
      owner: "worker-a",
      expectedLockVersion: claimed.lockVersion,
      now: "2026-07-29T08:00:00.500Z",
      durationMs: 10_000,
    });

    expect(renewed).toMatchObject({
      status: "running",
      leaseOwner: "worker-a",
      leaseExpiresAt: "2026-07-29T08:00:10.500Z",
      lockVersion: claimed.lockVersion + 1,
    });
    expect(
      store.renewLease({
        workOrderId: claimed.id,
        owner: "worker-b",
        expectedLockVersion: renewed!.lockVersion,
        now: "2026-07-29T08:00:01.000Z",
        durationMs: 10_000,
      }),
    ).toBeUndefined();
  });

  it("拒绝旧 lockVersion 的 CourseRun CAS", async () => {
    const store = createCourseRunStore({
      rootDir: await temporaryRoot(),
    });
    const inserted = store.insert(courseRun(), NOW);
    const next = { ...inserted, lockVersion: 1 } satisfies CourseRun;

    expect(
      store.compareAndSet(next, {
        expectedLockVersion: 0,
        expectedTraceId: inserted.traceId,
      }),
    ).toBe(true);
    expect(
      store.compareAndSet(next, {
        expectedLockVersion: 0,
        expectedTraceId: inserted.traceId,
      }),
    ).toBe(false);
  });
});

describe("Artifact、Tool operation 与事件幂等", () => {
  it("Artifact 只在同一 WorkOrder 内按内容哈希幂等", async () => {
    const store = createCourseArtifactStore({
      rootDir: await temporaryRoot(),
    });
    const base = {
      taskId: "task-runtime-01",
      courseId: "course-runtime-01",
      pageId: "page-01",
      scopeKey: "page:page-01",
      kind: "page_summary" as const,
      createdByWorkOrderId: "work-order-page-01",
      createdAt: NOW,
    };

    const first = store.put({ ...base, payload: { summary: "第一版" } });
    const duplicate = store.put({
      ...base,
      payload: { summary: "第一版" },
    });
    const resubmitted = store.put({
      ...base,
      createdByWorkOrderId: "work-order-page-retry",
      payload: { summary: "第一版" },
    });
    const revised = store.put({
      ...base,
      payload: { summary: "第二版" },
    });
    const otherTask = store.put({
      ...base,
      taskId: "task-runtime-02",
      payload: { summary: "第一版" },
    });

    expect(duplicate).toEqual(first);
    expect(resubmitted.revision).toBe(2);
    expect(resubmitted.createdByWorkOrderId).toBe("work-order-page-retry");
    expect(revised.revision).toBe(3);
    expect(otherTask.revision).toBe(1);
    expect(otherTask.id).not.toBe(first.id);
  });

  it("Provider 重跑生成新 toolCallId 时仍按 logicalOperationKey 去重", async () => {
    const store = createCourseToolOperationStore({
      rootDir: await temporaryRoot(),
    });
    const logicalOperationKey = createLogicalOperationKey({
      workOrderId: "work-order-page-01",
      toolName: "generate_image",
      businessParameters: { prompt: "太阳系结构图" },
    });
    const first = store.begin({
      workOrderId: "work-order-page-01",
      executionAttempt: 1,
      agentStepNumber: 1,
      toolOrdinal: 1,
      toolCallId: "provider-call-a",
      toolName: "generate_image",
      input: { prompt: "太阳系结构图" },
      logicalOperationKey,
      startedAt: NOW,
    });
    const duplicate = store.begin({
      workOrderId: "work-order-page-01",
      executionAttempt: 2,
      agentStepNumber: 1,
      toolOrdinal: 1,
      toolCallId: "provider-call-b",
      toolName: "generate_image",
      input: { prompt: "太阳系结构图" },
      logicalOperationKey,
      startedAt: NOW,
    });

    expect(duplicate).toEqual(first);
    expect(store.listByWorkOrder("work-order-page-01")).toHaveLength(1);
  });

  it("事件 sequence 在数据库事务中按 task 单调分配", async () => {
    const rootDir = await temporaryRoot();
    const first = createCourseRunEventStore({ rootDir });
    const second = createCourseRunEventStore({ rootDir });
    const base = {
      taskId: "task-runtime-01",
      traceId: "trace-runtime-01",
      type: "work_order_changed",
      safeSummary: "任务状态已更新",
      payload: {},
      createdAt: NOW,
    };

    first.append(base);
    second.append({ ...base, type: "artifact_created" });
    first.append({ ...base, type: "page_accepted" });

    expect(first.list("task-runtime-01").map(({ sequence }) => sequence)).toEqual(
      [1, 2, 3],
    );
    expect(
      first
        .listAfter({
          taskId: "task-runtime-01",
          afterSequence: 1,
        })
        .map(({ sequence }) => sequence),
    ).toEqual([2, 3]);
  });

  it("SSE reader 按 durable sequence 增量读取并过滤非当前 revision payload", async () => {
    const rootDir = await temporaryRoot();
    const runs = createCourseRunStore({ rootDir });
    const orders = createWorkOrderStore({ rootDir });
    const events = createCourseRunEventStore({ rootDir });
    const reader = createCoursePublicEventReader({ rootDir });
    const taskId = "task-public-reader";
    const courseId = "course-public-reader";
    const traceId = "trace-public-reader";
    const activeOrder = workOrder({
      id: "work-order-current-architect",
      taskId,
      courseId,
      idempotencyKey: `${taskId}:architect:2`,
      revision: 2,
    });
    const oldOrder = workOrder({
      id: "work-order-old-revision",
      taskId,
      courseId,
      idempotencyKey: `${taskId}:architect:1`,
      status: "revision_requested",
      submission: {
        workOrderId: "work-order-old-revision",
        status: "done",
        artifactRefs: [],
        evidence: ["旧架构已被主 Agent 检查"],
        issues: ["需要重新规划"],
      },
    });

    runs.insert(
      courseRun({
        id: "course-run-public-reader",
        taskId,
        courseId,
        traceId,
      }),
      NOW,
    );
    orders.insert(oldOrder);
    orders.insert(activeOrder);
    events.append({
      taskId,
      traceId,
      type: "course_run_bootstrapped",
      stage: "planning",
      safeSummary: "课程任务已创建",
      payload: { privatePrompt: "绝不能出现在 SSE" },
      createdAt: NOW,
    });
    events.append({
      taskId,
      traceId,
      type: "work_order_claimed",
      stage: "planning",
      safeSummary: "旧 revision 已开始",
      payload: {
        workOrderId: "work-order-old-revision",
        privatePrompt: "绝不能出现在 SSE",
      },
      createdAt: NOW,
    });
    events.append({
      taskId,
      traceId: "trace-public-reader-old-attempt",
      type: "work_order_claimed",
      stage: "planning",
      safeSummary: "其他 trace 不应重放",
      payload: { workOrderId: activeOrder.id },
      createdAt: NOW,
    });
    events.append({
      taskId,
      traceId,
      type: "work_order_claimed",
      stage: "planning",
      agent: "curriculum-architect",
      safeSummary: "当前 Architect 已开始",
      payload: {
        workOrderId: activeOrder.id,
        privatePrompt: "绝不能出现在 SSE",
      },
      createdAt: NOW,
    });

    const batch = reader.listAfter({
      taskId,
      traceId,
      afterSequence: 1,
    });

    expect(batch.scannedThroughSequence).toBe(4);
    expect(batch.events).toEqual([
      expect.objectContaining({
        sequence: 4,
        summary: "当前 Architect 已开始",
      }),
    ]);
    expect(JSON.stringify(batch.events)).not.toContain("privatePrompt");
    expect(
      reader.listAfter({
        taskId,
        traceId,
        afterSequence: batch.scannedThroughSequence,
      }),
    ).toMatchObject({
      scannedThroughSequence: 4,
      events: [],
    });
  });

  it("replan 未切换 activeArchitecture 时实时投影新版 Architect 事件", async () => {
    const rootDir = await temporaryRoot();
    const runs = createCourseRunStore({ rootDir });
    const orders = createWorkOrderStore({ rootDir });
    const artifacts = createCourseArtifactStore({ rootDir });
    const events = createCourseRunEventStore({ rootDir });
    const reader = createCoursePublicEventReader({ rootDir });
    const taskId = "task-replan-event-reader";
    const courseId = "course-replan-event-reader";
    const traceId = "trace-replan-event-reader";
    const architectAId = "work-order-architect-a";
    const architectBId = "work-order-architect-b";
    const architectureA = architectureForCourse(courseId);
    const architectureB = {
      ...architectureForCourse(courseId),
      blueprint: {
        ...architectureForCourse(courseId).blueprint,
        title: "新版课程架构",
      },
    };
    const artifactA = artifacts.put({
      taskId,
      courseId,
      scopeKey: "course",
      kind: "course_architecture",
      createdByWorkOrderId: architectAId,
      payload: architectureA,
      createdAt: NOW,
    });
    const artifactB = artifacts.put({
      taskId,
      courseId,
      scopeKey: "course",
      kind: "course_architecture",
      createdByWorkOrderId: architectBId,
      payload: architectureB,
      createdAt: "2026-07-29T08:00:01.000Z",
    });
    const architectureARef = artifactRefOf(artifactA);
    const architectureBRef = artifactRefOf(artifactB);
    const architectA = workOrder({
      id: architectAId,
      taskId,
      courseId,
      status: "accepted",
      idempotencyKey: `${taskId}:architect:1`,
      submission: {
        workOrderId: architectAId,
        status: "done",
        artifactRefs: [architectureARef],
        evidence: ["旧架构已验收"],
        issues: [],
      },
    });
    const architectB = workOrder({
      id: architectBId,
      taskId,
      courseId,
      supersedesWorkOrderId: architectAId,
      status: "submitted",
      idempotencyKey: `${taskId}:architect:2`,
      revision: 2,
      submission: {
        workOrderId: architectBId,
        status: "done",
        artifactRefs: [architectureBRef],
        evidence: ["新版架构已提交"],
        issues: [],
      },
      createdAt: "2026-07-29T08:00:01.000Z",
      updatedAt: "2026-07-29T08:00:02.000Z",
    });

    orders.insert(architectA);
    orders.insert(architectB);
    runs.insert(
      courseRun({
        id: "course-run-replan-event-reader",
        taskId,
        courseId,
        traceId,
        phase: "revising",
        planningRevision: 1,
        activeArchitecture: {
          submissionWorkOrderId: architectAId,
          architectureRef: architectureARef,
        },
        replanRound: 1,
      }),
      NOW,
    );
    events.append({
      taskId,
      traceId,
      type: "course_replan_requested",
      stage: "planning",
      safeSummary: "主 Agent 已要求重新规划",
      payload: { architectWorkOrderId: architectBId },
      createdAt: NOW,
    });
    events.append({
      taskId,
      traceId,
      type: "work_order_claimed",
      stage: "planning",
      agent: "curriculum-architect",
      safeSummary: "新版 Architect 已开始",
      payload: {
        workOrderId: architectBId,
        privatePrompt: "绝不能出现在 SSE",
      },
      createdAt: "2026-07-29T08:00:01.000Z",
    });
    events.append({
      taskId,
      traceId,
      type: "architecture_submitted",
      stage: "planning",
      agent: "curriculum-architect",
      safeSummary: "新版课程架构已提交",
      payload: {
        workOrderId: architectBId,
        architectureRef: architectureBRef,
        privatePrompt: "绝不能出现在 SSE",
      },
      createdAt: "2026-07-29T08:00:02.000Z",
    });

    const batch = reader.listAfter({
      taskId,
      traceId,
      afterSequence: 1,
    });

    expect(batch.scannedThroughSequence).toBe(3);
    expect(batch.events.map(({ sequence }) => sequence)).toEqual([2, 3]);
    expect(batch.events.map(({ summary }) => summary)).toEqual([
      "新版 Architect 已开始",
      "新版课程架构已提交",
    ]);
    expect(JSON.stringify(batch.events)).not.toContain("privatePrompt");
    expect(
      reader.listAfter({
        taskId,
        traceId,
        afterSequence: batch.scannedThroughSequence,
      }).events,
    ).toEqual([]);
  });

  it("Architect B 被退回且 C queued 时只选择 C", () => {
    const taskId = "task-architect-selection";
    const courseId = "course-architect-selection";
    const traceId = "trace-architect-selection";
    const architectureRef: ArtifactRef = {
      id: "artifact-architecture-a",
      kind: "course_architecture",
      courseId,
      scopeKey: "course",
      revision: 1,
      contentHash: "architecture-a-hash",
    };
    const architectA = workOrder({
      id: "architect-a",
      taskId,
      courseId,
      status: "accepted",
      idempotencyKey: `${taskId}:architect:1`,
      submission: {
        workOrderId: "architect-a",
        status: "done",
        artifactRefs: [architectureRef],
        evidence: ["A 已验收"],
        issues: [],
      },
    });
    const architectB = workOrder({
      id: "architect-b",
      taskId,
      courseId,
      supersedesWorkOrderId: architectA.id,
      status: "revision_requested",
      idempotencyKey: `${taskId}:architect:2`,
      revision: 2,
      submission: {
        workOrderId: "architect-b",
        status: "done",
        artifactRefs: [architectureRef],
        evidence: ["B 已检查"],
        issues: ["B 需要修改"],
      },
    });
    const architectC = workOrder({
      id: "architect-c",
      taskId,
      courseId,
      supersedesWorkOrderId: architectB.id,
      status: "queued",
      idempotencyKey: `${taskId}:architect:3`,
      revision: 3,
    });
    const run = courseRun({
      id: "course-run-architect-selection",
      taskId,
      courseId,
      traceId,
      phase: "revising",
      activeArchitecture: {
        submissionWorkOrderId: architectA.id,
        architectureRef,
      },
      replanRound: 1,
    });
    const context = createCoursePublicEventProjectionContext({
      run,
      workOrders: [architectA, architectB, architectC],
    });
    const publicEvents = projectCoursePublicEvents({
      ...context,
      events: [
        publicRunEvent({
          taskId,
          traceId,
          sequence: 10,
          workOrderId: architectB.id,
          summary: "B 不应重新出现",
        }),
        publicRunEvent({
          taskId,
          traceId,
          sequence: 11,
          workOrderId: architectC.id,
          summary: "C 已成为当前 Architect",
        }),
      ],
      historyLimit: null,
    });

    expect(context.selectedArchitectWorkOrder?.id).toBe(architectC.id);
    expect(publicEvents.map(({ sequence }) => sequence)).toEqual([11]);
    expect(publicEvents[0]?.summary).toBe("C 已成为当前 Architect");
  });

  it("事务失败不会留下半个 Artifact 或半个事件", async () => {
    const rootDir = await temporaryRoot();
    const database = resolveAppDatabase({ rootDir });
    const artifacts = createCourseArtifactStore({ database });
    const events = createCourseRunEventStore({ database });

    expect(() =>
      runInTransaction(database, () => {
        artifacts.putInTransaction({
          taskId: "task-runtime-01",
          courseId: "course-runtime-01",
          pageId: "page-01",
          scopeKey: "page:page-01",
          kind: "page_summary",
          createdByWorkOrderId: "work-order-page-01",
          payload: { summary: "不应提交" },
          createdAt: NOW,
        });
        events.appendInTransaction({
          taskId: "task-runtime-01",
          traceId: "trace-runtime-01",
          type: "page_accepted",
          safeSummary: "不应提交",
          payload: {},
          createdAt: NOW,
        });
        throw new Error("模拟事务末尾失败");
      }),
    ).toThrow("模拟事务末尾失败");

    expect(artifacts.listByTask("task-runtime-01")).toEqual([]);
    expect(events.list("task-runtime-01")).toEqual([]);
  });
});
