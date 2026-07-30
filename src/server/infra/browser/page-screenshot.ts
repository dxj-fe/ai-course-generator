import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import { loadGeneratedAsset } from "@/server/infra/file/generated-asset";
import {
  QualityScreenshotEvidenceSchema,
  type PageContentDSL,
  type QualityIssue,
  type QualityScreenshotEvidence,
} from "@/shared/course-schema";
import {
  buildTrustedLessonSrcDoc,
  sanitizeHtmlLite,
  type TrustedLessonRuntimeConfig,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

import { collectBrowserIssues } from "./page-screenshot-issues";

const QA_VIEWPORTS = [
  { name: "desktop", viewport: { width: 922, height: 460 } },
  { name: "tablet", viewport: { width: 712, height: 650 } },
  { name: "mobile", viewport: { width: 366, height: 500 } },
] as const;
const DEFAULT_TIMEOUT_MS = 12_000;

export type BrowserScreenshotMetrics = NonNullable<
  QualityScreenshotEvidence["metrics"]
>;
type BrowserViewport = QualityScreenshotEvidence["viewport"];
type ScreenshotCapture = NonNullable<
  QualityScreenshotEvidence["captures"]
>[number];

export type BrowserScreenshotSnapshot = {
  png: Uint8Array;
  metrics: BrowserScreenshotMetrics;
};

export type VisualProminenceCandidate = {
  areaRatio: number;
  effectiveOpacity: number;
  hasNegativeLayer: boolean;
  selector: string;
};

export function resolveDominantVisualMetrics(
  candidates: VisualProminenceCandidate[],
): Pick<
  BrowserScreenshotMetrics,
  "largestVisualAreaRatio" | "largestVisualSelector"
> {
  const dominant = candidates.reduce(
    (largest, candidate) => {
      const areaRatio = Math.min(1, Math.max(0, candidate.areaRatio));
      const opacity = Math.min(1, Math.max(0, candidate.effectiveOpacity));
      const prominence = candidate.hasNegativeLayer
        ? 0
        : areaRatio * opacity;
      return prominence > largest.ratio
        ? { ratio: prominence, selector: candidate.selector }
        : largest;
    },
    { ratio: 0, selector: undefined as string | undefined },
  );

  return {
    largestVisualAreaRatio: dominant.ratio,
    ...(dominant.selector
      ? { largestVisualSelector: dominant.selector }
      : {}),
  };
}

export function countAuthoredTouchTargets(
  rects: Array<{ width: number; height: number }>,
  viewportFitScale = 1,
): Pick<
  BrowserScreenshotMetrics,
  "touchTargetUnder24Count" | "touchTargetUnder44Count"
> {
  const scale =
    Number.isFinite(viewportFitScale) && viewportFitScale > 0
      ? Math.min(1, viewportFitScale)
      : 1;
  return {
    touchTargetUnder24Count: rects.filter(
      (rect) => rect.width / scale < 24 || rect.height / scale < 24,
    ).length,
    touchTargetUnder44Count: rects.filter(
      (rect) => rect.width / scale < 44 || rect.height / scale < 44,
    ).length,
  };
}

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
    viewport: BrowserViewport;
    runtimeConfig?: TrustedLessonRuntimeConfig;
  }) => Promise<BrowserScreenshotSnapshot>;
};

type CaptureOutcome = {
  name: (typeof QA_VIEWPORTS)[number]["name"];
  viewport: BrowserViewport;
  snapshot?: BrowserScreenshotSnapshot;
  error?: unknown;
};

/**
 * 在禁用外部网络的浏览器上下文中采集强制 QA 证据。只有通过安全预检的
 * v2 页面会启用平台固定运行时；浏览器与写盘故障会被结构化为质量闸门失败。
 */
