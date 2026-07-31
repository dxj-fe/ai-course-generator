import { parse } from "yaml";

import { AgentResourceError } from "@/server/agent/skill/errors";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ParsedSkillDocument = Readonly<{
  name: string;
  description: string;
  license?: string;
  metadata: Readonly<Record<string, string>>;
}>;

export function parseSkillDocument(
  content: string,
  sourceName: string,
): ParsedSkillDocument {
  const frontmatter = extractFrontmatter(content, sourceName);
  let raw: unknown;
  try {
    raw = parse(frontmatter);
  } catch {
    throw invalidSkill(sourceName, "YAML frontmatter 无法解析。");
  }
  if (!isRecord(raw)) {
    throw invalidSkill(sourceName, "frontmatter 必须是对象。");
  }

  const name = readRequiredString(raw, "name", sourceName);
  if (
    name.length > 64 ||
    !SKILL_NAME_PATTERN.test(name) ||
    name.includes("--")
  ) {
    throw invalidSkill(
      sourceName,
      "name 必须是 1～64 位小写字母、数字和单连字符组成的 kebab-case。",
    );
  }

  const description = readRequiredString(
    raw,
    "description",
    sourceName,
  );
  if (description.length > 1024) {
    throw invalidSkill(sourceName, "description 不能超过 1024 个字符。");
  }

  const license = readOptionalString(raw, "license", sourceName);

  const metadataValue = raw.metadata;
  const metadata: Record<string, string> = {};
  if (metadataValue !== undefined) {
    if (!isRecord(metadataValue)) {
      throw invalidSkill(sourceName, "metadata 必须是字符串键值对象。");
    }
    for (const [key, value] of Object.entries(metadataValue)) {
      if (typeof value !== "string") {
        throw invalidSkill(
          sourceName,
          `metadata.${key} 必须是字符串。`,
        );
      }
      metadata[key] = value;
    }
  }

  return Object.freeze({
    name,
    description,
    ...(license ? { license } : {}),
    metadata: Object.freeze(metadata),
  });
}

function extractFrontmatter(content: string, sourceName: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw invalidSkill(
      sourceName,
      "SKILL.md 必须以 YAML frontmatter 开始。",
    );
  }
  const end = lines.indexOf("---", 1);
  if (end < 2) {
    throw invalidSkill(
      sourceName,
      "SKILL.md 缺少结束 frontmatter 的 ---。",
    );
  }
  return lines.slice(1, end).join("\n");
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
) {
  const result = readOptionalString(value, key, sourceName);
  if (!result) {
    throw invalidSkill(sourceName, `${key} 不能为空。`);
  }
  return result;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
) {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") {
    throw invalidSkill(sourceName, `${key} 必须是字符串。`);
  }
  return field.trim();
}

function invalidSkill(sourceName: string, message: string) {
  return new AgentResourceError(
    "SKILL_DOCUMENT_INVALID",
    `${sourceName}：${message}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
