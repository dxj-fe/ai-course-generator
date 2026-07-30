import { describe, expect, it } from "vitest";

import { ToolIds } from "../../../../src/server/agent/ids";
import {
  CourseArtifactSchema,
  CourseRunSchema,
  CourseGenerationStateSchema,
  WorkOrderSchema,
  type ArtifactKind,
  type ArtifactRef,
  type CourseArchitecture,
  type CourseArtifact,
  type CourseCreationBrief,
  type WorkOrder,
} from "../../../../src/shared/course-schema";
import {
  projectCourseState,
  type CourseStateProjectorInput,
} from "../../../../src/server/course/projection/state";
import type { CourseRunEvent } from "../../../../src/server/course/store/run-event";

const COURSE_ID = "course-projector-01";
const TASK_ID = "task-projector-01";
const TRACE_ID = "trace-projector-01";
const STARTED_AT = "2026-07-29T08:00:00.000Z";
const COMPLETED_AT = "2026-07-29T08:05:00.000Z";
const PAGE_ID = "page-one";

describe("CourseStateProjector", () => {
  it("只读取 current pointer，并生成可被旧 Schema 严格解析的完成态", () => {
    const fixture = completedFixture();

    const state = projectCourseState(fixture);

    expect(CourseGenerationStateSchema.safeParse(state).success).toBe(true);
    expect(state).toMatchObject({
      status: "completed",
      currentStage: "complete",
      currentPageId: undefined,
      userPrompt: "做一门通俗的太阳系入门课",
      workerConfig: {
        mode: "parallel",
        concurrency: 1,
      },
      generationMetrics: {
        architectureAttemptCount: 2,
        architectureRevisionCount: 1,
        replanCount: 1,
        courseRevisionCount: 0,
      },
    });
    expect(state.intent?.topic).toBe("太阳系");
    expect(state.outline?.pages.map(({ id }) => id)).toEqual([PAGE_ID]);
    expect(state.pages[0]).toMatchObject({
      pageId: PAGE_ID,
      status: "completed",
      currentStage: "complete",
      htmlOutput: {
        html: "<!doctype html><html><body>当前页面</body></html>",
      },
    });
    expect(state.events.map(({ type }) => type)).toEqual([
      "start",
      "director_decision",
      "page_done",
      "finish",
    ]);
    expect(state.events.map(({ sequence }) => sequence)).toEqual([1, 2, 4, 5]);
    expect(state.events.at(-1)?.summary).toBe("课程完成 [路径已隐藏]");
    expect(state.events.some((event) => "payload" in event)).toBe(false);
    expect(state.supervisor).toBeUndefined();
  });

  it("revision 过滤后保留数据库 sequence，不重新编号 SSE 游标", () => {
    const fixture = completedFixture();
    const state = projectCourseState({
      ...fixture,
      events: fixture.events.map((event) => ({
        ...event,
        sequence: event.sequence * 10,
      })),
    });

    expect(state.events.map(({ sequence }) => sequence)).toEqual([
      10,
      20,
      40,
      50,
    ]);
  });

  it("从当前架构的 durable Repair checkpoint 投影真实返修次数", () => {
    const fixture = completedFixture();
    const currentWorkOrderId =
      fixture.run.currentPages[PAGE_ID]!.sourceWorkOrderId;
    const events = [
      ...fixture.events.map((event) => ({
        ...event,
        sequence: event.sequence >= 4
          ? event.sequence + 1
          : event.sequence,
      })),
      runEvent({
        sequence: 4,
        type: "page_checkpoint_saved",
        stage: "repairing",
        pageId: PAGE_ID,
        summary: "页面 HTML 已定向修订",
        payload: {
          workOrderId: currentWorkOrderId,
          toolName: ToolIds.RepairPageHtml,
        },
        createdAt: "2026-07-29T08:03:50.000Z",
      }),
    ].sort((left, right) => left.sequence - right.sequence);

    const state = projectCourseState({ ...fixture, events });

    expect(state.pages[0]?.repairAttemptCount).toBe(1);
  });

  it("返工页不会继续暴露 stale 旧产物，并只保留当前 Fix WorkOrder 的事件和错误", () => {
    const fixture = revisingFixture();

    const state = projectCourseState(fixture);

    expect(state).toMatchObject({
      status: "running",
      currentStage: "repair",
      currentPageId: PAGE_ID,
      pages: [
        {
          pageId: PAGE_ID,
          status: "failed",
          currentStage: "repair",
          assets: [],
          error: {
            code: "PAGE_FIX_FAILED",
            causeCode: "MODEL_ERROR",
          },
        },
      ],
    });
    expect(state.pages[0]?.content).toBeUndefined();
    expect(state.pages[0]?.htmlOutput).toBeUndefined();
    expect(state.events.some(({ summary }) => summary.includes("旧页面"))).toBe(
      false,
    );
    expect(state.events.at(-1)).toMatchObject({
      type: "error",
      pageId: PAGE_ID,
      stage: "repair",
      summary: "当前返工失败",
    });
    expect(state.errors).toEqual([
      {
        stage: "repair",
        pageId: PAGE_ID,
        code: "PAGE_FIX_FAILED",
        causeCode: "MODEL_ERROR",
        message: "页面返工模型失败",
      },
    ]);
  });

  it("current page 的结构化 Artifact payload 不合法时直接拒绝投影", () => {
    const fixture = completedFixture();
    const summaryId = fixture.run.currentPages[PAGE_ID]!.summaryRef.id;
    const artifacts = fixture.artifacts.map((artifact) =>
      artifact.id === summaryId
        ? { ...artifact, payload: { pageId: PAGE_ID, summary: "不完整" } }
        : artifact,
    );

    expect(() => projectCourseState({ ...fixture, artifacts })).toThrow();
  });

  it("架构阶段失败时投影课程级错误，不伪造页面或旧规划产物", () => {
    const fixture = failedPlanningFixture();

    const state = projectCourseState(fixture);

    expect(state).toMatchObject({
      status: "failed",
      currentStage: "planner",
      pages: [],
      errors: [
        {
          stage: "planner",
          code: "ARCHITECT_MODEL_FAILED",
          causeCode: "MODEL_ERROR",
          message: "课程架构模型调用失败",
        },
      ],
    });
    expect(state.intent).toBeUndefined();
    expect(state.outline).toBeUndefined();
    expect(state.events.at(-1)).toMatchObject({
      type: "error",
      stage: "planner",
    });
  });

  it("投影旧失败记录时清洗事件与终态错误中的凭据和私有上下文", () => {
    const fixture = failedPlanningFixture();
    const privateMessage =
      "Authorization: Bearer sk-live-SECRET MODEL_API_KEY=top-secret privatePrompt=system requestBody={raw}";
    const failedOrder = WorkOrderSchema.parse({
      ...fixture.workOrders[0]!,
      error: {
        ...fixture.workOrders[0]!.error!,
        code: "AUTH_ERROR",
        causeCode: "AUTH_ERROR",
        message: privateMessage,
      },
    });
    const failedRun = CourseRunSchema.parse({
      ...fixture.run,
      error: {
        code: "AUTH_ERROR",
        causeCode: "AUTH_ERROR",
        message: privateMessage,
      },
    });
    const state = projectCourseState({
      ...fixture,
      run: failedRun,
      workOrders: [failedOrder],
      events: fixture.events.map((event) =>
        event.sequence === 2
          ? { ...event, safeSummary: privateMessage }
          : event,
      ),
    });
    const serialized = JSON.stringify(state);

    expect(serialized).not.toMatch(
      /sk-live|top-secret|privatePrompt|requestBody/i,
    );
    expect(state.events.find(({ sequence }) => sequence === 2)?.summary).toBe(
      "课程生成进度已更新。",
    );
    expect(
      state.errors.every(({ message }) =>
        [
          "课程生成失败，请根据错误码排查后重试。",
          "Agent 无法完成当前任务。",
        ].includes(message),
      ),
    ).toBe(true);
    expect(state.errors.every(({ code }) => code === "AUTH_ERROR")).toBe(true);
    expect(state.errors.every(({ causeCode }) => causeCode === "AUTH_ERROR")).toBe(
      true,
    );
  });
});

