import { describe, expect, it } from "vitest";

import {
  courseWorkflowDemoGraph,
  createCourseWorkflowDemoInput,
  runCourseWorkflowDemo,
  streamCourseWorkflowDemo,
} from "../../../../src/server/langgraph/course-workflow-demo";

describe("course workflow LangGraph demo", () => {
  it("runs START -> planner -> END and accumulates public demo events", async () => {
    const result = await runCourseWorkflowDemo("为儿童规划一门太阳系课程");

    expect(result.plan).toEqual([
      "明确学习目标：为儿童规划一门太阳系课程",
      "按引入、讲解、练习、总结组织课程页面",
      "为每页保留可验证的学习结果",
    ]);
    expect(result.events).toEqual([
      {
        node: "start",
        summary: "课程规划 Demo 已开始。",
      },
      {
        node: "planner",
        summary: "Planner 已生成确定性的课程结构。",
      },
    ]);
  });

  it("applies state updates without mutating the caller input", async () => {
    const input = createCourseWorkflowDemoInput("生成一门物理入门课程");
    const snapshot = structuredClone(input);

    await courseWorkflowDemoGraph.invoke(input);

    expect(input).toEqual(snapshot);
    expect(input).not.toHaveProperty("plan");
    expect(input.events).toHaveLength(1);
  });

  it("streams only the planner state update in updates mode", async () => {
    const updates = [];

    for await (const update of await streamCourseWorkflowDemo(
      "生成一门地理入门课程",
    )) {
      updates.push(update);
    }

    expect(updates).toEqual([
      {
        planner: {
          plan: [
            "明确学习目标：生成一门地理入门课程",
            "按引入、讲解、练习、总结组织课程页面",
            "为每页保留可验证的学习结果",
          ],
          events: [
            {
              node: "planner",
              summary: "Planner 已生成确定性的课程结构。",
            },
          ],
        },
      },
    ]);
  });

  it("rejects an invalid prompt at the graph state boundary", async () => {
    await expect(runCourseWorkflowDemo(" ")).rejects.toThrow();
  });
});
