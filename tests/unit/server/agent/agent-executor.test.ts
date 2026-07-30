import { describe, expect, it, vi } from "vitest";

import {
  AgentExecutor,
  AgentIds,
} from "../../../../src/server/agent";

describe("Agent Executor", () => {
  it("只按 WorkOrder 指定的 AgentId 分派，不依赖业务步骤分支", async () => {
    const architect = vi.fn();
    const reviewer = vi.fn();
    const executor = new AgentExecutor<{ workOrderId: string }>()
      .register(AgentIds.CourseArchitect, architect)
      .register(AgentIds.CourseReviewer, reviewer)
      .freeze();

    await executor.execute(AgentIds.CourseReviewer, {
      workOrderId: "work-order-review",
    });

    expect(reviewer).toHaveBeenCalledWith({
      workOrderId: "work-order-review",
    });
    expect(architect).not.toHaveBeenCalled();
    expect(executor.frozen).toBe(true);
  });

  it("拒绝重复注册和运行期替换", () => {
    const executor = new AgentExecutor()
      .register(AgentIds.CourseArchitect, () => undefined);

    expect(() =>
      executor.register(AgentIds.CourseArchitect, () => undefined),
    ).toThrow("重复注册");

    executor.freeze();
    expect(() =>
      executor.register(AgentIds.CourseReviewer, () => undefined),
    ).toThrow("已冻结");
  });
});
