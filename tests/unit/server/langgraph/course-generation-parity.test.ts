import { describe, expect, it } from "vitest";

import { runCourseGenerationGraphWorkflow } from "../../../../src/server/langgraph/course-generation/run-course-graph";
import { runCourseGenerationWorkflow } from "../../../../src/server/workflows/course-generation-workflow";
import {
  CourseGenerationPublicEventSchema,
  type CourseGenerationState,
} from "../../../../src/shared/course-schema";
import { createCourseRuntimeTestDependencies } from "../../../fixtures/course-generation-runtime";

const input = {
  courseId: "course-day-29-parity",
  userPrompt: "为 8 岁儿童生成三页太阳系课程",
  pageCount: 3 as const,
};
const context = { traceId: "trace-day-29" };

describe("LangGraph and handwritten workflow parity", () => {
  it("keeps the same domain outputs and public Supervisor decisions", async () => {
    const handwrittenOrder: string[] = [];
    const graphOrder: string[] = [];
    const handwritten = await runCourseGenerationWorkflow(
      input,
      context,
      createCourseRuntimeTestDependencies(handwrittenOrder, []),
    );
    const graph = await runCourseGenerationGraphWorkflow(
      input,
      context,
      createCourseRuntimeTestDependencies(graphOrder, []),
    );

    expect(graphOrder).toEqual(handwrittenOrder);
    expect(domainProjection(graph)).toEqual(domainProjection(handwritten));
    expect(
      handwritten.events.some(({ type }) => type === "supervisor_decision"),
    ).toBe(true);
    expect(
      graph.events.some(({ type }) => type === "supervisor_decision"),
    ).toBe(true);
    expect(graph.events.map((event) => CourseGenerationPublicEventSchema.parse(event)))
      .toHaveLength(graph.events.length);
  });

  it("does not run the handwritten fallback implicitly after a graph failure", async () => {
    const order: string[] = [];
    const graph = await runCourseGenerationGraphWorkflow(
      input,
      context,
      createCourseRuntimeTestDependencies(order, [], { failPlanner: true }),
    );

    expect(graph.status).toBe("failed");
    expect(order).toEqual(["intent", "planner"]);
    expect(graph.events.some(({ type }) => type === "supervisor_decision")).toBe(
      true,
    );
  });
});

function domainProjection(state: CourseGenerationState) {
  return {
    status: state.status,
    currentStage: state.currentStage,
    currentPageId: state.currentPageId,
    intent: state.intent,
    outline: state.outline,
    briefs: state.briefs,
    pageWorkerBriefs: state.pageWorkerBriefs,
    workerConfig: state.workerConfig,
    pages: state.pages,
    errors: state.errors,
    completedAt: state.completedAt,
    durationMs: state.durationMs,
  };
}
