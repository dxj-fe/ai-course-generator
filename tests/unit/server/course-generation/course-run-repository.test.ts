import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCourseRunRepository,
  type CourseRunRepository,
} from "../../../../src/server/course/store/repository";
import { AgentIds } from "../../../../src/server/agent/ids";
import { createCourseRevisionCommands } from "../../../../src/server/course/run/revision-commands";
import { createCourseTaskStore } from "../../../../src/server/course/store/task";
import type {
  CourseArchitecture,
  CourseTaskRecord,
  WorkOrder,
} from "../../../../src/shared/course-schema";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

const directories: string[] = [];
const NOW = "2026-07-29T09:00:00.000Z";

async function temporaryRoot() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "course-run-repository-test-"),
  );
  directories.push(directory);
  return directory;
}

function architecture(): CourseArchitecture {
  return {
    courseId: "course-repository-01",
    coursePack: {
      courseId: "course-repository-01",
      topic: "太阳系",
      facts: [],
      terms: [],
      examples: [],
      constraints: ["用通俗中文解释"],
    },
    blueprint: {
      courseId: "course-repository-01",
      title: "三步看懂太阳系",
      audience: {
        description: "第一次接触太阳系的学习者",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-01",
          outcome: "能说出太阳系的基本组成",
          evidence: "完成页面中的判断练习",
        },
      ],
      courseRules: {
        tone: "直接、清楚",
        terminology: ["恒星", "行星"],
        visualDirection: "清晰的轨道关系示意",
        visualStyle: "minimal",
        styleTemplateId: "style-minimal",
        teachingPattern: ["先看整体，再看组成，最后练习"],
      },
    },
    pageTasks: [
      pageTask({
        pageId: "page-01",
        order: 1,
        title: "太阳系全景",
      }),
      pageTask({
        pageId: "page-02",
        order: 2,
        title: "恒星与行星",
      }),
      pageTask({
        pageId: "page-03",
        order: 3,
        title: "检查你是否看懂",
        buildDependsOnPageIds: ["page-01", "page-02"],
      }),
    ],
  };
}

