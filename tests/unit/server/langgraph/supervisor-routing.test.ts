import { describe, expect, it } from "vitest";

import {
  decideCourseGraphSupervisor,
  resolveCourseGraphSupervisorDecisionLimit,
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

  it("routes quality iteration four and stops only at the emergency guard", () => {
    const repairable = pageRoutingState({ repairRounds: 0 });
    expect(decideCourseGraphSupervisor(repairable)).toMatchObject({
      action: "run",
      nextNode: { nodeName: "repair", pageId: "page-01" },
    });

    const fourth = pageRoutingState({ repairRounds: 3 });
    expect(decideCourseGraphSupervisor(fourth)).toMatchObject({
      action: "run",
      nextNode: { nodeName: "repair", pageId: "page-01" },
    });

    const exhausted = pageRoutingState({ repairRounds: 24 });
    expect(decideCourseGraphSupervisor(exhausted)).toMatchObject({
      action: "stop",
      stopReason: { code: "decision_limit" },
    });
  });

  it("does not automatically restart a page stopped by quality stagnation", () => {
    const state = pageRoutingState({ repairRounds: 3 });
    state.pages[0] = {
      ...state.pages[0]!,
      status: "failed",
      currentStage: "repair",
      error: {
        code: "QUALITY_STALLED",
        message: "连续三次没有改善。",
      },
    };

    expect(decideCourseGraphSupervisor(state)).toMatchObject({
      action: "stop",
      stopReason: { code: "non_retryable_error" },
    });
  });

  it("adds a retrieved capability summary without changing route legality", () => {
    const decision = decideCourseGraphSupervisor({
      ...pageRoutingState({ repairRounds: 0 }),
      intent: undefined,
      outline: undefined,
      briefs: undefined,
      pageWorkerBriefs: undefined,
      pages: [],
      currentStage: "intent",
    } as CourseGenerationState);

    expect(decision).toMatchObject({
      action: "run",
      nextNode: { nodeName: "intent" },
    });
    expect(decision.reasonSummary).toContain("可用能力：课程意图解析");
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

    const legacyRecursionCheckpoint = failedPageRoutingState({
      attempts: 0,
      code: "COURSE_TASK_EXECUTION_ERROR",
      message: "Recursion limit of 25 reached without hitting a stop condition.",
    });
    expect(decideCourseGraphSupervisor(legacyRecursionCheckpoint)).toMatchObject({
      action: "retry",
      nextNode: { nodeName: "page-worker", pageId: "page-01" },
    });
  });

  it("bounds a terminal page error before creating the Supervisor decision", () => {
    const message = `Page Writer 输出失败：${"字段错误；".repeat(100)}`;
    const decision = decideCourseGraphSupervisor(
      failedPageRoutingState({
        attempts: 3,
        code: "PAGE_WRITER_FAILED",
        message,
      }),
    );

    expect(decision.action).toBe("stop");
    expect(decision.reasonSummary.length).toBeLessThanOrEqual(300);
    if (decision.action === "stop") {
      expect(decision.stopReason.message.length).toBeLessThanOrEqual(500);
      expect(decision.stopReason.message).toContain("Page Writer 输出失败");
    }
  });

  it("scales the loop guard with the planned course length", () => {
    const shortCourse = {
      ...pageRoutingState({ repairRounds: 0 }),
      intent: { courseLength: 3 },
    } as CourseGenerationState;
    const longCourse = {
      ...pageRoutingState({ repairRounds: 0 }),
      intent: { courseLength: 120 },
    } as CourseGenerationState;

    expect(resolveCourseGraphSupervisorDecisionLimit(shortCourse)).toBe(320);
    expect(resolveCourseGraphSupervisorDecisionLimit(longCourse)).toBeGreaterThan(
      320,
    );
  });
});

function stateWithDecision(
  decision: NonNullable<
    NonNullable<CourseGenerationState["supervisor"]>["lastDecision"]
  >,
) {
  return {
    supervisor: { decisionCount: 1, attempts: [], lastDecision: decision },
  } as unknown as CourseGenerationState;
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
  } as unknown as CourseGenerationState;
}

function failedPageRoutingState({
  attempts,
  code = "HTML_ENGINEER_FAILED",
  message = "HTML 生成失败。",
}: {
  attempts: number;
  code?: string;
  message?: string;
}) {
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
        error: { code, message },
      },
    ],
  } as CourseGenerationState;
}
