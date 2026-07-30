import type { SkillId } from "@/server/agent/ids";
import type { SkillRegistry } from "@/server/agent/skill/registry";

export function assertSkillsRegistered(
  registry: SkillRegistry,
  skillIds: readonly SkillId[],
) {
  for (const skillId of skillIds) {
    registry.get(skillId);
  }
}
