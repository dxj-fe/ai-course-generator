import path from "node:path";

export const AGENT_RESOURCE_ROOT = "resources/agent";
export const AGENT_SKILL_ROOT = `${AGENT_RESOURCE_ROOT}/skills`;

export function resolveAgentSkillRoot(projectRoot = process.cwd()) {
  return path.resolve(projectRoot, AGENT_SKILL_ROOT);
}