export async function capturePageScreenshot(
  input: {
    pageId: string;
    html: string;
    content?: PageContentDSL;
    abortSignal?: AbortSignal;
    traceId?: string;
    attempt?: number;
  },
  options: CapturePageScreenshotOptions = {},
): Promise<PageScreenshotResult> {
  const primaryViewport = QA_VIEWPORTS[0].viewport;
  const enabled =
    options.enabled ?? process.env.PAGE_QA_SCREENSHOTS_ENABLED !== "false";
  if (!enabled) {
    return skipped("截图 QA 已显式关闭。");
  }

  throwIfAborted(input.abortSignal);
  const unsafe = [
    ...validateGeneratedHtmlContract(input.html).issues,
    ...sanitizeHtmlLite(input.html).issues,
  ];
  if (unsafe.length > 0) {
    return skipped("HTML 合同或安全预检未通过，已跳过浏览器渲染。");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const artifactBase = `${safeSegment(input.pageId)}-${crypto.randomUUID()}`;
  const rootDir =
    options.rootDir ?? path.join(".data", "quality-screenshots");
  const capturedAt = (options.now ?? (() => new Date().toISOString()))();
  const runtimeConfig =
    input.content?.version === 2 && input.content.runtime
      ? {
          pageId: input.pageId,
          runtime: input.content.runtime,
          interaction: input.content.interaction,
        }
      : undefined;
  const outcomes = options.captureBrowser
    ? await captureWithInjectedBrowser({
        html: input.html,
        timeoutMs,
        abortSignal: input.abortSignal,
        captureBrowser: options.captureBrowser,
        runtimeConfig,
        pageId: input.pageId,
        traceId: input.traceId,
        attempt: input.attempt,
      })
    : await captureAllWithPlaywright({
        html: input.html,
        timeoutMs,
        abortSignal: input.abortSignal,
        runtimeConfig,
        pageId: input.pageId,
        traceId: input.traceId,
        attempt: input.attempt,
      });
  throwIfAborted(input.abortSignal);

  let storageError: unknown;
  if (outcomes.some(({ snapshot }) => snapshot)) {
    try {
      await mkdir(rootDir, { recursive: true });
    } catch (error) {
      storageError = error;
      logScreenshotError({
        traceId: input.traceId,
        pageId: input.pageId,
        phase: "storage:mkdir",
        attempt: input.attempt,
        code: "SCREENSHOT_STORAGE_PREPARE_FAILED",
        error,
      });
    }
  }

  const captures: ScreenshotCapture[] = [];
  const serverPaths = new Map<string, string>();
  for (const outcome of outcomes) {
    if (!outcome.snapshot || outcome.error || storageError) {
      captures.push(
        failedCapture(outcome.viewport, outcome.error ?? storageError),
      );
      continue;
    }

    const artifactId = `${artifactBase}-${outcome.name}`;
    const serverPath = path.join(
      /*turbopackIgnore: true*/ rootDir,
      `${artifactId}.png`,
    );
    try {
      await writeFile(serverPath, outcome.snapshot.png);
      captures.push({
        status: "captured",
        artifactId,
        viewport: outcome.viewport,
        metrics: outcome.snapshot.metrics,
        capturedAt,
      });
      serverPaths.set(outcome.name, serverPath);
    } catch (error) {
      logScreenshotError({
        traceId: input.traceId,
        pageId: input.pageId,
        phase: "storage:write",
        attempt: input.attempt,
        code: "SCREENSHOT_STORAGE_WRITE_FAILED",
        viewport: outcome.viewport,
        error,
      });
      captures.push(failedCapture(outcome.viewport, error));
    }
  }

  const primary =
    captures[0] ??
    failedCapture(primaryViewport, new Error("未返回桌面截图结果"));
  const evidence = QualityScreenshotEvidenceSchema.parse({
    ...primary,
    captures,
  });
  return {
    evidence,
    issues: captures.flatMap((capture) =>
      collectBrowserIssues(input.pageId, capture, input.content),
    ),
    serverPath: serverPaths.get("desktop"),
  };
}

async function captureWithInjectedBrowser(input: {
  html: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  runtimeConfig?: TrustedLessonRuntimeConfig;
  pageId: string;
  traceId?: string;
  attempt?: number;
  captureBrowser: NonNullable<CapturePageScreenshotOptions["captureBrowser"]>;
}): Promise<CaptureOutcome[]> {
  return Promise.all(
    QA_VIEWPORTS.map(async ({ name, viewport }) => {
      try {
        const snapshot = await withTimeout(
          input.captureBrowser({
            html: input.html,
            timeoutMs: input.timeoutMs,
            viewport,
            runtimeConfig: input.runtimeConfig,
          }),
          input.timeoutMs,
          input.abortSignal,
        );
        return { name, viewport, snapshot };
      } catch (error) {
        if (isAbortError(error)) throw error;
        logScreenshotError({
          traceId: input.traceId,
          pageId: input.pageId,
          phase: "capture",
          attempt: input.attempt,
          code: "SCREENSHOT_CAPTURE_FAILED",
          viewport,
          error,
        });
        return { name, viewport, error };
      }
    }),
  );
}

async function captureAllWithPlaywright(input: {
  html: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  runtimeConfig?: TrustedLessonRuntimeConfig;
  pageId: string;
  traceId?: string;
  attempt?: number;
}): Promise<CaptureOutcome[]> {
  let browser: Browser;
  try {
    browser = await withTimeout(
      chromium.launch({ headless: true }),
      input.timeoutMs,
      input.abortSignal,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    logScreenshotError({
      traceId: input.traceId,
      pageId: input.pageId,
      phase: "browser:launch",
      attempt: input.attempt,
      code: "SCREENSHOT_BROWSER_LAUNCH_FAILED",
      error,
    });
    return QA_VIEWPORTS.map(({ name, viewport }) => ({
      name,
      viewport,
      error,
    }));
  }

  try {
    return await Promise.all(
      QA_VIEWPORTS.map(async ({ name, viewport }) => {
        try {
          const snapshot = await withTimeout(
            captureViewport(browser, {
              html: input.html,
              timeoutMs: input.timeoutMs,
              viewport,
              runtimeConfig: input.runtimeConfig,
              pageId: input.pageId,
              traceId: input.traceId,
              attempt: input.attempt,
            }),
            input.timeoutMs,
            input.abortSignal,
          );
          return { name, viewport, snapshot };
        } catch (error) {
          if (isAbortError(error)) throw error;
          logScreenshotError({
            traceId: input.traceId,
            pageId: input.pageId,
            phase: "capture",
            attempt: input.attempt,
            code: "SCREENSHOT_CAPTURE_FAILED",
            viewport,
            error,
          });
          return { name, viewport, error };
        }
      }),
    );
  } finally {
    await browser.close();
  }
}

async function captureViewport(
  browser: Browser,
  input: {
    html: string;
    timeoutMs: number;
    viewport: BrowserViewport;
    runtimeConfig?: TrustedLessonRuntimeConfig;
    pageId: string;
    traceId?: string;
    attempt?: number;
  },
): Promise<BrowserScreenshotSnapshot> {
  const context = await browser.newContext({
    javaScriptEnabled: Boolean(input.runtimeConfig),
    viewport: input.viewport,
    deviceScaleFactor: 1,
  });
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const assetId = url.pathname.match(/^\/api\/assets\/([^/]+)$/)?.[1];
      if (!assetId) {
        await route.abort();
        return;
      }
      const asset = await loadGeneratedAsset(assetId);
      if (!asset) {
        await route.abort();
        return;
      }
      await route.fulfill({
        body: Buffer.from(asset.bytes),
        contentType: asset.mediaType,
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(input.timeoutMs);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const htmlWithBase = input.html.replace(
      /<head\b([^>]*)>/i,
      '<head$1><base href="http://keya.local/">',
    );
    await page.setContent(
      input.runtimeConfig
        ? buildTrustedLessonSrcDoc(htmlWithBase, input.runtimeConfig)
        : htmlWithBase,
      {
        waitUntil: "domcontentloaded",
        timeout: input.timeoutMs,
      },
    );
    if (input.runtimeConfig) {
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.keyaViewportFitScale !== undefined,
      );
      // Let image/font/resize observers coalesce into the next fitted frame.
      await page.waitForTimeout(32);
    }

    const evaluated = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const viewportFitApplied = root.dataset.keyaViewportFit === "ready";
      const rawViewportFitScale = Number.parseFloat(
        root.dataset.keyaViewportFitScale ?? "1",
      );
      const viewportFitScale =
        viewportFitApplied &&
        Number.isFinite(rawViewportFitScale) &&
        rawViewportFitScale > 0
          ? Math.min(1, rawViewportFitScale)
          : 1;
      const interactiveElements = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href],button,input,select,textarea,[role='button'],[tabindex]",
        ),
      );
      const interactiveRects = interactiveElements.map((element) => {
        const ownRect = element.getBoundingClientRect();
        const labels = (
          element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        ).labels;
        const labelRect = labels?.[0]?.getBoundingClientRect();
        // 原生表单控件关联的 label 整体都可点击，应按真实命中区域评估。
        return labelRect && labelRect.width >= 1 && labelRect.height >= 1
          ? labelRect
          : ownRect;
      });
      const contentElements = Array.from(
        document.querySelectorAll<HTMLElement>("body *"),
      );
      const layoutElements: HTMLElement[] = [
        root,
        ...(body ? [body] : []),
        ...contentElements,
      ];
      const clippedElementCount = layoutElements.filter((element) => {
        if (
          viewportFitApplied &&
          (element === root ||
            element === body ||
            element.dataset.keyaFitExpanded === "true")
        ) {
          return false;
        }
        const style = getComputedStyle(element);
        const clipsX = ["hidden", "clip"].includes(style.overflowX);
        const clipsY = ["hidden", "clip"].includes(style.overflowY);
        return (
          (clipsX && element.scrollWidth > element.clientWidth + 1) ||
          (clipsY && element.scrollHeight > element.clientHeight + 1)
        );
      }).length;
      const nestedVerticalOverflowCount = contentElements.filter((element) => {
        const style = getComputedStyle(element);
        return (
          ["auto", "scroll"].includes(style.overflowY) &&
          element.clientHeight > 0 &&
          element.scrollHeight > element.clientHeight + 1
        );
      }).length;
      const visibleInteractiveRects = interactiveRects.filter(
        (rect) => rect.width >= 1 && rect.height >= 1,
      );
      const navigateRoots = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-interaction-type="navigate"]',
        ),
      );
      const primaryActions = navigateRoots.flatMap((root) => {
        if (root.matches("a[href],button,[role='button']")) return [root];
        return Array.from(
          root.querySelectorAll<HTMLElement>(
            "a[href],button,[role='button']",
          ),
        );
      });
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const lessonRoot = document.querySelector<HTMLElement>(
        "main[data-page-id]",
      );
      const mainViewportCoverageRatio =
        root.dataset.keyaCanvasMode === "fluid" && lessonRoot
          ? viewportFitApplied
            ? 1
            : (() => {
              const rect = lessonRoot.getBoundingClientRect();
              const width = Math.max(
                0,
                Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
              );
              const height = Math.max(
                0,
                Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
              );
              return Math.min(1, (width * height) / viewportArea);
            })()
          : undefined;
      const visibleArea = Array.from(
        document.querySelectorAll<HTMLElement>(
          "main > *, main [data-block-id], main [data-interaction-type]",
        ),
      ).reduce((area, element) => {
        const rect = element.getBoundingClientRect();
        const width = Math.max(
          0,
          Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
        );
        const height = Math.max(
          0,
          Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
        );
        return area + width * height;
      }, 0);
      const stableSelector = (element: HTMLElement) => {
        const segments: string[] = [];
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const assetSlotId = current.getAttribute("data-asset-slot-id");
          if (assetSlotId) {
            segments.unshift(
              `[data-asset-slot-id="${CSS.escape(assetSlotId)}"]`,
            );
            return segments.join(" > ");
          }
          const blockId = current.getAttribute("data-block-id");
          if (blockId) {
            segments.unshift(`[data-block-id="${CSS.escape(blockId)}"]`);
            return segments.join(" > ");
          }
          if (current.id) {
            segments.unshift(`#${CSS.escape(current.id)}`);
            return segments.join(" > ");
          }

          const tagName = current.tagName.toLowerCase();
          const sameTagSiblings = current.parentElement
            ? Array.from(current.parentElement.children).filter(
                (sibling) => sibling.tagName === current!.tagName,
              )
            : [];
          const segment =
            sameTagSiblings.length > 1
              ? `${tagName}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`
              : tagName;
          segments.unshift(segment);
          current = current.parentElement;
        }
        segments.unshift("body");
        return segments.join(" > ");
      };
      const visualCandidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "img,[role='img'],[data-asset-slot-id]",
        ),
      ).map((element) => {
          const rect = element.getBoundingClientRect();
          const width = Math.max(
            0,
            Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
          );
          const height = Math.max(
            0,
            Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
          );
          let effectiveOpacity = 1;
          let hasNegativeLayer = false;
          let current: HTMLElement | null = element;
          while (current) {
            const style = getComputedStyle(current);
            if (
              current.hidden ||
              style.display === "none" ||
              style.visibility === "hidden"
            ) {
              effectiveOpacity = 0;
              break;
            }
            effectiveOpacity *= Number.parseFloat(style.opacity) || 0;
            const zIndex = Number.parseFloat(style.zIndex);
            if (Number.isFinite(zIndex) && zIndex < 0) {
              hasNegativeLayer = true;
              break;
            }
            current = current.parentElement;
          }
          return {
            areaRatio: Math.min(1, (width * height) / viewportArea),
            effectiveOpacity,
            hasNegativeLayer,
            selector: stableSelector(element),
          };
        });
      const feedbackVisibleByDefaultCount = Array.from(
        document.querySelectorAll<HTMLElement>("[data-feedback-kind]"),
      ).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          !element.hidden &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }).length;

      const documentWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
      const documentHeight = Math.max(
        root.scrollHeight,
        body?.scrollHeight ?? 0,
      );
      return {
        viewportFitApplied,
        viewportFitScale,
        documentWidth,
        documentHeight,
        horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
        verticalOverflowPx: Math.max(0, documentHeight - window.innerHeight),
        nestedVerticalOverflowCount,
        clippedElementCount,
        zeroSizeInteractiveCount: interactiveRects.filter(
          (rect) => rect.width < 1 || rect.height < 1,
        ).length,
        visibleInteractiveSizes: visibleInteractiveRects.map((rect) => ({
          width: rect.width,
          height: rect.height,
        })),
        primaryActionBelowFoldCount: primaryActions.filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width < 1 ||
            rect.height < 1 ||
            rect.top < 0 ||
            rect.bottom > window.innerHeight
          );
        }).length,
        feedbackVisibleByDefaultCount,
        mainViewportCoverageRatio,
        visibleContentAreaRatio: Math.min(1, visibleArea / viewportArea),
        visualCandidates,
      };
    });
    const {
      viewportFitApplied,
      viewportFitScale,
      visualCandidates,
      visibleInteractiveSizes,
      ...baseMetrics
    } = evaluated;
    const metrics: BrowserScreenshotMetrics = {
      ...normalizeViewportFitMetrics(
        baseMetrics,
        input.viewport,
        viewportFitApplied,
      ),
      viewportFitScale,
      ...countAuthoredTouchTargets(
        visibleInteractiveSizes,
        viewportFitScale,
      ),
      ...resolveDominantVisualMetrics(visualCandidates),
    };
    const png = await page.screenshot({ type: "png", fullPage: false });
    const interactionMetrics = await exerciseInteraction(
      page,
      input.runtimeConfig,
      {
        traceId: input.traceId,
        pageId: input.pageId,
        attempt: input.attempt,
        viewport: input.viewport,
      },
    );
    return { metrics: { ...metrics, ...interactionMetrics }, png };
  } finally {
    await context.close();
  }
}

