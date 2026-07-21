import { END, START, StateGraph } from "@langchain/langgraph";

import { CourseWorkflowDemoStateSchema } from "./course-workflow-demo-state";
import { plannerNode } from "./nodes/planner-node";

export {
  CourseWorkflowDemoStateSchema,
  LangGraphDemoEventSchema,
  type CourseWorkflowDemoState,
  type LangGraphDemoEvent,
} from "./course-workflow-demo-state";
export { plannerNode } from "./nodes/planner-node";

/** 构建独立 Graph；生产 Course Workflow 不导入或调用这个 Demo。 */
export function createCourseWorkflowDemoGraph() {
  return new StateGraph(CourseWorkflowDemoStateSchema)
    .addNode("planner", plannerNode)
    .addEdge(START, "planner")
    .addEdge("planner", END)
    .compile();
}

export const courseWorkflowDemoGraph = createCourseWorkflowDemoGraph();

export function createCourseWorkflowDemoInput(prompt: string) {
  return {
    prompt,
    events: [
      {
        node: "start" as const,
        summary: "课程规划 Demo 已开始。",
      },
    ],
  };
}

export async function runCourseWorkflowDemo(prompt: string) {
  return courseWorkflowDemoGraph.invoke(
    createCourseWorkflowDemoInput(prompt),
  );
}

export function streamCourseWorkflowDemo(prompt: string) {
  return courseWorkflowDemoGraph.stream(
    createCourseWorkflowDemoInput(prompt),
    { streamMode: "updates" },
  );
}
