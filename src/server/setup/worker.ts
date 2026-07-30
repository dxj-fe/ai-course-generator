import { createCourseTaskRecoveryScanner } from "@/server/course/task/recovery";
import { getWebServices } from "@/server/setup/web";

export type CourseWorkerServices = Readonly<{
  recovery: ReturnType<typeof createCourseTaskRecoveryScanner>;
}>;

export function createCourseWorkerServices(): CourseWorkerServices {
  const tasks = getWebServices().courseTasks;
  return Object.freeze({
    recovery: createCourseTaskRecoveryScanner({
      runTask: (taskId) => tasks.run(taskId),
      cancelTask: (taskId) => tasks.cancel(taskId),
      reconcileTask: (taskId) => tasks.reconcile(taskId),
    }),
  });
}

const workerServicesGlobal = globalThis as typeof globalThis & {
  __keyaCourseWorkerServices?: CourseWorkerServices;
};

export function getCourseWorkerServices() {
  return (
    workerServicesGlobal.__keyaCourseWorkerServices ??=
      createCourseWorkerServices()
  );
}
