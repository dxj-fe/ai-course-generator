import { describe, expect, it } from "vitest";

import {
  AgentIds,
  SkillIds,
  ToolIds,
} from "../../../../src/server/agent/ids";
import {
  courseArchitectAgent,
  coursePageBuilderAgent,
  courseReviewerAgent,
  getAgentWorkOrderDefaults,
} from "../../../../src/server/agent/plugins";
import { createAgentSystem } from "../../../../src/server/setup/agent";
import { createProjectSkillRegistry } from "../../../../src/server/setup/skills";

describe("Agent Registry", () => {
  it("统一注册四类课程 Agent，并在装配后冻结", async () => {
    const skills = await createProjectSkillRegistry();
    const system = await createAgentSystem(skills);

    expect(system.agents.list().map(({ id }) => id)).toEqual([
      AgentIds.CourseArchitect,
      AgentIds.CourseDirector,
      AgentIds.CoursePageBuilder,
      AgentIds.CourseReviewer,
    ]);
    expect(system.agents.frozen).toBe(true);
    expect(system.contexts.frozen).toBe(true);
    expect(system.prompts.frozen).toBe(true);
    expect(system.schemas.frozen).toBe(true);
    expect(system.tools.frozen).toBe(true);
    expect(system.contexts.list()).toHaveLength(6);
    expect(system.schemas.list()).toHaveLength(8);
    expect(system.tools.list().length).toBeGreaterThan(25);
    expect(system.agents.get(AgentIds.CourseArchitect)).toBe(
      courseArchitectAgent,
    );
    expect(courseArchitectAgent.skills).toEqual([
      SkillIds.CourseDesign,
    ]);
    expect(courseArchitectAgent.tools).toContain(
      ToolIds.ReadLocalResource,
    );
    expect(courseArchitectAgent.runtime.timeoutMs).toBe(300_000);
    expect(coursePageBuilderAgent.skills).toEqual([
      SkillIds.CoursePageDesign,
    ]);
    expect(coursePageBuilderAgent.resourceSkills).toEqual([
      SkillIds.FrontendSlides,
    ]);
    expect(coursePageBuilderAgent.modelCapability).toBe("page-writer");
    expect(coursePageBuilderAgent.tools).toContain(
      ToolIds.ReadLocalResource,
    );
    expect(courseReviewerAgent.runtime.timeoutMs).toBe(300_000);
    const pageDefaults = getAgentWorkOrderDefaults(
      AgentIds.CoursePageBuilder,
    );
    expect(pageDefaults.allowedTools).toBe(
      coursePageBuilderAgent.tools,
    );
    expect(pageDefaults.budget).toBe(coursePageBuilderAgent.runtime);
    expect(() =>
      system.agents.register(courseArchitectAgent),
    ).toThrow("已冻结");
  });
});
