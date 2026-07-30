/**
 * Next 进程启动时只做一次恢复扫描，不启动隐藏轮询器。
 * 常驻恢复由 `npm run worker:course` 显式承担；无常驻进程的平台仍需外部调度。
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.COURSE_TASK_STARTUP_RECOVERY === "0"
  ) {
    return;
  }

  const { getCourseWorkerServices } = await import(
    "@/server/setup/worker"
  );
  const { recovery } = getCourseWorkerServices();
  const startupGlobal = globalThis as typeof globalThis & {
    __keyaCourseTaskStartupRecovery?: Promise<void>;
  };
  if (startupGlobal.__keyaCourseTaskStartupRecovery) return;

  startupGlobal.__keyaCourseTaskStartupRecovery = recovery
    .scanOnce()
    .then((report) => {
      if (
        report.candidateTaskIds.length === 0 &&
        report.unavailableTaskCount === 0
      ) {
        return;
      }
      console.info("[course-task-recovery] Next 启动扫描完成", report);
    })
    .catch((error: unknown) => {
      console.error("[course-task-recovery] Next 启动扫描失败", error);
    });
}
