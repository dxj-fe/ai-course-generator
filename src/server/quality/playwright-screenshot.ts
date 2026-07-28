import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import { loadGeneratedAsset } from "@/server/assets/generated-asset-store";
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
      })
    : await captureAllWithPlaywright({
        html: input.html,
        timeoutMs,
        abortSignal: input.abortSignal,
        runtimeConfig,
      });
  throwIfAborted(input.abortSignal);

  let storageError: unknown;
  if (outcomes.some(({ snapshot }) => snapshot)) {
    try {
      await mkdir(rootDir, { recursive: true });
    } catch (error) {
      storageError = error;
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
      browserIssues(input.pageId, capture),
    ),
    serverPath: serverPaths.get("desktop"),
  };
}

async function captureWithInjectedBrowser(input: {
  html: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  runtimeConfig?: TrustedLessonRuntimeConfig;
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
            }),
            input.timeoutMs,
            input.abortSignal,
          );
          return { name, viewport, snapshot };
        } catch (error) {
          if (isAbortError(error)) throw error;
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
        documentWidth,
        documentHeight,
        horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
        verticalOverflowPx: Math.max(0, documentHeight - window.innerHeight),
        nestedVerticalOverflowCount,
        clippedElementCount,
        zeroSizeInteractiveCount: interactiveRects.filter(
          (rect) => rect.width < 1 || rect.height < 1,
        ).length,
        touchTargetUnder24Count: visibleInteractiveRects.filter(
          (rect) => rect.width < 24 || rect.height < 24,
        ).length,
        touchTargetUnder44Count: visibleInteractiveRects.filter(
          (rect) => rect.width < 44 || rect.height < 44,
        ).length,
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
    const { viewportFitApplied, visualCandidates, ...baseMetrics } = evaluated;
    const metrics: BrowserScreenshotMetrics = {
      ...normalizeViewportFitMetrics(
        baseMetrics,
        input.viewport,
        viewportFitApplied,
      ),
      ...resolveDominantVisualMetrics(visualCandidates),
    };
    const png = await page.screenshot({ type: "png", fullPage: false });
    const interactionMetrics = await exerciseInteraction(
      page,
      input.runtimeConfig,
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
  } catch {
    return {
      interactionSubmitTested: false,
      interactionFeedbackVisible: false,
    };
  }
}

