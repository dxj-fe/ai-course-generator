import type { AiCapability } from "@/server/infra/ai/model-router";
import type {
  AgentId,
  ContextId,
  PromptId,
  SchemaId,
  SkillId,
  ToolId,
} from "@/server/agent/ids";

export type AgentRuntimeDefaults = Readonly<{
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
  maxOutputTokens: number;
}>;

export type AgentDefinition = Readonly<{
  id: AgentId;
  description: string;
  input: SchemaId;
  output: SchemaId;
  prompt: PromptId;
  tools: readonly ToolId[];
  contexts: readonly ContextId[];
  /** 完整注入系统提示词、作为当前任务方法论的 Skill。 */
  skills: readonly SkillId[];
  /** 只授予渐进读取权限、不预加载主文件的参考 Skill。 */
  resourceSkills?: readonly SkillId[];
  modelCapability: AiCapability;
  runtime: AgentRuntimeDefaults;
}>;
