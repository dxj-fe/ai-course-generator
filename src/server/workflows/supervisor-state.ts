import {
  appendCourseGenerationEvent,
  checkpointCourseGenerationState,
  type CourseGenerationWorkflowDependencies,
} from "@/server/workflows/course-generation-runtime";
import {
  targetKey,
  type CourseGenerationState,
  type SupervisorDecision,
  type SupervisorNodeTarget,
} from "@/shared/course-schema";

type SupervisorEventTarget = {
  stage: CourseGenerationState["currentStage"];
  pageId?: string;
};

/** 手写与 LangGraph 运行时共享同一份 Supervisor attempt/checkpoint 语义。 */
export async function recordSupervisorDecision(
  state: CourseGenerationState,
  decision: SupervisorDecision,
  eventTarget: SupervisorEventTarget | undefined,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const currentSupervisor = state.supervisor ?? {
    decisionCount: 0,
    attempts: [],
  };
  const target = decisionTarget(decision);
  const attempts = target
    ? incrementAttempt(currentSupervisor.attempts, target)
    : currentSupervisor.attempts;
  const attemptCount = target
    ? attempts.find((attempt) => targetKey(attempt) === targetKey(target))
        ?.attempts
    : undefined;
  const summary = attemptCount
    ? `${decision.reasonSummary}（第 ${attemptCount} 次执行）`
    : decision.reasonSummary;
  const next = appendCourseGenerationEvent(
    {
      ...state,
      supervisor: {
        decisionCount: currentSupervisor.decisionCount + 1,
        attempts,
        lastDecision: decision,
      },
    },
    dependencies.now,
    {
      type: "supervisor_decision",
      stage: eventTarget?.stage ?? state.currentStage,
      pageId: eventTarget?.pageId,
      agent: "supervisor",
      summary,
    },
  );
  return checkpointCourseGenerationState(next, dependencies);
}

function decisionTarget(decision: SupervisorDecision) {
  return decision.action === "run" || decision.action === "retry"
    ? decision.nextNode
    : undefined;
}

function incrementAttempt(
  attempts: NonNullable<CourseGenerationState["supervisor"]>["attempts"],
  target: SupervisorNodeTarget,
) {
  const key = targetKey(target);
  const existing = attempts.find((attempt) => targetKey(attempt) === key);

  if (!existing) return [...attempts, { ...target, attempts: 1 }];
  return attempts.map((attempt) =>
    targetKey(attempt) === key
      ? { ...attempt, attempts: attempt.attempts + 1 }
      : attempt,
  );
}
