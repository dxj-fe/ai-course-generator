import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelTier } from "../../../../src/server/infra/ai/model-router";
import { AgentIds, ToolIds } from "../../../../src/server/agent/ids";
import { AgentTerminalNotCommittedError } from "../../../../src/server/agent/runtime";
import type { RunCourseDirectorAgentInput } from "../../../../src/server/agent/plugins/agents/course/director-handler";
import type { CurriculumArchitectAgentInput } from "../../../../src/server/agent/plugins/agents/course/architect-handler";
import { courseArchitectAgent } from "../../../../src/server/agent/plugins/agents/course/architect";
import type { CourseReviewerExecutionInput } from "../../../../src/server/agent/plugins/contexts/course/reviewer";
import { sanitizePublicCourseState } from "../../../../src/server/course/projection/public-error";
import { createCourseRevisionCommands } from "../../../../src/server/course/run/revision-commands";
import { createCourseRunCommands } from "../../../../src/server/course/run/commands";
import {
  CourseRunLeaseUnavailableError,
  createCourseRunEngine,
  type CourseRunEngineInput,
} from "../../../../src/server/course/run/engine";
import {
  createCourseRunRepository,
  type CourseRunRepository,
} from "../../../../src/server/course/store/repository";
import type { RunPageBuilderAgentInput } from "../../../../src/server/agent/plugins/agents/course/page-builder-handler";
import { encodeCourseTaskSseMessage } from "../../../../src/server/course/task/sse";
import { BrowserHarnessUnavailableError } from "../../../../src/server/infra/browser/error";
import {
  PageContentDSLSchema,
  QualityReportSchema,
  type CourseArchitecture,
  type CourseRun,
  type PageTask,
} from "../../../../src/shared/course-schema";
import {
  COURSE_ID,
  createArchitecture,
  createBrief,
  createReferencePack,
} from "../../../fixtures/course-architecture";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";
import { prepareFixPageSubmission } from "./course-run-engine-test-support";

