import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  mkdir as mkdirAsync,
  readFile,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { chromium, type Page } from "playwright";

import {
  getImageModelConfig,
  getModelConfig,
} from "@/config/env";
import type { ModelTier } from "@/server/infra/ai/model-router";
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

const DEMO_BASELINES = [
  { id: "mars-exploration", fileName: "mars-exploration.json" },
  { id: "solar-system", fileName: "solar-system.json" },
  { id: "ai-literacy", fileName: "ai-literacy.json" },
] as const;
const MODEL_TIERS: ModelTier[] = ["cheap", "balanced", "strong"];
const TASK_TIMEOUT_MS = 45 * 60 * 1_000;
const SERVER_START_TIMEOUT_MS = 3 * 60 * 1_000;

type DemoCliOptions = {
  caseIds: string[];
};

type ProviderConfig = {
  apiKey: string;
  baseURL: string;
  modelName: string;
  providerName: string;
};

type NamedProviderConfig = {
  label: string;
  config: ProviderConfig;
};

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
  runId: string;
  startedAt: string;
  completedAt: string;
  baseUrl: string;
  passed: boolean;
  cases: DemoCaseResult[];
};

async function main() {
  const options = parseDemoCliOptions(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const startedAt = new Date().toISOString();
  const rootDir = process.cwd();
  loadEnvConfig(rootDir, true);

  const externalBaseUrl = process.env.DEMO_BASE_URL?.replace(/\/+$/, "");
  if (!externalBaseUrl) assertLocalDemoProviderConfig();

  const baselines = await loadBaselines(rootDir, options.caseIds);
  const runDir = path.join(rootDir, ".data", "demo-runs", runId);
  await mkdirAsync(runDir, { recursive: true });
  const server = externalBaseUrl
    ? undefined
    : await startLocalServer(rootDir, runDir);
  const baseUrl = externalBaseUrl ?? server!.baseUrl;
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
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl,
    passed: results.every(({ passed }) => passed),
    cases: results,
  };
  const summaryPath = path.join(runDir, "summary.json");
  await writeJson(summaryPath, summary);

  printSummary(summary, summaryPath);
  if (!summary.passed) process.exitCode = 1;
}

export function parseDemoCliOptions(args: string[]): DemoCliOptions {
  const caseIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--case") {
      const caseId = args[index + 1];
      if (!caseId || caseId.startsWith("--")) {
        throw new Error("--case 后必须提供固定 Demo ID。");
      }
      caseIds.push(caseId);
      index += 1;
      continue;
    }
    throw new Error(`未知 Demo 参数：${argument}`);
  }

  const uniqueCaseIds = [...new Set(caseIds)];
  const supportedCaseIds = new Set<string>(
    DEMO_BASELINES.map(({ id }) => id),
  );
  const unknownCaseIds = uniqueCaseIds.filter((id) => !supportedCaseIds.has(id));
  if (unknownCaseIds.length > 0) {
    throw new Error(
      `未知固定 Demo：${unknownCaseIds.join(", ")}。可选值：${[...supportedCaseIds].join(", ")}。`,
    );
  }
  return { caseIds: uniqueCaseIds };
}

export function findProviderConfigIssues(configs: NamedProviderConfig[]) {
  const issues: string[] = [];

  for (const { label, config } of configs) {
    if (looksLikePlaceholder(config.apiKey)) {
      issues.push(`${label} 的 API Key 仍是占位值。`);
    }
    if (looksLikePlaceholder(config.modelName)) {
      issues.push(`${label} 的模型 ID 仍是占位值。`);
    }
    if (!isUsableProviderUrl(config.baseURL)) {
      issues.push(`${label} 的 Base URL 无效或仍是占位地址。`);
    }
  }

  return issues;
}

function assertLocalDemoProviderConfig() {
  const configs: NamedProviderConfig[] = [];
  const issues: string[] = [];

  for (const tier of MODEL_TIERS) {
    try {
      configs.push({
        label: `文本模型 ${tier}`,
        config: getModelConfig(tier),
      });
    } catch (error) {
      issues.push(`文本模型 ${tier} 配置不完整：${configErrorMessage(error)}`);
    }
  }

  try {
    configs.push({
      label: "图片模型",
      config: getImageModelConfig(),
    });
  } catch (error) {
    issues.push(`图片模型配置不完整：${configErrorMessage(error)}`);
  }

  issues.push(...findProviderConfigIssues(configs));
  if (issues.length === 0) return;

  throw new Error(
    [
      "Demo Provider 预检失败，未启动服务，也未发送外部请求：",
      ...issues.map((issue) => `- ${issue}`),
      "请在 .env.local 或 .env 中配置真实 Provider；若复用 Ark 生图，请删除或留空全部 IMAGE_* 覆盖项。",
    ].join("\n"),
  );
}

