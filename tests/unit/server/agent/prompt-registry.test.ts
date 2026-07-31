import { describe, expect, it } from "vitest";

import { PromptIds } from "../../../../src/server/agent/ids";
import { createAgentSystem } from "../../../../src/server/setup/agent";
import { createProjectSkillRegistry } from "../../../../src/server/setup/skills";

describe("Prompt Registry", () => {
  it("从统一 Registry 加载版本化 Prompt，并严格校验模板变量", async () => {
    const skills = await createProjectSkillRegistry();
    const system = await createAgentSystem(skills);

    expect(system.prompts.list()).toHaveLength(20);
    expect(system.prompts.frozen).toBe(true);

    const architect = await system.prompts.render(
      PromptIds.CourseArchitectSystem,
      {
        availableSkills: "<available_skills />",
        skillInstructions: "# 课程设计",
      },
    );
    expect(architect).toContain("<available_skills />");
    expect(architect).toContain("# 课程设计");
    expect(architect).toContain("验证用于发现遗漏，不代替课程设计");

    await expect(
      system.prompts.render(PromptIds.CourseArchitectSystem, {}),
    ).rejects.toThrow("缺少 availableSkills");
  });

  it("Page Builder Prompt 明确首轮生成优先于默认 Repair", async () => {
    const skills = await createProjectSkillRegistry();
    const system = await createAgentSystem(skills);

    const prompt = await system.prompts.render(
      PromptIds.CoursePageBuilderSystem,
      {
        availableSkills: "<available_skills />",
        pageId: "page-02",
        skillInstructions: "# 课程页面设计",
      },
    );

    expect(prompt).toContain("第一次就产出");
    expect(prompt).toContain("不要把 QA 和 Repair 当作默认创作流程");
    expect(prompt).toContain("# 课程页面设计");
    expect(prompt).toContain("read_local_resource");
    expect(prompt).toContain("当前 pageId：page-02");
  });
});
