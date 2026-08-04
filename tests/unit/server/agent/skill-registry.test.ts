import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SkillIds } from "../../../../src/server/agent/ids";
import {
  AgentResourceError,
  SkillRegistry,
} from "../../../../src/server/agent/skill";
import { createProjectSkillRegistry } from "../../../../src/server/setup/skills";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("项目 Agent Skill Registry", () => {
  it("只公开 metadata 和逻辑路径，不公开宿主绝对路径", async () => {
    const registry = await createProjectSkillRegistry();
    const skill = registry.get(SkillIds.CourseDesign);
    const catalog = registry.catalog([SkillIds.CourseDesign]);

    expect(skill.name).toBe("course-design");
    expect(skill.description).toContain("课程架构");
    expect(skill.logicalSkillFile).toBe(
      "agent/skills/course-design/SKILL.md",
    );
    expect(skill.resourcePaths).toContain(
      "agent/skills/course-design/references/objective-evidence.md",
    );
    expect(skill.digest).toMatch(/^[a-f0-9]{64}$/);
    const pageDesign = registry.get(SkillIds.CoursePageDesign);
    expect(pageDesign.description).toContain("固定播放器画布");
    expect(pageDesign.resourcePaths).toContain(
      "agent/skills/course-page-design/references/learning-interactions.md",
    );
    const frontendSlides = registry.get(SkillIds.FrontendSlides);
    expect(frontendSlides.description).toContain(
      "animation-rich HTML presentations",
    );
    expect(frontendSlides.resourcePaths).toContain(
      "agent/skills/frontend-slides/STYLE_PRESETS.md",
    );
    expect(frontendSlides.resourcePaths).toContain(
      "agent/skills/frontend-slides/bold-template-pack/selection-index.json",
    );
    expect(frontendSlides.resourcePaths).toContain(
      "agent/skills/frontend-slides/scripts/export-pdf.sh",
    );
    expect(JSON.stringify({ skill, catalog })).not.toContain(
      process.cwd(),
    );
  });

  it("资源目录与 SkillIds 必须双向完全对应", async () => {
    const skillRoot = await createSkillRoot();
    await writeSkill(skillRoot, "extra-skill");
    const registry = new SkillRegistry({
      skillRoot,
      declaredIds: [SkillIds.CourseDesign],
    });

    await expect(registry.initialize()).rejects.toMatchObject({
      code: "SKILL_RESOURCE_MISSING",
    } satisfies Partial<AgentResourceError>);

    await writeSkill(skillRoot, "course-design");
    const hasUndeclaredDirectory = new SkillRegistry({
      skillRoot,
      declaredIds: [SkillIds.CourseDesign],
    });
    await expect(
      hasUndeclaredDirectory.initialize(),
    ).rejects.toMatchObject({
      code: "SKILL_ID_UNDECLARED",
    } satisfies Partial<AgentResourceError>);
  });

  it("拒绝目录名与 frontmatter name 不一致", async () => {
    const skillRoot = await createSkillRoot();
    await writeSkill(skillRoot, "course-design", "other-name");
    const registry = new SkillRegistry({
      skillRoot,
      declaredIds: [SkillIds.CourseDesign],
    });

    await expect(registry.initialize()).rejects.toMatchObject({
      code: "SKILL_DIRECTORY_INVALID",
    } satisfies Partial<AgentResourceError>);
  });
});

async function createSkillRoot() {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), "keya-skill-registry-test-"),
  );
  temporaryDirectories.push(projectRoot);
  const skillRoot = path.join(projectRoot, "skills");
  await mkdir(skillRoot, { recursive: true });
  return skillRoot;
}

async function writeSkill(
  skillRoot: string,
  directoryName: string,
  frontmatterName = directoryName,
) {
  const skillDir = path.join(skillRoot, directoryName);
  await mkdir(skillDir);
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${frontmatterName}
description: 为测试设计课程。设计新课程或修订课程架构时使用。
---

# 测试 Skill
`,
    "utf8",
  );
}
