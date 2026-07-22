import { describe, expect, it } from "vitest";

import { createIntentNode } from "../../../../src/server/workflows/course-generation-nodes";
import { buildSupervisorInput } from "../../../../src/server/workflows/supervised-workflow";
import type { CourseGenerationState } from "../../../../src/shared/course-schema";

describe("Supervisor capability retrieval", () => {
  it("adds compact SkillCards to legal nodes without changing their target", () => {
    const input = buildSupervisorInput(
      {
        status: "running",
        currentStage: "intent",
        userPrompt: "生成太阳系课程",
        pages: [],
        events: [],
        errors: [],
        supervisor: { decisionCount: 0, attempts: [] },
      } as CourseGenerationState,
      [createIntentNode()],
      false,
      undefined,
    );

    expect(input.availableNodes[0]).toMatchObject({
      target: { nodeName: "intent" },
      skills: [
        {
          id: "interpret-course-intent",
          whenToUse: expect.any(Array),
          limitations: expect.any(Array),
        },
      ],
    });
  });
});
