import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, vi } from "vitest";

import { createPageBuilderExecution } from "../../../../src/server/agent/plugins/contexts/course/page-builder";
import type { PageBuilderModelSteps } from "../../../../src/server/agent/plugins/tools/course/page-builder-model-steps";
import type { PageBuilderTools } from "../../../../src/server/agent/plugins/tools/course/page-builder";
import { createCourseRunRepository } from "../../../../src/server/course/store/repository";
import type { RuntimeAgentFactory } from "../../../../src/server/agent/runtime";
import { buildPageQualityReport } from "../../../../src/server/course/page/quality/report";
import {
  PageContentDSLSchema,
  PageSummarySchema,
  WorkOrderSchema,
  type CourseArtifact,
  type CourseArchitecture,
  type HtmlOutput,
  type PageContentDSL,
  type QualityReport,
  type WorkOrder,
} from "../../../../src/shared/course-schema";
import {
  createAgentV2Architecture,
  createAgentV2Brief,
  createAgentV2ReferencePack,
} from "../../../fixtures/agent-v2-course-architecture";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

export const NOW = "2026-07-29T12:00:00.000Z";
export const PAGE_ID = "page-concept";
export const ENGINE_OWNER = "engine-page-builder-test";
export const PAGE_OWNER = "page-builder-test";

export async function executeTool(
  tools: PageBuilderTools,
  toolName: keyof PageBuilderTools & string,
  input: unknown,
  abortSignal?: AbortSignal,
) {
  const candidate = tools[toolName] as unknown as {
    execute(
      input: unknown,
      options: {
        abortSignal?: AbortSignal;
        messages: [];
        toolCallId: string;
      },
    ): AsyncIterable<unknown> | PromiseLike<unknown> | unknown;
  };
  const result = candidate.execute(input, {
    abortSignal,
    messages: [],
    toolCallId: `tool-call-${toolName}`,
  });
  if (isAsyncIterable(result)) {
    let output: unknown;
    for await (const value of result) output = value;
    return output;
  }
  return await result;
}

export async function preparePageBuilder(
  directories: string[],
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "page-builder-agent-test-"),
  );
  directories.push(directory);
  const repository = createCourseRunRepository({
    rootDir: directory,
  });
  const architecture = onePageArchitecture();
  seedRunningCourseTask(repository.runs.database, {
    taskId: "task-page-builder-test",
    courseId: architecture.courseId,
    traceId: "trace-page-builder-test",
    now: NOW,
  });
  const bootstrapped = repository.bootstrapCourseRun({
    taskId: "task-page-builder-test",
    courseId: architecture.courseId,
    traceId: "trace-page-builder-test",
    now: NOW,
  });
  const run = repository.runs.claimLease({
    runId: bootstrapped.run.id,
    owner: ENGINE_OWNER,
    now: "2026-07-29T12:00:00.100Z",
    durationMs: 600_000,
  })!;
  const architect = repository.workOrders.claim(
    bootstrapped.architectWorkOrder.id,
    {
      owner: "architect-page-builder-test",
      now: "2026-07-29T12:00:00.200Z",
      durationMs: 60_000,
    },
  )!;
  const submitted = repository.submitArchitecture({
    workOrderId: architect.id,
    expectedWorkOrderLockVersion: architect.lockVersion,
    workOrderLeaseOwner: "architect-page-builder-test",
    runLeaseOwner: ENGINE_OWNER,
    traceId: run.traceId,
    architecture,
    now: "2026-07-29T12:00:01.000Z",
  });
  const dispatched =
    repository.acceptArchitectureAndDispatchPages({
      fence: {
        runId: run.id,
        expectedLockVersion: run.lockVersion,
        traceId: run.traceId,
        leaseOwner: ENGINE_OWNER,
      },
      architectWorkOrderId: submitted.workOrder.id,
      now: "2026-07-29T12:00:02.000Z",
    });
  const queued = requiredPageOrder(
    dispatched.pageWorkOrders,
    PAGE_ID,
  );
  const workOrder = repository.workOrders.claim(queued.id, {
    owner: PAGE_OWNER,
    now: "2026-07-29T12:00:03.000Z",
    durationMs: 300_000,
  })!;
  const execution = createPageBuilderExecution({
    repository,
    workOrder,
    workOrderLeaseOwner: PAGE_OWNER,
    runLeaseOwner: ENGINE_OWNER,
    traceId: run.traceId,
    creationBrief: createAgentV2Brief(),
    referencePacks: [createAgentV2ReferencePack()],
  });
  return {
    repository,
    run: dispatched.run,
    workOrder,
    execution,
  };
}

