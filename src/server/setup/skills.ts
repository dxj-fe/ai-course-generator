import { PROJECT_SKILL_IDS } from "@/server/agent/ids";
import {
  resolveAgentSkillRoot,
  SkillRegistry,
} from "@/server/agent/skill";

let projectSkillRegistryPromise: Promise<SkillRegistry> | undefined;

export function createProjectSkillRegistry(input?: {
  projectRoot?: string;
  skillRoot?: string;
}) {
  const registry = new SkillRegistry({
    skillRoot:
      input?.skillRoot ??
      resolveAgentSkillRoot(input?.projectRoot ?? process.cwd()),
    declaredIds: PROJECT_SKILL_IDS,
  });
  return registry.initialize();
}

export function getProjectSkillRegistry() {
  projectSkillRegistryPromise ??= createProjectSkillRegistry();
  return projectSkillRegistryPromise;
}
