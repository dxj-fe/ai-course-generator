import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runCourseDirectorAgent,
} from "../../../../src/server/agent/plugins/agents/course/director-handler";
import type { CourseDirectorTools } from "../../../../src/server/agent/plugins/tools/course/director";
import { createCourseRunCommands } from "../../../../src/server/course/run/commands";
import {
  createCourseRunRepository,
  type CourseRunRepository,
} from "../../../../src/server/course/store/repository";
import type {
  RuntimeAgentFactory,
} from "../../../../src/server/agent/runtime";
import {
  PageSummarySchema,
  QualityReportSchema,
  type ArtifactRef,
  type CourseReviewDecision,
  type CourseRun,
  type WorkOrder,
} from "../../../../src/shared/course-schema";
import {
  AGENT_V2_COURSE_ID,
  createAgentV2Architecture,
} from "../../../fixtures/agent-v2-course-architecture";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

export const RUN_OWNER = "director-engine-test";
export const DIRECTOR_OWNER = "director-worker-test";
export const TRACE_ID = "trace-director-test";

const BASE_TIME = Date.parse("2026-07-29T12:00:00.000Z");
const directories: string[] = [];

export async function cleanupCourseDirectorAgentTestDirectories() {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
}

export async function prepareArchitectureRound(suffix: string) {
  const { repository, taskId } = await createRepository(suffix);
  const bootstrapped = repository.bootstrapCourseRun({
    taskId,
    courseId: AGENT_V2_COURSE_ID,
    traceId: TRACE_ID,
    now: timestamp(0),
  });
  const run = required(
    repository.runs.claimLease({
      runId: bootstrapped.run.id,
      owner: RUN_OWNER,
      now: timestamp(1),
      durationMs: 600_000,
    }),
  );
  const architect = required(
    repository.workOrders.claim(
      bootstrapped.architectWorkOrder.id,
      {
        owner: `architect-${suffix}`,
        now: timestamp(2),
        durationMs: 60_000,
      },
    ),
  );
  const submitted = repository.submitArchitecture({
    workOrderId: architect.id,
    expectedWorkOrderLockVersion: architect.lockVersion,
    workOrderLeaseOwner: `architect-${suffix}`,
    runLeaseOwner: RUN_OWNER,
    traceId: TRACE_ID,
    architecture: createAgentV2Architecture(),
    now: timestamp(3),
  });
  const architectureRef = required(
    submitted.workOrder.submission?.artifactRefs.find(
      ({ kind }) => kind === "course_architecture",
    ),
  );
  const commands = createCourseRunCommands(repository);
  const queuedDirector = commands.createDirectorRound({
    fence: fence(run),
    purpose: "review_architecture",
    inputArtifactRefs: [architectureRef],
    now: timestamp(4),
  });
  const director = required(
    repository.workOrders.claim(queuedDirector.id, {
      owner: DIRECTOR_OWNER,
      now: timestamp(5),
      durationMs: 600_000,
    }),
  );

  return {
    repository,
    taskId,
    run,
    architect: submitted.workOrder,
    architectureRef,
    director,
  };
}

export async function reviseArchitectureAndPrepareNextRound(
  prepared: Awaited<ReturnType<typeof prepareArchitectureRound>>,
  round: number,
): Promise<Awaited<ReturnType<typeof prepareArchitectureRound>>> {
  await runPreparedAgent(
    prepared,
    createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "inspect_architecture", {});
      return executeTool(
        settings.tools,
        "request_architecture_revision",
        { issues: [`第 ${round} 轮架构语义问题。`] },
      );
    }),
  );

  const queuedArchitect = required(
    prepared.repository.workOrders
      .listByTask(prepared.taskId)
      .find(
        ({ kind, status }) =>
          kind === "architect_course" && status === "queued",
      ),
  );
  const architectOwner = `architect-revision-budget-${round}`;
  const claimedArchitect = required(
    prepared.repository.workOrders.claim(queuedArchitect.id, {
      owner: architectOwner,
      now: timestamp(10 + round * 3),
      durationMs: 600_000,
    }),
  );
  const submitted = prepared.repository.submitArchitecture({
    workOrderId: claimedArchitect.id,
    expectedWorkOrderLockVersion: claimedArchitect.lockVersion,
    workOrderLeaseOwner: architectOwner,
    runLeaseOwner: RUN_OWNER,
    traceId: TRACE_ID,
    architecture: createAgentV2Architecture(),
    now: timestamp(11 + round * 3),
  });
  const architectureRef = required(
    submitted.workOrder.submission?.artifactRefs.find(
      ({ kind }) => kind === "course_architecture",
    ),
  );
  const run = required(
    prepared.repository.runs.load(prepared.run.id),
  );
  const queuedDirector = createCourseRunCommands(
    prepared.repository,
  ).createDirectorRound({
    fence: fence(run),
    purpose: "review_architecture",
    inputArtifactRefs: [architectureRef],
    now: timestamp(12 + round * 3),
  });
  const director = required(
    prepared.repository.workOrders.claim(queuedDirector.id, {
      owner: DIRECTOR_OWNER,
      now: timestamp(13 + round * 3),
      durationMs: 600_000,
    }),
  );

  return {
    ...prepared,
    run,
    architect: submitted.workOrder,
    architectureRef,
    director,
  };
}