const directories: string[] = [];
const TRACE_ID = "trace-course-run-engine";
const BASE_TIME = Date.parse("2026-07-29T14:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CourseRunEngine", () => {
  it("Course Lead 提交计划后直接派发页面，并在独立审查后完成发布决定", async () => {
    const prepared = await prepare("happy-path");
    const calls: string[] = [];
    let activePages = 0;
    let maxActivePages = 0;
    let firstWaveArrivals = 0;
    let releaseFirstWave: (() => void) | undefined;
    const firstWaveReady = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });

    const fakes = createSuccessfulFakes(prepared.repository, {
      onArchitect(input) {
        calls.push("architect");
        expect(pageOrders(prepared.repository, input.workOrder.taskId)).toEqual(
          [],
        );
      },
      async beforePageCommit(input, pageTask) {
        calls.push(`page:${pageTask.pageId}:start`);
        activePages += 1;
        maxActivePages = Math.max(maxActivePages, activePages);

        for (const dependencyPageId of pageTask.buildDependsOnPageIds) {
          expect(
            prepared.repository.runs.loadByTaskId(input.workOrder.taskId)
              ?.currentPages[dependencyPageId],
          ).toBeDefined();
          expect(
            input.workOrder.inputArtifactRefs.some(
              (ref) =>
                ref.kind === "page_summary" &&
                ref.pageId === dependencyPageId,
            ),
          ).toBe(true);
        }

        if (pageTask.buildDependsOnPageIds.length === 0) {
          firstWaveArrivals += 1;
          if (firstWaveArrivals === 2) releaseFirstWave?.();
          await firstWaveReady;
        }
      },
      afterPageCommit(_input, pageTask) {
        activePages -= 1;
        calls.push(`page:${pageTask.pageId}:done`);
      },
      onReviewer(input) {
        calls.push("reviewer");
        const run = requiredRun(
          prepared.repository.runs.loadByTaskId(input.workOrder.taskId),
        );
        expect(Object.keys(run.currentPages)).toHaveLength(4);
        expect(
          pageOrders(prepared.repository, input.workOrder.taskId).every(
            ({ status }) => status === "accepted",
          ),
        ).toBe(true);
      },
      onReviewDirector(input) {
        calls.push("lead:review");
        expect(input.workOrder.agentId).toBe(AgentIds.CourseLead);
      },
    });

    const result = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-happy-worker",
      getModel: fakeGetModel,
      ...fakes,
    }).run(prepared.input);

    expect(result.status, JSON.stringify(result.errors)).toBe("completed");
    expect(maxActivePages).toBe(2);
    expect(calls).not.toContain("director:architecture");
    expect(calls.indexOf("architect")).toBeLessThan(
      calls.indexOf("page:page-cover:start"),
    );
    expect(calls.indexOf("page:page-concept:done")).toBeLessThan(
      calls.indexOf("page:page-practice:start"),
    );
    expect(calls.indexOf("page:page-practice:done")).toBeLessThan(
      calls.indexOf("page:page-summary:start"),
    );
    expect(calls.indexOf("page:page-summary:done")).toBeLessThan(
      calls.indexOf("reviewer"),
    );
    expect(calls.indexOf("reviewer")).toBeLessThan(
      calls.indexOf("lead:review"),
    );

    const storedRun = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    expect(storedRun.phase).toBe("completed");
    expect(storedRun.leaseOwner).toBeUndefined();
    expect(
      prepared.repository.workOrders
        .listByTask(prepared.input.taskId)
        .filter(({ kind }) => kind === "review_course"),
    ).toHaveLength(1);
  });

  it("Page Agent 完成后立即补充下一页，不等待同批最慢页面", async () => {
    const prepared = await prepare("parallel-refill");
    const architecture = {
      ...createArchitecture(),
      pageTasks: createArchitecture().pageTasks.map((pageTask) => ({
        ...pageTask,
        buildDependsOnPageIds: [],
      })),
    };
    let releaseSlowPage: (() => void) | undefined;
    const slowPage = new Promise<void>((resolve) => {
      releaseSlowPage = resolve;
    });
    let markNextPageStarted: (() => void) | undefined;
    const nextPageStarted = new Promise<void>((resolve) => {
      markNextPageStarted = resolve;
    });

    const run = createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-refill-worker",
      getModel: fakeGetModel,
      ...createSuccessfulFakes(prepared.repository, {
        architecture,
        async beforePageCommit(_input, pageTask) {
          if (pageTask.pageId === "page-cover") await slowPage;
          if (pageTask.pageId === "page-practice") {
            markNextPageStarted?.();
          }
        },
      }),
    }).run(prepared.input);

    const refilledBeforeSlowPage = await Promise.race([
      nextPageStarted.then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), 200),
      ),
    ]);
    releaseSlowPage?.();
    const result = await run;

    expect(refilledBeforeSlowPage).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("单页质量阻塞交回 Course Lead 重新分配职责，不直接终止整课", async () => {
    const prepared = await prepare("page-block-replan");
    const baseFakes = createSuccessfulFakes(prepared.repository);
    let blockedOnce = false;
    const runPageBuilder = async (input: RunPageBuilderAgentInput) => {
      const pageId =
        input.workOrder.scope.type === "page"
          ? input.workOrder.scope.pageId
          : undefined;
      if (pageId !== "page-concept" || blockedOnce) {
        return baseFakes.runPageBuilder(input);
      }
      blockedOnce = true;
      const architecture = createArchitecture();
      const pageTask = architecture.pageTasks.find(
        ({ pageId: candidate }) => candidate === pageId,
      )!;
      const payloads = pagePayloads(architecture, pageTask);
      const quality = QualityReportSchema.parse({
        ...payloads.quality,
        overallScore: 72,
        dimensions: {
          ...payloads.quality.dimensions,
          layoutQuality: {
            score: 55,
            summary: "单页职责过载，三视口需要继续整体缩小。",
            issueCodes: ["BROWSER_VIEWPORT_SCALE_TOO_SMALL"],
            repairHints: ["重新分配本页次要解释。"],
          },
        },
        issues: [
          {
            code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
            dimension: "layoutQuality",
            severity: "error",
            source: "browser",
            message: "页面在小视口被整体缩小，正文不可可靠阅读。",
            location: {
              pageId,
              viewport: "640x360",
              description: "完整 16:9 舞台",
            },
            repairHint: "由 Course Lead 缩小或重新分配页面职责。",
          },
        ],
        shouldRepair: true,
        decision: "revise",
      });
      let expectedLockVersion = input.workOrder.lockVersion;
      for (const checkpoint of [
        { kind: "page_content" as const, payload: payloads.content },
        { kind: "page_html" as const, payload: payloads.html },
        { kind: "page_quality" as const, payload: quality },
      ]) {
        const saved = prepared.repository.checkpointPageArtifact({
          workOrderId: input.workOrder.id,
          expectedWorkOrderLockVersion: expectedLockVersion,
          workOrderLeaseOwner: input.workOrderLeaseOwner,
          runLeaseOwner: input.runLeaseOwner,
          traceId: input.traceId,
          toolName: "test_page_checkpoint",
          kind: checkpoint.kind,
          payload: checkpoint.payload,
          now: nextTimestamp(),
        });
        expectedLockVersion = saved.workOrder.lockVersion;
      }
      prepared.repository.blockPageWorkOrder({
        workOrderId: input.workOrder.id,
        expectedWorkOrderLockVersion: expectedLockVersion,
        workOrderLeaseOwner: input.workOrderLeaseOwner,
        runLeaseOwner: input.runLeaseOwner,
        traceId: input.traceId,
        code: "PAGE_WORK_ORDER_BLOCKED",
        message: "本页职责超过单个无滚动舞台的可靠承载范围。",
        evidence: ["三视口质量报告连续失败"],
        now: nextTimestamp(),
      });
      return undefined as never;
    };
    const runDirector = async (input: RunCourseDirectorAgentInput) => {
      const qualityRef = input.workOrder.inputArtifactRefs.find(
        ({ kind }) => kind === "page_quality",
      );
      if (!qualityRef) return baseFakes.runDirector(input);
      const blockedWorkOrder = prepared.repository.workOrders
        .listByTask(input.workOrder.taskId)
        .find(
          ({ status, submission }) =>
            status === "blocked" &&
            submission?.artifactRefs.some(({ id }) => id === qualityRef.id),
        );
      if (!blockedWorkOrder) throw new Error("测试缺少阻塞页面");
      const run = requiredRun(
        prepared.repository.runs.loadByTaskId(input.workOrder.taskId),
      );
      createCourseRevisionCommands(
        prepared.repository,
      ).requestBlockedPageReplan({
        fence: fence(run, input.runLeaseOwner),
        blockedWorkOrderId: blockedWorkOrder.id,
        directorWorkOrderId: input.workOrder.id,
        directorRound: {
          workOrderId: input.workOrder.id,
          expectedLockVersion: input.workOrder.lockVersion,
          leaseOwner: input.workOrderLeaseOwner,
          action: ToolIds.RequestReplan,
          summary: "测试主 Agent 重新分配页面职责。",
          artifactRefs: [qualityRef],
        },
        now: nextTimestamp(),
      });
      return undefined as never;
    };

    const result = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-page-block-replan-worker",
      getModel: fakeGetModel,
      ...baseFakes,
      runDirector,
      runPageBuilder,
    }).run(prepared.input);

    expect(result.status, JSON.stringify(result.errors)).toBe("completed");
    const storedRun = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    expect(storedRun.replanRound).toBe(1);
    expect(storedRun.phase).toBe("completed");
    expect(
      prepared.repository.workOrders
        .listByTask(prepared.input.taskId)
        .filter(({ kind }) => kind === "architect_course"),
    ).toHaveLength(2);
    expect(
      prepared.repository.events
        .list(prepared.input.taskId)
        .some(({ type }) => type === "course_failed"),
    ).toBe(false);
  });

  it("CourseRun 已终态时只投影结果，不重新领取 lease 或重复调用 Agent", async () => {
    const prepared = await prepare("terminal-reconcile");
    await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-terminal-first",
      getModel: fakeGetModel,
      ...createSuccessfulFakes(prepared.repository),
    }).run(prepared.input);
    const forbiddenAgent = vi.fn(async () => {
      throw new Error("终态恢复不应再次调用 Agent");
    });

    const recovered = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-terminal-recovery",
      getModel: fakeGetModel,
      runArchitect: forbiddenAgent,
      runDirector: forbiddenAgent,
      runPageBuilder: forbiddenAgent,
      runReviewer: forbiddenAgent,
    }).run(prepared.input);

    expect(recovered.status).toBe("completed");
    expect(forbiddenAgent).not.toHaveBeenCalled();
    const stored = prepared.repository.runs.loadByTaskId(
      prepared.input.taskId,
    );
    expect(stored?.phase).toBe("completed");
    expect(stored?.leaseOwner).toBeUndefined();
  });

  it("两个 Engine 同时运行同一 task 时只有 CourseRun lease 的赢家执行", async () => {
    const prepared = await prepare("lease-race");
    const fakes = createSuccessfulFakes(prepared.repository);
    let markArchitectStarted: () => void = () => undefined;
    let releaseArchitect: () => void = () => undefined;
    const architectStarted = new Promise<void>((resolve) => {
      markArchitectStarted = resolve;
    });
    const architectGate = new Promise<void>((resolve) => {
      releaseArchitect = resolve;
    });
    const firstRun = createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-lease-winner",
      getModel: fakeGetModel,
      ...fakes,
      runArchitect: async (input) => {
        markArchitectStarted();
        await architectGate;
        return fakes.runArchitect(input);
      },
    }).run(prepared.input);
    await architectStarted;

    try {
      await expect(
        createCourseRunEngine({
          repository: prepared.repository,
          now: prepared.now,
          createWorkerId: () => "engine-lease-loser",
          getModel: fakeGetModel,
          ...fakes,
        }).run(prepared.input),
      ).rejects.toBeInstanceOf(CourseRunLeaseUnavailableError);
    } finally {
      releaseArchitect();
    }

    await expect(firstRun).resolves.toMatchObject({ status: "completed" });
  });

  it("领取子 WorkOrder 前先让父 CourseRun lease 覆盖完整阶段预算", async () => {
    const prepared = await prepare("parent-lease-covers-child");
    const controller = new AbortController();
    let releaseDefinition: () => void = () => undefined;
    let markDefinitionLoading: () => void = () => undefined;
    const definitionGate = new Promise<void>((resolve) => {
      releaseDefinition = resolve;
    });
    const definitionLoading = new Promise<void>((resolve) => {
      markDefinitionLoading = resolve;
    });

    const execution = createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-parent-lease-worker",
      getModel: fakeGetModel,
      getAgentDefinition: async () => {
        markDefinitionLoading();
        await definitionGate;
        return courseArchitectAgent;
      },
    }).run(prepared.input, { abortSignal: controller.signal });
    await definitionLoading;

    const run = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    const architect = submittedArchitect(
      prepared.repository,
      prepared.input.taskId,
    );
    expect(run.leaseExpiresAt).toBeDefined();
    expect(architect.leaseExpiresAt).toBeDefined();
    expect(Date.parse(run.leaseExpiresAt!)).toBeGreaterThanOrEqual(
      Date.parse(architect.leaseExpiresAt!),
    );

    controller.abort(new DOMException("测试结束", "AbortError"));
    releaseDefinition();
    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
  });

  it("父 lease 过期但子 WorkOrder 仍活跃时只退出等待，不终态化课程", async () => {
    const prepared = await prepare("active-child-lease");
    const initialNow = "2026-07-29T14:00:10.000Z";
    const recoveredNow = "2026-07-29T14:02:15.000Z";
    const bootstrapped = prepared.repository.bootstrapCourseRun({
      taskId: prepared.input.taskId,
      courseId: prepared.input.courseId,
      traceId: prepared.input.traceId,
      now: initialNow,
    });
    const oldRun = prepared.repository.runs.claimLease({
      runId: bootstrapped.run.id,
      owner: "old-engine",
      now: initialNow,
      durationMs: 120_000,
      expectedTraceId: prepared.input.traceId,
    });
    expect(oldRun).toBeDefined();
    const oldWorkOrder = prepared.repository.workOrders.claim(
      bootstrapped.architectWorkOrder.id,
      {
        owner: "old-engine:architect",
        now: initialNow,
        durationMs: 180_000,
      },
    );
    expect(oldWorkOrder).toBeDefined();

    const execution = createCourseRunEngine({
      repository: prepared.repository,
      now: () => recoveredNow,
      createWorkerId: () => "recovery-engine",
      getModel: fakeGetModel,
      ...createSuccessfulFakes(prepared.repository),
    }).run(prepared.input);

    await expect(execution).rejects.toMatchObject({
      name: "CourseRunLeaseUnavailableError",
      reason: "work_order_held",
    });
    const run = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    expect(run.phase).toBe("planning");
    expect(run.leaseOwner).toBeUndefined();
    expect(
      prepared.repository.events
        .list(prepared.input.taskId)
        .some(({ type }) => type === "course_failed"),
    ).toBe(false);
    expect(
      submittedArchitect(prepared.repository, prepared.input.taskId),
    ).toMatchObject({
      status: "running",
      leaseOwner: "old-engine:architect",
    });
  });

  it("中途取消会释放 Run 和 WorkOrder lease，下一次执行可从原状态恢复", async () => {
    const prepared = await prepare("abort-resume");
    const controller = new AbortController();
    const abortingArchitect = vi.fn(
      async () => {
        controller.abort(new DOMException("测试主动取消", "AbortError"));
        throw controller.signal.reason;
      },
    );

    await expect(
      createCourseRunEngine({
        repository: prepared.repository,
        now: prepared.now,
        createWorkerId: () => "engine-aborted-worker",
        getModel: fakeGetModel,
        runArchitect: abortingArchitect,
      }).run(prepared.input, { abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const interruptedRun = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    expect(interruptedRun.phase).toBe("planning");
    expect(interruptedRun.leaseOwner).toBeUndefined();
    expect(
      prepared.repository.workOrders.listByTask(prepared.input.taskId, [
        "running",
      ]),
    ).toEqual([]);
    expect(
      submittedArchitect(prepared.repository, prepared.input.taskId).status,
    ).toBe("queued");

    const result = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-resumed-worker",
      getModel: fakeGetModel,
      ...createSuccessfulFakes(prepared.repository),
    }).run(prepared.input);

    expect(result.status, JSON.stringify(result.errors)).toBe("completed");
    expect(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId)?.phase,
    ).toBe("completed");
  });

  it("持久化 pause 在 Agent 工具边界被观察后会释放 Run 和 WorkOrder lease", async () => {
    const prepared = await prepare("durable-pause-boundary");
    let paused = false;
    let markArchitectStarted: () => void = () => undefined;
    let releaseToolBoundary: () => void = () => undefined;
    const architectStarted = new Promise<void>((resolve) => {
      markArchitectStarted = resolve;
    });
    const toolBoundary = new Promise<void>((resolve) => {
      releaseToolBoundary = resolve;
    });
    const run = createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-durable-pause-worker",
      getModel: fakeGetModel,
      runArchitect: async (input) => {
        markArchitectStarted();
        await toolBoundary;
        await input.beforeToolCall?.();
        throw new Error("暂停后不应继续提交架构");
      },
    }).run(prepared.input, {
      assertExecutionActive: () => {
        if (paused) {
          throw new DOMException("课程生成已暂停。", "AbortError");
        }
      },
    });
    await architectStarted;

    paused = true;
    releaseToolBoundary();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId)?.leaseOwner,
    ).toBeUndefined();
    expect(
      prepared.repository.workOrders.listByTask(prepared.input.taskId, [
        "running",
      ]),
    ).toEqual([]);
    expect(
      submittedArchitect(prepared.repository, prepared.input.taskId).status,
    ).toBe("queued");
  });

  it("Browser Harness 故障释放 lease 并保留可恢复 WorkOrder", async () => {
    const prepared = await prepare("browser-runtime-unavailable");
    const baseFakes = createSuccessfulFakes(prepared.repository);
    const runPageBuilder = vi.fn(async () => {
      throw new BrowserHarnessUnavailableError(new Error("browser closed"));
    });

    await expect(
      createCourseRunEngine({
        repository: prepared.repository,
        now: prepared.now,
        createWorkerId: () => "engine-browser-runtime-worker",
        getModel: fakeGetModel,
        ...baseFakes,
        runPageBuilder,
      }).run(prepared.input),
    ).rejects.toMatchObject({ code: "BROWSER_HARNESS_UNAVAILABLE" });

    const run = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    expect(run.leaseOwner).toBeUndefined();
    expect(run.phase).not.toBe("failed");
    const pages = pageOrders(prepared.repository, prepared.input.taskId);
    expect(pages.some(({ status }) => status === "failed")).toBe(false);
    expect(pages.some(({ status }) => status === "queued")).toBe(true);
  });

  it("供应商瞬时错误保留 WorkOrder，并用同一个 strong 模型恢复", async () => {
    const prepared = await prepare("model-fallback");
    const baseFakes = createSuccessfulFakes(prepared.repository);
    const architectModels: ModelTier[] = [];
    let architectAttempts = 0;

    const runArchitect = vi.fn(
      async (
        input: CurriculumArchitectAgentInput,
        dependencies?: { model?: unknown },
      ) => {
        architectAttempts += 1;
        const tier = (dependencies?.model as { tier: ModelTier }).tier;
        architectModels.push(tier);
        if (architectAttempts === 1) {
          throw Object.assign(new Error("provider 暂时不可用"), {
            status: 503,
          });
        }
        return baseFakes.runArchitect(input);
      },
    );

    const engine = createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-fallback-worker",
      getModel: fakeGetModel,
      ...baseFakes,
      runArchitect,
    });

    await expect(engine.run(prepared.input)).rejects.toMatchObject({
      code: "COURSE_RUN_TRANSIENT_EXECUTION_ERROR",
    });
    expect(submittedArchitect(prepared.repository, prepared.input.taskId).status)
      .toBe("queued");

    const result = await engine.run(prepared.input);

    expect(result.status).toBe("completed");
    expect(architectModels).toEqual(["strong", "strong"]);
    expect(architectAttempts).toBe(2);
    expect(
      prepared.repository.artifacts.listByTask(
        prepared.input.taskId,
        "course_architecture",
      ),
    ).toHaveLength(1);
    expect(
      prepared.repository.workOrders
        .listByTask(prepared.input.taskId)
        .filter(({ kind }) => kind === "architect_course"),
    ).toHaveLength(1);
  });

  it("Agent 连续未提交终态时最多重试两次，不无限循环", async () => {
    const prepared = await prepare("terminal-not-committed-fallback");
    const baseFakes = createSuccessfulFakes(prepared.repository);
    const architectModels: ModelTier[] = [];
    let architectAttempts = 0;

    const runArchitect = vi.fn(
      async (
        input: CurriculumArchitectAgentInput,
        dependencies?: { model?: unknown },
      ) => {
        architectAttempts += 1;
        const tier = (dependencies?.model as { tier: ModelTier }).tier;
        architectModels.push(tier);
        throw new AgentTerminalNotCommittedError(input.workOrder.id);
      },
    );

    const engine = createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-terminal-fallback-worker",
      getModel: fakeGetModel,
      ...baseFakes,
      runArchitect,
    });

    await expect(engine.run(prepared.input)).rejects.toMatchObject({
      code: "COURSE_RUN_TRANSIENT_EXECUTION_ERROR",
    });
    await expect(engine.run(prepared.input)).rejects.toMatchObject({
      code: "COURSE_RUN_TRANSIENT_EXECUTION_ERROR",
    });
    const result = await engine.run(prepared.input);

    expect(result.status).toBe("failed");
    expect(architectModels).toEqual(["strong", "strong", "strong"]);
    expect(architectAttempts).toBe(3);
    expect(
      prepared.repository.artifacts.listByTask(
        prepared.input.taskId,
        "course_architecture",
      ),
    ).toHaveLength(0);
  });

  it.each([
    ["sk-live-SECRET", "compact-key"],
    ["Authorization:Bearer-sk-live-SECRET", "authorization"],
    ["API_KEY:top-secret", "api-key-field"],
  ])(
    "供应商失败从 Agent 到 SSE 都只保留安全诊断码：%s",
    async (providerCode, suffix) => {
      const prepared = await prepare(`safe-provider-error-${suffix}`);
      const privateMessage =
        "Authorization: Bearer sk-live-SECRET MODEL_API_KEY=top-secret privatePrompt=system requestBody={raw}";
      const providerError = Object.assign(new Error(privateMessage), {
        code: providerCode,
        status: 401,
        requestBodyValues: { prompt: "system" },
      });

      const result = await createCourseRunEngine({
        repository: prepared.repository,
        now: prepared.now,
        createWorkerId: () => "engine-safe-provider-error-worker",
        getModel: fakeGetModel,
        runArchitect: async () => {
          throw providerError;
        },
      }).run(prepared.input);

      const architect = submittedArchitect(
        prepared.repository,
        prepared.input.taskId,
      );
      const run = requiredRun(
        prepared.repository.runs.loadByTaskId(prepared.input.taskId),
      );
      const events = prepared.repository.events.list(prepared.input.taskId);
      const publicState = sanitizePublicCourseState(result);
      const sse = encodeCourseTaskSseMessage({
        type: "terminal",
        taskId: prepared.input.taskId,
        courseId: prepared.input.courseId,
        status: "failed",
        state: publicState,
      });
      const persisted = JSON.stringify({
        architect,
        run,
        events,
        result,
        sse,
      });

      expect(result.status).toBe("failed");
      expect(architect.error).toMatchObject({
        code: "AUTH_ERROR",
        causeCode: "AUTH_ERROR",
        message: "模型服务认证失败，请检查访问权限后重试。",
      });
      expect(run.error).toMatchObject({
        code: "AUTH_ERROR",
        causeCode: "AUTH_ERROR",
        message: "模型服务认证失败，请检查访问权限后重试。",
      });
      expect(
        events
          .map(({ payload }) =>
            payload && typeof payload === "object" && "code" in payload
              ? payload.code
              : undefined,
          )
          .filter(Boolean),
      ).toContain("AUTH_ERROR");
      expect(
        publicState.errors.every(({ code }) => code === "AUTH_ERROR"),
      ).toBe(true);
      expect(sse).toContain('"causeCode":"AUTH_ERROR"');
      expect(persisted).not.toContain(providerCode);
      expect(persisted).not.toMatch(
        /sk-live|top-secret|privatePrompt|requestBody/i,
      );
    },
  );

  it("HTML 定向返工保留相同内容，但必须真正修改 HTML 并生成当前 Artifact", async () => {
    const prepared = await prepare("same-content-fix");
    const baseFakes = createSuccessfulFakes(prepared.repository);
    const architecture = createArchitecture();
    let reviewRound = 0;

    const runReviewer = async (input: CourseReviewerExecutionInput) => {
      reviewRound += 1;
      const run = requiredRun(
        prepared.repository.runs.loadByTaskId(input.workOrder.taskId),
      );
      const issueEvidence =
        run.currentPages["page-concept"]!.qualityRef;
      createCourseRunCommands(prepared.repository).submitCourseReview({
        workOrderId: input.workOrder.id,
        expectedWorkOrderLockVersion: input.workOrder.lockVersion,
        workOrderLeaseOwner: input.workOrderLeaseOwner,
        runLeaseOwner: input.runLeaseOwner,
          traceId: input.traceId,
          candidate:
            reviewRound === 1
              ? {
                courseId: run.courseId,
                inputManifestHash: run.currentManifestHash,
                decision: "revise_pages",
                coverage: architecture.blueprint.objectives.map(({ id }) => ({
                  objectiveId: id,
                  teachingPageIds: ["page-concept"],
                  assessmentPageIds: ["page-practice"],
                  status: "covered" as const,
                })),
                issues: [
                  {
                    id: "issue-fix-html-only",
                    scope: "page" as const,
                    pageId: "page-concept",
                    code: "HTML_LAYOUT_NEEDS_FIX",
                    severity: "error" as const,
                    message: "概念页布局需要返工，内容保持不变。",
                    targetArtifact: "page_html" as const,
                    evidenceArtifactRefs: [issueEvidence],
                    suggestedAction: "只调整页面实现，不改教学内容。",
                  },
                ],
                summary: "概念页布局需要局部返工。",
              }
            : {
                courseId: run.courseId,
                inputManifestHash: run.currentManifestHash,
                decision: "pass",
                coverage: architecture.blueprint.objectives.map(({ id }) => ({
                  objectiveId: id,
                  teachingPageIds: ["page-concept"],
                  assessmentPageIds: ["page-practice"],
                  status: "covered" as const,
                })),
                issues: [],
                summary: "返工后课程可以发布。",
              },
        now: nextTimestamp(),
      });
      return undefined as never;
    };

    const runDirector = async (input: RunCourseDirectorAgentInput) => {
      const reviewRef = input.workOrder.inputArtifactRefs.find(
        ({ kind }) => kind === "course_review",
      );
      if (!reviewRef) return baseFakes.runDirector(input);
      const review = prepared.repository.artifacts.load(reviewRef.id)?.payload as
        | { decision?: string }
        | undefined;
      if (review?.decision !== "revise_pages") {
        return baseFakes.runDirector(input);
      }
      const run = requiredRun(
        prepared.repository.runs.loadByTaskId(input.workOrder.taskId),
      );
      const reviewWorkOrderId = run.currentReview?.workOrderId;
      if (!reviewWorkOrderId) throw new Error("测试缺少当前 Review");
      createCourseRevisionCommands(prepared.repository).assignPageFixes({
        fence: fence(run, input.runLeaseOwner),
        reviewWorkOrderId,
        directorWorkOrderId: input.workOrder.id,
        directorRound: {
          workOrderId: input.workOrder.id,
          expectedLockVersion: input.workOrder.lockVersion,
          leaseOwner: input.workOrderLeaseOwner,
          action: "assign_page_fixes",
          summary: "测试只返工 Review 指定页面及依赖闭包。",
        },
        now: nextTimestamp(),
      });
      return undefined as never;
    };

    const result = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-same-content-fix",
      getModel: fakeGetModel,
      ...baseFakes,
      runReviewer,
      runDirector,
    }).run(prepared.input);

    expect(result.status, JSON.stringify(result.errors)).toBe("completed");
    expect(reviewRound).toBe(2);
    const run = requiredRun(
      prepared.repository.runs.loadByTaskId(prepared.input.taskId),
    );
    const fixOrders = prepared.repository.workOrders
      .listByTask(prepared.input.taskId)
      .filter(({ kind }) => kind === "fix_page");
    expect(fixOrders).toHaveLength(3);
    for (const fix of fixOrders) {
      if (fix.scope.type !== "page") continue;
      const pointer = run.currentPages[fix.scope.pageId]!;
      expect(pointer.sourceWorkOrderId).toBe(fix.id);
      for (const ref of [
        pointer.contentRef,
        pointer.htmlRef,
        pointer.qualityRef,
        pointer.summaryRef,
      ]) {
        expect(
          prepared.repository.artifacts.load(ref.id)?.createdByWorkOrderId,
        ).toBe(fix.id);
      }
    }
  });
});