function completedFixture(): CourseStateProjectorInput {
  const architecture = createArchitecture();
  const architectureRef = artifactRef("course_architecture");
  const pageRefs = {
    contentRef: artifactRef("page_content", PAGE_ID),
    assetsRef: artifactRef("page_assets", PAGE_ID),
    htmlRef: artifactRef("page_html", PAGE_ID),
    qualityRef: artifactRef("page_quality", PAGE_ID),
    summaryRef: artifactRef("page_summary", PAGE_ID),
  };
  const reviewRef = artifactRef("course_review");
  const oldArchitectureRef = {
    ...artifactRef("course_architecture", undefined, "old"),
    version: 1,
  };
  const oldHtmlRef = artifactRef("page_html", PAGE_ID, "old");

  const architect = acceptedWorkOrder({
    id: "work-architect-current",
    kind: "architect_course",
    scope: { type: "course" },
    inputArtifactRefs: [],
    outputArtifactRefs: [architectureRef],
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:01:00.000Z",
  });
  const page = acceptedWorkOrder({
    id: "work-page-current",
    kind: "build_page",
    scope: { type: "page", pageId: PAGE_ID },
    inputArtifactRefs: [architectureRef],
    outputArtifactRefs: Object.values(pageRefs),
    createdAt: "2026-07-29T08:01:00.000Z",
    updatedAt: "2026-07-29T08:04:00.000Z",
  });
  const review = acceptedWorkOrder({
    id: "work-review-current",
    kind: "review_course",
    scope: { type: "course" },
    inputArtifactRefs: [architectureRef, ...Object.values(pageRefs)],
    outputArtifactRefs: [reviewRef],
    createdAt: "2026-07-29T08:04:00.000Z",
    updatedAt: COMPLETED_AT,
  });
  const superseded = WorkOrderSchema.parse({
    ...acceptedWorkOrder({
      id: "work-page-old",
      kind: "build_page",
      scope: { type: "page", pageId: PAGE_ID },
      inputArtifactRefs: [oldArchitectureRef],
      outputArtifactRefs: [oldHtmlRef],
      createdAt: "2026-07-29T07:50:00.000Z",
      updatedAt: "2026-07-29T07:55:00.000Z",
    }),
    status: "superseded",
  });

  const artifacts = [
    artifact(
      architectureRef,
      architect.id,
      architecture,
      "2026-07-29T08:01:00.000Z",
    ),
    artifact(
      pageRefs.contentRef,
      page.id,
      pageContent(),
      "2026-07-29T08:03:00.000Z",
    ),
    artifact(
      pageRefs.assetsRef,
      page.id,
      [],
      "2026-07-29T08:03:10.000Z",
    ),
    artifact(
      pageRefs.htmlRef,
      page.id,
      {
        html: "<!doctype html><html><body>当前页面</body></html>",
        generatedAt: "2026-07-29T08:03:20.000Z",
        version: 1,
      },
      "2026-07-29T08:03:20.000Z",
    ),
    artifact(
      pageRefs.qualityRef,
      page.id,
      passingQualityReport(),
      "2026-07-29T08:03:30.000Z",
    ),
    artifact(
      pageRefs.summaryRef,
      page.id,
      pageSummary(),
      "2026-07-29T08:03:40.000Z",
    ),
    artifact(
      reviewRef,
      review.id,
      passingReview(),
      "2026-07-29T08:04:30.000Z",
    ),
    // 历史 Artifact payload 故意不符合 HtmlOutput；Projector 不应读取它。
    artifact(
      oldHtmlRef,
      superseded.id,
      "旧版本原始 HTML",
      "2026-07-29T07:54:00.000Z",
    ),
  ];

  const run = CourseRunSchema.parse({
    version: 1,
    id: "run-projector-01",
    taskId: TASK_ID,
    courseId: COURSE_ID,
    lockVersion: 8,
    phase: "completed",
    traceId: TRACE_ID,
    planningRevision: 2,
    activeArchitecture: {
      submissionWorkOrderId: architect.id,
      architectureRef,
    },
    currentPages: {
      [PAGE_ID]: {
        sourceWorkOrderId: page.id,
        ...pageRefs,
      },
    },
    stalePageIds: [],
    currentManifestHash: "manifest-current-12345678",
    currentReview: {
      workOrderId: review.id,
      artifactRef: reviewRef,
      inputManifestHash: "manifest-current-12345678",
    },
    replanRound: 1,
    courseRevisionRound: 0,
  });

  return {
    run,
    architecture,
    creationBrief: creationBrief(),
    referencePacks: [],
    workOrders: [superseded, architect, page, review],
    artifacts,
    events: [
      runEvent({
        sequence: 1,
        type: "course_run_bootstrapped",
        stage: "planning",
        summary: "课程任务已建立",
        payload: {},
        createdAt: STARTED_AT,
      }),
      runEvent({
        sequence: 2,
        type: "architecture_accepted",
        stage: "building",
        summary: "当前架构已接受",
        payload: { architectureRef },
        createdAt: "2026-07-29T08:01:10.000Z",
      }),
      runEvent({
        sequence: 3,
        type: "page_accepted",
        stage: "building",
        pageId: PAGE_ID,
        summary: "旧页面已完成",
        payload: { workOrderId: superseded.id },
        createdAt: "2026-07-29T08:02:00.000Z",
      }),
      runEvent({
        sequence: 4,
        type: "page_accepted",
        stage: "building",
        pageId: PAGE_ID,
        summary: "当前页面已完成",
        payload: { workOrderId: page.id },
        createdAt: "2026-07-29T08:04:00.000Z",
      }),
      runEvent({
        sequence: 5,
        type: "course_published",
        stage: "completed",
        summary: "<b>课程完成</b> /private/tmp/private-course.html",
        payload: {
          privateHtml: "<!doctype html><html>不得公开</html>",
          prompt: "不得公开的模型提示",
        },
        createdAt: COMPLETED_AT,
      }),
    ],
  };
}