export async function prepareReviewRound(
  suffix: string,
  decision: CourseReviewDecision,
) {
  const prepared = await prepareArchitectureRound(suffix);
  let run = prepared.run;
  const dispatched =
    prepared.repository.acceptArchitectureAndDispatchPages({
      fence: fence(run),
      architectWorkOrderId: prepared.architect.id,
      now: timestamp(6),
    });
  run = dispatched.run;

  let offset = 7;
  const pending = new Set(
    dispatched.pageWorkOrders.map(({ id }) => id),
  );
  while (pending.size > 0) {
    const queued = prepared.repository.workOrders
      .listByTask(prepared.taskId, ["queued"])
      .filter(
        ({ id, kind }) => kind === "build_page" && pending.has(id),
      );
    if (queued.length === 0) {
      throw new Error("测试页面依赖无法继续解锁");
    }
    for (const queuedWorkOrder of queued) {
      const workerOwner = `page-${queuedWorkOrder.id}`;
      const claimed = required(
        prepared.repository.workOrders.claim(
          queuedWorkOrder.id,
          {
            owner: workerOwner,
            now: timestamp(offset++),
            durationMs: 60_000,
          },
        ),
      );
      if (claimed.scope.type !== "page") {
        throw new Error("测试拿到了非页面 WorkOrder");
      }
      const pageId = claimed.scope.pageId;
      const pageTask = createAgentV2Architecture().pageTasks.find(
        (candidate) => candidate.pageId === pageId,
      )!;
      const committed =
        prepared.repository.commitPageSubmission({
          workOrderId: claimed.id,
          expectedWorkOrderLockVersion: claimed.lockVersion,
          workOrderLeaseOwner: workerOwner,
          runLeaseOwner: RUN_OWNER,
          traceId: TRACE_ID,
          pageGatePassed: true,
          payloads: {
            content: { pageId, blocks: [] },
            html: { html: `<main>${pageTask.title}</main>` },
            quality: pageQuality(pageId),
            summary: PageSummarySchema.parse({
              version: 1,
              courseId: prepared.run.courseId,
              pageId,
              order: pageTask.order,
              title: pageTask.title,
              purpose: pageTask.purpose,
              objectiveIds: pageTask.objectiveIds,
              buildDependencyPageIds:
                pageTask.buildDependsOnPageIds,
              keyPoints: pageTask.teachingPoints,
              contentDigest: pageTask.teachingPoints.join("；"),
              learnerAction: pageTask.learnerAction,
              assessment: pageTask.assessment,
              interactionType: pageTask.interactionType,
              usedReferences: pageTask.referenceUsages,
              quality: {
                overallScore: 96,
                decision: "pass",
                issueCodes: [],
              },
            }),
          },
          now: timestamp(offset++),
        });
      run = committed.run;
      pending.delete(claimed.id);
    }
  }

  const commands = createCourseRunCommands(prepared.repository);
  const reviewCreated = commands.createCurrentReview({
    fence: fence(run),
    now: timestamp(offset++),
  });
  run = reviewCreated.run;
  const reviewerOwner = `reviewer-${suffix}`;
  const reviewer = required(
    prepared.repository.workOrders.claim(
      reviewCreated.reviewWorkOrder.id,
      {
        owner: reviewerOwner,
        now: timestamp(offset++),
        durationMs: 60_000,
      },
    ),
  );
  const issueEvidence =
    run.currentPages["page-concept"]!.qualityRef;
  const submittedReview = commands.submitCourseReview({
    workOrderId: reviewer.id,
    expectedWorkOrderLockVersion: reviewer.lockVersion,
    workOrderLeaseOwner: reviewerOwner,
    runLeaseOwner: RUN_OWNER,
    traceId: TRACE_ID,
    candidate: reviewCandidate(
      run,
      decision,
      issueEvidence,
    ),
    now: timestamp(offset++),
  });
  run = submittedReview.run;
  const queuedDirector = commands.createDirectorRound({
    fence: fence(run),
    purpose: "decide_course_review",
    inputArtifactRefs: [
      prepared.architectureRef,
      toArtifactRef(submittedReview.artifact),
    ],
    now: timestamp(offset++),
  });
  const director = required(
    prepared.repository.workOrders.claim(queuedDirector.id, {
      owner: DIRECTOR_OWNER,
      now: timestamp(offset++),
      durationMs: 600_000,
    }),
  );

  return {
    ...prepared,
    run,
    director,
    reviewWorkOrder: submittedReview.workOrder,
  };
}

