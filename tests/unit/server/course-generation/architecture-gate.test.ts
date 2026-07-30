import { describe, expect, it } from "vitest";

import { runArchitectureGate } from "../../../../src/server/course/gate/architecture";
import {
  createAgentV2Architecture,
  createAgentV2Brief,
  createAgentV2ReferencePack,
  AGENT_V2_COURSE_ID,
} from "../../../fixtures/agent-v2-course-architecture";

describe("Architecture Gate", () => {
  it("展示顺序不限制生成依赖：前一展示页可以依赖后一展示页", () => {
    const architecture = createAgentV2Architecture({
      reverseDisplayDependency: true,
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createAgentV2Brief(),
      referencePacks: [createAgentV2ReferencePack()],
      expectedCourseId: AGENT_V2_COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(
        result.architecture.pageTasks[0]?.buildDependsOnPageIds,
      ).toEqual(["page-summary"]);
      expect(result.architecture.pageTasks.map(({ order }) => order)).toEqual([
        1, 2, 3, 4,
      ]);
    }
  });
});
