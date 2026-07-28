import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  capturePageScreenshot,
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
  afterEach(() => {
    vi.unstubAllEnvs();
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
      { pageId: "page-partial", html },
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
