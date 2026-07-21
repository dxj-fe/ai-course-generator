import {
  failCourseGeneration,
  requireCourseGenerationValue,
} from "@/server/workflows/course-generation-runtime";
import { runCourseWorkersWorkflow } from "@/server/workflows/course-workers-workflow";

import {
  parseCourseGenerationGraphState,
  toCourseGenerationGraphUpdate,
  type CourseGenerationGraphNode,
} from "../course-state";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createPageWorkersGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return async (graphState) => {
    const state = parseCourseGenerationGraphState(graphState);
    if (
      state.status !== "running" ||
      (state.pages.length > 0 &&
        state.pages.every(({ status }) => status === "completed"))
    ) {
      return toCourseGenerationGraphUpdate(state);
    }

    const result = await runCourseWorkersWorkflow(
      state,
      context.runtime,
      requireCourseGenerationValue(state.workerConfig, "page worker config"),
      context.dependencies,
    );
    const next =
      result.status === "completed"
        ? result.state
        : await failCourseGeneration(
            result.state,
            result.error,
            context.runtime,
            context.dependencies,
            { agent: "page-worker" },
          );
    return toCourseGenerationGraphUpdate(next);
  };
}
