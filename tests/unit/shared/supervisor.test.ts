import { describe, expect, it } from "vitest";

import {
  SupervisorDecisionSchema,
  SupervisorRuntimeStateSchema,
  targetKey,
} from "../../../src/shared/course-schema";

describe("Day 23 supervisor schemas", () => {
  it("accepts run, retry, complete, and stop decisions", () => {
    const pageTarget = {
      nodeName: "html-engineer" as const,
      pageId: "page-01-cover",
    };

    expect(
      SupervisorDecisionSchema.parse({
        action: "run",
        nextNode: { nodeName: "intent" },
        reasonSummary: "课程意图尚未生成，先运行 Intent Agent。",
      }).action,
    ).toBe("run");
    expect(
      SupervisorDecisionSchema.parse({
        action: "retry",
        nextNode: pageTarget,
        retryTarget: pageTarget,
        reasonSummary: "HTML 生成遇到暂时错误，预算允许再次执行。",
      }).action,
    ).toBe("retry");
    expect(
      SupervisorDecisionSchema.parse({
        action: "complete",
        reasonSummary: "全部页面已经完成，可以结束课程生成。",
      }).action,
    ).toBe("complete");
    expect(
      SupervisorDecisionSchema.parse({
        action: "stop",
        reasonSummary: "节点重试预算已经耗尽，停止自动执行。",
        stopReason: {
          code: "retry_exhausted",
          message: "HTML Engineer 已达到最大执行次数。",
          recoverable: true,
        },
      }).action,
    ).toBe("stop");
  });

  it("rejects a retry whose next node differs from its retry target", () => {
    const result = SupervisorDecisionSchema.safeParse({
      action: "retry",
      nextNode: { nodeName: "assets", pageId: "page-01-cover" },
      retryTarget: {
        nodeName: "html-engineer",
        pageId: "page-01-cover",
      },
      reasonSummary: "错误目标不一致。",
    });

    expect(result.success).toBe(false);
  });

  it("bounds persisted attempts and keeps target keys page-scoped", () => {
    expect(
      SupervisorRuntimeStateSchema.safeParse({
        decisionCount: 1,
        attempts: [
          {
            nodeName: "page-writer",
            pageId: "page-01-cover",
            attempts: 4,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      targetKey({ nodeName: "page-writer", pageId: "page-01-cover" }),
    ).not.toBe(
      targetKey({ nodeName: "page-writer", pageId: "page-02-summary" }),
    );
  });
});
