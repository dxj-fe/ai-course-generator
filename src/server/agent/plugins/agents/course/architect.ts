import { defineAgent } from "@/server/agent/define";
import {
  AgentIds,
  AgentToolSets,
  ContextIds,
  PromptIds,
  SchemaIds,
  SkillIds,
} from "@/server/agent/ids";

export const courseArchitectAgent = defineAgent({
  id: AgentIds.CourseArchitect,
  description: "根据用户学习需求、课程资料和教学约束设计课程架构。",
  input: SchemaIds.CourseArchitectInput,
  output: SchemaIds.CourseArchitecture,
  prompt: PromptIds.CourseArchitectSystem,
  tools: AgentToolSets.CourseArchitect,
  contexts: [ContextIds.CourseBrief, ContextIds.CourseReferences],
  skills: [SkillIds.CourseDesign],
  modelCapability: "course-architecture",
  runtime: {
    maxSteps: 8,
    maxToolCalls: 8,
    timeoutMs: 300_000,
    maxOutputTokens: 32_000,
  },
});
