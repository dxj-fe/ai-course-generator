import { requireCourseGenerationValue } from "@/server/workflows/course-generation-runtime";
import { runCourseWorkersWorkflow } from "@/server/workflows/course-workers-workflow";

import {
  parseCourseGenerationGraphState,
  toCourseGenerationGraphUpdate,
  type CourseGenerationGraphNode,
} from "../course-state";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createRetryPageGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return async (graphState) => {
    const state = parseCourseGenerationGraphState(graphState);
    const decision = state.supervisor?.lastDecision;
    const pageId =
      decision?.action === "retry" ? decision.nextNode.pageId : undefined;
    if (state.status !== "running" || !pageId) {
      return toCourseGenerationGraphUpdate(state);
    }

    const result = await runCourseWorkersWorkflow(
      state,
      context.runtime,
      requireCourseGenerationValue(state.workerConfig, "page worker config"),
      context.dependencies,
      {
        targetPageId: pageId,
        maxRepairRoundsPerRun: 0,
        pauseAfterBatch: true,
      },
    );
    return toCourseGenerationGraphUpdate(result.state);
  };
}
