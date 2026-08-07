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
  description: "根据当前 CourseRun 事实决定下一轮 Agent 派工。",
  input: SchemaIds.CourseDirectorInput,
  output: SchemaIds.CourseDirectorDecision,
  prompt: PromptIds.CourseDirectorSystem,
  tools: AgentToolSets.CourseDirector,
  contexts: [
    ContextIds.CourseRun,
    ContextIds.CourseArchitecture,
    ContextIds.CourseReview,
  ],
  skills: [],
  modelCapability: "planner",
  runtime: {
    maxSteps: 3,
    maxToolCalls: 3,
    // 证据已由 Harness 完整加载，本回合只有一次终态决策。
    timeoutMs: 60_000,
    maxOutputTokens: 4_000,
  },
});
