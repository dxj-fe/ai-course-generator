import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCourseRunCommands } from "../../../../src/server/course/run/commands";
import { createCourseRunRepository } from "../../../../src/server/course/store/repository";
import {
  PageSummarySchema,
  type CourseArchitecture,
} from "../../../../src/shared/course-schema";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

const directories: string[] = [];
const RUN_OWNER = "engine-review-test";
const TRACE_ID = "trace-review-test";

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("整课 Review 与发布命令", () => {
  it("冻结 current manifest，提交独立 Review，并只发布该精确版本", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "course-run-commands-test-"),
    );
    directories.push(rootDir);
    const repository = createCourseRunRepository({ rootDir });
    const commands = createCourseRunCommands(repository);
    seedRunningCourseTask(repository.runs.database, {
      taskId: "task-review-command",
      courseId: "course-review-command",
      traceId: TRACE_ID,
      now: timestamp(0),
    });
    const bootstrapped = repository.bootstrapCourseRun({
      taskId: "task-review-command",
      courseId: "course-review-command",
      traceId: TRACE_ID,
      now: timestamp(0),
    });
    let run = repository.runs.claimLease({
      runId: bootstrapped.run.id,
      owner: RUN_OWNER,
      now: timestamp(1),
      durationMs: 300_000,
    })!;
    const architect = repository.workOrders.claim(
      bootstrapped.architectWorkOrder.id,
      {
        owner: "architect-review-test",
        now: timestamp(2),
        durationMs: 60_000,
      },
    )!;
    const submitted = repository.submitArchitecture({
      workOrderId: architect.id,
      expectedWorkOrderLockVersion: architect.lockVersion,
      workOrderLeaseOwner: "architect-review-test",
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      architecture: architecture(),
      now: timestamp(3),
    });
    const dispatched = repository.acceptArchitectureAndDispatchPages({
      fence: fence(run),
      architectWorkOrderId: submitted.workOrder.id,
      now: timestamp(4),
    });
    run = dispatched.run;
    const page = repository.workOrders.claim(
      dispatched.pageWorkOrders[0]!.id,
      {
        owner: "page-review-test",
        now: timestamp(5),
        durationMs: 60_000,
      },
    )!;
    const committed = repository.commitPageSubmission({
      workOrderId: page.id,
      expectedWorkOrderLockVersion: page.lockVersion,
      workOrderLeaseOwner: "page-review-test",
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      pageGatePassed: true,
      payloads: {
        content: { pageId: "page-01", content: "恒星与行星" },
        assets: [],
        html: { html: "<main>恒星与行星</main>" },
        quality: { decision: "pass" },
        summary: PageSummarySchema.parse({
          version: 1,
          courseId: run.courseId,
          pageId: "page-01",
          order: 1,
          title: "恒星与行星",
          purpose: "讲清两类天体的区别",
          objectiveIds: ["objective-01"],
          buildDependencyPageIds: [],
          keyPoints: ["恒星自身发光", "行星围绕恒星运行"],
          contentDigest: "学习者通过天体是否自身发光来区分恒星与行星。",
          learnerAction: "判断太阳和地球分别属于哪类天体",
          assessment: "说明判断所依据的天体特征",
          interactionType: "reveal",
          usedReferences: [],
          quality: {
            overallScore: 96,
            decision: "pass",
            issueCodes: [],
          },
        }),
      },
      now: timestamp(6),
    });
    run = committed.run;

    const reviewCreated = commands.createCurrentReview({
      fence: fence(run),
      now: timestamp(7),
    });
    run = reviewCreated.run;
    expect(reviewCreated.manifest.pages.map(({ pageId }) => pageId)).toEqual([
      "page-01",
    ]);
    expect(run.currentManifestHash).toHaveLength(64);
    expect(reviewCreated.reviewWorkOrder.status).toBe("queued");

    const reviewer = repository.workOrders.claim(
      reviewCreated.reviewWorkOrder.id,
      {
        owner: "reviewer-test",
        now: timestamp(8),
        durationMs: 60_000,
      },
    )!;
    const reviewSubmitted = commands.submitCourseReview({
      workOrderId: reviewer.id,
      expectedWorkOrderLockVersion: reviewer.lockVersion,
      workOrderLeaseOwner: "reviewer-test",
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      candidate: {
        version: 1,
        courseId: run.courseId,
        inputManifestHash: run.currentManifestHash,
        decision: "pass",
        coverage: [
          {
            objectiveId: "objective-01",
            teachingPageIds: ["page-01"],
            assessmentPageIds: ["page-01"],
            status: "covered",
          },
        ],
        issues: [],
        summary: "目标、教学内容和练习证据一致，课程可以发布。",
      },
      now: timestamp(9),
    });
    run = reviewSubmitted.run;
    expect(reviewSubmitted.workOrder.status).toBe("submitted");
    expect(run.currentReview?.inputManifestHash).toBe(
      run.currentManifestHash,
    );

    const published = commands.acceptCourseReviewAndPublish({
      fence: fence(run),
      reviewWorkOrderId: reviewSubmitted.workOrder.id,
      now: timestamp(10),
    });
    expect(published.run.phase).toBe("completed");
    expect(published.run.leaseOwner).toBeUndefined();
    expect(published.reviewWorkOrder.status).toBe("accepted");
    expect(published.manifestArtifact.id).toBe(
      reviewCreated.manifestArtifact.id,
    );
  });
});

function fence(run: {
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
    Date.parse("2026-07-29T10:00:00.000Z") + offsetSeconds * 1_000,
  ).toISOString();
}

function architecture(): CourseArchitecture {
  return {
    version: 1,
    courseId: "course-review-command",
    coursePack: {
      version: 1,
      courseId: "course-review-command",
      topic: "太阳系",
      facts: [],
      terms: [],
      examples: [],
      constraints: [],
    },
    blueprint: {
      version: 1,
      courseId: "course-review-command",
      title: "认识太阳系",
      audience: {
        description: "初学者",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-01",
          outcome: "能解释恒星和行星的基本区别",
          evidence: "完成一次天体类型判断",
        },
      ],
      courseRules: {
        tone: "直接、清楚",
        terminology: ["恒星", "行星"],
        visualDirection: "使用清楚的对比关系",
        visualStyle: "minimal",
        styleTemplateId: "minimal",
        teachingPattern: ["先解释，再练习"],
      },
    },
    pageTasks: [
      {
        version: 1,
        pageId: "page-01",
        order: 1,
        title: "恒星与行星",
        pageType: "knowledge_card",
        purpose: "讲清两类天体的区别",
        objectiveIds: ["objective-01"],
        buildDependsOnPageIds: [],
        teachingPoints: ["恒星自身发光", "行星围绕恒星运行"],
        learnerAction: "判断太阳和地球分别属于哪类天体",
        assessment: "说明判断所依据的天体特征",
        referenceUsages: [],
        functionalTemplateId: "knowledge-card-grid",
        styleTemplateId: "minimal",
        interactionType: "reveal",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能说出两类天体的一项区别",
          requiresInteraction: true,
          pageSpecific: [],
        },
      },
    ],
  };
}