type SuccessfulFakeHooks = {
  architecture?: CourseArchitecture;
  onArchitect?(input: CurriculumArchitectAgentInput): void;
  onArchitectureDirector?(input: RunCourseDirectorAgentInput): void;
  beforePageCommit?(
    input: RunPageBuilderAgentInput,
    pageTask: PageTask,
  ): void | PromiseLike<void>;
  afterPageCommit?(
    input: RunPageBuilderAgentInput,
    pageTask: PageTask,
  ): void;
  onReviewer?(input: CourseReviewerExecutionInput): void;
  onReviewDirector?(input: RunCourseDirectorAgentInput): void;
};

function createSuccessfulFakes(
  repository: CourseRunRepository,
  hooks: SuccessfulFakeHooks = {},
) {
  const architecture = hooks.architecture ?? createArchitecture();

  return {
    async runArchitect(input: CurriculumArchitectAgentInput) {
      hooks.onArchitect?.(input);
      repository.submitArchitecture({
        workOrderId: input.workOrder.id,
        expectedWorkOrderLockVersion: input.workOrder.lockVersion,
        workOrderLeaseOwner: input.workOrderLeaseOwner,
        runLeaseOwner: input.runLeaseOwner,
        traceId: input.traceId,
        architecture,
        now: nextTimestamp(),
      });
      return undefined as never;
    },

    async runDirector(input: RunCourseDirectorAgentInput) {
      const run = requiredRun(
        repository.runs.loadByTaskId(input.workOrder.taskId),
      );
      const commands = createCourseRunCommands(repository);
      const reviewRef = input.workOrder.inputArtifactRefs.find(
        ({ kind }) => kind === "course_review",
      );

      if (!reviewRef) {
        hooks.onArchitectureDirector?.(input);
        const architect = submittedArchitect(
          repository,
          input.workOrder.taskId,
        );
        repository.acceptArchitectureAndDispatchPages({
          fence: fence(run, input.runLeaseOwner),
          architectWorkOrderId: architect.id,
          directorWorkOrderId: input.workOrder.id,
          directorRound: {
            workOrderId: input.workOrder.id,
            expectedLockVersion: input.workOrder.lockVersion,
            leaseOwner: input.workOrderLeaseOwner,
            action: "accept_architecture_and_dispatch_pages",
            summary: "测试主 Agent 接受课程架构并派发页面。",
          },
          now: nextTimestamp(),
        });
        return undefined as never;
      }

      hooks.onReviewDirector?.(input);
      const reviewWorkOrderId = requiredRun(
        repository.runs.loadByTaskId(input.workOrder.taskId),
      ).currentReview?.workOrderId;
      if (!reviewWorkOrderId) throw new Error("测试缺少当前 Reviewer WorkOrder");
      commands.acceptCourseReviewAndPublish({
        fence: fence(
          requiredRun(repository.runs.loadByTaskId(input.workOrder.taskId)),
          input.runLeaseOwner,
        ),
        reviewWorkOrderId,
        directorWorkOrderId: input.workOrder.id,
        directorRound: {
          workOrderId: input.workOrder.id,
          expectedLockVersion: input.workOrder.lockVersion,
          leaseOwner: input.workOrderLeaseOwner,
          action: "accept_course_review_and_publish",
          summary: "测试主 Agent 接受整课审查并发布。",
        },
        now: nextTimestamp(),
      });
      return undefined as never;
    },

    async runPageBuilder(input: RunPageBuilderAgentInput) {
      const pageId =
        input.workOrder.scope.type === "page"
          ? input.workOrder.scope.pageId
          : undefined;
      const pageTask = architecture.pageTasks.find(
        (candidate) => candidate.pageId === pageId,
      );
      if (!pageTask) throw new Error(`测试缺少 PageTask：${pageId}`);

      await hooks.beforePageCommit?.(input, pageTask);
      try {
        let payloads = pagePayloads(architecture, pageTask);
        let expectedLockVersion = input.workOrder.lockVersion;
        if (input.workOrder.kind === "fix_page") {
          const preparedFix = prepareFixPageSubmission(
            repository,
            input.workOrder,
            payloads,
          );
          payloads = preparedFix.payloads;
          for (const checkpoint of preparedFix.checkpoints) {
            const saved = repository.checkpointPageArtifact({
              workOrderId: input.workOrder.id,
              expectedWorkOrderLockVersion: expectedLockVersion,
              workOrderLeaseOwner: input.workOrderLeaseOwner,
              runLeaseOwner: input.runLeaseOwner,
              traceId: input.traceId,
              toolName: checkpoint.toolName,
              kind: checkpoint.kind,
              payload: checkpoint.payload,
              invalidates: [...checkpoint.invalidates],
              now: nextTimestamp(),
            });
            expectedLockVersion = saved.workOrder.lockVersion;
          }
        }
        repository.commitPageSubmission({
          workOrderId: input.workOrder.id,
          expectedWorkOrderLockVersion: expectedLockVersion,
          workOrderLeaseOwner: input.workOrderLeaseOwner,
          runLeaseOwner: input.runLeaseOwner,
          traceId: input.traceId,
          pageGatePassed: true,
          payloads,
          now: nextTimestamp(),
        });
      } finally {
        hooks.afterPageCommit?.(input, pageTask);
      }
      return undefined as never;
    },

    async runReviewer(input: CourseReviewerExecutionInput) {
      hooks.onReviewer?.(input);
      const run = requiredRun(
        repository.runs.loadByTaskId(input.workOrder.taskId),
      );
      createCourseRunCommands(repository).submitCourseReview({
        workOrderId: input.workOrder.id,
        expectedWorkOrderLockVersion: input.workOrder.lockVersion,
        workOrderLeaseOwner: input.workOrderLeaseOwner,
        runLeaseOwner: input.runLeaseOwner,
        traceId: input.traceId,
        candidate: {
          courseId: run.courseId,
          inputManifestHash: run.currentManifestHash,
          decision: "pass",
          coverage: architecture.blueprint.objectives.map(({ id }) => ({
            objectiveId: id,
            teachingPageIds: ["page-concept"],
            assessmentPageIds: ["page-practice"],
            status: "covered",
          })),
          issues: [],
          summary: "测试整课目标均有教学页和练习页证据，可以发布。",
        },
        now: nextTimestamp(),
      });
      return undefined as never;
    },
  };
}

