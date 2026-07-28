import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  capturePageScreenshot,
  countAuthoredTouchTargets,
  normalizeViewportFitMetrics,
  resolveDominantVisualMetrics,
} from "../../../../src/server/quality/playwright-screenshot";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const html = buildValidGeneratedHtml(pageContentDsl);
const cleanMetrics = {
  documentWidth: 922,
  documentHeight: 460,
  horizontalOverflowPx: 0,
  clippedElementCount: 0,
  zeroSizeInteractiveCount: 0,
  touchTargetUnder24Count: 0,
  touchTargetUnder44Count: 0,
  primaryActionBelowFoldCount: 0,
};

describe("Playwright screenshot QA evidence", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures metrics, stores the PNG, and derives browser issues", async () => {
    const captureBrowser = vi.fn().mockImplementation(async ({ viewport }) => ({
      png: new Uint8Array([137, 80, 78, 71]),
      metrics:
        viewport.width === 922
          ? {
              ...cleanMetrics,
              documentWidth: 1100,
              horizontalOverflowPx: 20,
              clippedElementCount: 1,
              zeroSizeInteractiveCount: 1,
              touchTargetUnder24Count: 1,
              touchTargetUnder44Count: 2,
              primaryActionBelowFoldCount: 1,
            }
          : {
              ...cleanMetrics,
              documentWidth: viewport.width,
              documentHeight: viewport.height,
            },
    }));
    const result = await capturePageScreenshot(
      { pageId: "page-qa/evidence", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-day-26-screenshots",
        now: () => "2026-07-16T10:00:00+08:00",
        captureBrowser,
      },
    );

    expect(result.evidence.status).toBe("captured");
    expect(result.evidence.artifactId).toMatch(
      /^page-qa-evidence-.+-desktop$/,
    );
    expect(result.evidence.viewport).toEqual({ width: 922, height: 460 });
    expect(result.evidence.captures?.map(({ viewport }) => viewport)).toEqual([
      { width: 922, height: 460 },
      { width: 712, height: 650 },
      { width: 366, height: 500 },
    ]);
    expect(captureBrowser).toHaveBeenCalledTimes(3);
    expect(result.issues.map(({ code }) => code)).toEqual([
      "BROWSER_HORIZONTAL_OVERFLOW",
      "BROWSER_CONTENT_CLIPPED",
      "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
      "BROWSER_ZERO_SIZE_INTERACTIVE",
      "BROWSER_TOUCH_TARGET_UNDER_24",
      "BROWSER_TOUCH_TARGET_UNDER_44",
    ]);
    expect(
      result.issues.every(
        ({ location }) => location.viewport === "922x460",
      ),
    ).toBe(true);
    expect(
      result.issues.find(
        ({ code }) => code === "BROWSER_TOUCH_TARGET_UNDER_44",
      )?.severity,
    ).toBe("info");
    await expect(readFile(result.serverPath!)).resolves.toEqual(
      Buffer.from([137, 80, 78, 71]),
    );
    expect(JSON.stringify(result.evidence)).not.toContain(result.serverPath);
  });

  it("rejects document and nested vertical overflow on a balanced lesson", async () => {
    const content = {
      ...pageContentDsl,
      interaction: {
        type: "navigate" as const,
        actionLabel: "继续学习",
        destination: "next" as const,
      },
      layoutHints: {
        ...pageContentDsl.layoutHints,
        contentDensity: "balanced" as const,
      },
    };
    const result = await capturePageScreenshot(
      {
        pageId: content.pageId,
        html: buildValidGeneratedHtml(content),
        content,
      },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-long-page-screenshots",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height * 2,
            verticalOverflowPx: viewport.height,
            nestedVerticalOverflowCount: 1,
            primaryActionBelowFoldCount: 1,
          },
        })),
      },
    );

    expect(new Set(result.issues.map(({ code }) => code))).toEqual(
      new Set([
        "BROWSER_VERTICAL_OVERFLOW",
        "BROWSER_NESTED_VERTICAL_OVERFLOW",
        "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
      ]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BROWSER_VERTICAL_OVERFLOW",
          severity: "error",
          location: expect.objectContaining({ viewport: "922x460" }),
        }),
        expect.objectContaining({
          code: "BROWSER_NESTED_VERTICAL_OVERFLOW",
          severity: "error",
        }),
      ]),
    );
  });

  it("measures the delivered contain-fit canvas instead of its authoring scroll size", () => {
    const fitted = normalizeViewportFitMetrics(
      {
        ...cleanMetrics,
        documentWidth: 1_480,
        documentHeight: 1_260,
        horizontalOverflowPx: 558,
        verticalOverflowPx: 800,
        nestedVerticalOverflowCount: 2,
        mainViewportCoverageRatio: 0.62,
      },
      { width: 922, height: 460 },
      true,
    );

    expect(fitted).toMatchObject({
      documentWidth: 922,
      documentHeight: 460,
      horizontalOverflowPx: 0,
      verticalOverflowPx: 0,
      nestedVerticalOverflowCount: 0,
      mainViewportCoverageRatio: 1,
    });
    expect(
      normalizeViewportFitMetrics(
        fitted,
        { width: 922, height: 460 },
        false,
      ),
    ).toBe(fitted);
  });

  it("flags a page that only fits after unreadable whole-canvas scaling", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-overdense", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-scale-screenshots",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
            viewportFitScale: viewport.width === 922 ? 0.72 : 1,
          },
        })),
      },
    );

    expect(result.issues).toMatchObject([
      {
        code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
        dimension: "layoutQuality",
        severity: "error",
        location: {
          viewport: "922x460",
          selector: "main[data-page-id]",
        },
      },
    ]);
    expect(result.evidence.metrics?.viewportFitScale).toBe(0.72);
  });

  it("evaluates touch targets in authored CSS pixels before contain-fit scaling", () => {
    expect(
      countAuthoredTouchTargets(
        [
          { width: 22, height: 22 },
          { width: 20, height: 20 },
        ],
        0.5,
      ),
    ).toEqual({
      touchTargetUnder24Count: 0,
      touchTargetUnder44Count: 1,
    });
  });

  it("runs by default and only skips when the environment explicitly disables it", async () => {
    const captureBrowser = vi.fn().mockResolvedValue({
      png: new Uint8Array([137, 80, 78, 71]),
      metrics: cleanMetrics,
    });
    const enabled = await capturePageScreenshot(
      { pageId: "page-default-enabled", html },
      {
        rootDir: "/tmp/ai-course-generator-default-screenshots",
        captureBrowser,
      },
    );

    vi.stubEnv("PAGE_QA_SCREENSHOTS_ENABLED", "false");
    const disabled = await capturePageScreenshot(
      { pageId: "page-explicitly-disabled", html },
      { captureBrowser },
    );

    expect(enabled.evidence.status).toBe("captured");
    expect(captureBrowser).toHaveBeenCalledTimes(3);
    expect(disabled.evidence.status).toBe("skipped");
    expect(disabled.evidence.captures).toHaveLength(3);
  });

  it("keeps successful viewport evidence when another viewport fails", async () => {
    const result = await capturePageScreenshot(
      {
        pageId: "page-partial",
        html,
        traceId: "trace-screenshot-partial",
        attempt: 2,
      },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-partial-screenshots",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => {
          if (viewport.width === 712) {
            throw new Error("tablet rendering failed");
          }
          return {
            png: new Uint8Array([137, 80, 78, 71]),
            metrics: {
              ...cleanMetrics,
              documentWidth: viewport.width,
              documentHeight: viewport.height,
              horizontalOverflowPx: viewport.width === 366 ? 8 : 0,
            },
          };
        }),
      },
    );

    expect(result.evidence.status).toBe("captured");
    expect(result.evidence.captures?.map(({ status }) => status)).toEqual([
      "captured",
      "failed",
      "captured",
    ]);
    expect(result.issues).toMatchObject([
      {
        code: "BROWSER_HORIZONTAL_OVERFLOW",
        location: { viewport: "366x500" },
      },
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "[page-qa-browser]",
      expect.objectContaining({
        event: "screenshot:error",
        traceId: "trace-screenshot-partial",
        pageId: "page-partial",
        stage: "qa",
        attempt: 2,
        phase: "capture",
        code: "SCREENSHOT_CAPTURE_FAILED",
        message: "tablet rendering failed",
        viewport: "712x650",
        errorName: "Error",
        errorMessage: "tablet rendering failed",
        errorStack: expect.stringContaining("tablet rendering failed"),
      }),
    );
    const captureLog = consoleError.mock.calls.at(-1)?.[1];
    expect(captureLog).not.toHaveProperty("html");
    expect(captureLog).not.toHaveProperty("prompt");
  });

  it("logs screenshot storage preparation failures with diagnostic context", async () => {
    const result = await capturePageScreenshot(
      {
        pageId: "page-storage-failure",
        html,
        traceId: "trace-storage-failure",
        attempt: 3,
      },
      {
        enabled: true,
        rootDir: "/dev/null/keya-screenshots",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
          },
        })),
      },
    );

    expect(result.evidence.status).toBe("failed");
    expect(consoleError).toHaveBeenCalledWith(
      "[page-qa-browser]",
      expect.objectContaining({
        event: "screenshot:error",
        traceId: "trace-storage-failure",
        pageId: "page-storage-failure",
        stage: "qa",
        attempt: 3,
        phase: "storage:mkdir",
        code: "SCREENSHOT_STORAGE_PREPARE_FAILED",
        errorName: "Error",
        errorStack: expect.any(String),
      }),
    );
  });

  it("records timeout and unavailable browser states without throwing", async () => {
    const timeout = await capturePageScreenshot(
      { pageId: "page-timeout", html },
      {
        enabled: true,
        timeoutMs: 5,
        captureBrowser: () => new Promise<never>(() => undefined),
      },
    );
    const unavailable = await capturePageScreenshot(
      { pageId: "page-unavailable", html },
      {
        enabled: true,
        captureBrowser: async () => {
          throw new Error("browserType.launch: Executable doesn't exist");
        },
      },
    );

    expect(timeout.evidence.status).toBe("failed");
    expect(timeout.evidence.captures?.map(({ status }) => status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
    expect(timeout.issues).toEqual([]);
    expect(unavailable.evidence.status).toBe("skipped");
    expect(unavailable.evidence.captures?.map(({ status }) => status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(unavailable.issues).toEqual([]);
  });

  it("turns weak first-screen and broken interaction metrics into repair issues", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-runtime-metrics", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-runtime-metrics",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
            interactionSubmitTested: false,
            largestVisualAreaRatio: 0.8,
            largestVisualSelector: '[data-asset-slot-id="hero-visual"]',
            visibleContentAreaRatio: 0.08,
            mainViewportCoverageRatio: 0.55,
          },
        })),
      },
    );

    expect(new Set(result.issues.map(({ code }) => code))).toEqual(
      new Set([
        "BROWSER_INTERACTION_SUBMIT_UNTESTED",
        "BROWSER_VISUAL_DOMINATES_VIEWPORT",
        "BROWSER_FIRST_SCREEN_TOO_EMPTY",
        "BROWSER_CANVAS_NOT_FILLED",
      ]),
    );
    expect(
      result.issues.find(
        ({ code }) => code === "BROWSER_VISUAL_DOMINATES_VIEWPORT",
      )?.location.selector,
    ).toBe('[data-asset-slot-id="hero-visual"]');
    expect(
      result.issues.find(
        ({ code }) => code === "BROWSER_CANVAS_NOT_FILLED",
      )?.location.selector,
    ).toBe("main[data-page-id]");
  });

  it("rejects a required course illustration rendered as a tiny decoration", async () => {
    const content = {
      ...pageContentDsl,
      assetSlots: [
        {
          id: "asset-slot-01" as const,
          type: "illustration" as const,
          role: "inline" as const,
          purpose: "解释本页核心情节",
          required: true,
          altTextGuidance: "本页核心情节插图",
        },
      ],
    };
    const result = await capturePageScreenshot(
      {
        pageId: content.pageId,
        html: buildValidGeneratedHtml(content),
        content,
      },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-tiny-visual-screenshots",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
            largestVisualAreaRatio: 0.04,
            largestVisualSelector: '[data-asset-slot-id="asset-slot-01"]',
          },
        })),
      },
    );

    const tinyVisualIssues = result.issues.filter(
      ({ code }) => code === "BROWSER_VISUAL_TOO_SMALL",
    );
    expect(tinyVisualIssues).toHaveLength(3);
    expect(tinyVisualIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          dimension: "assetUsability",
          location: expect.objectContaining({
            selector: '[data-asset-slot-id="asset-slot-01"]',
            viewport: "922x460",
          }),
        }),
      ]),
    );
  });

  it("discounts low-opacity and negative-layer decorative backgrounds", () => {
    expect(
      resolveDominantVisualMetrics([
        {
          areaRatio: 1,
          effectiveOpacity: 0.08,
          hasNegativeLayer: false,
          selector: "#low-opacity-decoration",
        },
        {
          areaRatio: 1,
          effectiveOpacity: 1,
          hasNegativeLayer: true,
          selector: "#negative-layer-decoration",
        },
      ]),
    ).toEqual({
      largestVisualAreaRatio: 0.08,
      largestVisualSelector: "#low-opacity-decoration",
    });
  });

  it("keeps a stable selector for a genuinely dominant opaque image", () => {
    expect(
      resolveDominantVisualMetrics([
        {
          areaRatio: 1,
          effectiveOpacity: 1,
          hasNegativeLayer: false,
          selector: '[data-asset-slot-id="hero-visual"]',
        },
      ]),
    ).toEqual({
      largestVisualAreaRatio: 1,
      largestVisualSelector: '[data-asset-slot-id="hero-visual"]',
    });
  });

  it("does not render unsafe HTML in a browser", async () => {
    const captureBrowser = vi.fn();
    const result = await capturePageScreenshot(
      { pageId: "page-unsafe", html: `${html}<script>alert(1)</script>` },
      { enabled: true, captureBrowser },
    );

    expect(result.evidence.status).toBe("skipped");
    expect(captureBrowser).not.toHaveBeenCalled();
  });
});
