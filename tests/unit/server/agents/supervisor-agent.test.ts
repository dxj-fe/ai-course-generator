import { describe, expect, it, vi } from "vitest";

import { AiSchemaValidationError } from "../../../../src/server/ai/error";
import {
  runSupervisorAgent,
  type SupervisorInput,
} from "../../../../src/server/agents/supervisor-agent";

const input: SupervisorInput = {
  stateSummary: {
    status: "running",
    currentStage: "intent",
    readyToComplete: false,
    hasIntent: false,
    hasOutline: false,
    hasCourseDesign: false,
    pages: [],
  },
  availableNodes: [
    {
      target: { nodeName: "intent" },
      stage: "intent",
      agent: "intent",
      requiredInputs: ["userPrompt"],
      produces: ["intent", "planner stage"],
    },
  ],
  attempts: [],
};

describe("runSupervisorAgent", () => {
  it("returns a schema-validated decision without changing the input", async () => {
    const generateDecision = vi.fn(async () => ({
      action: "run",
      nextNode: { nodeName: "intent" },
      reasonSummary: "课程意图尚未生成，运行 Intent Agent。",
    }));

    const decision = await runSupervisorAgent(
      input,
      { traceId: "trace-day-23" },
      { generateDecision },
    );

    expect(decision).toEqual({
      action: "run",
      nextNode: { nodeName: "intent" },
      reasonSummary: "课程意图尚未生成，运行 Intent Agent。",
    });
    expect(generateDecision).toHaveBeenCalledWith({
      abortSignal: undefined,
      input,
      traceId: "trace-day-23",
    });
    expect(input.availableNodes).toHaveLength(1);
  });

  it("rejects structurally invalid model output", async () => {
    await expect(
      runSupervisorAgent(
        input,
        { traceId: "trace-day-23" },
        {
          generateDecision: async () => ({
            action: "run",
            nextNode: { nodeName: "invented-agent" },
            reasonSummary: "运行不存在的节点。",
          }),
        },
      ),
    ).rejects.toBeInstanceOf(AiSchemaValidationError);
  });
});