function reviewCandidate(
  run: CourseRun,
  decision: CourseReviewDecision,
  evidence: ArtifactRef,
) {
  return {
    version: 1 as const,
    courseId: run.courseId,
    inputManifestHash: run.currentManifestHash!,
    decision,
    coverage: [
      {
        objectiveId: "objective-distinguish",
        teachingPageIds: ["page-concept"],
        assessmentPageIds: ["page-practice"],
        status: "covered" as const,
      },
    ],
    issues:
      decision === "pass"
        ? []
        : decision === "revise_pages"
          ? [
              {
                id: "issue-page-concept",
                scope: "page" as const,
                pageId: "page-concept",
                code: "CONTENT_TOO_DENSE",
                severity: "error" as const,
                message: "概念页信息过密，需要拆短说明。",
                targetArtifact: "page_content" as const,
                evidenceArtifactRefs: [evidence],
                suggestedAction: "保留事实，只精简概念页表达。",
              },
            ]
          : [
              {
                id: "issue-course-plan",
                scope: "course" as const,
                code: "OBJECTIVE_STRUCTURE_WRONG",
                severity: "error" as const,
                message: "课程目标结构需要重新规划。",
                evidenceArtifactRefs: [evidence],
                suggestedAction: "重新规划目标和页面职责。",
              },
            ],
    summary:
      decision === "pass"
        ? "整课目标、教学内容和练习证据一致，可以发布。"
        : "整课审查发现需要处理的问题。",
  };
}

function pageQuality(pageId: string) {
  const dimension = {
    score: 96,
    summary: "当前维度通过检查。",
    issueCodes: [],
    repairHints: [],
  };
  return QualityReportSchema.parse({
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
    shouldRepair: false,
    decision: "pass",
    createdAt: timestamp(7),
  });
}

async function createRepository(suffix: string) {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "course-director-agent-test-"),
  );
  directories.push(rootDir);
  const repository = createCourseRunRepository({ rootDir });
  const taskId = `task-director-${suffix}`;
  seedRunningCourseTask(repository.runs.database, {
    taskId,
    courseId: AGENT_V2_COURSE_ID,
    traceId: TRACE_ID,
    now: timestamp(0),
  });
  return {
    repository,
    taskId,
  };
}

export function runPreparedAgent(
  prepared: {
    repository: CourseRunRepository;
    director: WorkOrder;
  },
  createAgent: RuntimeAgentFactory<CourseDirectorTools>,
) {
  return runCourseDirectorAgent(
    {
      repository: prepared.repository,
      workOrder: prepared.director,
      workOrderLeaseOwner: DIRECTOR_OWNER,
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
    },
    {
      createAgent,
      model: {},
      now: () => timestamp(50),
    },
  );
}

export function createFakeFactory(
  generate: (
    settings: Parameters<
      RuntimeAgentFactory<CourseDirectorTools>
    >[0],
  ) => PromiseLike<unknown>,
): RuntimeAgentFactory<CourseDirectorTools> {
  return (settings) => ({
    generate: () => generate(settings),
  });
}

export async function executeTool(
  tools: CourseDirectorTools,
  toolName: keyof CourseDirectorTools,
  input: unknown,
) {
  const executable = tools[toolName] as unknown as {
    execute?: (
      input: unknown,
      options: { abortSignal?: AbortSignal },
    ) => unknown;
  };
  if (!executable.execute) {
    throw new Error(`测试工具 ${toolName} 缺少 execute`);
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

export function fence(run: CourseRun) {
  return {
    runId: run.id,
    expectedLockVersion: run.lockVersion,
    traceId: run.traceId,
    leaseOwner: RUN_OWNER,
  };
}

export function timestamp(offsetSeconds: number) {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

function toArtifactRef(artifact: {
  id: string;
  kind: ArtifactRef["kind"];
  courseId: string;
  pageId?: string;
  scopeKey: string;
  version: number;
  contentHash: string;
}): ArtifactRef {
  return {
    id: artifact.id,
    kind: artifact.kind,
    courseId: artifact.courseId,
    pageId: artifact.pageId,
    scopeKey: artifact.scopeKey,
    version: artifact.version,
    contentHash: artifact.contentHash,
  };
}

export function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("测试准备数据失败");
  return value;
}
