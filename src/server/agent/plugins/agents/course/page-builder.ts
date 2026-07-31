import { defineAgent } from "@/server/agent/define";
import {
  AgentIds,
  AgentToolSets,
  ContextIds,
  PromptIds,
  SchemaIds,
  SkillIds,
} from "@/server/agent/ids";

export const coursePageBuilderAgent = defineAgent({
  id: AgentIds.CoursePageBuilder,
  version: 3,
  description: "依据页面职责和完整课程上下文生成可交付的课程页面。",
  input: SchemaIds.CoursePageBuilderInputV1,
  output: SchemaIds.CoursePageSubmissionV1,
  prompt: PromptIds.CoursePageBuilderSystemV1,
  tools: AgentToolSets.CoursePageBuilder,
  contexts: [
    ContextIds.CourseArchitecture,
    ContextIds.CourseCurrentPages,
    ContextIds.CourseReferences,
  ],
  skills: [SkillIds.CoursePageDesign],
  modelCapability: "general",
  runtime: {
    maxSteps: 24,
    maxToolCalls: 36,
    timeoutMs: 900_000,
    maxOutputTokens: 8_000,
  },
});
