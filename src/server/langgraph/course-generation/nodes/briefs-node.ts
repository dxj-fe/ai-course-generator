import { createCourseDesignNode } from "@/server/workflows/course-generation-nodes";

import type { CourseGenerationGraphNode } from "../course-state";
import { runGlobalGraphNode } from "./run-global-node";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createBriefsGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return (state) =>
    runGlobalGraphNode(
      state,
      createCourseDesignNode(),
      context,
      (current) =>
        Boolean(
          current.briefs &&
            current.pageWorkerBriefs &&
            current.pages.length > 0,
        ),
    );
}
