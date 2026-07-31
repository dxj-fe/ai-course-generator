import { normalizeConcurrency } from "@/server/course/run/engine-support";
import { createCourseRunRepository } from "@/server/course/store/repository";
import { projectCourseState } from "@/server/course/projection/state";
import type {
  CourseCreationBrief,
  CourseGenerationState,
  ReferencePack,
} from "@/shared/course-schema";

export type CourseRunStateLoaderInput = {
  taskId: string;
  courseId: string;
  traceId: string;
  creationBrief: CourseCreationBrief;
  referencePacks?: ReferencePack[];
  concurrency?: number;
};

/**
 * 只读投影指定 taskId 的当前 CourseRun，不领取 lease，也不执行 Agent。
 * pause/recovery 用它判断当前 Task 是否已有权威终态。
 */
export function loadCourseGenerationState(
  input: CourseRunStateLoaderInput,
): CourseGenerationState | undefined {
  const repository = createCourseRunRepository();
  const run = repository.runs.loadByTaskId(input.taskId);
  if (!run || run.courseId !== input.courseId) return undefined;

  return projectCourseState({
    run,
    creationBrief: input.creationBrief,
    referencePacks: input.referencePacks,
    workOrders: repository.workOrders.listByTask(input.taskId),
    artifacts: repository.artifacts.listByTask(input.taskId),
    events: repository.events.list(input.taskId),
    workerConfig: {
      mode: "parallel",
      concurrency: normalizeConcurrency(input.concurrency),
    },
  });
}
