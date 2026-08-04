import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentIds,
  SkillIds,
} from "../../../../src/server/agent/ids";
import {
  AgentResourceError,
  LocalResourceSession,
} from "../../../../src/server/agent/skill";
import { readLocalAgentResource } from "../../../../src/server/infra/file/safe-reader";
import { createProjectSkillRegistry } from "../../../../src/server/setup/skills";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("read_local_resource 安全读取", () => {
  it("按 SKILL.md 指引渐进读取引用，并按 digest 去重", async () => {
    const registry = await createProjectSkillRegistry();
    const session = createSession();

    const skill = await readLocalAgentResource({
      path: "agent/skills/course-design/SKILL.md",
      registry,
      session,
    });
    expect(skill.content).toContain("按需读取");
    expect(skill.alreadyRead).toBe(false);
    expect(session.activatedSkillIds).toEqual([
      SkillIds.CourseDesign,
    ]);

    const reference = await readLocalAgentResource({
      path: "agent/skills/course-design/references/course-structure.md",
      registry,
      session,
    });
    expect(reference.content).toContain("生成依赖");

    const duplicate = await readLocalAgentResource({
      path: "agent/skills/course-design/references/course-structure.md",
      registry,
      session,
    });
    expect(duplicate.alreadyRead).toBe(true);
    expect(duplicate.content).toBeUndefined();
    expect(session.consumedBytes).toBe(skill.bytes + reference.bytes);
    expect(session.loadedResources).toEqual([
      expect.objectContaining({
        logicalPath: "agent/skills/course-design/SKILL.md",
        content: expect.stringContaining("按需读取"),
      }),
      expect.objectContaining({
        logicalPath:
          "agent/skills/course-design/references/course-structure.md",
        content: expect.stringContaining("生成依赖"),
      }),
    ]);
  });

  it.each([
    "/etc/passwd",
    "../package.json",
    "agent/skills/course-design/../../../../.env",
    "agent/skills/not-granted/SKILL.md",
    "agent/skills/course-design",
  ])("拒绝越权路径：%s", async (logicalPath) => {
    const registry = await createProjectSkillRegistry();
    const session = createSession();

    await expect(
      readLocalAgentResource({
        path: logicalPath,
        registry,
        session,
      }),
    ).rejects.toBeInstanceOf(AgentResourceError);
    expect(session.records.at(-1)).toMatchObject({
      logicalPath,
      result: "denied",
    });
  });

  it("启动发现阶段拒绝 Skill 中的符号链接", async () => {
    const projectRoot = await mkdtemp(
      path.join(tmpdir(), "keya-skill-symlink-test-"),
    );
    temporaryDirectories.push(projectRoot);
    const skillDir = path.join(
      projectRoot,
      "resources/agent/skills/course-design",
    );
    await mkdir(path.join(skillDir, "references"), {
      recursive: true,
    });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: course-design
description: 为测试设计课程。设计新课程或修订课程架构时使用。
---

# 测试
`,
      "utf8",
    );
    await symlink(
      path.join(projectRoot, "secret.txt"),
      path.join(skillDir, "references/escaped.txt"),
    );
    await writeFile(path.join(projectRoot, "secret.txt"), "secret");

    await expect(
      createProjectSkillRegistry({ projectRoot }),
    ).rejects.toMatchObject({
      code: "SKILL_SYMLINK_DENIED",
    } satisfies Partial<AgentResourceError>);
  });

  it("可按文本资源读取 frontend-slides 的 CSS 画布基线", async () => {
    const registry = await createProjectSkillRegistry();
    const session = new LocalResourceSession({
      agentId: AgentIds.CoursePageBuilder,
      workOrderId: "work-order-frontend-slides-css",
      skillIds: [SkillIds.FrontendSlides],
      maxFileBytes: 128 * 1024,
      maxSessionBytes: 512 * 1024,
      maxReadCount: 10,
      allowedMediaTypes: ["text/markdown", "text/css"],
    });

    await readLocalAgentResource({
      path: "agent/skills/frontend-slides/SKILL.md",
      registry,
      session,
    });
    const stylesheet = await readLocalAgentResource({
      path: "agent/skills/frontend-slides/viewport-base.css",
      registry,
      session,
    });

    expect(stylesheet.mediaType).toBe("text/css");
    expect(stylesheet.content).toContain(".deck-stage");
  });
});

function createSession() {
  return new LocalResourceSession({
    agentId: AgentIds.CourseArchitect,
    workOrderId: "work-order-test",
    skillIds: [SkillIds.CourseDesign],
    maxFileBytes: 128 * 1024,
    maxSessionBytes: 512 * 1024,
    maxReadCount: 10,
    allowedMediaTypes: ["text/markdown"],
  });
}
