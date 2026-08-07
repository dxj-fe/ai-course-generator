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
    expect(architect).toContain("不是挑模板");
    expect(architect).toContain("不要预先决定卡片数量");
    expect(architect).toContain("不规划 pageType、interactionType");
    expect(architect).toContain("Harness 会为旧投影补兼容默认值");

    const director = await system.prompts.render(
      PromptIds.CourseDirectorSystem,
      {},
    );
    expect(director).toContain("Course Lead");
    expect(director).toContain("Reviewer 的页面证据");
    expect(director).toContain("不选择模板");

    await expect(
      system.prompts.render(PromptIds.CourseArchitectSystem, {}),
    ).rejects.toThrow("缺少 availableSkills");
  });

  it("Page Builder Prompt 明确文件编辑与浏览器观察循环", async () => {
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

    expect(prompt).toContain("edit_page_workspace");
    expect(prompt).toContain("render_page");
    expect(prompt).toContain("不存在强制 data 标记");
    expect(prompt).toContain("QA 只用于发现具体缺口");
    expect(prompt).toContain("# 课程页面设计");
    expect(prompt).toContain("read_local_resource");
    expect(prompt).toContain("当前 pageId：page-02");
  });
});
