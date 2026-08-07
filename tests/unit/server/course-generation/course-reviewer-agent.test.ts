import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  runCourseReviewerAgent,
} from "../../../../src/server/agent/plugins/agents/course/reviewer-handler";
import {
  createCourseReviewerBudget,
} from "../../../../src/server/agent/plugins/contexts/course/reviewer";
import { createCourseRunCommands } from "../../../../src/server/course/run/commands";
import type { CourseReviewerTools } from "../../../../src/server/agent/plugins/tools/course/reviewer";
import {
  createCourseRunRepository,
  type CourseRunRepository,
} from "../../../../src/server/course/store/repository";
import {
  AgentTerminalNotCommittedError,
  AgentToolAuthorizationError,
  FatalAgentRuntimeError,
  type RuntimeAgentFactory,
} from "../../../../src/server/agent/runtime";
import {
  CourseRunSchema,
  WorkOrderSchema,
  type CourseArchitecture,
  type CourseReview,
  type PageSummary,
  type QualityReport,
} from "../../../../src/shared/course-schema";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

const directories: string[] = [];
const COURSE_ID = "course-reviewer-agent";
const TASK_ID = "task-course-reviewer-agent";
const TRACE_ID = "trace-course-reviewer-agent";
const RUN_OWNER = "engine-course-reviewer-agent";
const REVIEWER_OWNER = "worker-course-reviewer-agent";

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Course Reviewer Agent", () => {
  it.each([1, 81, 200])(
    "%i 页课程都使用一次预加载和有界终态预算",
    (pageCount) => {
      const budget = createCourseReviewerBudget(pageCount);

      expect(budget).toMatchObject({
        maxToolCalls: 8,
        maxSteps: 8,
        timeoutMs: 120_000,
      });
    },
  );

  it("实际页面存在跨页重复时，确定性证据检查阻止伪 pass", async () => {
    const prepared = await prepareReviewer({
      duplicateDigests: true,
    });
    let toolOutput: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.activeTools).toEqual([
        "inspect_page_evidence",
        "submit_course_review",
      ]);
      toolOutput = await executeTool(
        settings.tools,
        "submit_course_review",
        { review: passReview(prepared.run.currentManifestHash!) },
      );
      return {};
    });

    await expect(
      runPreparedReviewer(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);
    expect(toolOutput).toMatchObject({
      ok: false,
      code: "COURSE_REVIEW_GATE_FAILED",
      committed: false,
      terminal: false,
    });
    expect(readFeedback(toolOutput).join(" ")).toContain(
      "REVIEWER_CROSS_PAGE_DUPLICATE",
    );
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_review",
      ),
    ).toEqual([]);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
  });

  it("Harness 预加载全部封口证据，并允许 Reviewer 点查截图后提交", async () => {
    const prepared = await prepareReviewer();
    const candidate = passReview(prepared.run.currentManifestHash!);
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.activeTools).toEqual([
        "inspect_page_evidence",
        "submit_course_review",
      ]);
      expect(settings.prompt).toContain("已封口的全部决策证据");
      expect(settings.prompt).toContain("page-001");
      expect(settings.prompt).toContain("page-002");
      expect(settings.prompt).toContain(
        '"interactionSubmitTested":true',
      );
      expect(settings.prompt).toContain(
        '"interactionFeedbackVisible":true',
      );
      await expect(
        settings.prepareStep({
          messages: [],
          stepNumber: 0,
          steps: [],
        }),
      ).resolves.toMatchObject({
        activeTools: [
          "inspect_page_evidence",
          "submit_course_review",
        ],
      });
      return executeTool(
        settings.tools,
        "submit_course_review",
        { review: candidate },
      );
    });

    const result = await runPreparedReviewer(prepared, createAgent);

    expect(result.status).toBe("submitted");
    expect(result.budget).toMatchObject({
      maxToolCalls: 8,
      reservedToolCalls: 1,
      remainingToolCalls: 7,
    });
  });

  it("manifest 变化后，旧 Reviewer 的任意工具调用都会被双围栏拒绝", async () => {
    const prepared = await prepareReviewer();
    const current = prepared.repository.runs.load(prepared.run.id)!;
    const changed = CourseRunSchema.parse({
      ...current,
      lockVersion: current.lockVersion + 1,
      currentManifestHash: "stale-manifest-hash",
    });
    expect(
      prepared.repository.runs.compareAndSet(
        changed,
        {
          expectedLockVersion: current.lockVersion,
          expectedTraceId: current.traceId,
          expectedLeaseOwner: RUN_OWNER,
        },
        timestamp(20),
      ),
    ).toBe(true);
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "submit_course_review", {
        review: passReview(prepared.run.currentManifestHash!),
      });
      return {};
    });

    const error = await runPreparedReviewer(
      prepared,
      createAgent,
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(FatalAgentRuntimeError);
    expect((error as FatalAgentRuntimeError).code).toBe(
      "REVIEWER_MANIFEST_STALE",
    );
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
  });

  it("单次提交后，从 Repository 重读 submitted 终态", async () => {
    const prepared = await prepareReviewer();
    const candidate = passReview(prepared.run.currentManifestHash!);
    const calls: string[] = [];
    const createAgent = createFakeFactory(async (settings) => {
      calls.push("submit_course_review");
      const submitted = await executeTool(
        settings.tools,
        "submit_course_review",
        { review: candidate },
      );
      expect(submitted).toMatchObject({
        ok: true,
        committed: true,
        terminal: true,
      });
      return {};
    });

    const result = await runPreparedReviewer(prepared, createAgent);

    expect(calls).toEqual(["submit_course_review"]);
    expect(result.status).toBe("submitted");
    expect(result.submission.status).toBe("done");
    const stored = prepared.repository.workOrders.load(
      prepared.workOrder.id,
    );
    expect(stored?.status).toBe("submitted");
    expect(stored?.leaseOwner).toBeUndefined();
    const reviews = prepared.repository.artifacts.listByTask(
      TASK_ID,
      "course_review",
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.payload).toEqual(candidate);
    expect(
      prepared.repository.runs.load(prepared.run.id)?.currentReview
        ?.workOrderId,
    ).toBe(prepared.workOrder.id);
  });

  it("提交边界从封口快照补齐稳定字段和目标覆盖，模型无需重复抄写机器合同", async () => {
    const prepared = await prepareReviewer();
    const createAgent = createFakeFactory(async (settings) => {
      return executeTool(settings.tools, "submit_course_review", {
        review: {
          decision: "pass",
          issues: [],
          summary: "目标讲解、练习证据和页面衔接完整，可以发布。",
        },
      });
    });

    const result = await runPreparedReviewer(prepared, createAgent);

    expect(result.status).toBe("submitted");
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_review",
      )[0]?.payload,
    ).toEqual(passReview(prepared.run.currentManifestHash!));
  });

  it("Reviewer 只声明页面证据 ID，提交边界写入当前精确 ArtifactRef", async () => {
    const prepared = await prepareReviewer();
    const createAgent = createFakeFactory(async (settings) => {
      return executeTool(settings.tools, "submit_course_review", {
        review: {
          decision: "revise_pages",
          issues: [
            {
              scope: "page",
              pageId: "page-001",
              code: "EXAMPLE_NEEDS_CLARIFICATION",
              severity: "warning",
              message: "示例说明还可以更明确。",
              targetArtifact: "page_content",
              evidencePageIds: ["page-001"],
              suggestedAction: "补充示例中的判断依据。",
            },
          ],
          summary: "课程结构成立，建议定向优化第一页示例。",
        },
      });
    });

    const result = await runPreparedReviewer(prepared, createAgent);
    const review = prepared.repository.artifacts.listByTask(
      TASK_ID,
      "course_review",
    )[0]?.payload as CourseReview;
    const currentPage = prepared.run.currentPages["page-001"];

    expect(result.status).toBe("submitted");
    expect(review.issues[0]?.evidenceArtifactRefs).toEqual([
      currentPage?.summaryRef,
      currentPage?.qualityRef,
    ]);
  });

  it(
    "200 页最大课程也只需一次终态提交",
    async () => {
      const pageCount = 200;
      const prepared = await prepareReviewer({ pageCount });
      const candidate = passReview(
        prepared.run.currentManifestHash!,
        pageCount,
      );
      const createAgent = createFakeFactory(async (settings) => {
        expect(settings.activeTools).toEqual([
          "inspect_page_evidence",
          "submit_course_review",
        ]);
        expect(settings.prompt).toContain("page-200");
        expect(settings.prompt.length).toBeLessThan(500_000);
        return executeTool(settings.tools, "submit_course_review", {
          review: candidate,
        });
      });

      const result = await runPreparedReviewer(prepared, createAgent);

      expect(prepared.workOrder.budget.maxToolCalls).toBe(8);
      expect(prepared.workOrder.inputArtifactRefs).toHaveLength(2);
      expect(result.status).toBe("submitted");
      expect(result.budget).toMatchObject({
        maxToolCalls: 8,
        reservedToolCalls: 1,
        remainingToolCalls: 7,
      });
    },
    60_000,
  );

  it("健康封口开放证据点查和 submit，但不开放 block", async () => {
    const prepared = await prepareReviewer();
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.activeTools).toEqual([
        "inspect_page_evidence",
        "submit_course_review",
      ]);
      await expect(
        settings.prepareStep({
          messages: [],
          stepNumber: 0,
          steps: [],
        }),
      ).resolves.toMatchObject({
        activeTools: [
          "inspect_page_evidence",
          "submit_course_review",
        ],
      });
      return executeTool(
        settings.tools,
        "block_course_review",
        {
          code: "EVIDENCE_CONFLICT",
          message: "页面摘要和质量证据互相矛盾。",
          evidence: ["page-01 摘要与质量结论冲突"],
        },
      );
    });

    await expect(
      runPreparedReviewer(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
  });

  it("只有机器确认 PageSummary 与 PageQuality 封口合同矛盾时才允许 blocked", async () => {
    const prepared = await prepareReviewer({
      evidenceContractConflict: true,
    });
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.activeTools).toEqual(["block_course_review"]);
      await expect(
        executeTool(settings.tools, "submit_course_review", {
          review: passReview(prepared.run.currentManifestHash!),
        }),
      ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
      await expect(
        settings.prepareStep({
          messages: [],
          stepNumber: 0,
          steps: [],
        }),
      ).resolves.toMatchObject({
        activeTools: ["block_course_review"],
        toolChoice: {
          type: "tool",
          toolName: "block_course_review",
        },
      });
      return executeTool(settings.tools, "block_course_review", {
        code: "UNRECOVERABLE_STATE",
        message: "模型自报文案不会成为授权依据。",
        evidence: ["模型自报证据不会成为持久化依据"],
      });
    });

    const result = await runPreparedReviewer(prepared, createAgent);

    expect(result.status).toBe("blocked");
    const stored = prepared.repository.workOrders.load(
      prepared.workOrder.id,
    );
    expect(stored?.submission?.issues).toEqual([
      expect.stringContaining("REVIEWER_EVIDENCE_CONTRACT_CONFLICT"),
    ]);
    expect(stored?.submission?.evidence.join(" ")).toContain(
      "PageSummary 质量投影与封口 PageQuality 矛盾",
    );
    expect(stored?.submission?.evidence.join(" ")).not.toContain(
      "模型自报证据",
    );
  });

  it("即使模型直接点名隐藏的 Reviewer 工具，execute 仍按 allowedTools 拒绝", async () => {
    const prepared = await prepareReviewer({
      deniedTool: "inspect_page_evidence",
    });
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(
        settings.tools,
        "inspect_page_evidence",
        { pageId: "page-01", focus: "continuity" },
      );
      return {};
    });

    await expect(
      runPreparedReviewer(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_review",
      ),
    ).toEqual([]);
  });
});

