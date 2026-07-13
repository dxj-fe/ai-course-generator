import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const singlePageSystemPromptDefinition: PromptTemplateDefinition = {
  name: "single-page-plan-system",
  version: "1.0.0",
  role: "system",
  inputContract: ["页面目标、受众和一个已执行工具返回的模板选择结果。"],
  outputContract: ["只返回满足 PagePlanDraft schema 的 JSON object。"],
  fileName: "single-page.system.v1.md",
};

const singlePageUserPromptDefinition: PromptTemplateDefinition = {
  name: "single-page-plan-user",
  version: "1.0.0",
  role: "user",
  inputContract: [
    "pageGoalJson、audienceJson 和 selectedTemplateJson 都必须是 JSON 值。",
  ],
  outputContract: ["返回 PagePlanDraft JSON object 本身。"],
  fileName: "single-page.user.v1.md",
};

export type BuildSinglePagePlanPromptsInput = {
  pageGoal: string;
  audience?: string;
  selectedTemplate: {
    toolName: string;
    templateId: string;
    templateName: string;
    reason: string;
  };
};

export async function buildSinglePagePlanPrompts({
  pageGoal,
  audience,
  selectedTemplate,
}: BuildSinglePagePlanPromptsInput) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(singlePageSystemPromptDefinition),
    loadPromptTemplate(singlePageUserPromptDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      audienceJson: JSON.stringify(audience ?? null),
      pageGoalJson: JSON.stringify(pageGoal),
      selectedTemplateJson: JSON.stringify(selectedTemplate),
    }),
  };
}