function revisingFixture(): CourseStateProjectorInput {
  const completed = completedFixture();
  const architectureRef = completed.run.activeArchitecture!.architectureRef;
  const pagePointer = completed.run.currentPages[PAGE_ID]!;
  const fix = WorkOrderSchema.parse({
    version: 1,
    lockVersion: 3,
    id: "work-page-fix-current",
    taskId: TASK_ID,
    courseId: COURSE_ID,
    causedByReviewIssueIds: ["issue-page-one"],
    dependencyWorkOrderIds: [],
    kind: "fix_page",
    scope: { type: "page", pageId: PAGE_ID },
    status: "failed",
    idempotencyKey: "fix-page-one-current",
    inputArtifactRefs: [architectureRef],
    buildDependencyPageIds: [],
    inputSealedAt: "2026-07-29T08:06:00.000Z",
    checkpointArtifactRefs: [],
    acceptance: ["页面通过确定性 Gate"],
    allowedTools: ["submit_page"],
    budget: {
      maxSteps: 8,
      maxToolCalls: 12,
      timeoutMs: 300_000,
      maxOutputTokens: 20_000,
    },
    executionAttempt: 1,
    revision: 2,
    error: {
      code: "PAGE_FIX_FAILED",
      causeCode: "MODEL_ERROR",
      message: "页面返工模型失败",
      retryable: false,
      occurredAt: "2026-07-29T08:07:00.000Z",
    },
    createdAt: "2026-07-29T08:06:00.000Z",
    updatedAt: "2026-07-29T08:07:00.000Z",
  });
  const currentPageWorkOrderId = pagePointer.sourceWorkOrderId;

  return {
    ...completed,
    run: CourseRunSchema.parse({
      ...completed.run,
      lockVersion: completed.run.lockVersion + 1,
      phase: "revising",
      stalePageIds: [PAGE_ID],
      currentManifestHash: undefined,
      currentReview: undefined,
    }),
    workOrders: [
      ...completed.workOrders.filter(
        (workOrder) => workOrder.kind !== "review_course",
      ),
      fix,
    ],
    events: [
      completed.events[0]!,
      completed.events[1]!,
      runEvent({
        sequence: 3,
        type: "page_accepted",
        stage: "building",
        pageId: PAGE_ID,
        summary: "旧页面已完成",
        payload: { workOrderId: currentPageWorkOrderId },
        createdAt: "2026-07-29T08:04:00.000Z",
      }),
      runEvent({
        sequence: 4,
        type: "error",
        stage: "repair",
        pageId: PAGE_ID,
        summary: "当前返工失败",
        payload: { workOrderId: fix.id },
        createdAt: "2026-07-29T08:07:00.000Z",
      }),
    ],
  };
}