async function prepareReviewer(
  options: {
    deniedTool?: string;
    duplicateDigests?: boolean;
    evidenceContractConflict?: boolean;
    pageCount?: number;
  } = {},
) {
  const pageCount = options.pageCount ?? 2;
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "course-reviewer-agent-test-"),
  );
  directories.push(rootDir);
  const repository = createCourseRunRepository({ rootDir });
  const commands = createCourseRunCommands(repository);
  seedRunningCourseTask(repository.runs.database, {
    taskId: TASK_ID,
    courseId: COURSE_ID,
    traceId: TRACE_ID,
    now: timestamp(0),
  });
  const bootstrapped = repository.bootstrapCourseRun({
    taskId: TASK_ID,
    courseId: COURSE_ID,
    traceId: TRACE_ID,
    now: timestamp(0),
  });
  let run = repository.runs.claimLease({
    runId: bootstrapped.run.id,
    owner: RUN_OWNER,
    now: timestamp(1),
    durationMs: 1_200_000,
  });
  const architect = repository.workOrders.claim(
    bootstrapped.architectWorkOrder.id,
    {
      owner: "architect-course-reviewer-agent",
      now: timestamp(2),
      durationMs: 60_000,
    },
  );
  if (!run || !architect) throw new Error("测试无法 claim 初始任务");

  const submitted = repository.submitArchitecture({
    workOrderId: architect.id,
    expectedWorkOrderLockVersion: architect.lockVersion,
    workOrderLeaseOwner: "architect-course-reviewer-agent",
    runLeaseOwner: RUN_OWNER,
    traceId: TRACE_ID,
    architecture: architecture(pageCount),
    now: timestamp(3),
  });
  const dispatched = repository.acceptArchitectureAndDispatchPages({
    fence: runFence(run),
    architectWorkOrderId: submitted.workOrder.id,
    now: timestamp(4),
  });
  run = dispatched.run;

  for (const [index, pageOrder] of dispatched.pageWorkOrders.entries()) {
    const pageId =
      pageOrder.scope.type === "page"
        ? pageOrder.scope.pageId
        : "missing-page";
    const pageWorkerOwner = `page-worker-${index + 1}`;
    const claimed = repository.workOrders.claim(pageOrder.id, {
      owner: pageWorkerOwner,
      now: timestamp(5 + index * 2),
      durationMs: 60_000,
    });
    if (!claimed) throw new Error(`测试无法 claim 页面 ${pageId}`);
    const digest =
      options.duplicateDigests
        ? "学习者通过同一段内容理解恒星和行星的区别。"
        : `第 ${index + 1} 页讲解独立的天体判断要点，并让学习者完成对应练习。`;
    const committed = repository.commitPageSubmission({
      workOrderId: claimed.id,
      expectedWorkOrderLockVersion: claimed.lockVersion,
      workOrderLeaseOwner: pageWorkerOwner,
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      pageGatePassed: true,
      payloads: {
        content: { pageId, content: digest },
        assets: [],
        html: { html: `<main>${pageId}</main>` },
        quality: quality(pageId),
        summary: pageSummary(
          pageId,
          index + 1,
          digest,
          options.evidenceContractConflict && index === 0 ? 95 : 96,
        ),
      },
      now: timestamp(6 + index * 2),
    });
    run = committed.run;
  }

  const reviewCreated = commands.createCurrentReview({
    fence: runFence(run),
    now: timestamp(10),
  });
  run = reviewCreated.run;
  let queued = reviewCreated.reviewWorkOrder;
  if (options.deniedTool) {
    const restricted = WorkOrderSchema.parse({
      ...queued,
      lockVersion: queued.lockVersion + 1,
      allowedTools: queued.allowedTools.filter(
        (toolName) => toolName !== options.deniedTool,
      ),
      updatedAt: timestamp(11),
    });
    if (
      !repository.workOrders.compareAndSet(restricted, {
        expectedLockVersion: queued.lockVersion,
        expectedStatus: "queued",
      })
    ) {
      throw new Error("测试无法收紧 Reviewer allowedTools");
    }
    queued = restricted;
  }
  const workOrder = repository.workOrders.claim(queued.id, {
    owner: REVIEWER_OWNER,
    now: timestamp(12),
    durationMs: 120_000,
  });
  if (!workOrder) throw new Error("测试无法 claim Reviewer WorkOrder");

  return { repository, run, workOrder };
}

