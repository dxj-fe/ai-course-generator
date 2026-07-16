import { describe, expect, it } from "vitest";

import { runPromisePool } from "../../../../src/server/workflows/promise-pool";

describe("runPromisePool", () => {
  it("caps active work at the configured concurrency and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await runPromisePool(
      [30, 5, 20, 1],
      async (delay, index) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active -= 1;
        return `result-${index}`;
      },
      { concurrency: 2 },
    );

    expect(maxActive).toBe(2);
    expect(results).toEqual([
      { status: "fulfilled", value: "result-0" },
      { status: "fulfilled", value: "result-1" },
      { status: "fulfilled", value: "result-2" },
      { status: "fulfilled", value: "result-3" },
    ]);
  });

  it("isolates a rejected item and continues the remaining work", async () => {
    const started: number[] = [];
    const results = await runPromisePool(
      [0, 1, 2],
      async (value) => {
        started.push(value);
        if (value === 1) throw new Error("page failed");
        return value * 2;
      },
      { concurrency: 2 },
    );

    expect(started.sort()).toEqual([0, 1, 2]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 0 });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ message: "page failed" }),
    });
    expect(results[2]).toEqual({ status: "fulfilled", value: 4 });
  });

  it("does not start queued work after cancellation", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const results = await runPromisePool(
      [0, 1, 2],
      async (value) => {
        started.push(value);
        controller.abort();
        return value;
      },
      { concurrency: 1, signal: controller.signal },
    );

    expect(started).toEqual([0]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 0 });
    expect(results.slice(1).every(({ status }) => status === "rejected")).toBe(
      true,
    );
  });
});