function failedPlanningFixture(): CourseStateProjectorInput {
  const failedArchitect = WorkOrderSchema.parse({
    version: 1,
    lockVersion: 2,
    id: "work-architect-failed",
    taskId: TASK_ID,
    courseId: COURSE_ID,
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: [],
    kind: "architect_course",
    scope: { type: "course" },
    status: "failed",
    idempotencyKey: "architect-failed-key",
    inputArtifactRefs: [],
    buildDependencyPageIds: [],
    inputSealedAt: STARTED_AT,
    checkpointArtifactRefs: [],
    acceptance: ["提交完整 CourseArchitecture"],
    allowedTools: ["submit_course_architecture"],
    budget: {
      maxSteps: 8,
      maxToolCalls: 12,
      timeoutMs: 300_000,
      maxOutputTokens: 20_000,
    },
    executionAttempt: 1,
    revision: 1,
    error: {
      code: "ARCHITECT_MODEL_FAILED",
      causeCode: "MODEL_ERROR",
      message: "课程架构模型调用失败",
      retryable: false,
      occurredAt: "2026-07-29T08:01:00.000Z",
    },
    createdAt: STARTED_AT,
    updatedAt: "2026-07-29T08:01:00.000Z",
  });
  return {
    run: CourseRunSchema.parse({
      version: 1,
      id: "run-projector-failed",
      taskId: TASK_ID,
      courseId: COURSE_ID,
      lockVersion: 3,
      phase: "failed",
      traceId: TRACE_ID,
      planningRevision: 0,
      currentPages: {},
      stalePageIds: [],
      replanRound: 0,
      courseRevisionRound: 0,
      error: {
        code: "ARCHITECT_MODEL_FAILED",
        causeCode: "MODEL_ERROR",
        message: "课程架构模型调用失败",
      },
    }),
    creationBrief: creationBrief(),
    workOrders: [failedArchitect],
    artifacts: [],
    events: [
      runEvent({
        sequence: 1,
        type: "course_run_bootstrapped",
        stage: "planning",
        summary: "课程任务已建立",
        payload: {},
        createdAt: STARTED_AT,
      }),
      runEvent({
        sequence: 2,
        type: "error",
        stage: "planning",
        summary: "课程架构生成失败",
        payload: { workOrderId: failedArchitect.id },
        createdAt: "2026-07-29T08:01:00.000Z",
      }),
    ],
  };
}

