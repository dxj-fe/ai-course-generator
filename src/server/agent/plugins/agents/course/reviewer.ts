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
  version: 1,
  description: "基于整课目标和页面证据判断课程是否达到发布质量。",
  input: SchemaIds.CourseReviewerInputV1,
  output: SchemaIds.CourseReviewV1,
  prompt: PromptIds.CourseReviewerSystemV1,
  tools: AgentToolSets.CourseReviewer,
  contexts: [
    ContextIds.CourseArchitecture,
    ContextIds.CourseCurrentPages,
    ContextIds.CourseReview,
  ],
  skills: [],
  modelCapability: "page-qa",
  runtime: {
    maxSteps: 35,
    maxToolCalls: 35,
    timeoutMs: 480_000,
    maxOutputTokens: 24_000,
  },
});
