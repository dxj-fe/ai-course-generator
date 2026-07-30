import { agentDefinitions } from "./agents/catalog";
import { courseContextDefinitions } from "./contexts";
import { coursePromptDefinitions } from "./prompts";
import { courseSchemaDefinitions } from "./schemas";
import { toolDefinitions } from "./tools";

/**
 * 所有业务代码插件的唯一静态注册目录。未来增加其他业务 Agent 时，只在这里
 * 汇总对应定义；setup 和通用 Registry 不需要认识业务域。
 */
export const agentPluginCatalog = Object.freeze({
  agents: agentDefinitions,
  contexts: Object.freeze([...courseContextDefinitions]),
  prompts: Object.freeze([...coursePromptDefinitions]),
  schemas: Object.freeze([...courseSchemaDefinitions]),
  tools: Object.freeze([...toolDefinitions]),
});