function pageTask(
  overrides: Partial<CourseArchitecture["pageTasks"][number]>,
): CourseArchitecture["pageTasks"][number] {
  const pageId = overrides.pageId ?? "page-01";
  return {
    pageId,
    order: overrides.order ?? 1,
    title: overrides.title ?? "课程页面",
    pageType: "knowledge_card",
    purpose: "讲清本页负责的核心内容",
    objectiveIds: ["objective-01"],
    buildDependsOnPageIds: [],
    teachingPoints: ["太阳系由恒星和围绕它运行的天体组成"],
    learnerAction: "观察示意并回答一个问题",
    assessment: "判断太阳是否属于恒星",
    referenceUsages: [],
    functionalTemplateId: "knowledge-card",
    styleTemplateId: "style-minimal",
    interactionType: "none",
    assetNeeds: [],
    acceptance: {
      requiredConcepts: ["恒星", "行星"],
      expectedLearnerOutcome: "能复述本页核心结论",
      requiresInteraction: false,
      pageSpecific: [],
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CourseRunRepository", () => {
  it("接受完整 Architecture 后一次性 fan-out 恰好 N 个同版本页单", async () => {
    const repository = createCourseRunRepository({
      rootDir: await temporaryRoot(),
    });
    const prepared = prepareSubmittedArchitecture(repository);

    const accepted = repository.acceptArchitectureAndDispatchPages({
      fence: {
        runId: prepared.run.id,
        expectedLockVersion: prepared.run.lockVersion,
        traceId: prepared.run.traceId,
        leaseOwner: "engine-01",
      },
      architectWorkOrderId: prepared.architect.id,
      directorWorkOrderId: "director-round-01",
      now: "2026-07-29T09:00:02.000Z",
    });

    expect(accepted.pageWorkOrders).toHaveLength(3);
    expect(prepared.architect.agentId).toBe(
      AgentIds.CourseArchitect,
    );
    expect(
      accepted.pageWorkOrders.every(
        ({ agentId }) => agentId === AgentIds.CoursePageBuilder,
      ),
    ).toBe(true);
    expect(
      accepted.pageWorkOrders.map(({ scope }) =>
        scope.type === "page" ? scope.pageId : "course",
      ),
    ).toEqual(["page-01", "page-02", "page-03"]);
    expect(
      accepted.pageWorkOrders.map(({ status }) => status),
    ).toEqual(["queued", "queued", "waiting_dependencies"]);
    const architectureRefIds = new Set(
      accepted.pageWorkOrders.map(
        ({ inputArtifactRefs }) =>
          inputArtifactRefs.find(
            ({ kind }) => kind === "course_architecture",
          )!.id,
      ),
    );
    expect(architectureRefIds).toEqual(
      new Set([accepted.run.activeArchitecture!.architectureRef.id]),
    );
    expect(accepted.architectWorkOrder.status).toBe("accepted");
    expect(accepted.run).toMatchObject({
      phase: "building",
      planningRevision: 1,
      currentPages: {},
    });

    const repeated = repository.acceptArchitectureAndDispatchPages({
      fence: {
        runId: prepared.run.id,
        expectedLockVersion: prepared.run.lockVersion,
        traceId: prepared.run.traceId,
        leaseOwner: "engine-01",
      },
      architectWorkOrderId: prepared.architect.id,
      now: "2026-07-29T09:00:03.000Z",
    });
    expect(repeated.pageWorkOrders.map(({ id }) => id)).toEqual(
      accepted.pageWorkOrders.map(({ id }) => id),
    );
    expect(repository.events.list(prepared.run.taskId)).toHaveLength(3);
  });

  it("fan-out 中途数据库失败时不留下半批页单或半个验收状态", async () => {
    const repository = createCourseRunRepository({
      rootDir: await temporaryRoot(),
    });
    const prepared = prepareSubmittedArchitecture(repository);
    repository.runs.database.exec(`
      CREATE TRIGGER reject_page_02
      BEFORE INSERT ON course_work_orders
      WHEN NEW.scope_key = 'page:page-02'
      BEGIN
        SELECT RAISE(ABORT, '模拟第二页写入失败');
      END;
    `);

    expect(() =>
      repository.acceptArchitectureAndDispatchPages({
        fence: {
          runId: prepared.run.id,
          expectedLockVersion: prepared.run.lockVersion,
          traceId: prepared.run.traceId,
          leaseOwner: "engine-01",
        },
        architectWorkOrderId: prepared.architect.id,
        now: "2026-07-29T09:00:02.000Z",
      }),
    ).toThrow("模拟第二页写入失败");

    expect(
      repository.workOrders
        .listByTask(prepared.run.taskId)
        .filter(({ kind }) => kind === "build_page"),
    ).toEqual([]);
    expect(repository.workOrders.load(prepared.architect.id)?.status).toBe(
      "submitted",
    );
    const storedRun = repository.runs.load(prepared.run.id);
    expect(storedRun?.phase).toBe("planning");
    expect(storedRun?.activeArchitecture).toBeUndefined();
    expect(repository.events.list(prepared.run.taskId)).toHaveLength(2);
  });

  it("逐页接受 current pointer，并只在全部真实依赖满足后封口解锁后继页", async () => {
    const repository = createCourseRunRepository({
      rootDir: await temporaryRoot(),
    });
    const prepared = prepareSubmittedArchitecture(repository);
    const accepted = repository.acceptArchitectureAndDispatchPages({
      fence: {
        runId: prepared.run.id,
        expectedLockVersion: prepared.run.lockVersion,
        traceId: prepared.run.traceId,
        leaseOwner: "engine-01",
      },
      architectWorkOrderId: prepared.architect.id,
      now: "2026-07-29T09:00:02.000Z",
    });
    const page01 = pageOrder(accepted.pageWorkOrders, "page-01");
    const page02 = pageOrder(accepted.pageWorkOrders, "page-02");
    const page03 = pageOrder(accepted.pageWorkOrders, "page-03");

    const claimed01 = repository.workOrders.claim(page01.id, {
      owner: "page-worker-01",
      now: "2026-07-29T09:00:03.000Z",
      durationMs: 30_000,
    })!;
    const committed01 = repository.commitPageSubmission({
      workOrderId: claimed01.id,
      expectedWorkOrderLockVersion: claimed01.lockVersion,
      workOrderLeaseOwner: "page-worker-01",
      runLeaseOwner: "engine-01",
      traceId: accepted.run.traceId,
      pageGatePassed: true,
      payloads: pagePayloads("page-01"),
      now: "2026-07-29T09:00:04.000Z",
    });
    expect(committed01.run.currentPages["page-01"]).toBeDefined();
    expect(committed01.unlockedWorkOrders).toEqual([]);
    expect(repository.workOrders.load(page03.id)?.status).toBe(
      "waiting_dependencies",
    );

    const claimed02 = repository.workOrders.claim(page02.id, {
      owner: "page-worker-02",
      now: "2026-07-29T09:00:05.000Z",
      durationMs: 30_000,
    })!;
    const committed02 = repository.commitPageSubmission({
      workOrderId: claimed02.id,
      expectedWorkOrderLockVersion: claimed02.lockVersion,
      workOrderLeaseOwner: "page-worker-02",
      runLeaseOwner: "engine-01",
      traceId: accepted.run.traceId,
      pageGatePassed: true,
      payloads: pagePayloads("page-02"),
      now: "2026-07-29T09:00:06.000Z",
    });

    expect(committed02.unlockedWorkOrders).toHaveLength(1);
    const unlocked = committed02.unlockedWorkOrders[0];
    expect(unlocked).toMatchObject({
      id: page03.id,
      status: "queued",
      buildDependencyPageIds: ["page-01", "page-02"],
    });
    expect(unlocked.inputSealedAt).toBe("2026-07-29T09:00:06.000Z");
    expect(
      unlocked.inputArtifactRefs.filter(
        ({ kind }) => kind === "page_summary",
      ),
    ).toHaveLength(2);
    expect(Object.keys(committed02.run.currentPages).sort()).toEqual([
      "page-01",
      "page-02",
    ]);
    expect(
      repository.events
        .list(prepared.run.taskId)
        .map(({ sequence }) => sequence),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("取消课程时在同一事务中撤销全部未完成 WorkOrder 和执行租约", async () => {
    const repository = createCourseRunRepository({
      rootDir: await temporaryRoot(),
    });
    const prepared = prepareSubmittedArchitecture(repository);
    const accepted = repository.acceptArchitectureAndDispatchPages({
      fence: {
        runId: prepared.run.id,
        expectedLockVersion: prepared.run.lockVersion,
        traceId: prepared.run.traceId,
        leaseOwner: "engine-01",
      },
      architectWorkOrderId: prepared.architect.id,
      now: "2026-07-29T09:00:02.000Z",
    });
    const runningPage = repository.workOrders.claim(
      pageOrder(accepted.pageWorkOrders, "page-01").id,
      {
        owner: "page-worker-01",
        now: "2026-07-29T09:00:03.000Z",
        durationMs: 30_000,
      },
    )!;

    const cancelled = repository.cancelCourseRun({
      taskId: accepted.run.taskId,
      traceId: accepted.run.traceId,
      now: "2026-07-29T09:00:04.000Z",
    });

    expect(cancelled?.run).toMatchObject({
      phase: "cancelled",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    expect(
      cancelled?.cancelledWorkOrders.map(({ status }) => status),
    ).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(
      repository.workOrders
        .listByTask(accepted.run.taskId)
        .filter(({ kind }) => kind === "build_page")
        .map(({ status }) => status),
    ).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(
      repository.workOrders.load(prepared.architect.id)?.status,
    ).toBe("accepted");
    expect(
      repository.workOrders.release({
        workOrderId: runningPage.id,
        owner: "page-worker-01",
        expectedLockVersion: runningPage.lockVersion,
        now: "2026-07-29T09:00:05.000Z",
      }),
    ).toBeUndefined();
    expect(
      repository.events.list(accepted.run.taskId).at(-1)?.type,
    ).toBe("course_cancelled");
  });

  it("resume 已换新 trace 后，持久化 cancel intent 可授权取消尚未 adopt 的旧 CourseRun", async () => {
    const rootDir = await temporaryRoot();
    const repository = createCourseRunRepository({ rootDir });
    const taskStore = createCourseTaskStore({ rootDir });
    const task: CourseTaskRecord = {
      taskId: "task-control-trace-race",
      courseId: "course-control-trace-race",
      traceId: "trace-before-resume",
      userPrompt: "生成太阳系课程",
      creationBrief: {
        originalRequest: "生成太阳系课程",
        topic: "太阳系",
        audience: "初学者",
        learningMode: "mixed",
        language: "zh-CN",
      },
      status: "paused",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const runningTask: CourseTaskRecord = {
      ...task,
      status: "running",
    };
    await taskStore.save(runningTask, { expected: undefined });
    repository.bootstrapCourseRun({
      taskId: task.taskId,
      courseId: task.courseId,
      traceId: task.traceId,
      now: NOW,
    });
    await taskStore.save(task, { expected: runningTask });
    const resumed: CourseTaskRecord = {
      ...task,
      traceId: "trace-after-resume",
      status: "queued",
      updatedAt: "2026-07-29T09:00:01.000Z",
    };
    await expect(
      taskStore.save(resumed, { expected: task }),
    ).resolves.toBe(true);
    await expect(
      taskStore.requestCancel(
        task.taskId,
        "2026-07-29T09:00:02.000Z",
      ),
    ).resolves.toMatchObject({
      traceId: resumed.traceId,
      status: "queued",
    });

    const cancelled = repository.cancelCourseRun({
      taskId: task.taskId,
      traceId: resumed.traceId,
      now: "2026-07-29T09:00:03.000Z",
    });

    expect(cancelled?.run).toMatchObject({
      phase: "cancelled",
      traceId: resumed.traceId,
    });
    expect(repository.events.list(task.taskId).at(-1)).toMatchObject({
      type: "course_cancelled",
      traceId: resumed.traceId,
    });
  });

  it("同 trace cancel intent 先提交后，旧终态命令原子拒绝且取消最终胜出", async () => {
    const rootDir = await temporaryRoot();
    const repository = createCourseRunRepository({ rootDir });
    const taskStore = createCourseTaskStore({ rootDir });
    const task = seedRunningCourseTask(repository.runs.database, {
      taskId: "task-control-same-trace",
      courseId: "course-control-same-trace",
      traceId: "trace-control-same",
      now: NOW,
    });
    const bootstrapped = repository.bootstrapCourseRun({
      taskId: task.taskId,
      courseId: task.courseId,
      traceId: task.traceId,
      now: NOW,
    });
    const claimed = repository.runs.claimLease({
      runId: bootstrapped.run.id,
      owner: "old-runner-same-trace",
      now: "2026-07-29T09:00:01.000Z",
      durationMs: 60_000,
    })!;
    await taskStore.requestCancel(
      task.taskId,
      "2026-07-29T09:00:02.000Z",
    );
    const beforeEvents = repository.events.list(task.taskId);

    expect(() =>
      createCourseRevisionCommands(repository).failCourse({
        fence: {
          runId: claimed.id,
          expectedLockVersion: claimed.lockVersion,
          traceId: claimed.traceId,
          leaseOwner: "old-runner-same-trace",
        },
        code: "LATE_OLD_RUNNER_FAILURE",
        message: "取消意图之后到达的旧失败",
        now: "2026-07-29T09:00:03.000Z",
      }),
    ).toThrow(/取消意图已提交/);
    expect(repository.runs.load(claimed.id)).toEqual(claimed);
    expect(repository.events.list(task.taskId)).toEqual(beforeEvents);
    expect(
      repository.workOrders.load(bootstrapped.architectWorkOrder.id),
    ).toEqual(bootstrapped.architectWorkOrder);

    const cancelled = repository.cancelCourseRun({
      taskId: task.taskId,
      traceId: task.traceId,
      now: "2026-07-29T09:00:04.000Z",
    });
    expect(cancelled?.run).toMatchObject({
      phase: "cancelled",
      traceId: task.traceId,
    });
    expect(
      repository.events
        .list(task.taskId)
        .some(({ type }) => type === "course_failed"),
    ).toBe(false);
  });

  it("新 Task trace 的 cancel intent 先提交后，旧 trace 命令不能越权终态化", async () => {
    const rootDir = await temporaryRoot();
    const repository = createCourseRunRepository({ rootDir });
    const taskStore = createCourseTaskStore({ rootDir });
    const taskA = seedRunningCourseTask(repository.runs.database, {
      taskId: "task-control-next-trace",
      courseId: "course-control-next-trace",
      traceId: "trace-control-a",
      now: NOW,
    });
    const bootstrapped = repository.bootstrapCourseRun({
      taskId: taskA.taskId,
      courseId: taskA.courseId,
      traceId: taskA.traceId,
      now: NOW,
    });
    const claimed = repository.runs.claimLease({
      runId: bootstrapped.run.id,
      owner: "old-runner-next-trace",
      now: "2026-07-29T09:00:01.000Z",
      durationMs: 60_000,
    })!;
    const persistedA = await taskStore.load(taskA.taskId);
    if (!persistedA) throw new Error("测试 TaskRecord 不存在");
    const paused = {
      ...persistedA,
      status: "paused" as const,
      updatedAt: "2026-07-29T09:00:02.000Z",
    };
    await expect(
      taskStore.save(paused, { expected: persistedA }),
    ).resolves.toBe(true);
    const taskB = {
      ...paused,
      traceId: "trace-control-b",
      status: "queued" as const,
      updatedAt: "2026-07-29T09:00:03.000Z",
    };
    await expect(
      taskStore.save(taskB, { expected: paused }),
    ).resolves.toBe(true);
    await taskStore.requestCancel(
      taskB.taskId,
      "2026-07-29T09:00:04.000Z",
    );
    const beforeEvents = repository.events.list(taskB.taskId);

    expect(() =>
      createCourseRevisionCommands(repository).failCourse({
        fence: {
          runId: claimed.id,
          expectedLockVersion: claimed.lockVersion,
          traceId: claimed.traceId,
          leaseOwner: "old-runner-next-trace",
        },
        code: "LATE_OLD_TRACE_FAILURE",
        message: "新 trace 取消后到达的旧 trace 失败",
        now: "2026-07-29T09:00:05.000Z",
      }),
    ).toThrow(/执行权不一致/);
    expect(repository.runs.load(claimed.id)).toEqual(claimed);
    expect(repository.events.list(taskB.taskId)).toEqual(beforeEvents);

    const cancelled = repository.cancelCourseRun({
      taskId: taskB.taskId,
      traceId: taskB.traceId,
      now: "2026-07-29T09:00:06.000Z",
    });
    expect(cancelled?.run).toMatchObject({
      phase: "cancelled",
      traceId: taskB.traceId,
    });
    expect(
      repository.events
        .list(taskB.taskId)
        .some(({ type }) => type === "course_failed"),
    ).toBe(false);
  });
});

function prepareSubmittedArchitecture(repository: CourseRunRepository) {
  seedRunningCourseTask(repository.runs.database, {
    taskId: "task-repository-01",
    courseId: "course-repository-01",
    traceId: "trace-repository-01",
    now: NOW,
  });
  const bootstrapped = repository.bootstrapCourseRun({
    taskId: "task-repository-01",
    courseId: "course-repository-01",
    traceId: "trace-repository-01",
    now: NOW,
    runId: "course-run-repository-01",
    architectWorkOrderId: "work-order-architect-01",
  });
  const run = repository.runs.claimLease({
    runId: bootstrapped.run.id,
    owner: "engine-01",
    now: "2026-07-29T09:00:00.100Z",
    durationMs: 60_000,
  })!;
  const architect = repository.workOrders.claim(
    bootstrapped.architectWorkOrder.id,
    {
      owner: "architect-worker-01",
      now: "2026-07-29T09:00:00.200Z",
      durationMs: 30_000,
    },
  )!;
  const submitted = repository.submitArchitecture({
    workOrderId: architect.id,
    expectedWorkOrderLockVersion: architect.lockVersion,
    workOrderLeaseOwner: "architect-worker-01",
    runLeaseOwner: "engine-01",
    traceId: run.traceId,
    architecture: architecture(),
    now: "2026-07-29T09:00:01.000Z",
  });
  return { run, architect: submitted.workOrder };
}

function pageOrder(workOrders: WorkOrder[], pageId: string) {
  const workOrder = workOrders.find(
    ({ scope }) => scope.type === "page" && scope.pageId === pageId,
  );
  if (!workOrder) throw new Error(`测试缺少页面 WorkOrder：${pageId}`);
  return workOrder;
}

function pagePayloads(pageId: string) {
  return {
    content: { pageId, blocks: ["教学内容"] },
    html: { html: `<main data-page-id="${pageId}"></main>` },
    quality: { decision: "pass", issues: [] },
    summary: { pageId, taught: ["太阳系组成"] },
  };
}
