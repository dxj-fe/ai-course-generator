import { describe, expect, it } from "vitest";

import { courseGenerationToSeacaRun } from "../../../src/features/course-planner/lib/course-generation-adapter";
import type { CourseGenerationResponse } from "../../../src/features/course-planner/lib/course-planner-api";
import { CourseGenerationStateSchema } from "../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
} from "../../fixtures/course-design";

describe("course generation adapter", () => {
  it("maps the current batch attempt into existing Seaca stages", () => {
    const state = CourseGenerationStateSchema.parse({
      version: 1,
      courseId: "course-123e4567-e89b-42d3-a456-426614174000",
      traceId: "trace-current",
      userPrompt: "生成三页太阳系课程",
      status: "failed",
      currentStage: "design",
      intent: courseDesignIntent,
      outline: courseDesignOutline,
      pages: [],
      events: [
        {
          id: "event-old",
          sequence: 1,
          type: "validation",
          traceId: "trace-old",
          timestamp: "2026-07-15T01:00:00.000Z",
          step: 1,
          summary: "旧尝试不应进入当前 UI",
          stage: "design",
          agent: "visual",
        },
        {
          id: "event-current",
          sequence: 2,
          type: "error",
          traceId: "trace-current",
          timestamp: "2026-07-15T02:00:00.000Z",
          step: 1,
          summary: "Visual Agent failed",
          stage: "design",
          agent: "visual",
        },
      ],
      errors: [
        {
          stage: "design",
          code: "COURSE_DESIGN_FAILED",
          message: "Visual Agent failed",
        },
      ],
      startedAt: "2026-07-15T01:00:00.000Z",
      updatedAt: "2026-07-15T02:00:00.000Z",
      completedAt: "2026-07-15T02:00:00.000Z",
      durationMs: 3_600_000,
    });
    const response: CourseGenerationResponse = {
      courseId: state.courseId,
      traceId: state.traceId,
      state,
    };

    const run = courseGenerationToSeacaRun(response, {
      id: "run-1",
      prompt: state.userPrompt,
      startedAt: Date.parse(state.startedAt),
    });

    expect(run.planner.status).toBe("completed");
    expect(run.design.status).toBe("failed");
    expect(run.design.error).toBe("Visual Agent failed");
    expect(run.design.events.map(({ summary }) => summary)).toEqual([
      "Visual Agent failed",
    ]);
    expect(run.courseId).toBe(state.courseId);
    expect(run.generation).toBe(state);
  });
});
