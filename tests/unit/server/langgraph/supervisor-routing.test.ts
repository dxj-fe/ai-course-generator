import { describe, expect, it } from "vitest";

import {
  decideCourseGraphSupervisor,
  routeBySupervisor,
} from "../../../../src/server/langgraph/course-generation/supervisor-routing";
import type { CourseGenerationState } from "../../../../src/shared/course-schema";

describe("LangGraph Supervisor routing", () => {
  it("maps validated decisions only to declared graph nodes", () => {
    expect(
      routeBySupervisor(
        stateWithDecision({
          action: "run",
          nextNode: { nodeName: "planner" },
          reasonSummary: "课程意图已就绪。",
        }),
      ),
    ).toBe("planner-node");
    expect(
      routeBySupervisor(
        stateWithDecision({
          action: "run",
          nextNode: { nodeName: "repair", pageId: "page-02" },
          reasonSummary: "QA 要求进入定向 Repair。",
        }),
      ),
    ).toBe("repair-page-node");
    expect(
      routeBySupervisor(
        stateWithDecision({
          action: "retry",
          nextNode: { nodeName: "page-worker", pageId: "page-02" },
          retryTarget: { nodeName: "page-worker", pageId: "page-02" },
          reasonSummary: "页面仍在阶段重试预算内。",
        }),
      ),
    ).toBe("retry-page-node");
    expect(
      routeBySupervisor(
        stateWithDecision({
          action: "stop",
          reasonSummary: "页面预算已耗尽。",
          stopReason: {
            code: "retry_exhausted",
            message: "页面预算已耗尽。",
            recoverable: true,
          },
        }),
      ),
    ).toBe("mark-failed-node");
  });

  it("routes a failing QA report to Repair and stops after its budget", () => {
    const repairable = pageRoutingState({ repairRounds: 0 });
    expect(decideCourseGraphSupervisor(repairable)).toMatchObject({
      action: "run",
      nextNode: { nodeName: "repair", pageId: "page-01" },
    });

    const exhausted = pageRoutingState({ repairRounds: 2 });
    expect(decideCourseGraphSupervisor(exhausted)).toMatchObject({
      action: "stop",
      stopReason: { code: "retry_exhausted" },
    });
  });

  it("retries a retryable page failure only while its stage budget remains", () => {
    const retryable = failedPageRoutingState({ attempts: 1 });
    expect(decideCourseGraphSupervisor(retryable)).toMatchObject({
      action: "retry",
      nextNode: { nodeName: "page-worker", pageId: "page-01" },
      retryTarget: { nodeName: "page-worker", pageId: "page-01" },
    });

    const exhausted = failedPageRoutingState({ attempts: 3 });
    expect(decideCourseGraphSupervisor(exhausted)).toMatchObject({
      action: "stop",
      stopReason: { code: "retry_exhausted" },
    });
  });
});

function stateWithDecision(
  decision: NonNullable<
    NonNullable<CourseGenerationState["supervisor"]>["lastDecision"]
  >,
) {
  return {
    supervisor: { decisionCount: 1, attempts: [], lastDecision: decision },
  } as CourseGenerationState;
}

function pageRoutingState({ repairRounds }: { repairRounds: number }) {
  return {
    status: "running",
    currentStage: "qa",
    intent: {},
    outline: {},
    briefs: {},
    pageWorkerBriefs: [],
    workerConfig: { mode: "serial", concurrency: 1 },
    pages: [
      {
        pageId: "page-01",
        order: 1,
        status: "running",
        currentStage: "qa",
        assets: [],
        qualityReport: { shouldRepair: true },
        repairHistory: Array.from({ length: repairRounds }, (_, index) => ({
          round: index + 1,
        })),
      },
    ],
    supervisor: { decisionCount: 0, attempts: [] },
  } as CourseGenerationState;
}

function failedPageRoutingState({ attempts }: { attempts: number }) {
  return {
    ...pageRoutingState({ repairRounds: 0 }),
    currentStage: "html",
    pages: [
      {
        pageId: "page-01",
        order: 1,
        status: "failed",
        currentStage: "html",
        assets: [],
        attempts: [{ stage: "html", attempts }],
        error: {
          code: "HTML_ENGINEER_FAILED",
          message: "HTML 生成失败。",
        },
      },
    ],
  } as CourseGenerationState;
}
