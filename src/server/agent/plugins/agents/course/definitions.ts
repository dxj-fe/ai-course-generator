import { AgentIds, type AgentId } from "@/server/agent/ids";
import type { AgentDefinition } from "@/server/agent/types/agent";

import { courseArchitectAgent } from "./architect";
import { courseDirectorAgent } from "./director";
import { coursePageBuilderAgent } from "./page-builder";
import { courseReviewerAgent } from "./reviewer";

/** 课程域的声明式 Agent 插件；执行 Handler 由独立目录装配。 */
export const courseAgentDefinitionsById = Object.freeze({
  [AgentIds.CourseLead]: courseArchitectAgent,
  [AgentIds.CourseDirector]: courseDirectorAgent,
  [AgentIds.CoursePageBuilder]: coursePageBuilderAgent,
  [AgentIds.CourseReviewer]: courseReviewerAgent,
} satisfies Partial<Record<AgentId, AgentDefinition>>);