/**
 * QA 必须评估学习者实际看到的平台画布，而不是注入 contain-fit 之前的
 * authoring scroll size。原始裁切与互动指标仍保留；平台已完整收纳的文档
 * 尺寸、滚动和 fluid 画布覆盖率按最终视口归一化。
 */
export function normalizeViewportFitMetrics(
  metrics: BrowserScreenshotMetrics,
  viewport: BrowserViewport,
  viewportFitApplied: boolean,
): BrowserScreenshotMetrics {
  if (!viewportFitApplied) return metrics;

  return {
    ...metrics,
    documentWidth: viewport.width,
    documentHeight: viewport.height,
    horizontalOverflowPx: 0,
    verticalOverflowPx: 0,
    nestedVerticalOverflowCount: 0,
    ...(metrics.mainViewportCoverageRatio === undefined
      ? {}
      : { mainViewportCoverageRatio: 1 }),
  };
}

async function exerciseInteraction(
  page: Page,
  runtimeConfig?: TrustedLessonRuntimeConfig,
  diagnostics?: {
    traceId?: string;
    pageId: string;
    attempt?: number;
    viewport: BrowserViewport;
  },
): Promise<
  Pick<
    BrowserScreenshotMetrics,
    "interactionSubmitTested" | "interactionFeedbackVisible"
  >
