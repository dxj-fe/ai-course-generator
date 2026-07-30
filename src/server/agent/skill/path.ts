import path from "node:path";

import type { SkillId } from "@/server/agent/ids";
import { AgentResourceError } from "@/server/agent/skill/errors";

const LOGICAL_PREFIX = "agent/skills/";

export type ParsedAgentResourcePath = Readonly<{
  skillId: string;
  relativePath: string;
  logicalPath: string;
}>;

export function parseAgentResourcePath(
  rawPath: string,
): ParsedAgentResourcePath {
  if (
    !rawPath ||
    rawPath.includes("\0") ||
    rawPath.includes("\\") ||
    path.posix.isAbsolute(rawPath)
  ) {
    throw denied("本地资源路径格式无效。");
  }
  if (
    rawPath.split("/").some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    throw denied("本地资源路径不能包含空段、. 或 ..。");
  }
  if (!rawPath.startsWith(LOGICAL_PREFIX)) {
    throw denied("只允许读取 agent/skills 下的项目 Agent Skill。");
  }

  const remainder = rawPath.slice(LOGICAL_PREFIX.length);
  const separator = remainder.indexOf("/");
  if (separator <= 0 || separator === remainder.length - 1) {
    throw denied("本地资源路径必须指向 Skill 内的具体文件。");
  }

  return Object.freeze({
    skillId: remainder.slice(0, separator),
    relativePath: remainder.slice(separator + 1),
    logicalPath: rawPath,
  });
}

export function buildSkillLogicalPath(
  skillId: SkillId,
  relativePath: string,
) {
  const logicalPath = `${LOGICAL_PREFIX}${skillId}/${relativePath}`;
  return parseAgentResourcePath(logicalPath).logicalPath;
}

export function isPathInside(parent: string, target: string) {
  const relative = path.relative(parent, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function denied(message: string) {
  return new AgentResourceError("LOCAL_RESOURCE_PATH_DENIED", message);
}
