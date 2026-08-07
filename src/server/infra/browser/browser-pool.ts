import { chromium, type Browser } from "playwright";

import { toBrowserHarnessUnavailableError } from "./error";

const DEFAULT_LAUNCH_RETRY_DELAY_MS = 30_000;

type CourseBrowserPoolOptions = {
  launchBrowser?(): Promise<Browser>;
  now?(): number;
  retryDelayMs?: number;
};

/**
 * Course Worker 进程内只维护一个 Chromium。页面隔离由独立 BrowserContext
 * 提供，避免每次 render 都重新启动浏览器，同时不共享 cookie、缓存或页面状态。
 */
export class CourseBrowserPool {
  private browser?: Browser;
  private launching?: Promise<Browser>;
  private launchFailure?: {
    error: ReturnType<typeof toBrowserHarnessUnavailableError>;
    retryAt: number;
  };

  private readonly launchBrowser: () => Promise<Browser>;
  private readonly now: () => number;
  private readonly retryDelayMs: number;

  constructor(options: CourseBrowserPoolOptions = {}) {
    this.launchBrowser =
      options.launchBrowser ?? (() => chromium.launch({ headless: true }));
    this.now = options.now ?? Date.now;
    this.retryDelayMs =
      options.retryDelayMs ?? DEFAULT_LAUNCH_RETRY_DELAY_MS;
  }

  async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    if (
      this.launchFailure &&
      this.launchFailure.retryAt > this.now()
    ) {
      throw this.launchFailure.error;
    }

    this.launching = this.launchBrowser()
      .then((browser) => {
        this.launchFailure = undefined;
        this.browser = browser;
        browser.once("disconnected", () => {
          if (this.browser === browser) this.browser = undefined;
        });
        return browser;
      })
      .catch((cause) => {
        const error = toBrowserHarnessUnavailableError(cause);
        this.launchFailure = {
          error,
          retryAt: this.now() + this.retryDelayMs,
        };
        throw error;
      })
      .finally(() => {
        this.launching = undefined;
      });
    return this.launching;
  }

  async close() {
    const browser = this.browser ?? (await this.launching?.catch(() => undefined));
    this.browser = undefined;
    this.launching = undefined;
    this.launchFailure = undefined;
    if (browser?.isConnected()) await browser.close();
  }
}

const browserPoolGlobal = globalThis as typeof globalThis & {
  __keyaCourseBrowserPool?: CourseBrowserPool;
};

export function getCourseBrowser() {
  return (
    browserPoolGlobal.__keyaCourseBrowserPool ??= new CourseBrowserPool()
  ).getBrowser();
}

export async function closeCourseBrowser() {
  await browserPoolGlobal.__keyaCourseBrowserPool?.close();
  browserPoolGlobal.__keyaCourseBrowserPool = undefined;
}