> {
  if (runtimeConfig?.interaction.type !== "choice") return {};

  const firstControl = page
    .locator(
      '[data-interaction-type="choice"] input[type="radio"],[data-interaction-type="choice"] input[type="checkbox"]',
    )
    .first();
  const submit = page
    .locator(
      '[data-interaction-type="choice"] [data-runtime-submit="true"]',
    )
    .first();
  if ((await firstControl.count()) === 0 || (await submit.count()) === 0) {
    return {
      interactionSubmitTested: false,
      interactionFeedbackVisible: false,
    };
  }

  try {
    await firstControl.check();
    await submit.click();
    const feedback = page
      .locator('[data-interaction-type="choice"] [data-keya-runtime-feedback]')
      .first();
    return {
      interactionSubmitTested: true,
      interactionFeedbackVisible:
        (await feedback.count()) > 0 && (await feedback.isVisible()),
    };
  } catch (error) {
    if (diagnostics) {
      logScreenshotError({
        traceId: diagnostics.traceId,
        pageId: diagnostics.pageId,
        phase: "interaction",
        attempt: diagnostics.attempt,
        code: "SCREENSHOT_INTERACTION_FAILED",
        viewport: diagnostics.viewport,
        error,
      });
    }
    return {
      interactionSubmitTested: false,
      interactionFeedbackVisible: false,
    };
  }
}

