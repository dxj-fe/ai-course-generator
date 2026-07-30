import { setTimeout as wait } from "node:timers/promises";

import { getCourseWorkerServices } from "@/server/setup/worker";

const intervalMs = readInteger(
  "COURSE_TASK_WORKER_INTERVAL_MS",
  10_000,
  1_000,
  300_000,
);
const maxTasks = readInteger(
  "COURSE_TASK_WORKER_BATCH_SIZE",
  20,
  1,
  100,
);
const concurrency = readInteger(
  "COURSE_TASK_WORKER_CONCURRENCY",
  2,
  1,
  5,
);
const controller = new AbortController();
const { recovery } = getCourseWorkerServices();

process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

console.info("[course-task-worker] 已启动", {
  intervalMs,
  maxTasks,
  concurrency,
});

while (!controller.signal.aborted) {
  try {
    const report = await recovery.scanOnce({
      maxTasks,
      concurrency,
    });
    if (
      report.candidateTaskIds.length > 0 ||
      report.unavailableTaskCount > 0
    ) {
      console.info("[course-task-worker] 扫描完成", report);
    }
  } catch (error) {
    console.error("[course-task-worker] 扫描失败", error);
  }

  if (controller.signal.aborted) break;
  try {
    await wait(intervalMs, undefined, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
}

console.info("[course-task-worker] 已停止");

function readInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value;
}
