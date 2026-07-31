import { defineAgent } from "@/server/agent/define";
import {
  AgentIds,
  AgentToolSets,
  ContextIds,
  PromptIds,
  SchemaIds,
} from "@/server/agent/ids";

export const courseReviewerAgent = defineAgent({
  id: AgentIds.CourseReviewer,
  description: "基于整课目标和页面证据判断课程是否达到发布质量。",
  input: SchemaIds.CourseReviewerInput,
  output: SchemaIds.CourseReview,
  prompt: PromptIds.CourseReviewerSystem,
  tools: AgentToolSets.CourseReviewer,
  contexts: [
    ContextIds.CourseArchitecture,
    ContextIds.CourseCurrentPages,
    ContextIds.CourseReview,
  ],
  skills: [],
  modelCapability: "course-review",
  runtime: {
    maxSteps: 35,
    maxToolCalls: 35,
    timeoutMs: 480_000,
    // Reviewer 每步只需要选择工具或提交紧凑报告。限制到各档模型都稳定支持的
    // 输出窗口，避免长工具回合因供应商输出上限直接失败。
    maxOutputTokens: 8_000,
  },
});
