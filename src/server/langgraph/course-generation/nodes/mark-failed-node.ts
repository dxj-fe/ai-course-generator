import { failCourseGeneration } from "@/server/workflows/course-generation-runtime";

import {
  parseCourseGenerationGraphState,
  toCourseGenerationGraphUpdate,
  type CourseGenerationGraphNode,
} from "../course-state";
import type { CourseGenerationGraphNodeContext } from "./types";

export function createMarkFailedGraphNode(
  context: CourseGenerationGraphNodeContext,
): CourseGenerationGraphNode {
  return async (graphState) => {
    const state = parseCourseGenerationGraphState(graphState);
    if (state.status === "failed" || state.status === "cancelled") {
      return toCourseGenerationGraphUpdate(state);
    }

    const decision = state.supervisor?.lastDecision;
    const page = state.pages.find(({ status }) => status === "failed") ??
      state.pages.find(({ qualityReport }) => qualityReport?.shouldRepair);
    const message =
      decision?.action === "stop"
        ? decision.stopReason.message
        : page?.error?.message ?? "LangGraph Supervisor 已停止课程生成。";
    // Preserve the concrete Page Worker error so a later explicit resume can
    // re-evaluate retryability after initializeCourseGenerationState resets
    // that stage's local attempt budget. The Supervisor stop reason remains
    // available on supervisor.lastDecision for diagnostics.
    const code =
      page?.error?.code ??
      (decision?.action === "stop"
        ? `SUPERVISOR_${decision.stopReason.code.toUpperCase()}`
        : "SUPERVISOR_STOPPED");
    const next = await failCourseGeneration(
      state,
      {
        stage: page?.currentStage ?? state.currentStage,
        pageId: page?.pageId,
        code,
        causeCode: page?.error?.causeCode,
        message,
      },
      context.runtime,
      context.dependencies,
      { agent: "supervisor" },
    );
    return toCourseGenerationGraphUpdate(next);
  };
}
