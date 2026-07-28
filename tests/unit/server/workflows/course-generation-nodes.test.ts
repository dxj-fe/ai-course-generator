import { describe, expect, it, vi } from "vitest";

import {
  createIntentNode,
  type CourseGenerationNodeDependencies,
} from "../../../../src/server/workflows/course-generation-nodes";
import {
  CourseGenerationStateSchema,
} from "../../../../src/shared/course-schema";
import { courseDesignIntent } from "../../../fixtures/course-design";

describe("course generation nodes", () => {
  it("keeps the content-driven intent length instead of clamping it to five", async () => {
    const node = createIntentNode();
    const state = CourseGenerationStateSchema.parse({
      version: 1,
      courseId: "course-dynamic-length",
      traceId: "trace-dynamic-length",
      userPrompt: "系统讲清楚操作系统原理并穿插练习",
      status: "running",
      currentStage: "intent",
      pages: [],
      events: [],
      errors: [],
      startedAt: "2026-07-24T08:00:00.000Z",
      updatedAt: "2026-07-24T08:00:00.000Z",
    });
    const dependencies = {
      generateIntent: vi.fn(async () => ({
        ...courseDesignIntent,
        courseLength: 8,
      })),
    } as unknown as CourseGenerationNodeDependencies;

    const result = await node.run(state, {
      runtime: { traceId: state.traceId },
      dependencies,
    });

    expect(result.patch.intent?.courseLength).toBe(8);
    expect(result.events?.[0]?.summary).toContain("8 节");
  });
});
