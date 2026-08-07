import { describe, expect, it, vi } from "vitest";

import { CourseBrowserPool } from "../../../../src/server/infra/browser/browser-pool";

describe("CourseBrowserPool", () => {
  it("在冷却窗口内复用启动失败，避免每个页面反复拉起 Chromium", async () => {
    let now = 1_000;
    const launchBrowser = vi.fn().mockRejectedValue(new Error("launch failed"));
    const pool = new CourseBrowserPool({
      launchBrowser,
      now: () => now,
      retryDelayMs: 30_000,
    });

    await expect(pool.getBrowser()).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
    });
    await expect(pool.getBrowser()).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
    });
    expect(launchBrowser).toHaveBeenCalledOnce();

    now += 30_001;
    await expect(pool.getBrowser()).rejects.toMatchObject({
      code: "BROWSER_HARNESS_UNAVAILABLE",
    });
    expect(launchBrowser).toHaveBeenCalledTimes(2);
  });

  it("并发预检共享同一次浏览器启动", async () => {
    let resolveBrowser: ((browser: never) => void) | undefined;
    const browser = {
      close: vi.fn(),
      isConnected: vi.fn(() => true),
      once: vi.fn(),
    };
    const launchBrowser = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveBrowser = resolve as (browser: never) => void;
        }),
    );
    const pool = new CourseBrowserPool({ launchBrowser: launchBrowser as never });

    const first = pool.getBrowser();
    const second = pool.getBrowser();
    resolveBrowser?.(browser as never);

    await expect(first).resolves.toBe(browser);
    await expect(second).resolves.toBe(browser);
    expect(launchBrowser).toHaveBeenCalledOnce();
  });
});
