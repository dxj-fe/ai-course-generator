import type { AgentDefinition } from "@/server/agent/types/agent";
import {
  formatSkillCatalog,
  LocalResourceSession,
  type SkillRegistry,
} from "@/server/agent/skill";
import { readLocalAgentResource } from "@/server/infra/file/safe-reader";

import { createReadLocalResourceTool } from "./read-local-resource";

const DEFAULT_SKILL_GRANT = Object.freeze({
  maxFileBytes: 128 * 1024,
  maxSessionBytes: 512 * 1024,
  maxReadCount: 16,
  allowedMediaTypes: Object.freeze([
    "text/markdown",
    "text/plain",
    "application/json",
    "application/yaml",
    "text/csv",
  ]),
});

/**
 * 根据 Agent 声明统一建立 Skill Session，并完整加载所有已触发 Skill 的
 * SKILL.md。Handler 只消费结果，不能自行选择 Skill 根目录或重复定义权限。
 */
export async function prepareAgentSkillRuntime(input: {
  definition: AgentDefinition;
  registry: SkillRegistry;
  workOrderId: string;
}) {
  const session = new LocalResourceSession({
    agentId: input.definition.id,
    workOrderId: input.workOrderId,
    skillIds: input.definition.skills,
    ...DEFAULT_SKILL_GRANT,
  });
  const catalog = input.registry.catalog(input.definition.skills);
  const entries = await Promise.all(
    input.definition.skills.map(async (skillId) => {
      const skill = input.registry.get(skillId);
      const resource = await readLocalAgentResource({
        path: skill.logicalSkillFile,
        registry: input.registry,
        session,
      });
      return {
        skillId,
        logicalPath: resource.logicalPath,
        content: resource.content ?? "",
      };
    }),
  );

  return Object.freeze({
    session,
    readLocalResourceTool: createReadLocalResourceTool({
      registry: input.registry,
      session,
    }),
    promptContext: Object.freeze({
      availableSkills: formatSkillCatalog(catalog),
      skillInstructions: entries
        .map(
          ({ logicalPath, content }) =>
            `<skill path="${logicalPath}">\n${content}\n</skill>`,
        )
        .join("\n\n"),
    }),
  });
}
