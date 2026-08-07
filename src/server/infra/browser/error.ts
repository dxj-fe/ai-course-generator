export class BrowserHarnessUnavailableError extends Error {
  readonly code = "BROWSER_HARNESS_UNAVAILABLE";
  readonly retryable = true;

  constructor(readonly originalError?: unknown) {
    super(
      "Browser Harness 暂时不可用，课程任务将保留检查点并等待 Worker 恢复。",
    );
    this.name = "BrowserHarnessUnavailableError";
  }
}

export function isBrowserHarnessUnavailableError(
  error: unknown,
): error is BrowserHarnessUnavailableError {
  return (
    error instanceof BrowserHarnessUnavailableError ||
    (error instanceof Error &&
      (error.name === "BrowserHarnessUnavailableError" ||
        ("code" in error && error.code === "BROWSER_HARNESS_UNAVAILABLE")))
  );
}

export function isBrowserProcessFailure(error: unknown) {
  if (isBrowserHarnessUnavailableError(error)) return true;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`.toLowerCase()
      : String(error).toLowerCase();
  return [
    "browsertype.launch",
    "browser has been closed",
    "browser closed",
    "target page, context or browser has been closed",
    "failed to launch",
    "machportrendezvousserver",
  ].some((signature) => message.includes(signature));
}

export function toBrowserHarnessUnavailableError(error: unknown) {
  return isBrowserHarnessUnavailableError(error)
    ? error
    : new BrowserHarnessUnavailableError(error);
}
