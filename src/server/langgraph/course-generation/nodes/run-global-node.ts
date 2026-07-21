import type { CourseGenerationNode } from "@/server/workflows/course-generation-nodes";
import {
  failCourseGenerationNode,
  runCourseGenerationNodes,
} from "@/server/workflows/course-generation-runtime";
import type { CourseGenerationState } from "@/shared/course-schema";

import {
  parseCourseGenerationGraphState,
  toCourseGenerationGraphUpdate,
  type CourseGenerationGraphState,
} from "../course-state";
import type { CourseGenerationGraphNodeContext } from "./types";

export async function runGlobalGraphNode(
  graphState: CourseGenerationGraphState,
  node: CourseGenerationNode,
  context: CourseGenerationGraphNodeContext,
  isAlreadyComplete: (state: CourseGenerationState) => boolean,
) {
  const state = parseCourseGenerationGraphState(graphState);
  if (state.status !== "running" || isAlreadyComplete(state)) {
    return toCourseGenerationGraphUpdate(state);
  }

  const result = await runCourseGenerationNodes(
    state,
    [node],
    context.input,
    context.runtime,
    context.dependencies,
  );
  const next =
    result.status === "completed"
      ? result.state
      : await failCourseGenerationNode(
          result,
          [node],
          context.runtime,
          context.dependencies,
        );
  return toCourseGenerationGraphUpdate(next);
}
