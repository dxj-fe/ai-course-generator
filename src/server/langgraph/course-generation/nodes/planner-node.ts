import { createPlannerNode } from "@/server/workflows/course-generation-nodes";

import type { CourseGenerationGraphNode } from "../course-state";
import { runGlobalGraphNode } from "./run-global-node";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createPlannerGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return (state) =>
    runGlobalGraphNode(state, createPlannerNode(), context, (current) =>
      Boolean(current.outline),
    );
}
