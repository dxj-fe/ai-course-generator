import type { SpecialistPromptLibraryEntry } from "./types";

export const SPECIALIST_PROMPT_LIBRARY = [
  {
    id: "planner",
    agentName: "CoursePlannerAgent",
    status: "active",
    outputSchema: "CoursePlanSchema",
    moduleFile: "course-planner.ts",
    templateVariables: [
      "courseIntentJson",
      "functionalTemplatesJson",
      "styleTemplateJson",
    ],
    system: {
      name: "course-planner-system",
      version: "2.0.1",
      role: "system",
      inputContract: [
        "已校验的 CourseIntent、功能模板清单和唯一 StyleTemplate。",
      ],
      outputContract: [
        "只返回 CoursePlan 内容草稿；稳定技术字段由确定性代码补齐。",
      ],
      fileName: "course-planner.system.v2.md",
    },
    user: {
      name: "course-planner-user",
      version: "2.0.0",
      role: "user",
      inputContract: ["三个模板变量都必须是序列化 JSON 值。"],
      outputContract: ["返回 CoursePlan 内容草稿 JSON object 本身。"],
      fileName: "course-planner.user.v2.md",
    },
  },
  {
    id: "pedagogy",
    agentName: "PedagogyAgent",
    status: "active",
    outputSchema: "PedagogyPlanSchema",
    moduleFile: "pedagogy.ts",
    templateVariables: ["courseIntentJson", "coursePlanJson"],
    system: {
      name: "pedagogy-system",
      version: "2.0.0",
      role: "system",
      inputContract: ["已校验的 CourseIntent 和 CoursePlan。"],
      outputContract: ["只返回 PedagogyPlan 内容草稿 JSON。"],
      fileName: "pedagogy.system.v2.md",
    },
    user: {
      name: "pedagogy-user",
      version: "2.0.0",
      role: "user",
      inputContract: ["CourseIntent 和 CoursePlan 的序列化 JSON。"],
      outputContract: ["pageGuidance 按页面顺序输出，不包含 pageId。"],
      fileName: "pedagogy.user.v2.md",
    },
  },
  {
    id: "story",
    agentName: "StoryAgent",
    status: "active",
    outputSchema: "StoryArcSchema",
    moduleFile: "story.ts",
    templateVariables: [
      "courseIntentJson",
      "coursePlanJson",
      "pedagogyPlanJson",
    ],
    system: {
      name: "story-system",
      version: "2.0.0",
      role: "system",
      inputContract: ["已校验的 CourseIntent、CoursePlan 和 PedagogyPlan。"],
      outputContract: ["只返回 StoryArc 内容草稿 JSON。"],
      fileName: "story.system.v2.md",
    },
    user: {
      name: "story-user",
      version: "2.0.0",
      role: "user",
      inputContract: ["三项上游产物的序列化 JSON。"],
      outputContract: ["pageBeats 按页面顺序输出，不包含 pageId。"],
      fileName: "story.user.v2.md",
    },
  },
  {
    id: "visual",
    agentName: "VisualDirectorAgent",
    status: "active",
    outputSchema: "VisualBriefSchema",
    moduleFile: "visual-director.ts",
    templateVariables: [
      "courseIntentJson",
      "coursePlanJson",
      "pageCount",
      "pedagogyPlanJson",
      "storyArcJson",
      "styleTemplateJson",
    ],
    system: {
      name: "visual-director-system",
      version: "2.0.0",
      role: "system",
      inputContract: [
        "已校验的课程产物和一个由服务端 Registry 解析的 StyleTemplate。",
      ],
      outputContract: ["只返回 VisualBrief 内容草稿 JSON。"],
      fileName: "visual-director.system.v2.md",
    },
    user: {
      name: "visual-director-user",
      version: "2.0.0",
      role: "user",
      inputContract: ["所有模板变量都必须来自服务端类型化数据。"],
      outputContract: [
        "pageGuidance 按页面顺序输出；不输出 styleTemplateId。",
      ],
      fileName: "visual-director.user.v2.md",
    },
  },
  {
    id: "page-writer",
    agentName: "PageWriterAgent",
    status: "active",
    outputSchema: "PageContentDSLSchema",
    moduleFile: "page-writer.ts",
    templateVariables: [
      "courseIntentJson",
      "pagePlanJson",
      "pageWorkerBriefJson",
      "functionalTemplateJson",
    ],
    system: {
      name: "page-writer-system",
      version: "2.0.0",
      role: "system",
      inputContract: [
        "已校验的 CourseIntent、单页 PagePlan、同页 PageWorkerBrief 和唯一 FunctionalTemplate。",
      ],
      outputContract: [
        "只返回单页内容语义草稿；技术 ID 和素材槽由代码补齐。",
      ],
      fileName: "page-writer.system.v2.md",
    },
    user: {
      name: "page-writer-user",
      version: "2.0.0",
      role: "user",
      inputContract: ["四项单页输入的序列化 JSON。"],
      outputContract: ["返回 PageContentDSL 内容草稿 JSON object 本身。"],
      fileName: "page-writer.user.v2.md",
    },
  },
  {
    id: "image-prompt",
    agentName: "ImagePromptAgent",
    status: "active",
    outputSchema: "AssetRequestSchema[]",
    moduleFile: "image-prompt.ts",
    templateVariables: ["imagePromptInputJson"],
    system: {
      name: "image-prompt-system",
      version: "2.0.0",
      role: "system",
      inputContract: [
        "已校验的 PageContentDSL 素材槽、当前页视觉指导和 StyleTemplate。",
      ],
      outputContract: [
        "每个真实 assetSlot 只返回一条创意方向；代码编译最终 AssetRequest。",
      ],
      fileName: "image-prompt.system.v2.md",
    },
    user: {
      name: "image-prompt-user",
      version: "2.0.0",
      role: "user",
      inputContract: ["完整的类型化 ImagePrompt 输入 JSON。"],
      outputContract: ["返回与 assetSlots 一一对应的 directions JSON object。"],
      fileName: "image-prompt.user.v2.md",
    },
  },
  {
    id: "html-engineer",
    agentName: "HtmlEngineerAgent",
    status: "active",
    outputSchema: "HtmlOutputSchema",
    moduleFile: "html-engineer.ts",
    templateVariables: [
      "pageContentDslJson",
      "functionalTemplateJson",
      "styleTemplateJson",
      "styleCssText",
      "visualBriefJson",
      "pageGuidanceJson",
      "assetsJson",
      "validationFeedbackJson",
    ],
    system: {
      name: "html-engineer-system",
      version: "2.1.0",
      role: "system",
      inputContract: [
        "只接收 DSL、服务端模板、视觉指导和已校验素材；不接收原始用户 Prompt。",
      ],
      outputContract: [
        "只返回以 <!doctype html> 开始的完整、自包含静态 HTML。",
      ],
      fileName: "html-engineer.system.v2.md",
    },
    user: {
      name: "html-engineer-user",
      version: "2.1.0",
      role: "user",
      inputContract: ["全部变量必须来自服务端已校验数据。"],
      outputContract: ["只返回完整 HTML 文档，不返回 Markdown 或解释。"],
      fileName: "html-engineer.user.v2.md",
    },
  },
  {
    id: "qa",
    agentName: "PageQAAgent",
    status: "active",
    outputSchema: "QualityReportSchema",
    moduleFile: "page-qa.ts",
    templateVariables: ["pageQaInputJson"],
    system: {
      name: "page-qa-system",
      version: "2.1.0",
      role: "system",
      inputContract: [
        "已校验的页面计划、DSL、HTML、课程上下文、brief、素材及静态/浏览器证据。",
      ],
      outputContract: [
        "只返回六维语义评分和可定位问题；最终分数和决策由代码计算。",
      ],
      fileName: "page-qa.system.v2.md",
    },
    user: {
      name: "page-qa-user",
      version: "2.1.0",
      role: "user",
      inputContract: ["完整的 Page QA 输入 JSON。"],
      outputContract: ["返回 Page QA 语义评估 JSON object 本身。"],
      fileName: "page-qa.user.v2.md",
    },
  },
  {
    id: "repair",
    agentName: "RepairAgent",
    status: "draft",
    outputSchema: "RepairResult（合同草案，尚无共享运行时 Schema）",
    templateVariables: ["repairInputJson"],
    system: {
      name: "repair-system",
      version: "0.1.0",
      role: "system",
      inputContract: [
        "未来只接收原始页面产物、已校验 QualityReport、限定目标和有限 repair budget。",
      ],
      outputContract: [
        "返回定向修复候选及已处理 issue 引用；必须经过同一合同和 re-QA。",
      ],
      fileName: "repair.system.v1.md",
    },
    user: {
      name: "repair-user",
      version: "0.1.0",
      role: "user",
      inputContract: ["未来的类型化 Repair 输入 JSON。"],
      outputContract: ["返回合同草案约定的修复候选 JSON。"],
      fileName: "repair.user.v1.md",
    },
  },
] as const satisfies readonly SpecialistPromptLibraryEntry[];

export type SpecialistPromptId =
  (typeof SPECIALIST_PROMPT_LIBRARY)[number]["id"];

export function getSpecialistPromptDefinition(id: SpecialistPromptId) {
  const definition = SPECIALIST_PROMPT_LIBRARY.find(
    (candidate) => candidate.id === id,
  );

  if (!definition) {
    throw new Error(`未知 Specialist Prompt：${id}`);
  }

  return definition;
}
