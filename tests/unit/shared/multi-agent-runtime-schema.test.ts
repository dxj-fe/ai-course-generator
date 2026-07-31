import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CourseArtifactSchema,
  CourseReviewSchema,
  CourseRunSchema,
  RunSummarySchema,
  WorkOrderSchema,
  createToolResultSchema,
} from "../../../src/shared/course-schema";

const COURSE_ID = "course-runtime-test";
const TASK_ID = "task-runtime-test";
const NOW = "2026-07-29T10:00:00+08:00";

describe("多 Agent WorkOrder Schema", () => {
  it("保留委派、替代、执行依赖和 Review 来源四种独立关系", () => {
    const workOrder = WorkOrderSchema.parse({
      ...createQueuedWorkOrder(),
      parentWorkOrderId: "work-director-1",
      supersedesWorkOrderId: "work-page-old",
      dependencyWorkOrderIds: ["work-page-prerequisite"],
      causedByReviewIssueIds: ["issue-review-1"],
    });

    expect(workOrder).toMatchObject({
      parentWorkOrderId: "work-director-1",
      supersedesWorkOrderId: "work-page-old",
      dependencyWorkOrderIds: ["work-page-prerequisite"],
      causedByReviewIssueIds: ["issue-review-1"],
    });
  });

  it("要求页面类 WorkOrder 使用 page scope，课程类使用 course scope", () => {
    expect(
      WorkOrderSchema.safeParse({
        ...createQueuedWorkOrder(),
        kind: "architect_course",
        scope: { type: "page", pageId: "page-1" },
      }).success,
    ).toBe(false);
    expect(
      WorkOrderSchema.safeParse({
        ...createQueuedWorkOrder(),
        kind: "build_page",
        scope: { type: "course" },
      }).success,
    ).toBe(false);
  });

  it("waiting_dependencies 必须有真实生成依赖，且此时输入尚未封口", () => {
    const waiting = {
      ...createQueuedWorkOrder(),
      status: "waiting_dependencies",
      buildDependencyPageIds: ["page-source"],
      inputSealedAt: undefined,
    };

    expect(WorkOrderSchema.safeParse(waiting).success).toBe(true);
    expect(
      WorkOrderSchema.safeParse({
        ...waiting,
        buildDependencyPageIds: [],
      }).success,
    ).toBe(false);
    expect(
      WorkOrderSchema.safeParse({
        ...waiting,
        inputSealedAt: NOW,
      }).success,
    ).toBe(false);
  });

  it("running 必须有 lease，submitted 必须有绑定自己的 done Submission", () => {
    expect(
      WorkOrderSchema.safeParse({
        ...createQueuedWorkOrder(),
        status: "running",
      }).success,
    ).toBe(false);

    expect(
      WorkOrderSchema.safeParse({
        ...createQueuedWorkOrder(),
        status: "running",
        leaseOwner: "worker-1",
        leaseExpiresAt: "2026-07-29T10:05:00+08:00",
      }).success,
    ).toBe(true);

    const submitted = {
      ...createQueuedWorkOrder(),
      status: "submitted",
      submission: {
        workOrderId: "work-page-1",
        status: "done",
        artifactRefs: [createArtifactRef("page_html", "page-1")],
        evidence: ["三视口检查通过"],
        issues: [],
      },
    };
    expect(WorkOrderSchema.safeParse(submitted).success).toBe(true);
    expect(
      WorkOrderSchema.safeParse({
        ...submitted,
        submission: {
          ...submitted.submission,
          workOrderId: "work-other",
        },
      }).success,
    ).toBe(false);
  });

  it("failed 必须携带结构化错误，且关系不能指向自身", () => {
    expect(
      WorkOrderSchema.safeParse({
        ...createQueuedWorkOrder(),
        status: "failed",
      }).success,
    ).toBe(false);
    expect(
      WorkOrderSchema.safeParse({
        ...createQueuedWorkOrder(),
        dependencyWorkOrderIds: ["work-page-1"],
      }).success,
    ).toBe(false);
  });
});