function browserIssues(
  pageId: string,
  evidence: ScreenshotCapture,
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
  const verticalOverflowPx =
    evidence.metrics.verticalOverflowPx ??
    Math.max(0, evidence.metrics.documentHeight - evidence.viewport.height);
  if (verticalOverflowPx > 0) {
    issues.push({
      code: "BROWSER_VERTICAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面产生 ${verticalOverflowPx}px 纵向溢出。`,
      location,
      repairHint:
        "压缩单页内容或在规划阶段拆分页面，确保全部教学内容在固定播放器画布内完整可见。",
    });
  }
  if ((evidence.metrics.nestedVerticalOverflowCount ?? 0) > 0) {
    issues.push({
      code: "BROWSER_NESTED_VERTICAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.nestedVerticalOverflowCount} 个嵌套区域产生纵向滚动。`,
      location: {
        ...location,
        description: "播放器画布中的嵌套滚动区域",
      },
      repairHint:
        "移除正文或互动容器的 overflow-y 滚动，将超出单页容量的内容拆到相邻页面。",
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
  if ((evidence.metrics.primaryActionBelowFoldCount ?? 0) > 0) {
    issues.push({
      code: "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.primaryActionBelowFoldCount} 个课程主操作未完整出现在播放器首屏内。`,
      location: {
        ...location,
        selector: '[data-interaction-type="navigate"]',
        description: "播放器首屏中的课程导航主操作",
      },
      repairHint:
        "压缩首屏装饰、标题或重复信息，让核心说明与主操作在当前播放器视口完整可见。",
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
  if ((evidence.metrics.touchTargetUnder24Count ?? 0) > 0) {
    issues.push({
      code: "BROWSER_TOUCH_TARGET_UNDER_24",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.touchTargetUnder24Count} 个可见交互控件小于 24×24px。`,
      location,
      repairHint: "将可点击区域的宽高都扩大到至少 24px，并保留清晰的控件间距。",
    });
  }
  if ((evidence.metrics.touchTargetUnder44Count ?? 0) > 0) {
    issues.push({
      code: "BROWSER_TOUCH_TARGET_UNDER_44",
      dimension: "htmlRuntime",
      severity: "warning",
      source: "browser",
      message: `${evidence.metrics.touchTargetUnder44Count} 个可见交互控件小于建议的 44×44px。`,
      location,
      repairHint: "优先将触控目标扩大到 44×44px，尤其是移动端的主要操作。",
    });
  }
  if ((evidence.metrics.feedbackVisibleByDefaultCount ?? 0) > 0) {
    issues.push({
      code: "BROWSER_FEEDBACK_VISIBLE_BY_DEFAULT",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.feedbackVisibleByDefaultCount} 个答题反馈在提交前已经可见。`,
      location: {
        ...location,
        selector: "[data-feedback-kind]",
        description: "测验的初始反馈状态",
      },
      repairHint: "为成功与重试反馈添加 hidden，并只由可信运行时在提交后显示。",
    });
  }
  if (evidence.metrics.interactionSubmitTested === false) {
    issues.push({
      code: "BROWSER_INTERACTION_SUBMIT_UNTESTED",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: "浏览器无法完成选择题提交动作。",
      location: {
        ...location,
        selector: '[data-runtime-submit="true"]',
        description: "选择题提交控件",
      },
      repairHint: "提供可点击的提交按钮和可选择的原生控件，并重新执行浏览器测试。",
    });
  }
  if (
    evidence.metrics.interactionSubmitTested === true &&
    evidence.metrics.interactionFeedbackVisible === false
  ) {
    issues.push({
      code: "BROWSER_INTERACTION_FEEDBACK_MISSING",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: "选择题提交后没有出现文字反馈。",
      location: {
        ...location,
        selector: "[data-keya-runtime-feedback]",
        description: "可信运行时答题反馈区域",
      },
      repairHint: "检查 option ID、提交标记与运行时配置，确保提交后显示解释性文字反馈。",
    });
  }
  if ((evidence.metrics.largestVisualAreaRatio ?? 0) > 0.7) {
    issues.push({
      code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
      dimension: "assetUsability",
      severity: "error",
      source: "browser",
      message: `单个视觉素材占据约 ${Math.round((evidence.metrics.largestVisualAreaRatio ?? 0) * 100)}% 的首屏面积。`,
      location: {
        ...location,
        ...(evidence.metrics.largestVisualSelector
          ? { selector: evidence.metrics.largestVisualSelector }
          : {}),
        description: "播放器首屏中占比最大的可见视觉素材",
      },
      repairHint: "缩小或裁切素材，把标题、核心解释和学习动作放回首屏主焦点。",
    });
  }
  if (
    evidence.metrics.visibleContentAreaRatio !== undefined &&
    evidence.metrics.visibleContentAreaRatio < 0.12
  ) {
    issues.push({
      code: "BROWSER_FIRST_SCREEN_TOO_EMPTY",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `首屏可见教学内容面积不足 ${Math.round(evidence.metrics.visibleContentAreaRatio * 100)}%。`,
      location,
      repairHint: "移除无效留白或空素材，让核心说明与互动形成完整首屏任务。",
    });
  }
  if (
    evidence.metrics.mainViewportCoverageRatio !== undefined &&
    evidence.metrics.mainViewportCoverageRatio < 0.9
  ) {
    issues.push({
      code: "BROWSER_CANVAS_NOT_FILLED",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `课程主画布只覆盖约 ${Math.round(evidence.metrics.mainViewportCoverageRatio * 100)}% 的播放器视口。`,
      location: {
        ...location,
        selector: "main[data-page-id]",
        description: "新生成页面的主画布视口覆盖率",
      },
      repairHint:
        "让 html、body、main 使用 100% 宽高和 border-box，并把页面安全留白放入 main 内边距。",
    });
  }
  return issues;
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
