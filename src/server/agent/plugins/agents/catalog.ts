import type { AgentId } from "@/server/agent/ids";
import type { AgentDefinition } from "@/server/agent/types/agent";

import { courseAgentDefinitionsById } from "./course/definitions";

/**
 * 内置 Agent 声明的唯一静态目录。业务代码可以按稳定 ID 读取 WorkOrder
 * 所需的 Tool 和预算，但不需要导入任何具体 Agent Handler。
 */
const agentDefinitionsById = Object.freeze({
  ...courseAgentDefinitionsById,
} satisfies Record<AgentId, AgentDefinition>);

export const agentDefinitions = Object.freeze(
  Object.values(agentDefinitionsById),
);

export function getAgentDefinition<const Id extends AgentId>(
  agentId: Id,
): (typeof agentDefinitionsById)[Id] {
  return agentDefinitionsById[agentId];
}

type AgentWorkOrderDefaults<Id extends AgentId> = Readonly<{
  agentId: (typeof agentDefinitionsById)[Id]["id"];
  allowedTools: (typeof agentDefinitionsById)[Id]["tools"];
  budget: (typeof agentDefinitionsById)[Id]["runtime"];
}>;

export function getAgentWorkOrderDefaults<const Id extends AgentId>(
  agentId: Id,
): AgentWorkOrderDefaults<Id> {
  const definition = getAgentDefinition(agentId);
  return Object.freeze({
    agentId: definition.id,
    allowedTools: definition.tools,
    budget: definition.runtime,
  }) as AgentWorkOrderDefaults<Id>;
}
