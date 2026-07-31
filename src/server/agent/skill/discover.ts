import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { AgentResourceError } from "@/server/agent/skill/errors";
import { parseSkillDocument } from "@/server/agent/skill/parse";

export type DiscoveredProjectSkill = Readonly<{
  name: string;
  description: string;
  license?: string;
  metadata: Readonly<Record<string, string>>;
  absoluteDir: string;
  logicalDir: string;
  logicalSkillFile: string;
  resourcePaths: readonly string[];
  digest: string;
}>;

export async function discoverProjectSkills(
  skillRoot: string,
): Promise<readonly DiscoveredProjectSkill[]> {
  let absoluteRoot: string;
  try {
    absoluteRoot = await fs.realpath(skillRoot);
  } catch {
    throw new AgentResourceError(
      "SKILL_ROOT_MISSING",
      "项目 Agent Skill 资源根不存在或不可读。",
    );
  }

  const rootEntries = await fs.readdir(absoluteRoot, {
    withFileTypes: true,
  });
  const skills: DiscoveredProjectSkill[] = [];

  for (const entry of rootEntries.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink()) {
      throw new AgentResourceError(
        "SKILL_SYMLINK_DENIED",
        `Skill 根目录不允许符号链接：${entry.name}`,
      );
    }
    if (!entry.isDirectory()) continue;

    const absoluteDir = path.join(absoluteRoot, entry.name);
    const skillFile = path.join(absoluteDir, "SKILL.md");
    const skillFileStat = await safeLstat(skillFile, entry.name);
    if (!skillFileStat.isFile() || skillFileStat.isSymbolicLink()) {
      throw invalidDirectory(entry.name, "缺少普通文件 SKILL.md。");
    }

    const skillContent = await fs.readFile(skillFile, "utf8");
    const parsed = parseSkillDocument(
      skillContent,
      `${entry.name}/SKILL.md`,
    );
    if (parsed.name !== entry.name) {
      throw invalidDirectory(
        entry.name,
        `目录名必须与 frontmatter name ${parsed.name} 完全相同。`,
      );
    }

    const files = await collectSkillFiles(absoluteDir);
    const logicalDir = `agent/skills/${entry.name}`;
    const resourcePaths = files.map(
      ({ relativePath }) => `${logicalDir}/${relativePath}`,
    );
    const digest = digestFiles(files);

    skills.push(
      Object.freeze({
        ...parsed,
        absoluteDir,
        logicalDir,
        logicalSkillFile: `${logicalDir}/SKILL.md`,
        resourcePaths: Object.freeze(resourcePaths),
        digest,
      }),
    );
  }

  return Object.freeze(skills);
}

async function collectSkillFiles(
  absoluteDir: string,
  relativeDir = "",
): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const currentDir = path.join(absoluteDir, relativeDir);
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: Array<{ relativePath: string; content: Buffer }> = [];

  for (const entry of entries.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    const absolutePath = path.join(absoluteDir, relativePath);
    if (entry.isSymbolicLink()) {
      throw new AgentResourceError(
        "SKILL_SYMLINK_DENIED",
        `Skill 资源不允许符号链接：${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(
        ...(await collectSkillFiles(absoluteDir, relativePath)),
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new AgentResourceError(
        "SKILL_RESOURCE_INVALID",
        `Skill 资源必须是普通文件：${relativePath}`,
      );
    }
    files.push({
      relativePath,
      content: await fs.readFile(absolutePath),
    });
  }

  return files;
}

function digestFiles(
  files: readonly { relativePath: string; content: Buffer }[],
) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function safeLstat(skillFile: string, skillName: string) {
  try {
    return await fs.lstat(skillFile);
  } catch {
    throw invalidDirectory(skillName, "缺少 SKILL.md。");
  }
}

function invalidDirectory(skillName: string, message: string) {
  return new AgentResourceError(
    "SKILL_DIRECTORY_INVALID",
    `Skill ${skillName}：${message}`,
  );
}
