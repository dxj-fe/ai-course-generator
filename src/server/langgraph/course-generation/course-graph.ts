import { END, START, StateGraph } from "@langchain/langgraph";

import { CourseGenerationGraphStateSchema } from "./course-state";
import { createBriefsGraphNode } from "./nodes/briefs-node";
import { createFinalizeGraphNode } from "./nodes/finalize-node";
import { createIntentGraphNode } from "./nodes/intent-node";
import { createMarkFailedGraphNode } from "./nodes/mark-failed-node";
import { createPageWorkersGraphNode } from "./nodes/page-workers-node";
import { createPlannerGraphNode } from "./nodes/planner-node";
import { createRepairPageGraphNode } from "./nodes/repair-page-node";
import { createRetryPageGraphNode } from "./nodes/retry-page-node";
import { createSupervisorGraphNode } from "./nodes/supervisor-node";
import type { CourseGenerationGraphNodeContext } from "./nodes/types";
import { COURSE_GRAPH_ROUTES, routeBySupervisor } from "./supervisor-routing";

/** Day 31 受控动态拓扑；业务规则仍由共享 Specialist 与 Page Worker 持有。 */
export function createCourseGenerationGraph(
  context: CourseGenerationGraphNodeContext,
) {
  return new StateGraph(CourseGenerationGraphStateSchema)
    .addNode("intent-node", createIntentGraphNode(context))
    .addNode("planner-node", createPlannerGraphNode(context))
    .addNode("briefs-node", createBriefsGraphNode(context))
    .addNode("page-workers-node", createPageWorkersGraphNode(context))
    .addNode("repair-page-node", createRepairPageGraphNode(context))
    .addNode("retry-page-node", createRetryPageGraphNode(context))
    .addNode("supervisor-node", createSupervisorGraphNode(context))
    .addNode("mark-failed-node", createMarkFailedGraphNode(context))
    .addNode("finalize-node", createFinalizeGraphNode(context))
    .addEdge(START, "supervisor-node")
    .addConditionalEdges(
      "supervisor-node",
      routeBySupervisor,
      Object.fromEntries(COURSE_GRAPH_ROUTES.map((route) => [route, route])),
    )
    .addEdge("intent-node", "supervisor-node")
    .addEdge("planner-node", "supervisor-node")
    .addEdge("briefs-node", "supervisor-node")
    .addEdge("page-workers-node", "supervisor-node")
    .addEdge("repair-page-node", "supervisor-node")
    .addEdge("retry-page-node", "supervisor-node")
    .addEdge("mark-failed-node", END)
    .addEdge("finalize-node", END)
    .compile();
}