export async function prepareContentFixPageBuilder(
  directories: string[],
  targetArtifact: "page_content" | "page_html" = "page_content",
) {
  const prepared = await preparePageBuilder(directories);
  const baselineContent = pageContent();
  const baselineQuality = passingQuality();
  const artifactBase = {
    taskId: prepared.workOrder.taskId,
    courseId: prepared.workOrder.courseId,
    pageId: PAGE_ID,
    scopeKey: `page:${PAGE_ID}`,
    createdByWorkOrderId: prepared.workOrder.id,
    createdAt: "2026-07-29T12:02:00.000Z",
  };
  const baselineArtifacts = [
    prepared.repository.artifacts.put({
      ...artifactBase,
      kind: "page_content",
      payload: baselineContent,
    }),
    prepared.repository.artifacts.put({
      ...artifactBase,
      kind: "page_html",
      payload: htmlOutput(),
    }),
    prepared.repository.artifacts.put({
      ...artifactBase,
      kind: "page_quality",
      payload: baselineQuality,
    }),
    prepared.repository.artifacts.put({
      ...artifactBase,
      kind: "page_summary",
      payload: pageSummary(baselineContent, baselineQuality),
    }),
  ];
  const baselineSummaryRef = toRef(baselineArtifacts[3]!);
  const reviewArtifact = prepared.repository.artifacts.put({
    taskId: prepared.workOrder.taskId,
    courseId: prepared.workOrder.courseId,
    scopeKey: "course",
    kind: "course_review",
    createdByWorkOrderId: "work-order-review-page-concept",
    createdAt: "2026-07-29T12:02:00.500Z",
    payload: {
      version: 1,
      courseId: prepared.workOrder.courseId,
      inputManifestHash: "manifest-fix-page-concept",
      decision: "revise_pages",
      coverage: [
        {
          objectiveId: "objective-distinguish",
          teachingPageIds: [PAGE_ID],
          assessmentPageIds: [PAGE_ID],
          status: "covered",
        },
      ],
      issues: [
        {
          id: "issue-fix-page-concept",
          scope: "page",
          pageId: PAGE_ID,
          code:
            targetArtifact === "page_content"
              ? "CROSS_PAGE_DUPLICATE"
              : "HTML_LAYOUT_NEEDS_FIX",
          severity: "error",
          message:
            targetArtifact === "page_content"
              ? "概念页与相邻页面重复，需要重写内容。"
              : "概念页布局需要重新生成 HTML。",
          targetArtifact,
          evidenceArtifactRefs: [baselineSummaryRef],
          suggestedAction: "保留本页职责并删除重复解释。",
        },
      ],
      summary: "概念页需要定向内容返工。",
    },
  });
  const architectureRef = prepared.workOrder.inputArtifactRefs.find(
    ({ kind }) => kind === "course_architecture",
  )!;
  const inserted = prepared.repository.workOrders.insert(
    WorkOrderSchema.parse({
      ...prepared.workOrder,
      id: "work-order-fix-page-concept",
      lockVersion: 0,
      kind: "fix_page",
      status: "queued",
      idempotencyKey: "task-page-builder-test:fix:page-concept:1",
      supersedesWorkOrderId: prepared.workOrder.id,
      causedByReviewIssueIds: ["issue-fix-page-concept"],
      inputArtifactRefs: [
        architectureRef,
        toRef(reviewArtifact),
        ...baselineArtifacts.map(toRef),
      ],
      checkpointArtifactRefs: [],
      executionAttempt: 0,
      revision: 2,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      createdAt: "2026-07-29T12:02:01.000Z",
      updatedAt: "2026-07-29T12:02:01.000Z",
    }),
  );
  const workOrder = prepared.repository.workOrders.claim(inserted.id, {
    owner: "page-builder-fix-test",
    now: "2026-07-29T12:02:02.000Z",
    durationMs: 300_000,
  })!;
  const execution = createPageBuilderExecution({
    repository: prepared.repository,
    workOrder,
    workOrderLeaseOwner: "page-builder-fix-test",
    runLeaseOwner: ENGINE_OWNER,
    traceId: prepared.run.traceId,
    creationBrief: createAgentV2Brief(),
    referencePacks: [createAgentV2ReferencePack()],
  });
  const revisedContent = PageContentDSLSchema.parse({
    ...baselineContent,
    narration: ["返工后的内容已经消除跨页重复。"],
  });
  const revisedHtml = {
    ...htmlOutput(),
    html: htmlOutput().html.replace(
      "</main>",
      "<p>返工后的页面实现</p></main>",
    ),
    version: 2,
  };
  const revisedQuality = passingQuality();
  return {
    ...prepared,
    workOrder,
    execution,
    revisedContent,
    revisedHtml,
    revisedQuality,
    steps: modelSteps({
      content: revisedContent,
      html: revisedHtml,
      quality: revisedQuality,
    }),
  };
}

