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
    expect(architect).toContain(
      "`coursePack.facts` 要保留事实的适用条件、观察对象、相对变化和可观察结果",
    );
    expect(architect).toContain("不能用“被消耗”替代机制");
    expect(architect).toContain("精确范围、倍数和阈值");
    expect(architect).toContain(
      "reveal/explore 页的 `teachingPoints` 就是学习者实际观察的关系锚点",
    );
    expect(architect).toContain("每个视觉通道只承担一种关键含义");
    expect(architect).toContain("箭头只表示传播方向");

    const director = await system.prompts.render(
      PromptIds.CourseDirectorSystem,
      {},
    );
    expect(director).toContain("无引用且不可推导的精确倍数");
    expect(director).toContain("从源头沿一条路径追到接收者");
    expect(director).toContain("接收者接到错误分支");
    expect(director).toContain("不能因为主题属于自然现象");

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

    expect(prompt).toContain("第一次就把它做成");
    expect(prompt).toContain("QA 只用于发现首稿的具体缺口");
    expect(prompt).toContain("# 课程页面设计");
    expect(prompt).toContain("read_local_resource");
    expect(prompt).toContain("当前 pageId：page-02");
  });
});
