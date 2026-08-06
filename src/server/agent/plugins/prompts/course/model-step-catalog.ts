type ModelStepPromptTemplateDefinition = {
  name: string;
  role: "system" | "user";
  inputContract: readonly string[];
  outputContract: readonly string[];
  fileName: string;
};

type ModelStepPromptCatalogEntry = {
  id:
    | "pedagogy"
    | "story"
    | "visual"
    | "page-writer"
    | "image-prompt"
    | "html-engineer"
    | "qa"
    | "repair";
  modelStepName: string;
  status: "active" | "draft";
  outputSchema: string;
  moduleFile?: string;
  templateVariables: readonly string[];
  system: ModelStepPromptTemplateDefinition;
  user: ModelStepPromptTemplateDefinition;
};

export const MODEL_STEP_PROMPT_CATALOG = [
  {
    id: "pedagogy",
    modelStepName: "PedagogyModelStep",
    status: "active",
    outputSchema: "PedagogyPlanSchema",
    moduleFile: "pedagogy.ts",
    templateVariables: ["courseIntentJson", "coursePlanJson"],
    system: {
      name: "pedagogy-system",
      role: "system",
      inputContract: ["已校验的 CourseIntent 和 CoursePlan。"],
      outputContract: ["只返回 PedagogyPlan 内容草稿 JSON。"],
      fileName: "pedagogy.system.md",
    },
    user: {
      name: "pedagogy-user",
      role: "user",
      inputContract: ["CourseIntent 和 CoursePlan 的序列化 JSON。"],
      outputContract: ["pageGuidance 按页面顺序输出，不包含 pageId。"],
      fileName: "pedagogy.user.md",
    },
  },
  {
    id: "story",
    modelStepName: "StoryModelStep",
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
      role: "system",
      inputContract: ["已校验的 CourseIntent、CoursePlan 和 PedagogyPlan。"],
      outputContract: ["只返回 StoryArc 内容草稿 JSON。"],
      fileName: "story.system.md",
    },
    user: {
      name: "story-user",
      role: "user",
      inputContract: ["三项上游产物的序列化 JSON。"],
      outputContract: ["pageBeats 按页面顺序输出，不包含 pageId。"],
      fileName: "story.user.md",
    },
  },
  {
    id: "visual",
    modelStepName: "VisualBriefModelStep",
    status: "active",
    outputSchema: "VisualBriefSchema",
    moduleFile: "visual.ts",
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
      role: "system",
      inputContract: [
        "已校验的课程产物和一个由服务端 Registry 解析的 StyleTemplate。",
      ],
      outputContract: ["只返回 VisualBrief 内容草稿 JSON。"],
      fileName: "visual-director.system.md",
    },
    user: {
      name: "visual-director-user",
      role: "user",
      inputContract: ["所有模板变量都必须来自服务端类型化数据。"],
      outputContract: [
        "pageGuidance 按页面顺序输出；不输出 styleTemplateId。",
      ],
      fileName: "visual-director.user.md",
    },
  },
  {
    id: "page-writer",
    modelStepName: "PageWriterModelStep",
    status: "active",
    outputSchema: "PageContentDSLSchema",
    moduleFile: "page-writer.ts",
    templateVariables: [
      "pageBriefJson",
      "referenceContextJson",
      "validationFeedbackJson",
    ],
    system: {
      name: "page-writer-system",
      role: "system",
      inputContract: [
        "一个合并后的单页学习 brief、授权资料与可选修订反馈。",
      ],
      outputContract: [
        "只返回直接满足本页 learningObjective 的内容语义草稿；技术 ID 和素材槽由代码补齐。",
      ],
      fileName: "page-writer.system.md",
    },
    user: {
      name: "page-writer-user",
      role: "user",
      inputContract: ["四项单页输入的序列化 JSON。"],
      outputContract: ["返回 PageContentDSL 内容草稿 JSON object 本身。"],
      fileName: "page-writer.user.md",
    },
  },
  {
    id: "image-prompt",
    modelStepName: "ImagePromptModelStep",
    status: "active",
    outputSchema: "AssetRequestSchema[]",
    moduleFile: "image-prompt.ts",
    templateVariables: ["imagePromptInputJson"],
    system: {
      name: "image-prompt-system",
      role: "system",
      inputContract: [
        "已校验的 PageContentDSL 素材槽、当前页视觉指导和 StyleTemplate。",
      ],
      outputContract: [
        "每个真实 assetSlot 只返回一条创意方向；代码编译最终 AssetRequest。",
      ],
      fileName: "image-prompt.system.md",
    },
    user: {
      name: "image-prompt-user",
      role: "user",
      inputContract: ["完整的类型化 ImagePrompt 输入 JSON。"],
      outputContract: ["返回与 assetSlots 一一对应的 directions JSON object。"],
      fileName: "image-prompt.user.md",
    },
  },
  {
    id: "html-engineer",
    modelStepName: "HtmlEngineerModelStep",
    status: "active",
    outputSchema: "HtmlOutputSchema",
    moduleFile: "html-engineer.ts",
    templateVariables: [
      "pageBriefJson",
      "designDirectionJson",
      "styleCssText",
      "assetsJson",
      "validationFeedbackJson",
    ],
    system: {
      name: "html-engineer-system",
      role: "system",
      inputContract: [
        "只接收精简 PageBrief、当前页 DesignDirection、CSS 变量和已校验素材。",
      ],
      outputContract: [
        "只返回以 <!doctype html> 开始的完整、自包含静态 HTML。",
      ],
      fileName: "html-engineer.system.md",
    },
    user: {
      name: "html-engineer-user",
      role: "user",
      inputContract: ["全部变量必须来自服务端已校验数据。"],
      outputContract: ["只返回完整 HTML 文档，不返回 Markdown 或解释。"],
      fileName: "html-engineer.user.md",
    },
  },
  {
    id: "qa",
    modelStepName: "PageQAModelStep",
    status: "active",
    outputSchema: "QualityReportSchema",
    moduleFile: "page-qa.ts",
    templateVariables: ["pageQaInputJson"],
    system: {
      name: "page-qa-system",
      role: "system",
      inputContract: [
        "已校验的页面计划、DSL、HTML、课程上下文、brief、素材及静态/浏览器证据。",
      ],
      outputContract: [
        "只返回六维语义评分和可定位问题；最终分数和决策由代码计算。",
      ],
      fileName: "page-qa.system.md",
    },
    user: {
      name: "page-qa-user",
      role: "user",
      inputContract: ["完整的 Page QA 输入 JSON。"],
      outputContract: ["返回 Page QA 语义评估 JSON object 本身。"],
      fileName: "page-qa.user.md",
    },
  },
  {
    id: "repair",
    modelStepName: "RepairModelStep",
    status: "active",
    outputSchema: "RepairResultSchema",
    moduleFile: "repair.ts",
    templateVariables: ["repairInputJson"],
    system: {
      name: "repair-system",
      role: "system",
      inputContract: [
        "只接收原始页面产物、已校验 QualityReport、限定目标和当前修订尝试序号。",
      ],
      outputContract: [
        "返回定向修复候选及已处理 issue 引用；必须经过同一合同和 re-QA。",
      ],
      fileName: "repair.system.md",
    },
    user: {
      name: "repair-user",
      role: "user",
      inputContract: [
        "由 RepairRequestSchema 生成、仅保留本轮授权 issues 的单页输入投影。",
      ],
      outputContract: ["返回 RepairResultSchema 修复候选或结构化拒绝。"],
      fileName: "repair.user.md",
    },
  },
] as const satisfies readonly ModelStepPromptCatalogEntry[];

export type ModelStepPromptId =
  (typeof MODEL_STEP_PROMPT_CATALOG)[number]["id"];

export function getModelStepPromptCatalogEntry(id: ModelStepPromptId) {
  const definition = MODEL_STEP_PROMPT_CATALOG.find(
    (candidate) => candidate.id === id,
  );

  if (!definition) {
    throw new Error(`未知 Model Step Prompt：${id}`);
  }

  return definition;
}
