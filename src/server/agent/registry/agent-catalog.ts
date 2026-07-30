/**
 * 业务层读取已注册 Agent 声明的稳定门面。具体 Agent 仍按业务域放在 plugins，
 * 调用方只依赖统一 Catalog，不直接导入某个 Agent 定义或 Handler。
 */
export {
  agentDefinitions,
  getAgentDefinition,
  getAgentWorkOrderDefaults,
} from "@/server/agent/plugins/agents/catalog";
