import { ContextIds } from "@/server/agent/ids";
import type { ContextDefinition } from "@/server/agent/types/context";

export const courseContextDefinitions = Object.freeze([
  {
    id: ContextIds.CourseBrief,
    description: "用户确认后的结构化课程创建需求。",
  },
  {
    id: ContextIds.CourseReferences,
    description: "当前任务已授权并完成解析的课程资料。",
  },
  {
    id: ContextIds.CourseArchitecture,
    description: "当前已封口的课程事实、目标、规则和页面职责。",
  },
  {
    id: ContextIds.CourseCurrentPages,
    description: "当前课程页面版本及受控摘要。",
  },
  {
    id: ContextIds.CourseReview,
    description: "当前整课审查结论及证据引用。",
  },
  {
    id: ContextIds.CourseRun,
    description: "当前 CourseRun、WorkOrder 与派工状态摘要。",
  },
] satisfies readonly ContextDefinition[]);
