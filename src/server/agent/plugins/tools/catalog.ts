import { ToolIds } from "@/server/agent/ids";
import type { ToolDefinition } from "@/server/agent/types/tool";

export const toolDefinitions = Object.freeze([
  tool(ToolIds.ReadLocalResource, "读取已授权项目 Agent Skill 资源。", "read"),
  tool(ToolIds.SearchReferences, "检索当前任务已授权资料及有限原文摘录。", "read"),
  tool(ToolIds.SearchTemplates, "按整课页面需求检索功能与样式模板。", "read"),
  tool(
    ToolIds.ValidateCourseArchitecture,
    "检查课程架构提交合同。",
    "compute",
  ),
  tool(
    ToolIds.SubmitCourseArchitecture,
    "提交并持久化课程架构。",
    "write",
    true,
  ),
  tool(ToolIds.GetRunSummary, "读取当前课程运行摘要。", "read"),
  tool(ToolIds.InspectArchitecture, "读取课程架构证据。", "read"),
  tool(ToolIds.InspectCourseReview, "读取整课审查证据。", "read"),
  tool(
    ToolIds.RequestArchitectureRevision,
    "退回课程架构并派发修订。",
    "write",
    true,
  ),
  tool(
    ToolIds.AcceptArchitectureAndDispatchPages,
    "接受架构并创建页面 WorkOrder。",
    "write",
    true,
  ),
  tool(
    ToolIds.AssignPageFixes,
    "按审查 issue 派发页面返工。",
    "write",
    true,
  ),
  tool(ToolIds.RequestReplan, "请求整课重新规划。", "write", true),
  tool(
    ToolIds.AcceptCourseReviewAndPublish,
    "接受整课审查并发布。",
    "write",
    true,
  ),
  tool(ToolIds.FailCourse, "在受控条件下终止课程运行。", "write", true),
  tool(ToolIds.ReadPageContext, "读取当前页面封口上下文。", "read"),
  tool(ToolIds.GeneratePageContent, "生成当前页面内容 DSL。", "write"),
  tool(ToolIds.ResolvePageAssets, "解析或生成页面所需素材。", "write"),
  tool(ToolIds.GeneratePageHtml, "生成当前页面 HTML。", "write"),
  tool(ToolIds.InspectPage, "检查当前页面交付证据。", "compute"),
  tool(ToolIds.RepairPageContent, "定向修订页面内容。", "write"),
  tool(ToolIds.RepairPageHtml, "定向修订页面 HTML。", "write"),
  tool(ToolIds.SubmitPage, "提交当前页面全部 Artifact。", "write", true),
  tool(ToolIds.BlockPage, "记录页面不可恢复阻塞。", "write", true),
  tool(ToolIds.ReadCourseMatrix, "读取目标与页面职责矩阵。", "read"),
  tool(ToolIds.ReadPageSummary, "分批读取当前页面摘要。", "read"),
  tool(ToolIds.ReadPageQuality, "分批读取当前页面质量证据。", "read"),
  tool(ToolIds.InspectPageEvidence, "读取单页受控审查证据。", "read"),
  tool(ToolIds.ValidateCourseReview, "检查整课审查合同。", "compute"),
  tool(
    ToolIds.SubmitCourseReview,
    "提交整课审查结论。",
    "write",
    true,
  ),
  tool(
    ToolIds.BlockCourseReview,
    "记录整课审查证据矛盾。",
    "write",
    true,
  ),
] satisfies readonly ToolDefinition[]);

function tool(
  id: ToolDefinition["id"],
  description: string,
  effect: ToolDefinition["effect"],
  terminal = false,
): ToolDefinition {
  return { id, description, effect, terminal };
}