function logScreenshotError(input: {
  traceId?: string;
  pageId: string;
  phase: "browser:launch" | "capture" | "interaction" | "storage:mkdir" | "storage:write";
  attempt?: number;
  code: string;
  viewport?: BrowserViewport;
  error: unknown;
}) {
  const original = serializeError(input.error);
  console.error("[page-qa-browser]", {
    event: "screenshot:error",
    traceId: input.traceId ?? "unavailable",
    pageId: input.pageId,
    stage: "qa",
    attempt: input.attempt ?? 1,
    phase: input.phase,
    code: input.code,
    message: original.message,
    ...(input.viewport
      ? { viewport: `${input.viewport.width}x${input.viewport.height}` }
      : {}),
    errorName: original.name,
    errorMessage: original.message,
    errorStack: original.stack,
  });
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: typeof error,
    message: String(error),
    stack: undefined,
  };
}

function skipped(reason: string): PageScreenshotResult {
  const captures: ScreenshotCapture[] = QA_VIEWPORTS.map(({ viewport }) => ({
    status: "skipped",
    viewport,
    reason,
  }));
  return {
    evidence: QualityScreenshotEvidenceSchema.parse({
      status: "skipped",
      viewport: QA_VIEWPORTS[0].viewport,
      reason,
      captures,
    }),
    issues: [],
  };
}

function failedCapture(
  viewport: BrowserViewport,
  error: unknown,
): ScreenshotCapture {
  const reason = error instanceof Error ? error.message : "未知截图错误";
  const unavailable = /executable.*doesn.t exist|browser.*not found/i.test(reason);
  return {
    status: unavailable ? "skipped" : "failed",
    viewport,
    reason: unavailable
      ? "Playwright Chromium 不可用，已跳过浏览器证据。"
      : `截图 QA 失败：${reason}`.slice(0, 300),
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
