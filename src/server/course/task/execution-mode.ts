/**
 * Web 进程默认只负责入队。仅固定 Demo 等明确的单进程场景允许响应后内联执行，
 * 生产与日常开发均由显式 Course Worker 持有 Agent Loop 和浏览器运行时。
 */
export function shouldExecuteCourseTasksInline(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return environment.COURSE_TASK_INLINE_EXECUTION === "1";
}
