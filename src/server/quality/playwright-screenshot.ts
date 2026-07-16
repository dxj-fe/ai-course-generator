import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import {
  QualityScreenshotEvidenceSchema,
  type QualityIssue,
  type QualityScreenshotEvidence,
} from "@/shared/course-schema";
import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const;
const DEFAULT_TIMEOUT_MS = 12_000;

export type BrowserScreenshotMetrics = NonNullable<
  QualityScreenshotEvidence["metrics"]
>;

export type BrowserScreenshotSnapshot = {
  png: Uint8Array;
  metrics: BrowserScreenshotMetrics;
};

export type PageScreenshotResult = {
  evidence: QualityScreenshotEvidence;
  issues: QualityIssue[];
  /** 只供服务器日志和测试使用，不能进入共享 QualityReport。 */
  serverPath?: string;
};

type CapturePageScreenshotOptions = {
  enabled?: boolean;
  rootDir?: string;
  timeoutMs?: number;
  now?: () => string;
  captureBrowser?: (input: {
    html: string;
    timeoutMs: number;
    viewport: typeof DEFAULT_VIEWPORT;
  }) => Promise<BrowserScreenshotSnapshot>;
};

/**
 * 在禁用脚本和外部网络的浏览器上下文中采集可选 QA 证据。
 * 浏览器缺失、超时和写盘失败都被结构化记录，不会让页面主流程失败。
 */
export async function capturePageScreenshot(
  input: { pageId: string; html: string; abortSignal?: AbortSignal },
  options: CapturePageScreenshotOptions = {},
): Promise<PageScreenshotResult> {
  const viewport = DEFAULT_VIEWPORT;
  const enabled =
    options.enabled ?? process.env.PAGE_QA_SCREENSHOTS_ENABLED === "true";
  if (!enabled) {
    return skipped("截图 QA 未启用。", viewport);
  }

  throwIfAborted(input.abortSignal);
  const unsafe = [
    ...validateGeneratedHtmlContract(input.html).issues,
    ...sanitizeHtmlLite(input.html).issues,
  ];
  if (unsafe.length > 0) {
    return skipped("HTML 合同或安全预检未通过，已跳过浏览器渲染。", viewport);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const artifactId = `${safeSegment(input.pageId)}-${crypto.randomUUID()}`;
  const rootDir =
    options.rootDir ?? path.join(process.cwd(), ".data", "quality-screenshots");
  const serverPath = path.join(rootDir, `${artifactId}.png`);

  try {
    const snapshot = await withTimeout(
      (options.captureBrowser ?? captureWithPlaywright)({
        html: input.html,
        timeoutMs,
        viewport,
      }),
      timeoutMs,
      input.abortSignal,
    );
    throwIfAborted(input.abortSignal);
    await mkdir(rootDir, { recursive: true });
    await writeFile(serverPath, snapshot.png);
    const evidence = QualityScreenshotEvidenceSchema.parse({
      status: "captured",
      artifactId,
      viewport,
      metrics: snapshot.metrics,
      capturedAt: (options.now ?? (() => new Date().toISOString()))(),
    });
    return {
      evidence,
      issues: browserIssues(input.pageId, evidence),
      serverPath,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const reason = error instanceof Error ? error.message : "未知截图错误";
    const unavailable = /executable.*doesn.t exist|browser.*not found/i.test(reason);
    return {
      evidence: QualityScreenshotEvidenceSchema.parse({
        status: unavailable ? "skipped" : "failed",
        viewport,
        reason: unavailable
          ? "Playwright Chromium 不可用，已跳过浏览器证据。"
          : `截图 QA 失败：${reason}`.slice(0, 300),
      }),
      issues: [],
    };
  }
}

async function captureWithPlaywright(input: {
  html: string;
  timeoutMs: number;
  viewport: typeof DEFAULT_VIEWPORT;
}): Promise<BrowserScreenshotSnapshot> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: input.viewport,
      deviceScaleFactor: 1,
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(input.timeoutMs);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(input.html, {
      waitUntil: "domcontentloaded",
      timeout: input.timeoutMs,
    });

    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const clippedElementCount = Array.from(
        document.querySelectorAll<HTMLElement>("body *"),
      ).filter((element) => {
        const style = getComputedStyle(element);
        const clipsX = ["hidden", "clip"].includes(style.overflowX);
        const clipsY = ["hidden", "clip"].includes(style.overflowY);
        return (
          (clipsX && element.scrollWidth > element.clientWidth + 1) ||
          (clipsY && element.scrollHeight > element.clientHeight + 1)
        );
      }).length;
      const zeroSizeInteractiveCount = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href],button,input,select,textarea,[role='button'],[tabindex]",
        ),
      ).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 1 || rect.height < 1;
      }).length;

      return {
        documentWidth: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
        documentHeight: Math.max(root.scrollHeight, body?.scrollHeight ?? 0),
        horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
        clippedElementCount,
        zeroSizeInteractiveCount,
      };
    });
    const png = await page.screenshot({ type: "png", fullPage: false });
    return { metrics, png };
  } finally {
    await browser.close();
  }
}

function browserIssues(
  pageId: string,
  evidence: QualityScreenshotEvidence,
): QualityIssue[] {
  if (evidence.status !== "captured" || !evidence.metrics) return [];
  const location = {
    pageId,
    viewport: `${evidence.viewport.width}x${evidence.viewport.height}`,
    description: "Playwright 固定视口渲染结果",
  };
  const issues: QualityIssue[] = [];
  if (evidence.metrics.horizontalOverflowPx > 0) {
    issues.push({
      code: "BROWSER_HORIZONTAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面产生 ${evidence.metrics.horizontalOverflowPx}px 横向溢出。`,
      location,
      repairHint: "移除超出视口的固定宽度，使用响应式宽度后重新截图验证。",
    });
  }
  if (evidence.metrics.clippedElementCount > 0) {
    issues.push({
      code: "BROWSER_CONTENT_CLIPPED",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.clippedElementCount} 个元素存在可测量的内容裁切。`,
      location,
      repairHint: "检查 overflow 与固定高度，确保正文和交互内容完整可见。",
    });
  }
  if (evidence.metrics.zeroSizeInteractiveCount > 0) {
    issues.push({
      code: "BROWSER_ZERO_SIZE_INTERACTIVE",
      dimension: "htmlRuntime",
      severity: "warning",
      source: "browser",
      message: `${evidence.metrics.zeroSizeInteractiveCount} 个交互元素没有可见尺寸。`,
      location,
      repairHint: "为交互控件提供可见尺寸和明确标签，或移除不可操作的隐藏控件。",
    });
  }
  return issues;
}

function skipped(
  reason: string,
  viewport: typeof DEFAULT_VIEWPORT,
): PageScreenshotResult {
  return {
    evidence: QualityScreenshotEvidenceSchema.parse({
      status: "skipped",
      viewport,
      reason,
    }),
    issues: [],
  };
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 70) || "page";
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Playwright 截图超过 ${timeoutMs}ms。`));
    }, timeoutMs);
    const abort = () => reject(new DOMException("操作已取消。", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    });
  });
}
