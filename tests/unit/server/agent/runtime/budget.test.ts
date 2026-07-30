import { describe, expect, it } from "vitest";

import {
  AgentBudgetExceededError,
  AtomicBudgetMeter,
} from "../../../../../src/server/agent/runtime/budget";

describe("AtomicBudgetMeter", () => {
  it("同一步并发 reserve 不会超卖", async () => {
    const meter = new AtomicBudgetMeter({ maxToolCalls: 2 });
    const reservations = await Promise.allSettled(
      ["tool-a", "tool-b", "tool-c"].map(async (toolName) => {
        await Promise.resolve();
        return meter.reserve(toolName);
      }),
    );

    expect(
      reservations.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(2);
    const rejected = reservations.find(
      ({ status }) => status === "rejected",
    );
    expect(rejected).toMatchObject({
      reason: expect.any(AgentBudgetExceededError),
      status: "rejected",
    });
    expect(meter.snapshot()).toEqual({
      maxCostUnits: 2,
      maxToolCalls: 2,
      remainingCostUnits: 0,
      remainingToolCalls: 0,
      reservedCostUnits: 2,
      reservedToolCalls: 2,
    });
  });

  it("同时限制工具次数和成本单位", () => {
    const meter = new AtomicBudgetMeter({
      maxCostUnits: 3,
      maxToolCalls: 5,
    });

    meter.reserve("cheap-tool", 1);
    meter.reserve("expensive-tool", 2);

    expect(() => meter.reserve("another-tool", 1)).toThrow(
      AgentBudgetExceededError,
    );
    expect(meter.snapshot()).toMatchObject({
      remainingCostUnits: 0,
      remainingToolCalls: 3,
      reservedCostUnits: 3,
      reservedToolCalls: 2,
    });
  });
});
