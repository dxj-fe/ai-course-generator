import { spawn } from "node:child_process";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true);

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  throw new Error("运行模式必须是 dev 或 start。");
}

const nextArguments = [mode, ...process.argv.slice(3)];
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  COURSE_TASK_INLINE_EXECUTION: "0",
  COURSE_TASK_STARTUP_RECOVERY: "0",
};
if (mode === "dev" && !environment.WATCHPACK_POLLING) {
  environment.WATCHPACK_POLLING = "true";
}

const web = spawnPackage(["exec", "next", ...nextArguments], environment);
const worker = spawnPackage(
  ["exec", "tsx", "scripts/course-task-worker.ts"],
  environment,
);
const children = [web, worker];
let stopping = false;

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

for (const child of children) {
  child.once("exit", (code, signal) => {
    if (stopping) return;
    stopping = true;
    for (const sibling of children) {
      if (sibling !== child && sibling.exitCode === null) sibling.kill("SIGTERM");
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

function spawnPackage(arguments_: string[], env: NodeJS.ProcessEnv) {
  return spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", arguments_, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
}

function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}
