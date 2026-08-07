import { describe, expect, it } from "vitest";

import {
  AGENT_ATTEMPT_LEASE_GRACE_MS,
  RUN_LEASE_MS,
  workOrderLeaseDuration,
} from "../../../../src/server/course/run/engine-support";
import type { WorkOrder } from "../../../../src/shared/course-schema";

describe("CourseRun lease 预算", () => {
  it("空闲领取只保留短租约，避免进程中断后固定等待十五分钟", () => {
    expect(RUN_LEASE_MS).toBe(2 * 60_000);
  });

  it("执行期租约覆盖 Agent 总预算并保留一分钟收尾时间", () => {
    const workOrder = {
      budget: { timeoutMs: 300_000 },
    } as WorkOrder;

    expect(workOrderLeaseDuration(workOrder)).toBe(
      workOrder.budget.timeoutMs + AGENT_ATTEMPT_LEASE_GRACE_MS,
    );
  });
});
