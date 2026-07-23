import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, createWriteStream } from "node:fs";
import {
  mkdir as mkdirAsync,
  readFile,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

import { chromium, type Page } from "playwright";

import {
  CourseHistoryDetailResponseSchema,
  CourseTaskCreateResponseSchema,
  CourseTaskStreamMessageSchema,
  type CourseTaskStreamMessage,
} from "@/shared/course-schema";

import {
  checkDemoCourse,
  DemoBaselineSchema,
  type DemoBaseline,
  type DemoCheckReport,
} from "./check-course";

const BASELINE_FILES = [
  "mars-exploration.json",
  "solar-system.json",
  "ai-literacy.json",
] as const;
const TASK_TIMEOUT_MS = 45 * 60 * 1_000;
const SERVER_START_TIMEOUT_MS = 3 * 60 * 1_000;

type DemoCaseResult = {
  baselineId: string;
  name: string;
  passed: boolean;
  courseId?: string;
  taskId?: string;
  durationMs: number;
  report?: DemoCheckReport;
  error?: string;
  artifacts: {
    course?: string;
    archive?: string;
    report?: string;
    desktopScreenshot?: string;
    mobileScreenshot?: string;
  };
};

type DemoRunSummary = {
  version: 1;
  runId: string;
  startedAt: string;
  completedAt: string;
  baseUrl: string;
  passed: boolean;
  cases: DemoCaseResult[];
};

async function main() {
  const recordResults = process.argv.slice(2).includes("--record");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const startedAt = new Date().toISOString();
  const rootDir = process.cwd();
  const runDir = path.join(rootDir, ".data", "demo-runs", runId);
  await mkdirAsync(runDir, { recursive: true });

  const externalBaseUrl = process.env.DEMO_BASE_URL?.replace(/\/+$/, "");
  const server = externalBaseUrl
    ? undefined
    : await startLocalServer(rootDir, runDir);
  const baseUrl = externalBaseUrl ?? server!.baseUrl;
  const baselines = await loadBaselines(rootDir);
  const results: DemoCaseResult[] = [];

  try {
    await waitForServer(baseUrl, server?.child);
    for (const baseline of baselines) {
      process.stdout.write(`\n[demo:${baseline.id}] 开始 ${baseline.name}\n`);
      results.push(await runCase({ baseUrl, baseline, runDir }));
    }
  } finally {
    await stopLocalServer(server);
  }

  const summary: DemoRunSummary = {
    version: 1,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl,
    passed: results.every(({ passed }) => passed),
    cases: results,
  };
  const summaryPath = path.join(runDir, "summary.json");
  await writeJson(summaryPath, summary);

  if (recordResults) {
    await recordCuratedResults(rootDir, summary, runDir);
  }

  printSummary(summary, summaryPath);
  if (!summary.passed) process.exitCode = 1;
}

async function runCase(input: {
  baseUrl: string;
  baseline: DemoBaseline;
  runDir: string;
}): Promise<DemoCaseResult> {
  const startedAt = Date.now();
  const caseDir = path.join(input.runDir, input.baseline.id);
  await mkdirAsync(caseDir, { recursive: true });
  let taskId: string | undefined;
  let courseId: string | undefined;

  try {
    const task = await createTask(input.baseUrl, input.baseline);
    taskId = task.taskId;
    courseId = task.courseId;
    process.stdout.write(
      `[demo:${input.baseline.id}] task=${task.taskId} course=${task.courseId}\n`,
    );
    const terminal = await waitForTerminal(input.baseUrl, task.taskId);
    const detail = await getCourse(input.baseUrl, task.courseId);
    const coursePath = path.join(caseDir, "course.json");
    await writeJson(coursePath, detail.course);

    let archiveBytes: Uint8Array | undefined;
    let archivePath: string | undefined;
    if (terminal.status === "completed") {
      archiveBytes = await downloadArchive(input.baseUrl, task.courseId);
      archivePath = path.join(caseDir, `${task.courseId}.zip`);
      await writeFileAsync(archivePath, archiveBytes);
    }

    const report = checkDemoCourse({
      course: detail.course,
      baseline: input.baseline,
      archiveBytes,
    });
    const reportPath = path.join(caseDir, "check-report.json");
    await writeJson(reportPath, report);
    const screenshots =
      terminal.status === "completed"
        ? await captureProductScreenshots(
            input.baseUrl,
            task.courseId,
            caseDir,
          )
        : undefined;

    const passed = report.passed && Boolean(screenshots);
    process.stdout.write(
      `[demo:${input.baseline.id}] ${passed ? "PASS" : "FAIL"} · QA 最低分 ${report.metrics.minimumOverallScore ?? "n/a"} · ${report.issues.length} issues\n`,
    );
    return {
      baselineId: input.baseline.id,
      name: input.baseline.name,
      passed,
      courseId,
      taskId,
      durationMs: Date.now() - startedAt,
      report,
      error: screenshots ? undefined : "未生成产品桌面端和移动端截图。",
      artifacts: {
        course: relativeToRun(input.runDir, coursePath),
        archive: archivePath
          ? relativeToRun(input.runDir, archivePath)
          : undefined,
        report: relativeToRun(input.runDir, reportPath),
        desktopScreenshot: screenshots
          ? relativeToRun(input.runDir, screenshots.desktop)
          : undefined,
        mobileScreenshot: screenshots
          ? relativeToRun(input.runDir, screenshots.mobile)
          : undefined,
      },
    };
  } catch (error) {
    if (taskId) await cancelTask(input.baseUrl, taskId);
    const message = error instanceof Error ? error.message : "未知 Demo 错误";
    await writeJson(path.join(caseDir, "failure.json"), {
      baselineId: input.baseline.id,
      taskId,
      courseId,
      error: message,
      failedAt: new Date().toISOString(),
    });
    process.stdout.write(`[demo:${input.baseline.id}] FAIL · ${message}\n`);
    return {
      baselineId: input.baseline.id,
      name: input.baseline.name,
      passed: false,
      courseId,
      taskId,
      durationMs: Date.now() - startedAt,
      error: message,
      artifacts: {},
    };
  }
}

async function createTask(baseUrl: string, baseline: DemoBaseline) {
  const response = await fetch(`${baseUrl}/api/courses/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userPrompt: baseline.prompt,
      pageCount: baseline.pageCount,
      executionMode: "serial",
      concurrency: 1,
      source: "langgraph",
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`创建任务失败 (${response.status})：${JSON.stringify(payload)}`);
  }
  return CourseTaskCreateResponseSchema.parse(payload);
}

async function waitForTerminal(baseUrl: string, taskId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl}/api/courses/tasks/${encodeURIComponent(taskId)}/events`,
      { headers: { Accept: "text/event-stream" }, signal: controller.signal },
    );
    if (!response.ok || !response.body) {
      throw new Error(`SSE 连接失败：HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const message = parseCourseTaskSseFrame(frame);
        if (message?.type === "terminal") return message;
      }
      if (done) break;
    }
    throw new Error("SSE 在 terminal 消息前结束。");
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`任务超过 ${TASK_TIMEOUT_MS / 60_000} 分钟。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseCourseTaskSseFrame(
  frame: string,
): CourseTaskStreamMessage | undefined {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  return CourseTaskStreamMessageSchema.parse(JSON.parse(data));
}

async function getCourse(baseUrl: string, courseId: string) {
  const response = await fetch(
    `${baseUrl}/api/courses/${encodeURIComponent(courseId)}`,
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`读取课程失败 (${response.status})：${JSON.stringify(payload)}`);
  }
  return CourseHistoryDetailResponseSchema.parse(payload);
}

async function downloadArchive(baseUrl: string, courseId: string) {
  const response = await fetch(
    `${baseUrl}/api/courses/${encodeURIComponent(courseId)}/export`,
  );
  if (!response.ok) {
    throw new Error(
      `导出课程失败 (${response.status})：${await response.text()}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function cancelTask(baseUrl: string, taskId: string) {
  try {
    await fetch(
      `${baseUrl}/api/courses/tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    );
  } catch {
    // 原始失败优先；取消仅用于阻止残留模型或图片调用。
  }
}

async function captureProductScreenshots(
  baseUrl: string,
  courseId: string,
  outputDir: string,
) {
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  try {
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const desktopPage = await desktopContext.newPage();
    collectPageErrors(desktopPage, errors);
    await openCourseDetail(desktopPage, baseUrl, courseId);
    const desktop = path.join(outputDir, "course-detail-desktop.png");
    await desktopPage.screenshot({ path: desktop, fullPage: true });
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    collectPageErrors(mobilePage, errors);
    await openCourseDetail(mobilePage, baseUrl, courseId);
    const overflow = await mobilePage.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    if (overflow > 1) errors.push(`移动端横向溢出 ${overflow}px`);
    const mobile = path.join(outputDir, "course-detail-mobile.png");
    await mobilePage.screenshot({ path: mobile, fullPage: true });
    await mobileContext.close();

    if (errors.length > 0) {
      throw new Error(`产品截图验收失败：${errors.join("；")}`);
    }
    return { desktop, mobile };
  } finally {
    await browser.close();
  }
}

function collectPageErrors(
  page: Page,
  errors: string[],
) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

async function openCourseDetail(
  page: Page,
  baseUrl: string,
  courseId: string,
) {
  await page.goto(`${baseUrl}/course/${encodeURIComponent(courseId)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "导出课程 ZIP" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
}

async function loadBaselines(rootDir: string) {
  return Promise.all(
    BASELINE_FILES.map(async (fileName) => {
      const source = await readFile(
        path.join(rootDir, "docs", "demo", "baselines", fileName),
        "utf8",
      );
      return DemoBaselineSchema.parse(JSON.parse(source));
    }),
  );
}

async function startLocalServer(rootDir: string, runDir: string) {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = path.join(runDir, "server.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        NEXT_DIST_DIR: path.relative(
          rootDir,
          path.join(runDir, "next"),
        ),
        PAGE_QA_SCREENSHOTS_ENABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return { child, baseUrl, log, logPath };
}

async function stopLocalServer(
  server:
    | {
        child: ChildProcess;
        log: ReturnType<typeof createWriteStream>;
      }
    | undefined,
) {
  if (!server) return;
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    await Promise.race([
      once(server.child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  server.log.end();
}

async function waitForServer(baseUrl: string, child?: ChildProcess) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`本地 Next.js 服务提前退出：${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/courses`);
      if (response.ok) return;
    } catch {
      // 服务尚未监听。
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`本地服务在 ${SERVER_START_TIMEOUT_MS / 1_000} 秒内未就绪。`);
}

function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法分配本地 Demo 端口。"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function recordCuratedResults(
  rootDir: string,
  summary: DemoRunSummary,
  runDir: string,
) {
  const targetDir = path.join(rootDir, "docs", "demo", "results", summary.runId);
  await mkdirAsync(targetDir, { recursive: true });
  await writeJson(path.join(targetDir, "summary.json"), summary);

  for (const result of summary.cases) {
    const targetCaseDir = path.join(targetDir, result.baselineId);
    await mkdirAsync(targetCaseDir, { recursive: true });
    for (const key of [
      "report",
      "desktopScreenshot",
      "mobileScreenshot",
    ] as const) {
      const relativePath = result.artifacts[key];
      if (!relativePath) continue;
      await new Promise<void>((resolve, reject) => {
        copyFile(
          path.join(runDir, relativePath),
          path.join(targetCaseDir, path.basename(relativePath)),
          (error) => (error ? reject(error) : resolve()),
        );
      });
    }
    await writeFileAsync(
      path.join(targetCaseDir, "manual-review.md"),
      manualReviewTemplate(result),
      "utf8",
    );
  }
}

function manualReviewTemplate(result: DemoCaseResult) {
  return `# ${result.name} · 人工质量复核

- Course ID: \`${result.courseId ?? "未生成"}\`
- 自动验收: ${result.passed ? "通过" : "未通过"}
- 内容正确性（1–5）：
- 教学连贯性（1–5）：
- 页面排版（1–5）：
- 风格一致性（1–5）：
- HTML/交互可用性（1–5）：
- 素材可用性（1–5）：
- 总分（至少 24/30）：
- 是否存在低于 3 分的单项：
- 复核结论：
- 主要证据：
- 需要改进：
`;
}

function printSummary(summary: DemoRunSummary, summaryPath: string) {
  process.stdout.write(`\nDay 36 Demo ${summary.passed ? "PASS" : "FAIL"}\n`);
  for (const result of summary.cases) {
    process.stdout.write(
      `- ${result.name}: ${result.passed ? "PASS" : "FAIL"} · ${Math.round(result.durationMs / 1_000)}s${result.error ? ` · ${result.error}` : ""}\n`,
    );
  }
  process.stdout.write(`报告：${summaryPath}\n`);
}

function relativeToRun(runDir: string, filePath: string) {
  return path.relative(runDir, filePath);
}

async function writeJson(filePath: string, value: unknown) {
  await writeFileAsync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entryPath === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : "Demo 运行失败。"}\n`,
    );
    process.exitCode = 1;
  });
}