function createArchitecture(): CourseArchitecture {
  return {
    version: 1,
    courseId: COURSE_ID,
    coursePack: {
      version: 1,
      courseId: COURSE_ID,
      topic: "太阳系",
      facts: [],
      terms: [],
      examples: [],
      constraints: ["不引入复杂公式"],
    },
    blueprint: {
      version: 1,
      courseId: COURSE_ID,
      title: "一页看懂太阳系",
      audience: {
        description: "零基础成年人",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-one",
          outcome: "能够说出太阳系的核心组成",
          evidence: "完成页面中的口头判断练习",
        },
      ],
      courseRules: {
        tone: "直接、清楚",
        terminology: ["恒星", "行星"],
        visualDirection: "使用简单的轨道关系帮助理解",
        visualStyle: "minimal",
        styleTemplateId: "style-minimal",
        teachingPattern: ["先给结论，再给例子"],
      },
    },
    pageTasks: [
      {
        version: 1,
        pageId: PAGE_ID,
        order: 1,
        title: "太阳系的组成",
        pageType: "knowledge_card",
        purpose: "解释太阳系由哪些天体组成",
        objectiveIds: ["objective-one"],
        buildDependsOnPageIds: [],
        teachingPoints: ["太阳是恒星，行星围绕太阳运行"],
        learnerAction: "用自己的话说出太阳和行星的关系",
        assessment: "判断太阳属于恒星还是行星",
        referenceUsages: [],
        functionalTemplateId: "template-knowledge",
        styleTemplateId: "style-minimal",
        interactionType: "reveal",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能够复述太阳与行星的基本关系",
          requiresInteraction: true,
          pageSpecific: [],
        },
      },
    ],
  };
}

function creationBrief(): CourseCreationBrief {
  return {
    originalRequest: "做一门通俗的太阳系入门课",
    topic: "太阳系",
    audience: "零基础成年人",
    goal: "理解太阳与行星的基本关系",
    sectionCount: 1,
    learningMode: "guided",
    language: "zh-CN",
  };
}

function pageContent() {
  return {
    version: 1,
    pageId: PAGE_ID,
    functionalTemplateId: "template-knowledge",
    title: "太阳系的组成",
    narration: ["先看太阳，再看围绕太阳运行的行星。"],
    blocks: [
      {
        id: "block-main",
        kind: "concept",
        heading: "太阳与行星",
        body: "太阳是一颗恒星，行星围绕太阳运行。",
        supportingPoints: ["地球是太阳系中的一颗行星。"],
      },
    ],
    interaction: {
      type: "reveal",
      prompt: "展开卡片查看太阳与行星的关系。",
      items: [
        {
          id: "item-main",
          label: "核心关系",
          content: "太阳是恒星，行星围绕太阳运行。",
        },
      ],
    },
    usedReferences: [],
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "突出太阳与行星的关系",
      groupingStrategy: "结论与例子分组展示",
      readingOrder: ["block-main"],
    },
  };
}

