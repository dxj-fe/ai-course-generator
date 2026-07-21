import { describe, expect, it } from "vitest";

import { createCourseGenerationGraph } from "../../../../src/server/langgraph/course-generation/course-graph";
import {
  runCourseGenerationGraphWorkflow,
  streamCourseGenerationGraphWorkflow,
} from "../../../../src/server/langgraph/course-generation/run-course-graph";
import { resolveCourseGenerationDependencies } from "../../../../src/server/workflows/course-generation-runtime";
import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "../../../../src/shared/course-schema";
import {
  createCourseRuntimeTestDependencies,
  courseRuntimeTimestamp,
} from "../../../fixtures/course-generation-runtime";

const input = {
  courseId: "course-day-29-langgraph",
  userPrompt: "为 8 岁儿童生成三页太阳系课程",
  pageCount: 3 as const,
};
const context = { traceId: "trace-day-29" };

describe("production course generation graph", () => {
  it("runs the fixed core nodes and returns a complete CourseGenerationState", async () => {
    const order: string[] = [];
    const checkpoints: CourseGenerationState[] = [];
    const state = await runCourseGenerationGraphWorkflow(
      input,
      context,
      createCourseRuntimeTestDependencies(order, checkpoints),
    );

    expect(order).toEqual([
      "intent",
      "planner",
      "design",
      "worker:page-01-cover",
      "worker:page-02-knowledge",
      "worker:page-03-summary",
    ]);
    expect(state.status).toBe("completed");
    expect(state.currentStage).toBe("complete");
    expect(state.pages).toHaveLength(3);
    expect(state.pages.every(({ status }) => status === "completed")).toBe(true);
    expect(state.events.at(-1)).toMatchObject({
      type: "finish",
      stage: "complete",
    });
    expect(state.events.every((event) => !("data" in event))).toBe(true);
    expect(CourseGenerationStateSchema.parse(state)).toEqual(state);
    expect(checkpoints.length).toBeGreaterThan(6);
  });

  it("streams checkpoint events before returning the terminal graph state", async () => {
    const fivePageInput = {
      ...input,
      courseId: "course-day-30-five-page-stream",
      pageCount: 5 as const,
    };
    const updates: Array<{ sequences: number[]; status: string }> = [];
    let returned = false;
    const state = await streamCourseGenerationGraphWorkflow(
      fivePageInput,
      context,
      createCourseRuntimeTestDependencies([], [], { pageCount: 5 }),
      ({ events, state: checkpoint }) => {
        expect(returned).toBe(false);
        if (events.length > 0) {
          updates.push({
            sequences: events.map(({ sequence }) => sequence),
            status: checkpoint.status,
          });
        }
      },
    );
    returned = true;

    const sequences = updates.flatMap(({ sequences }) => sequences);
    expect(sequences).toEqual(
      Array.from({ length: state.events.length }, (_, index) => index + 1),
    );
    expect(updates.some(({ status }) => status === "running")).toBe(true);
    expect(state.status).toBe("completed");
    expect(state.pages).toHaveLength(5);
    expect(
      state.events
        .filter(({ type }) => type === "page_done")
        .map(({ pageId }) => pageId),
    ).toEqual(state.outline?.pages.map(({ id }) => id));
  });

  it("compiles the explicit START-to-END topology", () => {
    const graph = createCourseGenerationGraph({
      input,
      runtime: context,
      dependencies: resolveCourseGenerationDependencies(
        createCourseRuntimeTestDependencies([], []),
      ),
    });
    const mermaid = graph.getGraph().drawMermaid();

    expect(mermaid).toContain("__start__ --> intent-node");
    expect(mermaid).toContain("intent-node --> planner-node");
    expect(mermaid).toContain("planner-node --> briefs-node");
    expect(mermaid).toContain("briefs-node --> page-workers-node");
    expect(mermaid).toContain("page-workers-node --> finalize-node");
    expect(mermaid).toContain("finalize-node --> __end__");
  });

  it("turns a Planner failure into a validated terminal state without running later nodes", async () => {
    const order: string[] = [];
    const state = await runCourseGenerationGraphWorkflow(
      input,
      context,
      createCourseRuntimeTestDependencies(order, [], { failPlanner: true }),
    );

    expect(order).toEqual(["intent", "planner"]);
    expect(state.status).toBe("failed");
    expect(state.currentStage).toBe("planner");
    expect(state.errors.at(-1)).toMatchObject({
      stage: "planner",
      code: "AGENT_EXECUTION_ERROR",
    });
    expect(state.events.at(-1)).toMatchObject({
      type: "error",
      agent: "planner",
    });
  });

  it("resumes at the failed page without rerunning completed global nodes or pages", async () => {
    const firstOrder: string[] = [];
    const failed = await runCourseGenerationGraphWorkflow(
      input,
      context,
      createCourseRuntimeTestDependencies(firstOrder, [], {
        failPageId: "page-02-knowledge",
      }),
    );
    const resumedOrder: string[] = [];
    const resumed = await runCourseGenerationGraphWorkflow(
      { ...input, existingState: failed },
      { traceId: "trace-day-29-resume" },
      createCourseRuntimeTestDependencies(resumedOrder, []),
    );

    expect(failed.status).toBe("failed");
    expect(failed.pages.map(({ status }) => status)).toEqual([
      "completed",
      "failed",
      "pending",
    ]);
    expect(resumedOrder).toEqual([
      "worker:page-02-knowledge",
      "worker:page-03-summary",
    ]);
    expect(resumed.status).toBe("completed");
    expect(resumed.pages.every(({ status }) => status === "completed")).toBe(true);
    expect(resumed.updatedAt).toBe(courseRuntimeTimestamp);
  });
});
