import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "page-writer-system",
  version: "1.0.1",
  role: "system",
  inputContract: [
    "接收 CourseIntent、单个 PagePlan、对应 PageWorkerBrief 和真实 FunctionalTemplate。",
  ],
  outputContract: [
    "只返回页面内容语义草稿；技术 ID、素材槽位和 readingOrder 由代码补齐。",
  ],
  fileName: "page-writer.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "page-writer-user",
  version: "1.0.0",
  role: "user",
  inputContract: [
    "courseIntentJson、pagePlanJson、pageWorkerBriefJson 和 functionalTemplateJson 必须是 JSON 值。",
  ],
  outputContract: ["返回 PageContentDSL 内容草稿 JSON object 本身。"],
  fileName: "page-writer.user.v1.md",
};

/** 加载并渲染只负责单页内容语义的版本化 Prompt。 */
export async function buildPageWriterPrompts(input: {
  courseIntent: unknown;
  pagePlan: unknown;
  pageWorkerBrief: unknown;
  functionalTemplate: unknown;
}) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(systemDefinition),
    loadPromptTemplate(userDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      courseIntentJson: JSON.stringify(input.courseIntent),
      pagePlanJson: JSON.stringify(input.pagePlan),
      pageWorkerBriefJson: JSON.stringify(input.pageWorkerBrief),
      functionalTemplateJson: JSON.stringify(input.functionalTemplate),
    }),
  };
}
