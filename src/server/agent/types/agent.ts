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
  version: number;
  description: string;
  input: SchemaId;
  output: SchemaId;
  prompt: PromptId;
  tools: readonly ToolId[];
  contexts: readonly ContextId[];
  skills: readonly SkillId[];
  modelCapability: AiCapability;
  runtime: AgentRuntimeDefaults;
}>;