function passingQualityReport() {
  const dimension = { score: 95, summary: "检查通过" };
  return {
    id: "quality-page-one",
    target: { type: "page", pageId: PAGE_ID },
    overallScore: 95,
    dimensions: {
      contentAccuracy: dimension,
      layoutQuality: dimension,
      courseCoherence: dimension,
      styleConsistency: dimension,
      htmlRuntime: dimension,
      assetUsability: dimension,
    },
    issues: [],
    shouldRepair: false,
    decision: "pass",
    createdAt: "2026-07-29T08:03:30.000Z",
  };
}

function pageSummary() {
  return {
    version: 1,
    courseId: COURSE_ID,
    pageId: PAGE_ID,
    order: 1,
    title: "太阳系的组成",
    purpose: "解释太阳系由哪些天体组成",
    objectiveIds: ["objective-one"],
    buildDependencyPageIds: [],
    keyPoints: ["太阳是恒星，行星围绕太阳运行"],
    contentDigest: "本页用一个结论和一个例子解释太阳与行星的关系。",
    learnerAction: "用自己的话说出太阳和行星的关系",
    assessment: "判断太阳属于恒星还是行星",
    interactionType: "reveal",
    usedReferences: [],
    quality: {
      overallScore: 95,
      decision: "pass",
      issueCodes: [],
    },
  };
}

function passingReview() {
  return {
    version: 1,
    courseId: COURSE_ID,
    inputManifestHash: "manifest-current-12345678",
    decision: "pass",
    coverage: [
      {
        objectiveId: "objective-one",
        teachingPageIds: [PAGE_ID],
        assessmentPageIds: [PAGE_ID],
        status: "covered",
      },
    ],
    issues: [],
    summary: "课程目标和页面成品均通过检查。",
  };
}

function acceptedWorkOrder(input: {
  id: string;
  kind: "architect_course" | "build_page" | "review_course";
  scope: { type: "course" } | { type: "page"; pageId: string };
  inputArtifactRefs: ArtifactRef[];
  outputArtifactRefs: ArtifactRef[];
  createdAt: string;
  updatedAt: string;
}): WorkOrder {
  return WorkOrderSchema.parse({
    version: 1,
    lockVersion: 2,
    id: input.id,
    taskId: TASK_ID,
    courseId: COURSE_ID,
    causedByReviewIssueIds: [],
    dependencyWorkOrderIds: [],
    kind: input.kind,
    scope: input.scope,
    status: "accepted",
    idempotencyKey: `${input.id}-key`,
    inputArtifactRefs: input.inputArtifactRefs,
    buildDependencyPageIds: [],
    inputSealedAt: input.createdAt,
    checkpointArtifactRefs: input.outputArtifactRefs,
    acceptance: ["提交通过确定性 Gate 的完整产物"],
    allowedTools: ["submit"],
    budget: {
      maxSteps: 8,
      maxToolCalls: 12,
      timeoutMs: 300_000,
      maxOutputTokens: 20_000,
    },
    executionAttempt: 1,
    revision: 1,
    submission: {
      workOrderId: input.id,
      status: "done",
      artifactRefs: input.outputArtifactRefs,
      evidence: ["确定性 Gate 已通过"],
      issues: [],
    },
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

function artifactRef(
  kind: ArtifactKind,
  pageId?: string,
  suffix = "current",
): ArtifactRef {
  return {
    id: `artifact-${kind}-${pageId ?? "course"}-${suffix}`,
    kind,
    courseId: COURSE_ID,
    pageId,
    scopeKey: pageId ? `page:${pageId}` : "course",
    version: suffix === "old" ? 1 : 2,
    contentHash: `hash-${kind}-${suffix}-12345678`,
  };
}

function artifact(
  ref: ArtifactRef,
  createdByWorkOrderId: string,
  payload: unknown,
  createdAt: string,
): CourseArtifact {
  return CourseArtifactSchema.parse({
    ...ref,
    taskId: TASK_ID,
    createdByWorkOrderId,
    payload,
    createdAt,
  });
}

function runEvent(input: {
  sequence: number;
  type: string;
  stage?: string;
  pageId?: string;
  summary: string;
  payload: unknown;
  createdAt: string;
}): CourseRunEvent {
  return {
    id: `event-${input.sequence}`,
    taskId: TASK_ID,
    sequence: input.sequence,
    traceId: TRACE_ID,
    type: input.type,
    stage: input.stage,
    pageId: input.pageId,
    safeSummary: input.summary,
    payload: input.payload,
    createdAt: input.createdAt,
  };
}
