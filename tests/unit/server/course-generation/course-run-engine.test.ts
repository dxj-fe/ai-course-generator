import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelTier } from "../../../../src/server/infra/ai/model-router";
import { AgentTerminalNotCommittedError } from "../../../../src/server/agent/runtime";
import type { RunCourseDirectorAgentInput } from "../../../../src/server/agent/plugins/agents/course/director-handler";
import type { CurriculumArchitectAgentInput } from "../../../../src/server/agent/plugins/agents/course/architect-handler";
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
import {
  PageContentDSLSchema,
  QualityReportSchema,
  type CourseArchitecture,
  type CourseRun,
  type PageTask,
} from "../../../../src/shared/course-schema";
import {
  AGENT_V2_COURSE_ID,
  createAgentV2Architecture,
  createAgentV2Brief,
  createAgentV2ReferencePack,
} from "../../../fixtures/agent-v2-course-architecture";
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
  it("严格按架构、主 Agent 派发、依赖波次、整课审查和发布顺序运行", async () => {
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
      onArchitectureDirector(input) {
        calls.push("director:architecture");
        expect(
          prepared.repository.workOrders.load(
            submittedArchitect(prepared.repository, input.workOrder.taskId).id,
          )?.status,
        ).toBe("submitted");
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
      onReviewDirector() {
        calls.push("director:review");
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
    expect(calls.indexOf("architect")).toBeLessThan(
      calls.indexOf("director:architecture"),
    );
    expect(calls.indexOf("director:architecture")).toBeLessThan(
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
      calls.indexOf("director:review"),
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

  it("供应商瞬时错误只切换一次 fallback，并且架构提交副作用只落库一次", async () => {
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

    const result = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-fallback-worker",
      getModel: fakeGetModel,
      ...baseFakes,
      runArchitect,
    }).run(prepared.input);

    expect(result.status).toBe("completed");
    expect(architectModels).toEqual(["strong", "balanced"]);
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

  it("Agent 未提交终态时切换 fallback，避免瞬时工具循环异常直接终止课程", async () => {
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
        if (architectAttempts === 1) {
          throw new AgentTerminalNotCommittedError(input.workOrder.id);
        }
        return baseFakes.runArchitect(input);
      },
    );

    const result = await createCourseRunEngine({
      repository: prepared.repository,
      now: prepared.now,
      createWorkerId: () => "engine-terminal-fallback-worker",
      getModel: fakeGetModel,
      ...baseFakes,
      runArchitect,
    }).run(prepared.input);

    expect(result.status).toBe("completed");
    expect(architectModels).toEqual(["strong", "balanced"]);
    expect(architectAttempts).toBe(2);
    expect(
      prepared.repository.artifacts.listByTask(
        prepared.input.taskId,
        "course_architecture",
      ),
    ).toHaveLength(1);
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
        source: "agent-v2",
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
    const architecture = createAgentV2Architecture();
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
                version: 1,
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
                version: 1,
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
  const architecture = createAgentV2Architecture();

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
          version: 1,
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
    version: 1,
    pageId: pageTask.pageId,
    functionalTemplateId: pageTask.functionalTemplateId,
    title: pageTask.title,
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
      version: 1,
    },
    quality,
    summary: {
      version: 1,
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
    courseId: AGENT_V2_COURSE_ID,
    traceId: `${TRACE_ID}-${suffix}`,
    creationBrief: createAgentV2Brief(),
    referencePacks: [createAgentV2ReferencePack()],
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
