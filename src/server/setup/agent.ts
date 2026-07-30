import { agentPluginCatalog } from "@/server/agent/plugins/catalog";
import { ContextRegistry } from "@/server/agent/registry/context-registry";
import { PromptRegistry } from "@/server/agent/registry/prompt-registry";
import { AgentRegistry } from "@/server/agent/registry/registry";
import { SchemaRegistry } from "@/server/agent/registry/schema-registry";
import { ToolRegistry } from "@/server/agent/registry/tool-registry";
import { validateAgentRegistry } from "@/server/agent/registry/validate";
import type { SkillRegistry } from "@/server/agent/skill";
import { getProjectSkillRegistry } from "@/server/setup/skills";

export type AgentSystem = Readonly<{
  agents: AgentRegistry;
  contexts: ContextRegistry;
  prompts: PromptRegistry;
  schemas: SchemaRegistry;
  skills: SkillRegistry;
  tools: ToolRegistry;
}>;

let agentSystemPromise: Promise<AgentSystem> | undefined;

export async function createAgentSystem(
  providedSkills?: SkillRegistry,
): Promise<AgentSystem> {
  const skills = providedSkills ?? (await getProjectSkillRegistry());
  const agents = new AgentRegistry();
  const contexts = new ContextRegistry();
  const prompts = new PromptRegistry();
  const schemas = new SchemaRegistry();
  const tools = new ToolRegistry();
  for (const definition of agentPluginCatalog.contexts) {
    contexts.register(definition);
  }
  for (const definition of agentPluginCatalog.prompts) {
    prompts.register(definition);
  }
  for (const definition of agentPluginCatalog.schemas) {
    schemas.register(definition);
  }
  for (const definition of agentPluginCatalog.tools) {
    tools.register(definition);
  }
  for (const definition of agentPluginCatalog.agents) {
    agents.register(definition);
  }
  await prompts.validate();
  validateAgentRegistry(agents, {
    contexts,
    prompts,
    schemas,
    skills,
    tools,
  });
  contexts.freeze();
  prompts.freeze();
  schemas.freeze();
  tools.freeze();
  agents.freeze();
  return Object.freeze({
    agents,
    contexts,
    prompts,
    schemas,
    skills,
    tools,
  });
}

export function getAgentSystem() {
  agentSystemPromise ??= createAgentSystem();
  return agentSystemPromise;
}