describe("多 Agent Artifact、Review 与 CourseRun Schema", () => {
  it("页面 Artifact 必须使用 page scope，课程 Artifact 必须使用 course scope", () => {
    expect(
      CourseArtifactSchema.safeParse({
        ...createArtifactRef("page_html", "page-1"),
        taskId: TASK_ID,
        createdByWorkOrderId: "work-page-1",
        payload: "<html></html>",
        createdAt: NOW,
      }).success,
    ).toBe(true);

    expect(
      CourseArtifactSchema.safeParse({
        ...createArtifactRef("page_html"),
        taskId: TASK_ID,
        createdByWorkOrderId: "work-page-1",
        payload: "<html></html>",
        createdAt: NOW,
      }).success,
    ).toBe(false);
  });

  it("pass 不允许错误或目标缺口，revise_pages 必须点名页面", () => {
    const review = createPassingReview();
    expect(CourseReviewSchema.safeParse(review).success).toBe(true);

    expect(
      CourseReviewSchema.safeParse({
        ...review,
        issues: [
          {
            id: "issue-page-1",
            scope: "page",
            pageId: "page-1",
            code: "CONTENT_ERROR",
            severity: "error",
            message: "关键概念解释错误",
            targetArtifact: "page_content",
            evidenceArtifactRefs: [
              createArtifactRef("page_html", "page-1"),
            ],
            suggestedAction: "修正概念解释",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      CourseReviewSchema.safeParse({
        ...review,
        decision: "revise_pages",
        issues: [
          {
            id: "issue-course-1",
            scope: "course",
            code: "FLOW_WEAK",
            severity: "error",
            message: "课程衔接不足",
            evidenceArtifactRefs: [
              createArtifactRef("course_architecture"),
            ],
            suggestedAction: "补充过渡",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("页面 issue 必须携带 pageId，replan 必须有课程级证据", () => {
    const review = createPassingReview();
    expect(
      CourseReviewSchema.safeParse({
        ...review,
        decision: "replan",
        issues: [
          {
            id: "issue-page-1",
            scope: "page",
            pageId: "page-1",
            code: "LOCAL_ERROR",
            severity: "error",
            message: "页面局部问题",
            targetArtifact: "page_content",
            evidenceArtifactRefs: [
              createArtifactRef("page_html", "page-1"),
            ],
            suggestedAction: "修复页面",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("CourseRun 只接受一致的 current page 指针与 manifest Review", () => {
    const run = createCompletedRun();
    expect(CourseRunSchema.safeParse(run).success).toBe(true);

    expect(
      CourseRunSchema.safeParse({
        ...run,
        currentReview: {
          ...run.currentReview,
          inputManifestHash: "different-hash",
        },
      }).success,
    ).toBe(false);
    expect(
      CourseRunSchema.safeParse({
        ...run,
        stalePageIds: ["page-1"],
      }).success,
    ).toBe(false);
  });

  it("RunSummary 支持尚未创建页面，但拒绝重复页面", () => {
    const summary = {
      taskId: TASK_ID,
      courseId: COURSE_ID,
      phase: "building",
      pages: [
        {
          pageId: "page-1",
          order: 1,
          status: "not_created",
          artifactRefs: [],
          issues: [],
        },
      ],
      remainingBudget: {
        architectureRevisionRounds: 2,
        replanRounds: 1,
        courseRevisionRounds: 2,
      },
    };
    expect(RunSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      RunSummarySchema.safeParse({
        ...summary,
        pages: [summary.pages[0], summary.pages[0]],
      }).success,
    ).toBe(false);
  });

  it("ToolResult 明确区分已提交成功与可反馈失败", () => {
    const schema = createToolResultSchema(
      z.object({ workOrderId: z.string() }).strict(),
    );

    expect(
      schema.safeParse({
        ok: true,
        committed: true,
        terminal: true,
        summary: "页面已提交",
        data: { workOrderId: "work-page-1" },
        artifactRefs: [createArtifactRef("page_html", "page-1")],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ok: false,
        committed: false,
        terminal: false,
        code: "SCHEMA_ERROR",
        message: "页面输出不符合合同",
        retryable: true,
        feedback: ["补齐 assessment"],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ok: false,
        committed: true,
        terminal: false,
        code: "SCHEMA_ERROR",
        message: "非法组合",
        retryable: true,
      }).success,
    ).toBe(false);
  });
});

function createQueuedWorkOrder() {
  return {
    lockVersion: 0,
    id: "work-page-1",
    taskId: TASK_ID,
    courseId: COURSE_ID,
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: [],
    agentId: "page-builder",
    kind: "build_page",
    scope: { type: "page", pageId: "page-1" },
    status: "queued",
    idempotencyKey: "build:page-1:initial",
    inputArtifactRefs: [createArtifactRef("course_architecture")],
    buildDependencyPageIds: [],
    inputSealedAt: NOW,
    checkpointArtifactRefs: [],
    acceptance: ["页面通过确定性 Gate"],
    allowedTools: ["submit_page"],
    budget: {
      maxSteps: 12,
      maxToolCalls: 20,
      timeoutMs: 300_000,
      maxOutputTokens: 20_000,
    },
    executionAttempt: 0,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createPassingReview() {
  return {
    courseId: COURSE_ID,
    inputManifestHash: "manifest-12345678",
    decision: "pass",
    coverage: [
      {
        objectiveId: "objective-1",
        teachingPageIds: ["page-1"],
        assessmentPageIds: ["page-1"],
        status: "covered",
      },
    ],
    issues: [
      {
        id: "issue-warning-1",
        scope: "page",
        pageId: "page-1",
        code: "COPY_NOTE",
        severity: "warning",
        message: "可进一步精简一句提示",
        targetArtifact: "page_content",
        evidenceArtifactRefs: [
          createArtifactRef("page_summary", "page-1"),
        ],
        suggestedAction: "下次迭代精简文案",
      },
    ],
    summary: "目标覆盖完整，页面可以发布。",
  };
}

function createCompletedRun() {
  return {
    id: "run-runtime-test",
    taskId: TASK_ID,
    courseId: COURSE_ID,
    lockVersion: 5,
    phase: "completed",
    traceId: "trace-runtime-test",
    planningRevision: 1,
    activeArchitecture: {
      submissionWorkOrderId: "work-architect-1",
      architectureRef: createArtifactRef("course_architecture"),
    },
    currentPages: {
      "page-1": {
        sourceWorkOrderId: "work-page-1",
        contentRef: createArtifactRef("page_content", "page-1"),
        assetsRef: createArtifactRef("page_assets", "page-1"),
        htmlRef: createArtifactRef("page_html", "page-1"),
        qualityRef: createArtifactRef("page_quality", "page-1"),
        summaryRef: createArtifactRef("page_summary", "page-1"),
      },
    },
    stalePageIds: [],
    currentManifestHash: "manifest-12345678",
    currentReview: {
      workOrderId: "work-review-1",
      artifactRef: createArtifactRef("course_review"),
      inputManifestHash: "manifest-12345678",
    },
    replanRound: 0,
    courseRevisionRound: 0,
  };
}

function createArtifactRef(
  kind:
    | "course_architecture"
    | "page_content"
    | "page_assets"
    | "page_html"
    | "page_quality"
    | "page_summary"
    | "course_review",
  pageId?: string,
) {
  return {
    id: `artifact-${kind}-${pageId ?? "course"}`,
    kind,
    courseId: COURSE_ID,
    pageId,
    scopeKey: pageId ? `page:${pageId}` : "course",
    revision: 1,
    contentHash: `hash-${kind}-12345678`,
  };
}
