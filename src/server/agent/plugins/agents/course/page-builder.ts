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
  description:
    "像网页开发 Agent 一样在独立 workspace 中多轮创作、渲染和修订单个课程页面。",
  input: SchemaIds.CoursePageBuilderInput,
  output: SchemaIds.CoursePageSubmission,
  prompt: PromptIds.CoursePageBuilderSystem,
  tools: AgentToolSets.CoursePageBuilder,
  contexts: [
    ContextIds.CourseArchitecture,
    ContextIds.CourseCurrentPages,
    ContextIds.CourseReferences,
  ],
  skills: [SkillIds.CoursePageDesign],
  // frontend-slides 是视觉配方库，不把 380 行通用演示工作流塞进每页 Prompt；
  // Page Creator 可按 Harness 给出的精确 recipe path 渐进读取所需配方。
  resourceSkills: [SkillIds.FrontendSlides],
  // Page Creator 同时承担教学构图、HTML/CSS 实现和浏览器证据修订，必须走
  // page-writer 强档；balanced general 在真实盲测中会退化为纵向卡片堆叠。
  modelCapability: "page-writer",
  runtime: {
    maxSteps: 20,
    maxToolCalls: 28,
    // 单页完整 Agent Loop 共享该总预算，续跑不会重新获得 5 分钟。
    timeoutMs: 300_000,
    maxOutputTokens: 8_000,
  },
});