export function pageContent(): PageContentDSL {
  return PageContentDSLSchema.parse({
    version: 1,
    pageId: PAGE_ID,
    functionalTemplateId: "knowledge-card-grid",
    title: "恒星与行星的区别",
    narration: ["先用是否自身发光来区分恒星和行星。"],
    blocks: [
      {
        id: "block-star",
        kind: "concept",
        heading: "恒星",
        body: "恒星能够自身发光发热，太阳就是一颗恒星。",
        supportingPoints: ["判断重点是能否自身发光。"],
      },
      {
        id: "block-planet",
        kind: "concept",
        heading: "行星",
        body: "行星不会自身发光，并且会围绕恒星运行。",
        supportingPoints: ["地球是围绕太阳运行的行星。"],
      },
    ],
    interaction: {
      type: "reveal",
      prompt: "展开卡片查看判断依据。",
      items: [
        {
          id: "item-star",
          label: "恒星",
          content: "能够自身发光发热。",
        },
        {
          id: "item-planet",
          label: "行星",
          content: "不会自身发光。",
        },
      ],
    },
    usedReferences: [],
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "突出恒星和行星的区别",
      groupingStrategy: "两张同层级概念卡片",
      readingOrder: ["block-star", "block-planet"],
    },
  });
}

export function htmlOutput(): HtmlOutput {
  return {
    html: `<!doctype html><html><body><main data-page-id="${PAGE_ID}"></main></body></html>`,
    generatedAt: "2026-07-29T12:01:00.000Z",
    version: 1,
  };
}

export function pageSummary(
  content: PageContentDSL,
  quality: QualityReport,
) {
  return PageSummarySchema.parse({
    version: 1,
    courseId: createAgentV2Architecture().courseId,
    pageId: PAGE_ID,
    order: 1,
    title: content.title,
    purpose: "讲清是否自身发光这一核心区别",
    objectiveIds: ["objective-distinguish"],
    buildDependencyPageIds: [],
    keyPoints: content.blocks.map(({ heading }) => heading),
    contentDigest: content.narration.join("；"),
    learnerAction: "展开两张卡片并说出区别",
    assessment: "口头判断太阳和地球分别属于哪一类天体",
    interactionType: "reveal",
    usedReferences: content.usedReferences,
    quality: {
      overallScore: quality.overallScore,
      decision: quality.decision,
      issueCodes: quality.issues.map(({ code }) => code),
    },
  });
}

export function passingQuality() {
  return buildQualityReport([]);
}

