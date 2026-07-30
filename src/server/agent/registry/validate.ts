import { ToolIds } from "@/server/agent/ids";
import type { SkillRegistry } from "@/server/agent/skill";
import type { AgentRegistry } from "@/server/agent/registry/registry";
import type { PromptRegistry } from "@/server/agent/registry/prompt-registry";
import type { ContextRegistry } from "@/server/agent/registry/context-registry";
import type { SchemaRegistry } from "@/server/agent/registry/schema-registry";
import type { ToolRegistry } from "@/server/agent/registry/tool-registry";

export function validateAgentRegistry(
  agents: AgentRegistry,
  plugins: {
    contexts: ContextRegistry;
    prompts: PromptRegistry;
    schemas: SchemaRegistry;
    skills: SkillRegistry;
    tools: ToolRegistry;
  },
) {
  if (agents.list().length === 0) {
    throw new Error("Agent Registry 至少需要注册一个 Agent。");
  }

  for (const agent of agents.list()) {
    plugins.prompts.get(agent.prompt);
    plugins.schemas.get(agent.input);
    plugins.schemas.get(agent.output);
    for (const tool of agent.tools) {
      plugins.tools.get(tool);
    }
    for (const context of agent.contexts) {
      plugins.contexts.get(context);
    }
    for (const skill of agent.skills) {
      plugins.skills.get(skill);
    }
    if (
      agent.skills.length > 0 &&
      !agent.tools.includes(ToolIds.ReadLocalResource)
    ) {
      throw new Error(
        `Agent ${agent.id} 声明了 Skill，但未声明 ${ToolIds.ReadLocalResource} Tool。`,
      );
    }
  }
}
