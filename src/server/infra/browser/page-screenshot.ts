import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Browser, type Page } from "playwright";

import { loadGeneratedAsset } from "@/server/infra/file/generated-asset";
import {
  QualityScreenshotEvidenceSchema,
  type PageContentDSL,
  type QualityIssue,
  type QualityScreenshotCapture,
  type QualityScreenshotEvidence,
} from "@/shared/course-schema";
import {
  buildTrustedLessonSrcDoc,
  sanitizeHtmlLite,
  type TrustedLessonRuntimeConfig,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

import { collectBrowserIssues } from "./page-screenshot-issues";
import { getCourseBrowser } from "./browser-pool";
import {
  isBrowserProcessFailure,
  toBrowserHarnessUnavailableError,
} from "./error";

const QA_VIEWPORTS = [
  { name: "desktop", viewport: { width: 1280, height: 720 } },
  { name: "tablet", viewport: { width: 960, height: 540 } },
  { name: "mobile", viewport: { width: 640, height: 360 } },
] as const;
const DEFAULT_TIMEOUT_MS = 12_000;

export const VISUAL_PROMINENCE_SELECTOR =
  "img,svg,canvas,[role='img'],[data-asset-slot-id]";

export type BrowserScreenshotMetrics = NonNullable<
  QualityScreenshotCapture["metrics"]
>;
type BrowserViewport = QualityScreenshotCapture["viewport"];
type ScreenshotCapture = QualityScreenshotCapture;

export type BrowserScreenshotSnapshot = {
  png: Uint8Array;
  metrics: BrowserScreenshotMetrics;
  diagnostics?: NonNullable<QualityScreenshotCapture["diagnostics"]>;
};

export type PageScreenshotModelImage = {
  viewport: BrowserViewport;
  png: Uint8Array;
};

export type BrowserInteractionStep =
  | { action: "click" | "check" | "expectVisible"; selector: string }
  | { action: "fill" | "expectText"; selector: string; value: string }
  | {
      action: "expectAttribute";
      selector: string;
      attribute: string;
      value: string;
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
): Pick<
  BrowserScreenshotMetrics,
  "touchTargetUnder24Count" | "touchTargetUnder44Count"
> {
  return {
    touchTargetUnder24Count: rects.filter(
      (rect) => rect.width < 24 || rect.height < 24,
    ).length,
    touchTargetUnder44Count: rects.filter(
      (rect) => rect.width < 44 || rect.height < 44,
    ).length,
  };
}

export type PageScreenshotResult = {
  evidence: QualityScreenshotEvidence;
  issues: QualityIssue[];
  /** 只供服务器日志和测试使用，不能进入共享 QualityReport。 */
  serverPath?: string;
  /** 只供本次 Page QA 多模态请求使用，不能进入共享 QualityReport 或日志。 */
  modelImages?: PageScreenshotModelImage[];
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
 * 页面会启用平台固定运行时；浏览器与写盘故障会被结构化为质量闸门失败。
 */
export async function capturePageScreenshot(
  input: {
    pageId: string;
    html: string;
    content?: PageContentDSL;
    /** 来自 CourseArchitecture 的最低互动承诺，不规定具体控件或 DSL 结构。 */
    requiresInteraction?: boolean;
    abortSignal?: AbortSignal;
    traceId?: string;
    attempt?: number;
    interactionSteps?: BrowserInteractionStep[];
  },
  options: CapturePageScreenshotOptions = {},
): Promise<PageScreenshotResult> {
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
  const runtimeConfig = input.content
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
        interactionSteps: input.interactionSteps,
      })
    : await captureAllWithPlaywright({
        html: input.html,
        timeoutMs,
        abortSignal: input.abortSignal,
        runtimeConfig,
        requiresInteraction: input.requiresInteraction,
        pageId: input.pageId,
        traceId: input.traceId,
        attempt: input.attempt,
        interactionSteps: input.interactionSteps,
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
  const modelImages: PageScreenshotModelImage[] = outcomes.flatMap(
    ({ snapshot, error, viewport }) =>
      snapshot && !error
        ? [{ viewport, png: snapshot.png }]
        : [],
  );
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
        ...(outcome.snapshot.diagnostics
          ? { diagnostics: outcome.snapshot.diagnostics }
          : {}),
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

  const evidence = QualityScreenshotEvidenceSchema.parse({
    captures,
  });
  return {
    evidence,
    issues: captures.flatMap((capture) =>
      collectBrowserIssues(input.pageId, capture, input.content, {
        requiresInteraction: input.requiresInteraction,
      }),
    ),
    serverPath: serverPaths.get("desktop"),
    ...(modelImages.length > 0 ? { modelImages } : {}),
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
  interactionSteps?: BrowserInteractionStep[];
  captureBrowser: NonNullable<CapturePageScreenshotOptions["captureBrowser"]>;
}): Promise<CaptureOutcome[]> {
  const outcomes = await Promise.all(
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
  throwOnCaptureFailure(outcomes);
  return outcomes;
}

async function captureAllWithPlaywright(input: {
  html: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  runtimeConfig?: TrustedLessonRuntimeConfig;
  requiresInteraction?: boolean;
  pageId: string;
  traceId?: string;
  attempt?: number;
  interactionSteps?: BrowserInteractionStep[];
}): Promise<CaptureOutcome[]> {
  let browser: Browser;
  try {
    browser = await withTimeout(
      getCourseBrowser(),
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
    throw toBrowserHarnessUnavailableError(error);
  }

  const outcomes: CaptureOutcome[] = [];
  // 多个 Page Agent 可以并行，但同一页三视口顺序取证，避免 3 页同时创建
  // 9 个 BrowserContext 后把正常页面误判成 12 秒截图超时。
  for (const { name, viewport } of QA_VIEWPORTS) {
    try {
      const snapshot = await withTimeout(
        captureViewport(browser, {
          html: input.html,
          timeoutMs: input.timeoutMs,
          viewport,
          runtimeConfig: input.runtimeConfig,
          requiresInteraction: input.requiresInteraction,
          pageId: input.pageId,
          traceId: input.traceId,
          attempt: input.attempt,
          interactionSteps: input.interactionSteps,
        }),
        input.timeoutMs,
        input.abortSignal,
      );
      outcomes.push({ name, viewport, snapshot });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isBrowserProcessFailure(error)) {
        logScreenshotError({
          traceId: input.traceId,
          pageId: input.pageId,
          phase: "browser:runtime",
          attempt: input.attempt,
          code: "SCREENSHOT_BROWSER_RUNTIME_FAILED",
          viewport,
          error,
        });
        throw toBrowserHarnessUnavailableError(error);
      }
      logScreenshotError({
        traceId: input.traceId,
        pageId: input.pageId,
        phase: "capture",
        attempt: input.attempt,
        code: "SCREENSHOT_CAPTURE_FAILED",
        viewport,
        error,
      });
      outcomes.push({ name, viewport, error });
    }
  }
  throwOnCaptureFailure(outcomes);
  return outcomes;
}

function throwOnCaptureFailure(outcomes: CaptureOutcome[]) {
  const captureFailure = outcomes.find(({ error }) => error)?.error;
  if (!captureFailure) return;

  // 截图缺失是 Browser Harness 故障，不是页面质量问题。交给 WorkOrder
  // 瞬态重试，禁止把基础设施超时写成 PageQuality 后让 Agent 错误修稿。
  throw toBrowserHarnessUnavailableError(captureFailure);
}

async function captureViewport(
  browser: Browser,
  input: {
    html: string;
    timeoutMs: number;
    viewport: BrowserViewport;
    runtimeConfig?: TrustedLessonRuntimeConfig;
    requiresInteraction?: boolean;
    pageId: string;
    traceId?: string;
    attempt?: number;
    interactionSteps?: BrowserInteractionStep[];
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
    const diagnostics: NonNullable<
      QualityScreenshotCapture["diagnostics"]
    > = {
      console: [],
      pageErrors: [],
      requestFailures: [],
      dom: {
        elementCount: 0,
        interactiveCount: 0,
        landmarkCount: 0,
        visibleTextChars: 0,
      },
      interaction: [],
    };
    page.on("console", (message) => {
      if (diagnostics.console.length >= 20) return;
      diagnostics.console.push({
        type: message.type().slice(0, 40) || "log",
        text: message.text().slice(0, 500),
      });
    });
    page.on("pageerror", (error) => {
      if (diagnostics.pageErrors.length >= 20) return;
      diagnostics.pageErrors.push(error.message.slice(0, 500));
    });
    page.on("requestfailed", (request) => {
      if (diagnostics.requestFailures.length >= 20) return;
      diagnostics.requestFailures.push({
        method: request.method().slice(0, 20),
        url: request.url().slice(0, 500),
        error:
          request.failure()?.errorText.slice(0, 300) ??
          "request failed",
      });
    });
    page.setDefaultTimeout(input.timeoutMs);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const htmlWithBase = input.html.replace(
      /<head\b([^>]*)>/i,
      '<head$1><base href="http://keya.local/">',
    );
    await page.setContent(
      input.runtimeConfig
        ? buildQaLessonSrcDoc(htmlWithBase, input.runtimeConfig)
        : htmlWithBase,
      {
        waitUntil: "domcontentloaded",
        timeout: input.timeoutMs,
      },
    );
    if (input.runtimeConfig) {
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.keyaRuntime === "ready",
      );
      // 等待图片、字体和可信互动运行时完成首帧布局。
      await page.waitForTimeout(32);
    }

    const evaluated = await page.evaluate((visualProminenceSelector) => {
      const root = document.documentElement;
      const body = document.body;
      const interactiveElements = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a[href],button,input,select,textarea,summary,[role='button'],[tabindex]",
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
      const clippedElements = layoutElements.filter((element) => {
        // html/body 的整页尺寸差已经由 requiredViewportScale 统一衡量。
        // 固定画布常用 body{overflow:hidden} 配合 contain-fit；再把根节点记成
        // 内容裁切会把可读的 74% 画布重复判成硬失败，并诱导 Agent 盲修。
        if (element === root || element === body) return false;
        // object-fit、受控画框和圆角裁切是素材呈现手段，不是正文丢失。
        // 素材占比另有独立指标；这里仅统计正文或互动内容的真实裁切。
        if (
          element.closest("[data-asset-slot-id]") ||
          element.matches("img,svg,canvas,video,[aria-hidden='true']")
        ) {
          return false;
        }
        const style = getComputedStyle(element);
        const clipsX = ["hidden", "clip"].includes(style.overflowX);
        const clipsY = ["hidden", "clip"].includes(style.overflowY);
        const overflowsX =
          clipsX && element.scrollWidth > element.clientWidth + 1;
        const overflowsY =
          clipsY && element.scrollHeight > element.clientHeight + 1;
        if (!overflowsX && !overflowsY) return false;

        // overflow:hidden 也常用于轨道、光晕和装饰性舞台。scrollWidth/
        // scrollHeight 只能证明有几何体越界，不能证明正文丢失。只有实际文字
        // 或交互控件的可见盒越过裁切边界，才报告硬错误。
        const clipRect = element.getBoundingClientRect();
        const semanticElements: HTMLElement[] = [
          element,
          ...Array.from(element.querySelectorAll<HTMLElement>("*")),
        ];
        return semanticElements.some((semanticElement) => {
          const semanticRects: DOMRect[] = [];
          if (
            semanticElement.matches(
              "input,select,textarea,button,a,[role='button']",
            )
          ) {
            semanticRects.push(semanticElement.getBoundingClientRect());
          }
          for (const node of semanticElement.childNodes) {
            if (
              node.nodeType !== Node.TEXT_NODE ||
              !(node.textContent ?? "").trim()
            ) {
              continue;
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            semanticRects.push(...Array.from(range.getClientRects()));
          }
          return semanticRects.some(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              ((overflowsX &&
                (rect.left < clipRect.left - 1 ||
                  rect.right > clipRect.right + 1)) ||
                (overflowsY &&
                  (rect.top < clipRect.top - 1 ||
                    rect.bottom > clipRect.bottom + 1))),
          );
        });
      });
      const clippedElementSelectors = [
        ...new Set(
          clippedElements.map((element) => {
            const selectorSegments: string[] = [];
            let selectorNode: HTMLElement | null = element;
            while (selectorNode && selectorNode !== document.body) {
              const blockId = selectorNode.getAttribute("data-block-id");
              if (blockId) {
                selectorSegments.unshift(
                  `[data-block-id="${CSS.escape(blockId)}"]`,
                );
                break;
              }
              if (selectorNode.id) {
                selectorSegments.unshift(`#${CSS.escape(selectorNode.id)}`);
                break;
              }
              const tagName = selectorNode.tagName.toLowerCase();
              const sameTagSiblings = selectorNode.parentElement
                ? Array.from(selectorNode.parentElement.children).filter(
                    (sibling) => sibling.tagName === selectorNode!.tagName,
                  )
                : [];
              selectorSegments.unshift(
                sameTagSiblings.length > 1
                  ? `${tagName}:nth-of-type(${sameTagSiblings.indexOf(selectorNode) + 1})`
                  : tagName,
              );
              selectorNode = selectorNode.parentElement;
            }
            if (selectorNode === document.body) {
              selectorSegments.unshift("body");
            }
            return selectorSegments.join(" > ");
          }),
        ),
      ].slice(0, 8);
      const clippedElementCount = clippedElements.length;
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
      const lessonRoot = document.querySelector<HTMLElement>("main");
      const mainViewportCoverageRatio =
        root.dataset.keyaCanvasMode === "fluid" && lessonRoot
          ? (() => {
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
      const visualCandidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          visualProminenceSelector,
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
          const selectorSegments: string[] = [];
          let selectorNode: HTMLElement | null = element;
          while (selectorNode && selectorNode !== document.body) {
            const assetSlotId =
              selectorNode.getAttribute("data-asset-slot-id");
            if (assetSlotId) {
              selectorSegments.unshift(
                `[data-asset-slot-id="${CSS.escape(assetSlotId)}"]`,
              );
              break;
            }
            const blockId = selectorNode.getAttribute("data-block-id");
            if (blockId) {
              selectorSegments.unshift(
                `[data-block-id="${CSS.escape(blockId)}"]`,
              );
              break;
            }
            if (selectorNode.id) {
              selectorSegments.unshift(`#${CSS.escape(selectorNode.id)}`);
              break;
            }
            const tagName = selectorNode.tagName.toLowerCase();
            const sameTagSiblings = selectorNode.parentElement
              ? Array.from(selectorNode.parentElement.children).filter(
                  (sibling) => sibling.tagName === selectorNode!.tagName,
                )
              : [];
            selectorSegments.unshift(
              sameTagSiblings.length > 1
                ? `${tagName}:nth-of-type(${sameTagSiblings.indexOf(selectorNode) + 1})`
                : tagName,
            );
            selectorNode = selectorNode.parentElement;
          }
          if (selectorNode === document.body) {
            selectorSegments.unshift("body");
          }
          return {
            areaRatio: Math.min(1, (width * height) / viewportArea),
            effectiveOpacity,
            hasNegativeLayer,
            selector: selectorSegments.join(" > "),
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
      const rawMarkupSamples: string[] = [];
      const rawMarkupPattern =
        /(?:<\/?[a-z][^<>\n]{0,100}>|\b(?:span|div|p|strong|em|section|article|label|input|button)\s+(?:class|id|style|data-[\w-]+)\s*=\s*["'][^"']*["']\s*>)/gi;
      const textWalker = document.createTreeWalker(
        lessonRoot ?? body,
        NodeFilter.SHOW_TEXT,
      );
      let textNode = textWalker.nextNode();
      while (textNode && rawMarkupSamples.length < 5) {
        const parent = textNode.parentElement;
        if (!parent?.closest("code,pre,samp,kbd")) {
          const text = (textNode.textContent ?? "").trim();
          const match = text.match(rawMarkupPattern)?.[0];
          if (match) rawMarkupSamples.push(match.slice(0, 200));
        }
        textNode = textWalker.nextNode();
      }

      const fixedCanvas = root.dataset.keyaCanvasMode !== "fluid";
      // viewport-fit 会暂时把 body overflow 改为 visible；固定舞台上的装饰性
      // 绝对定位元素因此可能扩大 scrollHeight。质量合同应测作者声明的舞台，
      // 真实正文裁切和交互越界分别由 clipped/primary-action 指标负责。
      const documentWidth = fixedCanvas
        ? Math.max(
            body?.offsetWidth ?? 0,
            lessonRoot?.offsetWidth ?? 0,
          )
        : Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
      const documentHeight = fixedCanvas
        ? Math.max(
            body?.offsetHeight ?? 0,
            lessonRoot?.offsetHeight ?? 0,
          )
        : Math.max(root.scrollHeight, body?.scrollHeight ?? 0);
      const requiredViewportScale = Math.min(
        1,
        window.innerWidth / Math.max(1, documentWidth),
        window.innerHeight / Math.max(1, documentHeight),
      );
      const inertButtonCount = interactiveElements.filter((element) => {
        if (!(element instanceof HTMLButtonElement)) return false;
        if (element.closest("[data-interaction-type]")) return false;
        const form = element.closest("form");
        const type = (element.getAttribute("type") ?? "submit").toLowerCase();
        return !form || !["submit", "reset"].includes(type);
      }).length;
      return {
        documentWidth,
        documentHeight,
        horizontalOverflowPx:
          root.dataset.keyaViewportFit === "ready"
            ? 0
            : Math.max(0, root.scrollWidth - root.clientWidth),
        verticalOverflowPx:
          root.dataset.keyaViewportFit === "ready"
            ? 0
            : Math.max(0, documentHeight - window.innerHeight),
        requiredViewportScale,
        nestedVerticalOverflowCount,
        clippedElementCount,
        clippedElementSelectors,
        zeroSizeInteractiveCount: interactiveRects.filter(
          (rect) => rect.width < 1 || rect.height < 1,
        ).length,
        inertButtonCount,
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
        dom: {
          elementCount: contentElements.length,
          interactiveCount: interactiveElements.length,
          landmarkCount: document.querySelectorAll(
            "main,nav,aside,header,footer,section[aria-label],section[aria-labelledby]",
          ).length,
          visibleTextChars: (body?.innerText ?? "").trim().length,
          ...(rawMarkupSamples.length > 0 ? { rawMarkupSamples } : {}),
          outline: Array.from(
            document.querySelectorAll<HTMLElement>(
              "main,h1,h2,h3,button,input,textarea,select,[data-block-id],[data-interaction-type],[data-interaction-item-id]",
            ),
          )
            .slice(0, 80)
            .map((element) => {
              const attributes = [
                element.id ? `#${element.id}` : "",
                element.dataset.blockId
                  ? `[data-block-id=${element.dataset.blockId}]`
                  : "",
                element.dataset.interactionType
                  ? `[data-interaction-type=${element.dataset.interactionType}]`
                  : "",
                element.dataset.interactionItemId
                  ? `[data-interaction-item-id=${element.dataset.interactionItemId}]`
                  : "",
              ].join("");
              const text = (
                element.innerText ||
                element.getAttribute("aria-label") ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 180);
              return `${element.tagName.toLowerCase()}${attributes}${text ? ` :: ${text}` : ""}`.slice(
                0,
                300,
              );
            }),
        },
      };
    }, VISUAL_PROMINENCE_SELECTOR);
    const {
      visualCandidates,
      visibleInteractiveSizes,
      dom,
      ...baseMetrics
    } = evaluated;
    diagnostics.dom = dom;
    const metrics: BrowserScreenshotMetrics = {
      ...baseMetrics,
      ...countAuthoredTouchTargets(visibleInteractiveSizes),
      ...resolveDominantVisualMetrics(visualCandidates),
    };
    const png = await page.screenshot({ type: "png", fullPage: false });
    const interactionResult = await exerciseInteraction(
      page,
      input.runtimeConfig,
      {
        traceId: input.traceId,
        pageId: input.pageId,
        attempt: input.attempt,
        viewport: input.viewport,
      },
      input.interactionSteps,
      input.requiresInteraction,
    );
    const { diagnosticSteps, ...interactionMetrics } = interactionResult;
    diagnostics.interaction.push(
      ...(diagnosticSteps.length > 0
        ? diagnosticSteps
        : [
            interactionMetrics.interactionSubmitTested === undefined
              ? {
                  action: "exercise-interaction",
                  status: "skipped" as const,
                  detail: "当前页面没有可由 Harness 自动回放的 choice 互动。",
                }
              : interactionMetrics.interactionSubmitTested &&
                  interactionMetrics.interactionFeedbackVisible
                ? {
                    action: "submit-choice",
                    status: "passed" as const,
                    detail: "选择控件、提交动作和反馈显示均已验证。",
                  }
                : {
                    action: "submit-choice",
                    status: "failed" as const,
                    detail: "选择互动没有完成受控提交或未显示反馈。",
                  },
          ]),
    );
    return {
      metrics: { ...metrics, ...interactionMetrics },
      png,
      diagnostics,
    };
  } finally {
    await context.close();
  }
}

/**
 * QA 使用与播放器相同的固定舞台缩放；原始文档尺寸和 requiredViewportScale
 * 仍用于识别内容超过 1920×1080 后被额外缩小的问题。
 */
export function buildQaLessonSrcDoc(
  html: string,
  runtimeConfig: TrustedLessonRuntimeConfig,
) {
  return buildTrustedLessonSrcDoc(html, runtimeConfig, {
    viewportFit: true,
  });
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
  interactionSteps: BrowserInteractionStep[] = [],
  requiresInteraction = false,
): Promise<
  Pick<
    BrowserScreenshotMetrics,
    "interactionSubmitTested" | "interactionFeedbackVisible"
  > & {
    diagnosticSteps: Array<{
      action: string;
      status: "passed" | "failed" | "skipped";
      detail: string;
    }>;
  }
> {
  if (interactionSteps.length > 0) {
    return runControlledInteractionSteps(page, interactionSteps);
  }
  if (runtimeConfig?.interaction.type !== "choice") {
    return requiresInteraction
      ? exerciseNativeInteraction(page)
      : { diagnosticSteps: [] };
  }

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
      diagnosticSteps: [],
    };
  }

  try {
    // 互动控件可能位于渐进展开的 details 中。QA 需要主动进入该学习步骤，
    // 否则 Playwright 会等待一个结构存在但不可见的控件直至整次截图超时。
    const hasAssociatedLabel = await firstControl.evaluate((element) => {
      let current: HTMLElement | null = element.parentElement;
      while (current) {
        if (current instanceof HTMLDetailsElement) current.open = true;
        current = current.parentElement;
      }
      const label = (element as HTMLInputElement).labels?.[0];
      if (!label) return false;
      label.dataset.keyaQaChoiceTarget = "true";
      return true;
    });
    const clickTarget = page
      .locator('[data-keya-qa-choice-target="true"]')
      .first();

    if (
      hasAssociatedLabel &&
      (await clickTarget.count()) > 0 &&
      (await clickTarget.isVisible())
    ) {
      await clickTarget.click();
    } else {
      await firstControl.check();
    }
    if (!(await firstControl.isChecked())) {
      throw new Error("选择题控件在点击可见标签后仍未选中。");
    }
    await submit.click();
    const feedback = page
      .locator('[data-interaction-type="choice"] [data-keya-runtime-feedback]')
      .first();
    return {
      interactionSubmitTested: true,
      interactionFeedbackVisible:
        (await feedback.count()) > 0 && (await feedback.isVisible()),
      diagnosticSteps: [],
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
      diagnosticSteps: [],
    };
  }
}

async function exerciseNativeInteraction(page: Page): Promise<{
  diagnosticSteps: Array<{
    action: string;
    status: "passed" | "failed" | "skipped";
    detail: string;
  }>;
}> {
  const diagnosticSteps: Array<{
    action: string;
    status: "passed" | "failed" | "skipped";
    detail: string;
  }> = [];
  const control = page
    .locator(
      "input:not([type='hidden']):visible,select:visible,textarea:visible",
    )
    .first();
  if ((await control.count()) > 0) {
    const before = await captureNativeInteractionFingerprint(page, control);
    const tagName = await control.evaluate((element) =>
      element.tagName.toLowerCase(),
    );
    const inputType =
      tagName === "input"
        ? await control.getAttribute("type")
        : undefined;
    let action = `change-${tagName}`;
    let changed = false;

    if (tagName === "select") {
      const values = await control
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      const current = await control.inputValue();
      const next = values.find((value) => value !== current);
      if (next !== undefined) {
        await control.selectOption(next);
        changed = (await control.inputValue()) === next;
      }
    } else if (
      tagName === "textarea" ||
      inputType === "text" ||
      inputType === null
    ) {
      await control.fill("Keya QA");
      changed = (await control.inputValue()) === "Keya QA";
    } else if (inputType === "checkbox" || inputType === "radio") {
      const beforeChecked = await control.isChecked();
      await control.check();
      changed = (await control.isChecked()) !== beforeChecked;
      action = `check-${inputType}`;
    } else if (inputType === "range") {
      await control.evaluate((element) => {
        const input = element as HTMLInputElement;
        const previous = input.value;
        const next = previous === input.max ? input.min : input.max;
        input.value = next || "1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input.value !== previous;
      });
      // 课程页禁止自定义 script，纯 CSS 无法根据 range 的实时 value
      // property 驱动外部教学反馈；原生滑块自身移动不能算学习结果。
      changed = false;
      action = "change-range";
    } else {
      diagnosticSteps.push(
        nativeInteractionStep(
          "exercise-native-control",
          false,
          "",
          `当前 ${tagName}${inputType ? `[type=${inputType}]` : ""} 没有受控回放策略。`,
        ),
      );
    }

    if (!diagnosticSteps.some(({ action: current }) => current === "exercise-native-control")) {
      const after = await captureNativeInteractionFingerprint(page, control);
      diagnosticSteps.push(
        nativeInteractionStep(
          action,
          changed && before !== after,
          "原生控件操作后，页面出现了控件自身以外的可观察状态或反馈变化。",
          "控件值虽然改变，但页面没有产生控件自身以外的可观察状态或反馈；这属于伪互动。",
        ),
      );
    }
  }

  // 先验证 input/select 等状态控件，再展开 details。否则 details 刚触发的
  // transition/animation 仍在运行时，会被后续控件指纹误认为自身反馈。
  const summary = page.locator("details > summary:visible").first();
  if ((await summary.count()) > 0) {
    const details = summary.locator("..");
    const before = await captureNativeInteractionFingerprint(page, summary);
    await summary.click();
    const opened = await details.evaluate(
      (element) => element instanceof HTMLDetailsElement && element.open,
    );
    const after = await captureNativeInteractionFingerprint(page, summary);
    diagnosticSteps.push(
      nativeInteractionStep(
        "toggle-details",
        opened && before !== after,
        "details/summary 已展开并产生可观察状态变化。",
        "details/summary 点击后没有展开或页面没有可观察变化。",
      ),
    );
  }

  if (diagnosticSteps.length === 0) {
    diagnosticSteps.push(
      nativeInteractionStep(
        "exercise-native-control",
        false,
        "",
        "页面虽声明互动，但没有可由 Harness 回放的原生状态控件。",
      ),
    );
  }
  return { diagnosticSteps };
}

function nativeInteractionStep(
  action: string,
  passed: boolean,
  passedDetail: string,
  failedDetail: string,
) {
  return {
    action,
    status: passed ? ("passed" as const) : ("failed" as const),
    detail: passed ? passedDetail : failedDetail,
  };
}

async function captureNativeInteractionFingerprint(
  page: Page,
  control: ReturnType<Page["locator"]>,
) {
  return control.evaluate((activeControl) => {
    const root = document.querySelector("main") ?? document.body;
    const elements = [root, ...Array.from(root.querySelectorAll("*"))]
      .filter((element) => element !== activeControl)
      .slice(0, 400);
    return JSON.stringify(
      elements.map((element) => {
        const html = element as HTMLElement;
        const style = getComputedStyle(html);
        const before = getComputedStyle(html, "::before");
        const after = getComputedStyle(html, "::after");
        const rect = html.getBoundingClientRect();
        return [
          html.tagName,
          html.id,
          html.getAttribute("open"),
          html.getAttribute("hidden"),
          html.getAttribute("aria-expanded"),
          style.display,
          style.visibility,
          style.opacity,
          style.color,
          style.backgroundColor,
          style.transform,
          style.animationName,
          Math.round(rect.width * 10) / 10,
          Math.round(rect.height * 10) / 10,
          before.content,
          after.content,
        ];
      }),
    );
  });
}

async function runControlledInteractionSteps(
  page: Page,
  steps: BrowserInteractionStep[],
) {
  const diagnosticSteps: Array<{
    action: string;
    status: "passed" | "failed" | "skipped";
    detail: string;
  }> = [];
  for (const step of steps.slice(0, 20)) {
    const locator = page.locator(step.selector).first();
    try {
      if ((await locator.count()) === 0) {
        throw new Error(`找不到 selector：${step.selector}`);
      }
      switch (step.action) {
        case "click":
          await locator.click();
          break;
        case "check":
          await locator.check();
          break;
        case "fill":
          await locator.fill(step.value);
          break;
        case "expectVisible":
          if (!(await locator.isVisible())) throw new Error("元素不可见");
          break;
        case "expectText": {
          const actual = (await locator.textContent()) ?? "";
          if (!actual.includes(step.value)) {
            throw new Error(`文本未包含：${step.value}`);
          }
          break;
        }
        case "expectAttribute": {
          const actual = await locator.getAttribute(step.attribute);
          if (actual !== step.value) {
            throw new Error(
              `${step.attribute} 预期 ${step.value}，实际 ${actual ?? "null"}`,
            );
          }
          break;
        }
      }
      diagnosticSteps.push({
        action: step.action,
        status: "passed",
        detail: step.selector.slice(0, 240),
      });
    } catch (error) {
      diagnosticSteps.push({
        action: step.action,
        status: "failed",
        detail: (error instanceof Error ? error.message : String(error)).slice(
          0,
          300,
        ),
      });
      break;
    }
  }
  return {
    diagnosticSteps,
  };
}

function logScreenshotError(input: {
  traceId?: string;
  pageId: string;
  phase:
    | "browser:launch"
    | "browser:runtime"
    | "capture"
    | "interaction"
    | "storage:mkdir"
    | "storage:write";
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