function looksLikePlaceholder(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized.startsWith("<") ||
    normalized.includes("placeholder") ||
    normalized.includes("replace_me") ||
    normalized.includes("replace-me") ||
    normalized.includes("changeme") ||
    normalized.includes("your_") ||
    normalized.includes("your-") ||
    normalized.includes("your ")
  );
}

function isUsableProviderUrl(value: string) {
  if (looksLikePlaceholder(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.hostname.includes("example") &&
      !parsed.hostname.includes("your-")
    );
  } catch {
    return false;
  }
}

function configErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "缺少必需环境变量。";
  const match = error.message.match(
    /Missing required environment variable: ([A-Z0-9_]+)/,
  );
  return match ? `缺少 ${match[1]}。` : "配置格式不正确。";
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
      `[demo:${input.baseline.id}] ${passed ? "PASS" : "FAIL"} · 整课首轮 ${report.metrics.courseFirstPassAccepted ? "是" : "否"} · 架构尝试 ${report.metrics.architectureAttempts} 次 · 模型页面首轮 ${(report.metrics.modelFirstPassAcceptanceRate * 100).toFixed(0)}% · 模型 HTML ${(report.metrics.modelRenderRate * 100).toFixed(0)}% · 素材 ready ${(report.metrics.assetReadyRate * 100).toFixed(0)}% · Repair ${report.metrics.repairAttemptCount} 次 · 综合分 ${report.metrics.compositeScore} · ${report.issues.length} issues · ${report.warnings.length} warnings\n`,
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
    body: JSON.stringify(buildDemoTaskInput(baseline)),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`创建任务失败 (${response.status})：${JSON.stringify(payload)}`);
  }
  return CourseTaskCreateResponseSchema.parse(payload);
}

export function buildDemoTaskInput(baseline: DemoBaseline) {
  return {
    userPrompt: baseline.prompt,
    creationBrief: {
      originalRequest: baseline.prompt,
      topic: baseline.name,
      audience: "原始课程要求中指定的学习者",
      goal: `完成“${baseline.name}”课程目标，并通过课程中的可观察练习证明理解。`,
      sectionCount: baseline.pageCount,
      learningMode: "mixed" as const,
      language: "zh-CN" as const,
    },
    pageCount: baseline.pageCount,
    executionMode: "parallel" as const,
    concurrency: 1,
  };
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
  // 课程详情页当前是学习播放器，ZIP 已由 API 在截图前单独验收。
  // 截图只等待播放器的稳定产品锚点，避免依赖聊天工作区里的导出按钮文案。
  await page.locator('[aria-label="课程画布"]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
}

async function loadBaselines(rootDir: string, caseIds: string[]) {
  const selectedIds = new Set(caseIds);
  const selected =
    selectedIds.size === 0
      ? DEMO_BASELINES
      : DEMO_BASELINES.filter(({ id }) => selectedIds.has(id));

  return Promise.all(
    selected.map(async ({ fileName }) => {
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
      env: buildDemoServerEnvironment(rootDir),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return { child, baseUrl, log, logPath };
}

export function buildDemoServerEnvironment(
  rootDir: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
) {
  return {
    ...baseEnvironment,
    NEXT_DIST_DIR: path.relative(
      rootDir,
      path.join(rootDir, ".data", "demo-next"),
    ),
    // 固定 Demo 只验证本次创建的 Task，不能顺带恢复数据库中的历史任务。
    COURSE_TASK_STARTUP_RECOVERY: "0",
    PAGE_QA_SCREENSHOTS_ENABLED: "true",
    // Demo 构建目录位于项目内；强制轮询避免 Watchpack 为缓存树打开过多句柄。
    WATCHPACK_POLLING: "true",
  } satisfies NodeJS.ProcessEnv;
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

function printSummary(summary: DemoRunSummary, summaryPath: string) {
  process.stdout.write(`\nDemo ${summary.passed ? "PASS" : "FAIL"}\n`);
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