function pagePayloads(
  architecture: CourseArchitecture,
  pageTask: PageTask,
) {
  const content = PageContentDSLSchema.parse({
    pageId: pageTask.pageId,
    functionalTemplateId: pageTask.functionalTemplateId,
    title: pageTask.title,
    runtime: {
      sceneKind: "demo",
      visualPrimitive: "concept-map",
      motionPlan: { intensity: "none", cuePoints: [] },
      completionRule:
        pageTask.interactionType === "none" ||
        pageTask.interactionType === "navigate"
          ? { type: "view" }
          : {
              type: "interaction-complete",
              interactionId: `interaction-${pageTask.pageId}`,
            },
    },
    narration: [pageTask.purpose],
    blocks: [
      {
        id: `block-${pageTask.pageId}`,
        kind: "concept",
        heading: pageTask.title,
        body: pageTask.teachingPoints.join("；"),
        supportingPoints: [pageTask.learnerAction],
      },
    ],
    interaction: interactionFor(pageTask),
    usedReferences: pageTask.referenceUsages,
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "课程正文优先",
      groupingStrategy: "标题、正文和操作顺序排列",
      readingOrder: [`block-${pageTask.pageId}`],
    },
  });
  const quality = QualityReportSchema.parse({
    id: `quality-${pageTask.pageId}`,
    target: { type: "page", pageId: pageTask.pageId },
    overallScore: 96,
    dimensions: {
      contentAccuracy: { score: 96, summary: "内容准确。" },
      layoutQuality: { score: 96, summary: "布局清楚。" },
      courseCoherence: { score: 96, summary: "教学连贯。" },
      styleConsistency: { score: 96, summary: "风格一致。" },
      htmlRuntime: { score: 96, summary: "运行正常。" },
      assetUsability: { score: 96, summary: "无需额外素材。" },
    },
    issues: [],
    shouldRepair: false,
    decision: "pass",
    createdAt: "2026-07-29T14:10:00.000Z",
  });

  return {
    content,
    html: {
      html: `<!doctype html><html><body><main data-page-id="${pageTask.pageId}">${pageTask.title}</main></body></html>`,
      generatedAt: "2026-07-29T14:10:00.000Z",
      revision: 1,
    },
    quality,
    summary: {
      courseId: architecture.courseId,
      pageId: pageTask.pageId,
      order: pageTask.order,
      title: pageTask.title,
      purpose: pageTask.purpose,
      objectiveIds: pageTask.objectiveIds,
      buildDependencyPageIds: pageTask.buildDependsOnPageIds,
      keyPoints: pageTask.teachingPoints,
      contentDigest: pageTask.teachingPoints.join("；"),
      learnerAction: pageTask.learnerAction,
      assessment: pageTask.assessment,
      interactionType: pageTask.interactionType,
      usedReferences: pageTask.referenceUsages,
      quality: {
        overallScore: quality.overallScore,
        decision: quality.decision,
        issueCodes: [],
      },
    },
  };
}

