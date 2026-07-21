import { END, START, StateGraph } from "@langchain/langgraph";

import { CourseGenerationGraphStateSchema } from "./course-state";
import { createBriefsGraphNode } from "./nodes/briefs-node";
import { createFinalizeGraphNode } from "./nodes/finalize-node";
import { createIntentGraphNode } from "./nodes/intent-node";
import { createPageWorkersGraphNode } from "./nodes/page-workers-node";
import { createPlannerGraphNode } from "./nodes/planner-node";
import type { CourseGenerationGraphNodeContext } from "./nodes/types";

/** Day 29 固定核心拓扑；页面内部的依赖、并发和 QA/Repair 仍归 Page Worker。 */
export function createCourseGenerationGraph(
  context: CourseGenerationGraphNodeContext,
) {
  return new StateGraph(CourseGenerationGraphStateSchema)
    .addNode("intent-node", createIntentGraphNode(context))
    .addNode("planner-node", createPlannerGraphNode(context))
    .addNode("briefs-node", createBriefsGraphNode(context))
    .addNode("page-workers-node", createPageWorkersGraphNode(context))
    .addNode("finalize-node", createFinalizeGraphNode(context))
    .addEdge(START, "intent-node")
    .addEdge("intent-node", "planner-node")
    .addEdge("planner-node", "briefs-node")
    .addEdge("briefs-node", "page-workers-node")
    .addEdge("page-workers-node", "finalize-node")
    .addEdge("finalize-node", END)
    .compile();
}
