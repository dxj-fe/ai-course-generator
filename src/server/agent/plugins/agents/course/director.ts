import { defineAgent } from "@/server/agent/define";
import {
  AgentIds,
  AgentToolSets,
  ContextIds,
  PromptIds,
  SchemaIds,
} from "@/server/agent/ids";

export const courseDirectorAgent = defineAgent({
  id: AgentIds.CourseDirector,
  version: 1,
  description: "根据当前 CourseRun 事实决定下一轮 Agent 派工。",
  input: SchemaIds.CourseDirectorInputV1,
  output: SchemaIds.CourseDirectorDecisionV1,
  prompt: PromptIds.CourseDirectorSystemV2,
  tools: AgentToolSets.CourseDirector,
  contexts: [
    ContextIds.CourseRun,
    ContextIds.CourseArchitecture,
    ContextIds.CourseReview,
  ],
  skills: [],
  modelCapability: "planner",
  runtime: {
    maxSteps: 5,
    maxToolCalls: 5,
    timeoutMs: 120_000,
    maxOutputTokens: 12_000,
  },
});
