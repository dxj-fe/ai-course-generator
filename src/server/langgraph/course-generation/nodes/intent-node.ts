import { createIntentNode } from "@/server/workflows/course-generation-nodes";

import type { CourseGenerationGraphNode } from "../course-state";
import { runGlobalGraphNode } from "./run-global-node";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createIntentGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return (state) =>
    runGlobalGraphNode(state, createIntentNode(), context, (current) =>
      Boolean(current.intent),
    );
}