function runPreparedReviewer(
  prepared: {
    repository: CourseRunRepository;
    workOrder: NonNullable<
      ReturnType<CourseRunRepository["workOrders"]["load"]>
    >;
  },
  createAgent: RuntimeAgentFactory<CourseReviewerTools>,
) {
  return runCourseReviewerAgent(
    {
      repository: prepared.repository,
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      workOrder: prepared.workOrder,
      workOrderLeaseOwner: REVIEWER_OWNER,
    },
    {
      createAgent,
      model: {},
      now: () => timestamp(20),
    },
  );
}

function createFakeFactory(
  generate: (
    settings: Parameters<RuntimeAgentFactory<CourseReviewerTools>>[0] & {
      prompt: string;
    },
  ) => PromiseLike<unknown>,
): RuntimeAgentFactory<CourseReviewerTools> {
  return (settings) => ({
    generate: ({ prompt }) => generate({ ...settings, prompt }),
  });
}

async function executeTool(
  tools: CourseReviewerTools,
  toolName: keyof CourseReviewerTools,
  input: unknown,
) {
  const executable = tools[toolName] as unknown as {
    execute?: (
      input: unknown,
      options: { abortSignal?: AbortSignal },
    ) => unknown;
  };
  if (!executable.execute) {
    throw new Error(`测试工具 ${String(toolName)} 缺少 execute`);
  }
  const output = executable.execute(input, {});
  if (isAsyncIterable(output)) {
    let latest: unknown;
    for await (const item of output) latest = item;
    return latest;
  }
  return await output;
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function readFeedback(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const feedback = (value as { feedback?: unknown }).feedback;
  return Array.isArray(feedback)
    ? feedback.filter((item): item is string => typeof item === "string")
    : [];
}

function runFence(run: {
  id: string;
  lockVersion: number;
  traceId: string;
}) {
  return {
    runId: run.id,
    expectedLockVersion: run.lockVersion,
    traceId: run.traceId,
    leaseOwner: RUN_OWNER,
  };
}

function timestamp(offsetSeconds: number) {
  return new Date(
    Date.parse("2026-07-29T12:00:00.000Z") +
      offsetSeconds * 1_000,
  ).toISOString();
}

function passReview(
  manifestHash: string,
  pageCount = 2,
): CourseReview {
  const pageIds = Array.from(
    { length: pageCount },
    (_, index) => `page-${String(index + 1).padStart(3, "0")}`,
  );
  return {
    courseId: COURSE_ID,
    inputManifestHash: manifestHash,
    decision: "pass",
    coverage: [
      {
        objectiveId: "objective-distinguish",
        teachingPageIds: pageIds,
        assessmentPageIds: pageIds,
        status: "covered",
      },
    ],
    issues: [],
    summary: "目标讲解、练习证据和页面衔接完整，可以发布。",
  };
}

function pageSummary(
  pageId: string,
  order: number,
  contentDigest: string,
  qualityScore = 96,
): PageSummary {
  return {
    courseId: COURSE_ID,
    pageId,
    order,
    title: `第 ${order} 页：判断天体`,
    purpose: `讲清第 ${order} 个天体判断要点`,
    objectiveIds: ["objective-distinguish"],
    buildDependencyPageIds: [],
    keyPoints: [`第 ${order} 个天体判断要点`],
    contentDigest,
    learnerAction: `完成第 ${order} 个天体判断练习`,
    assessment: `说明第 ${order} 个判断所依据的天体特征`,
    interactionType: "reveal",
    usedReferences: [],
    quality: {
      overallScore: qualityScore,
      decision: "pass",
      issueCodes: [],
    },
  };
}

function quality(pageId: string): QualityReport {
  const dimension = {
    score: 96,
    summary: "当前维度通过检查。",
    issueCodes: [],
    repairHints: [],
  };
  return {
    id: `quality-${pageId}`,
    target: { type: "page", pageId },
    overallScore: 96,
    dimensions: {
      contentAccuracy: dimension,
      layoutQuality: dimension,
      courseCoherence: dimension,
      styleConsistency: dimension,
      htmlRuntime: dimension,
      assetUsability: dimension,
    },
    issues: [],
    screenshotEvidence: {
      captures: [
        { width: 922, height: 460, name: "desktop" },
        { width: 712, height: 650, name: "tablet" },
        { width: 366, height: 500, name: "mobile" },
      ].map(({ width, height, name }) => ({
        status: "captured" as const,
        artifactId: `screenshot-${pageId}-${name}`,
        viewport: { width, height },
        metrics: {
          documentWidth: width,
          documentHeight: height,
          horizontalOverflowPx: 0,
          clippedElementCount: 0,
          zeroSizeInteractiveCount: 0,
          interactionSubmitTested: true,
          interactionFeedbackVisible: true,
        },
        capturedAt: timestamp(6),
      })),
    },
    shouldRepair: false,
    decision: "pass",
    createdAt: timestamp(6),
  };
}

function architecture(pageCount = 2): CourseArchitecture {
  return {
    courseId: COURSE_ID,
    coursePack: {
      courseId: COURSE_ID,
      topic: "恒星和行星",
      facts: [],
      terms: [],
      examples: [],
      constraints: [],
    },
    blueprint: {
      courseId: COURSE_ID,
      title: `${pageCount} 页学会区分恒星和行星`,
      audience: {
        description: "天文学初学者",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-distinguish",
          outcome: "能区分恒星和行星",
          evidence: "完成天体分类并说明判断理由",
        },
      ],
      courseRules: {
        tone: "直接、清楚",
        terminology: ["恒星", "行星"],
        visualDirection: "使用同一套天体卡片",
        visualStyle: "minimal",
        styleTemplateId: "minimal",
        teachingPattern: ["先讲区别", "再做判断"],
      },
    },
    pageTasks: Array.from({ length: pageCount }, (_, index) => {
      const order = index + 1;
      return {
        pageId: `page-${String(order).padStart(3, "0")}`,
        order,
        title: `第 ${order} 页：判断天体`,
        pageType: "knowledge_card",
        purpose: `讲清第 ${order} 个天体判断要点`,
        objectiveIds: ["objective-distinguish"],
        buildDependsOnPageIds: [],
        teachingPoints: [`第 ${order} 个天体判断要点`],
        learnerAction: `完成第 ${order} 个天体判断练习`,
        assessment: `说明第 ${order} 个判断所依据的天体特征`,
        referenceUsages: [],
        functionalTemplateId: "knowledge-card-grid",
        styleTemplateId: "minimal",
        interactionType: "reveal",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: `能完成第 ${order} 个天体判断`,
          requiresInteraction: true,
          pageSpecific: [],
        },
      };
    }),
  };
}