function interactionFor(pageTask: PageTask) {
  if (pageTask.interactionType === "reveal") {
    return {
      type: "reveal" as const,
      prompt: "展开卡片查看本页重点。",
      items: [
        {
          id: `item-${pageTask.pageId}`,
          label: pageTask.title,
          content: pageTask.teachingPoints.join("；"),
        },
      ],
    };
  }
  if (pageTask.interactionType === "choice") {
    return {
      type: "choice" as const,
      questions: [
        {
          id: "question-01",
          prompt: "太阳属于哪一类天体？",
          options: [
            { id: "option-star", label: "恒星" },
            { id: "option-planet", label: "行星" },
          ],
          correctOptionId: "option-star",
          feedback: {
            success: "正确，太阳能够自身发光。",
            retry: "请根据是否能够自身发光再判断。",
          },
          maxAttempts: 2,
        },
      ],
    };
  }
  return {
    type: "navigate" as const,
    actionLabel: pageTask.pageType === "summary" ? "完成课程" : "继续学习",
    destination:
      pageTask.pageType === "summary" ? "course-home" : "next",
  };
}

async function prepare(suffix: string) {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), `course-run-engine-${suffix}-`),
  );
  directories.push(rootDir);
  let timeOffset = 0;
  const now = () =>
    new Date(BASE_TIME + timeOffset++ * 1_000).toISOString();
  const repository = createCourseRunRepository({ rootDir });
  const input: CourseRunEngineInput = {
    taskId: `task-course-run-engine-${suffix}`,
    courseId: COURSE_ID,
    traceId: `${TRACE_ID}-${suffix}`,
    creationBrief: createBrief(),
    referencePacks: [createReferencePack()],
    concurrency: 2,
  };
  seedRunningCourseTask(repository.runs.database, {
    taskId: input.taskId,
    courseId: input.courseId,
    traceId: input.traceId,
    now: now(),
  });
  return { repository, input, now };
}

function pageOrders(repository: CourseRunRepository, taskId: string) {
  return repository.workOrders
    .listByTask(taskId)
    .filter(
      ({ kind }) => kind === "build_page" || kind === "fix_page",
    );
}

function submittedArchitect(
  repository: CourseRunRepository,
  taskId: string,
) {
  const workOrder = repository.workOrders
    .listByTask(taskId)
    .find(({ kind }) => kind === "architect_course");
  if (!workOrder) throw new Error("测试缺少 Architect WorkOrder");
  return workOrder;
}

function fence(run: CourseRun, leaseOwner: string) {
  return {
    runId: run.id,
    expectedLockVersion: run.lockVersion,
    traceId: run.traceId,
    leaseOwner,
  };
}

function requiredRun(run: CourseRun | undefined) {
  if (!run) throw new Error("测试缺少 CourseRun");
  return run;
}

function fakeGetModel(tier?: ModelTier) {
  return { tier } as never;
}

let fixtureTimeOffset = 0;
function nextTimestamp() {
  return new Date(BASE_TIME + 100_000 + fixtureTimeOffset++ * 1_000).toISOString();
}
