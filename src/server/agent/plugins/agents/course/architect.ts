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
  id: AgentIds.CourseLead,
  description: "负责课程规划，并在独立审查后决定返工、重规划或发布。",
  input: SchemaIds.CourseArchitectInput,
  output: SchemaIds.CourseArchitecture,
  prompt: PromptIds.CourseArchitectSystem,
  tools: AgentToolSets.CourseArchitect,
  contexts: [ContextIds.CourseBrief, ContextIds.CourseReferences],
  skills: [SkillIds.CourseDesign],
  modelCapability: "course-architecture",
  runtime: {
    // Lead 只产出轻量 draft；Harness 负责稳定 ID 与完整执行合同投影。
    maxSteps: 8,
    maxToolCalls: 8,
    // Doubao 2.0 Pro 在真实调用中存在超过 120 秒的长尾。必须让 WorkOrder
    // 与 Planner 的 5 分钟总预算一致，不能在模型仍正常生成时提前中断再重试。
    timeoutMs: 300_000,
    maxOutputTokens: 6_000,
  },
});
