import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { SkillId } from "@/server/agent/ids";
import {
  AgentResourceError,
  LocalResourceSession,
  parseAgentResourcePath,
  type LocalResourceReadRecord,
  type SkillRegistry,
} from "@/server/agent/skill";
import { isPathInside } from "@/server/agent/skill/path";

const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".csv": "text/csv",
  ".css": "text/css",
  ".json": "application/json",
  ".js": "text/javascript",
  ".md": "text/markdown",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
  ".txt": "text/plain",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
});

export type LocalResourceReadResult = Readonly<{
  logicalPath: string;
  mediaType: string;
  digest: string;
  bytes: number;
  alreadyRead: boolean;
  content?: string;
}>;

export async function readLocalAgentResource(input: {
  path: string;
  registry: SkillRegistry;
  session: LocalResourceSession;
  audit?: (record: LocalResourceReadRecord) => void;
}): Promise<LocalResourceReadResult> {
  try {
    const parsed = parseAgentResourcePath(input.path);
    const skillId = parsed.skillId as SkillId;
    input.session.assertSkillGranted(skillId);
    const resource = input.registry.resolve(
      skillId,
      parsed.relativePath,
    );

    const fileStat = await fs.lstat(resource.absolutePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw denied("本地资源只能读取普通文件。");
    }

    const [realFile, realSkillDir] = await Promise.all([
      fs.realpath(resource.absolutePath),
      fs.realpath(resource.absoluteSkillDir),
    ]);
    if (!isPathInside(realSkillDir, realFile)) {
      throw denied("本地资源真实路径超出已授权 Skill。");
    }
    if (fileStat.size > input.session.grant.maxFileBytes) {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_FILE_LIMIT_EXCEEDED",
        "本地资源文件超过单文件读取上限。",
      );
    }

    const mediaType = resolveMediaType(resource.absolutePath);
    if (!input.session.grant.allowedMediaTypes.includes(mediaType)) {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_MEDIA_TYPE_DENIED",
        `当前 Agent 不允许读取 ${mediaType} 资源。`,
      );
    }

    const bytes = await fs.readFile(realFile);
    if (bytes.byteLength > input.session.grant.maxFileBytes) {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_FILE_LIMIT_EXCEEDED",
        "本地资源文件超过单文件读取上限。",
      );
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AgentResourceError(
        "LOCAL_RESOURCE_ENCODING_INVALID",
        "本地资源不是有效的 UTF-8 文本。",
      );
    }

    const digest = createHash("sha256").update(bytes).digest("hex");
    const { duplicate } = input.session.recordRead({
      skillId,
      logicalPath: parsed.logicalPath,
      digest,
      bytes: bytes.byteLength,
      isSkillEntry: parsed.relativePath === "SKILL.md",
      content,
    });
    const record = input.session.records.at(-1);
    if (record) input.audit?.(record);

    return Object.freeze({
      logicalPath: parsed.logicalPath,
      mediaType,
      digest,
      bytes: bytes.byteLength,
      alreadyRead: duplicate,
      ...(!duplicate ? { content } : {}),
    });
  } catch (error) {
    const resourceError =
      error instanceof AgentResourceError
        ? error
        : new AgentResourceError(
            "LOCAL_RESOURCE_READ_FAILED",
            "本地资源不存在或不可读。",
          );
    input.session.recordDenied(input.path, resourceError.code);
    const record = input.session.records.at(-1);
    if (record) input.audit?.(record);
    throw resourceError;
  }
}

function resolveMediaType(absolutePath: string) {
  const mediaType = MEDIA_TYPES[path.extname(absolutePath).toLowerCase()];
  if (!mediaType) {
    throw new AgentResourceError(
      "LOCAL_RESOURCE_MEDIA_TYPE_UNSUPPORTED",
      "本地资源类型不支持直接注入模型上下文。",
    );
  }
  return mediaType;
}

function denied(message: string) {
  return new AgentResourceError("LOCAL_RESOURCE_PATH_DENIED", message);
}
