import { setTimeout as wait } from "node:timers/promises";

import { loadEnvConfig } from "@next/env";

import { getCourseWorkerServices } from "@/server/setup/worker";
import { closeCourseBrowser } from "@/server/infra/browser/browser-pool";
import { ensureCourseGenerationRuntimeReady } from "@/server/course/runtime/readiness";

loadEnvConfig(process.cwd(), true);

void main().catch((error: unknown) => {
  console.error("[course-task-worker] 启动失败", error);
  process.exitCode = 1;
});

async function main() {
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

let runtimeStatus: "unknown" | "ready" | "unavailable" = "unknown";

while (!controller.signal.aborted) {
  try {
    const readiness = await ensureCourseGenerationRuntimeReady();
    if (runtimeStatus !== "ready") {
      console.info(
        runtimeStatus === "unavailable"
          ? "[course-task-worker] 生课运行时已恢复"
          : "[course-task-worker] 生课运行时已就绪",
        readiness,
      );
    }
    runtimeStatus = "ready";
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
    if (runtimeStatus !== "unavailable") {
      console.error("[course-task-worker] 生课运行时不可用，暂停领取任务", error);
    }
    runtimeStatus = "unavailable";
  }

  if (controller.signal.aborted) break;
  try {
    await wait(intervalMs, undefined, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
}

await closeCourseBrowser();
console.info("[course-task-worker] 已停止");
}

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
