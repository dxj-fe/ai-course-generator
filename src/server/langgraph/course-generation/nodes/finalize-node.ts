import { completeCourseGeneration } from "@/server/workflows/course-generation-runtime";

import {
  parseCourseGenerationGraphState,
  toCourseGenerationGraphUpdate,
  type CourseGenerationGraphNode,
} from "../course-state";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createFinalizeGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return async (graphState) => {
    const state = parseCourseGenerationGraphState(graphState);
    if (state.status !== "running") {
      return toCourseGenerationGraphUpdate(state);
    }

    return toCourseGenerationGraphUpdate(
      await completeCourseGeneration(state, context.dependencies),
    );
  };
}