export function failingContentQuality() {
  return buildQualityReport([
    {
      code: "CORE_CONCEPT_UNCLEAR",
      dimension: "contentAccuracy" as const,
      severity: "error" as const,
      source: "model" as const,
      message: "恒星和行星的判断标准没有讲清。",
      location: {
        pageId: PAGE_ID,
        blockId: "block-star",
        description: "恒星内容块",
      },
      repairHint: "在恒星内容块补充是否自身发光的判断标准。",
    },
  ]);
}

export function modelSteps(input: {
  content: PageContentDSL;
  quality: QualityReport;
  html?: HtmlOutput;
  repairedContent?: PageContentDSL;
  repairSummary?: string;
}): PageBuilderModelSteps {
  const repairPage: PageBuilderModelSteps["repairPage"] = vi.fn(
    async ({ request }) => {
      if (
        request.targetArtifact === "dsl" &&
        input.repairedContent
      ) {
        return {
          status: "applied" as const,
          targetArtifact: "dsl" as const,
          content: input.repairedContent,
          summary:
            input.repairSummary ?? "已定向补清核心判断标准。",
        };
      }
      return {
        status: "declined" as const,
        targetArtifact: request.targetArtifact,
        summary: "测试未配置对应修复产物。",
      };
    },
  );
  return {
    generateContent: vi.fn(async () => input.content),
    resolveAssets: vi.fn(async () => []),
    generateHtml: vi.fn(async () => input.html ?? htmlOutput()),
    inspectPage: vi.fn(async () => input.quality),
    repairPage,
  };
}

export function scriptedPageBuilderFactory(
  sequence: Array<keyof PageBuilderTools & string>,
): RuntimeAgentFactory<PageBuilderTools> {
  return (settings) => ({
    generate: async ({ abortSignal }) => {
      for (const toolName of sequence) {
        const prepared = await settings.prepareStep({
          messages: [],
          stepNumber: 1,
          steps: [],
        });
        expect(prepared.activeTools).toContain(toolName);
        await executeTool(
          settings.tools,
          toolName,
          { pageId: PAGE_ID },
          abortSignal,
        );
      }
      return {};
    },
  });
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

function onePageArchitecture(): CourseArchitecture {
  const architecture = createAgentV2Architecture();
  const pageTask = architecture.pageTasks.find(
    ({ pageId }) => pageId === PAGE_ID,
  );
  if (!pageTask) throw new Error("测试架构缺少 page-concept");
  return {
    ...architecture,
    pageTasks: [{ ...pageTask, order: 1 }],
  };
}

function requiredPageOrder(
  workOrders: WorkOrder[],
  pageId: string,
) {
  const workOrder = workOrders.find(
    ({ scope }) =>
      scope.type === "page" && scope.pageId === pageId,
  );
  if (!workOrder) {
    throw new Error(`测试缺少页面 WorkOrder：${pageId}`);
  }
  return workOrder;
}

function toRef(artifact: CourseArtifact) {
  const {
    id,
    kind,
    courseId,
    pageId,
    scopeKey,
    version,
    contentHash,
  } = artifact;
  return {
    id,
    kind,
    courseId,
    pageId,
    scopeKey,
    version,
    contentHash,
  };
}

function buildQualityReport(
  modelIssues: Parameters<
    typeof buildPageQualityReport
  >[0]["modelIssues"],
) {
  return buildPageQualityReport({
    id:
      modelIssues.length > 0
        ? "quality-page-content-failed"
        : "quality-page-passed",
    pageId: PAGE_ID,
    modelDimensions: {
      contentAccuracy: { score: 96, summary: "内容准确。" },
      layoutQuality: { score: 95, summary: "布局稳定。" },
      courseCoherence: { score: 95, summary: "教学连贯。" },
      styleConsistency: { score: 95, summary: "风格一致。" },
      htmlRuntime: { score: 98, summary: "运行正常。" },
      assetUsability: { score: 95, summary: "无需素材。" },
    },
    heuristicIssues: [],
    modelIssues,
    requireScreenshotEvidence: false,
    createdAt: "2026-07-29T12:01:30.000Z",
  });
}
