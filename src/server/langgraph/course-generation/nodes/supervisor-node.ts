import { recordSupervisorDecision } from "@/server/workflows/supervisor-state";

import {
  parseCourseGenerationGraphState,
  toCourseGenerationGraphUpdate,
  type CourseGenerationGraphNode,
} from "../course-state";
import {
  decideCourseGraphSupervisor,
  supervisorEventTarget,
} from "../supervisor-routing";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createSupervisorGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return async (graphState) => {
    const state = parseCourseGenerationGraphState(graphState);
    const decision = decideCourseGraphSupervisor(state);
    const next = await recordSupervisorDecision(
      state,
      decision,
      supervisorEventTarget(state, decision),
      context.dependencies,
    );
    return toCourseGenerationGraphUpdate(next);
  };
}
