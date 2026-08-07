import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildQaLessonSrcDoc,
  capturePageScreenshot,
  countAuthoredTouchTargets,
  restoreAuthoredTouchTargetSizes,
  resolveDominantVisualMetrics,
  VISUAL_PROMINENCE_SELECTOR,
} from "../../../../src/server/infra/browser/page-screenshot";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const html = buildValidGeneratedHtml(pageContentDsl);
const cleanMetrics = {
  documentWidth: 1280,
  documentHeight: 720,
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

  it("uses the same fixed-stage fit runtime in QA and the learner", () => {
    const srcDoc = buildQaLessonSrcDoc(html, {
      pageId: pageContentDsl.pageId,
      interaction: pageContentDsl.interaction,
      runtime: {
        sceneKind: "practice",
        visualPrimitive: "concept-map",
        motionPlan: {
          intensity: "none",
          cuePoints: [],
        },
        completionRule: { type: "view" },
      },
    });

    expect(srcDoc).toContain('id="keya-trusted-runtime"');
    expect(srcDoc).toContain('id="keya-viewport-fit"');
    expect(srcDoc).toContain('id="keya-viewport-fit-style"');
  });

  it("captures metrics, stores the PNG, and derives browser issues", async () => {
    const captureBrowser = vi.fn().mockImplementation(async ({ viewport }) => ({
      png: new Uint8Array([137, 80, 78, 71]),
      metrics:
        viewport.width === 1280
          ? {
              ...cleanMetrics,
              documentWidth: 1100,
              horizontalOverflowPx: 20,
              clippedElementCount: 1,
              clippedElementSelectors: ["main > section"],
              zeroSizeInteractiveCount: 1,
              touchTargetUnder24Count: 1,
              touchTargetUnder24Selectors: [
                "label.answer[type=radio]「答案」 (120×18px)",
              ],
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
        rootDir: "/tmp/ai-course-generator-fixture-26-screenshots",
        now: () => "2026-07-16T10:00:00+08:00",
        captureBrowser,
      },
    );

    expect(result.evidence.captures[0]!.status).toBe("captured");
    expect(result.evidence.captures[0]!.artifactId).toMatch(
      /^page-qa-evidence-.+-desktop$/,
    );
    expect(result.evidence.captures[0]!.viewport).toEqual({ width: 1280, height: 720 });
    expect(
      result.issues.find(
        ({ code }) => code === "BROWSER_TOUCH_TARGET_UNDER_24",
      )?.repairHint,
    ).toContain("label.answer[type=radio]");
    expect(result.evidence.captures?.map(({ viewport }) => viewport)).toEqual([
      { width: 1280, height: 720 },
      { width: 960, height: 540 },
      { width: 640, height: 360 },
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
        ({ location }) => location.viewport === "1280x720",
      ),
    ).toBe(true);
    expect(
      result.issues.find(
        ({ code }) => code === "BROWSER_CONTENT_CLIPPED",
      )?.location.selector,
    ).toBe("main > section");
    expect(
      result.issues.find(
        ({ code }) => code === "BROWSER_TOUCH_TARGET_UNDER_44",
      )?.severity,
    ).toBe("info");
    await expect(readFile(result.serverPath!)).resolves.toEqual(
      Buffer.from([137, 80, 78, 71]),
    );
    expect(JSON.stringify(result.evidence)).not.toContain(result.serverPath);
    expect(result.modelImages).toEqual([
      {
        viewport: { width: 1280, height: 720 },
        png: new Uint8Array([137, 80, 78, 71]),
      },
      {
        viewport: { width: 960, height: 540 },
        png: new Uint8Array([137, 80, 78, 71]),
      },
      {
        viewport: { width: 640, height: 360 },
        png: new Uint8Array([137, 80, 78, 71]),
      },
    ]);
    expect(JSON.stringify(result.evidence)).not.toContain("modelImages");
  });

  it("persists console, DOM, network and controlled interaction diagnostics", async () => {
    const diagnostics = {
      console: [{ type: "error", text: "runtime failed" }],
      pageErrors: ["uncaught page error"],
      requestFailures: [
        {
          method: "GET",
          url: "http://keya.local/api/assets/missing",
          error: "net::ERR_FAILED",
        },
      ],
      dom: {
        elementCount: 24,
        interactiveCount: 2,
        landmarkCount: 1,
        visibleTextChars: 180,
      },
      interaction: [
        {
          action: "expectText",
          status: "failed" as const,
          detail: "文本未包含预期反馈",
        },
      ],
    };
    const result = await capturePageScreenshot(
      { pageId: "page-browser-diagnostics", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-browser-diagnostics",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
          },
          diagnostics,
        })),
      },
    );

    expect(result.evidence.captures[0]?.diagnostics).toEqual(diagnostics);
    expect(new Set(result.issues.map(({ code }) => code))).toEqual(
      new Set([
        "BROWSER_PAGE_ERROR",
        "BROWSER_CONSOLE_ERROR",
        "BROWSER_REQUEST_FAILED",
        "BROWSER_INTERACTION_STEP_FAILED",
      ]),
    );
  });

  it("rejects a page that promises interaction but renders no interactive DOM", async () => {
    const result = await capturePageScreenshot(
      {
        pageId: "page-required-interaction",
        html,
        requiresInteraction: true,
      },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-required-interaction",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
          },
          diagnostics: {
            console: [],
            pageErrors: [],
            requestFailures: [],
            dom: {
              elementCount: 20,
              interactiveCount: 0,
              landmarkCount: 1,
              visibleTextChars: 120,
            },
            interaction: [],
          },
        })),
      },
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BROWSER_REQUIRED_INTERACTION_MISSING",
          severity: "error",
        }),
      ]),
    );
  });

  it("rejects raw HTML markup that leaks into visible lesson copy", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-raw-markup", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-raw-markup",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
          },
          diagnostics: {
            console: [],
            pageErrors: [],
            requestFailures: [],
            dom: {
              elementCount: 20,
              interactiveCount: 0,
              landmarkCount: 1,
              visibleTextChars: 120,
              rawMarkupSamples: ['span class="highlight">'],
            },
            interaction: [],
          },
        })),
      },
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BROWSER_RAW_MARKUP_VISIBLE",
          severity: "error",
        }),
      ]),
    );
  });

  it("rejects buttons that have neither trusted runtime nor native form behavior", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-inert-button", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-inert-button",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
            inertButtonCount: 1,
          },
        })),
      },
    );

    expect(new Set(result.issues.map(({ code }) => code))).toEqual(
      new Set(["BROWSER_INERT_BUTTON"]),
    );
    expect(result.issues[0]).toMatchObject({
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
    });
  });

  it("rejects root and nested scrolling in the fixed 16:9 stage", async () => {
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
        "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
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
          location: expect.objectContaining({ viewport: "1280x720" }),
        }),
        expect.objectContaining({
          code: "BROWSER_NESTED_VERTICAL_OVERFLOW",
          severity: "error",
        }),
        expect.objectContaining({
          code: "BROWSER_VERTICAL_OVERFLOW",
          severity: "error",
          location: expect.objectContaining({ viewport: "640x360" }),
        }),
        expect.objectContaining({
          code: "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
          severity: "error",
        }),
      ]),
    );
  });

  it("keeps expected fixed-stage scaling observational but rejects authored overflow", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-readable-scale", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-readable-scale",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight:
              viewport.width < 640
                ? viewport.height * 2
                : Math.round(viewport.height / 0.78),
            verticalOverflowPx:
              viewport.width < 640
                ? viewport.height
                : Math.round(viewport.height / 0.78) - viewport.height,
            requiredViewportScale:
              viewport.width < 640 ? 0.5 : 0.78,
          },
        })),
      },
    );

    expect(
      result.issues.some(
        ({ code }) => code === "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      ),
    ).toBe(false);
    expect(
      result.issues.filter(
        ({ code }) => code === "BROWSER_VERTICAL_OVERFLOW",
      ),
    ).toHaveLength(3);
    expect(
      result.issues
        .filter(({ code }) => code === "BROWSER_VERTICAL_OVERFLOW")
        .every(({ severity }) => severity === "error"),
    ).toBe(true);
  });

  it("tolerates one-percent browser measurement drift at the readable scale boundary", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-readable-boundary", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-readable-boundary",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: Math.round(viewport.height / 0.716),
            verticalOverflowPx:
              Math.round(viewport.height / 0.716) - viewport.height,
            requiredViewportScale:
              viewport.width < 640 ? 0.5 : 0.716,
          },
        })),
      },
    );

    expect(
      result.issues.some(
        ({ code }) => code === "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      ),
    ).toBe(false);
  });

  it("accepts five-percent contain-fit headroom but rejects seven-percent overload", async () => {
    const captureAtRatio = (ratio: number) =>
      capturePageScreenshot(
        { pageId: `page-scale-${ratio}`, html },
        {
          enabled: true,
          rootDir: `/tmp/ai-course-generator-scale-${ratio}`,
          captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
            png: new Uint8Array([137, 80, 78, 71]),
            metrics: {
              ...cleanMetrics,
              documentWidth: viewport.width,
              documentHeight: viewport.height,
              requiredViewportScale:
                Math.min(1, viewport.width / 1920, viewport.height / 1080) *
                ratio,
            },
          })),
        },
      );

    const accepted = await captureAtRatio(0.95);
    const rejected = await captureAtRatio(0.93);
    expect(
      accepted.issues.some(
        ({ code }) => code === "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      ),
    ).toBe(false);
    expect(
      rejected.issues.filter(
        ({ code }) => code === "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      ),
    ).toHaveLength(3);
  });

  it("ignores at most eight pixels of line-box rounding overflow", async () => {
    const result = await capturePageScreenshot(
      {
        pageId: pageContentDsl.pageId,
        html,
        content: pageContentDsl,
      },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-rounding-screenshots",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height + 8,
            verticalOverflowPx: 8,
          },
        })),
      },
    );

    expect(
      result.issues.some(({ code }) => code === "BROWSER_VERTICAL_OVERFLOW"),
    ).toBe(false);
  });

  it("rejects a viewport-fitted document that silently exceeds the 16:9 authoring stage", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-stage-aspect-overflow", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-stage-aspect-overflow",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: 1920,
            documentHeight: 1096,
            verticalOverflowPx: 0,
            requiredViewportScale: viewport.height / 1096,
          },
        })),
      },
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
          severity: "error",
        }),
      ]),
    );
  });

  it("evaluates touch targets in authored CSS pixels", () => {
    expect(
      countAuthoredTouchTargets([
        { width: 22, height: 22 },
        { width: 20, height: 20 },
      ]),
    ).toEqual({
      touchTargetUnder24Count: 2,
      touchTargetUnder44Count: 2,
    });
    expect(
      countAuthoredTouchTargets([
        { width: 23.999_999, height: 24 },
      ]),
    ).toEqual({
      touchTargetUnder24Count: 0,
      touchTargetUnder44Count: 1,
    });
  });

  it("removes only the platform viewport-fit scale before evaluating touch targets", () => {
    expect(
      restoreAuthoredTouchTargetSizes(
        [
          { width: 12, height: 14 },
          { width: 22, height: 22 },
        ],
        0.5,
      ),
    ).toEqual([
      { width: 24, height: 28 },
      { width: 44, height: 44 },
    ]);
    expect(
      countAuthoredTouchTargets(
        restoreAuthoredTouchTargetSizes(
          [{ width: 12, height: 14 }],
          0.5,
        ),
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

    expect(enabled.evidence.captures[0]!.status).toBe("captured");
    expect(captureBrowser).toHaveBeenCalledTimes(3);
    expect(disabled.evidence.captures[0]!.status).toBe("skipped");
    expect(disabled.evidence.captures).toHaveLength(3);
  });

  it("任一视口取证失败都会作为 Browser Harness 瞬态故障重试", async () => {
    await expect(
      capturePageScreenshot(
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
            if (viewport.width === 960) {
              throw new Error("tablet rendering failed");
            }
            return {
              png: new Uint8Array([137, 80, 78, 71]),
              metrics: {
                ...cleanMetrics,
                documentWidth: viewport.width,
                documentHeight: viewport.height,
                horizontalOverflowPx: viewport.width === 640 ? 8 : 0,
              },
            };
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
      retryable: true,
    });
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
        viewport: "960x540",
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

    expect(result.evidence.captures[0]!.status).toBe("failed");
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

  it("截图超时和浏览器不可用都会抛出可重试的 Harness 故障", async () => {
    await expect(
      capturePageScreenshot(
        { pageId: "page-timeout", html },
        {
          enabled: true,
          timeoutMs: 5,
          captureBrowser: () => new Promise<never>(() => undefined),
        },
      ),
    ).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
      retryable: true,
    });
    await expect(
      capturePageScreenshot(
        { pageId: "page-unavailable", html },
        {
          enabled: true,
          captureBrowser: async () => {
            throw new Error("browserType.launch: Executable doesn't exist");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
      retryable: true,
    });
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

  it("allows an intentionally sparse course cover to keep its visual breathing room", async () => {
    const content = {
      ...pageContentDsl,
      functionalTemplateId: "course-cover" as const,
      blocks: [],
      interaction: {
        type: "navigate" as const,
        actionLabel: "开始学习",
        destination: "next" as const,
      },
      layoutHints: {
        ...pageContentDsl.layoutHints,
        contentDensity: "sparse" as const,
      },
    };
    const result = await capturePageScreenshot(
      { pageId: "page-cover", html, content },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-sparse-cover",
        captureBrowser: vi.fn().mockImplementation(async ({ viewport }) => ({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            ...cleanMetrics,
            documentWidth: viewport.width,
            documentHeight: viewport.height,
            visibleContentAreaRatio: 0.06,
            mainViewportCoverageRatio: 1,
          },
        })),
      },
    );

    expect(result.issues.map(({ code }) => code)).not.toContain(
      "BROWSER_FIRST_SCREEN_TOO_EMPTY",
    );
  });

  it("observes a required course illustration rendered as a tiny decoration", async () => {
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
          severity: "info",
          dimension: "assetUsability",
          location: expect.objectContaining({
            selector: '[data-asset-slot-id="asset-slot-01"]',
            viewport: "1280x720",
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

  it("includes naked SVG and canvas knowledge graphics as visual candidates", () => {
    const selectors = new Set(VISUAL_PROMINENCE_SELECTOR.split(","));

    expect(selectors.has("svg")).toBe(true);
    expect(selectors.has("canvas")).toBe(true);
  });

  it("does not render unsafe HTML in a browser", async () => {
    const captureBrowser = vi.fn();
    const result = await capturePageScreenshot(
      { pageId: "page-unsafe", html: `${html}<script>alert(1)</script>` },
      { enabled: true, captureBrowser },
    );

    expect(result.evidence.captures[0]!.status).toBe("skipped");
    expect(captureBrowser).not.toHaveBeenCalled();
  });
});
