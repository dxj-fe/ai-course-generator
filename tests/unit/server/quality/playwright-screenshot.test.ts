import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { capturePageScreenshot } from "../../../../src/server/quality/playwright-screenshot";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const html = buildValidGeneratedHtml(pageContentDsl);

describe("Playwright screenshot QA evidence", () => {
  it("captures metrics, stores the PNG, and derives browser issues", async () => {
    const result = await capturePageScreenshot(
      { pageId: "page-qa/evidence", html },
      {
        enabled: true,
        rootDir: "/tmp/ai-course-generator-day-26-screenshots",
        now: () => "2026-07-16T10:00:00+08:00",
        captureBrowser: vi.fn().mockResolvedValue({
          png: new Uint8Array([137, 80, 78, 71]),
          metrics: {
            documentWidth: 1460,
            documentHeight: 900,
            horizontalOverflowPx: 20,
            clippedElementCount: 1,
            zeroSizeInteractiveCount: 1,
          },
        }),
      },
    );

    expect(result.evidence.status).toBe("captured");
    expect(result.evidence.artifactId).toMatch(/^page-qa-evidence-/);
    expect(result.issues.map(({ code }) => code)).toEqual([
      "BROWSER_HORIZONTAL_OVERFLOW",
      "BROWSER_CONTENT_CLIPPED",
      "BROWSER_ZERO_SIZE_INTERACTIVE",
    ]);
    await expect(readFile(result.serverPath!)).resolves.toEqual(
      Buffer.from([137, 80, 78, 71]),
    );
    expect(JSON.stringify(result.evidence)).not.toContain(result.serverPath);
  });

  it("records timeout and unavailable browser states without throwing", async () => {
    const timeout = await capturePageScreenshot(
      { pageId: "page-timeout", html },
      {
        enabled: true,
        timeoutMs: 5,
        captureBrowser: () => new Promise(() => undefined),
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
    expect(timeout.issues).toEqual([]);
    expect(unavailable.evidence.status).toBe("skipped");
    expect(unavailable.issues).toEqual([]);
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
